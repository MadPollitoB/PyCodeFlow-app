import os
import queue
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import uuid
from flask import Flask, jsonify, request

app = Flask(__name__)
runs = {}
runs_lock = threading.Lock()

MARKER = "__CODESSESSIE_INPUT_REQUEST__"
RUN_TIMEOUT_SECONDS = 10
MAX_EVENTS = 4000
TRIM_TO_EVENTS = 2500

# 🔒 Max gelijktijdige runs — pas aan naar jouw server (1 CPU, 256MB → max ~10)
MAX_CONCURRENT_RUNS = 10

# ⏳ Max wachtrij-grootte — weiger pas als ook de wachtrij vol is
MAX_QUEUE_SIZE = 50

# ⏳ Max tijd dat een job in de wachtrij mag wachten (seconden)
QUEUE_TIMEOUT_SECONDS = 120

# 🔒 Geblokkeerde modules — leerlingen kunnen deze niet importeren
BLOCKED_MODULES = {
    'os', 'subprocess', 'socket', 'shutil', 'importlib',
    'ctypes', 'multiprocessing', 'signal', 'pty', 'tty',
    'termios', 'fcntl', 'resource', 'mmap', 'syslog',
    'posix', 'pwd', 'grp', 'spwd', 'crypt',
}

WRAPPER = r'''
import builtins
import sys
import traceback

# 🔒 Blokkeer gevaarlijke modules
_BLOCKED = ''' + repr(BLOCKED_MODULES) + r'''
_real_import = builtins.__import__

def _safe_import(name, *args, **kwargs):
    root = name.split('.')[0]
    if root in _BLOCKED:
        raise ImportError(f"Module '{name}' is niet beschikbaar in deze omgeving.")
    return _real_import(name, *args, **kwargs)

builtins.__import__ = _safe_import

# 🔒 input() vervangen door interactieve versie
def __codesessie_input(prompt=""):
    if prompt:
        sys.stdout.write(str(prompt))
        sys.stdout.flush()
    sys.stdout.write("%s\n")
    sys.stdout.flush()
    line = sys.stdin.readline()
    if line == "":
        raise EOFError("EOF when reading a line")
    return line.rstrip("\n")

builtins.input = __codesessie_input

namespace = {"__name__": "__main__"}
try:
    with open("main.py", "r", encoding="utf-8") as f:
        code = f.read()
    exec(compile(code, "main.py", "exec"), namespace)
except SystemExit:
    raise
except Exception:
    traceback.print_exc()
'''.replace('%s', MARKER)


# ---------------------------------------------------------------------------
# Queue systeem
# ---------------------------------------------------------------------------
# Stroom:
#   1. /runs/start maakt een run aan met status 'queued' en plaatst een job
#      in run_queue. Geeft meteen { runId, queued: true } terug.
#   2. De dispatcher-thread pikt jobs op zodra er een slot vrij is.
#   3. Het subprocess start → status wordt 'running'.
#   4. De frontend pollt /runs/<id>/events zoals voorheen.
#      Zolang status 'queued' is, krijgt de frontend { queued: true, queuePosition: N }.
#      Zodra de run start, stromen events normaal binnen.
# ---------------------------------------------------------------------------

run_queue = queue.Queue(maxsize=MAX_QUEUE_SIZE)
run_semaphore = threading.Semaphore(MAX_CONCURRENT_RUNS)


def append_event(run, event_type, data=None):
    with run['lock']:
        run['seq'] += 1
        run['events'].append({
            'seq': run['seq'],
            'type': event_type,
            'data': data or ''
        })
        if len(run['events']) > 5000:
            run['events'] = run['events'][-TRIM_TO_EVENTS:]


def terminate_process_group(proc):
    try:
        pgid = os.getpgid(proc.pid)
    except Exception:
        pgid = None

    if pgid is not None:
        try:
            os.killpg(pgid, signal.SIGTERM)
        except Exception:
            pass
    else:
        try:
            proc.terminate()
        except Exception:
            pass

    try:
        proc.wait(timeout=1.5)
        return
    except subprocess.TimeoutExpired:
        pass
    except Exception:
        return

    if pgid is not None:
        try:
            os.killpg(pgid, signal.SIGKILL)
        except Exception:
            pass
    else:
        try:
            proc.kill()
        except Exception:
            pass

    try:
        proc.wait(timeout=2)
    except Exception:
        pass


def read_stream(run, stream, is_err=False):
    while True:
        chunk = stream.readline()
        if not chunk:
            break

        text = chunk.decode('utf-8', errors='replace')

        if len(run['events']) > MAX_EVENTS:
            append_event(run, 'stderr', '\n⚠️ Output limiet bereikt, uitvoering werd gestopt.\n')
            terminate_process_group(run['proc'])
            return

        if MARKER in text:
            parts = text.split(MARKER)
            for i, part in enumerate(parts):
                if part:
                    append_event(run, 'stderr' if is_err else 'stdout', part)
                if i < len(parts) - 1:
                    append_event(run, 'input_request', '')
        else:
            append_event(run, 'stderr' if is_err else 'stdout', text)


def watcher(run):
    proc = run['proc']
    out_thread = threading.Thread(target=read_stream, args=(run, proc.stdout, False), daemon=True)
    err_thread = threading.Thread(target=read_stream, args=(run, proc.stderr, True), daemon=True)
    out_thread.start()
    err_thread.start()

    try:
        proc.wait(timeout=RUN_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        append_event(
            run,
            'stderr',
            f'\n⚠️ Tijdslimiet bereikt ({RUN_TIMEOUT_SECONDS} seconden)\nUitvoering werd automatisch gestopt.\n'
        )
        terminate_process_group(proc)
    finally:
        for stream_name in ('stdin', 'stdout', 'stderr'):
            stream = getattr(proc, stream_name, None)
            if stream:
                try:
                    stream.close()
                except Exception:
                    pass

        out_thread.join(timeout=1)
        err_thread.join(timeout=1)

        run['running'] = False
        run['status'] = 'done'
        run['ended_at'] = time.time()
        append_event(run, 'end', '')

        # 🔓 Slot vrijgeven → dispatcher start volgende job
        run_semaphore.release()


def _launch_run(run, code):
    """Start het subprocess. Aangeroepen vanuit de dispatcher."""
    temp_dir = run['dir']
    wrapper_path = os.path.join(temp_dir, 'wrapper.py')
    main_path = os.path.join(temp_dir, 'main.py')

    with open(wrapper_path, 'w', encoding='utf-8') as f:
        f.write(WRAPPER)
    with open(main_path, 'w', encoding='utf-8') as f:
        f.write(code)

    proc = subprocess.Popen(
        ['python', '-u', 'wrapper.py'],
        cwd=temp_dir,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=0,
        start_new_session=True
    )
    run['proc'] = proc
    run['status'] = 'running'
    run['running'] = True
    threading.Thread(target=watcher, args=(run,), daemon=True).start()


def dispatcher():
    """
    Achtergrond-thread: haalt jobs uit de wachtrij en start ze
    zodra er een uitvoer-slot beschikbaar is.
    """
    while True:
        try:
            job = run_queue.get(timeout=1)
        except queue.Empty:
            continue

        run_id = job['run_id']

        with runs_lock:
            run = runs.get(run_id)

        # Run werd al geannuleerd (bv. queue-timeout) — overslaan
        if not run or run.get('status') == 'cancelled':
            run_queue.task_done()
            continue

        # Wacht op een vrij slot (blokkeert tot iemand klaar is)
        run_semaphore.acquire()

        # Controleer opnieuw na het wachten
        with runs_lock:
            run = runs.get(run_id)

        if not run or run.get('status') == 'cancelled':
            run_semaphore.release()
            run_queue.task_done()
            continue

        try:
            _launch_run(run, job['code'])
        except Exception as e:
            run['status'] = 'error'
            run['running'] = False
            run['ended_at'] = time.time()
            append_event(run, 'stderr', f'\n❌ Kon run niet starten: {e}\n')
            append_event(run, 'end', '')
            run_semaphore.release()

        run_queue.task_done()


threading.Thread(target=dispatcher, daemon=True).start()


def _queue_position(run_id):
    """Geeft de positie in de wachtrij terug (1 = volgende aan de beurt)."""
    items = list(run_queue.queue)
    for i, job in enumerate(items):
        if job['run_id'] == run_id:
            return i + 1
    return None


# ---------------------------------------------------------------------------
# Achtergrond: annuleer jobs die te lang wachten in de queue
# ---------------------------------------------------------------------------
def cancel_timed_out_queue_jobs():
    while True:
        time.sleep(10)
        now = time.time()
        with runs_lock:
            for run in list(runs.values()):
                if (
                    run.get('status') == 'queued'
                    and now - run.get('queued_at', now) > QUEUE_TIMEOUT_SECONDS
                ):
                    run['status'] = 'cancelled'
                    run['running'] = False
                    run['ended_at'] = now
                    append_event(
                        run, 'stderr',
                        f'\n⏳ Wachtrij-timeout: run werd geannuleerd na '
                        f'{QUEUE_TIMEOUT_SECONDS}s wachten.\n'
                    )
                    append_event(run, 'end', '')


threading.Thread(target=cancel_timed_out_queue_jobs, daemon=True).start()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.post('/runs/start')
def start_run():
    payload = request.get_json(force=True)
    code = str(payload.get('code', ''))
    run_id = uuid.uuid4().hex

    temp_dir = tempfile.mkdtemp(prefix='codesessie_')

    run = {
        'id': run_id,
        'proc': None,
        'events': [],
        'seq': 0,
        'lock': threading.Lock(),
        'running': False,
        'status': 'queued',
        'dir': temp_dir,
        'ended_at': None,
        'queued_at': time.time(),
    }

    with runs_lock:
        runs[run_id] = run

    # Wachtrij helemaal vol? Dan pas een echte fout (uitzonderlijk geval)
    if run_queue.full():
        run['status'] = 'cancelled'
        run['ended_at'] = time.time()
        shutil.rmtree(temp_dir, ignore_errors=True)
        with runs_lock:
            runs.pop(run_id, None)
        return jsonify({'error': 'Wachtrij is vol, probeer later opnieuw.'}), 503

    job = {'run_id': run_id, 'code': code}
    run_queue.put(job)

    pos = _queue_position(run_id)
    append_event(run, 'queued', str(pos or ''))

    return jsonify({'runId': run_id, 'queued': True, 'queuePosition': pos})


@app.get('/runs/<run_id>/events')
def get_events(run_id):
    after = int(request.args.get('after', '0'))

    with runs_lock:
        run = runs.get(run_id)

    if not run:
        return jsonify({'events': [], 'lastSeq': after, 'running': False}), 404

    with run['lock']:
        events = [e for e in run['events'] if e['seq'] > after]
        last_seq = run['seq']
        running = run['running']
        status = run.get('status', 'unknown')

    # Zolang de run in de wachtrij staat: geef positie mee
    if status == 'queued':
        pos = _queue_position(run_id)
        return jsonify({
            'events': events,
            'lastSeq': last_seq,
            'running': False,
            'queued': True,
            'queuePosition': pos,
        })

    if not running:
        def cleanup():
            time.sleep(3)
            with runs_lock:
                gone = runs.pop(run_id, None)
            if gone:
                shutil.rmtree(gone['dir'], ignore_errors=True)

        threading.Thread(target=cleanup, daemon=True).start()

    return jsonify({'events': events, 'lastSeq': last_seq, 'running': running})


@app.post('/runs/<run_id>/input')
def send_input(run_id):
    payload = request.get_json(force=True)
    user_input = str(payload.get('input', ''))

    with runs_lock:
        run = runs.get(run_id)

    if not run or not run['running']:
        return jsonify({'ok': False}), 404

    try:
        run['proc'].stdin.write((user_input + '\n').encode('utf-8'))
        run['proc'].stdin.flush()
    except Exception:
        return jsonify({'ok': False}), 500

    return jsonify({'ok': True})


@app.get('/health')
def health():
    with runs_lock:
        active = sum(1 for r in runs.values() if r.get('status') == 'running')
        queued = sum(1 for r in runs.values() if r.get('status') == 'queued')
    return jsonify({
        'ok': True,
        'activeRuns': active,
        'queuedRuns': queued,
        'maxRuns': MAX_CONCURRENT_RUNS,
        'maxQueue': MAX_QUEUE_SIZE,
    })


# ---------------------------------------------------------------------------
# 🧹 Stale runs cleanup
# ---------------------------------------------------------------------------
def cleanup_stale_runs():
    while True:
        time.sleep(60)
        cutoff = time.time() - 120
        with runs_lock:
            stale = [
                rid for rid, r in runs.items()
                if r.get('status') not in ('queued', 'running')
                and r.get('ended_at') and r['ended_at'] < cutoff
            ]
            for rid in stale:
                gone = runs.pop(rid)
                shutil.rmtree(gone['dir'], ignore_errors=True)


threading.Thread(target=cleanup_stale_runs, daemon=True).start()


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, threaded=True)

import os
import queue
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import uuid
import psutil
from flask import Flask, jsonify, request

app = Flask(__name__)
runs = {}
runs_lock = threading.Lock()
disconnectTimers = {}

MARKER = "__CODESSESSIE_INPUT_REQUEST__"
ACTIVE_CPU_TIME_LIMIT_SECONDS = 8
INPUT_WAIT_TIMEOUT_SECONDS = 180
IDLE_GRACE_PERIOD_SECONDS = 20
MAX_EVENTS = 4000
TRIM_TO_EVENTS = 2500

# 🔒 Max gelijktijdige runs — pas aan naar jouw server (1 CPU, 256MB → max ~10)
MAX_CONCURRENT_RUNS = 18

# ⏳ Max wachtrij-grootte — weiger pas als ook de wachtrij vol is
MAX_QUEUE_SIZE = 90

# ⏳ Max tijd dat een job in de wachtrij mag wachten (seconden)
QUEUE_TIMEOUT_SECONDS = 90

# 🔒 Geblokkeerde modules — leerlingen kunnen deze niet importeren
BLOCKED_MODULES = {
    'os', 'subprocess', 'socket', 'shutil', 'importlib',
    'ctypes', 'multiprocessing', 'signal', 'pty', 'tty',
    'termios', 'fcntl', 'resource', 'mmap', 'syslog',
    'posix', 'pwd', 'grp', 'spwd', 'crypt',
}

# ── Nederlandse uitleg bij veelvoorkomende Python-errors ─────────────────────
NL_UITLEG = {
    'ValueError': {
        'int()': '💡 Je probeert tekst of een lege invoer om te zetten naar een getal (int). Typ een getal voor je op Enter drukt.',
        'float()': '💡 Je probeert tekst of een lege invoer om te zetten naar een kommagetal (float). Typ een getal voor je op Enter drukt.',
        'default': '💡 De waarde klopt niet voor dit soort bewerking.',
    },
    'NameError': {
        'default': '💡 Je gebruikt een variabele of functie die nog niet bestaat. Controleer de spelling of maak de variabele eerst aan.',
    },
    'IndentationError': {
        'default': '💡 De inspringing klopt niet. Gebruik 4 spaties per niveau.',
    },
    'TabError': {
        'default': '💡 Mix van tabs en spaties. Gebruik enkel spaties (4 per niveau).',
    },
    'SyntaxError': {
        'default': '💡 Er zit een schrijffout in je code. Controleer haakjes, aanhalingstekens en typefouten.',
    },
    'ZeroDivisionError': {
        'default': '💡 Je deelt door nul. Controleer de deler in je berekening.',
    },
    'IndexError': {
        'default': '💡 Dit element bestaat niet in de lijst. Lijsten beginnen bij index 0.',
    },
    'TypeError': {
        'default': '💡 Je combineert types die niet samen werken (bv. getal + tekst) of roept iets aan dat geen functie is.',
    },
    'AttributeError': {
        'default': '💡 Deze eigenschap of methode bestaat niet voor dit type. Controleer de spelling.',
    },
    'KeyError': {
        'default': '💡 Deze sleutel bestaat niet in het woordenboek (dict). Controleer de schrijfwijze.',
    },
    'RecursionError': {
        'default': '💡 Je functie roept zichzelf te vaak op. Controleer de stopconditie.',
    },
    'StopIteration': {
        'default': '💡 Geen elementen meer in de reeks. Controleer het gebruik van next().',
    },
    'OverflowError': {
        'default': '💡 Het getal is te groot om mee te werken.',
    },
    'MemoryError': {
        'default': '💡 Je code gebruikt te veel geheugen. Mogelijk maak je een te grote lijst aan.',
    },
    'FileNotFoundError': {
        'default': '💡 Bestanden openen is niet toegestaan in deze omgeving.',
    },
    'PermissionError': {
        'default': '💡 Bestandsbewerkingen zijn niet toegestaan in deze omgeving.',
    },
    'EOFError': {
        'default': '💡 De code verwacht invoer maar er is niets meer. Controleer de stopconditie van je lus.',
    },
    'ImportError': {
        'default': '💡 Deze module is niet beschikbaar in de schoolomgeving.',
    },
    'ModuleNotFoundError': {
        'default': '💡 Deze module bestaat niet of is niet beschikbaar in de schoolomgeving.',
    },
    'UnboundLocalError': {
        'default': '💡 Je gebruikt een variabele die nog geen waarde heeft. Wijs eerst een waarde toe.',
    },
    'RuntimeError': {
        'default': '💡 Er is een fout opgetreden tijdens de uitvoering.',
    },
}

WRAPPER = (
    'import builtins\nimport sys\nimport traceback\n\n'
    '_BLOCKED = ' + repr(BLOCKED_MODULES) + '\n'
    '_real_import = builtins.__import__\n\n'
    'def _safe_import(name, *args, **kwargs):\n'
    '    root = name.split(".")[0]\n'
    '    if root in _BLOCKED:\n'
    '        raise ImportError(f"Module \'{name}\' is niet beschikbaar in deze omgeving.")\n'
    '    return _real_import(name, *args, **kwargs)\n\n'
    'builtins.__import__ = _safe_import\n\n'
    'def __codesessie_input(prompt=""):\n'
    '    if prompt:\n'
    '        sys.stdout.write(str(prompt))\n'
    '        sys.stdout.flush()\n'
    '    sys.stdout.write("' + MARKER + r'\n")'  + '\n'
    '    sys.stdout.flush()\n'
    '    line = sys.stdin.readline()\n'
    '    if line == "":\n'
    '        raise EOFError("Geen invoer ontvangen")\n'
    '    return line.rstrip("\\n")\n\n'
    'builtins.input = __codesessie_input\n\n'
    '_NL_UITLEG = ' + repr(NL_UITLEG) + '\n\n'
    'def _nl_uitleg(exc_type, exc_msg):\n'
    '    m = _NL_UITLEG.get(exc_type, {})\n'
    '    if not m:\n'
    '        return ""\n'
    '    for k, v in m.items():\n'
    '        if k != "default" and k.lower() in exc_msg.lower():\n'
    '            return "\\n" + v + "\\n"\n'
    '    return "\\n" + m.get("default", "") + "\\n"\n\n'
    'namespace = {"__name__": "__main__"}\n'
    'try:\n'
    '    with open("main.py", "r", encoding="utf-8") as f:\n'
    '        code = f.read()\n'
    '    exec(compile(code, "main.py", "exec"), namespace)\n'
    '    sys.stdout.write("\\n\\n===== Compiler klaar met runnen =====\\n")\n'
    '    sys.stdout.flush()\n'
    'except SystemExit:\n'
    '    sys.stdout.write("\\n\\n===== Compiler klaar met runnen =====\\n")\n'
    '    sys.stdout.flush()\n'
    '    raise\n'
    'except Exception as _e:\n'
    '    traceback.print_exc()\n'
    '    _u = _nl_uitleg(type(_e).__name__, str(_e))\n'
    '    if _u.strip():\n'
    '        sys.stderr.write(_u)\n'
    '        sys.stderr.flush()\n'
)


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
queue_peak_size = 0
peak_active_runs = 0
psutil.cpu_percent(interval=None)


def append_event(run, event_type, data=None):
    with run['lock']:
        run['seq'] += 1
        run['events'].append({
            'seq': run['seq'],
            'type': event_type,
            'data': data or ''
        })
        run['last_activity_at'] = time.time()
        if event_type == 'input_request':
            run['waiting_for_input'] = True
            run['waiting_since'] = time.time()
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

    stop_reason = None

    while True:
        if proc.poll() is not None:
            break

        now = time.time()
        try:
            cpu_times = proc.cpu_times()
            cpu_used = float(getattr(cpu_times, 'user', 0.0)) + float(getattr(cpu_times, 'system', 0.0))
        except Exception:
            cpu_used = 0.0

        if cpu_used >= ACTIVE_CPU_TIME_LIMIT_SECONDS:
            stop_reason = (
                f'\n⚠️ CPU-tijdslimiet bereikt ({ACTIVE_CPU_TIME_LIMIT_SECONDS} seconden).\n'
                'Waarschijnlijk zit de code in een zware of oneindige lus.\n'
                'Uitvoering werd automatisch gestopt.\n'
            )
            append_event(run, 'stderr', stop_reason)
            append_event(run, 'run_error', {'errorType': 'cpu_timeout',
                'message': f'CPU-tijdslimiet bereikt ({ACTIVE_CPU_TIME_LIMIT_SECONDS}s)',
                'line': None})
            terminate_process_group(proc)
            break

        waiting_for_input = bool(run.get('waiting_for_input'))
        waiting_since = float(run.get('waiting_since') or now)
        disconnected_at = run.get('disconnect_requested_at')

        if waiting_for_input and (now - waiting_since) >= INPUT_WAIT_TIMEOUT_SECONDS:
            stop_reason = (
                f'\n⏳ Geen input ontvangen gedurende {INPUT_WAIT_TIMEOUT_SECONDS} seconden.\n'
                'Uitvoering werd automatisch gestopt zodat andere runs verder kunnen.\n'
            )
            append_event(run, 'stderr', stop_reason)
            terminate_process_group(proc)
            break

        if disconnected_at and (now - disconnected_at) >= IDLE_GRACE_PERIOD_SECONDS:
            stop_reason = (
                f'\n⚠️ Verbinding met leerling/browser weggevallen gedurende {IDLE_GRACE_PERIOD_SECONDS} seconden.\n'
                'Run werd automatisch gestopt.\n'
            )
            append_event(run, 'stderr', stop_reason)
            terminate_process_group(proc)
            break

        time.sleep(0.2)

    try:
        proc.wait(timeout=1.5)
    except Exception:
        pass
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
        if run.get('status') != 'cancelled':
            run['status'] = 'done'
        run['ended_at'] = time.time()
        append_event(run, 'end', '')

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

    import resource as _resource

    def _set_rlimits():
        """OS-niveau limieten voor het subprocess."""
        # Max geopende file descriptors: 64 (default vaak 1024)
        try:
            _resource.setrlimit(_resource.RLIMIT_NOFILE, (64, 64))
        except Exception:
            pass
        # Max grootte van bestanden aangemaakt door het proces: 1 MB
        try:
            _resource.setrlimit(_resource.RLIMIT_FSIZE, (1 * 1024 * 1024, 1 * 1024 * 1024))
        except Exception:
            pass
        # Max aantal processen/threads: 32
        try:
            _resource.setrlimit(_resource.RLIMIT_NPROC, (32, 32))
        except Exception:
            pass

    proc = subprocess.Popen(
        ['python', '-u', 'wrapper.py'],
        cwd=temp_dir,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=0,
        start_new_session=True,
        preexec_fn=_set_rlimits,
    )
    global peak_active_runs
    run['proc'] = proc
    run['status'] = 'running'
    run['running'] = True
    with runs_lock:
        active_now = sum(1 for r in runs.values() if r.get('status') == 'running')
    peak_active_runs = max(peak_active_runs, active_now)
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

@app.post('/runs/check')
def syntax_check():
    """Voert enkel ast.parse() uit op de code — geen subprocess, geen semaphore."""
    import ast
    payload = request.get_json(force=True)
    code = str(payload.get('code', ''))
    try:
        ast.parse(code)
        return jsonify({ 'ok': True, 'error': None })
    except SyntaxError as e:
        return jsonify({
            'ok': False,
            'error': {
                'message': str(e.msg),
                'line':    e.lineno,
                'col':     e.offset,
                'text':    e.text or '',
            }
        })

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
        'last_activity_at': time.time(),
        'waiting_for_input': False,
        'waiting_since': None,
        'disconnect_requested_at': None,
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

    global queue_peak_size
    job = {'run_id': run_id, 'code': code}
    run_queue.put(job)
    queue_peak_size = max(queue_peak_size, run_queue.qsize())

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

    with run['lock']:
        waiting = bool(run.get('waiting_for_input', False))

    return jsonify({
        'events': events,
        'lastSeq': last_seq,
        'running': running,
        'waitingForInput': waiting,
    })


@app.post('/runs/<run_id>/input')
def send_input(run_id):
    payload = request.get_json(force=True)
    user_input = str(payload.get('input', ''))

    with runs_lock:
        run = runs.get(run_id)

    if not run or not run['running']:
        return jsonify({'ok': False, 'reason': 'not_running'}), 404

    # Weiger input als de runner NIET wacht op stdin
    # Dit is de definitieve bescherming tegen ghost keypresses en race conditions
    if not run.get('waiting_for_input', False):
        return jsonify({'ok': False, 'reason': 'not_waiting'}), 409

    try:
        run['waiting_for_input'] = False
        run['waiting_since'] = None
        run['disconnect_requested_at'] = None
        run['last_activity_at'] = time.time()
        run['proc'].stdin.write((user_input + '\n').encode('utf-8'))
        run['proc'].stdin.flush()
    except Exception:
        return jsonify({'ok': False, 'reason': 'write_error'}), 500

    return jsonify({'ok': True})




@app.post('/runs/<run_id>/disconnect')
def mark_disconnect(run_id):
    with runs_lock:
        run = runs.get(run_id)

    if not run or not run.get('running'):
        return jsonify({'ok': False}), 404

    run['disconnect_requested_at'] = time.time()
    return jsonify({'ok': True, 'graceSeconds': IDLE_GRACE_PERIOD_SECONDS})


@app.post('/runs/<run_id>/resume')
def clear_disconnect(run_id):
    with runs_lock:
        run = runs.get(run_id)

    if not run:
        return jsonify({'ok': False}), 404

    run['disconnect_requested_at'] = None
    return jsonify({'ok': True})


@app.post('/runs/<run_id>/cancel')
def cancel_run(run_id):
    with runs_lock:
        run = runs.get(run_id)

    if not run:
        return jsonify({'ok': False}), 404

    status = run.get('status')

    if status == 'queued':
        run['status'] = 'cancelled'
        run['running'] = False
        run['ended_at'] = time.time()
        append_event(run, 'stderr', '\n⚠️ Run werd geannuleerd.\n')
        append_event(run, 'end', '')
        return jsonify({'ok': True, 'cancelled': True})

    if run.get('proc') and run.get('running'):
        run['status'] = 'cancelled'
        append_event(run, 'stderr', '\n⚠️ Run werd geannuleerd.\n')
        terminate_process_group(run['proc'])
        return jsonify({'ok': True, 'cancelled': True})

    return jsonify({'ok': True, 'cancelled': False})

@app.get('/health')
def health():
    with runs_lock:
        active = sum(1 for r in runs.values() if r.get('status') == 'running')
        queued = sum(1 for r in runs.values() if r.get('status') == 'queued')

    process = psutil.Process()
    proc_mem = process.memory_info().rss
    cpu_percent = psutil.cpu_percent(interval=None)

    def read_int(path):
        try:
            raw = open(path, 'r', encoding='utf-8').read().strip()
            if raw == 'max':
                return None
            return int(raw)
        except Exception:
            return None

    cgroup_memory_current = read_int('/sys/fs/cgroup/memory.current')
    cgroup_memory_max = read_int('/sys/fs/cgroup/memory.max')

    return jsonify({
        'ok': True,
        'activeRuns': active,
        'queuedRuns': queued,
        'maxRuns': MAX_CONCURRENT_RUNS,
        'maxQueue': MAX_QUEUE_SIZE,
        'queuePeak': queue_peak_size,
        'peakActiveRuns': peak_active_runs,
        'inputWaitTimeoutSeconds': INPUT_WAIT_TIMEOUT_SECONDS,
        'activeCpuTimeLimitSeconds': ACTIVE_CPU_TIME_LIMIT_SECONDS,
        'disconnectGraceSeconds': IDLE_GRACE_PERIOD_SECONDS,
        'cpuPercent': cpu_percent,
        'memoryBytes': proc_mem,
        'memoryMb': round(proc_mem / 1024 / 1024, 1),
        'systemMemoryAvailableBytes': psutil.virtual_memory().available,
        'cgroupMemoryCurrentBytes': cgroup_memory_current,
        'cgroupMemoryMaxBytes': cgroup_memory_max,
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

# PyCodeFlow — Technische Documentatie

> **Versie 2026.2.8.0** · Atheneum Hoboken
> Stack: Node.js + Python Flask + SQLite + Docker + Cloudflare Tunnel

---

## Inhoudsopgave

1. [Project Overview](#1-project-overview)
2. [Architectuur & Tech Stack](#2-architectuur--tech-stack)
3. [Deployment](#3-deployment)
4. [Authenticatie & Beveiliging](#4-authenticatie--beveiliging)
5. [Database Schema](#5-database-schema)
6. [Socket.IO Event Referentie](#6-socketio-event-referentie)
7. [REST API Referentie](#7-rest-api-referentie)
8. [Python Runner](#8-python-runner)
9. [Bestandsindex](#9-bestandsindex)

**Andere documenten:**
- [SPRINTLOG.md](SPRINTLOG.md) — Sprintplanning & roadmap
- [CHANGELOG.md](CHANGELOG.md) — Versiegeschiedenis
- [USER-MANUAL.md](USER-MANUAL.md) — Gebruikershandleiding

---

## 1. Project Overview

PyCodeFlow is een real-time collaboratief Python-codeerplatform voor klasgebruik en examens. Leerlingen joinen met een 6-tekens sessiecode — daarna stromen code, output en stuursignalen live via WebSockets.

**Drie werkvormen:**

- **Klasmodus gedeeld** — alle leerlingen delen één editor. Leerkracht broadcast live code.
- **Klasmodus individueel** — elke leerling heeft een eigen privéwerkblad naast de gedeelde code.
- **Examenmodus** — elke leerling heeft een volledig privé-editor. Leerkracht kan meekijken.
- **Vrije editor** — leerlingen oefenen Python zonder sessiecode. Geen synchronisatie.

---

## 2. Architectuur & Tech Stack

```
Browser (leerling / leerkracht)
        │  Socket.IO + HTTP
        ▼
  web container (Node.js :3000)
   server.js + Express + Socket.IO
   SQLite via better-sqlite3
        │  HTTP (intern netwerk)
        ▼
  runner container (Python Flask :5000)
   app.py + subprocess sandbox
        │
        ▼
   tmpfs (tijdelijke code-bestanden)
```

| Laag | Technologie |
|---|---|
| Frontend | Vanilla HTML/CSS/JS + Monaco Editor + Socket.IO client |
| Backend web | Node.js 20 + Express + Socket.IO |
| Backend runner | Python 3.12 + Flask + Gunicorn |
| Database | SQLite via `better-sqlite3` |
| Real-time | Socket.IO over WebSockets |
| Auth | Custom login + scrypt hashing + HMAC cookie |
| Deployment | Docker Compose + Cloudflare Tunnel |
| Editor | Monaco Editor (AMD loader via `/monaco`) |

---

## 3. Deployment

### 3.1 Vereisten

- Docker + Docker Compose
- NAS of server met voldoende RAM (runner: 8 GB)
- Cloudflare account + domein (voor productie)

### 3.2 Eerste installatie

```bash
# 1. Maak data en logs mappen aan
mkdir -p /volume3/docker/pycodeflow/data
mkdir -p /volume3/docker/pycodeflow/logs

# 2. Kopieer .env.example naar .env en vul in:
#    - POC_BASIC_COOKIE_SECRET (willekeurige string, min 32 tekens)
#    - CLOUDFLARE_TUNNEL_TOKEN (uit Cloudflare dashboard)

# 3. Build en start
cd /volume3/docker/pycodeflow
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d

# 4. Maak eerste leerkrachtenaccount aan
docker compose exec web node scripts/manage-teacher.js add <gebruiker> <wachtwoord>

# 5. Verifieer
bash check-deployment.sh
```

### 3.3 Leerkrachtenaccounts beheren

Wachtwoorden staan **nooit** in `.env` — altijd in SQLite via de CLI:

```bash
# Account aanmaken
docker compose exec web node scripts/manage-teacher.js add bjorn Wachtwoord123

# Alle accounts tonen
docker compose exec web node scripts/manage-teacher.js list

# Wachtwoord resetten
docker compose exec web node scripts/manage-teacher.js reset-password bjorn NieuwWachtwoord

# Account verwijderen
docker compose exec web node scripts/manage-teacher.js delete bjorn
```

### 3.4 Update deployen

```bash
# Bestanden kopiëren naar NAS, dan:
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d

# Verificatie
bash check-deployment.sh
```

### 3.5 Docker Compose Services

| Service | Configuratie |
|---|---|
| `web` | Node.js. 768 MB RAM, 1.5 CPU. Poort 3000 intern. Afhangt van runner. |
| `runner` | Flask/Gunicorn. 8 GB RAM, 5 CPU. Read-only filesystem. tmpfs op `/tmp` en `/work`. `cap_drop ALL`, `no-new-privileges`, `pids_limit 128`. Geen extern netwerk. |
| `cloudflared` | Enkel in prod overlay. Stuurt HTTPS-verkeer door naar `web:3000`. |

### 3.6 .env variabelen

| Variabele | Doel |
|---|---|
| `POC_BASIC_AUTH_ENABLED` | `true` om leerkrachtlogin te verplichten |
| `POC_BASIC_COOKIE_SECRET` | HMAC-geheim voor de `teacher_auth` cookie (min 32 tekens) |
| `CLOUDFLARE_TUNNEL_TOKEN` | Token uit Cloudflare dashboard |
| `TEST_MODE` | `true` = lokaal dev (geen Cloudflare tunnel) |

> `POC_BASIC_USER` en `POC_BASIC_PASS_HASH` zijn **verouderd** en mogen verwijderd worden na migratie. Accounts staan in SQLite.

### 3.7 Verificatiescript

```bash
bash check-deployment.sh
```

Controleert 110+ aspecten verdeeld over: basisstructuur, Docker, server, database, scripts, public bestanden, .env, SQLite en Docker container status. Output: ✅ / ⚠️ / ❌ per check.

---

## 4. Authenticatie & Beveiliging

### 4.1 Leerkrachtlogin

- Custom login-pagina (`/teacher-login.html`) — geen native browser-popup
- Wachtwoorden: scrypt-hashes in SQLite (`N=16384, r=8, p=1`)
- Na login: HMAC-SHA256 cookie `teacher_auth` (SameSite=Strict)
- Rate limiting: 6 mislukte pogingen → 30 min IP-blokkade + exponentiële vertraging

### 4.2 CSRF-bescherming

Random token (32 bytes hex) per server-start. Gezet als `csrf_token` cookie. Gevalideerd op:
- `POST /api/sessions/:code/block-toggle`
- `DELETE /api/sessions/:code`
- `POST /api/stress-test/start`

### 4.3 IP Rate Limiting

- **Klasmodus/examenmodus**: max 1 run per 3 seconden per socket
- **Vrije editor**: max 20 runs per minuut per IP + max 1 per 3 seconden per socket

### 4.4 Runner Sandboxing

- Geblokkeerde Python modules: `os`, `subprocess`, `socket`, `shutil`, `importlib`, `ctypes`, `multiprocessing`, `signal`, `pty`, `tty`, `termios`, `fcntl`, `resource`, `mmap`, `syslog`, `posix`, `pwd`, `grp`
- OS-niveau limieten via `preexec_fn`: max 64 file descriptors, 1 MB bestandsgrootte, 32 processen
- CPU-limiet: 8 seconden per run
- Input-timeout: 180 seconden wachten op stdin
- Subprocess in nieuwe sessie (`start_new_session=True`) → SIGKILL bereikt volledige procesgroep

---

## 5. Database Schema

SQLite database: `/volume3/docker/pycodeflow/data/pycodeflow.db`

```sql
teachers (
  id           TEXT PRIMARY KEY,  -- UUID
  username     TEXT UNIQUE,
  pass_hash    TEXT,              -- scrypt hash
  display_name TEXT,
  created_at   INTEGER,
  last_login   INTEGER
)

sessions (
  code         TEXT PRIMARY KEY,  -- 6-tekens alfanumeriek
  id           TEXT UNIQUE,       -- UUID
  name         TEXT,
  mode         TEXT,              -- 'class' | 'exam'
  editor_assist INTEGER,
  created_at   INTEGER,
  closed       INTEGER,
  blocked      INTEGER,
  deleted      INTEGER,
  shared_code  TEXT,
  announcement TEXT,
  workspace_mode TEXT,
  students_json TEXT
)

code_snapshots (
  id           TEXT PRIMARY KEY,  -- UUID
  session_code TEXT,
  student_id   TEXT,
  student_name TEXT,
  timestamp    INTEGER,
  code         TEXT
)
-- Index: (session_code, student_id, timestamp)
```

---

## 6. Socket.IO Event Referentie

### Sessie lifecycle

| Event | Richting | Beschrijving |
|---|---|---|
| `teacher_create_session` | client → server | Sessie aanmaken (name, mode, editorAssist, templateCode) |
| `teacher_join_session` | client → server | Herverbinden met bestaande sessie |
| `teacher_join_as_observer` | client → server | Read-only meekijken als tweede leerkracht |
| `student_join` | client → server | Leerling joint sessie (name, code, resumeId) |
| `student_join_free` | client → server | Leerling joint vrije editor (name, className) |
| `teacher_close_session` | client → server | Sessie sluiten, alle leerlingen force_landing |
| `teacher_delete_session` | client → server | Sessie permanent verwijderen |
| `force_landing` | server → client | Leerling terugsturen naar landingspagina |
| `session_created` | server → client | Bevestiging sessie aangemaakt |
| `teacher_session_data` | server → client | Volledige sessiedata naar leerkracht |
| `observer_session_data` | server → client | Sessiedata naar observer (read-only) |
| `student_state` | server → client | Volledige leerlingstate (incl. annotaties) |

### Code synchronisatie

| Event | Richting | Beschrijving |
|---|---|---|
| `code_update` | client → server | Code gewijzigd (codeText, workspace) |
| `shared_code_update` | server → client | Gedeelde code bijgewerkt (lightweight) |
| `teacher_toggle_class_workspace` | client → server | Wissel gedeeld ↔ individueel |
| `teacher_send_snippet` | client → server | Stuur code als read-only voorbeeld |
| `teacher_clear_snippet` | client → server | Wis het voorbeeld bij leerlingen |
| `snippet_update` | server → client | Nieuw of gewist voorbeeld |

### Run lifecycle

| Event | Richting | Beschrijving |
|---|---|---|
| `run_request` | client → server | Start Python run (codeText, workspace) |
| `runtime_input` | client → server | Stdin-invoer naar lopende run |
| `run_output` | server → client | Gecumuleerde output |
| `run_error` | server → client | Gestructureerd fout-event {errorType, message, line} |
| `run_end` | server → client | Run beëindigd {audience, reason} |
| `run_queued` | server → client | Run staat in wachtrij {position} |
| `run_rate_limited` | server → client | Te snel; {waitMs, message} |
| `free_run_request` | client → server | Run in vrije editor |
| `free_run_output` | server → client | Output in vrije editor |
| `free_run_end` | server → client | Run beëindigd in vrije editor |

### Leerkracht controls

| Event | Richting | Beschrijving |
|---|---|---|
| `teacher_send_announcement` | client → server | Opdrachttekst naar alle leerlingen |
| `teacher_select_student` | client → server | Live meekijken bij leerling |
| `teacher_toggle_student` | client → server | Run/edit permissie per leerling |
| `teacher_toggle_all` | client → server | Run/edit permissie voor iedereen |
| `teacher_remove_student` | client → server | Leerling verwijderen uit sessie |
| `teacher_toggle_session_block` | client → server | Sessie blokkeren/deblokkeren |
| `teacher_start_timer` | client → server | Countdown starten {durationMs} |
| `teacher_stop_timer` | client → server | Countdown stoppen |
| `timer_update` | server → client | Timer tick {remainingMs, running} |
| `teacher_send_annotation` | client → server | Annotatie op regelbereik {startLine, endLine, message, color} |
| `teacher_clear_annotations` | client → server | Wis alle annotaties bij leerlingen |
| `annotation_added` | server → client | Nieuwe annotatie naar leerlingen |
| `annotations_cleared` | server → client | Alle annotaties gewist |

### Leerling signals

| Event | Richting | Beschrijving |
|---|---|---|
| `student_tab_hidden` | client → server | Tab verlaten (examenmodus) |
| `student_tab_visible` | client → server | Tab terug actief |
| `student_raise_hand` | client → server | Hand opsteken |
| `student_lower_hand` | client → server | Hand neerlaten |
| `teacher_lower_hand` | client → server | Leerkracht wist hand van leerling |
| `hand_lowered_by_teacher` | server → client | Bevestiging hand gewist |
| `student_mark_done` | client → server | Leerling markeert zichzelf als klaar |
| `student_unmark_done` | client → server | Leerling zet terug op bezig |
| `teacher_reset_done` | client → server | Wis klaar-status van één leerling |
| `teacher_reset_all_done` | client → server | Wis alle klaar-statussen |
| `done_reset_by_teacher` | server → client | Bevestiging status gewist |
| `sessions_updated` | server → alle | Broadcast bij sessie-aanmaak/-verwijdering/-sluiting |

---

## 7. REST API Referentie

### Web server (`/`)

| Endpoint | Auth | Beschrijving |
|---|---|---|
| `GET /health` | Geen | Uptime, sessies, geheugen, versie |
| `POST /api/teacher-login` | Geen | Login {username, password} → cookie |
| `GET /api/teacher-logout` | Cookie | Wis cookie, redirect naar login |
| `GET /api/sessions` | Cookie | Lijst van actieve sessies |
| `GET /api/templates` | Cookie | Lijst van Python-oefeningstemplates |
| `POST /api/sessions/:code/block-toggle` | Cookie + CSRF | Sessie blokkeren/deblokkeren |
| `DELETE /api/sessions/:code` | Cookie + CSRF | Sessie verwijderen |
| `GET /api/sessions/:code/export` | Cookie | Download leerlingencode als .txt |
| `GET /api/sessions/:code/history/:studentId` | Cookie | Code snapshots van een leerling |
| `GET /api/monitoring` | Cookie | Runner stats, sessies, history |
| `POST /api/syntax-check` | Cookie | Syntaxcheck voor leerkracht |
| `POST /api/syntax-check-student` | Geen | Syntaxcheck voor leerling/vrije editor |
| `POST /api/stress-test/start` | Cookie + CSRF | Stresstest starten |
| `GET /api/stress-test/stream` | Cookie | SSE stream met live testoutput |
| `POST /api/stress-test/stop` | Cookie | Lopende test stoppen |
| `GET /api/stress-test/logs` | Cookie | Lijst van stresstest logbestanden |
| `GET /api/stress-test/logs/:filename` | Cookie | Download logbestand |

### Python Runner (`runner:5000`, intern)

| Endpoint | Beschrijving |
|---|---|
| `POST /runs/start` | Start of wachtrij een run |
| `GET /runs/:id/events?after=N` | Poll events (stdout, stderr, input_request, run_error, end) |
| `POST /runs/:id/input` | Schrijf stdin-invoer |
| `POST /runs/:id/disconnect` | Browser disconnect — start grace-timer (20s) |
| `POST /runs/:id/resume` | Wis disconnect-vlag |
| `POST /runs/:id/cancel` | Onmiddellijk annuleren |
| `POST /runs/check` | Syntaxcheck via ast.parse() — geen subprocess |
| `GET /health` | Actieve runs, wachtrij, CPU, RAM, piekwaarden |

---

## 8. Python Runner

### 8.1 Limieten

| Constante | Waarde |
|---|---|
| `MAX_CONCURRENT_RUNS` | 18 gelijktijdige subprocessen |
| `MAX_QUEUE_SIZE` | 90 wachtende jobs |
| `QUEUE_TIMEOUT_SECONDS` | 90s max wachttijd |
| `ACTIVE_CPU_TIME_LIMIT_SECONDS` | 8s CPU-tijd per run |
| `INPUT_WAIT_TIMEOUT_SECONDS` | 180s wachten op stdin |
| `IDLE_GRACE_PERIOD_SECONDS` | 20s na browser-disconnect |
| `MAX_EVENTS` | 4000 output-events per run |

### 8.2 Run lifecycle

1. `POST /runs/start` → job in `queue.Queue`, retourneert `runId`
2. Dispatcher-thread wacht op `threading.Semaphore` slot
3. `subprocess.Popen` met `preexec_fn` (rlimits), `start_new_session=True`
4. Web server pollt `GET /runs/:id/events` elke 180ms (800ms bij wachtrij)
5. Events: `stdout`, `stderr`, `input_request`, `run_error`, `end`
6. Web server routeert via `forwardRunnerEvent` naar juiste Socket.IO client

### 8.3 Code snapshots

`maybeSnapshot()` in `server.js` slaat max 1 snapshot per 10 seconden per leerling op in `code_snapshots`. Aangeroepen bij elke `code_update` in individuele fase en examenmodus.

---


## 10. Bestandsindex

| Bestand | Doel |
|---|---|
| `web/server.js` | Node.js/Express/Socket.IO server (~3400 regels) |
| `web/public/app.js` | Alle client-side logica (~1800 regels) |
| `web/public/styles.css` | Gedeelde stylesheet + dark mode variabelen |
| `web/public/index.html` | Landingspagina |
| `web/public/student-start.html` | Naam + sessiecode invoer |
| `web/public/student-app.html` | Leerling Monaco editor + output |
| `web/public/teacher-app.html` | Leerkracht controlepaneel |
| `web/public/teacher-sessions.html` | Sessielijst + aanmaak UI |
| `web/public/teacher-login.html` | Custom login-pagina |
| `web/public/free-editor.html` | Vrije Python editor (zonder sessiecode) |
| `web/public/monitoring.html` | Systeembeheer + stresstest module |
| `web/templates.json` | 9 voorgeladen Python-oefeningstemplates |
| `web/db/database.js` | SQLite module (teachers, sessions, code_snapshots) |
| `web/scripts/manage-teacher.js` | CLI: accounts aanmaken/verwijderen/resetten |
| `web/scripts/migrate-env-to-db.js` | Eenmalig: .env credentials → SQLite |
| `web/scripts/hash-password.js` | CLI: scrypt hash genereren |
| `web/package.json` | npm dependencies |
| `web/Dockerfile` | Node.js image |
| `runner/app.py` | Flask Python runner + sandbox (~600 regels) |
| `runner/requirements.txt` | Flask, psutil, gunicorn |
| `runner/Dockerfile` | Python 3.12 image |
| `data/pycodeflow.db` | SQLite database (Docker volume) |
| `logs/` | Stresstest logbestanden (Docker volume) |
| `docker-compose.yml` | Basis compose config |
| `docker-compose.prod.yml` | Productie overlay (cloudflared) |
| `.env` | Runtime geheimen — nooit committen naar git |
| `check-deployment.sh` | Verificatiescript (110+ checks) |

---


*PyCodeFlow · Atheneum Hoboken · v2026.2.8.0*

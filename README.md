# PyCodeFlow — Technische Documentatie

> **Versie 2026.2.7.13** · Atheneum Hoboken
> Platform: Node.js + Python Flask + SQLite + Docker + Cloudflare Tunnel

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
9. [Sprintoverzicht & Roadmap](#9-sprintoverzicht--roadmap)
10. [Bestandsindex](#10-bestandsindex)
11. [Changelog](#11-changelog)

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

## 9. Sprintoverzicht & Roadmap

| Sprint | Inhoud | Status | Inschatting |
|---|---|---|---|
| 1–8 | Zie changelog | ✅ Afgerond | — |
| 9 | Technische schuld & bugfixes | 🔄 Gepland | ~0.5 dag |
| 10 | UX verbeteringen vóór migratie | 🔄 Gepland | ~1 dag |
| 11 | Kleine features & polish | 🔄 Gepland | ~1 dag |
| 12a | PostgreSQL + Monaco bundelen | 🔄 Gepland | ~2 dagen |
| 12b | Admin-pagina: leerkrachten & klassen | 🔄 Gepland | ~3 dagen |
| 12c | Admin-pagina: leerlingenbeheer | 🔄 Gepland | ~3 dagen |
| 12d | Klas-dropdown + zachte toegangscontrole | 🔄 Gepland | ~3 dagen |
| 12e | Google OAuth leerlingen | 🔄 Gepland | ~3 dagen |
| 12f | Smartschool SSO | 🔄 Gepland (optioneel) | ~1 week |

---

### Sprint 9 — Technische schuld & kritieke bugfixes *(~0.5 dag)*

**Impact:** Onzichtbaar voor eindgebruiker. Stabiliteit en correctheid verbeteren.
**Volgorde:** Eerst uitvoeren — clean codebase voor de grote migratie.
**Risico:** Laag. Kleine geïsoleerde fixes.

**A) Memory leak: `snapshotLastSaved` groeit onbeperkt**

Bij elke code-update wordt een entry toegevoegd aan `snapshotLastSaved` (Map). Wanneer een sessie sluit of een leerling verwijderd wordt, worden die entries nooit verwijderd. Bij intensief gebruik over meerdere weken stapelt dit op.

Fix: bij `teacher_close_session`, `teacher_delete_session` en bij leerling-verwijdering alle entries met prefix `sessionCode:` verwijderen uit de Map. Tevens een periodieke cleanup toevoegen (elke 30 minuten) die verouderde entries verwijdert van gesloten/verwijderde sessies.

**B) Timer `clearInterval` ontbreekt bij sessie sluiten**

Bij `teacher_close_session` en `teacher_delete_session` wordt `session.timerInterval` niet gecleaned. De interval blijft elke seconde draaien en probeert events te sturen naar een gesloten sessie. Fix: `clearInterval(session.timerInterval)` toevoegen aan beide handlers, identiek aan hoe `teacher_stop_timer` het doet.

**C) CSRF-token wordt nooit meegestuurd door de frontend**

De `csrf_token` cookie wordt correct gezet bij login maar de frontend stuurt de `X-CSRF-Token` header nooit mee bij API-calls. De token-laag is daardoor dode code — enkel de Origin/Referer check werkt. Twee opties:

- **Optie 1 (aanbevolen):** CSRF-token lezen uit cookie in `app.js` en meesturen als header bij alle `fetch` calls naar beveiligde endpoints. Één centrale `apiFetch()` wrapper schrijven.
- **Optie 2:** Token-check weghalen en enkel vertrouwen op `SameSite=Strict` + Origin-validatie. Minder diepgaande beveiliging maar eerlijker dan dode code.

**D) Annotatie tab-isolatie** *(toegevoegd na observatie)*
Annotaties zijn enkel relevant op het Klascode-tabblad. Ze lekten echter door naar Mijn werkblad en soms naar Klascode bij verkeerde timing. Fix:
- `window._savedAnnotations` array bijhouden met alle annotaties van de sessie
- Bij tab-wissel naar 'personal': decoraties wissen uit de editor-instantie
- Bij tab-wissel terug naar 'shared': decoraties herstellen vanuit `_savedAnnotations`
- `annotation_added` tekent decoraties enkel als de leerling op 'shared' staat; anders enkel opslaan + toast
- `annotations_cleared` wist zowel de decoraties als `_savedAnnotations`

**E) History: betere foutmeldingen + tabel-diagnose**
`alert('Fout bij laden history.')` vervangen door specifieke meldingen:
- 404: leerling niet gevonden
- 500 met "no such table": instructie om `docker compose restart web` uit te voeren
- Lege snapshots: uitleg dat typen snapshots genereert na 10 seconden
- Netwerkfout: foutmelding met details

**F) check-deployment.sh bijwerken**
Checks toevoegen voor de fixes in A, B, C, D en E.

---

### Sprint 10 — UX verbeteringen vóór migratie *(~1 dag)*

**Impact:** Zichtbaar voor leerkrachten. Verbetert examengebruik significant.
**Volgorde:** Na sprint 9. Vóór sprint 12a — wordt complexer na de PostgreSQL-migratie.

**A) Annotaties — gedrag per modus**

**Klasmodus:** blijft zoals nu. "📌 Annoteer"-knop staat in de editor toolbar. Annotatie gaat naar alle leerlingen tegelijk op de gedeelde code. Correct gedrag — iedereen werkt aan dezelfde regels.

**Examenmodus:** elke leerling heeft andere code op andere regels — naar iedereen tegelijk annoteren is zinloos.

Oplossing:
- "📌 Annoteer"-knop is **verborgen** in examenmodus zolang er geen leerling geselecteerd is
- Knop verschijnt **enkel** wanneer de leerkracht bij een leerling op "Live control" klikt
- Annotatie gaat dan **enkel naar die ene leerling** (`targetStudentId` meegeven)
- Toolbar toont de naam van de geselecteerde leerling: `[📌 Annoteer voor Emma]`
- Bij wisselen naar andere leerling: annotaties van vorige verborgen, nieuwe getoond
- "✕ Annotaties wissen" wist enkel de annotaties van de geselecteerde leerling

Toolbar visueel:
```
Klasmodus:
[Run] [📎 Voorbeeld] [📌 Annoteer] [✕ Voorbeeld]

Examenmodus — geen leerling geselecteerd:
[Run]

Examenmodus — Live control bij Emma:
[Run] [📌 Annoteer voor Emma] [✕ Annotaties wissen]
```

Wijzigingen in server.js: `teacher_send_annotation` event uitbreiden met optioneel `targetStudentId`. Als aanwezig → enkel naar die socket; afwezig → naar hele room (klasmodus). Geen breaking change voor bestaande klasmodus-flow.

Nieuw socket event: `teacher_send_annotation_to_student` met `{ studentId, startLine, endLine, message, color }`.

Geschatte extra implementatietijd bovenop bestaande sprint 10A planning: ~1 uur.

**B) Annotatie per stuk verwijderen**

Huidig: enkel "✕ Wis alle". Elke annotatie krijgt een uniek `id` (al aanwezig in het server-object). In de annotatie-floating-panel een lijst van verstuurde annotaties tonen met per annotatie een "✕"-knopje.

Nieuw socket event: `teacher_remove_annotation` met `{ annotationId }`. Server verwijdert uit `session.annotations` array en stuurt `annotation_removed` naar leerlingen.

**C) Sessie-export uitbreiden**

De huidige `.txt` export toont enkel "X keer tab verlaten". Uitbreiden met:
- Tijdstip van elke tab-verlating + duur
- Tijdstip eerste run en laatste run
- Aantal snapshots (proxy voor activiteit)
- Totale schrijftijd (eerste snapshot → laatste snapshot)

**D) Monitoring: waarschuwing bij hoge belasting tijdens les**

In `teacher-app.html` — runner-statusbalk uitbreiden. Als actieve runs > 12 (67% van max 18): oranje banner "⚡ Runner is zwaar belast — wacht even voor je Run all klikt". Als > 16: rode banner. Banner verdwijnt automatisch als belasting daalt.

Data is al beschikbaar via `GET /api/monitoring` — enkel client-side check toevoegen.

**E) check-deployment.sh bijwerken**
Checks voor annotatie per leerling, annotatie verwijderen, export uitbreiding, monitoring banner.

---

### Sprint 11 — Kleine features & polish *(~1 dag)*

**Impact:** Mix van zichtbare UX-verbeteringen en technische polish.
**Volgorde:** Na sprint 10. Laatste sprint voor de grote migratie.

**A) Dark mode: custom gutter correctie**

De custom gutter (regelnummers naast Monaco) heeft hardcoded kleuren (`#071737`, `#9fb3c8`). In dark mode steekt dit er lelijk uit — de gutter heeft een donkerblauwe achtergrond die niet overeenkomt met het dark mode kleurenpalet.

Fix: gutter CSS-kleuren vervangen door CSS-variabelen (`var(--surface)`, `var(--muted)`). Monaco `editorGutter.background` kleur aanpassen op basis van huidig thema bij toggle.

**B) Sessie-archief: gesloten sessies bekijken**

Gesloten sessies verdwijnen nu volledig uit het overzicht. De data zit in SQLite maar er is geen UI. In `teacher-sessions.html` een toggle "Toon gesloten sessies" toevoegen (standaard verborgen). Gesloten sessies worden grijs weergegeven met slotje-icoon, enkel "Export"-knop beschikbaar (geen "Open" of "Verwijderen").

Nieuw endpoint: `GET /api/sessions?includeClosed=true` — retourneert ook gesloten sessies.

**C) Leerling ziet eigen code-history**

Via de bestaande `GET /api/sessions/:code/history/:studentId` endpoint (al aanwezig) kan een leerling zijn eigen snapshots opvragen. In `student-app.html` een knop "📜 Mijn history" toevoegen die de bestaande `showHistoryPlayback` modal opent met de eigen snapshots. Leerkracht heeft geen actie nodig.

Vereist: leerling-sessie-ID beschikbaar in `localStorage` (al aanwezig als `studentId`).

**D) Runner-wachtrij visueel bij leerling**

Als een run in de wachtrij staat, ziet de leerling nu enkel "Run staat in wachtrij (positie X)". Uitbreiden met een animatie (pulserende stip) en een schatting van de wachttijd op basis van de gemiddelde run-duur van de afgelopen 5 runs.

**E) Autocheck dagelijkse resultaten zichtbaar in teacher-sessions**

De autocheck loopt elke ochtend om 06:00 maar het resultaat is enkel zichtbaar in `monitoring.html`. In `teacher-sessions.html` een kleine badge toevoegen rechtsboven: groen vinkje als laatste autocheck geslaagd, rood kruisje als gefaald, met tijdstip. Klikken opent `monitoring.html`.

**F) check-deployment.sh bijwerken**
Checks voor dark mode gutter, sessie-archief endpoint, leerling history knop, autocheck badge in teacher-sessions.

---

### Sprint 12a — PostgreSQL + Monaco bundelen *(~2 dagen)*

**Impact:** Architectuurmigratie. Eindgebruiker merkt niets. Hoogste risico van alle sprints.
**Volgorde:** Na sprint 11 volledig stabiel. Eerst 24u stabiliseren voor 12b te starten.
**Risico:** Hoog — driver-wissel raakt alle database-queries.

**A) PostgreSQL Docker service**
`postgres:16-alpine` toevoegen aan `docker-compose.yml`. Persistent volume op `/volume3/docker/pycodeflow/pgdata`. Health check via `pg_isready`. `DATABASE_URL=postgresql://pycodeflow:wachtwoord@postgres:5432/pycodeflow` in `.env`. `depends_on: postgres` toevoegen aan web service.

**B) Database driver wisselen**
`better-sqlite3` → `pg` met connection pool (`pg.Pool`). Alle queries herschrijven: synchrone SQLite → async/await PostgreSQL. Parameternotatie: `?` → `$1, $2, ...`. `database.js` volledig herschrijven met async methodes. `server.js`: alle `dbModule.*` aanroepen awaiten.

**C) Migratescript `scripts/migrate-sqlite-to-pg.js`**
Exporteert `teachers`, `sessions`, `code_snapshots` uit SQLite. Importeert in PostgreSQL in correcte volgorde. Verifieert row counts voor en na. Rollback-instructie als migratie mislukt. SQLite blijft ongewijzigd als fallback.

**D) Monaco bundelen via Vite/esbuild**
Vite build stap toevoegen aan web `Dockerfile`. Monaco AMD CDN-loader → ESM bundle. Output naar `web/public/monaco-bundle/`. Verwachte winst: 40–60% snellere initiële laadtijd.

**E) check-deployment.sh**
PostgreSQL container, `DATABASE_URL`, psql-verbinding, migratescript aanwezig, Monaco bundle aanwezig.

**Testprocedure na sprint 12a:**
1. `bash check-deployment.sh` → 0 fouten
2. Sessie aanmaken, leerling joinen, code runnen
3. Server herstarten → sessies hersteld uit PostgreSQL
4. Stresstest: gezondheidscheck + runner capaciteit
5. 24u monitoren voor sprint 12b te starten

---

### Sprint 12b — Admin-pagina: leerkrachten & klassen *(~3 dagen)*

**Impact:** Enkel zichtbaar voor systeembeheerder.
**Volgorde:** Na 12a volledig stabiel.

**A) Nieuwe pagina `/admin.html`**
Drie tabbladen: **Leerkrachten** / **Klassen** / **Leerlingen** (leerlingen in sprint 12c). `monitoring.html` krijgt enkel een knop "→ Gebruikersbeheer".

Twee toegangsniveaus:
- **Leerkracht** — ziet enkel eigen klassen en leerlingen daarin
- **Admin** — ziet en beheert alles

Een leerkracht kan tijdelijk admin-rechten activeren via "Admin-modus activeren" (vraagt admin-wachtwoord). Blijft actief voor de duur van de browsersessie.

**B) Database uitbreiden**
```sql
ALTER TABLE teachers ADD COLUMN role TEXT DEFAULT 'teacher';
-- 'teacher' | 'admin'

CREATE TABLE classes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  school_year TEXT NOT NULL DEFAULT '2025-2026',
  archived    BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE teacher_classes (
  teacher_id TEXT REFERENCES teachers(id) ON DELETE CASCADE,
  class_id   TEXT REFERENCES classes(id) ON DELETE CASCADE,
  PRIMARY KEY (teacher_id, class_id)
);
```

**C) Tabblad Leerkrachten** (enkel admin)
Lijst: gebruikersnaam, weergavenaam, rol, laatste login.
Acties: **Nieuw**, **Wachtwoord resetten**, **Rol wijzigen** (teacher↔admin), **Verwijderen** (enkel als geen actieve sessies).

**D) Tabblad Klassen**
Lijst: naam, schooljaar, aantal leerlingen, gekoppelde leerkrachten, status.
Acties: **Nieuwe klas**, **Leerkrachten koppelen**, **Archiveren**, **Verwijderen** (enkel als leeg).

**E) check-deployment.sh**
`/admin.html` aanwezig, `role` kolom, `classes` en `teacher_classes` tabellen.

---

### Sprint 12c — Admin-pagina: leerlingenbeheer *(~3 dagen)*

**Impact:** Zichtbaar voor systeembeheerder en leerkrachten.
**Volgorde:** Na 12b.

**A) Database leerlingen**
```sql
CREATE TABLE students (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  class_id   TEXT REFERENCES classes(id) ON DELETE SET NULL,
  status     TEXT DEFAULT 'active',
  -- 'active' | 'pending' | 'blocked'
  source     TEXT DEFAULT 'manual',
  -- 'manual' | 'csv' | 'google' | 'smartschool'
  created_at TIMESTAMPTZ DEFAULT now(),
  last_seen  TIMESTAMPTZ,
  notes      TEXT DEFAULT ''
);

CREATE INDEX idx_students_class ON students(class_id);
CREATE INDEX idx_students_name  ON students(name);
CREATE UNIQUE INDEX idx_students_name_class
  ON students(name, class_id) WHERE class_id IS NOT NULL;
```

**B) Tabblad Leerlingen**
Twee weergaves: per klas (leerkracht) en alle leerlingen (admin). Kolommen: naam, klas, status, bron, laatste sessie.

Acties per leerling: **✓ Bevestigen**, **✕ Blokkeren**, **↩ Deblokkeren**, **→ Klas wijzigen** (leerkracht: eigen klassen; admin: alle), **🗒 Notitie**, **Verwijderen**.

**C) CSV-import leerlingen**
Knop "📥 CSV-import". Formaat: `naam,klas` per rij.

Verwerkingslogica:
1. Klas opzoeken op naam → optie "Automatisch aanmaken" indien niet gevonden
2. Naam + klas al in DB → overslaan met melding
3. Naam in andere klas → keuze overslaan of verplaatsen
4. Nieuw → toevoegen als `active`, source `csv`

Rapport: X toegevoegd, Y overgeslagen, Z klassen aangemaakt, W fouten.

**D) check-deployment.sh**
`students` tabel, unieke index, CSV-import endpoint.

---

### Sprint 12d — Klas-dropdown + zachte toegangscontrole *(~3 dagen)*

**Impact:** Zichtbaar voor leerlingen (dropdown), leerkrachten (badges) en admins.
**Volgorde:** Na 12c.

**A) Klas-dropdown op joinen-pagina's**
Op `student-start.html` en `free-editor.html`: vrij tekstveld "klas" → dropdown via `GET /api/classes` (publiek endpoint).

```
— Geen klas / Gast —   ← standaard
6A Informatica
6B Informatica
5A
...
```

Enkel niet-gearchiveerde klassen. Lege DB → vrij tekstveld als fallback. Vorige keuze in `localStorage`.

**B) Duplicaat-detectie bij joinen**
Server controleert of naam al actief is in deze sessie:
- Uniek → normaal joinen
- Duplicaat → melding: *"Er is al iemand met de naam 'Emma' in deze sessie. Voeg je initialen of achternaam toe, bijv. 'Emma J.' of 'Emma Janssens'."*

**C) Toegangslogica bij joinen**

| Situatie | Toegang | Badge leerkracht |
|---|---|---|
| Naam in klas, status `active` | ✅ Direct | — |
| Naam in klas, status `pending` | ✅ Direct | ⏳ In afwachting |
| Naam in klas, status `blocked` | ❌ Geweigerd | — |
| Naam niet in klas | ✅ Direct + `pending` | ⚠️ Nieuw |
| Klas = "— Geen klas / Gast —" | ✅ Direct | 👤 Gast |

Leerlingen worden **nooit live geblokkeerd** tijdens een sessie.

**D) Leerkracht: onbevestigde leerlingen beheren vanuit de sessie**

Badges: **⚠️ Nieuw** (oranje), **⏳ Afwachting** (geel), **👤 Gast** (grijs).

Inline acties in de leerlingenrij (geen navigatie naar admin nodig):
- **✓ Aanvaarden** — `pending` → `active`, badge verdwijnt, leerling blijft verbonden
- **→ Klas** — dropdown eigen klassen, live bijgewerkt
- **✕ Blokkeren** — geldt bij volgende join-poging, niet live

Wijzigingen onmiddellijk opgeslagen in DB.

**E) check-deployment.sh**
`/api/classes` endpoint, dropdown in student-start en free-editor, duplicaat-detectie, badges in app.js.

---

### Sprint 12e — Google OAuth leerlingen *(~3 dagen)*

**Impact:** Leerlingen kunnen optioneel inloggen met schoolaccount. Naam+klas blijft als fallback.
**Volgorde:** Na 12d.

**A) Google OAuth setup**
`passport` + `passport-google-oauth20`. Callback: `https://app.pycodeflow.org/auth/google/callback`. Enkel `@leerling.atheneumhoboken.be` en `@atheneumhoboken.be` domeinen.

**B) Login-flow leerling**
`student-start.html` — twee opties:
```
┌─────────────────────────────────────┐
│  🔵 Doorgaan met Google             │
│  (voor leerlingen met schoolaccount)│
├─────────────────────────────────────┤
│  of joinen als gast                 │
│  Naam: [__________]                 │
│  Klas: [dropdown ▼]                 │
│  [Deelnemen]                        │
└─────────────────────────────────────┘
```

**C) Koppelingslogica**
1. Email in `students.google_email` → directe toegang
2. Email `blocked` → geweigerd
3. Niet gevonden → nieuw record: naam uit Google-profiel, klas NULL, status `pending`

```sql
ALTER TABLE students ADD COLUMN google_email TEXT UNIQUE;
ALTER TABLE students ADD COLUMN google_sub   TEXT UNIQUE;
```

**D) check-deployment.sh**
`passport-google-oauth20` in package.json, `GOOGLE_CLIENT_ID` en `GOOGLE_CLIENT_SECRET` in `.env`, routes `/auth/google` en callback, kolommen in students.

---

### Sprint 12f — Smartschool SSO *(~1 week, optioneel)*

**Impact:** Automatische klassenkoppeling via Smartschool.
**Volgorde:** Na 12e. Pas starten na afstemming met ICT-coördinator.
**Risico:** Afhankelijk van externe partij.

**Voorbereiding:**
- Aanvraag Smartschool OAuth via schoolbeheerder
- Afspreken welke data meekomt (naam, klas, rol)
- Testen in Smartschool sandbox

**A) Integratie**
Custom OAuth2 strategy. Callback: `https://app.pycodeflow.org/auth/smartschool/callback`. Token bevat: naam, klas, rol.

**B) Automatische klassenkoppeling**
Klas uit token → opzoeken in `classes` → koppelen (status `active`). Geen handmatige goedkeuring — Smartschool is bron van waarheid.

**C) Leerkrachten via Smartschool**
Parallel naast wachtwoordsysteem.
```sql
ALTER TABLE teachers ADD COLUMN smartschool_email TEXT UNIQUE;
ALTER TABLE students ADD COLUMN smartschool_email TEXT UNIQUE;
```

---

### Openstaande kleine items *(tussendoor)*

| Item | Prioriteit | Inschatting | Wanneer |
|---|---|---|---|
| Klassenarchief begin schooljaar | 🟡 Medium | 2 uur | Na 12b |
| Leerling ziet eigen code-history | 🟡 Medium | 1 uur | Sprint 11C |
| Autocheck badge in teacher-sessions | 🟢 Laag | 1 uur | Sprint 11E |

---

### Nice to haves *(na alle sprints)*

- Real-time samenwerkingscursors (Google Docs-stijl)
- Mobiel-vriendelijke editor (CodeMirror 6 als fallback < 768px)
- PDF-export leerling-voortgang (`puppeteer` of `pdfkit`)
- Webhook notificaties bij gefaalde autocheck (Slack/e-mail)
- Klassenarchief per schooljaar met historische sessie-data
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

## 11. Changelog

### v2026.2.6.1 — database.js duplicate crypto fix
Dubbele `const crypto = require('crypto')` verwijderd uit `database.js` — crashte de server bij opstarten.

### v2026.2.6.0 — Sprint 8: technische fundering
- **SQLite code_snapshots** tabel + `saveSnapshot`, `getSnapshots`, `deleteSnapshotsForSession`
- **Code history playback** — 📜 History-knop per leerling, modaal met tijdlijnschuif + play/pauze
- **Secundaire leerkrachtsrol** — 👁 Waarnemen-knop, `teacher_join_as_observer` handler
- **Runner API integratietest** — 4 deeltests als stresstest type `runner-api`
- **Annotatie fixes** — `window.monaco` fix, toast bij verkeerd tabblad, restore bij reconnect

### v2026.2.5.0 — Sprint 7: UI fixes & onderwijs features
- **Slider layout fix** monitoring.html
- **Templates** — 9 Python-oefeningstemplates, dropdown bij sessie-aanmaak
- **Dark mode** — `data-theme="dark"`, Monaco `vs-dark`, voorkeur in localStorage
- **run_error event** — gestructureerd {errorType, message, line} met rood icoon
- **Leerkrachtannotatie** — 📌 Annoteer-knop, floating panel, Monaco decoraties bij leerlingen

### v2026.2.4.3 — WebSocket stresstest bugfixes
- `classCanRun: false` blokkeerde runs → wegwerpsessies nu in exam mode
- `workspace: 'shared'` → `'personal'` in exam mode
- `run_output` streaming handler: accumuleren + wachten op `run_end`

### v2026.2.4.2 — Stresstest bugfixes
- `validTypes` uitgebreid met alle nieuwe testmodi
- Wegwerpsessies direct server-side aanmaken (geen socket auth nodig)
- Sliders standaard verborgen bij paginaladen

### v2026.2.4.1 — Sprint 6 voltooiing
- `testWebSocketLoad`, `testHttpBenchmark`, `testRateLimitVerification` functies
- `socket.io-client` npm dependency
- `check-deployment.sh` uitgebreid met alle sprint features

### v2026.2.4.0 — Sprint 6: beveiliging & stresstest
- IP rate limiting vrije editor (20/min per IP)
- `GET /health` web container endpoint
- CSRF-bescherming op kritieke POST endpoints
- Runner `preexec_fn` rlimits (fd, fsize, nproc)
- Auditlog vrije sessie (`logs/free-audit.log`)
- `nextRevision()` — revisie race condition fix
- Stresstest: ramp-up, sustained load, memory leak, aangepaste test + sliders

### v2026.2.3.0 — Sprint 5: UX verfijning
- Aankondigingen chip-grid (i.p.v. verticale lijst)
- ✓ Klaar-knop voor leerlingen + leerkracht reset per leerling / iedereen
- 💾 Autosave indicator
- Voortgangsindicator (online · klaar · ✋ · tab weg)
- 📎 Snippet broadcasten als read-only voorbeeld

### v2026.2.2.2 — Sprint 4 bugfixes
- Hand: dubbele event listener verwijderd
- Timer: page guard toegevoegd
- Aankondiging: data-idx i.p.v. data-text (escaping fix)
- Filter: renderStudentList herbruikbaar gemaakt

### v2026.2.2.0 — Sprint 4: kwaliteit & UX
- ✋ Hand opsteken
- Aankondigingsgeschiedenis (laatste 5)
- Syntaxcheck via `ast.parse()` (Monaco decoraties, 800ms debounce)
- Auto-refresh sessieoverzicht + ↻ refresh-knop met timestamp
- Monitoring historiek ringbuffer + Canvas grafiek
- Reconnect vrije sessie via localStorage

### v2026.2.1.0 — Sprint 3: examengereedheid
- ⬇ Export sessie als .txt
- Tab-detectie in examenmodus (badge, teller, duur)
- Ctrl+Enter shortcut voor Run
- run_end feedback bij lege output

### v2026.2.0.0 — Sprint 2: SQLite + leerkrachtenlogin DB
- SQLite persistentie (sessions + teachers tabellen)
- Leerkrachtenlogin uit .env → database
- `manage-teacher.js` CLI-tool
- `migrate-env-to-db.js` eenmalig migratiescript

### v2026.1.38.0 — Sprint 1: rate limiting & logout
- Run rate limiting (3s per socket)
- Logout-knop voor leerkrachten

### v2026.1.37.0 — Monitoringpagina
- `monitoring.html` apart systeembeheerscherm
- `GET /api/monitoring` endpoint

### v2026.1.36.0 — Vrije editor
- Leerlingen oefenen Python zonder sessiecode
- Vrije sessie sectie in teacher-sessions.html

### v2026.1.35.8 — Custom login overlay
- Native browser-popup vervangen door custom `teacher-login.html`

### v2026.1.35.7 — Cursor-stabiliteit
- Cursor springde terug bij individueel werken → `schedulePersist` + cursorpositie bewaren

---

*PyCodeFlow · Atheneum Hoboken · v2026.2.7.13*

---

### v2026.2.7.13 — Definitieve fix: runner weigert input als niet wachtend

**Architecturale fix op runner-niveau**

Alle vorige fixes zaten op de client of de Node.js server. De runner zelf had geen bescherming — hij accepteerde elke `POST /runs/:id/input` zolang `running=True`, ook als hij niet wachtte op stdin.

**Fix in `runner/app.py`:**
```python
# Nieuw: weiger input als runner niet wacht op stdin
if not run.get('waiting_for_input', False):
    return jsonify({'ok': False, 'reason': 'not_waiting'}), 409
```

HTTP 409 Conflict = runner is draaiende maar wacht niet op input.

**Fix in `server.js`:**
`runnerInput()` herkent 409 en retourneert `{ rejected: true }`. De caller (free en student handler) zet bij een 409 de runId **terug in de `runnerWaitingForInput` Set** en keert terug zonder echo of statusupdate. De volgende echte `input_request` van de runner activeert het inputveld opnieuw.

Dit is de correcte aanpak: de runner is de bron van waarheid voor of hij wacht op input. Geen client-side vlaggen, geen timing-afhankelijke guards.

**Betrokken bestanden:** `runner/app.py`, `web/server.js`, `web/public/app.js`

---

### v2026.2.7.12 — Ghost keypress via knop-click + poll timing

**Oorzaak 1: ghost keypress triggerde click op de knop**

`freeSendInput(false)` via de click-handler had geen `_freeUserTyped` check. Ghost keypresses triggeren niet alleen `keyup` op het inputveld maar ook `click` op de gefocuste knop. Die click haalde `freeSendInput(false)` aan zonder de gebruiker-check.

Fix: `_freeMouseClick` vlag via `mousedown` event. `mousedown` vuurt enkel bij echte muiskliks, nooit bij keyboard events. `freeSendInput()` vereist nu `_freeUserTyped` (echt typen) OF `_freeMouseClick` (echte muisklik).

**Oorzaak 2: 500ms poll-delay gaf ghost keypress tijd om door te glippen**

De poll-delay van 500ms tijdens input-wacht gaf de browser 500ms om een ghost event te verwerken. Teruggezet naar 180ms.

**Betrokken bestanden:** `web/server.js`, `web/public/app.js`

---

### v2026.2.7.11 — Tweede input lege string: _freeUserTyped guard

**Definitieve oorzaak:** `focus()` in `enableInput()` triggert op sommige browsers (Chrome/Chromebook) een `keyup Enter` event als de Enter-toets nog fysiek ingedrukt is op het moment van de focus-call. Het inputveld is leeg (`value = ''`) want `enableInput()` wist het veld. `stopPropagation()` helpt niet — dit is een nieuw event dat direct op het element gestart wordt, niet gebubbled.

**Fix: `_freeUserTyped` vlag**

```js
let _freeUserTyped = false;

// Wordt true zodra gebruiker echt iets typt:
input.addEventListener('input', () => { _freeUserTyped = true; });

// Via keyup (Enter): enkel verzenden als gebruiker echt getypt heeft
function freeSendInput(viaKeyup = false) {
  if (viaKeyup && !_freeUserTyped) return; // ← blokkeert ghost keypress
  ...
}

// Via knop-klik (muis): altijd verzenden (bewuste actie)
btn.addEventListener('click', () => freeSendInput(false));
```

Het `input` event vuurt **alleen** bij echte gebruikersinput (typen, plakken, wissen) — nooit bij programmatische `value = ''` of bij `focus()`. Dit maakt het onderscheid perfect: een ghost Enter wordt geblokkeerd, maar een echte Enter na typen wordt altijd doorgelaten.

Bij `free_input_request` worden beide vlaggen gereset (`_freeInputSent = false`, `_freeUserTyped = false`).

**Betrokken bestanden:** `web/server.js` (debug logging opgeruimd), `web/public/app.js`

---

### v2026.2.7.10 — Definitieve fix: tweede input() geblokkeerd door free_run_end

**Oorzaak gevonden via client-side debug logging**

De logging toonde exact:
```
[DBG-CLIENT] free_input_request ontvangen  ← tweede input() correct aangekondigd
[DBG-CLIENT] disableInput(free) vanuit lijn 1089 (free_run_end)  ← daarna direct gedisabled
[DBG-CLIENT] 100ms na enableInput: input.disabled=true  ← veld terug disabled
```

`free_run_end` werd gestuurd **na** de tweede `input_request` — terwijl de runner nog wachtte op stdin. Dit gebeurde omdat de poll-loop de `!evData.running` check deed op het moment dat de runner de events had verwerkt (stdout na eerste input + tweede input_request) maar de `running` vlag tijdelijk `false` was tussen twee poll-cycli.

**Fix: `!evData.running` check uitgebreid met `runnerWaitingForInput` gate**

```js
// Oud — stopte run ook als runner wacht op input:
} else if (!evData.running) {
  socket.emit("free_run_end");

// Nieuw — stopt enkel als runner NIET in de wacht-Set staat:
} else if (!evData.running && !runnerWaitingForInput.has(student.runId)) {
  socket.emit("free_run_end");
} else if (runnerWaitingForInput.has(student.runId)) {
  await new Promise(r => setTimeout(r, 500)); // langzamer pollen tijdens input-wacht
}
```

Dezelfde `runnerWaitingForInput` Set die de gate bewaakt wordt nu ook gebruikt om `free_run_end` te blokkeren zolang de runner wacht op stdin.

**Betrokken bestanden:** `web/server.js`, `web/public/app.js` (debug logging verwijderd)

---

### v2026.2.7.9 — Inputveld verdwijnt meteen: drie bijkomende fixes

**Analyse:** het inputveld lichtte even op maar verdween meteen. De server-side gate (`runnerWaitingForInput`) werkte correct — het probleem zat volledig client-side.

**Fix 1 — Event bubbling: `stopPropagation()`**
Het `keyup Enter` event in het inputveld bubbelde naar parent elementen. Andere event listeners op het document konden zo reageren op de Enter-toets en onverwachte side-effects veroorzaken. `e.stopPropagation()` toegevoegd aan alle input `keyup` handlers (vrije editor, student-app).

**Fix 2 — `free_session_state` disablet input tijdens actieve run**
`socket.on('free_session_state')` riep altijd `disableInput('free')` aan — ook als er een actieve run bezig was met een open `input()` aanroep. Nieuwe `_freeRunActive` vlag toegevoegd: `disableInput` wordt enkel aangeroepen als er geen actieve run is. De vlag wordt `true` bij run-start en `false` bij `free_run_end`.

**Fix 3 — Debug logging verwijderd uit client**

**Betrokken bestanden:** `web/public/app.js`

---

### v2026.2.7.8 — Enter-toets blijft hangen: keyup fix

**Oorzaak: key repeat + verkeerd event type**

Twee samenhangende problemen:

**Probleem 1 — `keydown` vuurt bij ingedrukte toets meerdere keren**
Browsers sturen `keydown` events in rapid succession zolang een toets ingedrukt blijft (key repeat, typisch ~30ms interval). De eerste `keydown` verstuurde de input en zette `_freeInputSent = true`. De tweede `keydown` (~30ms later) vond `_freeInputSent` nog `true` en werd geblokkeerd. Maar zodra de guard gereset werd door de volgende `input_request`, kon een lopende key repeat alsnog een lege string sturen.

**Probleem 2 — Ghost keypress bij focus**
`keydown` staat al in de event queue terwijl het inputveld focus krijgt.

**Fix: `keydown` → `keyup`**
`keyup` vuurt **exact één keer** per toetsaanslag — nooit bij key repeat, nooit als ghost keypress bij focus. Dit is de correcte manier om een formulier te verzenden met Enter in webapplicaties met responsieve state.

Geldt voor vrije editor, student-app en leerkracht-input.

**Betrokken bestanden:** `web/public/app.js`

---

### v2026.2.7.7 — Tweede input(): guard blokkeerde echte invoer

**Oorzaak gevonden via server-side debug logging**

De logging bewees: de server ontving de tweede `input_request` correct, voegde de runId toe aan `runnerWaitingForInput`, en stuurde `free_input_request` naar de client. Maar er kwam **nooit** een tweede `free_runtime_input` van de client.

De `_freeInputSent` guard werd na 200ms gereset via `setTimeout`. Maar de tweede `input_request` arriveert al na ~50ms (één poll-cyclus). De leerling typte en drukte Enter — maar de guard was nog `true` → geblokkeerd.

**Fix:** `_freeInputSent` en `_studentInputSent` worden nu **onmiddellijk** gereset wanneer `input_request` binnenkomt. Ghost keypresses worden al geblokkeerd door de `btn.disabled` check in de keydown handler — die delay was overbodig. Focus-delay teruggebracht van 150ms naar 50ms voor betere UX.

**Betrokken bestanden:** `web/server.js` (debug logging verwijderd), `web/public/app.js`

---

### v2026.2.7.6 — Definitieve fix: tweede input() lege string

**Architecturale fix — server-side gate op basis van runner-state**

Alle vorige fixes (client-side guards, focus-delay, disabled-check) pakten het symptoom aan maar niet de oorzaak. De runner zelf weet wanneer hij op stdin wacht via de `waiting_for_input` vlag. De server wist dit niet en stuurde elk input-event blindelings door.

**Oorzaak:** wanneer de leerling Enter drukt voor de eerste invoer, verwerkt de runner die invoer, produceert output (`Welkom sdfs`), en vraagt meteen de tweede `input()`. Dit alles gebeurt in minder dan 180ms (één poll-cyclus). De server stuurt in dezelfde cyclus de echo + de tweede `input_request`. Op de client wordt het inputveld geactiveerd. Een ghost keypress (Enter nog in de browser event queue) of een snelle tweede klik kan dan een lege string versturen — die de runner accepteert omdat `stdin.readline()` elke write accepteert, ook als de caller nog niets heeft ingetypt.

**Fix: `runnerWaitingForInput` Set in server.js**

Een globale `Set<runId>` bijhouden van runners die momenteel wachten op stdin:
- `input_request` event ontvangen van runner → `runnerWaitingForInput.add(runId)`
- `free_runtime_input` / `runtime_input` ontvangen van client → als `runId` **niet** in de Set staat: `return` (negeer de input volledig)
- Als `runId` wel in de Set staat: `delete(runId)` (één input per `input_request`), daarna verwerken
- `run_end` / fout → `delete(runId)` (cleanup)

Geldt voor alle drie modi: vrije editor, klassessie (student), klasrun (leerkracht).

**Aanvulling runner/app.py:** `waitingForInput: true/false` toegevoegd aan de events endpoint response (was niet aanwezig). Niet direct gebruikt door de huidige fix maar nuttig voor toekomstige debugging en monitoring.

**Betrokken bestanden:** `web/server.js`, `runner/app.py`

---

### v2026.2.7.5 — Ghost keypress fix: tweede input() lege string

**Echte oorzaak gevonden na grondige analyse**

De `_inputSent` guard uit v2026.2.7.4 blokkeerde dubbele klikken correct, maar niet het onderliggende probleem: een **ghost keypress**.

Volgorde van het probleem:
1. Leerling typt "Emma" en drukt Enter
2. `click()` handler vuurt: emit `runtime_input('Emma')`, `disableInput()` (veld geblokkeerd)
3. Server verwerkt Emma, runner vraagt tweede `input()`, server stuurt `input_request`
4. Client ontvangt `input_request` → `enableInput()` → `input.focus()`
5. Browser heeft nog een `keydown Enter` event in de queue (van stap 1)
6. Dat event valt op het net-gefocuste veld → `click()` → `val = ''` → emit `runtime_input('')`
7. Runner ontvangt lege string → `int('')` → ValueError

**Fix — drie lagen:**

`enableInput()`: focus niet onmiddellijk maar na 150ms `setTimeout`. Ghost keypresses die in de event queue zitten worden verwerkt terwijl het veld nog disabled is.

`keydown` handler: extra check `if (btn && !btn.disabled) btn.click()`. Zelfs als een ghost keypress het veld bereikt terwijl het disabled is, wordt de click genegeerd.

Guard reset: `_freeInputSent = false` en `_studentInputSent = false` worden na 200ms gereset (na de focus-delay van 150ms). Zo is er een window van 200ms na het activeren van het veld waarin elke poging tot verzenden geblokkeerd is.

**Betrokken bestanden:** `web/public/app.js`

---

### v2026.2.7.4 — Tweede input() lege string fix

**Bugfix — tweede `input()` stuurde automatisch een lege string**

Oorzaak: de knop-handler had geen bescherming tegen dubbele verzending. Wanneer de leerling op Enter drukte na de eerste invoer, werd de click() event getriggerd. Daarna:
1. Server stuurt echo + output direct terug
2. Pol pikt onmiddellijk de tweede `input_request` op
3. Client roept `enableInput()` aan — inputveld actief
4. Maar door de snelle event-volgorde (socket events zijn asynchroon) kon `socket.emit('runtime_input', ...)` een tweede keer gevuurd worden met een lege string voordat `_inputSent` guard actief was

Fix: `_freeInputSent` en `_studentInputSent` boolean guards toegevoegd. Na het versturen van input wordt de guard op `true` gezet. Pas wanneer de server een nieuwe `input_request` stuurt (= Python vraagt opnieuw om invoer) wordt de guard gereset op `false` en het inputveld opnieuw geactiveerd. Zo is het fysiek onmogelijk om twee keer input te sturen voor één `input()` aanroep.

Dezelfde fix toegepast op vrije editor (`free_input_request`), student-app (`input_request`) en leraar-preview.

**Betrokken bestanden:** `web/public/app.js`, `web/server.js`

---

### v2026.2.7.3 — Invoer-echo: alle modi + meerdere inputs

**Bugfix — echo werkte enkel in vrije editor, niet in klas/examenmodus**

Klasmodus gedeeld: `session.sharedOutput` werd niet bijgewerkt met de echo — leerlingen zagen de ingevoerde tekst niet.
Individuele/examenmodus: `s.output` en `s.personalOutput` werden niet bijgewerkt.
Fix: echo direct toegevoegd aan de juiste output-buffer per modus, gevolgd door een onmiddellijke `run_output` emit naar de juiste ontvanger(s).

**Bugfix — tweede `input()` toonde lege echo**

Oorzaak: de echo-buffer werd geleegd bij het eerste `stdout` event na de invoer. Maar de prompt van de tweede `input()` ("Geef een getal: ") is ook een `stdout` event — dat leegde de buffer al vóór de leerling iets kon typen. De buffer was dan leeg als de tweede invoer binnenkwam.

Fix: de `_echoBuffer` aanpak volledig vervangen door **directe invoeging** in de output-buffer op het moment van invoer. Geen buffer meer die geleegd moet worden — de echo staat onmiddellijk en permanent in `outputAccum`/`s.output`/`s.personalOutput`/`session.sharedOutput`.

Volgorde voor code met twee `input()` aanroepen:
```
Wat is je naam? 
[emma]
Hallo emma! Wat is je leeftijd?
[16]
Je bent 16 jaar oud.

===== Compiler klaar met runnen =====
```

**Vrije editor:** gebruikt nu `student._outputAccum` (persistente accumulator op het student-object) in plaats van een lokale variabele in de poll-loop. Reset bij elke nieuwe run. Echo en stdout staan altijd in de juiste volgorde.

**Betrokken bestanden:** `web/server.js`

---

### v2026.2.7.2 — Invoer-echo zichtbaar in output

**Bugfix — `[emma]` niet zichtbaar in de output**

Oorzaak: de echo werd client-side toegevoegd via `panel.textContent += '[emma]\n'`, maar de eerstvolgende `free_run_output` event stuurde de volledige gecumuleerde output van de server (`panel.textContent = output`) en **overschreef** daarmee de client-side echo.

Fix: de echo (`[waarde]`) wordt nu op de **server** in een `_echoBuffer` opgeslagen per student-object. Bij het verwerken van het volgende `stdout`/`stderr` event wordt de buffer eerst aan `outputAccum` (vrije editor) of `s.personalOutput`/`s.output` (klassessie) toegevoegd, vóór de nieuwe output. Zo zit de echo correct in de gecumuleerde output die naar de client gestuurd wordt en kan hij nooit overschreven worden.

De client-side echo handlers zijn vereenvoudigd naar no-ops.

**Betrokken bestanden:** `web/server.js`, `web/public/app.js`

---

### v2026.2.7.1 — Input bugfix + UX verbeteringen output

**Bugfix — `%s` verschijnt letterlijk in de output**

Oorzaak: de WRAPPER string werd samengesteld via string-concatenatie met `repr(NL_UITLEG)` (toegevoegd in v2026.2.7.0). De `NL_UITLEG` dictionary bevatte `%`-tekens in de Nederlandse uitlegteksten (bijv. `%s` als placeholder in de originele code). De `.replace('%s', MARKER)` aan het einde van de WRAPPER string vond dan niet de ene bedoelde `%s` (voor het input-signaal) maar ook alle `%`-tekens in de uitlegteksten, waardoor de vervanging mislukte of gedeeltelijk werkte.

Fix: de WRAPPER is volledig herschreven van `r'''...'''.replace('%s', MARKER)` naar Python string-concatenatie waarbij de MARKER direct als string-literal wordt ingevoegd (`'...' + MARKER + r'
")'`). Geen `.replace()` meer nodig — de MARKER staat altijd exact op de juiste plek.

**Gevolg van de `%s` bug:** `%s` verscheen letterlijk in de output (het input-signaal niet herkend) → runner wachtte niet op invoer → input-veld bleef op "Input unavailable" → code brak af.

**UX verbetering — ingevoerde tekst zichtbaar in output**
Wanneer een leerling iets ingeeft en op Enter drukt, wordt de ingevoerde waarde nu zichtbaar als `[waarde]` in de output. Lege invoer toont `[lege invoer]`. Dit geldt voor vrije editor én klassessie/examenmodus.

Voorbeeld output met `input("Wat is je naam? ")`:
```
Wat is je naam? 
[Emma]
Hallo Emma!

===== Compiler klaar met runnen =====
```

**UX verbetering — "Compiler klaar met runnen" bericht**
Na elke succesvolle uitvoering (inclusief `SystemExit`) toont de runner nu:
```
===== Compiler klaar met runnen =====
```
Dit maakt duidelijk wanneer de code volledig is uitgevoerd. Foutmeldingen tonen dit bericht niet (de error zelf is het signaal dat de code gestopt is).

**Betrokken bestanden:** `runner/app.py`, `web/server.js`, `web/public/app.js`

---

### v2026.2.7.0 — Sprint 9 volledig + Nederlandse foutuitleg

**Sprint 9A — Memory leak: `snapshotLastSaved` opgeruimd**
Cleanup toegevoegd bij `teacher_close_session` en `teacher_delete_session`: alle entries met prefix `sessionCode:` worden verwijderd. Timer-interval wordt ook gecleaned bij sessie-sluiting. Periodieke cleanup elke 30 minuten verwijdert entries van gesloten/verwijderde sessies.

**Sprint 9B — Timer cleanup bij leerkracht-disconnect**
Bij disconnect van de leerkracht-socket wordt `session.timerInterval` gecleaned en `timerRunning` op false gezet. Voorheen bleef de interval elke seconde draaien naar een gesloten sessie.

**Sprint 9C — CSRF-token frontend**
Nieuw `GET /api/csrf-token` endpoint (auth vereist). Centrale `apiFetch()` wrapper in `app.js` haalt het token éénmalig op en stuurt het mee als `X-CSRF-Token` header bij alle API-calls. Token gecached in `_csrfToken` variabele.

**Sprint 9D — Annotaties persisteren in SQLite**
Nieuwe `session_annotations` tabel (session_code PRIMARY KEY, annotations_json, updated_at). `saveAnnotations()` en `getAnnotations()` methodes in `database.js`. Bij elke `teacher_send_annotation` en `teacher_clear_annotations` wordt de huidige array opgeslagen. Annotaties meegegeven in `teacher_session_data` voor herstel na server-herstart.

**Nederlandse foutuitleg in de Python runner**
21 veelvoorkomende Python errors krijgen een Nederlandse uitleg die direct na de Engelse foutmelding verschijnt:
- De Engelse error blijft zichtbaar (leerdoel: leerling leert Engelse termen)
- Daarna een 💡-tip in het Nederlands met concrete uitleg en oplossingsrichting
- Implementatie: mapping-tabel `NL_UITLEG` in `runner/app.py`, geïnjecteerd in de `wrapper.py` sandbox
- `EOFError` bericht vertaald naar "Geen invoer ontvangen" (was Engelse tekst)

Voorbeeld output voor `ValueError: invalid literal for int() with base 10: ''`:
```
ValueError: invalid literal for int() with base 10: ''
💡 Je probeert tekst of een lege invoer om te zetten naar een getal (int).
   Typ een getal voor je op Enter drukt.
```

**v2026.2.6.5 bugfixes meegenomen:**
- Vrije editor run-knop vastgelopen (verkeerde run_error handler in poll-loop)
- Lege invoer waarschuwing bij student-app en vrije editor

**Betrokken bestanden:** `web/server.js`, `web/public/app.js`, `web/db/database.js`, `runner/app.py`

---

### v2026.2.6.5 — Vrije editor: run-knop vast + lege invoer waarschuwing

**Bug 1 — Vrije editor: run-knop reageert niet meer na een tijdje**

Oorzaak: tijdens het implementeren van het gestructureerde `run_error` event (sprint 7D) werd code van de klasse-sessie poll-loop per ongeluk ingeplakt in de vrije editor poll-loop. Die code refereerde aan variabelen die enkel in de klasse-sessie context bestaan (`info`, `session`, `session.students`) — bij een `run_error` event gooide JavaScript een `ReferenceError`, de poll-loop crashte, `free_run_end` werd nooit gestuurd, de Run-knop bleef geblokkeerd en het output-scherm toonde niets meer. Na een pagina-refresh was alles hersteld omdat de poll-loop opnieuw gestart werd.

Fix: de `run_error` handler in de vrije editor poll-loop herschreven zodat die enkel de error-data parset en als tekst toevoegt aan `outputAccum` — geen referenties naar klasse-sessie variabelen.

**Bug 2 — `ValueError: invalid literal for int() with base 10: ''`**

Dit is geen bug in PyCodeFlow maar correct Python-gedrag: als een leerling op Enter drukt zonder iets in te typen bij een `input()` aanroep, stuurt de browser een lege string. Python's `int('')` gooit dan een `ValueError`.

Verbeterd: bij het versturen van een lege invoer verschijnt nu een tijdelijke waarschuwing in het invoerveld: *"⚠️ Je stuurt een lege invoer — Python verwacht een waarde"*. De invoer wordt wel doorgestuurd (lege string is geldige Python-invoer voor `input()` zelf, enkel `int(input())` crasht). Zowel in de vrije editor als in de leerling-app.

**Betrokken bestanden:** `web/server.js`, `web/public/app.js`

---

### v2026.2.6.4 — History + annotatie tab-isolatie fixes

**Bugfix 1 — History: "Fout bij laden history"**
De `code_snapshots` tabel bestaat niet in de draaiende database als de server niet herstart is na de `database.js` update van sprint 8. Foutmelding verbeterd van generieke `alert()` naar specifieke meldingen per fouttype, inclusief instructie om `docker compose restart web` uit te voeren bij de "no such table" fout.

**Bugfix 2 — Annotatie-kleuren lekten naar Mijn werkblad**
Er is één Monaco editor-instantie voor alle tabs. `deltaDecorations` koppelt decoraties aan de editor-instantie, niet aan een specifieke tab. Daardoor waren annotaties (bedoeld voor de Klascode-tab) ook zichtbaar op het Mijn werkblad-tabblad.

Oplossing: `window._savedAnnotations` array bijhouden. Bij tab-wissel naar 'personal': decoraties verwijderen uit de editor. Bij tab-wissel terug naar 'shared': decoraties herstellen. `annotation_added` tekent decoraties enkel als de leerling op het Klascode-tabblad staat; anders worden ze opgeslagen voor later herstel.

**Betrokken bestanden:** `web/public/app.js`

---

### v2026.2.6.3 — Annotatiesysteem volledig hersteld

**Bugfix-release — 5 samenhangende bugs die het annotatiesysteem volledig braken**

**Bug 1 — CSS-klassen niet gedefinieerd (decoraties onzichtbaar)**
`annotation-highlight` en `annotation-inline-msg` werden als Monaco `className` en `inlineClassName` gebruikt maar waren nergens gedefinieerd in CSS. Monaco maakt de decoraties wel aan maar ze zijn volledig transparant/onzichtbaar. Opgelost: kleur-specifieke klassen toegevoegd aan `styles.css`: `annotation-highlight-yellow/blue/green/red`, `annotation-inline-msg`, `annotation-glyph`.

**Bug 2 — Verkeerde `className` in `deltaDecorations`**
De handler gebruikte `className: 'annotation-highlight'` (generiek, niet kleur-specifiek). Vervangen door `annotation-highlight-${color}` zodat elke kleur zijn eigen CSS-klasse heeft.

**Bug 3 — `applyAnnotationToEditor` ontbrak als herbruikbare functie**
De annotatie-logica stond gedupliceerd in de `annotation_added` handler én de reconnect-code, met subtiele verschillen. Samengevoegd in één `applyAnnotationToEditor(editor, ann)` functie die beide gebruikt. Reconnect wacht 500ms op Monaco-initialisatie via `setTimeout`.

**Bug 4 — Leerkracht zag eigen annotaties niet**
Na versturen verdween de annotatie uit het panel maar was niets zichtbaar in de editor van de leerkracht. Opgelost: na `socket.emit` wordt de annotatie ook lokaal in `editorStore.teacher` getekend via `deltaDecorations`. Toegevoegd: validatie (lege boodschap, ongeldige regelnummers), visuele feedback op de knop ("✓ Verstuurd" voor 2 seconden).

**Bug 5 — Toast niet klikbaar, geen navigatie naar Klascode**
De toast-notificatie bij leerlingen die niet op het Klascode-tabblad staan was statisch tekst. Nu klikbaar: klik op de toast → springt automatisch naar het Klascode-tabblad zodat de leerling de annotatie ziet.

**Betrokken bestanden:** `web/public/app.js`, `web/public/styles.css`

---

### v2026.2.6.2 — Cursor-reset fix individueel werkblad

**Bugfix — cursor sprong terug naar begin tijdens individueel werken**

Dit was de meest kritieke bug in het systeem — werken in het individueel werkblad was onmogelijk zodra de server een `student_state` stuurde.

**Oorzaak gevonden — twee samenhangende problemen:**

**Probleem 1 — `serverHasNewerPersonalCode` was altijd `true`**
`nextRevision()` gebruikt `Date.now()` als revisienummer. Bij elke `student_state` die binnenkwam was `newRevision > prevRevision` altijd waar, zelfs als de server gewoon de eigen code van de leerling terugstuurde (echo). Daardoor werd `localPersonalCode` op `undefined` gezet, de guard (`studentIsOwningPersonal`) faalde, en `model.setValue()` werd aangeroepen → cursor naar begin.

**Fix:** `serverIsEchoingOwnCode` check toegevoegd. Als `personalCodeSourceSocketId === socket.id` (de server echoet de eigen code van de leerling), wordt `localPersonalCode` **nooit** gewist, ongeacht de revisienummers.

**Probleem 2 — `model.setValue()` reset cursor én undo-history**
Zelfs in gevallen waar een echte externe update binnenkwam (bijv. leerkracht past persoonlijke code aan via Live control), wiste `model.setValue()` de volledige cursor-positie en undo/redo history. Ctrl+Z werkte niet meer na een externe update.

**Fix:** `model.pushEditOperations()` i.p.v. `model.setValue()` voor alle niet-reset updates. Dit is de standaard Monaco-aanpak voor externe code-updates — cursor blijft exact staan, undo-history blijft intact, scroll-positie behouden. Fallback naar `setValue` met cursor-herstel als `pushEditOperations` zou falen.

**Betrokken bestanden:** `web/public/app.js`

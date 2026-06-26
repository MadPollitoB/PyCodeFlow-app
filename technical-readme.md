# PyCodeFlow — Technische documentatie

> Interne werking, architectuur, API-referentie en ontwikkelaarsinformatie.

---

## Architectuur

```
Browser (leerling / leerkracht)
        │
        │  HTTPS via Cloudflare Tunnel
        │  Socket.IO (WebSocket)
        │
        ▼
┌─────────────────────────────────┐
│  web container  (Node.js :3000) │
│  server.js · Express · Socket.IO│
│  database.js (pg Pool)          │
└────────────┬────────────────────┘
             │ HTTP intern (Docker netwerk)
             ▼
┌─────────────────────────────────┐
│  runner container (Python :5000)│
│  app.py · Flask · Gunicorn      │
│  subprocess sandbox             │
└─────────────────────────────────┘
             │
┌─────────────────────────────────┐
│  postgres container (:5432)     │
│  postgres:16-alpine             │
│  persistent volume: pgdata/     │
└─────────────────────────────────┘
```

### Technologiestack

| Laag | Technologie | Versie |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS + Monaco Editor | — |
| Backend | Node.js + Express + Socket.IO | Node 20 |
| Runner | Python + Flask + Gunicorn | Python 3.12 |
| Database | PostgreSQL via `pg` Pool | PG 16 |
| Deployment | Docker Compose + Cloudflare Tunnel | — |

---

## Bestandsstructuur

```
pycodeflow/
├── web/
│   ├── server.js              ← Express + Socket.IO server (main)
│   ├── db/
│   │   └── database.js        ← PostgreSQL module (async)
│   ├── scripts/
│   │   ├── manage-teacher.js  ← CLI voor leerkrachten beheren
│   │   └── migrate-sqlite-to-pg.js ← Eenmalig migratescript
│   └── public/
│       ├── app.js             ← Frontend logica (alle pagina's)
│       ├── styles.css         ← CSS (alle pagina's)
│       ├── index.html         ← Startpagina
│       ├── teacher-app.html   ← Leerkrachten-app
│       ├── teacher-sessions.html ← Sessieoverzicht
│       ├── teacher-login.html ← Login-pagina
│       ├── student-app.html   ← Leerlingen-app
│       ├── student-start.html ← Leerling join-pagina
│       ├── free-editor.html   ← Vrije editor
│       ├── admin.html         ← Gebruikersbeheer
│       ├── monitoring.html    ← Systeemmonitoring
│       └── templates.json     ← Python code-oefeningen
├── runner/
│   └── app.py                 ← Flask runner met subprocess sandbox
├── docker-compose.yml
├── .env                       ← Geheimen (niet in git)
└── check-deployment.sh        ← Verificatiescript
```

---

## Database schema

### teachers

| Kolom | Type | Beschrijving |
|---|---|---|
| `id` | TEXT PK | UUID |
| `username` | TEXT UNIQUE | Inlognaam (case-insensitief) |
| `pass_hash` | TEXT | `scrypt_hash:salt_hex` |
| `display_name` | TEXT | Weergavenaam |
| `role` | TEXT | `teacher` of `admin` |
| `created_at` | BIGINT | Unix timestamp ms |
| `last_login` | BIGINT | Unix timestamp ms |

### sessions

| Kolom | Type | Beschrijving |
|---|---|---|
| `code` | TEXT PK | 8-tekens code (A-Z2-9) |
| `id` | TEXT UNIQUE | UUID |
| `name` | TEXT | Sessienaam |
| `mode` | TEXT | `class` of `exam` |
| `editor_assist` | INT | 0/1 |
| `created_at` | BIGINT | Unix timestamp ms |
| `closed` | INT | 0/1 |
| `blocked` | INT | 0/1 |
| `deleted` | INT | 0/1 |
| `shared_code` | TEXT | Gedeelde code |
| `announcement` | TEXT | Actieve aankondiging |
| `workspace_mode` | TEXT | `shared` of `personal` |
| `students_json` | TEXT | JSON snapshot leerlingen |

### session_annotations

| Kolom | Type | Beschrijving |
|---|---|---|
| `session_code` | TEXT PK | FK naar sessions |
| `annotations_json` | TEXT | JSON array annotaties |
| `updated_at` | BIGINT | Unix timestamp ms |

### code_snapshots

| Kolom | Type | Beschrijving |
|---|---|---|
| `id` | TEXT PK | UUID |
| `session_code` | TEXT | FK naar sessions |
| `student_id` | TEXT | In-memory student ID |
| `student_name` | TEXT | Naam op moment van snapshot |
| `timestamp` | BIGINT | Unix timestamp ms |
| `code` | TEXT | Code-inhoud |

### classes

| Kolom | Type | Beschrijving |
|---|---|---|
| `id` | TEXT PK | UUID |
| `name` | TEXT | Klasnaam |
| `school_year` | TEXT | Bijv. `2025-2026` |
| `archived` | BOOLEAN | Gearchiveerd |
| `created_at` | BIGINT | Unix timestamp ms |

### students

| Kolom | Type | Beschrijving |
|---|---|---|
| `id` | TEXT PK | UUID |
| `name` | TEXT | Leerlingnaam |
| `class_id` | TEXT | FK naar classes |
| `status` | TEXT | `active`, `pending`, `blocked` |
| `source` | TEXT | `manual`, `csv`, `google` |
| `google_email` | TEXT UNIQUE | Voor toekomstige OAuth |
| `google_sub` | TEXT UNIQUE | Google-ID voor OAuth |
| `created_at` | BIGINT | Unix timestamp ms |
| `last_seen` | BIGINT | Laatste sessie-deelname |
| `notes` | TEXT | Vrije notitie |

---

## REST API

Alle endpoints vereisen authenticatie tenzij anders vermeld.

### Sessies

| Methode | Endpoint | Beschrijving |
|---|---|---|
| GET | `/api/sessions` | Actieve sessies (`?includeClosed=true` voor archief) |
| GET | `/api/sessions/:code/export` | Export sessie als ZIP |
| GET | `/api/sessions/:code/history/:studentId` | Code-snapshots leerling |
| DELETE | `/api/sessions/:code` | Sessie verwijderen |
| POST | `/api/sessions/:code/block-toggle` | Sessie blokkeren/deblokkeren |

### Admin — Leerkrachten

| Methode | Endpoint | Beschrijving |
|---|---|---|
| GET | `/api/admin/teachers` | Alle leerkrachten |
| POST | `/api/admin/teachers` | Nieuwe leerkracht |
| PUT | `/api/admin/teachers/:username/password` | Wachtwoord resetten |
| PUT | `/api/admin/teachers/:username/role` | Rol wijzigen |
| DELETE | `/api/admin/teachers/:username` | Verwijderen |

### Admin — Klassen

| Methode | Endpoint | Beschrijving |
|---|---|---|
| GET | `/api/admin/classes` | Alle klassen (`?archived=true`) |
| GET | `/api/classes` | Publiek — voor leerling dropdown |
| POST | `/api/admin/classes` | Nieuwe klas |
| PUT | `/api/admin/classes/:id/archive` | Archiveren |
| DELETE | `/api/admin/classes/:id` | Verwijderen |
| POST | `/api/admin/classes/:id/teachers` | Leerkracht koppelen |
| DELETE | `/api/admin/classes/:id/teachers/:tid` | Leerkracht ontkoppelen |

### Admin — Leerlingen

| Methode | Endpoint | Beschrijving |
|---|---|---|
| GET | `/api/admin/students` | Alle leerlingen (`?classId=`) |
| POST | `/api/admin/students` | Nieuwe leerling |
| PUT | `/api/admin/students/:id/status` | Status wijzigen |
| PUT | `/api/admin/students/:id/class` | Klas wijzigen |
| PUT | `/api/admin/students/:id/notes` | Notitie bijwerken |
| DELETE | `/api/admin/students/:id` | Verwijderen |
| POST | `/api/admin/students/import-csv` | CSV-import |

### Systeem

| Methode | Endpoint | Beschrijving | Auth |
|---|---|---|---|
| GET | `/health` | Container health check | Nee |
| GET | `/api/monitoring` | Systeem- en sessiondata | Ja |
| GET | `/api/csrf-token` | CSRF-token ophalen | Nee |
| GET | `/api/stress-test/autocheck-status` | Laatste autocheck | Ja |
| POST | `/api/stress-test/start` | Stresstest starten (vereist `STRESS_TEST_ENABLED=true`) | Ja |

---

## Socket.IO events

### Van leerling → server

| Event | Data | Beschrijving |
|---|---|---|
| `student_join` | `{ name, code, className, resumeId }` | Sessie joinen |
| `student_join_free` | `{ name, className }` | Vrije editor joinen |
| `code_update` | `{ codeText, workspace }` | Code versturen |
| `run_request` | `{ codeText, workspace }` | Code runnen |
| `free_run_request` | `{ codeText }` | Vrij runnen |
| `runtime_input` | `{ value }` | Input invullen |
| `free_runtime_input` | `{ value }` | Vrije editor input |
| `student_raise_hand` | — | Hand opsteken |
| `student_lower_hand` | — | Hand zakken |
| `student_mark_done` | — | Klaar-knop |
| `student_unmark_done` | — | Ongedaan klaar |
| `student_tab_hidden` | `{ hidden }` | Tab-wisseling melden |
| `free_run_end` | — | Vrije run stoppen |

### Van leerkracht → server

| Event | Data | Beschrijving |
|---|---|---|
| `teacher_create_session` | `{ name, mode, editorAssist, templateCode }` | Sessie aanmaken |
| `teacher_join_session` | `{ code }` | Sessie openen |
| `teacher_select_student` | `{ studentId }` | Leerling selecteren |
| `teacher_update_code` | `{ codeText }` | Klascode bijwerken |
| `teacher_run_code` | `{ codeText }` | Klascode runnen |
| `teacher_send_annotation` | `{ startLine, endLine, message, color }` | Annotatie sturen |
| `teacher_clear_annotations` | — | Annotaties wissen |
| `teacher_send_announcement` | `{ message }` | Aankondiging sturen |
| `teacher_send_snippet` | `{ code }` | Snippet broadcasten |
| `teacher_set_student_can_run` | `{ studentId, value }` | Run-rechten |
| `teacher_set_student_can_edit` | `{ studentId, value }` | Bewerkrechten |
| `teacher_set_all_can_run` | `{ value }` | Alle run-rechten |
| `teacher_start_timer` | `{ seconds }` | Timer starten |
| `teacher_stop_timer` | — | Timer stoppen |
| `teacher_close_session` | — | Sessie sluiten |
| `teacher_delete_session` | — | Sessie verwijderen |
| `teacher_update_session_config` | `{ key, value }` | Editor-config aanpassen |
| `teacher_update_student_badge` | `{ studentId, action }` | Badge actie |
| `teacher_assign_student_class` | `{ studentId, classId }` | Klas toewijzen |

### Van server → leerling

| Event | Data | Beschrijving |
|---|---|---|
| `student_state` | `{ ... }` | Volledige sessie-staat |
| `code_update` | `{ codeText, ... }` | Code-synchronisatie |
| `run_output` | `{ output, runId }` | Output-fragment |
| `run_end` | `{ runId }` | Run afgerond |
| `run_error` | `{ error, line }` | Runtime fout |
| `run_queued` | `{ position }` | In wachtrij |
| `input_request` | `{ prompt, runId }` | Input gevraagd |
| `annotation_added` | `{ annotation }` | Annotatie ontvangen |
| `annotations_cleared` | — | Annotaties gewist |
| `announcement` | `{ message }` | Aankondiging ontvangen |
| `timer_update` | `{ remaining, total }` | Timer update |
| `timer_stopped` | — | Timer gestopt |
| `session_config_update` | `{ config }` | Editor-config gewijzigd |
| `csrf_nonce` | `{ nonce }` | CSRF nonce |
| `error_message` | `{ message }` | Foutmelding |

### Van server → leerkracht

| Event | Data | Beschrijving |
|---|---|---|
| `teacher_session_data` | `{ session, students, view, config, ... }` | Volledige sessiedata |
| `sessions_list` | `[ ... ]` | Lijst actieve sessies |

---

## Python runner — sandbox

De runner draait Python-code in een subprocess met de volgende beperkingen:

### Geblokkeerde modules

```python
BLOCKED_MODULES = {
    'os', 'subprocess', 'socket', 'shutil', 'importlib',
    'ctypes', 'multiprocessing', 'signal', 'pty', 'tty',
    'termios', 'fcntl', 'resource', 'mmap', 'syslog',
}
```

### OS-limieten (rlimits)

| Limiet | Waarde | Beschrijving |
|---|---|---|
| `RLIMIT_NOFILE` | 64 | Max open bestanden |
| `RLIMIT_FSIZE` | 1 MB | Max bestandsgrootte schrijven |
| `RLIMIT_NPROC` | 32 | Max child-processen |

### Docker-limieten

| Limiet | Waarde |
|---|---|
| Geheugen | 256 MB |
| CPU | 1.0 core |
| Timeout | 30 seconden per run |
| Max output | 256 KB |
| Max code | 32 KB |

### Wachtrij

- Max gelijktijdige runs: 18
- Max wachtrij: 90 items
- Geschatte wachttijd: ~8s per positie

---

## Beveiliging

**Score: 93/100**

| Maatregel | Status |
|---|---|
| HTTPS via Cloudflare Tunnel | ✅ |
| HTTP security headers (CSP, HSTS, X-Frame, ...) | ✅ |
| Cookie `HttpOnly + Secure + SameSite=Strict` | ✅ |
| Wachtwoorden via `scrypt` + `timingSafeEqual` | ✅ |
| CSRF-bescherming (token + per-socket nonce) | ✅ |
| SQL: geparameteriseerde queries | ✅ |
| XSS: `escapeHtml()` overal in templates | ✅ |
| Rate limiting login (6/30min per IP) | ✅ |
| Rate limiting student_join (10/min per IP) | ✅ |
| Runner op `127.0.0.1` (niet extern bereikbaar) | ✅ |
| Socket.IO max payload 64KB | ✅ |
| Code max 32KB, output max 256KB | ✅ |
| Runner sandbox: rlimits + blocked modules | ✅ |
| Docker memory limiet runner (256MB) | ✅ |
| Sessiecode: `crypto.randomBytes()`, 8 tekens | ✅ |
| `unsafe-eval` in CSP (Monaco AMD vereist dit) | ⚠️ Fix in sprint 12a-D |

---

## Sessie-config systeem

Elke sessie heeft een `config` object in-memory:

```js
session.config = {
  autoIndent:          true,   // false bij examenmodus standaard
  autoClosingBrackets: true,
  autoClosingQuotes:   true,
  quickSuggestions:    true,
  parameterHints:      true,
  errorLineMarking:    true,   // altijd true, niet uitschakelbaar
}
```

Config is **niet persistent** — bij server-herstart terug naar modus-standaard.

Leerkracht wijzigt config via ⚙️ paneel → `teacher_update_session_config` socket event → server broadcast `session_config_update` → leerling past Monaco-opties live aan.

---

## Wachtwoord-hashing

```js
// Aanmaken
const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, 64).toString('hex');
const stored = `${hash}:${salt.toString('hex')}`;

// Verifiëren
const [hash, saltHex] = stored.split(':');
const salt = Buffer.from(saltHex, 'hex');
const verify = crypto.scryptSync(input, salt, 64);
const valid = crypto.timingSafeEqual(Buffer.from(hash, 'hex'), verify);
```

---

## Omgevingsvariabelen

| Variabele | Vereist | Standaard | Beschrijving |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `DB_SSL` | — | `false` | SSL voor DB-verbinding |
| `POC_BASIC_USER` | — | — | Fallback leerkracht (legacy) |
| `POC_BASIC_PASS` | — | — | Fallback wachtwoord (legacy) |
| `RUNNER_URL` | — | `http://runner:5000` | Runner intern adres |
| `STRESS_TEST_ENABLED` | — | `false` | Stresstest inschakelen |
| `APP_VERSION_YEAR` | — | `2026` | Versie in footer |
| `APP_VERSION_MAJOR` | — | `0` | Versie in footer |
| `APP_VERSION_MINOR` | — | `0` | Versie in footer |
| `APP_VERSION_BUILD` | — | `0` | Versie in footer |

---

*PyCodeFlow · Atheneum Hoboken*

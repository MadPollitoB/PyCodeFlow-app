# PyCodeFlow — Technische documentatie

> Interne werking, architectuur, API-referentie en ontwikkelaarsinformatie.
> Versie: v2026.2.34.8

---

## Versiebeleid

Formaat: `JAAR.MAJOR.MINOR.BUILD` (bv. `2026.2.34.3`).

**Regel:** het **MINOR-nummer volgt het sprintnummer** dat wordt uitgevoerd. De **BUILD**
(laatste cijfer) telt op voor opeenvolgende releases binnen dezelfde uitvoeringsfase.

- Zolang we werk uitvoeren binnen de "huidige" sprintreeks, blijft het minor-nummer gelijk
  en telt enkel de build op: `34.0 → 34.1 → 34.2 → 34.3`.
- Pas wanneer een sprint met een hoger nummer effectief wordt uitgevoerd, springt het
  minor-nummer mee: sprint 35 wordt `35.0`, sprint 36 wordt `36.0`.
- Zo blijft de nummering monotoon oplopend én uiteindelijk gekoppeld aan het sprintnummer,
  zonder gaten of downgrades.

**Voorbeeld uit de praktijk:** sprint 34 (testbasis) werd eerst uitgevoerd → `2026.2.34.0`.
Daarna volgde werk voor sprint 30 (config-fix) + de kopieerknop; dat werd *niet* `30.x`
(zou een downgrade zijn) en *ook niet* meteen `35.0`, maar `2026.2.34.3` — de volgende build
in de lopende 34-reeks. Wanneer sprint 35/36 echt aan de beurt zijn, gaat het minor-nummer
mee omhoog.

De versie staat in het `VERSION`-bestand (single source of truth). `sync-version.sh`
propageert die naar `.env` en alle HTML cache-bust strings. De server leest `VERSION` bij
opstart.

---

## Architectuur

```
Browser (leerling / leerkracht)
        │ HTTPS via Cloudflare Tunnel · Socket.IO (WebSocket)
        ▼
┌─────────────────────────────────────────────────────┐
│  web container  (Node.js :3000)                     │
│  server.js · Express · Socket.IO                    │
│  database.js (pg Pool → PostgreSQL)                 │
└────────────┬────────────────────────────────────────┘
             │ HTTP intern (Docker netwerk)
             ▼
┌─────────────────────────────────────────────────────┐
│  runner container (Python :5000)                    │
│  app.py · Flask · Gunicorn                          │
│  subprocess sandbox + rlimits                       │
└─────────────────────────────────────────────────────┘
             │
┌─────────────────────────────────────────────────────┐
│  postgres container (:5432)                         │
│  postgres:16-alpine                                 │
│  persistent volume: pgdata/                         │
└─────────────────────────────────────────────────────┘
```

## Technologiestack

| Laag | Technologie | Versie |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS + Monaco Editor | — |
| Backend | Node.js + Express + Socket.IO | Node 20 |
| Runner | Python + Flask + Gunicorn | Python 3.12 |
| Database | PostgreSQL via `pg` Pool | PG 16 |
| PDF export | pdfkit | ^0.15 |
| Markdown | marked.js | 9.1.6 (CDN — preview in vragenbank) |
| Tunnel | Cloudflare Tunnel (cloudflared) | latest |
| Deployment | Docker Compose | — |

---

## Bestandsstructuur

```
pycodeflow/
├── pycodeflow.sh              ← Beheertool (18 menu-opties)
├── .env                       ← Geheimen (NOOIT in git)
├── .env.example               ← Template
├── .gitignore
├── docker-compose.yml
├── check-deployment.sh        ← Verificatiescript
├── health-monitor.sh          ← Crash notificatie (cron)
│
├── pgdata/                    ← PostgreSQL databestanden
├── logs/                      ← Logbestanden (max LOG_RETENTION_DAYS)
├── backups/                   ← DB backups (max 7 dagen)
│
├── web/
│   ├── server.js              ← Express + Socket.IO server (MAIN)
│   ├── package.json           ← npm: pg, pdfkit, express, socket.io, dotenv
│   ├── db/database.js         ← PostgreSQL module (alle DB-methodes)
│   ├── scripts/
│   │   ├── manage-teacher.js  ← CLI leerkrachten beheren
│   │   ├── backup-db.sh       ← DB backup script
│   │   └── migrate-sqlite-to-pg.js
│   └── public/
│       ├── app.js             ← Frontend logica
│       ├── styles.css
│       ├── monaco-env.js      ← Monaco ESM worker config
│       ├── templates.json     ← Python oefentemplates
│       ├── index.html, teacher-login.html, teacher-sessions.html
│       ├── teacher-app.html, student-start.html, student-app.html
│       ├── free-editor.html, monitoring.html, admin.html
│       ├── quiz-bank.html, quiz-teacher.html, quiz-student.html
│       ├── quiz-review.html, quiz-archive.html, teacher-grid.html
│       └── assets/            ← Optioneel schoollogo
├── runner/
│   ├── app.py                 ← Flask + subprocess sandbox
│   └── requirements.txt
```

---

## Database schema (alle tabellen)

### Kern

| Tabel | Inhoud |
|---|---|
| `teachers` | Leerkrachten + gehashte wachtwoorden |
| `sessions` | Klassessies (+ `config_json` voor persistente editor-config) |
| `session_annotations` | Annotaties per sessie |
| `code_snapshots` | Code-history per leerling per sessie |
| `classes` | Klassen |
| `teacher_classes` | Koppeling leerkracht ↔ klas |
| `students` | Leerlingen (status: active/pending/blocked) |

### Quiz

| Tabel | Inhoud |
|---|---|
| `quiz_bank` | Vragenbank (type: code/open/single/multiple + choices_json) |
| `quiz_question_snapshots` | Snapshot van vragen op moment van toets |
| `quiz_meta` | Toets-instellingen (timer, tijdsvenster, volgorde, ...) |
| `quiz_answers` | Antwoorden per leerling per vraag (+ auto_scored) |
| `quiz_general_comments` | Algemeen commentaar per leerling |
| `quiz_student_order` | Gepersonaliseerde vraagvolgorde |
| `quiz_run_history` | Run-history per antwoord |
| `quiz_comment_templates` | Herbruikbare commentaar-templates |

### Systeem

| Tabel | Inhoud |
|---|---|
| `stress_results` | Stresstest historiek (stressload%, timing, RAM/CPU) |
| `audit_log` | Audit-log leerkrachtenacties (score gewijzigd, toets verwijderd, ...) |

---

## REST API (selectie)

### Authenticatie

| | Endpoint | Beschrijving |
|---|---|---|
| POST | `/api/teacher-login` | Login met username/password |
| GET | `/api/teacher-logout` | Uitloggen |
| GET | `/api/version` | Versie + uptime |
| GET | `/health` | Container health check |
| GET | `/api/school-info` | Schoolnaam + logo URL |

### Admin

| | Endpoint | Beschrijving |
|---|---|---|
| GET/POST | `/api/admin/teachers` | Leerkrachten beheren |
| GET/POST | `/api/admin/classes` | Klassen beheren |
| GET/POST | `/api/admin/students` | Leerlingen beheren |
| POST | `/api/admin/students/import-csv` | CSV import |
| GET | `/api/admin/logs/info` | Log status |
| POST | `/api/admin/logs/cleanup` | Logs opruimen |
| GET | `/api/admin/audit-log` | Audit-log (leerkrachtenacties) |
| GET | `/api/stress-results` | Stresstest historiek |

### Sessies

| | Endpoint | Beschrijving |
|---|---|---|
| GET | `/api/sessions` | Actieve sessies |
| GET | `/api/sessions/:code/export` | Export als ZIP |
| GET | `/api/sessions/:code/history/:id` | Code-history leerling |

### Quiz

| | Endpoint | Beschrijving |
|---|---|---|
| GET/POST | `/api/quiz/bank` | Vragenbank CRUD |
| POST | `/api/quiz/bank/import-csv` | CSV import vragen |
| POST | `/api/quiz` | Toets aanmaken |
| POST | `/api/quiz/:code/duplicate` | Toets dupliceren |
| GET | `/api/quiz/:code/answers` | Alle antwoorden |
| PUT | `/api/quiz/:code/answers/:id/score` | Score opslaan |
| POST | `/api/quiz/:code/release` | Resultaten vrijgeven |
| GET | `/api/quiz/:code/similarity` | Gelijkenis-rapport |
| GET | `/api/quiz/:code/pdf/questions` | PDF vragenblad |
| GET | `/api/quiz/:code/pdf/answers` | PDF antwoorden |
| GET | `/api/quiz/:code/pdf/overview` | PDF klasoverzicht |
| GET | `/api/quiz/archive` | Toets-archief |
| PUT | `/api/quiz/bank/:id/unarchive` | Vraag herstellen uit archief |
| GET | `/api/admin/db/tables` | Database viewer: tabeloverzicht |
| GET | `/api/admin/db/tables/:name/rows` | Database viewer: tabelinhoud (gepagineerd) |

---

## Socket.IO events (selectie)

### Leerling → Server

| Event | Beschrijving |
|---|---|
| `student_join` | Klassessie joinen |
| `run_request` | Code uitvoeren |
| `runtime_input` | Input invullen |
| `student_raise_hand` | Hand opsteken |
| `student_mark_done` | Klaar melden |
| `quiz_start` | Toets starten (timer begint) |
| `quiz_save_answer` | Antwoord opslaan |
| `quiz_submit_all` | Toets indienen |

### Server → Leerling

| Event | Beschrijving |
|---|---|
| `student_state` | Volledige sessie-staat |
| `run_output` | Code output |
| `run_error` | Runtime fout |
| `input_request` | Input gevraagd |
| `quiz_state` | Quiz staat + vragen |
| `quiz_timer_update` | Timer tick |
| `quiz_warning` | 10% tijd resterend |
| `quiz_force_submit` | Auto-submit (timer/deadline) |
| `quiz_reminder` | Herinnering van leerkracht |
| `quiz_access_expired` | Tijdsvenster verlopen |

---

## Python runner sandbox

### Geblokkeerde modules

```python
BLOCKED_MODULES = {
    'os', 'subprocess', 'socket', 'shutil', 'importlib',
    'ctypes', 'multiprocessing', 'signal', 'pty', ...
}
```

### Limieten

| Limiet | Waarde |
|---|---|
| RAM runner | 256 MB (Docker) |
| CPU runner | 1 core |
| Timeout | 30 seconden |
| Max output | 256 KB |
| Max code | 32 KB |
| Open bestanden | 64 (rlimit) |

---

## Omgevingsvariabelen (.env)

| Variabele | Verplicht | Beschrijving |
|---|---|---|
| `POSTGRES_PASSWORD` | ✅ | PostgreSQL wachtwoord (DATABASE_URL wordt auto-opgebouwd) |
| `CLOUDFLARE_TUNNEL_TOKEN` | ✅ | Cloudflare tunnel token |
| `POC_BASIC_COOKIE_SECRET` | ✅ | Cookie signing secret |
| `RUNNER_URL` | ✅ | Intern adres runner (`http://runner:5000`) |
| `SCHOOL_NAME` | — | Schoolnaam in PDF export |
| `SCHOOL_LOGO_PATH` | — | Pad naar schoollogo |
| `LOG_RETENTION_DAYS` | — | Logbestanden bewaren (standaard 7) |
| `STRESS_TEST_ENABLED` | — | Stresstest inschakelen (standaard false) |
| `WEBHOOK_URL` | — | URL voor crash notificaties |

---

## Beveiliging

| Maatregel | Status |
|---|---|
| HTTPS via Cloudflare | ✅ |
| CSP headers (geen unsafe-eval) | ✅ |
| Monaco workers via blob: | ✅ |
| Cookie HttpOnly + Secure + SameSite=Strict | ✅ |
| Wachtwoorden via scrypt + timingSafeEqual | ✅ |
| CSRF token + per-socket nonce | ✅ |
| SQL: geparameteriseerde queries | ✅ |
| Rate limiting login (6/30min) | ✅ |
| Rate limiting join (10/min) | ✅ |
| Runner op 127.0.0.1 (niet extern) | ✅ |
| Runner sandbox: rlimits + geblokkeerde modules | ✅ |
| Docker memory limiet runner (256MB) | ✅ |

**Beveiligingsscore: ~99/100** *(CSRF op alle muterende endpoints — sprint 23o)*

---

## pycodeflow.sh menu-opties

| Optie | Actie |
|---|---|
| 1 | Versie instellen |
| 2 | Start |
| 3 | Stop |
| 4 | Herstart |
| 5 | Rebuild & herstart |
| 6 | Logs bekijken (web/runner/postgres/fouten/DB-check) |
| 7 | Verificatie (check-deployment.sh) |
| 8 | SQLite → PostgreSQL migratie |
| 9 | npm packages controleren |
| 10 | Leerkrachtsaccount aanmaken |
| 11 | Container resources (docker stats) |
| 12 | Logs opruimen |
| 13 | Eerste-start opnieuw uitvoeren |
| 14 | Volledige reset (ALLES verwijderen, .env blijft) |
| 15 | Health monitor instellen (crash notificatie) |
| 16 | Database backup beheren |
| 17 | Wachtwoord leerkracht resetten |
| 18 | Mappenstructuur opschonen (verouderde bestanden verwijderen) |

---

*PyCodeFlow · Atheneum Hoboken · technical-readme.md · v2026.2.34.8*

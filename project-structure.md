# PyCodeFlow — Projectstructuur & Deploy-gids

> Exacte mappenstructuur op de NAS + welk bestand waar naartoe gaat.

---

## Mappenstructuur op de NAS

```
/volume3/docker/pycodeflow/
│
├── pycodeflow.sh                  ← Beheertool (start/stop/setup/logs/opschonen)
├── Opschonen-Lokaal.ps1           ← Windows: lokale map opschonen (PowerShell)
├── .env                           ← Geheimen — NOOIT in git!
├── .env.example                   ← Template voor .env
├── .gitignore                     ← Wat niet in git mag
├── docker-compose.yml             ← Basis Docker configuratie
├── docker-compose.prod.yml        ← Productie-overrides (poorten, volumes)
├── check-deployment.sh            ← Verificatiescript
│
├── pgdata/                        ← PostgreSQL databestanden (auto-aangemaakt)
│   └── (beheerd door PostgreSQL)
│
├── logs/                          ← Logbestanden (auto-aangemaakt, max 7 dagen)
│   ├── access-2026-06-26.log
│   └── error-2026-06-26.log
│
├── data/                          ← Legacy SQLite (enkel als backup na migratie)
│   └── pycodeflow.db.backup-20260626
│
├── web/                           ← Node.js webserver
│   ├── server.js                  ← Express + Socket.IO server (MAIN)
│   ├── package.json               ← npm dependencies
│   ├── package-lock.json          ← (auto-aangemaakt door npm)
│   ├── node_modules/              ← (auto-aangemaakt door npm — NIET in git)
│   ├── Dockerfile                 ← Docker build instructies voor web
│   │
│   ├── db/
│   │   └── database.js            ← PostgreSQL module (alle DB-methodes)
│   │
│   ├── scripts/
│   │   ├── manage-teacher.js      ← CLI: leerkracht aanmaken/verwijderen
│   │   └── migrate-sqlite-to-pg.js ← Eenmalig: SQLite → PostgreSQL migratie
│   │
│   └── public/                    ← Statische bestanden (HTML/CSS/JS)
│       │
│       ├── app.js                 ← Frontend logica (alle pagina's)
│       ├── styles.css             ← CSS (alle pagina's)
│       ├── monaco-env.js          ← Auto-gegenereerd via /monaco-env.js endpoint
│       ├── templates.json         ← Python code-oefentemplates
│       │
│       ├── index.html             ← Startpagina
│       ├── teacher-login.html     ← Leerkracht loginpagina
│       ├── teacher-sessions.html  ← Sessieoverzicht + toetsen-tabblad
│       ├── teacher-app.html       ← Leerkrachten-app (live sessie)
│       ├── student-start.html     ← Leerling joinpagina (naam + code + klas)
│       ├── student-app.html       ← Leerlingen-app (code editor)
│       ├── free-editor.html       ← Vrije editor (zonder sessiecode)
│       ├── monitoring.html        ← Systeemmonitoring
│       ├── admin.html             ← Gebruikersbeheer (leerkrachten/klassen/leerlingen)
│       │
│       ├── quiz-bank.html         ← Vragenbank beheren
│       ├── quiz-teacher.html      ← Toets aanmaken (wizard)
│       ├── quiz-student.html      ← Leerling quizscherm
│       ├── quiz-review.html       ← Verbetermodule + PDF export
│       └── quiz-archive.html      ← Archief + statistieken per jaar/klas
│
├── runner/                        ← Python code-uitvoerder
│   ├── app.py                     ← Flask runner met subprocess sandbox
│   ├── requirements.txt           ← Python dependencies
│   └── Dockerfile                 ← Docker build instructies voor runner
│
└── assets/                        ← Optioneel: logo en schoolafbeeldingen
    └── logo.svg                   ← Logo (gebruikt in PDF export en topbar)
```

---

## Welk bestand gaat waar naartoe

### Bij elke update kopiëren

| Bestand (outputs/) | Bestemming op NAS |
|---|---|
| `server.js` | `web/server.js` |
| `app.js` | `web/public/app.js` |
| `styles.css` | `web/public/styles.css` |
| `database.js` | `web/db/database.js` |
| `app.py` | `runner/app.py` |
| `teacher-sessions.html` | `web/public/teacher-sessions.html` |
| `teacher-app.html` | `web/public/teacher-app.html` |
| `teacher-login.html` | `web/public/teacher-login.html` |
| `student-app.html` | `web/public/student-app.html` |
| `student-start.html` | `web/public/student-start.html` |
| `free-editor.html` | `web/public/free-editor.html` |
| `monitoring.html` | `web/public/monitoring.html` |
| `admin.html` | `web/public/admin.html` |
| `index.html` | `web/public/index.html` |
| `templates.json` | `web/public/templates.json` |
| `quiz-bank.html` | `web/public/quiz-bank.html` |
| `quiz-teacher.html` | `web/public/quiz-teacher.html` |
| `quiz-student.html` | `web/public/quiz-student.html` |
| `quiz-review.html` | `web/public/quiz-review.html` |
| `quiz-archive.html` | `web/public/quiz-archive.html` |
| `migrate-sqlite-to-pg.js` | `web/scripts/migrate-sqlite-to-pg.js` |

### In NAS root (één niveau boven `web/`)

| Bestand (outputs/) | Bestemming op NAS |
|---|---|
| `pycodeflow.sh` | `/volume3/docker/pycodeflow/pycodeflow.sh` |
| `.gitignore` | `/volume3/docker/pycodeflow/.gitignore` |
| `.env.example` | `/volume3/docker/pycodeflow/.env.example` |
| `docker-compose.yml` | `/volume3/docker/pycodeflow/docker-compose.yml` |
| `Dockerfile.web` | `/volume3/docker/pycodeflow/web/Dockerfile` *(hernoem naar Dockerfile)* |
| `package.json` | `/volume3/docker/pycodeflow/web/package.json` |

### Documentatie (niet deployen — enkel lokaal/git)

| Bestand (outputs/) | Doel |
|---|---|
| `technical-readme.md` | Architectuur + API referentie |
| `test-readme.md` | Testhandleiding per sprint |
| `user-manual.md` | Gebruikershandleiding |
| `install.md` | Installatiegids |
| `sprintlog.md` | Sprint planning + roadmap |
| `changelog.md` | Versiegeschiedenis |
| `project-structure.md` | Dit bestand |

---

## Bash deploy-script (snel alle bestanden kopiëren)

Sla dit op als `deploy.sh` naast je outputs map en pas `OUTPUTS` aan:

```bash
#!/bin/bash
# PyCodeFlow — Deploy script
# Gebruik: bash deploy.sh
# Pas BASE en OUTPUTS aan naar jouw situatie

BASE="/volume3/docker/pycodeflow"
OUTPUTS="./outputs"  # map met alle output-bestanden van Claude

echo "Bestanden kopiëren naar $BASE..."

# Web server
cp $OUTPUTS/server.js           $BASE/web/server.js
cp $OUTPUTS/database.js         $BASE/web/db/database.js
cp $OUTPUTS/migrate-sqlite-to-pg.js $BASE/web/scripts/migrate-sqlite-to-pg.js

# Frontend
cp $OUTPUTS/app.js              $BASE/web/public/app.js
cp $OUTPUTS/styles.css          $BASE/web/public/styles.css
cp $OUTPUTS/templates.json      $BASE/web/public/templates.json

# HTML pagina's
cp $OUTPUTS/index.html          $BASE/web/public/index.html
cp $OUTPUTS/teacher-login.html  $BASE/web/public/teacher-login.html
cp $OUTPUTS/teacher-sessions.html $BASE/web/public/teacher-sessions.html
cp $OUTPUTS/teacher-app.html    $BASE/web/public/teacher-app.html
cp $OUTPUTS/student-start.html  $BASE/web/public/student-start.html
cp $OUTPUTS/student-app.html    $BASE/web/public/student-app.html
cp $OUTPUTS/free-editor.html    $BASE/web/public/free-editor.html
cp $OUTPUTS/monitoring.html     $BASE/web/public/monitoring.html
cp $OUTPUTS/admin.html          $BASE/web/public/admin.html
cp $OUTPUTS/quiz-bank.html      $BASE/web/public/quiz-bank.html
cp $OUTPUTS/quiz-teacher.html   $BASE/web/public/quiz-teacher.html
cp $OUTPUTS/quiz-student.html   $BASE/web/public/quiz-student.html
cp $OUTPUTS/quiz-review.html    $BASE/web/public/quiz-review.html
cp $OUTPUTS/quiz-archive.html   $BASE/web/public/quiz-archive.html

# Runner
cp $OUTPUTS/app.py              $BASE/runner/app.py

# NAS root
cp $OUTPUTS/pycodeflow.sh       $BASE/pycodeflow.sh
cp $OUTPUTS/.gitignore          $BASE/.gitignore
cp $OUTPUTS/.env.example        $BASE/.env.example

chmod +x $BASE/pycodeflow.sh

echo ""
echo "✓ Klaar. Herstart nu via: bash $BASE/pycodeflow.sh"
echo "  of: docker compose restart web"
```

---

## Wanneer rebuild vs herstart

| Wat is er gewijzigd | Wat te doen |
|---|---|
| `.html`, `.css`, `app.js` | `docker compose restart web` |
| `server.js`, `database.js` | `docker compose restart web` |
| `app.py` (runner) | `docker compose up --build -d runner` |
| `package.json` (nieuwe npm packages) | `docker compose up --build -d web` |
| `docker-compose.yml` | `docker compose up -d` |
| Eerste installatie | `bash pycodeflow.sh` (doet alles automatisch) |

---

## PostgreSQL — nuttige commando's

```bash
# Inloggen in PostgreSQL
docker exec -it pycodeflow-postgres-1 psql -U pycodeflow -d pycodeflow

# Tabellen bekijken
\dt

# Aantal leerlingen
SELECT COUNT(*) FROM students;

# Alle toetsen
SELECT s.code, s.name, q.timer_seconds, q.randomize
FROM sessions s JOIN quiz_meta q ON q.session_code = s.code;

# Afsluiten
\q
```

---

## .env — alle variabelen

```env
# Verplicht
DATABASE_URL=postgresql://pycodeflow:WACHTWOORD@postgres:5432/pycodeflow
POSTGRES_PASSWORD=WACHTWOORD

# Runner
RUNNER_URL=http://runner:5000
DB_SSL=false

# Leerkracht fallback (vervangen door DB-login na setup)
POC_BASIC_USER=admin
POC_BASIC_PASS=jouwwachtwoord

# Versie (zichtbaar in footer)
APP_VERSION_YEAR=2026
APP_VERSION_MAJOR=2
APP_VERSION_MINOR=13
APP_VERSION_BUILD=0

# PDF export
SCHOOL_NAME=Atheneum Hoboken

# Veiligheid
STRESS_TEST_ENABLED=false

# Log retentie (standaard 7 dagen — sprint 17a)
LOG_RETENTION_DAYS=7
```

---

*PyCodeFlow · Atheneum Hoboken · project-structure.md*

---

*PyCodeFlow · Atheneum Hoboken · project-structure.md · v2026.2.23.0*

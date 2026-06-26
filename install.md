# PyCodeFlow — Installatiegids

> Kies je omgeving: **Lokaal** (testen/ontwikkelen) of **NAS** (productie).

---

## Lokale installatie

### Vereisten

| Tool | Versie | Waarvoor |
|---|---|---|
| Docker Desktop | Laatste | Containers draaien |
| Node.js | 20+ | Web-server lokaal testen |
| Python | 3.12+ | Runner lokaal testen |
| Git | Laatste | Broncode ophalen |

### Stap 1 — Projectmap aanmaken

```bash
mkdir pycodeflow && cd pycodeflow

# Structuur aanmaken
mkdir -p web/public web/db web/scripts runner

# Alle bestanden van outputs kopiëren
cp outputs/server.js           web/server.js
cp outputs/app.js              web/public/app.js
cp outputs/styles.css          web/public/styles.css
cp outputs/database.js         web/db/database.js
cp outputs/app.py              runner/app.py
cp outputs/admin.html          web/public/admin.html
cp outputs/teacher-app.html    web/public/teacher-app.html
cp outputs/student-app.html    web/public/student-app.html
cp outputs/teacher-sessions.html web/public/teacher-sessions.html
cp outputs/student-start.html  web/public/student-start.html
cp outputs/free-editor.html    web/public/free-editor.html
cp outputs/index.html          web/public/index.html
cp outputs/monitoring.html     web/public/monitoring.html
cp outputs/teacher-login.html  web/public/teacher-login.html
cp outputs/templates.json      web/public/templates.json
cp outputs/migrate-sqlite-to-pg.js web/scripts/migrate-sqlite-to-pg.js
```

### Stap 2 — PostgreSQL starten

```bash
docker run -d \
  --name pycodeflow-postgres \
  -e POSTGRES_USER=pycodeflow \
  -e POSTGRES_PASSWORD=testpwd \
  -e POSTGRES_DB=pycodeflow \
  -p 5432:5432 \
  postgres:16-alpine

# Wacht tot postgres klaar is
docker exec pycodeflow-postgres pg_isready -U pycodeflow
# Verwachte output: /var/run/postgresql:5432 - accepting connections
```

### Stap 3 — .env aanmaken

```bash
cat > web/.env << 'ENVEOF'
# Database
DATABASE_URL=postgresql://pycodeflow:testpwd@localhost:5432/pycodeflow
DB_SSL=false

# Authenticatie leerkracht
POC_BASIC_USER=admin
POC_BASIC_PASS=admin123

# Versie
APP_VERSION_YEAR=2026
APP_VERSION_MAJOR=2
APP_VERSION_MINOR=11
APP_VERSION_BUILD=0

# Veiligheid
STRESS_TEST_ENABLED=false

# Runner URL (lokaal)
RUNNER_URL=http://localhost:5000
ENVEOF
```

### Stap 4 — Node.js dependencies

```bash
cd web
npm init -y
npm install express socket.io pg dotenv better-sqlite3
cd ..
```

### Stap 5 — Python runner starten

```bash
# Aparte terminal
cd runner
pip install flask gunicorn
python app.py
# Verwacht: "Running on http://127.0.0.1:5000"
```

### Stap 6 — Web-server starten

```bash
# Aparte terminal
cd web
node server.js
# Verwacht: "[db] PostgreSQL schema OK"
# Verwacht: "Server luistert op poort 3000"
```

### Stap 7 — Eerste leerkracht aanmaken

```bash
cd web
node scripts/manage-teacher.js add admin admin123
# Of via de server: POST /api/admin/teachers (na inloggen)
```

### Stap 8 — Testen

Open `http://localhost:3000` in de browser.

---

## NAS-installatie (productie)

### Vereisten

| Component | Details |
|---|---|
| Synology NAS | DSM 7.0+, Container Manager |
| Docker Compose | Via Container Manager |
| Cloudflare Tunnel | Voor HTTPS zonder portforwarding |
| Domein | `app.pycodeflow.org` of eigen domein |

### Stap 1 — Mapstructuur op NAS

```bash
# Via SSH op de NAS
mkdir -p /volume3/docker/pycodeflow/{web/public,web/db,web/scripts,runner,pgdata}
```

### Stap 2 — Bestanden kopiëren

```bash
# Via SCP van lokale machine naar NAS
SCP_DEST="admin@nas-ip:/volume3/docker/pycodeflow"

scp outputs/server.js           $SCP_DEST/web/server.js
scp outputs/database.js         $SCP_DEST/web/db/database.js
scp outputs/app.js              $SCP_DEST/web/public/app.js
scp outputs/styles.css          $SCP_DEST/web/public/styles.css
scp outputs/app.py              $SCP_DEST/runner/app.py
scp outputs/admin.html          $SCP_DEST/web/public/admin.html
scp outputs/teacher-app.html    $SCP_DEST/web/public/teacher-app.html
scp outputs/student-app.html    $SCP_DEST/web/public/student-app.html
scp outputs/teacher-sessions.html $SCP_DEST/web/public/teacher-sessions.html
scp outputs/student-start.html  $SCP_DEST/web/public/student-start.html
scp outputs/free-editor.html    $SCP_DEST/web/public/free-editor.html
scp outputs/index.html          $SCP_DEST/web/public/index.html
scp outputs/monitoring.html     $SCP_DEST/web/public/monitoring.html
scp outputs/teacher-login.html  $SCP_DEST/web/public/teacher-login.html
scp outputs/templates.json      $SCP_DEST/web/public/templates.json
scp outputs/migrate-sqlite-to-pg.js $SCP_DEST/web/scripts/migrate-sqlite-to-pg.js
```

### Stap 3 — docker-compose.yml

```bash
cat > /volume3/docker/pycodeflow/docker-compose.yml << 'DCEOF'
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: pycodeflow
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: pycodeflow
    volumes:
      - /volume3/docker/pycodeflow/pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "pycodeflow"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - pycodeflow

  web:
    build: ./web
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    env_file: .env
    ports:
      - "3000:3000"
    networks:
      - pycodeflow

  runner:
    build: ./runner
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 256m
          cpus: '1.0'
    networks:
      - pycodeflow

networks:
  pycodeflow:
    driver: bridge
DCEOF
```

### Stap 4 — .env aanmaken op NAS

```bash
cat > /volume3/docker/pycodeflow/.env << 'ENVEOF'
# Database
DATABASE_URL=postgresql://pycodeflow:KIES_STERK_WACHTWOORD@postgres:5432/pycodeflow
POSTGRES_PASSWORD=KIES_STERK_WACHTWOORD
DB_SSL=false

# Authenticatie leerkracht (fallback, vervang door DB-login)
POC_BASIC_USER=CHANGE_ME
POC_BASIC_PASS=CHANGE_ME

# Versie
APP_VERSION_YEAR=2026
APP_VERSION_MAJOR=2
APP_VERSION_MINOR=11
APP_VERSION_BUILD=0

# Veiligheid
STRESS_TEST_ENABLED=false

# Runner URL (intern Docker netwerk)
RUNNER_URL=http://runner:5000
ENVEOF
```

> ⚠️ Vervang `KIES_STERK_WACHTWOORD` door een echt sterk wachtwoord.

### Stap 5 — Dockerfiles aanmaken

**web/Dockerfile:**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

**web/package.json:**
```json
{
  "name": "pycodeflow-web",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.18.0",
    "socket.io": "^4.7.0",
    "pg": "^8.13.0",
    "dotenv": "^16.0.0"
  }
}
```

**runner/Dockerfile:**
```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 5000
CMD ["gunicorn", "--bind", "127.0.0.1:5000", "--workers", "1", "--threads", "4", "app:app"]
```

**runner/requirements.txt:**
```
flask==3.0.0
gunicorn==21.2.0
```

### Stap 6 — Bouwen en starten

```bash
cd /volume3/docker/pycodeflow

# Eerste keer bouwen
docker compose up --build -d

# Wacht tot postgres healthy is
docker compose ps
# postgres moet "healthy" tonen

# Eerste leerkracht aanmaken
docker compose exec web node scripts/manage-teacher.js add admin JOUWWACHTWOORD

# Verificatie
bash check-deployment.sh
```

### Stap 7 — Migratescript (alleen bij migratie van SQLite)

```bash
# Enkel uitvoeren als je bestaande SQLite data wil migreren
docker compose exec web node scripts/migrate-sqlite-to-pg.js
```

### Stap 8 — Cloudflare Tunnel koppelen

```bash
# Cloudflare Tunnel verwijst naar: http://nas-ip:3000
# Geen extra configuratie nodig in PyCodeFlow
# HTTPS wordt volledig afgehandeld door Cloudflare
```

---

## Updates deployen

### Alleen statische bestanden gewijzigd (HTML, CSS, JS)

```bash
cd /volume3/docker/pycodeflow

# Bestanden kopiëren
cp outputs/app.js web/public/app.js
cp outputs/styles.css web/public/styles.css
# ... andere gewijzigde bestanden

# Enkel web herstarten (geen rebuild)
docker compose restart web
```

### server.js of database.js gewijzigd

```bash
cp outputs/server.js web/server.js
cp outputs/database.js web/db/database.js

# Enkel web herstarten
docker compose restart web
```

### runner/app.py gewijzigd

```bash
cp outputs/app.py runner/app.py

# Runner rebuild vereist
docker compose up --build -d runner
```

### Nieuwe npm packages (package.json gewijzigd)

```bash
# Volledige rebuild web container
docker compose up --build -d web
```

---

## Eerste leerkracht aanmaken

```bash
# Via CLI script (aanbevolen)
docker compose exec web node scripts/manage-teacher.js add gebruikersnaam wachtwoord

# Of via admin.html na inloggen met .env credentials
# Ga naar: https://app.pycodeflow.org/admin.html
```

---

## Probleemoplossing

### Server start niet op

```bash
docker compose logs web --tail=50
# Zoek naar: [db] FATALE FOUT
# Controleer: DATABASE_URL correct in .env?
# Controleer: postgres container healthy?
docker compose ps
```

### Kan niet inloggen

```bash
# Check: leerkracht aangemaakt?
docker compose exec postgres psql -U pycodeflow -d pycodeflow \
  -c "SELECT username, role FROM teachers;"

# Leerkracht aanmaken
docker compose exec web node scripts/manage-teacher.js add admin wachtwoord
```

### Runner niet bereikbaar

```bash
docker compose logs runner --tail=20
# Verwacht: "Running on http://127.0.0.1:5000"
# Als 0.0.0.0: update app.py en rebuild runner
```

### PostgreSQL data kwijt na herstart

```bash
# Controleer volume mount
docker inspect pycodeflow-postgres-1 | grep Mounts -A 10
# pgdata map moet aanwezig zijn op NAS
ls -la /volume3/docker/pycodeflow/pgdata/
```

---

*PyCodeFlow · Atheneum Hoboken*

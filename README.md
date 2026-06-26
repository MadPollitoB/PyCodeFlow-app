# PyCodeFlow

> **v2026.2.8.0** · Real-time collaboratief Python-codeerplatform · Atheneum Hoboken
> URL: `https://app.pycodeflow.org`

---

## Documentatie

| Document | Inhoud |
|---|---|
| [TECHNICAL.md](TECHNICAL.md) | Architectuur, deployment, API, database schema, Socket.IO events, bestandsindex |
| [SPRINTLOG.md](SPRINTLOG.md) | Sprintplanning & roadmap — nieuwste sprint bovenaan |
| [CHANGELOG.md](CHANGELOG.md) | Versiegeschiedenis per release — nieuwste versie bovenaan |
| [USER-MANUAL.md](USER-MANUAL.md) | Gebruikershandleiding voor systeembeheerder, leerkracht en leerling |

---

## Snelstart

### Eerste installatie
```bash
cd /volume3/docker/pycodeflow
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
docker compose exec web node scripts/manage-teacher.js add <gebruiker> <wachtwoord>
bash check-deployment.sh
```

### Beheer via script
```bash
bash /volume3/docker/pycodeflow/pycodeflow.sh
```

### Verificatie
```bash
bash check-deployment.sh
```

---

## Snel overzicht

```
Browser (leerling / leerkracht)
        │  Socket.IO + HTTP
        ▼
  web container   (Node.js :3000)
  server.js · Express · Socket.IO · SQLite
        │  HTTP intern
        ▼
  runner container (Python Flask :5000)
  app.py · subprocess sandbox
```

| Laag | Technologie |
|---|---|
| Frontend | Vanilla HTML/CSS/JS + Monaco Editor |
| Backend | Node.js 20 + Express + Socket.IO |
| Runner | Python 3.12 + Flask + Gunicorn |
| Database | SQLite via `better-sqlite3` |
| Deployment | Docker Compose + Cloudflare Tunnel |

---

## Huidige versie

| Item | Waarde |
|---|---|
| Versie | v2026.2.8.0 |
| Laatste sprint | Sprint 10 — UX verbeteringen |
| Volgende sprint | Sprint 11 — Kleine features & polish |
| Productie | `https://app.pycodeflow.org` |

---

*PyCodeFlow · Atheneum Hoboken · v2026.2.8.0*

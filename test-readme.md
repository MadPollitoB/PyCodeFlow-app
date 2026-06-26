# PyCodeFlow — Testhandleiding

> Volledig stappenplan per sprint, zowel lokaal als op de NAS.
> Versie: v2026.2.16.0 · Bijgewerkt: juni 2026

---

## Algemene voorbereiding

### Lokaal testen

```bash
# PostgreSQL starten
docker run -d --name pg-test \
  -e POSTGRES_USER=pycodeflow \
  -e POSTGRES_PASSWORD=testpwd \
  -e POSTGRES_DB=pycodeflow \
  -p 5432:5432 postgres:16-alpine

# Runner starten (terminal 1)
cd runner && python app.py

# Web starten (terminal 2)
cd web
POSTGRES_PASSWORD=testpwd node server.js

# Verwachte output:
# [db] DATABASE_URL automatisch opgebouwd uit POSTGRES_PASSWORD
# [db] Schema geïnitialiseerd (PostgreSQL)
# [db] PostgreSQL schema OK
# Listening on http://localhost:3000
```

**URL lokaal:** `http://localhost:3000`

### NAS deployen

```bash
cd /volume3/docker/pycodeflow
docker compose down
# Bestanden kopiëren (zie project-structure.md)
docker compose up --build -d
sleep 30
bash check-deployment.sh
```

---

## Sprint 1–9: Basiswerking

### 1.1 Bereikbaarheid

```
✅ Startpagina laadt (index.html)
✅ Leerkracht login werkt via teacher-login.html
✅ Foutief wachtwoord → "Gebruikersnaam of wachtwoord onjuist."
✅ Na 6 foutieve pogingen → HTTP 429 geblokkeerd
✅ Logout → teruggestuurd naar loginpagina
✅ student-start.html laadt
✅ free-editor.html laadt
```

### 1.2 Sessie lifecycle

```
1. Leerkracht maakt klassessie aan
✅ Sessiecode zichtbaar (8 tekens, A-Z en 2-9)
✅ Sessie verschijnt in overzicht

2. Leerling joint via student-start.html
✅ Naam + code invullen → Deelnemen
✅ Leerling verschijnt in lijst bij leerkracht
✅ Verbindingsdot toont 🟢

3. Leerkracht sluit sessie
✅ Bevestigingsdialoog
✅ Leerlingen teruggestuurd
```

### 1.3 Python code uitvoeren

```python
naam = input("Naam? ")
leeftijd = int(input("Leeftijd? "))
for i in range(3):
    print(f"Hallo {naam}, teller {i}")
print(f"Je bent {leeftijd} jaar")
```

```
✅ Eerste input werkt
✅ TWEEDE input werkt (geen ghost keypresses)
✅ Loop output correct
✅ "===== Compiler klaar met runnen =====" verschijnt
```

### 1.4 Nederlandse foutmeldingen

```python
print(x)   # NameError
```

```
✅ "NameError: name 'x' is not defined"
✅ 💡 Nederlandse uitleg verschijnt
✅ Fout-regel rood gemarkeerd in editor
```

---

## Sprint 10: UX verbeteringen

```
✅ ☀️/🌙 thema toggle — editor + gutter volgen mee
✅ Auto-indent na ":"
✅ Auto-sluiten haakjes en aanhalingstekens
✅ Timer voortgangsbalk groen → oranje → rood
✅ Statusbalk: Ln/Kol, regels, Python
✅ Kopieer knop 📋 op code en output
✅ ⊞ Overzicht grid leerkracht
✅ ? sneltoetsen overlay
✅ Verbindingsdot 🟢/🟠/🔴
```

---

## Sprint 11: Polish & archief

```
✅ Sessie-archief toggle in teacher-sessions.html
✅ Leerling 📜 code-history playback
✅ ⏳ Wachtrij animatie + tijdschatting
✅ Docker memory limiet runner: 256MB
```

---

## Sprint 12: PostgreSQL + Admin-pagina

### 12.1 PostgreSQL verbinding

```bash
docker compose logs web | grep "\[db\]"
✅ [db] DATABASE_URL automatisch opgebouwd uit POSTGRES_PASSWORD
✅ [db] Schema geïnitialiseerd (PostgreSQL)
✅ [db] PostgreSQL schema OK
```

### 12.2 Admin-pagina

```
URL: /admin.html
✅ Drie tabbladen: Leerkrachten / Klassen / Leerlingen
✅ Nieuwe leerkracht toevoegen → kan inloggen
✅ Wachtwoord resetten → nieuw wachtwoord werkt
✅ Klas aanmaken → verschijnt in dropdown bij leerling
✅ CSV import leerlingen (naam,klas per regel)
```

### 12.3 manage-teacher.js (CLI)

```bash
docker compose exec web node scripts/manage-teacher.js list
✅ Leerkrachten zichtbaar

docker compose exec web node scripts/manage-teacher.js add testuser Test1234 teacher
✅ Inloggen als testuser werkt

docker compose exec web node scripts/manage-teacher.js reset-password testuser NieuwWw123
✅ Nieuw wachtwoord werkt

docker compose exec web node scripts/manage-teacher.js delete testuser
✅ Verwijderd
```

---

## Sprint 13: Klas-dropdown + Sessie-config

### 13.1 Klas-dropdown

```
Vereiste: klas aangemaakt in admin.html

✅ student-start.html toont dropdown (niet tekstveld)
✅ Keuze bewaard na page refresh (localStorage)
✅ Fallback tekstveld als geen klassen bestaan
```

### 13.2 Sessie-config paneel (⚙️)

```
1. Open teacher-app.html in actieve sessie
2. Klik ⚙️ in toolbar
✅ 5 schakelknoppen zichtbaar
✅ Klasmodus: alles AAN bij opening
✅ Examenmodus: alles UIT bij opening

Zet "Auto-indent na :" UIT:
✅ Leerling typt "def test():" + Enter → GEEN inspringing

Live synchronisatie:
✅ Wijziging onmiddellijk actief bij leerling (geen reload)
```

### 13.3 Toegangslogica

```
Bekende leerling (staat in DB, status active):
✅ Geen badge bij leerkracht

Onbekende leerling:
✅ ⚠️ Nieuw badge bij leerkracht
✅ ✓ aanvaarden → badge verdwijnt

Geblokkeerde leerling:
✅ "Je hebt geen toegang" foutmelding
✅ Kan niet joinen
```

---

## Sprint 16: Toetsmodule

### 16.1 Vragenbank

```
URL: /quiz-bank.html

✅ Nieuwe vraag aanmaken (type: code/open/single/multiple)
✅ Bij single/multiple: opties toevoegen + juiste aanduiden
✅ Markdown preview beschikbaar (👁 knop)
✅ CSV import: onderwerp,moeilijkheid,max_punten,vraag
✅ Archiveren + verwijderen (met bevestiging)
✅ Vraagtype badge zichtbaar op kaart
```

### 16.2 Toets aanmaken

```
URL: /quiz-teacher.html

✅ Wizard 3 stappen
✅ Timer instellen OF geen tijdslimiet kiezen
✅ Tijdsvenster instellen (van/tot)
✅ Random volgorde standaard aangevinkt
✅ Vragen selecteren uit bank met filter
✅ Punten per vraag aanpasbaar
✅ Preview als leerling (LEERKRACHT TEST badge)
✅ Sessie aangemaakt → code zichtbaar
```

### 16.3 Leerling quizscherm

```
URL: /quiz-student.html?code=XXXXXXXX&name=...

START TOETS scherm:
✅ Timer start PAS bij klikken op START TOETS
✅ Naam en klas zichtbaar

Vraagnavigator:
✅ Grijs = niet bezocht
✅ Blauw = bezocht
✅ Groen ✓ = opgeslagen
✅ Bij navigatie: antwoord automatisch opgeslagen

Vraagtypen:
✅ Code: Monaco editor + Run knop
✅ Open: textarea met tekenteller (max 2000)
✅ Single: radio buttons
✅ Multiple: checkboxes

Timer:
✅ 10% resterend → oranje waarschuwing banner
✅ Timer = 0 → editor vergrendelt → auto-submit
✅ Geen timer (taak) → ∞ symbool

Tijdsvenster:
✅ Voor access_from → "nog niet beschikbaar" melding
✅ Na access_until → te-laat scherm
```

### 16.4 Indienpagina

```
Klik "📤 Indienen":
✅ Checklist per vraag:
   ✅ opgeslagen + gerund
   ⚠️ opgeslagen maar niet gerund
   ⚠️ niet bezocht
✅ Kan toch indienen (eigen verantwoordelijkheid)
✅ Bevestigingsscherm na indiening
```

### 16.5 Verbetermodule

```
URL: /quiz-review.html?code=XXXXXXXX

✅ Leerlingenlijst links met score voortgang
✅ Vraag tabs met score per vraag

Code vragen:
✅ Monaco editor (read-only)
✅ ▶ Uitvoeren werkt
✅ ✏️ Aanpassen & testen → tijdelijk editable
✅ 📜 Run history toonbaar

Open vragen:
✅ Antwoord zichtbaar als tekst

Meerkeuze/single:
✅ ✅ Correct gekozen (groen)
✅ ❌ Fout gekozen (rood)
✅ ☑ Correct maar niet gekozen (geel)
✅ 🤖 Auto-gescoord badge bij meerkeuze/single
✅ Score aanpasbaar door leerkracht

Gelijkenis detectie:
✅ ⚠️ Verdachte gelijkenis waarschuwing bij >80%

Resultaten vrijgeven:
✅ 🔓 Vrijgeven → leerlingen zien scores
```

### 16.6 PDF export

```
Via quiz-review.html:
✅ 🖨️ PDF vragenblad → Type 1
✅ 🖨️ PDF antwoordformulier → Type 2a (zonder scores)
✅ 🖨️ PDF antwoordformulier + scores → Type 2b
✅ 📊 Klasoverzicht → Type 3
✅ ⬇ TXT export (alle antwoorden per leerling)
```

---

## Sprint 17: Log rotatie + Archief

### 17.1 Log rotatie

```bash
# Check dat LOG_RETENTION_DAYS in .env staat
grep LOG_RETENTION_DAYS /volume3/docker/pycodeflow/.env
✅ LOG_RETENTION_DAYS=7

# Log cleanup API
curl -sf http://localhost:3000/api/admin/logs/info \
  -H "Cookie: teacher_auth=..." | python3 -m json.tool
✅ totalFiles, totalMB, oldCount, retentionDays zichtbaar
```

### 17.2 Toets-archief

```
URL: /quiz-archive.html

✅ Tab "Overzicht": toetsen filterbaar op jaar/klas/status
✅ Statistieken per vraag (gemiddelde, %)
✅ Archiveren → grijs, deblokkeerbaar
✅ Verwijderen → naam bevestiging vereist
✅ Tab "Per leerling": zoek op naam → alle toetsen + scores
✅ Tab "Nieuw schooljaar": preview + archiveert alles in één klik
```

---

## Sprint 18: Vraagtypen

### 18.1 Meerkeuze aanmaken

```
quiz-bank.html → Nieuwe vraag → ☑ Meerkeuze:
✅ Minimaal 2 opties
✅ Maximaal 8 opties
✅ Minimaal 1 juist antwoord verplicht
✅ Opslaan → vraagtype badge "☑ Keuze" zichtbaar

Single choice:
✅ Slechts 1 juist antwoord selecteerbaar
```

### 18.2 Automatische scoring

```
Leerling maakt toets met meerkeuze vragen:
Na indienen:
✅ Meerkeuze/single vragen automatisch gescoord
✅ Verbetermodule toont 🤖 badge
✅ Leerkracht kan score overschrijven
```

---

## Sprint 19: Betrouwbaarheid & uitbreidingen

### 19a Vrije editor localStorage

```
1. Open free-editor.html
2. Schrijf code
3. Ververs de pagina (F5)
✅ Code is hersteld uit localStorage
✅ Autosave elke 5 seconden
```

### 19a Versie-endpoint

```bash
curl -s http://localhost:3000/api/version | python3 -m json.tool
✅ version, uptime, node zichtbaar
```

### 19b Schoollogo

```bash
# In .env:
SCHOOL_NAME=Atheneum Hoboken
# SCHOOL_LOGO_PATH=/app/public/assets/logo.png (optioneel)

✅ GET /api/school-info → name en logoUrl
✅ Schoolnaam zichtbaar in PDF export headers
```

### 19e Health monitor

```bash
# Na installatie via pycodeflow.sh → optie 15:
crontab -l | grep health-monitor
✅ */5 * * * * ... health-monitor.sh

# Test handmatig:
bash /volume3/docker/pycodeflow/health-monitor.sh
✅ Geen output als alles OK
✅ Log entry in logs/health.log
```

### 19g Sessie-config persistent

```
1. Open sessie, stel ⚙️ Auto-indent UIT
2. Herstart server: docker compose restart web
3. Open sessie opnieuw
✅ Auto-indent staat nog steeds UIT
```

### 19i PostgreSQL backup

```bash
# Via pycodeflow.sh → optie 16 → "Nu een backup maken":
✅ Backup aangemaakt in backups/
✅ Bestand: pycodeflow-YYYYMMDD-HHMM.sql.gz
✅ Log entry in backups/backup.log

# Via cron (dagelijks 02:00):
crontab -l | grep backup-db
✅ 0 2 * * * .../backup-db.sh

# Restore testen:
pycodeflow.sh → 16 → 3 (herstel)
✅ Selecteer backup → bevestig → data hersteld
```

### 19j Tijdsvenster

```
Toets aanmaken met tijdsvenster:
  Van: morgen 09:00
  Tot: morgen 10:00

Leerling probeert te joinen VOOR de tijd:
✅ "Deze toets/taak is nog niet beschikbaar. Toegang start op ..."

Leerling probeert te joinen NA de deadline:
✅ "Inlevertermijn verstreken" scherm
✅ "TAAK NIET TIJDIG INGELEVERD" zichtbaar

Leerling is bezig EN deadline verstrijkt:
✅ Editor vergrendelt automatisch
✅ Antwoorden ingediend
```

---

## Beveiligingstests

### CSP headers

```bash
curl -I https://app.pycodeflow.org 2>/dev/null | grep -i content-security
✅ content-security-policy aanwezig
✅ worker-src 'self' blob: aanwezig
❌ unsafe-eval MAG NIET aanwezig zijn
```

### Rate limiting

```bash
for i in {1..7}; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST \
    https://app.pycodeflow.org/api/teacher-login \
    -H "Content-Type: application/json" \
    -d '{"username":"test","password":"fout"}'
done
✅ Eerste 6: 401
✅ Zevende: 429
```

---

## Regressietests (na elke deploy)

```bash
# Containers actief
docker compose ps
✅ postgres: healthy
✅ web: running (healthy)
✅ runner: running
✅ cloudflared: running

# Web bereikbaar
curl -sf http://localhost:3000/health
✅ HTTP 200

# Versie correct
curl -s http://localhost:3000/api/version | grep version
✅ Huidige versie

# PostgreSQL bereikbaar + leerkrachten aanwezig
docker compose exec web node scripts/manage-teacher.js list
✅ Minstens 1 leerkracht

# Geen fouten in logs
docker compose logs web --tail=10 | grep -iE "FOUT|ERROR|FATAL|Cannot find"
✅ Geen kritieke fouten

# Check-deployment
bash check-deployment.sh
✅ 0 gefaald
```

---

## Bekende beperkingen

| Situatie | Gedrag | Reden |
|---|---|---|
| Google/Smartschool login | Niet beschikbaar | Uitgesteld |
| Mobiele editor | Beperkt | Monaco werkt niet goed op touch |
| Word import vragenbank | Niet beschikbaar | Niet gepland |
| Dark mode UI | Enkel editor | UI dark mode niet gepland |

---

*PyCodeFlow · Atheneum Hoboken · test-readme.md · v2026.2.16.0*

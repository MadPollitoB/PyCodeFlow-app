# PyCodeFlow — Testhandleiding

> Volledig stappenplan om alle sprints te testen, zowel lokaal als op de NAS.
> Per sprint zijn de teststappen gegroepeerd. Voer altijd de algemene checks eerst uit.

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
cd web && node server.js

# Verwachte output:
# [db] PostgreSQL schema OK
# Server luistert op poort 3000
```

**URL lokaal:** `http://localhost:3000`

### NAS deployen

```bash
cd /volume3/docker/pycodeflow

# Bestanden kopiëren
cp outputs/server.js        web/server.js
cp outputs/app.js           web/public/app.js
cp outputs/styles.css       web/public/styles.css
cp outputs/database.js      web/db/database.js
# ... (zie install.md voor volledige lijst)

# Herstarten (geen rebuild bij HTML/CSS/JS wijzigingen)
docker compose restart web

# Rebuild (bij server.js, database.js, of app.py wijzigingen)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d

# Verificatie
bash check-deployment.sh
docker compose logs web --tail=20 | grep -E "OK|FOUT|ERROR"
```

**URL NAS:** `https://app.pycodeflow.org`

---

## Sprint 1–8: Basiswerking

### 1.1 Bereikbaarheid

```
✅ Startpagina laadt (index.html)
✅ Leerkracht login werkt
✅ Foutief wachtwoord → geweigerd
✅ Na 6 foutieve pogingen → 30 min geblokkeerd (HTTP 429)
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
✅ Leerling verschijnt in leerlingenlijst bij leerkracht
✅ Verbindingsdot toont 🟢

3. Leerling verbreekt verbinding (sluit tabblad)
✅ Leerling wordt grijs in de lijst

4. Leerkracht sluit sessie
✅ Bevestigingsdialoog verschijnt
✅ Na bevestiging → leerlingen teruggestuurd
```

### 1.3 Code synchronisatie

```python
# Testcode: leerkracht typt dit in de editor
print("Hallo klas!")
naam = input("Naam? ")
print("Welkom", naam)
```

```
✅ Leerling ziet de code live verschijnen
✅ Leerling runt → "Hallo klas!" verschijnt in output
✅ "Naam?" → invoerveld verschijnt bij leerling
✅ Leerling typt naam → [naam] echo zichtbaar
✅ "Welkom naam" output correct
✅ "===== Compiler klaar met runnen =====" verschijnt
```

### 1.4 Meerdere inputs (kritieke test)

```python
naam = input("Naam? ")
print("Hallo", naam)
leeftijd = int(input("Leeftijd? "))
stad = input("Stad? ")
print(f"{naam} ({leeftijd}) uit {stad}")
```

```
✅ Eerste input werkt, echo zichtbaar
✅ TWEEDE inputveld wordt actief (niet automatisch overgeslagen)
✅ Derde inputveld wordt actief
✅ Volledige output correct
```

### 1.5 Code history (Sprint 8)

```
1. Leerling schrijft code en runt meerdere keren
2. Leerkracht klikt op leerling → 📜 History
✅ Playback modal opent
✅ Tijdlijn toont meerdere snapshots
✅ Slider en play-knop werken
```

---

## Sprint 9: Technische schuld & bugfixes

### 9.1 Nederlandse foutuitleg

```python
# Test: NameError
print(x)
```

```
✅ "NameError: name 'x' is not defined"
✅ "💡 Je gebruikt een variabele..." uitleg zichtbaar
✅ Fout-regel rood gemarkeerd in editor
✅ Hover over markering → tooltip met foutmelding
✅ Nieuwe run → rode markering verdwenen
```

```python
# Test: TypeError
print("leeftijd: " + 25)
```

```
✅ "TypeError: can only concatenate str..."
✅ Nederlandse uitleg verschijnt
```

### 9.2 Annotatie persistentie

```
1. Leerkracht stuurt annotatie naar leerling
2. Server herstarten (docker compose restart web)
3. Leerling herverbindt
✅ Annotatie nog steeds zichtbaar
```

### 9.3 Timer cleanup

```
1. Start timer 2 minuten
2. Sluit sessie af
3. Open nieuwe sessie
✅ Geen timer meer actief in nieuwe sessie
✅ Geen foutmeldingen in logs na sessie-sluiting
```

---

## Sprint 10: UX verbeteringen

### 10.1 Editor thema

```
✅ ☀️ knop in toolbar → witte editor
✅ Gutter (regelnummers) volgt mee → lichtgrijs
✅ Output paneel volgt mee → witte achtergrond
✅ Statusbalk volgt mee → grijze achtergrond
✅ 🌙 knop → terug naar donker
✅ Refresh pagina → thema behouden (localStorage)
✅ Leerkracht donker, leerling licht → onafhankelijk van elkaar
```

### 10.2 Statusbalk

```
✅ Zichtbaar onderaan de editor na aanmaken
✅ Leerkracht: "Ln 1, Kol 1 | 1 regels | Python | UTF-8 | Spaties: 4"
✅ Leerling: "Ln 1, Kol 1 | 1 regels"
✅ Update bij cursorbewegingen (Ln/Kol veranderen)
```

### 10.3 Auto-functies editor

```python
# Tik "def test():" + Enter
✅ 4 spaties ingesprongen automatisch

# Tik "("
✅ "()" met cursor ertussen

# Tik '"'
✅ '""' met cursor ertussen
```

### 10.4 Kopieer knoppen

```
✅ 📋 in code-toolbar → code op klembord + "✓ Gekopieerd!" feedback
✅ 📋 bij output → output op klembord
```

### 10.5 Auto-scroll output

```python
for i in range(50):
    print(f"Regel {i}")
```

```
✅ Output scrolt automatisch mee naar beneden
✅ Handmatig omhoog scrollen → auto-scroll stopt
✅ Scroll naar beneden → auto-scroll hervat
```

### 10.6 Leerkrachten-app UX

```
✅ Statusfilter "✓ Klaar" → enkel klaar-leerlingen zichtbaar
✅ Statusfilter "✋ Hand" → enkel leerlingen met hand omhoog
✅ ⊞ Overzicht → grid met naam, status-badge en code-preview
✅ Klik op leerling in grid → Live control opent
✅ Live run-status: ▶ bij actieve run, ⌨️ bij input wachten
✅ ? knop → sneltoetsen overlay
✅ ↑/↓ toetsenbordnavigatie in leerlingenlijst
✅ Enter → Live control gefocuste leerling
```

### 10.7 Timer

```
1. Leerkracht start timer op 3 minuten
✅ Leerling ziet afteller
✅ Voortgangsbalk: groen bij >1 min, oranje bij <1 min, rood bij <30s
✅ Timer verloopt → "Tijd is om" melding bij leerling
2. Leerkracht stopt timer vroeger
✅ Afteller verdwijnt bij leerling
```

### 10.8 Annotaties + templates

```
1. Leerkracht opent 📌 paneel
2. Klik op template "Let op de inspringing!"
✅ Tekstveld gevuld met templatetekst
3. Selecteer regels 2-3, kleur geel, verstuur
✅ Leerling ziet gele markering op regels 2-3
✅ Hover → tekst zichtbaar
4. Server herstarten → leerling herverbindt
✅ Annotatie nog steeds zichtbaar
```

### 10.9 Examenmodus tab-detectie

```
1. Maak een examensessie aan
2. Leerling joint
3. Leerling wisselt naar een ander tabblad
✅ "⚠️ Tab weg" badge verschijnt bij leerkracht
4. Leerling keert terug
✅ Badge verdwijnt
```

---

## Sprint 11: Polish & archief

### 11.1 Gutter thema (11A)

```
✅ Donker thema → gutter donkerblauw (#1f2f57)
✅ Licht thema → gutter lichtgrijs (#e8edf5)
✅ Toggle → gutter wisselt onmiddellijk mee
```

### 11.2 Sessie-archief (11B)

```
1. Sluit een sessie af (bevestig dialoog)
2. Ga naar sessieoverzicht (teacher-sessions.html)
✅ Gesloten sessie niet zichtbaar standaard
3. Vink "Toon gesloten sessies" aan
✅ Gesloten sessie verschijnt grijs met 🔒 icoon
✅ Enkel "⬇ Export" knop beschikbaar
✅ "Open" en "Verwijderen" knoppen NIET aanwezig
4. Vink uit
✅ Gesloten sessies verdwijnen
```

### 11.3 Leerling code-history (11C)

```
1. Leerling schrijft code → run → wijzig → run opnieuw
2. Leerling klikt 📜 in de toolbar
✅ History modal opent
✅ Meerdere snapshots zichtbaar op tijdlijn
✅ Play-knop → code verandert automatisch
✅ Slider → spring naar specifiek moment
```

### 11.4 Wachtrij animatie (11D)

```
(Simuleer: meerdere leerlingen runnen tegelijk zware code)
✅ "⏳ In wachtrij — positie X · geschatte wachttijd ~Xs"
✅ ⏳ icoontje pulseert/roteert
```

### 11.5 Autocheck badge (11E)

```
# Badge verschijnt dagelijks om 06:00
# Voor testen: kijk na 06:00 de volgende dag
✅ Badge rechtsboven in teacher-sessions.html
✅ Groen ✅ bij succes, rood ❌ bij falen + tijdstip
✅ Klik badge → monitoring.html opent
```

### 11.6 Docker memory limiet (11G)

```bash
docker stats pycodeflow-runner-1 --no-stream
✅ MEM LIMIT: 256MiB
✅ CPU %: maximaal 100% (1 core)
```

---

## Sprint 12: PostgreSQL + Admin-pagina

### 12.1 PostgreSQL verbinding (12a)

```bash
# Logs bij startup
docker compose logs web | grep "\[db\]"
✅ [db] PostgreSQL schema OK
✅ [auth] X leerkracht(en) geladen

# Tabellen controleren
docker compose exec postgres psql -U pycodeflow -d pycodeflow -c "\dt"
✅ Alle tabellen aanwezig:
   teachers, sessions, code_snapshots, session_annotations,
   classes, teacher_classes, students
```

### 12.2 Migratescript (12a)

```bash
docker compose exec web node scripts/migrate-sqlite-to-pg.js
✅ "Migratie geslaagd!" in output
✅ Aantallen PostgreSQL >= aantallen SQLite
✅ Bestaande leerkrachten kunnen nog inloggen
✅ Bestaande sessies zichtbaar na herstart
```

### 12.3 Server herstart persistentie

```bash
docker compose restart web
✅ Binnen 15s bereikbaar
✅ Sessies hersteld uit PostgreSQL
✅ Leerkracht kan inloggen
✅ Geen FATAL of ERROR in logs
```

### 12.4 Admin pagina — Leerkrachten (12b)

```
URL: /admin.html

✅ Drie tabbladen zichtbaar: Leerkrachten / Klassen / Leerlingen

Nieuwe leerkracht toevoegen:
  Gebruikersnaam: "testleerkracht"
  Wachtwoord: "Test1234!"
  Weergavenaam: "Test Leerkracht"
  Rol: Leerkracht

✅ Verschijnt in tabel
✅ Inloggen met testleerkracht/Test1234! werkt
✅ 🔑 Wachtwoord resetten → nieuw wachtwoord werkt
✅ ↑ Admin → badge wijzigt
✅ ↓ Leerkracht → badge terug
✅ Verwijderen → verdwenen
```

### 12.5 Admin pagina — Klassen (12b)

```
Nieuwe klas: "6A Informatica" + "2025-2026"
✅ Verschijnt in tabel met leerlingenaantal 0
Tweede klas: "6B Informatica"
✅ Beide zichtbaar

✅ Archiveren → grijs, verborgen tenzij toggle
✅ Verwijderen lege klas → verdwenen
✅ Verwijderen klas met leerlingen → foutmelding
```

### 12.6 Admin pagina — Leerlingen (12c)

**CSV import:**
```
Emma Janssens,6A Informatica
Luca Peeters,6A Informatica
Sara Declercq,6B Informatica
Onbekend,7A
```

```
✅ Rapport: "3 toegevoegd · 0 overgeslagen · 1 klassen aangemaakt"
✅ Tweede import zelfde data → "0 toegevoegd · 3 overgeslagen"
✅ Filter op klas → enkel leerlingen van die klas
✅ Naam zoeken → live filteren
✅ Status blokkeren → rode badge
✅ Deblokkeren → groene badge
✅ Notitie toevoegen → opgeslagen na herlaad
✅ Verwijderen → verdwenen
```

---

## Sprint 13: Klas-dropdown + Sessie-config

### 13.1 Klas-dropdown (13B)

**Vereiste voorbereiding:** klas "6A Informatica" aanmaken in admin.html.

```
1. Ga naar student-start.html
✅ Klas-dropdown verschijnt (geen vrij tekstveld)
✅ "— Geen klas / Gast —" als eerste optie
✅ "6A Informatica" in lijst

2. Selecteer klas → Deelnemen
✅ Keuze hersteld na page refresh (localStorage)

3. Verwijder alle klassen uit DB
✅ Vrij tekstveld verschijnt als fallback
```

### 13.2 Toegangslogica bij joinen (13B)

```
Voorbereiding: "Emma Janssens" toevoegen in 6A via admin.html

Test 1: bekende leerling
  Naam: "Emma Janssens", Klas: "6A Informatica"
✅ Geen badge bij leerkracht (status: active)

Test 2: onbekende leerling
  Naam: "Jan Pieters", Klas: "6A Informatica"
✅ Badge ⚠️ Nieuw bij leerkracht
✅ Jan staat als "pending" in admin.html

Test 3: gast (geen klas)
  Naam: "Anoniem", Klas: "— Geen klas / Gast —"
✅ Badge 👤 Gast bij leerkracht

Test 4: geblokkeerde leerling
  Blokkeer Emma via admin.html of via badge-actie
  Emma probeert te joinen
✅ Foutmelding: "Je hebt geen toegang tot deze sessie."
✅ Emma kan niet joinen
```

### 13.3 Duplicaat-detectie (13B)

```
1. Emma Janssens joint sessie
2. Open tweede browser/incognito
3. Probeer ook als "Emma Janssens" te joinen
✅ Foutmelding: "Er is al iemand met de naam 'Emma Janssens'..."
✅ Eerste Emma blijft verbonden
```

### 13.4 Inline badge beheer (13C)

```
Bij leerling met ⚠️ Nieuw badge:
✅ ✓ knop → badge verdwijnt direct
✅ Status in admin.html is nu "active"

Bij leerling met ⏳ Afwachting badge:
✅ ✓ Aanvaarden → badge verdwijnt

Klas toewijzen via badge:
✅ → Klas dropdown toont klassen
✅ Selecteer klas → badge verdwijnt
✅ Leerling zichtbaar onder die klas in admin.html
```

### 13.5 Sessie-config paneel (13A)

```
1. Open teacher-app.html in actieve sessie
2. Klik ⚙️ in de toolbar
✅ Paneel opent rechts
✅ 5 schakelknoppen zichtbaar
✅ Examenmodus → alle schakelknoppen UIT bij opening
✅ Klasmodus → alle schakelknoppen AAN bij opening

Test auto-indent uitschakelen:
  Zet "Auto-indent na :" UIT
  Leerling typt "def test():" + Enter
✅ GEEN automatische inspringing bij leerling
✅ Leerkracht-editor ongewijzigd

Test suggesties uitschakelen:
  Zet "Autocomplete suggesties" UIT
  Leerling typt "pri"
✅ GEEN dropdown-suggesties

Test live synchronisatie:
  Wijzig instelling → leerling merkt dit onmiddellijk
✅ Editor-gedrag verandert zonder pagina te herladen

Fout-regel markering:
✅ Checkbox staat altijd aan en is disabled (niet klikbaar)
✅ Rode markering blijft altijd zichtbaar bij fouten
```

### 13.6 Config bij examenmodus

```
1. Maak een examensessie aan
2. Leerling joint
✅ Auto-indent UIT (leerling inspringt niet automatisch)
✅ Auto-sluiten haakjes UIT ("(" geeft enkel "(")
✅ Autocomplete UIT (geen dropdown bij typen)
✅ Fout-regel markering AAN (hover toont foutmelding)
✅ Foutmeldingen in output AAN
✅ Nederlandse 💡 uitleg AAN

3. Leerkracht opent ⚙️ → zet "Auto-indent" AAN
✅ Leerling krijgt onmiddellijk auto-indent terug
```

---


## Sprint 12a-D: Monaco bundelen + CSP

### CSP headers verifiëren

```bash
curl -I https://app.pycodeflow.org 2>/dev/null | grep -i "content-security"
```

```
✅ unsafe-eval NIET aanwezig in content-security-policy
✅ worker-src 'self' blob: aanwezig
✅ nonce-{...} aanwezig in script-src
```

### Monaco werkt nog correct

```
1. Open teacher-app.html → maak sessie aan
✅ Editor laadt correct (Monaco syntax highlighting actief)
✅ Geen console errors over CSP violations
   (Open browser DevTools → Console → geen rode CSP-berichten)

2. Student-app.html → leerling joint
✅ Editor laadt correct bij leerling
✅ Syntax highlighting Python actief

3. Free-editor.html
✅ Editor laadt correct
✅ Code schrijven en runnen werkt

4. Monaco workers actief
   Browser DevTools → Network → filter op "worker"
✅ editor.worker.js geladen via blob: URL
```

### Beveiligingsscore valideren

```bash
curl -I https://app.pycodeflow.org 2>/dev/null | grep -i content-security

# Verwacht:
✅ content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'nonce-...'; ... worker-src 'self' blob:; ...
❌ unsafe-eval mag NIET aanwezig zijn
```

---
## Beveiligingstests

### Security headers

```bash
curl -I https://app.pycodeflow.org 2>/dev/null | \
  grep -iE "content-security|x-frame|x-content-type|strict-transport|referrer|permissions|powered"

✅ content-security-policy: aanwezig
✅ x-frame-options: DENY
✅ x-content-type-options: nosniff
✅ strict-transport-security: max-age=31536000
✅ referrer-policy: strict-origin-when-cross-origin
✅ permissions-policy: camera=(), microphone=(), geolocation=()
❌ x-powered-by: MAG NIET aanwezig zijn
```

### Cookie-attributen

```
Browser DevTools → Application → Cookies
✅ teacher_auth aanwezig na inloggen
✅ HttpOnly: ✓
✅ Secure: ✓
✅ SameSite: Strict
```

### Isolatie runner en database

```bash
# Runner niet extern bereikbaar
curl -m 5 https://app.pycodeflow.org:5000/health
✅ Connection refused of timeout

# PostgreSQL niet extern bereikbaar
curl -m 5 https://app.pycodeflow.org:5432
✅ Connection refused of timeout
```

### Sessie code

```
1. Maak een nieuwe sessie aan
✅ Code is 8 tekens lang
✅ Code bevat enkel A-Z (zonder I en O) en 2-9
✅ Twee sessies hebben nooit dezelfde code
```

### Rate limiting login

```bash
# 7 foutieve loginpogingen
for i in {1..7}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST https://app.pycodeflow.org/login \
    -d "username=test&password=fout"
done
# Eerste 6: 401
# Zevende: 429
✅ HTTP 429 na 6 pogingen
✅ Retry-After header aanwezig
```

---

## Regressietests

Na elke deploy uitvoeren:

### Resources

```bash
docker stats --no-stream --format \
  "table {{.Name}}\t{{.MemUsage}}\t{{.MemLimit}}\t{{.CPUPerc}}"

✅ web: < 200MB RAM
✅ runner: < 256MB RAM (door Docker limiet)
✅ postgres: < 100MB RAM
```

### Memory leak check

```bash
# Noteer geheugen voor gebruik
docker stats pycodeflow-web-1 --no-stream | grep web

# Gebruik 30 minuten normaal (sessies aanmaken, code runnen)

# Noteer geheugen na gebruik
docker stats pycodeflow-web-1 --no-stream | grep web

✅ Verschil < 50MB (geen significante leak)
```

### Herstart-test

```bash
docker compose restart web
# Wacht 15 seconden
curl -s -o /dev/null -w "%{http_code}" https://app.pycodeflow.org/health
✅ HTTP 200

# Inloggen werkt
# Sessies hersteld
# Geen ERROR in logs:
docker compose logs web --tail=20 | grep -i "error\|fatal"
✅ Geen fouten
```

### Volledige Python-test

```python
naam = input("Naam? ")
leeftijd = int(input("Leeftijd? "))
for i in range(3):
    print(f"Hallo {naam}, teller {i}")
print(f"Je bent {leeftijd} jaar")
```

```
✅ Beide inputs werken (geen ghost keypresses)
✅ Loop-output volledig
✅ "Compiler klaar" bericht
✅ Geen foutmeldingen in logs
```

---

## Bekende beperkingen

| Situatie | Verwacht gedrag | Reden |
|---|---|---|
| `unsafe-eval` in CSP | Aanwezig | Monaco AMD-loader vereist dit — fix in sprint 12a-D |
| Autocheck badge leeg | Geen badge tot 06:00 | Badge verschijnt na eerste dagelijkse check |
| Sessie-config niet persistent | Bij herstart terug naar standaard | In-memory opslag — bewuste keuze |
| Geblokkeerde leerling niet live verwijderd | Pas geblokkeerd bij volgende join | Geldt pas bij volgende verbindingspoging |
| 8-tekens sessiecodes | Correct | Was 6 tekens in versies voor v2026.2.8.4 |
| Google/Smartschool login | Niet beschikbaar | Uitgesteld naar latere sprint |

---

*PyCodeFlow · Atheneum Hoboken · test-readme.md*

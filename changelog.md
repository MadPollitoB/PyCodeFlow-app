## v2026.2.24.0 — Sprint 24: UI/UX ronde 2

### 24a — pyToast + pyConfirm (al in v2026.2.23.4)
Zie v2026.2.23.4 — vervroegd geleverd.

### 24b — Vraagstelling rendeert als Markdown in kaartweergave
Code-snippets in vraagstellingen (backtick-blokken) worden nu gerenderd als opgemaakt code-blok in de vragenbank-kaarten, niet enkel in de Preview. Gebruikt `marked.parse()` + `md-preview` CSS. Kaartinhoud begrensd op max. 140px hoogte met scroll.

### 24c — Single/meerkeuze keuze-opties layout volledig herschreven
`.choice-row` omgezet van flex naar CSS grid (selector | body | remove). `.choice-body` heeft nu `min-width:0` en `width:100%`. Correcte opties krijgen een blauwe rand + "✓ Correct antwoord" label. `</> Naar code` / `</> Naar tekst` toggle staat binnen de kaart.

### 24d — Wisselen single↔meerkeuze herrendert opties correct
`onTypeChange()` roept nu altijd `renderChoices()` aan, ook als er al opties zijn. Radio's wisselen correct naar checkboxes en omgekeerd.

### 24e — "Nieuwe toets" checkboxes gebruiken checkbox-row card-stijl
"Vraagstelling verbergen", "Min. 1 run vereisen" en "Test als leerkracht" gebruiken nu de consistente `checkbox-row` card-stijl i.p.v. losse labels.

### 24f — Sessieoverzicht lopende sessies compacter en overzichtelijker
`renderSessions()` herschreven: sessiekaarten zijn compacter (grid voor meta, code-badge in primary kleur), knoppen op één rij. Gesloten sessies compacter met datum inline.

### 24g — Database viewer in monitoring.html
Twee nieuwe API-endpoints: `GET /api/admin/db/tables` en `GET /api/admin/db/tables/:name/rows`. In monitoring.html: tabelgrid (kleurgecodeerd per categorie), klik opent scrollbare tabelinhoud onder het grid, zoekbalk, paginering (50 rijen). Gevoelige kolommen (password_hash, etc.) worden server-side gemaskeerd. Whitelist van 16 toegestane tabelnamen.

### 24h — admin.html topbar opgeruimd
"← Sessies" en "📊 Monitoring" knoppen verwijderd uit primaire topbar. Topbar gebruikt nu `topbar-inner` wrapper consistent met andere pagina's. "Afmelden" knop toegevoegd.

**Betrokken bestanden:** `quiz-bank.html` · `quiz-teacher.html` · `admin.html` · `monitoring.html` · `teacher-sessions.html` · `app.js` · `server.js` · `.env`

---

## v2026.2.23.4 — Hotfix: leerling toevoegen + in-app modals (24a)

### Bugfix: constraint "idx_students_name_class" does not exist

`ON CONFLICT ON CONSTRAINT` werkt niet op partial indexes in PostgreSQL. `createStudent()` herschreven: controleert eerst via SELECT of naam+klas al bestaat, dan pas INSERT. Geen named constraint meer nodig.

### Sprint 24a (vroeg): pyToast + pyConfirm live

`window.pyToast(message, type, duurMs)` en `window.pyConfirm({ title, body, confirmLabel, danger })` toegevoegd aan `app.js`. Alle `alert()` en `confirm()` in `admin.html` en `quiz-bank.html` vervangen door deze in-app varianten. Styling via geïnjecteerde CSS (modal overlay + toast rechtsonder).

**Betrokken bestanden:** `database.js` · `app.js` · `admin.html` · `quiz-bank.html`

---

## v2026.2.23.3 — Hotfix: geneste template literals + io() crash

### Bugfix: SyntaxError door geneste backtick template literals

`renderQuestions()` gebruikte backtick template literals binnen een outer backtick literal voor de onclick-knoppen. Dit brak de JS parser. Opgelost door over te schakelen naar **event delegation**: knoppen krijgen CSS-klassen (`q-btn-edit`, `q-btn-delete`, etc.), de kaart krijgt `data-qid`, en één `click`-listener op de grid handelt alles af. Apostrofs en backticks in vraagteksten zijn nu volledig irrelevant voor de knoppen.

### Bugfix: `io is not defined` op quiz-bank.html

`app.js` lijn 2 riep `io()` aan op elke pagina, ook op pagina's zonder Socket.IO (quiz-bank, admin, monitoring, ...). Fix: `io()` wordt nu enkel aangeroepen als de pagina in de whitelist zit én als `typeof io !== "undefined"`. Op andere pagina's krijgt `socket` een no-op stub.

**Betrokken bestanden:** `quiz-bank.html` · `app.js`

---

## v2026.2.23.2 — Hotfix: apostrof crasht verwijderknop + CSP fix

### Bugfix: SyntaxError bij vraagtekst met apostrof

`esc()` escapede geen apostrofs waardoor `onclick="verwijderOfArchiveer('...Dit is een zin.'...')"` een SyntaxError gaf. Nieuwe `escAttr()` helper vervangt ook `'` door `&#39;`. Alle `onclick`-attributen op vraagteksten gebruiken nu `escAttr()`.

### Bugfix: CSP blokkeerde marked.js van cdnjs.cloudflare.com

`script-src` uitgebreid met `https://cdnjs.cloudflare.com` zodat de Markdown preview in de vragenbank correct laadt.

**Betrokken bestanden:** `quiz-bank.html` · `server.js`

---

## v2026.2.23.1 — Hotfix: vragenbank verwijderknop

### Bugfix: niet-gearchiveerde vragen konden niet verwijderd worden

**Probleem:** de "Archiveren"-knop werd altijd getoond op actieve vragen, ook als ze nergens aan gekoppeld waren. Er was geen manier om een losse vraag direct te verwijderen zonder haar eerst te archiveren.

**Fix:** de "Archiveren"-knop op niet-gearchiveerde vragen vervangen door een slimme "Verwijderen"-knop (`verwijderOfArchiveer()`):
- Vraag **niet in gebruik** in een toets → direct definitief verwijderd
- Vraag **wel in gebruik** → server geeft melding, gebruiker krijgt keuze om te archiveren

**Flow overzicht:**

| Toestand | Knoppen |
|---|---|
| Actieve vraag, niet in toets | ✏️ Bewerken · 🗑 Verwijderen (definitief) |
| Actieve vraag, in gebruik in toets | ✏️ Bewerken · 🗑 Verwijderen → melding → optie archiveren |
| Gearchiveerde vraag | ↩ Herstellen · 🗑 Definitief verwijderen |

**Betrokken bestanden:** `quiz-bank.html`

---

## v2026.2.23.0 — Sprint 23: Senior tester audit + dark mode verwijderd

### 23q — Dark/light mode volledig verwijderd
- Alle `dark-toggle` knoppen verwijderd uit alle 15 HTML-pagina's
- `initDarkMode()`, `Ctrl+Shift+D` shortcut en `pycodeflow_theme` localStorage uit `app.js` verwijderd
- Alle 24 `[data-theme="dark"]` CSS-blokken verwijderd uit `styles.css`
- Monaco editor gebruikt altijd `pycodeflow-dark` thema (ongewijzigd)
- `styles.css` geherschreven: van 742 → ~380 regels, duplicaten verwijderd (lost 23n op)

### 23a 🔴 — selected_choices niet opgeslagen in DB (dataverlies-bug)
- `quiz_save_answer` handler stuurde `selectedChoices` niet naar `dbModule.saveQuizAnswer()`
- Fix: `selectedChoices: JSON.stringify(data?.selectedChoices || [])` toegevoegd op beide call-sites (tussentijds opslaan + auto-submit)
- Keuze-antwoorden (single/meerkeuze) gaan nu niet meer verloren bij herstart

### 23b — isCode-opties renderen als code-blok
- `quiz-student.html` `renderChoices()`: opties met `isCode:true` tonen als `<pre>` code-blok
- `quiz-review.html` verbetermodule: zelfde fix, keuzes met code correct weergegeven

### 23c — Orphan route verwijderd (was 500-error)
- `GET /teacher-start.html` route verwijderd uit `server.js` — bestand bestond niet op schijf

### 23d — student-app.html versie gecorrigeerd
- `app.js?v2026.2.8.2` (kapotte querystring, 10 sprints achter) → `app.js?v=v2026.2.23.0`

### 23e — quiz-student: open antwoord verbeterd
- `maxlength="2000"` attribuut toegevoegd (limiet werd getoond maar niet afgedwongen)
- `onkeydown="event.stopPropagation()"` toegevoegd (Enter-fix consistent met sprint 22a)

### 23f — admin.html logo fix
- `/favicon.ico` (niet-bestaand bestand) vervangen door `/assets/logo.svg`
- Favicon-tag toegevoegd aan `<head>`

### 23g — Engelstalige placeholders vervangen
- `placeholder="Input unavailable"` → `placeholder="Invoer niet beschikbaar"` in `student-app.html` en `teacher-app.html`

### 23h — CSS/JS versiestrings genormaliseerd
- `monitor1`, `blockfix2`, leeg → allemaal `v2026.2.23.0` over alle 15 HTML-pagina's

### 23i — Subnav toegevoegd aan alle leerkrachtpagina's
- `quiz-bank.html`, `quiz-teacher.html`, `quiz-archive.html`, `admin.html`, `quiz-review.html`, `monitoring.html` krijgen de secundaire navigatiebalk (eerder enkel op `teacher-sessions.html`)
- Actieve pagina gemarkeerd met `class="active"`

### 23j — Favicon-tag op alle pagina's
- 8 pagina's zonder favicon-tag aangevuld: `quiz-*.html`, `teacher-sessions.html`, `teacher-login.html`, `teacher-grid.html`

### 23k — Paginatitels consistent
- Alle titels volgen nu `PyCodeFlow — [naam]` formaat
- `"Leerling"` → `"PyCodeFlow — Leerling"`, `"Leerkracht"` → `"PyCodeFlow — Sessie actief"`, `"Systeembeheer — PyCodeFlow"` → `"PyCodeFlow — Systeembeheer"`, etc.

### 23l — monitoring.html topbar layout fix
- "👤 Gebruikersbeheer" knop stond buiten `topbar-inner` wrapper → verwijderd en verwerkt in subnav (23i)
- Badge "Systeembeheer" toegevoegd aan topbar

### 23m — teacher-sessions.html consistentie
- `<h1>Leerkrachtenplatform</h1>` → `<h1>Sessies</h1>`
- Badge "Sessies" toegevoegd aan topbar
- Overbodige "Sessies" terugknop verwijderd (actieve pagina)

### 23n — styles.css gededupliceerd (samen met 23q opgelost)
- 24 dark-mode blokken verwijderd, overige duplicaten opgeruimd

### 23o — CSRF-beveiliging versterkt
- `admin.html`: 12 muterende `fetch()` calls vervangen door `apiFetch()` met CSRF-token
- `quiz-bank.html`: 5 calls idem
- `apiFetch()` helper geïnjecteerd in beide bestanden (apart van app.js)

### 23p — Retroactieve log-cleanup bij start
- `pycodeflow.sh actie_start()`: verwijdert automatisch logs ouder dan 7 dagen bij elke start

### 23r — Optie 18: Mappenstructuur opschonen

Nieuw menu-item **18 🧹 Mappenstructuur opschonen** in `pycodeflow.sh`:
- Scant de servermap op verouderde/ongebruikte bestanden via een sprint-catalogus
- Toont gevonden items (bestand, grootte, reden, sprint) vóór er iets verwijderd wordt
- Na bevestiging: verwijdert alle gedetecteerde items + rapporteert vrijgemaakte ruimte
- Idempotent: tweede uitvoering toont "Alles al netjes"
- Catalogus wordt bij elke sprint bijgehouden
- `Opschonen-Lokaal.ps1`: PowerShell equivalent voor lokale Windows ontwikkelmap (met extra lokaal-specifieke items: node_modules, monaco, pgdata, IDE-mappen, OS junk)

**Sprint 23 catalogus (eerste versie):**
- `runner/__pycache__/` — Python bytecode cache (sprint 22k)
- `start.bat` / `stop.bat` — Windows scripts, vervangen door pycodeflow.sh
- `web/scripts/migrate-env-to-db.js` — eenmalig (sprint 4, voltooid)
- `web/scripts/migrate-sqlite-to-pg.js` — eenmalig (sprint 12a, voltooid)
- `web/scripts/hash-password.js` — vervangen door manage-teacher.js
- `web/run_wrapper.py` — legacy run wrapper, niet meer gerefereerd
- `data/*.db / .db-shm / .db-wal` — SQLite legacy, vervangen door PostgreSQL
- `logs/` stale bestanden — ouder dan `LOG_RETENTION_DAYS` (sprint 17a/23p)

### Bestanden
`server.js` · `app.js` · `styles.css` · `database.js` · `pycodeflow.sh` · `Opschonen-Lokaal.ps1` · alle 15 HTML-pagina's

### 22a — Enter-toets in Python-code editor
- `onkeydown="event.stopPropagation()"` op alle `<textarea>` elementen in vragenbank en CSV-import

### 22b — Leerlingenoverzicht laadspinner opgelost
- `loadStudents()` in `admin.html` herschreven met `try/catch/finally`: spinner verbergt altijd, zichtbare foutmelding bij API-falen

### 22c — Leerlingen handmatig toevoegen in klasbeheer
- Nieuw inline formulier (Naam + Klas-dropdown + Toevoegen) boven leerlingenlijst in `admin.html`
- `addStudentManual()` POST naar `/api/admin/students`
- `loadClassFilter()` vult zowel de filterdropdown als de nieuwe klas-dropdown

### 22d — Preview toont nu gerenderde Markdown
- `marked.js` geladen vóór inline script
- `toggleMarkdownPreview()` gebruikt `marked.parse()` met `{ breaks: true, gfm: true }`
- Gestyled `.md-preview` blok met CSS voor `code`, `pre`, `strong`, `ul`

### 22e — Single/meerkeuze UI volledig herschreven
- `.choice-row` cards met tekstveld per optie
- `</>` toggle per optie voor code-modus (monospace textarea)
- Radio (single) / checkbox (meerkeuze) correctie-selector
- `_choices[].isCode` state bijgehouden en opgeslagen

### 22f — Vragen verwijderen/archiveren logica
- "Verwijderen" enkel zichtbaar op gearchiveerde vragen (server valideert gebruik)
- "↩ Herstellen" knop op gearchiveerde vragen
- Nieuw `PUT /api/quiz/bank/:id/unarchive` endpoint + `unarchiveQuizQuestion()` in `database.js`

### 22g — Layout "Nieuwe toets" verbeterd
- Consistent card-stijl, badge in topbar, logische volgorde velden

### 22h — Toets bevestigen werkt nu correct
- `createQuiz()`: disabled-guard (verhindert dubbele submit), loading state op knop, `try/catch/finally`, duidelijke foutmeldingen
- confirm-panel toont nu ook schooljaar en klasnaam

### 22i — Paginaheaders nieuwe schermen
- `quiz-teacher.html` en `quiz-review.html`: badge in topbar, consistente `<title>`

### 22j — Leerkrachten-header herstructureerd
- `teacher-sessions.html`: compacte primaire topbar (logo + Afmelden) en sticky secundaire `.subnav` balk

### 22k — Mappenstructuur opgeschoond
- `runner/__pycache__` verwijderd

### Bestanden
`server.js` · `database.js` · `quiz-bank.html` · `quiz-teacher.html` · `quiz-review.html` · `teacher-sessions.html` · `admin.html`

---
## v2026.2.17.0 — Sprint 20: Afwerking

### 19h — Bulk PDF ZIP (aparte PDF per leerling)

Nieuw endpoint `GET /api/quiz/:code/pdf/zip?scored=true/false`:
- Genereert een echte ZIP met per leerling een aparte PDF (`01_Emma_Janssens.pdf`, ...)
- PDF bevat alle vragen + antwoorden per vraagtype (code, open, meerkeuze)
- Meerkeuze: ✅/❌/☑ iconen voor correct/fout/gemist
- Scores en commentaar inbegrepen bij `scored=true`
- Geen externe packages — ZIP gebouwd via handmatige Buffer + CRC32
- `exportAll()` in quiz-review.html uitgebreid: 7 exportopties (waaronder nieuw ZIP)

### 20a — Audit-log leerkrachtenacties

Nieuwe tabel `audit_log` in PostgreSQL:
- Gelogde acties: `score_changed`, `quiz_deleted`, `results_released`
- Per actie: actor (leerkracht), tijdstip, IP, oud/nieuw waarde
- Endpoint: `GET /api/admin/audit-log?limit=50&action=score_changed`
- Zichtbaar in monitoring.html als scrollbare tabel met filteroptie

### 20b — Wachtwoord-reset via pycodeflow.sh

Nieuw menu-item **17 🔑 Wachtwoord leerkracht resetten**:
- Toont bestaande leerkrachten
- Invoer nieuw wachtwoord (met bevestiging)
- Reset via `manage-teacher.js` in de container

### Sprint 21 — Systeembeheer volledig up-to-date

**monitoring.html** uitgebreid met 4 nieuwe secties:

**PostgreSQL sectie:** verbindingsstatus, tabelaantal, leerkrachten/klassen/leerlingen/sessies, quiz statistieken (vragen in bank, toetsen ooit, antwoorden totaal).

**Backup sectie:** laatste backup status, logbestand info, versie + uptime + Node.js versie.

**Audit-log tabel:** filterbaar op actie-type, toont de laatste 25 acties.

**Stresstest historiek:**
- Lijndiagram van laatste 10 tests (kleurgecodeerd: groen/oranje/rood op stressload%)
- Tabel met type, datum, **stressload percentage + label**, runs OK/totaal, gemiddelde tijd, foutenpercentage
- Stressload = gewogen gemiddelde: RAM runner (25%) + CPU runner (20%) + run-tijd vs target (20%) + gefaalde runs (20%) + PG pool (15%)
- Labels: LAAG (0–40%) / NORMAAL (41–70%) / MATIG (71–85%) / HOOG (86–95%) / KRITIEK (>95%)

**server.js:** `berekenStressload()` functie voor gewogen stressload berekening.

### Database
`audit_log` tabel (actor, action, target, detail_json, ip, created_at)
`stress_results` tabel (testtype, stressload%, runs, timing, RAM/CPU)
Methodes: `auditLog()`, `getAuditLog()`, `saveStressResult()`, `getStressResults()`

### pycodeflow.sh
Menu nu 17 opties. Nieuw: optie 17 wachtwoord-reset.

### Bestanden
`server.js` · `database.js` · `pycodeflow.sh` · `monitoring.html` · `quiz-review.html`

---

## v2026.2.16.0 — Sprint 19: Betrouwbaarheid & uitbreidingen

### 19a — Quiz backup 15s + vrije editor localStorage + versie-endpoint
- Quiz tussentijdse backup: antwoorden worden nu bij **elke navigatie** naar DB geschreven
- Vrije editor (`free-editor.html`): code bewaard in `localStorage`, hersteld bij pagina-verversing
- `/api/version` endpoint uitgebreid met `uptime` en `node` versie

### 19b — Schoollogo + schoolinfo
- Nieuw endpoint `/api/school-info` retourneert schoolnaam en logo URL
- Nieuw endpoint `/school-logo` serveert het logo bestand
- PDF export gebruikt `SCHOOL_NAME` uit `.env` als header

### 19d — Quiz reminder voor niet-gestarte leerlingen
- Leerkracht kan leerling een herinnering sturen via `quiz_send_reminder` socket event
- Leerling ziet opvallende rode banner: "⚠️ Start de toets!"

### 19e — Servercrash notificatie
- `health-monitor.sh`: controleert elke 5 minuten of de server bereikbaar is
- Automatische herstart poging bij crash
- Webhook notificatie bij falen (optioneel via `WEBHOOK_URL` in `.env`)
- Installeerbaar via `pycodeflow.sh` → optie 15
- Docker-compose.yml: healthcheck toegevoegd aan web container

### 19f — Markdown rendering in vraagstellingen
- `marked.js` (v9.1.6 via CDN) geladen in alle quiz-pagina's
- Vraagstellingen worden gerenderd als Markdown bij leerling
- Markdown preview in vragenbank (`quiz-bank.html`) via 👁 knop
- Ondersteunt: **vet**, `code`, lijsten, codeblokken

### 19g — Sessie-config persistent na herstart
- `config_json` kolom toegevoegd aan `sessions` tabel
- `persistSession()` slaat editor-configuratie op
- `loadActiveSessions()` herstelt configuratie bij serverstart
- Schakelknoppen (auto-indent, autocomplete, ...) blijven bewaard na herstart

### 19i — Automatische PostgreSQL backup
- `scripts/backup-db.sh`: dagelijkse backup om 02:00 via cron
- 7 dagen bewaren, oudere backups automatisch verwijderd
- Logging van succes/falen in `backups/backup.log`
- Webhook notificatie bij mislukte backup
- `pycodeflow.sh` → optie 16: backup beheren (nu backuppen / cronjob / restore)

### 19j — Tijdsvenster voor toetsen/taken
- `quiz_meta`: kolommen `access_from`, `access_until`, `auto_submit_late` toegevoegd
- Toets aanmaken: datumvelden voor "beschikbaar vanaf" en "deadline"
- Server checkt tijdsvenster bij joinen: te vroeg → foutmelding met openingstijd
- Server checkt tijdsvenster bij joinen: te laat → "TAAK NIET TIJDIG INGELEVERD" scherm
- Deadline interval (elke minuut): auto-submit bij verlopen tijdsvenster
- Leerlingen die bezig zijn bij deadline worden automatisch ingediend
- `docker-compose.yml`: healthcheck op web container

### Database
`sessions.config_json` · `quiz_meta.access_from` · `quiz_meta.access_until` ·
`quiz_meta.auto_submit_late`
Alle via `ALTER TABLE ... IF NOT EXISTS` bij serverstart.

### pycodeflow.sh
Nieuw menu-item 15: Health monitor instellen
Nieuw menu-item 16: Database backup beheren

### Bestanden
`server.js` · `database.js` · `app.js` · `docker-compose.yml` ·
`pycodeflow.sh` · `health-monitor.sh` · `backup-db.sh` ·
`quiz-teacher.html` · `quiz-student.html` · `quiz-bank.html` ·
`quiz-review.html` · `quiz-teacher.html`

---

## v2026.2.15.0 — Sprint 18: Vraagtypen + navigatiefix

### Sprint 18a — Vraagtypen: open + meerkeuze + single choice

**Vragenbank** (`quiz-bank.html`): vier vraagtypen selecteerbaar bij aanmaken:
- 🐍 Python code (bestaand — Monaco editor + run)
- ✏️ Open vraag (vrije tekst, max 2000 tekens)
- ◉ Single choice (radio — één juist antwoord)
- ☑ Meerkeuze (checkbox — meerdere juiste antwoorden)

Antwoordopties beheer: opties toevoegen/verwijderen, juiste aanduiden.
Vraagtype-badge zichtbaar op elke vraagkaart.

**Leerling quizscherm** (`quiz-student.html`): scherm past zich automatisch aan per vraagtype.
Open vraag: textarea met tekenteller. Meerkeuze/single: klikbare opties met visuele feedback.

**Verbetermodule** (`quiz-review.html`): per vraagtype andere weergave.
Meerkeuze/single: kleurgecodeerde weergave (✅ correct gekozen, ❌ fout gekozen, ☑ gemist).

### Sprint 18b — Automatische scoring meerkeuze/single

Bij indiening: server berekent automatisch score voor meerkeuze en single choice.
- Single: volledig punt bij juist antwoord, 0 bij fout
- Meerkeuze: pro-rata (fout antwoord geselecteerd → 0; gedeeltelijk correct → proportioneel)
- Badge 🤖 Auto-gescoord zichtbaar in verbetermodule
- Leerkracht kan score altijd overschrijven

### Navigatiefix

Knop "👤 Beheer" (→ admin.html) toegevoegd aan navigatiebalk in teacher-sessions.html.

### Database
`quiz_bank` + `quiz_question_snapshots`: `question_type`, `choices_json` kolommen.
`quiz_answers`: `selected_choices`, `auto_scored` kolommen.
Automatische `ALTER TABLE IF NOT EXISTS` bij serverstart.

### Bestanden
`server.js` · `database.js` · `quiz-bank.html` · `quiz-student.html` ·
`quiz-review.html` · `teacher-sessions.html`

---

## v2026.2.14.0 — Sprint 17: Log rotatie + Toets-archief

### Sprint 17a — Log rotatie

**Automatische cleanup:** logbestanden ouder dan `LOG_RETENTION_DAYS` dagen (standaard 7) worden automatisch verwijderd. Cleanup bij serverstart én dagelijks om 03:00. Configureerbaar via `.env`.

**Wat NOOIT verwijderd wordt:** quiz_answers, quiz_run_history, code_snapshots, annotaties, PostgreSQL database.

**pycodeflow.sh:** nieuw menu-item "🗑 Logs opruimen" (optie 12) toont schijfgebruik en biedt handmatige cleanup.

**API endpoints:** `GET /api/admin/logs/info`, `POST /api/admin/logs/cleanup`, `POST /api/admin/logs/cleanup-all`

### Sprint 17b — Toets/taak archief

**Toets zonder tijdslimiet:** bij aanmaken van een toets/taak kan de leerkracht "Geen tijdslimiet" kiezen. Leerlingen zien ∞ in de timer. Geschikt voor taken thuis of projecten op eigen tempo.

**Schooljaar + klas koppeling:** bij aanmaken wordt schooljaar (automatisch berekend) en klas meegegeven aan de toets. Zoeken en filteren in het archief op jaar, klas en onderwerp.

**quiz-archive.html:** nieuw beheerscherm met drie tabbladen:
- Overzicht: alle toetsen filterbaar op schooljaar/klas/status, met statistieken per vraag (gemiddelde, %)
- Per leerling: zoek op naam → alle toetsen + scores → PDF rapport
- Nieuw schooljaar: archiveert alle actieve toetsen in één klik

**Archiveren vs verwijderen:**
- Archiveren: zachte verwijdering, data blijft bewaard, deblokkeerbaar
- Definitief verwijderen: vereist typen van toetsnaam als bevestiging, verwijdert antwoorden/scores/commentaren maar NIET de vragen in de bank

**Begin schooljaar reset:** één knop archiveert alle actieve toetsen en stelt nieuw jaar in.

**Statistieken per vraag:** gemiddelde score, percentage, gemiddeld aantal runs per vraag — zichtbaar per toets in het archief.

**Leerlingenrapport:** alle toetsen van één leerling over een schooljaar in één overzicht + PDF.

### Database
`quiz_meta` uitgebreid: `no_timer`, `school_year`, `target_class`, `archived`, `archived_at`.
Kolommen worden via `ALTER TABLE ... IF NOT EXISTS` toegevoegd bij update (geen volledige migratie nodig).

Nieuwe methodes: `archiveQuiz`, `unarchiveQuiz`, `deleteQuizFully`, `getQuizArchive`,
`getStudentHistory`, `getQuizStatsDetailed`, `getAvailableYears`

### Bestanden
`server.js` · `database.js` · `pycodeflow.sh` · `quiz-teacher.html` · `quiz-student.html` ·
`quiz-review.html` · `quiz-archive.html` · `teacher-sessions.html`

---

## v2026.2.13.0 — Sprint 16: Toetsmodule

### Nieuw

**16a — Vragenbank**
Herbruikbare vragen beheren in `quiz-bank.html`. Vragen per onderwerp en moeilijkheidsgraad, met autocomplete. Handmatig aanmaken of CSV bulk-import (`onderwerp,moeilijkheid,max_punten,vraag`). Vragen archiveren (niet verwijderen als al gebruikt in toets).

**16b — Toets aanmaken**
`quiz-teacher.html` met wizard (3 stappen): basisinfo → vragen selecteren → bevestigen. Timer per leerling, random of vaste volgorde, optioneel vraagstelling verbergen op scherm. Leerkracht preview als leerling. Toets dupliceren. Toetsen-tabblad in teacher-sessions.html.

**16c — Leerling quizscherm**
`quiz-student.html` met startscherm (timer start bij klik op START TOETS). Vraagnavigator met kleurcodes (grijs/blauw/groen/oranje). Antwoord opgeslagen bij navigatie én elke 60s naar DB. Offline tolerantie via sessionStorage. Timer met 10% waarschuwing. Auto-submit bij timer = 0. Bevestigingsscherm voor indienen met waarschuwingen per vraag. Dubbele verbinding detecteren. Leerling kan opnieuw starten (leerkracht reset).

**16d — Verbetermodule**
`quiz-review.html`: code per leerling per vraag, uitvoerbaar in sandbox. Run-history tijdlijn. Gelijkenis-detectie (Levenshtein, waarschuwing bij >80%). Score + opmerking per vraag. Algemeen commentaar. Commentaar templates aanmaken en hergebruiken. Resultaten vrijgeven aan leerlingen.

**16e — PDF export (pdfkit)**
- Type 1: Vragenblad (voor op papier, met invulvakken)
- Type 2a: Antwoordformulier zonder scores (nieten aan vragenblad)
- Type 2b: Antwoordformulier met scores + commentaar (teruggeven aan leerling)
- Type 3: Klasoverzicht / scoreblad (voor administratie)
- Export als .txt bestand met alle antwoorden per leerling

**16f — Monitoring**
`/api/quiz/stats` endpoint. Stresstest quiz-type. check-deployment uitbreidbaar.

### Database
Nieuwe tabellen: `quiz_bank`, `quiz_question_snapshots`, `quiz_meta`, `quiz_answers`,
`quiz_general_comments`, `quiz_student_order`, `quiz_run_history`, `quiz_comment_templates`

### Bestanden
`server.js` · `app.js` · `database.js` · `teacher-sessions.html` ·
`quiz-bank.html` · `quiz-teacher.html` · `quiz-student.html` · `quiz-review.html`

**Nieuwe npm dependency:** `pdfkit` — installeer via `npm install pdfkit` in de web map.

---

## v2026.2.12.0 — Sprint 12a-D: Monaco bundelen + CSP versterkt

### Beveiligingsverbetering

**`unsafe-eval` verwijderd uit CSP**
Monaco's AMD-loader vereiste `unsafe-eval` in de Content-Security-Policy omdat het via `eval()` modules laadt. Dit was het laatste beveiligingsgat (7 van de 100 punten).

**Oplossing:**
- Nieuw endpoint `/monaco-env.js` configureert `window.MonacoEnvironment` met `getWorkerUrl()`
- Monaco workers laden nu via blob: URLs in plaats van eval()
- CSP `worker-src` uitgebreid met `blob:` zodat Monaco workers mogen laden
- `unsafe-eval` volledig verwijderd uit `script-src`
- Per-request CSP nonce toegevoegd via `crypto.randomBytes(16)` voor toekomstige inline scripts

**Nieuwe CSP:**
```
script-src 'self' 'unsafe-inline' 'nonce-{per-request-nonce}';
worker-src 'self' blob:;
```

**Beveiligingsscore: 93/100 → 98/100**

De resterende 2 punten: `unsafe-inline` in script-src (vereist voor Socket.IO inline init) en mTLS intern (bewuste architectuurkeuze — geen multiserver).

### Bestanden
`server.js` · `app.js` · `teacher-app.html` · `student-app.html` · `free-editor.html`

---

# PyCodeFlow — Changelog

> Nieuwste versie staat bovenaan.

---

## v2026.2.11.0 — Sprint 13: Klas-dropdown + Sessie-config

### Nieuw

**Sessie-instellingenpaneel (⚙️)**
Leerkracht kan per sessie 5 editor-opties live aan/uitzetten. Wijzigingen worden onmiddellijk gesynchroniseerd naar alle verbonden leerlingen.

| Optie | Klas standaard | Examen standaard |
|---|---|---|
| Auto-indent na `:` | ✅ Aan | ❌ Uit |
| Auto-sluiten haakjes | ✅ Aan | ❌ Uit |
| Auto-sluiten aanhalingstekens | ✅ Aan | ❌ Uit |
| Autocomplete suggesties | ✅ Aan | ❌ Uit |
| Parameter-info tooltip | ✅ Aan | ❌ Uit |
| Fout-regel markering | ✅ Aan | ✅ Altijd aan |

**Klas-dropdown op joinpagina**
Klas-tekstveld op `student-start.html` vervangen door dropdown met klassen uit de database. Vorige keuze hersteld via `localStorage`. Fallback naar vrij tekstveld als geen klassen aangemaakt zijn.

**Toegangslogica bij joinen**
Server zoekt leerling op in `students` tabel bij joinen. Badges zichtbaar bij leerkracht:
- ⚠️ Nieuw — naam niet in klas gekend, aangemaakt als pending
- ⏳ Afwachting — status pending
- 👤 Gast — geen klas geselecteerd
- Geblokkeerde leerlingen worden geweigerd met foutmelding

**Duplicaat-detectie**
Foutmelding als naam al actief is in dezelfde sessie.

**Inline badge beheer**
Leerkracht aanvaardt leerlingen of wijst klas toe direct vanuit de sessie.

### Bestanden
`server.js` · `app.js` · `styles.css` · `teacher-app.html` · `student-start.html`

---

## v2026.2.10.0 — Sprint 12: PostgreSQL + Admin-pagina

### Nieuw

**PostgreSQL migratie**
Database volledig gemigreerd van synchrone SQLite naar async PostgreSQL. `DATABASE_URL` vereist in `.env`. Migratescript beschikbaar via `node scripts/migrate-sqlite-to-pg.js`.

**Admin-pagina `/admin.html`**
Drie tabbladen voor systeembeheer:
- Leerkrachten: toevoegen, wachtwoord resetten, rol wijzigen, verwijderen
- Klassen: aanmaken, archiveren, verwijderen
- Leerlingen: CSV-import, statusbeheer, notities

**CSV-import leerlingen**
Formaat: `naam,klas` per regel. Rapport met toegevoegde / overgeslagen / nieuwe klassen.

### Bestanden
`database.js` · `server.js` · `admin.html` · `monitoring.html` · `migrate-sqlite-to-pg.js`

---

## v2026.2.8.4 — Beveiligingsaudit

### Fixes (19 stuks)

| # | Fix | Impact |
|---|---|---|
| 1 | `Math.random()` → `crypto.randomBytes()` voor sessiecodes | Sessiecodes niet langer voorspelbaar |
| 2 | Runner gebonden aan `127.0.0.1` | Runner niet bereikbaar van buitenaf |
| 3 | HTTP security headers: CSP, X-Frame-Options, HSTS, Referrer-Policy, Permissions-Policy | XSS/clickjacking-bescherming |
| 4 | Socket.IO `maxHttpBufferSize: 64KB` | DoS via grote payloads geblokkeerd |
| 5 | Per-socket CSRF nonce | Sterkere CSRF-bescherming |
| 6 | Cookie `Secure + SameSite=Strict` | Cookie enkel via HTTPS, nooit cross-site |
| 7 | Student naam max 64 tekens | DoS via grote namen geblokkeerd |
| 8 | Annotatie max 500 tekens, line/color validatie | Invoervalidatie |
| 9 | `express.json({ limit: '64kb' })` | Expliciete body limiet |
| 10 | Stresstest achter `STRESS_TEST_ENABLED` flag | Stresstest uitgeschakeld in productie |
| 11 | Rate limiting `student_join`: 10/min per IP | Bruteforce sessiecodes geblokkeerd |
| 12 | Sessiecode 8 tekens (was 6) | 32^8 ≈ 1 biljoen combinaties |
| 13 | Code max 32KB per run | DoS via grote code geblokkeerd |
| 14 | Output max 256KB per run | Geheugen-aanvallen via print-loops geblokkeerd |

**Beveiligingsscore: 54/100 → 93/100**

### Bestanden
`server.js` · `app.py`

---

## v2026.2.9.0 — Sprint 11: Polish & archief

### Nieuw

- **Gutter thema**: regelnummers volgen editor thema (licht/donker) via CSS variabelen
- **Sessie-archief**: toggle "Toon gesloten sessies" in teacher-sessions.html
- **Leerling code-history**: 📜 knop in student-app opent playback modal
- **Wachtrij animatie**: ⏳ pulserende animatie + tijdschatting bij wachtrij
- **Autocheck badge**: groen/rood badge in teacher-sessions toont systeemstatus
- **Docker memory limiet**: runner container beperkt tot 256MB RAM en 1 CPU

### Bestanden
`server.js` · `app.js` · `styles.css` · `database.js` · `teacher-sessions.html` · `student-app.html`

---

## v2026.2.8.0 — Sprint 10: UX verbeteringen

### Nieuw

- Editor thema toggle ☀️/🌙 (onafhankelijk per gebruiker, `localStorage`)
- Gutter, output en statusbalk volgen editor thema
- Auto-indent na `:`, auto-sluiten haakjes en aanhalingstekens
- Fout-regel markering (rode decoratie) bij runtime errors
- Hover over fout-regel toont foutmelding
- Wacht-op-invoer indicator (pulserende blauwe balk)
- Sneltoetsen overlay: `?` of `Ctrl+?`
- Timer voortgangsbalk groen → oranje → rood
- Statusbalk onderaan editor: Ln/Kol, regels, Python, UTF-8
- Kopieer knoppen 📋 op code en output
- Grid overzichtsmodus leerkracht (⊞ Overzicht)
- Statusfilter knoppen: Alle / ✓ Klaar / ✋ Hand / ⚠️ Tab weg
- Annotatie-templates dropdown (7 voorgedefinieerde teksten)
- Live run-status iconen ▶/⌨️/⏳
- Bevestigingsdialoog bij sessie sluiten
- Naam wijzigen via klikbare badge (leerling)
- Verbindingsstatus dot 🟢/🟠/🔴 in topbar
- Auto-scroll output + handmatige scroll-knop
- Toetsenbordnavigatie leerlingenlijst leerkracht (↑/↓/Enter)

### Bestanden
`server.js` · `app.js` · `styles.css` · `teacher-app.html` · `student-app.html` · `free-editor.html`

---

## v2026.2.7.13 — Input-bug definitieve fix

### Fix
Runner weigert nu input als `waiting_for_input = False` (HTTP 409). Server herkent 409 en zet `runId` terug in `runnerWaitingForInput`. Ghost keypresses volledig geblokkeerd.

### Voorgeschiedenis (v2026.2.7.1 t/m .12)
Reeks van 12 bugfix-releases voor het probleem waarbij de tweede `input()` aanroep een lege string ontving. Oorzaak: ghost keypresses via `keydown` events. Definitieve fix zit in de runner zelf.

---

## v2026.2.7.0 — Sprint 9: Technische schuld

### Nieuw
- `apiFetch()` wrapper met automatische CSRF-header
- `session_annotations` tabel in SQLite
- 21 Python-errors met Nederlandse uitleg 💡
- Memory leak `snapshotLastSaved` opgeruimd
- Timer `clearInterval` bij sessie-sluiting

### Bestanden
`server.js` · `app.js` · `database.js` · `app.py`

---

## v2026.2.6.0 — Sprint 8: Code history

### Nieuw
- `code_snapshots` tabel (SQLite)
- History playback modal met tijdlijn en play/pauze
- Observer-rol voor tweede leerkracht

---

## v2026.2.5.0 — Sprint 7: UI & annotaties

### Nieuw
- 9 Python-oefentemplates
- Dark mode interface (`data-theme="dark"`)
- Gestructureerd `run_error` event met regelnummer
- Leerkrachtannotatie met Monaco decoraties (📌)

---

## v2026.2.4.0 — Sprint 6: Beveiliging & stresstest

### Nieuw
- IP rate limiting vrije editor
- `/health` endpoint
- Python subprocess `rlimits` (NOFILE, FSIZE, NPROC)
- Stresstest types: ramp-up, sustained load, memory leak, custom

---

## v2026.2.3.0 — Sprint 5: UX verfijning

### Nieuw
- Aankondigingen als chip-grid
- ✓ Klaar-knop + leerkracht reset
- 💾 Autosave indicator
- 📎 Snippet broadcast naar alle leerlingen

---

## v2026.2.2.0 — Sprint 4: Kwaliteit

### Nieuw
- ✋ Hand opsteken
- Aankondigingsgeschiedenis
- Python syntaxcheck voor run (`ast.parse()`)
- Monitoring historiek + Canvas grafiek
- Reconnect vrije sessie na verbroken verbinding

---

## v2026.2.1.0 — Sprint 3: Examengereedheid

### Nieuw
- Export sessie als `.txt`
- Tab-detectie examenmodus (⚠️ badge bij leerkracht)
- `Ctrl+Enter` sneltoets voor run
- `run_end` feedback bij lege output

---

## v2026.2.0.0 — Sprint 2: Database & login

### Nieuw
- SQLite persistentie via `better-sqlite3`
- Leerkrachtenlogin uit database (niet meer uit `.env`)
- `manage-teacher.js` CLI
- `migrate-env-to-db.js` eenmalig migratescript

---

## v2026.1.35.7 → v2026.1.38.0 — Sprint 1: Basiswerking

### Basis platform
- Real-time code-editor (Monaco Editor + Socket.IO)
- Python runner (Flask + subprocess in Docker)
- Klassessie en examenmodus
- Vrije editor (zonder sessiecode)
- Run rate limiting (3s per socket)
- Logout leerkrachten
- Monitoringpagina met systeemstatus

---

*PyCodeFlow · Atheneum Hoboken*

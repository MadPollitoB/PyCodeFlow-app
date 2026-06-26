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

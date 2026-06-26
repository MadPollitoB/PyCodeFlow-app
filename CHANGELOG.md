# PyCodeFlow — Changelog

> **Versie 2026.2.8.0** · Atheneum Hoboken
> Nieuwste versie staat bovenaan.

**Andere documenten:**
- [TECHNICAL.md](TECHNICAL.md) — Architectuur & API referentie
- [SPRINTLOG.md](SPRINTLOG.md) — Sprintplanning & roadmap
- [USER-MANUAL.md](USER-MANUAL.md) — Gebruikershandleiding

---

### v2026.2.8.0 — Sprint 10: UX verbeteringen

**E) Editor thema toggle (🌙/☀️ per editor)**
Aparte thema-knop in elke editor toolbar. Opgeslagen in `localStorage` als `pycodeflow_editor_theme`. Output-paneel volgt het thema. Sneltoets: `Ctrl+Shift+T`.

**F) Auto-indent + haakjes sluiten**
Monaco: `autoIndent: 'full'`, `autoClosingBrackets: 'always'`, `autoClosingQuotes: 'always'`.

**G) PEP8 regellengte-indicator** — `rulers` optie klaar in monacoOptions.

**H) Fout-regel markeren in editor**
Bij `run_error` met `line`: rode Monaco decoratie op die regel. Wist bij nieuwe run.

**I) Wacht-op-invoer indicator**
Pulserende blauwe balk boven het invoerveld bij actieve `input()` aanroep.

**J) Sneltoetsen overlay** — `?`-knop of `Ctrl+?`. Modaal met alle sneltoetsen.

**K) Timer voortgangsbalk voor leerling** — Groen → oranje → rood naarmate tijd verstrijkt.

**L) Statusbalk onderaan de editor**
Leerkracht + vrij: Variant A (donker) / B (licht): Ln/Kol, regels, Python, UTF-8.
Leerling: Variant C (minimaal): Ln/Kol + regels.

**M) Kopieer knop: output én code** — `📋` op code-editor en output-paneel.

**N) Overzichtsmodus leerkracht (grid view)**
"⊞ Overzicht"-knop: compact grid met naam, status-badges, code-preview. Klik → Live control.

**O) Leerlingen zoeken uitgebreid** — Statusfilter-knoppen: Alle / ✓ Klaar / ✋ Hand / ⚠️ Tab weg.

**P) Annotatie-templates** — Dropdown met 7 voorgedefinieerde teksten in het annotatie-panel.

**Q) Live run-status per leerling** — ▶ / ⌨️ / ⏳ icoon naast elke leerling. Server-side `runStatus` veld.

**R) Bevestigingsdialoog sessie sluiten** — `confirm()` met aantal verbonden leerlingen.

**S) Leerling-naam wijzigen** — Naam-badge klikbaar (✏️) in student-app.

**T) Verbindingsstatus indicator** — 🟢/🟠/🔴 dot in topbar.

**U) Automatisch scrollen output** — Auto-scroll met scroll-naar-beneden knop.

**V) Toetsenbord-navigatie leerlingenlijst** — ↑/↓/Enter in leerkrachten-app. Gefocuste leerling gemarkeerd.

*Betrokken: `server.js`, `app.js`, `styles.css`, `teacher-app.html`, `student-app.html`, `free-editor.html`*

---

### v2026.2.7.13 — Definitieve fix: runner weigert input als niet wachtend

Runner-endpoint `POST /runs/:id/input` checkt nu `waiting_for_input` vóór schrijven naar stdin. Als niet wachtend → HTTP 409. Server herkent 409, zet runId terug in `runnerWaitingForInput` Set. Alle vorige client-side guards (ghost keypress, delays, vlaggen) waren workarounds; dit is de architectureel correcte fix.

*Betrokken: `runner/app.py`, `server.js`*

---

### v2026.2.7.12 — Ghost keypress via knop-click + poll timing

`_freeMouseClick` vlag via `mousedown` — onderscheidt echte muiskliks van ghost keypresses. Poll-delay terug naar 180ms (was 500ms wat ghost events meer tijd gaf).

*Betrokken: `app.js`, `server.js`*

---

### v2026.2.7.11 — Tweede input(): _freeUserTyped guard

`_freeUserTyped` vlag via `input` event — enkel `true` bij echte toetsaanslag. `keyup Enter` vereist `_freeUserTyped = true` om te verzenden.

*Betrokken: `app.js`*

---

### v2026.2.7.10 — Definitieve fix: tweede input() geblokkeerd door free_run_end

`free_run_end` werd gestuurd na de tweede `input_request` omdat `!evData.running` tijdelijk true was. Fix: `free_run_end` enkel sturen als `!running && !runnerWaitingForInput.has(runId)`.

*Betrokken: `server.js`, `app.js`*

---

### v2026.2.7.9 — Inputveld verdwijnt meteen

`free_session_state` riep altijd `disableInput()` aan, ook tijdens actieve run. Fix: `_freeRunActive` vlag. `stopPropagation()` op input keyup handlers.

*Betrokken: `app.js`*

---

### v2026.2.7.8 — Enter-toets blijft hangen: keyup fix

`keydown` → `keyup` voor input-verzending. `keyup` vuurt exact één keer per toetsaanslag, nooit bij key repeat.

*Betrokken: `app.js`*

---

### v2026.2.7.7 — Tweede input(): guard blokkeerde echte invoer

`_freeInputSent` werd na 200ms gereset maar tweede `input_request` arriveerde al na ~50ms. Fix: guard onmiddellijk resetten bij `input_request`.

*Betrokken: `app.js`*

---

### v2026.2.7.6 — Definitieve fix: runner weigert lege string (eerste poging)

`runnerWaitingForInput` Set in `server.js`. `input_request` → `add(runId)`. Elke `runtime_input` → `has(runId)` check. (Onvolledig — runner zelf controleerde nog niet.)

*Betrokken: `server.js`, `runner/app.py`*

---

### v2026.2.7.5 — Ghost keypress fix

Focus-delay 150ms, disabled-check in keydown, guard-reset na 200ms.

*Betrokken: `app.js`*

---

### v2026.2.7.4 — Tweede input() lege string fix

`_freeInputSent` en `_studentInputSent` guards. (Onvolledig — ghost keypresses omzeilden de guards.)

*Betrokken: `app.js`*

---

### v2026.2.7.3 — Invoer-echo: alle modi + meerdere inputs

Echo direct in output-buffer op server (`s.output`, `s.personalOutput`, `session.sharedOutput`). `_echoBuffer` aanpak vervangen. Poll-loop gebruikt `student._outputAccum`.

*Betrokken: `server.js`*

---

### v2026.2.7.2 — Invoer-echo zichtbaar in output

Echo werd client-side overschreven door `free_run_output`. Fix: echo server-side direct in `_outputAccum`.

*Betrokken: `server.js`, `app.js`*

---

### v2026.2.7.1 — Input bugfix + UX verbeteringen output

`%s` bug in WRAPPER opgelost (string-concatenatie i.p.v. `.replace('%s', MARKER)`). Invoer-echo `[waarde]` in output. "===== Compiler klaar met runnen =====" na succesvolle run.

*Betrokken: `runner/app.py`, `server.js`, `app.js`*

---

### v2026.2.7.0 — Sprint 9 volledig + Nederlandse foutuitleg

Sprint 9A: `snapshotLastSaved` memory leak opgeruimd bij sessie-sluiting + periodiek (30 min).
Sprint 9B: Timer `clearInterval` bij sessie-sluiting én leerkracht-disconnect.
Sprint 9C: `apiFetch()` wrapper met `X-CSRF-Token` header + `/api/csrf-token` endpoint.
Sprint 9D: `session_annotations` SQLite tabel + `saveAnnotations()`/`getAnnotations()`.
Nederlandse foutuitleg: 21 Python-errors met 💡-tip in het Nederlands na de Engelse foutmelding.

*Betrokken: `server.js`, `app.js`, `database.js`, `runner/app.py`*

---

### v2026.2.6.5 — Vrije editor: run-knop vast + lege invoer waarschuwing

Verkeerde `run_error` handler (klas-sessie code) in vrije editor poll-loop → ReferenceError → poll crasht → Run-knop vast. Lege invoer: placeholder-waarschuwing in invoerveld.

*Betrokken: `server.js`, `app.js`*

---

### v2026.2.6.4 — History + annotatie tab-isolatie fixes

History: betere foutmeldingen (specifiek bij "no such table: code_snapshots"). Annotaties lekten naar Mijn werkblad: `window._savedAnnotations` array, wissen bij tab-switch naar personal, herstellen bij switch naar shared.

*Betrokken: `app.js`*

---

### v2026.2.6.3 — Annotatiesysteem volledig hersteld (5 bugs)

CSS klassen `annotation-highlight-yellow/blue/green/red` en `annotation-inline-msg` ontbraken. `applyAnnotationToEditor()` herbruikbare functie aangemaakt. Leerkracht ziet eigen annotaties in editor + "✓ Verstuurd" feedback. Toast navigeert naar Klascode-tabblad. `window.monaco` fix.

*Betrokken: `app.js`, `styles.css`*

---

### v2026.2.6.2 — Cursor-reset fix individueel werkblad

`serverIsEchoingOwnCode = data.personalCodeSourceSocketId === socket.id` check: als server eigen code terugstuurt wordt `localPersonalCode` nooit gewist. `model.pushEditOperations()` i.p.v. `model.setValue()` — cursor en undo-history intact.

*Betrokken: `app.js`*

---

### v2026.2.6.1 — database.js duplicate crypto fix

Dubbele `const crypto = require('crypto')` verwijderd — crashte server bij opstarten.

*Betrokken: `database.js`*

---

### v2026.2.6.0 — Sprint 8: technische fundering

SQLite `code_snapshots` tabel + `saveSnapshot`, `getSnapshots`. Code history playback modaal met tijdlijnschuif en play/pauze. Secundaire leerkrachtsrol (observer). Runner API integratietest als stresstest type `runner-api`.

*Betrokken: `server.js`, `app.js`, `database.js`*

---

### v2026.2.5.0 — Sprint 7: UI fixes & onderwijs features

Slider layout fix monitoring. Templates (9 Python-oefeningen). Dark mode (`data-theme="dark"`, Monaco `vs-dark`). `run_error` gestructureerd event. Leerkrachtannotatie (📌 floating panel, Monaco decoraties).

*Betrokken: `server.js`, `app.js`, `styles.css`, alle HTML, `runner/app.py`, `templates.json`*

---

### v2026.2.4.3 — WebSocket stresstest bugfixes

Wegwerpsessies in `exam` mode. `workspace: 'personal'`. `run_output` streaming handler: accumuleren + wachten op `run_end`.

*Betrokken: `server.js`*

---

### v2026.2.4.1 — Sprint 6 voltooiing

`testWebSocketLoad`, `testHttpBenchmark`, `testRateLimitVerification` functies. `socket.io-client` dependency. `check-deployment.sh` uitgebreid.

*Betrokken: `server.js`, `monitoring.html`, `check-deployment.sh`*

---

### v2026.2.4.0 — Sprint 6: beveiliging & stresstest

IP rate limiting vrije editor. `/health` endpoint. CSRF-bescherming. Runner `preexec_fn` rlimits. Auditlog vrije sessie. `nextRevision()` race condition fix. Stresstest: ramp-up, sustained load, memory leak, aangepaste test.

*Betrokken: `server.js`, `runner/app.py`, `monitoring.html`*

---

### v2026.2.3.0 — Sprint 5: UX verfijning

Aankondigingen chip-grid. ✓ Klaar-knop + leerkracht reset. 💾 Autosave indicator. Voortgangsindicator. 📎 Snippet broadcast.

*Betrokken: `server.js`, `app.js`*

---

### v2026.2.2.2 — Sprint 4 bugfixes

Hand: dubbele event listener. Timer: page guard. Aankondiging: data-idx. Filter: renderStudentList herbruikbaar.

*Betrokken: `app.js`*

---

### v2026.2.2.0 — Sprint 4: kwaliteit & UX

✋ Hand opsteken. Aankondigingsgeschiedenis. Syntaxcheck (`ast.parse()`). Auto-refresh sessieoverzicht. Monitoring historiek + Canvas grafiek. Reconnect vrije sessie.

*Betrokken: `server.js`, `app.js`, `monitoring.html`*

---

### v2026.2.1.0 — Sprint 3: examengereedheid

⬇ Export sessie als `.txt`. Tab-detectie examenmodus. `Ctrl+Enter`. `run_end` feedback bij lege output.

*Betrokken: `server.js`, `app.js`*

---

### v2026.2.0.0 — Sprint 2: SQLite + leerkrachtenlogin DB

SQLite persistentie. Login uit `.env` → database. `manage-teacher.js` CLI. `migrate-env-to-db.js`.

*Betrokken: `server.js`, `database.js`, alle scripts*

---

### v2026.1.38.0 — Sprint 1: rate limiting & logout

Run rate limiting (3s per socket). Logout-knop leerkrachten.

*Betrokken: `server.js`, `app.js`*

---

### v2026.1.37.0 — Monitoringpagina

`monitoring.html` apart systeembeheerscherm. `GET /api/monitoring` endpoint.

---

### v2026.1.36.0 — Vrije editor

Leerlingen oefenen Python zonder sessiecode.

---

### v2026.1.35.8 — Custom login overlay

Native browser-popup → custom `teacher-login.html`.

---

### v2026.1.35.7 — Cursor-stabiliteit

`schedulePersist` + cursorpositie bewaren bij individueel werken.

---

*PyCodeFlow · Atheneum Hoboken · v2026.2.8.0*

# PyCodeFlow — Sprintlog & Roadmap

> Nieuwste sprint staat **bovenaan**. Afgeronde sprints staan **onderaan**.

---

## Openstaande sprints

| Sprint | Prio | Inhoud | Status | Inschatting |
|---|---|---|---|---|
| **16a-f** | — | Toetsmodule (volledig) | ✅ Afgerond (v2026.2.13.0) | ~10 dagen |
| ~~**16b**~~ | — | Toetsmodule: toets aanmaken + sessie type quiz | ✅ Afgerond (v2026.2.13.0) | ~2 dagen |
| ~~**16c**~~ | — | Toetsmodule: leerling quizscherm + timer + auto-submit | ✅ Afgerond (v2026.2.13.0) | ~2 dagen |
| ~~**16d**~~ | — | Toetsmodule: verbetermodule + score + commentaar | ✅ Afgerond (v2026.2.13.0) | ~2 dagen |
| ~~**16e**~~ | — | Toetsmodule: PDF export (4 types) | ✅ Afgerond (v2026.2.13.0) | ~1 dag |
| ~~**16f**~~ | — | Toetsmodule: monitoring + stresstest + check-deployment | ✅ Afgerond (v2026.2.13.0) | ~0.5 dag |
| **17a** | — | Log rotatie (7 dagen auto-cleanup) | ✅ Afgerond (v2026.2.14.0) | ~0.5 dag |
| **17b** | — | Toets/taak archief: beheer + opvragen per jaar/klas | ✅ Afgerond (v2026.2.14.0) | ~2 dagen |
| **18a** | 🔴 P1-1 | Vraagtypen: open vraag + meerkeuze + single choice | 🔄 Gepland | ~3 dagen |
| **18b** | 🔴 P1-2 | Automatische scoring meerkeuze/single choice | 🔄 Gepland | ~1 dag |
| **19a ✅** | 🔴 P1-3 | ✅ Afgerond (v2026.2.16.0) | 🔄 Gepland | ~0.5 dag |
| **19b ✅** | 🔴 P1-4 | ✅ Afgerond (v2026.2.16.0) | 🔄 Gepland | ~0.5 dag |
| **19c** | 🔴 P1-5 | check-deployment.sh volledig bijwerken (sprint 12+) | 🔄 Gepland | ~0.5 dag |
| **19d ✅** | 🔴 P1-6 | ✅ Afgerond (v2026.2.16.0) | 🔄 Gepland | ~0.5 dag |
| **19e ✅** | 🔴 P1-7 | ✅ Afgerond (v2026.2.16.0) | 🔄 Gepland | ~1 dag |
| **19f ✅** | 🔴 P1-8 | ✅ Afgerond (v2026.2.16.0) | 🔄 Gepland | ~1 dag |
| **19g ✅** | 🔴 P1-9 | ✅ Afgerond (v2026.2.16.0) | 🔄 Gepland | ~0.5 dag |
| **19h** | 🔴 P1-10 | Bulk PDF export: alle antwoordformulieren als aparte bestanden | ✅ Afgerond (v2026.2.17.0) | ~1 dag |
| **19i ✅** | 🔴 P1-11 | ✅ Afgerond (v2026.2.16.0) | 🔄 Gepland | ~1 dag |
| **19j ✅** | 🔴 P1-12 | ✅ Afgerond (v2026.2.16.0) | 🔄 Gepland | ~1.5 dag |
| **20a** | 🟠 P2-1 | Audit-log leerkrachtenacties (score gewijzigd, toets verwijderd) | ✅ Afgerond (v2026.2.17.0) | ~1 dag |
| **20b** | 🟠 P2-2 | Wachtwoord-reset flow voor leerkrachten (self-service) | ✅ Afgerond (v2026.2.17.0) | ~1 dag |
| **21** | 🟠 P2-3 | Systeembeheer (monitoring.html) volledig up-to-date | ✅ Afgerond (v2026.2.17.0) | ~1.5 dag |
| **14** | ⏸ Uitgesteld | Google OAuth leerlingen | ⏸ Uitgesteld (later) | ~3 dagen |
| **15** | ⏸ Uitgesteld | Smartschool SSO | ⏸ Uitgesteld (optioneel) | ~1 week |

---

### Sprint 17a — Log rotatie *(~0.5 dag)*

**Impact:** Operationeel — voorkomt dat logs de NAS vollopen.
**Vereiste voorbereiding:** geen — volledig onafhankelijk van andere sprints.
**Risico:** Laag.

---

#### Wat het probleem is

`server.js` schrijft request-logs, run-logs en error-logs naar `/app/logs/`. Bij intensief gebruik groeien die onbeperkt. Na één schooljaar kunnen logs meerdere gigabytes innemen. **Toets- en taakresultaten** vallen hier **niet** onder — die zitten in PostgreSQL en worden nooit automatisch verwijderd.

---

#### A) Automatische cleanup in server.js

Bij serverstart én dagelijks om 03:00 worden logbestanden ouder dan 7 dagen verwijderd:

```js
const LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS) || 7;

function cleanOldLogs() {
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.log'));
  let removed = 0;
  for (const f of files) {
    const fp = path.join(LOGS_DIR, f);
    if (fs.statSync(fp).mtimeMs < cutoff) {
      fs.unlinkSync(fp);
      removed++;
    }
  }
  if (removed > 0) console.log(`[logs] ${removed} logbestand(en) ouder dan ${LOG_RETENTION_DAYS} dagen verwijderd`);
}

// Bij startup
cleanOldLogs();
// Dagelijks om 03:00
const now = new Date();
const msTo3am = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 3, 0, 0) - now;
setTimeout(() => { cleanOldLogs(); setInterval(cleanOldLogs, 24 * 60 * 60 * 1000); }, msTo3am);
```

#### B) Configureerbaar via .env

```env
LOG_RETENTION_DAYS=7    # standaard 7 dagen, aanpasbaar
```

#### C) Handmatige cleanup via pycodeflow.sh

Nieuw menu-item "13) 🗑 Logs opruimen" in `pycodeflow.sh`:
- Toont hoeveel logbestanden er zijn en hoeveel schijfruimte ze innemen
- Vraagt bevestiging voor verwijdering van bestanden ouder dan X dagen
- Optie om alle logs te wissen (enkel voor troubleshooting)

#### D) Wat NOOIT automatisch verwijderd wordt

- `quiz_answers`, `quiz_run_history`, `quiz_bank` — toets- en taakdata in PostgreSQL
- `code_snapshots` — leerlingencode-history
- `session_annotations` — annotaties
- De PostgreSQL database zelf

#### E) check-deployment.sh uitbreiden

- `LOG_RETENTION_DAYS` aanwezig in `.env`
- Logs map bestaat en is beschrijfbaar
- Geen logbestanden ouder dan `LOG_RETENTION_DAYS + 2` dagen aanwezig (als waarschuwing)

---

**Uitzondering:** toets- en taakresultaten zijn géén logs — die zitten in PostgreSQL (`quiz_answers`, `quiz_run_history`, ...) en worden nooit automatisch verwijderd. Enkel de `.log` bestanden in de `logs/` map worden geroteerd.

---

#### A) Automatische log rotatie — server.js

Bij serverstart en daarna elke nacht om 03:00 wordt een cleanup uitgevoerd:

```js
// Verwijder alle .log bestanden ouder dan 7 dagen
async function cleanOldLogs() {
  const LOGS_DIR = path.join(__dirname, 'logs');
  const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  try {
    const files = fs.readdirSync(LOGS_DIR);
    let verwijderd = 0;
    for (const f of files) {
      if (!f.endsWith('.log')) continue;
      const fp = path.join(LOGS_DIR, f);
      const stat = fs.statSync(fp);
      if (Date.now() - stat.mtimeMs > MAX_AGE_MS) {
        fs.unlinkSync(fp);
        verwijderd++;
      }
    }
    if (verwijderd > 0)
      console.log(`[log-cleanup] ${verwijderd} log-bestand(en) verwijderd (ouder dan 7 dagen)`);
  } catch (e) {
    console.error('[log-cleanup] Fout:', e.message);
  }
}

// Bij serverstart
cleanOldLogs();

// Elke nacht om 03:00
const nu = new Date();
const ms_tot_drie = new Date(nu).setHours(3, 0, 0, 0) - nu;
const delay = ms_tot_drie < 0 ? ms_tot_drie + 86400000 : ms_tot_drie;
setTimeout(() => {
  cleanOldLogs();
  setInterval(cleanOldLogs, 24 * 60 * 60 * 1000);
}, delay);
```

#### B) Manuele log cleanup via pycodeflow.sh

Nieuw menu-item in `pycodeflow.sh`:

```
13) 🗑  Logs opruimen (ouder dan 7 dagen)
```

Toont hoeveel MB vrijgemaakt wordt voor verwijdering, vraagt bevestiging.

#### C) Log grootte monitoring in monitoring.html

Extra sectie in `monitoring.html`:

```
Logs map: 42.3 MB  (3 bestanden ouder dan 7 dagen — cleanup loopt om 03:00)
```

#### D) check-deployment.sh

Nieuwe check: logs map aanwezig, grootte < 500MB.

---

### Sprint 17b — Toets/taak archief *(~2 dagen)*

**Impact:** Nieuw beheerscherm voor toets- en taakresultaten. Geen wijzigingen aan bestaande quiz-flow.
**Vereiste voorbereiding:** sprint 16 afgerond.
**Risico:** Laag — enkel lees- en beheerfuncties, geen wijzigingen aan bestaande tabellen.

---

#### Wat het probleem is

Na een schooljaar staan alle toetsen van alle klassen door elkaar in `teacher-sessions.html`. Er is geen manier om te filteren op jaar, klas of onderwerp, en geen manier om resultaten te archiveren of definitief te verwijderen zonder alle data te verliezen.

---

#### A) Archief-beheerpagina `quiz-archive.html`

Bereikbaar via teacher-sessions.html → "📦 Archief" of via monitoring.html.

**Filtermogelijkheden:**

```
Schooljaar: [2025-2026 ▼]   Klas: [6A Informatica ▼]   Onderwerp: [Functies ▼]

Zoeken: [________________________]

[Alle toetsen]  [Gearchiveerd]  [Actief]
```

**Weergave per toets:**

```
┌─────────────────────────────────────────────────────────────┐
│ 📝 Toets Functies H2          15/06/2026                    │
│ 6A Informatica · 23 leerlingen · 5 vragen · 20 punten       │
│ Gemiddelde: 13.4/20 · Verbeterd: 23/23                      │
│                                                             │
│ [📊 Statistieken] [🖨️ PDF klasoverzicht] [📦 Archiveren]    │
│ [⬇ Exporteer alles] [🗑 Definitief verwijderen]             │
└─────────────────────────────────────────────────────────────┘
```

---

#### B) Schooljaar en klas koppelen aan toetsen

Bij aanmaken van een toets (sprint 16b) wordt schooljaar en klas al meegestuurd via de sessie. Uitbreiden met twee extra velden in `quiz_meta`:

```sql
ALTER TABLE quiz_meta
  ADD COLUMN IF NOT EXISTS school_year TEXT NOT NULL DEFAULT '2025-2026',
  ADD COLUMN IF NOT EXISTS target_class TEXT NOT NULL DEFAULT '';
```

`quiz-teacher.html` wizard stap 1 uitbreiden:
- Schooljaar (dropdown, vooraf ingesteld op huidig jaar)
- Klas (dropdown uit `classes` tabel, optioneel — voor als je aan meerdere klassen geeft)

---

#### C) Statistieken per toets

Klikken op "📊 Statistieken" opent een detailpaneel:

```
Toets: Functies H2 · 6A Informatica · 15/06/2026
──────────────────────────────────────────────────
Leerlingen: 23 (21 ingeleverd, 2 niet gestart)
Klasgemiddelde: 13.4 / 20 punten (67%)

Per vraag:
  Vraag 1 (Functies)    gem. 3.4/4  ████████░  85%
  Vraag 2 (Lijsten)     gem. 2.1/4  █████░░░░  53%
  Vraag 3 (Lussen)      gem. 1.8/2  █████████  90%

Moeilijkste vraag: Vraag 2 (Lijsten — 53% gemiddeld)
Vraag met meeste runs: Vraag 2 (gem. 4.2 runs)
```

Hergebruik via vragenbank: "⚠️ Vraag 2 scoorde ook laag in Toets H1 (48%)"

---

#### D) Opvragen per jaar / klas / onderwerp

**Per schooljaar:**
```
GET /api/quiz/archive?year=2025-2026
→ Alle toetsen van dat schooljaar
```

**Per klas:**
```
GET /api/quiz/archive?classId=uuid
→ Alle toetsen voor die klas
```

**Per onderwerp:**
```
GET /api/quiz/archive?subject=Functies
→ Alle toetsen met minstens één Functies-vraag
```

**Gecombineerd:**
```
GET /api/quiz/archive?year=2025-2026&classId=uuid&subject=Functies
```

**Leerling-overzicht over meerdere toetsen:**
```
GET /api/quiz/archive/student?name=Emma+Janssens&classId=uuid
→ Alle toetsen + scores voor Emma in die klas
```

Dit geeft een volledig rapport per leerling over het schooljaar:

```
Emma Janssens · 6A Informatica · 2025-2026
──────────────────────────────────────────
Toets Functies H1   12/09/2025   14/20  70%
Toets Lussen H1     03/10/2025   18/20  90%
Toets Functies H2   15/06/2026   13/20  65%
──────────────────────────────────────────
Gemiddelde:                       45/60  75%
```

---

#### E) Archiveren en verwijderen

**Archiveren** (zachte verwijdering):
- Toets verdwijnt uit de actieve lijst
- Data blijft bewaard in PostgreSQL
- Zichtbaar onder "Gearchiveerd" filter
- Kan gedeblokkeerd worden

**Definitief verwijderen** (harde verwijdering):
- Bevestigingsdialoog met naam, klas, aantal leerlingen en datum
- Verwijdert `quiz_answers`, `quiz_run_history`, `quiz_question_snapshots`, `quiz_meta`
- Vragen in `quiz_bank` blijven bewaard (zijn herbruikbaar)
- Kan **niet** ongedaan gemaakt worden — expliciete waarschuwing

```
⚠️ DEFINITIEF VERWIJDEREN

Toets: Functies H2
Klas: 6A Informatica
Datum: 15/06/2026
Leerlingen: 23

Dit verwijdert ALLE antwoorden, scores en commentaren.
De vragen blijven beschikbaar in de vragenbank.

Dit kan NIET ongedaan worden gemaakt.

Typ de toetsnaam om te bevestigen: [________________]
[Annuleren]  [Definitief verwijderen]
```

---

#### F) Begin schooljaar — reset functie

Knop "📅 Nieuw schooljaar" in `quiz-archive.html`:

1. Alle actieve toetsen archiveren (niet verwijderen)
2. Schooljaar instellen op nieuw jaar (bv. 2026-2027)
3. Klassen archiveren en opnieuw aanmaken (optioneel)

Geeft een overzicht van wat er gearchiveerd zou worden voor bevestiging.

---

#### G) PDF rapport per leerling over schooljaar

Via archief: "🖨️ Leerlingenrapport" → PDF met alle toetsen + scores voor een specifieke leerling over een volledig schooljaar. Formaat:

```
PyCodeFlow · Atheneum Hoboken
Leerlingenrapport 2025-2026

Emma Janssens · 6A Informatica

[tabel met alle toetsen, scores, commentaren per toets]

Klasgemiddelde ter vergelijking per toets
```

---

#### H) REST endpoints archief

| Methode | Endpoint | Beschrijving |
|---|---|---|
| GET | `/api/quiz/archive` | Alle toetsen (filter: `year`, `classId`, `subject`, `archived`) |
| GET | `/api/quiz/archive/student` | Toetsen + scores per leerling (filter: `name`, `classId`, `year`) |
| PUT | `/api/quiz/:code/archive` | Toets archiveren |
| PUT | `/api/quiz/:code/unarchive` | Toets deblokkeren |
| DELETE | `/api/quiz/:code` | Definitief verwijderen (vereist bevestigingsveld) |
| GET | `/api/quiz/:code/stats` | Statistieken per vraag + klasgemiddelde |
| GET | `/api/quiz/archive/pdf/student` | PDF leerlingenrapport schooljaar |
| PUT | `/api/quiz/new-school-year` | Nieuw schooljaar starten |

---

#### I) Aanpassingen quiz-meta bij aanmaken (terugkoppeling naar sprint 16b)

Bij uitrollen van sprint 17b: `quiz-teacher.html` wizard stap 1 uitbreiden met schooljaar en klas. Schooljaar standaard het huidig schooljaar (berekend: augustus = nieuw jaar).

---

### Sprint 18a — Vraagtypen: open vraag + meerkeuze + single choice *(~3 dagen)*

**Impact:** Uitbreiding van vragenbank, toets-aanmaak, leerling-quizscherm en verbetermodule.
**Vereiste voorbereiding:** sprint 17 afgerond.
**Risico:** Gemiddeld — raakt quiz_bank, quiz_question_snapshots en quiz_answers.

---

#### Achtergrond

Op dit moment zijn alle vragen van het type "schrijf Python code". Sprint 18 voegt twee extra vraagtypen toe die naast de code-editor kunnen leven:

| Type | Wanneer gebruiken |
|---|---|
| **Open vraag** (huidig) | Leerling schrijft Python code en test het zelf |
| **Meerkeuze** | Leerling kiest één of meerdere antwoorden uit een lijst |
| **Single choice** | Leerling kiest exact één antwoord (radio buttons) |

Alle drie typen kunnen door elkaar in dezelfde toets voorkomen. De volgorde is willekeurig per leerling (bestaand random-systeem).

---

#### A) Database uitbreidingen

```sql
-- Vraagtype toevoegen aan quiz_bank
ALTER TABLE quiz_bank
  ADD COLUMN IF NOT EXISTS question_type TEXT NOT NULL DEFAULT 'code',
  -- 'code' = Python editor (huidig)
  -- 'open' = vrije tekst (geen editor, geen run-knop)
  -- 'multiple' = meerkeuze (checkbox, meerdere juist)
  -- 'single'   = single choice (radio, één juist)
  ADD COLUMN IF NOT EXISTS choices_json TEXT NOT NULL DEFAULT '[]';
  -- JSON array: [{ "id": "uuid", "text": "...", "correct": true/false }]
  -- 'correct' enkel ingevuld bij multiple/single, niet zichtbaar voor leerling

-- Snapshots ook uitbreiden
ALTER TABLE quiz_question_snapshots
  ADD COLUMN IF NOT EXISTS question_type TEXT NOT NULL DEFAULT 'code',
  ADD COLUMN IF NOT EXISTS choices_json  TEXT NOT NULL DEFAULT '[]';

-- Antwoorden uitbreiden voor meerkeuze
ALTER TABLE quiz_answers
  ADD COLUMN IF NOT EXISTS selected_choices TEXT NOT NULL DEFAULT '[]';
  -- JSON array van gekozen choice IDs
  -- Bij 'code' is dit altijd []
  -- Bij 'open': code kolom bevat de tekst, geen choices
```

---

#### B) Vragenbank uitbreiden (quiz-bank.html)

Bij aanmaken/bewerken van een vraag: keuze voor vraagtype bovenaan.

**Type: Meerkeuze / Single choice**

Extra formulierveld "Antwoordopties":

```
Antwoordopties:
  ○ A  [Python gebruikt witruimte voor inspringing      ] [✓ Juist] [✕]
  ○ B  [Python gebruikt accolades { } voor inspringing  ] [  Juist] [✕]
  ○ C  [Python gebruikt puntkomma's voor inspringing    ] [  Juist] [✕]
  ○ D  [Python gebruikt haakjes voor inspringing        ] [  Juist] [✕]
                                                          [+ Optie toevoegen]
```

- Bij **single choice**: slechts één optie kan "Juist" zijn (radio-gedrag)
- Bij **meerkeuze**: meerdere opties kunnen "Juist" zijn (checkbox-gedrag)
- Minimum 2 opties, maximum 8 opties
- Volgorde opties kan gesleept worden (drag & drop)
- Bij aanmaken toets: opties kunnen ook per toets gerandomiseerd worden (optie in quiz_meta)

**Type: Open vraag (vrije tekst)**

Eenvoudige textarea bij de leerling. Geen editor, geen run-knop. Handmatig verbeteren door leerkracht (net als bij code, maar zonder uitvoeren).

---

#### C) Leerling quizscherm (quiz-student.html)

Het scherm past zich aan per vraagtype:

**Code (huidig):**
Monaco editor + Run knop + output — ongewijzigd.

**Open vraag:**
```
Vraag 3 van 5 · Open vraag
──────────────────────────
Leg in eigen woorden uit wat een variabele is in Python.

┌──────────────────────────────────────────────────┐
│ (vrije tekst)                                    │
│                                                  │
│                                                  │
└──────────────────────────────────────────────────┘
Nog 500 tekens beschikbaar.
```

**Single choice:**
```
Vraag 4 van 5 · Single choice
──────────────────────────────
Welk symbool gebruik je in Python om een commentaar te beginnen?

  ○ //
  ○ #
  ○ --
  ○ /* */
```

**Meerkeuze:**
```
Vraag 5 van 5 · Meerkeuze (meerdere antwoorden mogelijk)
─────────────────────────────────────────────────────────
Welke van de volgende datatypen bestaan in Python?

  ☑ int
  ☐ char
  ☑ float
  ☑ str
  ☐ double
```

Navigatie (Vorige/Volgende) en opslaan werken identiek als bij code-vragen. Antwoord van meerkeuze/single wordt als `selected_choices: ["id1", "id2"]` opgeslagen.

---

#### D) Toets aanmaken (quiz-teacher.html)

Bij vragenselectie uit de bank: type-badge zichtbaar bij elke vraag (CODE / OPEN / KEUZE). Extra optie bij toetsinstellingen:

```
☑ Antwoordopties randomiseren
  (volgorde van keuze-opties willekeurig per leerling)
```

---

#### E) Verbetermodule (quiz-review.html)

**Code-vragen:** ongewijzigd — uitvoeren, score, commentaar.

**Open vragen:** textarea met leerlingenantwoord (read-only), score en commentaar. Geen uitvoeren-knop.

**Meerkeuze/single choice:** toont gekozen opties met visuele markering:

```
Vraag 4 — Single choice
Correct antwoord: # (optie B)

  ✓ //    → ✕ Niet gekozen (fout)
  ✓ #     → ✓ Correct gekozen
  ✗ --    → ✕ Niet gekozen (fout)
  ✗ /* */ → ✕ Niet gekozen (fout)
```

Groen = correct gekozen, rood = fout gekozen of correct maar niet gekozen.

---

### Sprint 18b — Automatische scoring meerkeuze/single choice *(~1 dag)*

**Impact:** Uitbreiding van quiz_submit logica en verbetermodule.
**Vereiste voorbereiding:** sprint 18a afgerond.
**Risico:** Laag.

---

#### Wat het doet

Bij indiening van een toets met meerkeuze/single choice vragen: server berekent automatisch de score op basis van de correcte antwoorden in `choices_json`.

**Scoringslogica:**

| Situatie | Score |
|---|---|
| Alle correcte opties geselecteerd, geen foute | Volledig (max punten) |
| Gedeeltelijk correct (meerkeuze) | Pro-rata (bv. 2 van 3 correct = 2/3 van de punten) |
| Fout antwoord geselecteerd | 0 voor die vraag |
| Single choice: juist antwoord | Volledig |
| Single choice: fout antwoord | 0 |

Automatische scores zijn zichtbaar in de verbetermodule maar kunnen door de leerkracht nog overschreven worden. Badge "🤖 Auto" naast de score als die automatisch berekend is.

#### Leerkracht workflow na automatische scoring

1. Open verbetermodule
2. Meerkeuze/single vragen zijn al gescoord (🤖 badge)
3. Leerkracht controleert, past eventueel aan bij randgevallen
4. Open/code vragen nog handmatig scoren
5. Exporteren

---

### Sprint 19a — Betrouwbaarheid: quiz backup + vrije editor + versie-endpoint *(🔴 P1-3 · ~0.5 dag)*

**Impact:** Kleine aanpassingen in server.js en app.js. Geen nieuwe HTML-pagina's.
**Vereiste voorbereiding:** geen — onafhankelijk.
**Risico:** Laag.

---

#### 1) Quiz: tussentijdse backup verlagen naar 15s

Tijdens een actieve quiz-sessie wordt het antwoord per vraag nu elke 60s naar PostgreSQL geschreven. Bij een servercrash gaat max 60s werk verloren — voor een toets te veel. Fix: interval verlagen naar 15s **enkel bij quiz-sessies**.

```js
// In quiz_save_answer handler — verander interval
const backupInterval = session.mode === 'quiz' ? 15000 : 60000;
```

#### 2) Vrije editor: code bewaren in localStorage

Code in de vrije editor verdwijnt bij pagina-verversing. Oplossing: code automatisch opslaan in `localStorage` onder sleutel `pycodeflow_free_code_[naam]`. Bij herladen de code herstellen.

```js
// Elke 5s code opslaan
setInterval(() => {
  const code = editorStore.free?.getValue();
  if (code) localStorage.setItem('pycodeflow_free_code', code);
}, 5000);

// Bij init: herstellen
const saved = localStorage.getItem('pycodeflow_free_code');
if (saved) setEditorValue('free', saved);
```

#### 3) Versie-endpoint

```js
app.get('/api/version', (req, res) => {
  res.json({ version: APP_VERSION, uptime: Math.round(process.uptime()) });
});
```

Zichtbaar in check-deployment.sh en in monitoring.html. Zo zie je direct of de juiste versie deployed is.

---

### Sprint 19b — Schoollogo in UI en PDF *(🔴 P1-4 · ~0.5 dag)*

**Impact:** Kleine aanpassing in styles.css, alle HTML-topbars en PDF-generatie.

---

Logo configureerbaar via `.env`:
```env
SCHOOL_LOGO_PATH=/app/public/assets/logo.png
SCHOOL_NAME=Atheneum Hoboken
```

**In de webapplicatie:** logo verschijnt links in de topbar naast "PyCodeFlow". Als `SCHOOL_LOGO_PATH` niet ingesteld is: alleen de tekst.

**In PDF export:** logo rechtsboven op elke pagina. Indien afwezig: enkel schoolnaam als tekst.

Formaat: PNG of SVG, max 200x60px. Via `pycodeflow.sh` menu-item om logo te uploaden vanuit de NAS.

---

### Sprint 19c — check-deployment.sh volledig bijwerken *(🔴 P1-5 · ~0.5 dag)*

**Impact:** Enkel check-deployment.sh — geen applicatiecode.

---

Huidige checks dateren van sprint 6. Uitbreiden met:

```bash
# PostgreSQL bereikbaar
✅ docker exec pycodeflow-postgres-1 pg_isready -U pycodeflow

# Alle quiz-tabellen aanwezig
✅ quiz_bank, quiz_meta, quiz_answers, quiz_question_snapshots, ...

# npm packages aanwezig
✅ pg, pdfkit

# Versie-endpoint werkt
✅ GET /api/version → retourneert huidig versienummer

# Quiz-bank endpoint bereikbaar
✅ GET /api/quiz/bank → retourneert array

# Alle nieuwe HTML-pagina's bereikbaar (achter auth)
✅ /admin.html, /quiz-bank.html, /quiz-teacher.html,
   /quiz-student.html, /quiz-review.html, /quiz-archive.html

# Log-rotatie geconfigureerd
✅ LOG_RETENTION_DAYS aanwezig in .env

# Security headers aanwezig
✅ Content-Security-Policy, X-Frame-Options, Strict-Transport-Security

# Geen logbestanden ouder dan LOG_RETENTION_DAYS + 2 dagen
✅ find logs/ -name "*.log" -mtime +9 → leeg
```

---

### Sprint 19d — Notificatie: leerling heeft toets nog niet gestart *(🔴 P1-6 · ~0.5 dag)*

**Impact:** Kleine uitbreiding in server.js en teacher-app/quiz-teacher interfaces.

---

In het live leerkrachten-overzicht tijdens een toets: als een leerling die via `student_join` verbonden is nog op het startscherm zit (timer nog niet gestart), krijgt de leerkracht een visuele indicator:

```
Emma Janssens    ⏳ Nog niet gestart   [📢 Herinnering sturen]
Luca Peeters     V2/5 · 1 opgeslagen  ▶
Sara Declercq    ✅ Ingediend
```

Knop "📢 Herinnering sturen" stuurt een socket event naar die leerling: een opvallende banner "⚠️ Start de toets! Klik op START TOETS om je timer te beginnen."

Automatische waarschuwing na 5 minuten als leerling nog niet gestart heeft: melding bij leerkracht (niet automatisch naar leerling — leerkracht beslist).

---

### Sprint 19e — Servercrash notificatie *(🔴 P1-7 · ~1 dag)*

**Impact:** Nieuw script buiten de Docker containers. Werkt als externe monitor.

---

Twee lagen:

**Laag 1 — Docker healthcheck uitbreiden**
`docker-compose.yml` uitbreiden met healthcheck op de web container die elke 30s `GET /health` polt. Bij falen: container automatisch herstart (`restart: unless-stopped` werkt dit al deels).

**Laag 2 — Externe notificatie**
Klein bash-script op de NAS (buiten Docker) dat elke 5 minuten runt via cron:

```bash
#!/bin/bash
# /volume3/docker/pycodeflow/health-monitor.sh
if ! curl -sf http://localhost:3000/health > /dev/null 2>&1; then
  echo "$(date): PyCodeFlow niet bereikbaar" >> /volume3/docker/pycodeflow/logs/health.log

  # Optie A: webhook (bv. naar een eigen server, ntfy.sh, of Slack)
  WEBHOOK_URL=$(grep WEBHOOK_URL /volume3/docker/pycodeflow/.env | cut -d= -f2)
  if [[ -n "$WEBHOOK_URL" ]]; then
    curl -sf -X POST "$WEBHOOK_URL"       -H "Content-Type: application/json"       -d '{"text":"⚠️ PyCodeFlow is niet bereikbaar!"}' > /dev/null
  fi
fi
```

Configureerbaar via `.env`:
```env
WEBHOOK_URL=https://ntfy.sh/jouw-kanaal
# of leeg laten = enkel logging, geen externe notificatie
```

`pycodeflow.sh` krijgt een extra optie "14) ⚙️ Health monitor installeren" die de cronjob automatisch instelt.

---

### Sprint 19f — Markdown rendering in vraagstellingen *(🔴 P1-8 · ~1 dag)*

**Impact:** quiz-bank.html, quiz-student.html, quiz-review.html, quiz-teacher.html.

---

Vraagstellingen ondersteunen momenteel alleen plain text. Met Markdown kunnen leerkrachten:

- **vetgedrukte** woorden voor nadruk
- `code` inline voor Python-snippets
- Opsommingen voor meerkeuze-context
- Codeblokken voor langere voorbeelden

```
## Voorbeeld vraagstelling in Markdown:

Schrijf een functie `bereken(x, y)` die het volgende doet:

- Als `x > y`: geef `x - y` terug
- Anders: geef `x + y` terug

**Let op:** gebruik geen `if/else` maar een ternary operator.
```

**Implementatie:** marked.js (lichtgewicht, geen server-side rendering nodig). Wordt via CDN geladen of gebundeld. Sanitisatie via DOMPurify om XSS te vermijden.

In de vragenbank: toggle "Preview" naast het tekstveld toont de gerenderde Markdown. Bij de leerling: vraagstelling altijd gerenderd. In PDF: Markdown omgezet naar plain text (bold → CAPS, code → monospace).

---

### Sprint 19g — Sessie-config persistent na herstart *(🔴 P1-9 · ~0.5 dag)*

**Impact:** database.js, server.js. Kleine wijziging.

---

De sessie-config (autoIndent, quickSuggestions, ...) staat nu in-memory. Bij serverherstart is alles terug op de modus-standaard. Dit is verrassend als je midden in een les aan het werken bent.

Oplossing: `session.config` opslaan als JSON in de bestaande `sessions` tabel als extra kolom, of via een aparte kolom in `quiz_meta` voor quiz-sessies.

```sql
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS config_json TEXT NOT NULL DEFAULT '{}';
```

Bij `schedulePersist` wordt `config_json` mee opgeslagen. Bij `loadActiveSessions` wordt het hersteld.

---

### Sprint 19h — Bulk PDF export: aparte bestanden per leerling *(🔴 P1-10 · ~1 dag)*

**Impact:** server.js (PDF routes), quiz-review.html.

---

Huidig: "Exporteer alles" genereert één gecombineerde PDF met alle leerlingen achter elkaar. Voor individuele inlevering (elke leerling zijn eigen formulier) moet je 30 keer klikken.

Nieuw: knop "⬇ ZIP met aparte PDF's" in quiz-review.html. Genereert een ZIP-archief met per leerling een aparte PDF:

```
toets-ABCD1234-antwoorden.zip
├── 01_Emma_Janssens.pdf
├── 02_Luca_Peeters.pdf
├── 03_Sara_Declercq.pdf
└── ...
```

Implementatie via `archiver` npm package (of native Node.js streams). Bestanden worden on-the-fly gegenereerd en gestreamed naar de browser — geen tijdelijke bestanden op schijf.

---

### Sprint 19i — Automatische PostgreSQL backup *(🔴 P1-11 · ~1 dag)*

**Impact:** pycodeflow.sh, docker-compose.yml, nieuw backup-script.

---

Dagelijkse automatische backup van de PostgreSQL database. 7 dagen bewaren, oudere backups automatisch verwijderd. Logging van succes/falen.

**Implementatie:**

```bash
#!/bin/bash
# /volume3/docker/pycodeflow/scripts/backup-db.sh

BACKUP_DIR="/volume3/docker/pycodeflow/backups"
DATUM=$(date +%Y%m%d-%H%M)
BESTAND="$BACKUP_DIR/pycodeflow-$DATUM.sql.gz"
LOG="$BACKUP_DIR/backup.log"
BEWAAR_DAGEN=7

mkdir -p "$BACKUP_DIR"

# Backup uitvoeren
docker exec pycodeflow-postgres-1   pg_dump -U pycodeflow pycodeflow | gzip > "$BESTAND"

if [[ $? -eq 0 ]]; then
  GROOTTE=$(du -sh "$BESTAND" | cut -f1)
  echo "$(date): ✅ Backup OK — $BESTAND ($GROOTTE)" >> "$LOG"
else
  echo "$(date): ❌ Backup MISLUKT" >> "$LOG"
  # Webhook notificatie (als geconfigureerd)
fi

# Oude backups verwijderen (> 7 dagen)
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$BEWAAR_DAGEN -delete
VERWIJDERD=$(find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$BEWAAR_DAGEN | wc -l)
if [[ $VERWIJDERD -gt 0 ]]; then
  echo "$(date): 🗑 $VERWIJDERD oude backup(s) verwijderd" >> "$LOG"
fi
```

**Scheduling:** `pycodeflow.sh` optie "15) 💾 Backup instellen" configureert een cronjob voor dagelijks om 02:00.

**In pycodeflow.sh:** nieuw menu-item toont backup-status (laatste backup, grootte, hoeveel bewaard) en biedt manuele backup aan.

**In monitoring.html:** backup-status zichtbaar (laatste backup timestamp, grootte, OK/FOUT).

---

### Sprint 19j — Toets/taak: tijdsvenster + toegang zonder leerkracht online *(🔴 P1-12 · ~1.5 dag)*

**Impact:** database.js (quiz_meta), server.js (session herstel + toegangslogica), quiz-teacher.html (tijdsvenster UI), quiz-student.html (te laat inleveren scherm), quiz-archive.html (inlevertijdstempel).
**Vereiste voorbereiding:** sprint 16 (toetsmodule) afgerond.
**Risico:** Gemiddeld — raakt de kern van sessie-toegang en quiz-flow.

---

#### Achtergrond — huidig probleem

Op dit moment geldt voor alle sessies:
- Een sessie bestaat enkel in geheugen (`sessions` Map) zolang de server draait
- Bij serverherstart worden actieve (niet-gesloten) sessies hersteld uit PostgreSQL
- **Maar:** leerlingen kunnen enkel joinen als de sessie nog open staat (niet `closed`)
- De leerkracht moet de sessie aangemaakt hebben EN de server moet draaien

Voor **taken thuis** is dit een probleem:
- Leerkracht zet taak klaar op vrijdagmiddag
- Server herstart in het weekend (update, stroomonderbreking)
- Sessie verdwijnt uit geheugen → leerling kan niet meer joinen maandag

Voor **toetsen met tijdsvenster** (bv. 9:20–10:10) is er bovendien geen manier om toegang automatisch te openen en te sluiten.

---

#### A) Database: tijdsvenster toevoegen aan quiz_meta

```sql
ALTER TABLE quiz_meta
  ADD COLUMN IF NOT EXISTS access_from   BIGINT,  -- NULL = direct toegankelijk
  ADD COLUMN IF NOT EXISTS access_until  BIGINT,  -- NULL = geen eindtijd
  ADD COLUMN IF NOT EXISTS auto_submit_late BOOLEAN NOT NULL DEFAULT true;
  -- true = bij access_until automatisch alles indienen wat nog openstaat
  -- false = leerling kan niet meer indienen maar ziet wel TAAK NIET TIJDIG INGELEVERD scherm
```

Gecombineerd met de bestaande `no_timer` (geen individuele countdown) en `timer_seconds` (individuele countdown per leerling):

| Combinatie | Gedrag |
|---|---|
| `access_from` + `access_until` + `timer_seconds` | Venster waarbinnen leerling kan starten, individuele timer loopt daarna |
| `access_from` + `access_until` + `no_timer` | Venster waarbinnen leerling werkt, geen individuele timer |
| `access_from` + geen `access_until` | Toegang vanaf datum, nooit automatisch gesloten |
| Geen `access_from` | Direct toegankelijk (huidig gedrag klassessie) |

---

#### B) Sessie-herstel: quiz-sessies altijd herslaan na herstart

Huidige logica bij serverherstart: enkel sessies met `closed = 0` worden hersteld.

**Probleem:** een quiz-sessie die "open" staat maar waarvoor de leerkracht niet online is, wordt wél hersteld maar de `teacherSocketId` is null. Dat werkt al grotendeels correct.

**Aanvulling voor tijdsvenster:** ook sessies met een toekomstig `access_from` moeten in geheugen geladen worden zodat leerlingen op tijd kunnen joinen:

```js
// In loadActiveSessions — uitbreiden:
// Laad ook quiz-sessies die een toekomstig tijdsvenster hebben
// en nog niet verlopen zijn (access_until > now OF access_until IS NULL)
SELECT * FROM sessions s
JOIN quiz_meta m ON m.session_code = s.code
WHERE s.deleted = 0
  AND s.closed = 0
  AND (m.access_until IS NULL OR m.access_until > NOW())
```

---

#### C) Toegangslogica bij student_join en quiz_start

Bij joinen of starten van een quiz: server checkt het tijdsvenster:

```js
// Voor quiz-sessies: check toegangsvenster
if (session.mode === 'quiz' && meta) {
  const now = Date.now();

  if (meta.access_from && now < meta.access_from) {
    const openOm = new Date(meta.access_from).toLocaleString('nl-BE');
    return socket.emit('error_message',
      `Deze toets/taak is nog niet beschikbaar. Toegang start op ${openOm}.`);
  }

  if (meta.access_until && now > meta.access_until) {
    // Venster verstreken — toon "te laat" scherm
    return socket.emit('quiz_access_expired', {
      deadline: meta.access_until,
      autoSubmitLate: meta.auto_submit_late,
    });
  }
}
```

**Scherm bij te laat inleveren:**

```
┌──────────────────────────────────────────────────────┐
│  ⏰  Inlevertermijn verstreken                       │
│                                                      │
│  Emma Janssens                                       │
│  Toets: Functies H2                                  │
│                                                      │
│  Deadline was: 26/06/2026 om 10:10                  │
│  Jij probeert in te loggen op: 26/06/2026 om 10:34  │
│                                                      │
│  Je antwoorden worden als leeg ingediend.            │
│  Op het PDF-formulier staat:                         │
│  "TAAK NIET TIJDIG INGELEVERD"                      │
│                                                      │
│  Neem contact op met je leerkracht.                 │
└──────────────────────────────────────────────────────┘
```

Bij `auto_submit_late = true`: server maakt automatisch een leeg antwoord-record aan voor elke vraag met de vlag `submitted_late = true`. Dit is zichtbaar in de verbetermodule en op de PDF.

---

#### D) Auto-submit bij verlopen tijdsvenster (server-side)

De server controleert elke minuut of een quiz-sessie voorbij zijn `access_until` is:

```js
setInterval(async () => {
  const now = Date.now();
  for (const [code, session] of sessions.entries()) {
    if (session.mode !== 'quiz') continue;
    const meta = await dbModule.getQuizMeta(code);
    if (!meta?.access_until || now < meta.access_until) continue;
    if (session._accessExpiredHandled) continue;

    session._accessExpiredHandled = true;

    // Stuur quiz_force_submit naar alle leerlingen die nog bezig zijn
    for (const student of Object.values(session.students)) {
      if (!student.quizSubmitted && student.socketId) {
        io.to(student.socketId).emit('quiz_force_submit', { reason: 'deadline' });
      }
      // Auto-submit ook server-side
      if (!student.quizSubmitted) {
        await dbModule.submitQuizAnswers(code, student.id, true);
      }
    }

    console.log(`[quiz] Sessie ${code}: deadline bereikt, auto-submit uitgevoerd`);
  }
}, 60 * 1000);
```

---

#### E) quiz-teacher.html: tijdsvenster instellen

Extra veld in stap 1 van de wizard:

```
Toegangsvenster (optioneel):
  Van:  [26/06/2026] [09:20]
  Tot:  [26/06/2026] [10:10]   ← leeg = geen automatische sluiting

  □ Leeg antwoordformulier genereren voor leerlingen die niet op tijd inleveren
    (met "TAAK NIET TIJDIG INGELEVERD" als aantekening)
```

Datumvelden: `<input type="datetime-local">` — standaard leeg (geen venster). Validatie: `access_from` moet vóór `access_until` liggen.

---

#### F) Inlevertijdstempel in verbetermodule en PDF

Bij elk ingediend antwoord wordt `submitted_at` al opgeslagen (bestaand). Sprint 19j voegt toe:

**In quiz-review.html:**
```
Emma Janssens · Ingediend: 26/06/2026 om 09:47  ✅ Op tijd
Luca Peeters  · Ingediend: 26/06/2026 om 10:34  ⚠️ Te laat (24 min na deadline)
Sara Declercq · Niet ingediend                   ❌ TAAK NIET TIJDIG INGELEVERD
```

**Op PDF antwoordformulier (Type 2a/2b):**
- Kopbal: "Ingediend om: 09:47 · ✅ Op tijd" of "⚠️ TAAK NIET TIJDIG INGELEVERD"
- Bij te laat: deadline + werkelijke inlevertijd + verschil in minuten
- Bij niet ingediend: "TAAK NIET TIJDIG INGELEVERD" als watermerk-achtige tekst over het formulier

---

#### G) Toegang zonder leerkracht online — klassessies vs quiz

| Sessietype | Gedrag zonder leerkracht online |
|---|---|
| Klassessie | Ongewijzigd — leerling kan joinen, code synchronisatie werkt, enkel live feedback van leerkracht ontbreekt |
| Examensessie | Ongewijzigd — leerling kan werken, tab-detectie werkt, leerkracht ziet alles bij volgende login |
| Quiz met tijdsvenster | **Nieuw:** leerling kan joinen en werken binnen het venster, auto-submit bij deadline, leerkracht hoeft niet online te zijn |
| Quiz zonder tijdsvenster | Ongewijzigd — direct toegankelijk, leerkracht hoeft niet online |

Leerkracht kan later (na deadline) inloggen → verbetermodule openen → alle ingediende antwoorden staan klaar.

---

### Sprint 20a — Audit-log leerkrachtenacties *(🟠 P2-1 · ~1 dag)*

**Impact:** server.js (middleware), database.js (nieuwe tabel), monitoring.html.

---

**Wat wordt gelogd:**
- Score gewijzigd: wie, welke toets, welke leerling, oude score → nieuwe score, tijdstip
- Toets verwijderd: wie, welke toets, tijdstip
- Leerling geblokkeerd/gedeblokkeerd: wie, welke leerling
- Sessie gesloten/verwijderd
- Leerkrachtsaccount aangemaakt/verwijderd

**Database:**
```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  actor       TEXT NOT NULL,        -- leerkracht gebruikersnaam
  action      TEXT NOT NULL,        -- 'score_changed', 'quiz_deleted', ...
  target      TEXT NOT NULL,        -- wat er veranderd is (toetscode, leerlingnaam)
  detail_json TEXT NOT NULL DEFAULT '{}', -- extra context (oude/nieuwe waarde)
  ip          TEXT NOT NULL DEFAULT '',
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
```

Zichtbaar in `monitoring.html` als een scrollbare tijdlijn van de laatste 50 acties. Filterbaar op leerkracht en actie-type. Exporteerbaar als CSV.

---

### Sprint 20b — Wachtwoord-reset flow leerkrachten *(🟠 P2-2 · ~1 dag)*

**Impact:** server.js (nieuwe routes), nieuw HTML-pagina teacher-reset.html, pycodeflow.sh.

---

**Scenario 1: Leerkracht vergeet wachtwoord, er is een admin beschikbaar**
Admin gaat naar `admin.html` → 🔑 Wachtwoord resetten → nieuw wachtwoord instellen. Dit werkt al.

**Scenario 2: Enige leerkracht vergeet wachtwoord (geen tweede admin)**
Via `pycodeflow.sh`:
```
pycodeflow.sh → 10) Leerkrachtsaccount aanmaken
→ of nieuw: 16) Wachtwoord resetten
  Gebruikersnaam: admin
  Nieuw wachtwoord: [invoer]
  → direct in DB bijgewerkt zonder authenticatie vereist
```

**Scenario 3: Self-service reset (toekomstig, met email)**
Knop "Wachtwoord vergeten?" op login-pagina. Vereist e-mail configuratie in `.env`. Buiten scope van deze sprint — enkel scenario 1 en 2.

---

### Sprint 21 — Systeembeheer volledig up-to-date *(🟠 P2-3 · ~1.5 dag)*

**Impact:** monitoring.html, server.js (monitoring API), check-deployment.sh.
**Vereiste voorbereiding:** alle P1-sprints afgerond (19a t/m 19i) zodat alle nieuwe features bestaan.
**Risico:** Laag — voornamelijk uitbreidingen aan bestaande monitoring-pagina.

---

#### Waarom nu

`monitoring.html` is aangemaakt in sprint 6 en sindsdien slechts marginaal bijgewerkt. De applicatie is intussen enorm gegroeid: PostgreSQL, quiz-module, PDF-export, archief, log-rotatie, backup-systeem. De monitoring-pagina weet van niets van dit alles.

---

#### A) Overzicht — wat de pagina nu toont vs. wat erbij moet

| Sectie | Huidig | Bijwerken naar |
|---|---|---|
| Server status | CPU, RAM, uptime | + PostgreSQL status, + backup status, + log-grootte |
| Sessies | Actieve sessies, leerlingen | + quiz-sessies apart, + ingediende toetsen |
| Runner | Wachtrij, actieve runs | Ongewijzigd — werkt al correct |
| Stresstest | Ramp-up, sustained, memory, custom | + quiz stresstest type, + resultaten historiek |
| Logs | Enkel stresstest logs | + applicatie-logs bekijken, + log-rotatie status |
| — | Ontbreekt | PostgreSQL sectie (verbinding, tabellen, grootte) |
| — | Ontbreekt | Backup sectie (laatste backup, grootte, schema) |
| — | Ontbreekt | Quiz statistieken (actieve toetsen, ingediend, gemiddelden) |
| — | Ontbreekt | Audit-log sectie (link naar sprint 20a output) |

---

#### B) Nieuwe secties monitoring.html

**PostgreSQL-sectie:**
```
┌──────────────────────────────────────────────────────┐
│ 🗄 PostgreSQL                                        │
│ Status: ● Verbonden                                  │
│ Tabellen: 18 · Grootte: 24.3 MB                     │
│ Leerkrachten: 2 · Klassen: 5 · Leerlingen: 87       │
│ Quiz-vragen in bank: 34 · Toetsen ooit: 12           │
└──────────────────────────────────────────────────────┘
```

**Backup-sectie:**
```
┌──────────────────────────────────────────────────────┐
│ 💾 Database backup                                   │
│ Laatste backup: 26/06/2026 02:00 · 3.2 MB · ✅ OK   │
│ Bewaard: 7 backups (7 dagen)                         │
│ Oudste: 19/06/2026                                   │
│ [🔄 Nu backuppen]                                    │
└──────────────────────────────────────────────────────┘
```

**Quiz-sectie:**
```
┌──────────────────────────────────────────────────────┐
│ 📝 Toetsen & Taken                                   │
│ Actieve quiz-sessies: 1 · Leerlingen bezig: 23       │
│ Ingediend vandaag: 18 · Verbeterd vandaag: 12        │
│ Vragen in bank: 34 · Toetsen totaal: 12              │
└──────────────────────────────────────────────────────┘
```

**Log-sectie:**
```
┌──────────────────────────────────────────────────────┐
│ 📋 Logs                                              │
│ Logbestanden: 6 · Totaal: 1.2 MB                    │
│ Retentie: 7 dagen · Oudste: 20/06/2026              │
│ [🗑 Opruimen] [📄 Bekijk laatste log]               │
└──────────────────────────────────────────────────────┘
```

---

#### C) Stresstest uitbreiden + resultatenweergave

Bestaande stresstests (ramp-up, sustained load, memory leak, custom) blijven intact. Toevoegen:

**Stresstest type: quiz**
- Simuleert 30 leerlingen die een quiz-sessie starten
- Elke leerling beantwoordt 5 vragen, runt 2-3 keer per vraag
- Alle leerlingen dienen gelijktijdig in na 2 minuten (kritieke piekbelasting)
- Metingen: opslagtijd per antwoord (target < 50ms), piekbelasting bij simultane submit, PostgreSQL-schrijfsnelheid

**Stresstest type: pdf**
- Simuleert het genereren van 30 antwoordformulieren tegelijk
- Metingen: geheugengebruik, generatietijd per PDF (target < 2s), totale tijd voor ZIP-export

---

#### C2) Stresstest resultatenkaart in monitoring.html

Per uitgevoerde stresstest verschijnt een resultatenkaart met twee lagen:

**Laag 1 — Testparameters (wat er getest werd):**

```
┌──────────────────────────────────────────────────────────────┐
│ Stresstest: Ramp-up               26/06/2026 · 14:32         │
├──────────────────────────────────────────────────────────────┤
│ Parameters:                                                  │
│   Type:            ramp-up                                   │
│   Sessies:         10                                        │
│   Leerlingen:      5 per sessie (50 totaal)                 │
│   Runs per sessie: 3                                         │
│   Duur:            60 seconden                               │
│   Concurrency:     10 gelijktijdige requests                 │
└──────────────────────────────────────────────────────────────┘
```

**Laag 2 — Meetresultaten + stresspercentage:**

```
┌──────────────────────────────────────────────────────────────┐
│ Resultaten:                                                  │
│                                                              │
│   Runs voltooid:      147 / 150       98.0% ✅              │
│   Runs gefaald:       3               2.0%  ✅              │
│   Gem. run-tijd:      1.24s           ████████░░  (target <2s)│
│   Max run-tijd:       3.87s           ⚠️ overschrijding      │
│   Runs in wachtrij:   12 (max)                              │
│   Runner-gebruik:     █████████░  89% stressload            │
│                                                              │
│   RAM web container:  124 MB  ████░░░░░░  41% van 300MB     │
│   RAM runner:         198 MB  ███████░░░  77% van 256MB ⚠️  │
│   CPU runner:         0.87 cores       ████████░░  87%       │
│                                                              │
│   PostgreSQL writes:  423 queries      gem. 8ms/query  ✅   │
│   PostgreSQL conns:   7 / 10 pool      ██████░░░░  70%      │
│                                                              │
│   Stressload score:   ████████░░  76%  🟠 MATIG             │
└──────────────────────────────────────────────────────────────┘
```

**Stressload percentage berekening:**

Het stressload-percentage is een gewogen gemiddelde van alle belastingsindicatoren:

| Indicator | Gewicht | Berekening |
|---|---|---|
| Runner RAM gebruik | 25% | `ram_used / ram_limit * 100` |
| Runner CPU gebruik | 20% | `cpu_cores_used / cpu_limit * 100` |
| Gem. run-tijd vs target | 20% | `avg_time / target_time * 100` (gecapped op 100%) |
| Gefaalde runs | 20% | `failed / total * 100` |
| PostgreSQL pool gebruik | 15% | `active_connections / pool_size * 100` |

Score-interpretatie:
- **0–40%** 🟢 LAAG — veel marge, systeem aan bij kracht
- **41–70%** 🟡 NORMAAL — gezonde belasting, geen zorgen
- **71–85%** 🟠 MATIG — let op, weinig marge bij piekbelasting
- **86–95%** 🔴 HOOG — server raakt aan zijn limieten
- **>95%**   ⛔ KRITIEK — directe actie vereist

**Historiek als grafiek:**

Stressload-percentages van de laatste 10 tests worden als lijndiagram getoond:

```
Stressload historiek (laatste 10 tests)
100% ┤
 90% ┤                              ●
 80% ┤            ●         ●─────/
 70% ┤      ●─────\─────────
 60% ┤ ●───/
 50% ┤
     └────────────────────────────────
       24/6  25/6  25/6  26/6  26/6
```

Klik op een datapunt → volledige resultatenkaart van die test.

---

**Database tabel voor historiek:**

```sql
CREATE TABLE IF NOT EXISTS stress_results (
  id            TEXT PRIMARY KEY,
  test_type     TEXT NOT NULL,           -- ramp-up, sustained, memory, quiz, pdf, custom
  ran_at        BIGINT NOT NULL,
  duration_sec  INTEGER NOT NULL,
  -- Parameters
  params_json   TEXT NOT NULL DEFAULT '{}',
  -- Resultaten
  runs_total    INTEGER NOT NULL DEFAULT 0,
  runs_ok       INTEGER NOT NULL DEFAULT 0,
  runs_failed   INTEGER NOT NULL DEFAULT 0,
  avg_run_ms    INTEGER,
  max_run_ms    INTEGER,
  ram_web_mb    INTEGER,
  ram_runner_mb INTEGER,
  cpu_runner_pct INTEGER,
  pg_queries    INTEGER,
  pg_avg_ms     INTEGER,
  pg_pool_used  INTEGER,
  -- Samenvatting
  stress_pct    INTEGER NOT NULL DEFAULT 0,   -- 0-100 gewogen stressload
  stress_label  TEXT NOT NULL DEFAULT 'OK',   -- LAAG / NORMAAL / MATIG / HOOG / KRITIEK
  log_filename  TEXT
);
CREATE INDEX IF NOT EXISTS idx_stress_ran ON stress_results(ran_at DESC);
```

Resultaten worden opgeslagen bij elke stresstest-run. De historiek is altijd beschikbaar, ook na serverherstart.

---

#### D) Monitoring API uitbreiden

`GET /api/monitoring` uitbreiden met:

```json
{
  "database": {
    "connected": true,
    "tableCount": 18,
    "sizeMB": 24.3,
    "teacherCount": 2,
    "classCount": 5,
    "studentCount": 87
  },
  "backup": {
    "lastBackupAt": 1719360000000,
    "lastBackupOk": true,
    "lastBackupSizeMB": 3.2,
    "backupCount": 7
  },
  "quiz": {
    "activeQuizSessions": 1,
    "studentsInProgress": 23,
    "submittedToday": 18,
    "totalQuestionsInBank": 34,
    "totalQuizSessions": 12
  },
  "logs": {
    "fileCount": 6,
    "totalMB": 1.2,
    "retentionDays": 7,
    "oldestFile": "2026-06-20"
  }
}
```

---

#### E) check-deployment.sh

Na sprint 19c is check-deployment.sh al bijgewerkt. Sprint 21 voegt toe:

```bash
# Stresstest types aanwezig
✅ Stresstest type 'quiz' beschikbaar
✅ Stresstest type 'pdf' beschikbaar

# Monitoring API volledig
✅ GET /api/monitoring retourneert database, backup, quiz, logs secties

# Backup script aanwezig
✅ scripts/backup-db.sh aanwezig en uitvoerbaar

# Backup recent genoeg
✅ Meest recente backup niet ouder dan 48 uur
```

---

### Sprint 14 — Google OAuth leerlingen *(uitgesteld)*

Uitgesteld tot er nood is aan meerdere leerkrachten of klassen. Huidige enkelvoudige opzet (1 leerkracht) maakt dit niet urgent.

**Wanneer relevant:** als meer leerkrachten het systeem gebruiken en leerlingenidentificatie nauwkeuriger moet.

**Wat het doet:**
- Leerlingen kunnen inloggen met schoolaccount (of elk Google-account)
- Naam en klas worden automatisch ingevuld
- Koppeling aan `students` tabel via `google_email`

**Domeinbeperking configureerbaar via `.env`:**
```env
GOOGLE_ALLOWED_DOMAINS=leerling.atheneumhoboken.be,atheneumhoboken.be
# Leeg = elke Google-account
```

**Benodigde packages:** `passport`, `passport-google-oauth20`, `express-session`

**Database:** kolommen `google_email` en `google_sub` zijn al aanwezig in het schema.

---

### Sprint 15 — Smartschool SSO *(optioneel, uitgesteld)*

Automatische klassenkoppeling via Smartschool. Pas starten na afstemming met ICT-coördinator en beschikbaarheid van Smartschool OAuth.

---


### Sprint 16a — Toetsmodule: vragenbank *(~2 dagen)*

**Impact:** Nieuwe pagina `quiz-bank.html`. Geen wijzigingen aan bestaande sessies.
**Vereiste voorbereiding:** sprint 12a+b+c afgerond (PostgreSQL actief, admin.html bereikbaar).
**Risico:** Laag — volledig additioneel, raakt niets bestaands.

---

#### Database uitbreiding (mee bij sprint 12 deployen)

```sql
-- Vragenbank: vragen leven onafhankelijk van toetsen
CREATE TABLE IF NOT EXISTS quiz_bank (
  id            TEXT PRIMARY KEY,
  text          TEXT NOT NULL,
  subject       TEXT NOT NULL DEFAULT '',
  difficulty    TEXT NOT NULL DEFAULT 'gemiddeld',
  max_points    INTEGER NOT NULL DEFAULT 4,
  created_by    TEXT REFERENCES teachers(id) ON DELETE SET NULL,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  archived      BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_quiz_bank_subject ON quiz_bank(subject);

-- Snapshot van vraag op moment van toets
-- Wijzigingen aan de bank hebben GEEN invloed op afgelopen toetsen
CREATE TABLE IF NOT EXISTS quiz_question_snapshots (
  id               TEXT PRIMARY KEY,
  session_code     TEXT NOT NULL REFERENCES sessions(code) ON DELETE CASCADE,
  bank_question_id TEXT REFERENCES quiz_bank(id) ON DELETE SET NULL,
  order_index      INTEGER NOT NULL,
  text_snapshot    TEXT NOT NULL,
  subject          TEXT NOT NULL DEFAULT '',
  points           INTEGER NOT NULL DEFAULT 4
);
CREATE INDEX IF NOT EXISTS idx_quiz_snapshots_session
  ON quiz_question_snapshots(session_code);

-- Antwoorden per leerling per vraag
CREATE TABLE IF NOT EXISTS quiz_answers (
  id               TEXT PRIMARY KEY,
  session_code     TEXT NOT NULL,
  student_id       TEXT NOT NULL,
  student_name     TEXT NOT NULL,
  student_class    TEXT NOT NULL DEFAULT '',
  question_id      TEXT NOT NULL REFERENCES quiz_question_snapshots(id),
  personal_order   INTEGER NOT NULL,
  code             TEXT NOT NULL DEFAULT '',
  run_count        INTEGER NOT NULL DEFAULT 0,
  first_visit_at   BIGINT,
  first_run_at     BIGINT,
  saved_at         BIGINT NOT NULL,
  submitted_at     BIGINT,
  auto_submitted   BOOLEAN NOT NULL DEFAULT false,
  score            INTEGER,
  teacher_comment  TEXT NOT NULL DEFAULT '',
  UNIQUE(session_code, student_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_quiz_answers_session
  ON quiz_answers(session_code);
CREATE INDEX IF NOT EXISTS idx_quiz_answers_student
  ON quiz_answers(session_code, student_id);

-- Algemeen commentaar per leerling per toets
CREATE TABLE IF NOT EXISTS quiz_general_comments (
  session_code    TEXT NOT NULL,
  student_id      TEXT NOT NULL,
  comment         TEXT NOT NULL DEFAULT '',
  updated_at      BIGINT NOT NULL,
  PRIMARY KEY(session_code, student_id)
);

-- Gepersonaliseerde vraagvolgorde per leerling
CREATE TABLE IF NOT EXISTS quiz_student_order (
  session_code  TEXT NOT NULL,
  student_id    TEXT NOT NULL,
  question_id   TEXT NOT NULL,
  personal_pos  INTEGER NOT NULL,
  PRIMARY KEY(session_code, student_id, question_id)
);

-- Quiz-metadata per sessie
CREATE TABLE IF NOT EXISTS quiz_meta (
  session_code     TEXT PRIMARY KEY
                   REFERENCES sessions(code) ON DELETE CASCADE,
  randomize        BOOLEAN NOT NULL DEFAULT true,
  timer_seconds    INTEGER NOT NULL DEFAULT 2700,
  individual_timer BOOLEAN NOT NULL DEFAULT true,
  min_runs_per_q   INTEGER NOT NULL DEFAULT 0,
  show_code_during_review BOOLEAN NOT NULL DEFAULT false,
  results_released BOOLEAN NOT NULL DEFAULT false,
  warning_shown    BOOLEAN NOT NULL DEFAULT false,
  created_at       BIGINT NOT NULL
);

-- Run-history per antwoord (voor gelijkenis-detectie en tijdlijn)
CREATE TABLE IF NOT EXISTS quiz_run_history (
  id           TEXT PRIMARY KEY,
  session_code TEXT NOT NULL,
  student_id   TEXT NOT NULL,
  question_id  TEXT NOT NULL,
  code         TEXT NOT NULL,
  ran_at       BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quiz_run_history
  ON quiz_run_history(session_code, student_id, question_id);
```

`initSchema()` in `database.js` uitbreiden met bovenstaande `CREATE TABLE IF NOT EXISTS` statements.

---

#### A) Vragenbank pagina `quiz-bank.html`

Bereikbaar via `monitoring.html` → "📝 Vragenbank" knop en via `teacher-sessions.html`.

**Functies:**
- Lijst van alle vragen, filterbaar op onderwerp en moeilijkheid
- Onderwerp-autocomplete op bestaande waarden (vrij tekstveld met datalist)
- Nieuwe vraag toevoegen (textarea voor vraagstelling + onderwerp + moeilijkheid + max punten)
- Bestaande vraag bewerken (✏️ knop)
- Vraag archiveren (verbergen zonder verwijderen)
- Vraag verwijderen (enkel als nog niet in een toets gebruikt)

**Layout vragen invoeren:**
```
Onderwerp:     [Functies              ] (autocomplete op bestaande waarden)
Moeilijkheid:  [● Makkelijk ○ Gemiddeld ○ Moeilijk]
Max punten:    [4]
Vraagstelling: [                                    ]
               [                                    ]
               [                                    ]
               (markdown ondersteund: **vet**, `code`, opsommingen)
[+ Toevoegen]
```

#### B) CSV bulk-import vragen

Endpoint `POST /api/quiz/bank/import-csv`. Formaat:
```csv
onderwerp,moeilijkheid,max_punten,vraag
Functies,gemiddeld,4,"Schrijf een functie die twee getallen optelt en het resultaat teruggeeft."
Lijsten,moeilijk,4,"Schrijf een functie die een lijst sorteert zonder .sort() te gebruiken."
Lussen,makkelijk,2,"Schrijf een lus die de getallen 1 tot en met 10 afdrukt."
```

Rapport na import: X toegevoegd, Y overgeslagen (duplicaat op basis van exacte vraagtekst).

#### C) REST endpoints vragenbank

| Methode | Endpoint | Auth | Beschrijving |
|---|---|---|---|
| GET | `/api/quiz/bank` | Leerkracht | Alle vragen (filter: `?subject=&difficulty=&archived=`) |
| GET | `/api/quiz/bank/subjects` | Leerkracht | Unieke onderwerpen (voor autocomplete) |
| POST | `/api/quiz/bank` | Leerkracht | Nieuwe vraag |
| PUT | `/api/quiz/bank/:id` | Leerkracht | Vraag bewerken |
| PUT | `/api/quiz/bank/:id/archive` | Leerkracht | Archiveren |
| DELETE | `/api/quiz/bank/:id` | Leerkracht | Verwijderen (enkel als ongebruikt) |
| POST | `/api/quiz/bank/import-csv` | Leerkracht | CSV bulk-import |

#### D) check-deployment toevoegen

- `quiz_bank` tabel aanwezig
- `GET /api/quiz/bank` endpoint bereikbaar en retourneert array
- `quiz-bank.html` bereikbaar

---

### Sprint 16b — Toetsmodule: toets aanmaken *(~2 dagen)*

**Impact:** Nieuw sessietype `quiz`. Uitbreiding van teacher-sessions.html en sessie-aanmaak flow.
**Vereiste voorbereiding:** sprint 16a afgerond (vragenbank gevuld met vragen).
**Risico:** Gemiddeld — raakt sessie-aanmaak flow maar voegt enkel toe, wijzigt niets aan `class`/`exam`.

---

#### A) Sessie aanmaken uitbreiden met type `quiz`

Bestaande "Nieuwe sessie" modal uitbreiden met derde keuze:

```
Sessietype:
  ○ Klassessie    — gedeelde code, live samenwerken
  ○ Examen        — individuele code, tab-detectie
  ● Toets/Taak    — vragenlijst, individuele timer, indiening
```

Bij keuze "Toets/Taak" verschijnt extra configuratiescherm:

```
Naam:          [Toets Functies H2                    ]
Timer:         [45] minuten per leerling
Volgorde:      ● Random per leerling (aanbevolen)
                ○ Vast voor iedereen
Codehulp:      standaard via ⚙️ paneel (alles uit)
Min. runs:     □ Leerling moet elke vraag minstens 1x uitvoeren
Vraagstelling: □ Verberg vraagstelling op scherm (enkel op papier)
```

#### B) Vragen selecteren

Na basisinfo: vragenselectie uit de bank.

```
Filter: [Functies ▼] [Gemiddeld ▼]              [🔍 Zoeken]

☑ Schrijf een functie die twee getallen optelt...  Functies · /4 · 👁 Preview
☑ Schrijf een functie die een lijst sorteert...    Lijsten  · /4 · 👁 Preview
☐ Schrijf een lus die 1 tot 10 afdrukt...          Lussen   · /2 · 👁 Preview

Geselecteerde vragen (sleep om volgorde te wijzigen):
  1. [≡] Functie optellen          /4 punten [aanpassen: 3]
  2. [≡] Lijst sorteren            /4 punten [aanpassen: 4]

Totaal: 2 vragen · 7 punten · ~45 min
[← Terug]                          [Sessie aanmaken →]
```

Punten per vraag zijn overschrijfbaar voor deze toets zonder de bank te wijzigen.

#### C) Toets dupliceren

In teacher-sessions.html bij afgelopen toetsen: "📋 Dupliceer" knop. Maakt nieuwe sessie aan met dezelfde vragenlijst, timer en instellingen. Alle antwoorden en scores starten leeg. Handig voor dezelfde toets aan een andere klas of met lichte aanpassingen.

#### D) Leerkracht preview — "Test als leerling"

In teacher-sessions.html bij een aangemaakte toets (nog niet gestart): "👁 Test als leerling" knop. Leerkracht ziet exact hetzelfde scherm als leerlingen zullen zien. Alle antwoorden worden in een tijdelijke testsessie opgeslagen en niet meegeteld. Aparte badge "LEERKRACHT TEST" bovenaan zodat het duidelijk is dat dit geen echte deelname is.

#### E) Sessie-archief uitbreiden

`teacher-sessions.html` krijgt een apart tabblad "📝 Toetsen" naast "Sessies". Toetssessies verschijnen niet meer in de gewone sessielijst — aparte weergave met status (Aangemaakt / Actief / Afgelopen / Verbeterd / Vrijgegeven).

#### F) REST endpoints toets aanmaken

| Methode | Endpoint | Auth | Beschrijving |
|---|---|---|---|
| POST | `/api/quiz` | Leerkracht | Toets aanmaken (sessie + vragen + meta) |
| GET | `/api/quiz/:code` | Leerkracht | Toets info + vragen |
| POST | `/api/quiz/:code/duplicate` | Leerkracht | Toets dupliceren |
| GET | `/api/quiz/:code/preview` | Leerkracht | Preview-modus activeren |

---

### Sprint 16c — Toetsmodule: leerling quizscherm *(~2 dagen)*

**Impact:** Nieuw bestand `quiz-student.html`. Geen wijzigingen aan bestaande student-app.
**Vereiste voorbereiding:** sprint 16b afgerond.
**Risico:** Laag — volledig nieuw bestand.

---

#### A) Startscherm bij joinen

Bij joinen van een quiz-sessie verschijnt altijd eerst een startscherm (individuele timer):

```
┌────────────────────────────────────────────┐
│           PyCodeFlow Toets                 │
│                                            │
│     Toets: Functies H2                     │
│     5 vragen · 45 minuten                  │
│     Leerkracht: B. Claes                   │
│                                            │
│     Jouw naam: Emma Janssens               │
│     Klas: 6A Informatica                   │
│                                            │
│  ┌────────────────────────────────────┐    │
│  │  Lees de instructies aandachtig.  │    │
│  │  Jouw timer start pas als je      │    │
│  │  op onderstaande knop klikt.      │    │
│  └────────────────────────────────────┘    │
│                                            │
│        [  🚀 START TOETS  ]                │
│                                            │
│  (Je kan op elk moment opslaan en          │
│   terugkeren naar vorige vragen)           │
└────────────────────────────────────────────┘
```

Timer start op het moment van klikken op "START TOETS". Leerlingen die te laat aankomen verliezen dus tijd maar kunnen toch starten. Leerkracht ziet in het overzicht wie al gestart is en wie nog op het startscherm zit.

#### B) Quizscherm (zelfde look als student-app)

```
┌──────────────────────────────────────────────────────┐
│ PyCodeFlow                        ⏱ 38:24      🟢   │
├──────────────────────────────────────────────────────┤
│ Vraag 3 van 5   [1✓][2✓][3·][4][5]                  │
│ ─────────────────────────────────────────────────    │
│ Schrijf een functie die een lijst van getallen       │
│ sorteert zonder gebruik te maken van .sort()         │
│ ─────────────────────────────────────────────────    │
│ ┌──────────────────────────────────────────────┐     │
│ │ 1  # Schrijf hier jouw code                 │     │
│ │ 2                                            │     │
│ └──────────────────────────────────────────────┘     │
│ Ln 1, Kol 1 | Python | 0 regels    [Run ▶] [📋]      │
│ Output:                                              │
│ ┌──────────────────────────────────────────────┐     │
│ │                                              │     │
│ └──────────────────────────────────────────────┘     │
│ [← Vorige]          [📤 Indienen]    [Volgende →]     │
└──────────────────────────────────────────────────────┘
```

**Vraagnavigator legenda:**
- Grijs `[4]` = nog niet bezocht
- Blauw `[3·]` = bezocht, code aanwezig maar nog niet opgeslagen
- Groen `[1✓]` = opgeslagen (bij "Volgende" of "Vorige" klikken)
- Oranje `[2!]` = opgeslagen maar nooit gerund (als min-runs instelling actief)

#### C) Opslaan per vraag

Bij navigatie (Volgende/Vorige) wordt huidige code opgeslagen:
- In-memory op server (`session.students[id].quizAnswers[questionId]`)
- Elke 60 seconden ook naar PostgreSQL (`quiz_answers`) — tussentijdse backup
- Bij herverbinding na verbindingsverlies: server stuurt bewaarde antwoorden terug
- Lokale backup in `sessionStorage` voor extra veiligheid bij crash

#### D) Offline tolerantie

Als verbinding wegvalt:
- Editor blijft actief (Monaco werkt lokaal)
- Code automatisch opgeslagen in `sessionStorage` elke 30 seconden
- Banner: "⚠️ Verbinding verbroken — jouw code wordt lokaal bewaard"
- Bij herverbinding: lokale code automatisch gesynchroniseerd met server
- Timer loopt door op client-side (wordt bij herverbinding gecheckt met server)

#### E) Timer en waarschuwingen

- Timer loopt per leerling individueel vanaf "START TOETS"
- Server bijhoudt `startedAt` per leerling
- Elke seconde `quiz_timer_update` event met resterend tijd
- Bij 10% resterend: oranje banner `⚠️ Nog X minuten! Controleer al je antwoorden.`
- Bij 0: `quiz_force_submit` event → editor readOnly → alle antwoorden ingediend → bevestigingsscherm

#### F) Indienpagina met waarschuwingen

Bij klikken op "📤 Indienen" of bij timer = 0:

```
┌──────────────────────────────────────────────┐
│  📤 Toets indienen                           │
│                                              │
│  Controleer jouw antwoorden:                 │
│                                              │
│  ✅ Vraag 1 — opgeslagen (3 runs)            │
│  ✅ Vraag 2 — opgeslagen (1 run)             │
│  ⚠️ Vraag 3 — opgeslagen maar nooit gerund   │
│  ⚠️ Vraag 4 — nog niet bezocht               │
│  ✅ Vraag 5 — opgeslagen (2 runs)            │
│                                              │
│  Je bent zelf verantwoordelijk voor het      │
│  indienen. Niet-ingevulde vragen krijgen 0.  │
│                                              │
│  [← Terug naar toets]  [✅ Definitief indienen]│
└──────────────────────────────────────────────┘
```

#### G) Bevestigingsscherm na indiening

```
┌──────────────────────────────────────────────┐
│  ✅ Toets ingediend                          │
│                                              │
│  Emma Janssens · 6A Informatica              │
│  Ingediend om 14:32:17                       │
│  5 van 5 vragen beantwoord                  │
│                                              │
│  Wacht op de leerkracht.                    │
│  Je kan dit venster sluiten.                │
└──────────────────────────────────────────────┘
```

#### H) Socket events (nieuw)

| Event | Richting | Beschrijving |
|---|---|---|
| `quiz_start` | Leerling → Server | START TOETS knop → start individuele timer |
| `quiz_save_answer` | Leerling → Server | Antwoord opslaan bij navigatie |
| `quiz_run_completed` | Leerling → Server | Run voltooid → run_count + run_history bijwerken |
| `quiz_submit_all` | Leerling → Server | Definitief indienen |
| `quiz_timer_update` | Server → Leerling | Resterend tijd (elke seconde) |
| `quiz_warning` | Server → Leerling | 10% tijd resterend |
| `quiz_force_submit` | Server → Leerling | Timer verlopen → vergrendelen |
| `quiz_answer_saved` | Server → Leerling | Bevestiging opslaan |
| `quiz_student_progress` | Server → Leerkracht | Live voortgang per leerling |
| `quiz_restore_answers` | Server → Leerling | Antwoorden herstellen na reconnect |

#### I) Beveiliging: dubbele verbinding detecteren

Bij `quiz_start` of bij joinen: server checkt of `student_id` al actief is in dezelfde quiz-sessie. Tweede verbinding → foutmelding bij tweede browser + notificatie bij leerkracht: "⚠️ Emma Janssens lijkt van twee toestellen verbonden."

---

### Sprint 16d — Toetsmodule: verbetermodule *(~2 dagen)*

**Impact:** Nieuw bestand `quiz-review.html`. Uitbreiding bestaande REST API.
**Vereiste voorbereiding:** sprint 16c afgerond (antwoorden aanwezig in DB).
**Risico:** Laag — volledig nieuw bestand, leest bestaande data.

---

#### A) Verbetermodule `quiz-review.html`

Bereikbaar via teacher-sessions.html → "✏️ Verbeteren" bij afgelopen toets.

**Layout:**
```
┌──────────────────────────────────────────────────────────┐
│ Toets: Functies H2 · 15/06/2026 · 23 leerlingen         │
│ Verbeterd: 12/23 · Gemiddelde: 13.4/20                  │
├──────────────────────────────────────────────────────────┤
│ ◄ Emma Janssens (4/23) ►     Totaal: 14/20              │
│                              Ingediend: 14:32 (timer)    │
│ [V1 4/4✓][V2 2/4✓][V3 0/4·][V4 4/4✓][V5 4/4✓]         │
├──────────────────────────────────────────────────────────┤
│ Vraag 3 — Lijsten · Sorteer zonder .sort()  (max 4 pt)  │
│ Tijdstempel: bezocht 14:18 · eerste run 14:19 · 3 runs  │
│ ──────────────────────────────────────────────────────── │
│ ┌────────────────────────────────────────────────────┐   │
│ │ def sorteer(lst):                                  │   │
│ │     lst.sort()                                     │   │
│ │     return lst                                     │   │
│ └────────────────────────────────────────────────────┘   │
│ [▶ Uitvoeren]  [✏️ Aanpassen & testen]                   │
│ 📜 Run history: run 1 (14:19) · run 2 (14:21) · ...     │
│                                                          │
│ Output: [leeg]                                           │
│                                                          │
│ ⚠️ Verdachte gelijkenis: Luca Peeters (87% match)        │
│                                                          │
│ Score:    [2] / 4                                        │
│ Opmerking:[Gebruik van .sort() niet toegestaan. _____]   │
│                                    [💾 Opslaan]          │
│                                                          │
│ ──────────────── Algemeen commentaar ──────────────────  │
│ [Goed gewerkt. Let volgende keer op de randgevallen.___] │
│ [💾 Opslaan]                                             │
│                                                          │
│ [← Vorige]  [Volgende →]                                 │
│ [🖨️ PDF]  [⬇ Exporteer alle]  [🔓 Vrijgeven resultaten] │
└──────────────────────────────────────────────────────────┘
```

#### B) "Aanpassen & testen"

Editor tijdelijk editable voor de leerkracht. Wijziging wordt **niet** opgeslagen — enkel voor testen (bv. randgeval toevoegen). Badge "TEST" zichtbaar. "Herstel originele code" knop.

#### C) Run-history per vraag

Kleine tijdlijn onder de code: elke run die de leerling deed tijdens de toets. Leerkracht kan elke vorige run-versie bekijken door erop te klikken. Helpt bij evaluatie van het denkproces.

#### D) Gelijkenis-detectie

Na auto-submit van alle leerlingen: server vergelijkt code per vraag via Levenshtein-distance. Bij > 80% gelijkenis: waarschuwing in verbetermodule. Vergelijking puur informatief — geen automatische nul.

Implementatie: pure JavaScript Levenshtein zonder externe library, berekend server-side bij eerste openen verbetermodule.

#### E) Commentaar templates

Dropdown met veelgebruikte opmerkingen (zelfde systeem als annotatie-templates):
- "Gebruik van `.sort()` niet toegestaan"
- "Vergeten terug te geven met `return`"
- "Variabelenaam niet beschrijvend"
- "Werkt correct maar inefficiënte aanpak"
- Eigen templates toevoegen en bewaren

#### F) Resultaten vrijgeven aan leerlingen

"🔓 Vrijgeven" knop in verbetermodule. Zet `quiz_meta.results_released = true`. Daarna kunnen leerlingen via de sessiecode inloggen en hun eigen scores + commentaar bekijken (read-only). Geen extra account nodig.

Leerling-resultatenpagina: zelfde quizscherm maar editor read-only, score en commentaar per vraag zichtbaar, algemeen commentaar onderaan.

#### G) REST endpoints verbetermodule

| Methode | Endpoint | Auth | Beschrijving |
|---|---|---|---|
| GET | `/api/quiz/:code/answers` | Leerkracht | Alle antwoorden (overzicht) |
| GET | `/api/quiz/:code/answers/:studentId` | Leerkracht | Alle antwoorden één leerling |
| GET | `/api/quiz/:code/run-history/:studentId/:questionId` | Leerkracht | Run history |
| PUT | `/api/quiz/:code/answers/:answerId/score` | Leerkracht | Score + opmerking |
| PUT | `/api/quiz/:code/general-comment/:studentId` | Leerkracht | Algemeen commentaar |
| POST | `/api/quiz/:code/release` | Leerkracht | Resultaten vrijgeven |
| GET | `/api/quiz/:code/similarity` | Leerkracht | Gelijkenis-rapport |

#### H) Statistieken per vraag

Onderaan de verbetermodule: tabblad "📊 Statistieken":
- Gemiddelde score per vraag (bar chart)
- Verdeling scores (histogram)
- Gemiddeld aantal runs per vraag
- Meest gemaakte fouten (op basis van run_history foutmeldingen)
- Hergebruik: hoe scoorde deze vraag in vorige toetsen (via `bank_question_id`)

---

### Sprint 16e — Toetsmodule: PDF export *(~1 dag)*

**Impact:** Nieuwe npm dependency `pdfkit`. Nieuwe endpoints.
**Vereiste voorbereiding:** sprint 16d afgerond.
**Risico:** Laag — enkel additioneel.
**Package:** `pdfkit` (puur Node.js, geen Chromium, werkt op NAS zonder extra container).

---

#### Vier PDF-types

**Type 1 — Vragenblad** (voor de toets, uitdelen aan leerlingen)

Inhoud: schoolnaam + "PyCodeFlow" bovenaan, naam/klas invulvak, datum, timer, sessie-code. Per vraag: nummer, onderwerp, punten, vraagstelling (markdown → plain text), witregel voor notities. Monospace lettertype voor eventuele codeblokken in de vraag. Paginanummering. Vragen in originele volgorde (niet random — het vragenblad is voor iedereen gelijk).

**Type 2a — Antwoordformulier zonder verbetering** (direct na toets, nieten aan vragenblad)

Inhoud: naam, klas, datum, tijdstip indiening (handmatig of timer), volgorde tijdens toets. Per vraag: vraagnummer (origineel), onderwerp, score-invulvak leeg (`___/4`), ingediende code in grijs kader (monospace). Lege code → *(geen antwoord ingediend)*. Onderaan: totaal invulvak leeg, handtekeningvak.

Bij random volgorde: kleine noot per vraag *(Volgorde tijdens toets: positie 3)* zodat je het kunt koppelen aan het vragenblad.

**Type 2b — Antwoordformulier met verbetering** (na verbetermodule, teruggeven aan leerling)

Zelfde als 2a maar score ingevuld, commentaar per vraag zichtbaar, totaal ingevuld, algemeen commentaar onderaan.

**Type 3 — Klasoverzicht / scoreblad** (voor administratie)

Tabel: naam | V1 | V2 | V3 | V4 | V5 | Totaal. Compact, past op één A4 voor 30 leerlingen. Gemiddelde per vraag en klasgemiddelde onderaan. Gesorteerd op naam of score (keuze).

#### PDF opmaak instellingen

Configureerbaar via UI vóór genereren:
- Lettertype: standaard (Helvetica) of monospace (Courier)
- Papierformaat: A4 (standaard)
- Paginanummering: aan/uit
- Schoolnaam in header: configureerbaar in `.env` als `SCHOOL_NAME=Atheneum Hoboken`
- Logo: optioneel via `SCHOOL_LOGO_PATH` in `.env`

#### REST endpoints PDF

| Methode | Endpoint | Auth | Beschrijving |
|---|---|---|---|
| GET | `/api/quiz/:code/pdf/questions` | Leerkracht | Type 1: vragenblad |
| GET | `/api/quiz/:code/pdf/answers/:studentId` | Leerkracht | Type 2a/2b: antwoordformulier |
| GET | `/api/quiz/:code/pdf/answers` | Leerkracht | Alle antwoordformulieren in één PDF |
| GET | `/api/quiz/:code/pdf/overview` | Leerkracht | Type 3: klasoverzicht |
| GET | `/api/quiz/:code/export/zip` | Leerkracht | ZIP met .py bestanden per leerling |

Query parameter `?scored=true` op antwoordformulier geeft Type 2b (met verbetering), zonder geeft Type 2a.

---

### Sprint 16f — Toetsmodule: monitoring + stresstest *(~0.5 dag)*

**Impact:** Uitbreiding bestaande monitoring en stresstest infrastructuur.
**Vereiste voorbereiding:** sprint 16e afgerond.
**Risico:** Laag.

---

#### A) Monitoring uitbreiden

`GET /api/monitoring` uitbreiden met quiz-statistieken:

```json
{
  "quizSessions": {
    "active": 2,
    "studentsStarted": 45,
    "studentsSubmitted": 38,
    "answersInDB": 225,
    "avgRunsPerAnswer": 2.3
  }
}
```

`monitoring.html` uitbreiden met quiz-sectie: actieve toetssessies, voortgang per sessie.

#### B) Stresstest quiz-type

Nieuw stresstest-type `quiz` (achter `STRESS_TEST_ENABLED=true`):

Simulatie:
- 30 leerlingen joinen een quiz-sessie
- Elke leerling start de toets
- Elke leerling beantwoordt 5 vragen met willekeurige code
- Elke leerling runt 2-3 keer per vraag
- Alle leerlingen dienen in na 2 minuten

Metingen:
- Opslagtijd per antwoord (target: < 50ms)
- Piekbelasting bij auto-submit (30 leerlingen tegelijk) — kritiekste moment
- PostgreSQL query-tijd bij simultane writes
- Geheugengebruik runner tijdens simultane runs

#### C) check-deployment uitbreiden

Nieuwe checks:
```bash
✅ quiz_bank tabel aanwezig in PostgreSQL
✅ quiz_answers tabel aanwezig
✅ quiz_meta tabel aanwezig
✅ GET /api/quiz/bank retourneert array
✅ pdfkit aanwezig in package.json
✅ quiz-bank.html bereikbaar
✅ quiz-student.html bereikbaar
✅ quiz-review.html bereikbaar
```

#### D) test-readme.md uitbreiden

Volledige testprocedure voor sprint 16 toevoegen aan test-readme.md:
- Vragenbank: aanmaken, bewerken, CSV-import
- Toets aanmaken: vragenselectie, timer, random
- Leerkracht preview als leerling
- Leerling quizscherm: navigatie, opslaan, timer, indiening
- Verbetermodule: score, commentaar, gelijkenis
- PDF generatie: alle 4 types
- Stresstest quiz-type

---

## Afgeronde sprints

| Sprint | Inhoud | Versie | Datum |
|---|---|---|---|
| **13** | Klas-dropdown + sessie-config paneel | v2026.2.11.0 | 2026 |
| **12a+b+c** | PostgreSQL + admin-pagina + leerlingenbeheer | v2026.2.10.0 | 2026 |
| **11** | Polish: archief, history, wachtrij, autocheck | v2026.2.9.0 | 2026 |
| **Sec** | Beveiligingsaudit: 19 fixes | v2026.2.8.4 | 2026 |
| **10** | UX: thema, statusbalk, sneltoetsen, overzicht | v2026.2.8.0 | 2026 |
| **9** | Technische schuld + bugfixes | v2026.2.7.0 | 2026 |
| **8** | Code history playback | v2026.2.6.0 | 2026 |
| **7** | UI fixes, templates, dark mode, annotaties | v2026.2.5.0 | 2026 |
| **6** | Beveiliging, stresstest | v2026.2.4.0 | 2026 |
| **5** | UX verfijning | v2026.2.3.0 | 2026 |
| **4** | Kwaliteit + hand opsteken | v2026.2.2.0 | 2026 |
| **3** | Examengereedheid | v2026.2.1.0 | 2026 |
| **2** | SQLite + leerkrachtenlogin | v2026.2.0.0 | 2026 |
| **1** | Rate limiting + logout | v2026.1.38.0 | 2026 |

---

### Sprint 13 — Klas-dropdown + sessie-config *(v2026.2.11.0)*

**13A — Sessie-instellingenpaneel**
⚙️ knop in leerkrachten-toolbar opent paneel met 5 schakelknoppen. Live gesynchroniseerd naar alle leerlingen via `session_config_update`. Standaard: alles aan (klas), alles uit (examen). Fout-regel markering altijd aan.

Configureerbaar: `autoIndent`, `autoClosingBrackets`, `autoClosingQuotes`, `quickSuggestions`, `parameterHints`.

**13B — Klas-dropdown + toegangslogica**
Klas-tekstveld op `student-start.html` vervangen door dropdown via `GET /api/classes`. Fallback tekstveld als geen klassen aangemaakt. Keuze opgeslagen in `localStorage`.

Bij joinen: lookup in `students` tabel. Badges: ⚠️ Nieuw, ⏳ Afwachting, 👤 Gast. Geblokkeerde leerlingen worden geweigerd. Duplicaat-detectie binnen sessie.

**13C — Inline badge beheer**
Leerkracht aanvaardt/koppelt leerlingen direct vanuit sessie. Socket events `teacher_update_student_badge` en `teacher_assign_student_class`.

*Bestanden: server.js, app.js, styles.css, teacher-app.html, student-start.html*

---

### Sprint 12a+b+c — PostgreSQL + Admin-pagina *(v2026.2.10.0)*

**12a — PostgreSQL migratie**
`database.js` volledig async herschreven (`pg` Pool). Alle `dbModule.*` in server.js nu `async/await`. Schema via `initSchema()` bij startup. Migratescript `migrate-sqlite-to-pg.js`. `DATABASE_URL` in `.env` vereist.

**12b — Admin-pagina: leerkrachten & klassen**
`/admin.html` met tabbladen Leerkrachten / Klassen / Leerlingen. API: `/api/admin/teachers`, `/api/admin/classes`, `/api/classes`.

**12c — Admin-pagina: leerlingenbeheer**
CSV-import (`naam,klas` per regel). Acties: aanvaarden, blokkeren, klas wijzigen, notitie, verwijderen. `students` tabel met `google_email`/`google_sub` alvast aanwezig.

*Bestanden: database.js, server.js, admin.html, monitoring.html, migrate-sqlite-to-pg.js*

---

### Beveiligingsaudit *(v2026.2.8.4)*

19 fixes. Score: 54/100 → 93/100.

- `Math.random()` → `crypto.randomBytes()` voor sessiecodes
- Runner gebonden aan `127.0.0.1`
- HTTP security headers (CSP, X-Frame-Options, HSTS, Referrer-Policy, Permissions-Policy)
- Socket.IO `maxHttpBufferSize: 64KB`
- Per-socket CSRF nonce
- Cookie `Secure + SameSite=Strict`
- Naam max 64 tekens, annotatie max 500 tekens
- `express.json({ limit: '64kb' })`
- Stresstest achter `STRESS_TEST_ENABLED` env flag
- Rate limiting op `student_join` (10/min per IP)
- Sessiecode 8 tekens (was 6)
- Code max 32KB, output max 256KB

*Bestanden: server.js, app.py*

---

### Sprint 11 — Polish & archief *(v2026.2.9.0)*

- **11A** Gutter volgt editor thema (CSS variabelen)
- **11B** Sessie-archief: gesloten sessies in teacher-sessions met toggle
- **11C** Leerling ziet eigen code-history via 📜 knop
- **11D** Wachtrij: ⏳ pulserende animatie + tijdschatting
- **11E** Autocheck badge in teacher-sessions (elke 5 min)
- **11G** Docker memory limiet runner (256MB, 1 CPU)

*Bestanden: server.js, app.js, styles.css, database.js, teacher-sessions.html, student-app.html*

---

### Sprint 10 — UX verbeteringen *(v2026.2.8.0)*

- Editor thema toggle ☀️/🌙 per editor (onafhankelijk per gebruiker)
- Auto-indent, auto-sluiten haakjes en aanhalingstekens
- Fout-regel markering (rood) bij runtime errors
- Wacht-op-invoer indicator (pulserende blauwe balk)
- Sneltoetsen overlay (`?` of `Ctrl+?`)
- Timer voortgangsbalk groen→oranje→rood
- Statusbalk onderaan editor (Ln/Kol, regels, Python, UTF-8)
- Kopieer knoppen 📋 op code en output
- Grid overzichtsmodus leerkracht (⊞)
- Statusfilter knoppen (Alle / ✓ Klaar / ✋ Hand / ⚠️ Tab)
- Annotatie-templates dropdown
- Live run-status iconen ▶/⌨️/⏳
- Bevestigingsdialoog sessie sluiten
- Naam wijzigen via klikbare badge
- Verbindingsstatus dot 🟢/🟠/🔴
- Auto-scroll output
- Toetsenbordnavigatie leerlingenlijst

*Bestanden: server.js, app.js, styles.css, teacher-app.html, student-app.html, free-editor.html*

---

### Sprint 9 — Technische schuld & bugfixes *(v2026.2.7.0)*

- Memory leak `snapshotLastSaved` opgeruimd
- Timer `clearInterval` bij sessie-sluiting
- `apiFetch()` wrapper + CSRF token
- `session_annotations` tabel + persistentie
- Nederlandse foutuitleg: 21 Python-errors met 💡-tip
- Input-bug definitieve fix: runner weigert input als `waiting_for_input=False` (HTTP 409)
- Ghost keypresses geblokkeerd

*Bestanden: server.js, app.js, database.js, app.py*

---

### Sprint 8 — Code history *(v2026.2.6.0)*

- `code_snapshots` tabel
- History playback modaal met tijdlijnschuif en play/pauze
- Secundaire leerkrachtsrol (observer)

---

### Sprint 7 — UI fixes & onderwijs features *(v2026.2.5.0)*

- Templates (9 Python-oefeningen)
- Dark mode interface
- `run_error` gestructureerd event
- Leerkrachtannotatie (📌 floating panel, Monaco decoraties)

---

### Sprint 6 — Beveiliging & stresstest *(v2026.2.4.0)*

- IP rate limiting vrije editor
- `/health` endpoint
- Runner `preexec_fn` rlimits
- Stresstest: ramp-up, sustained load, memory leak

---

### Sprint 5 — UX verfijning *(v2026.2.3.0)*

- Aankondigingen chip-grid
- ✓ Klaar-knop + leerkracht reset
- 💾 Autosave indicator
- 📎 Snippet broadcast

---

### Sprint 4 — Kwaliteit & UX *(v2026.2.2.0)*

- ✋ Hand opsteken
- Aankondigingsgeschiedenis
- Syntaxcheck (`ast.parse()`)
- Monitoring historiek + Canvas grafiek
- Reconnect vrije sessie

---

### Sprint 3 — Examengereedheid *(v2026.2.1.0)*

- Export sessie als `.txt`
- Tab-detectie examenmodus
- `Ctrl+Enter` sneltoets
- `run_end` feedback bij lege output

---

### Sprint 2 — SQLite + leerkrachtenlogin *(v2026.2.0.0)*

- SQLite persistentie
- Login uit database
- `manage-teacher.js` CLI
- `migrate-env-to-db.js`

---

### Sprint 1 — Basiswerking *(v2026.1.35.7 → v2026.1.38.0)*

- Real-time code-editor (Monaco + Socket.IO)
- Python runner (Flask + subprocess sandbox)
- Klassessie + examenmodus
- Vrije editor
- Rate limiting (3s per socket)
- Logout-knop leerkrachten
- Monitoringpagina

---

*PyCodeFlow · Atheneum Hoboken*

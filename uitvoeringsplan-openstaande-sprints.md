# PyCodeFlow — Uitvoeringsplan openstaande sprints

> Opgesteld 07/07/2026 · vertrekpunt **v2026.2.34.9** · alle 102 tests groen

## Versienummering

Volgens het vastgelegde beleid volgt **MINOR het sprintnummer dat wordt uitgevoerd**, BUILD telt op binnen dezelfde fase. Daarom voeren we **in oplopende sprintvolgorde** uit — dan blijft het versienummer monotoon stijgen zonder gaten of downgrades:

| Sprint | Versie |
|---|---|
| 37d → 37a → 37b → 37c | `2026.2.37.0` … `2026.2.37.3` |
| 38 | `2026.2.38.0` |
| 40 | `2026.2.40.0` |
| 41 | `2026.2.41.0` |
| 42 | `2026.2.42.0` |
| 43 (geblokkeerd) | `2026.2.43.0` |

**Belangrijk:** 37 moet vóór 38, want 37b introduceert `model_answer` en sprint 38 moet dat veld meekopiëren bij het dupliceren van een vraag.

---

# DEEL 1 — Actieve sprints (uit te voeren)

## Sprint 37 — Leerling-inzage in resultaten (~7 dagen)

Vier substappen, in deze volgorde. Fundament en beveiliging eerst.

### 37d — Nakijk-modus + toegangscontrole → `v2026.2.37.0` (~2 dagen)

**Waarom eerst:** dit is het beveiligingskritische fundament. Bouw je het scherm eerst, dan hang je later de toegangsregels erop — dat is de verkeerde volgorde.

**Database (`web/db/database.js`)**
- Nieuwe kolom `quiz_meta.review_mode BOOLEAN NOT NULL DEFAULT false` + migratie (`DO $$ ... ALTER TABLE ... EXCEPTION WHEN duplicate_column`).
- Nieuwe functie `setReviewMode(sessionCode, enabled)`.
- Nieuwe functie `findStudentInSession(sessionCode, naam, klas)` → geeft `student_id` terug, of `null`. Hergebruikt de matchlogica van `student_join`.

**Server (`web/server.js`)**
- `POST /api/quiz/:code/review-mode` (requireTeacherAuth + requireCsrf) — zet nakijk-modus aan/uit.
- `POST /api/quiz/:code/review-login` (publiek, **rate-limited** via bestaande `checkJoinRateLimit`) — leerling geeft naam + klas; server geeft een kortlevend nakijk-token terug. **Geen localStorage nodig → werkt op elk toestel.**
- Toegangsregels als middleware: `review_mode = false` → **403**, ook met geldig id. Token bindt aan één `student_id`.

**Frontend leerkracht (`web/public/quiz-review.js`)**
- Knop/checkbox "Nakijk-modus openstellen" naast de bestaande "Vrijgeven"-knop.

**Frontend leerling (`web/public/quiz-student.html` + `quiz-student.js`)**
- Klein herlogin-formulier (naam + klas) wanneer de sessiecode in nakijk-modus staat.

**Tests (`web/tests/review.test.js`, nieuw)** — ~6 tests
- nakijk aan → toegang; nakijk uit → 403; andermans naam+klas → enkel eigen data; juiste antwoorden lekken niet vóór openstelling; rate-limit treedt in werking.

**Impact & risico:** 🔴 Hoog — dit raakt authenticatie. Fout hier = leerlingen zien elkaars werk. Zwaarste testinspanning van sprint 37.

---

### 37a — Leerling-nakijkscherm → `v2026.2.37.1` (~2 dagen)

**Server (`web/server.js`)**
- `GET /api/quiz/:code/my-result/:studentId` — achter de 37d-toegangscontrole. Geeft per vraag: vraagtekst, eigen antwoord, score, max. Plus totaalscore.
- Stuurt **nooit** data van andere leerlingen mee.

**Database (`web/db/database.js`)**
- `getMyResult(sessionCode, studentId)` — join van `quiz_question_snapshots` + `quiz_answers`, gefilterd op één `student_id`.

**Frontend (`web/public/quiz-student.html` + `quiz-student.js`)**
- Nieuw scherm `#review-screen`: totaalscore bovenaan, kaartje per vraag.
- Hergebruik `renderProgressChart()` uit sprint 33b (SVG-staafgrafiek, geen dependency).
- De nu **lege** handler `socket.on('quiz_results_released')` wordt gevuld.

**Styling (`web/public/styles.css`)** — nakijk-kaartjes.

**Tests** — ~3 tests (resultaat-opbouw, totaalberekening, lege score → geen crash).

**Impact:** 🟡 Middel — nieuw scherm, geen bestaande flow gewijzigd.

---

### 37b — Juiste antwoorden + modelcode → `v2026.2.37.2` (~2 dagen)

**Database (`web/db/database.js`)**
- Nieuwe kolom `quiz_question_snapshots.model_answer TEXT NOT NULL DEFAULT ''` + migratie.
- Nieuwe kolom `quiz_bank.model_answer TEXT NOT NULL DEFAULT ''` + migratie — zodat de modelcode aan de **bronvraag** hangt en automatisch mee overgenomen wordt.
- `createQuizQuestion` / `updateQuizQuestion` nemen `modelAnswer` aan.

**Server (`web/server.js`)**
- `PUT /api/quiz/:code/question/:questionId/model` — leerkracht slaat modelcode op.
- `POST/PUT /api/quiz/bank` nemen `modelAnswer` mee.
- 🔴 **Duplicate-fix:** in `/api/quiz/:code/duplicate` de `questions.map(...)` uitbreiden met `modelAnswer: q.model_answer || ''`. Zelfde valkuil als de 33e-bug waar `question_type`/`choices` vergeten werden.
- `/my-result` stuurt `choices_json` (met `correct`-vlag) + `model_answer` **alleen** in nakijk-modus.

**Frontend leerkracht (`web/public/quiz-review.js`, `quiz-bank.html`, `quiz-bank.js`)**
- Veld "Modelantwoord / modelcode" per vraag.

**Frontend leerling (`web/public/quiz-student.js`)**
- Meerkeuze: alle opties tonen, juiste groen ✓, eigen foute keuze rood ✗.
- Code/open: eigen antwoord + modelcode-blok (Markdown via marked + DOMPurify).

**Tests** — ~4 tests (correct-answer-marking; modelcode overleeft toets-duplicatie; modelcode lekt niet vóór nakijk-modus).

**Impact:** 🟠 Middel-hoog — raakt de duplicate-logica (die al eerder stuk was) en de antwoord-lekpreventie.

---

### 37c — Commentaar zichtbaar voor leerling → `v2026.2.37.3` (~1 dag)

**Server (`web/server.js`)** — `/my-result` neemt `teacher_comment` per antwoord + `general_comment` mee.

**Frontend (`web/public/quiz-student.js`)**
- Commentaar-blok onder elk antwoord (Markdown). Leeg commentaar → **geen** blok.
- Algemeen commentaar boven-/onderaan.

**Styling (`web/public/styles.css`)** — commentaar-blok.

**Tests** — ~2 tests (leeg vs. gevuld commentaar).

**Impact:** 🟢 Laag — data bestaat al (`teacher_comment`, `quiz_general_comments`), enkel weergave.

---

## Sprint 38 — Vraag dupliceren → `v2026.2.38.0` (~0.5 dag)

**Database (`web/db/database.js`)** — `getQuizQuestionById(id)` indien nog niet aanwezig.

**Server (`web/server.js`)**
- `POST /api/quiz/bank/:id/duplicate` (requireTeacherAuth + requireCsrf).
- Kopieert **alle** velden: `text` (+ `" (kopie)"`), `subject`, `difficulty`, `max_points`, `question_type`, `choices_json`, `tags`, **`model_answer`**. Nieuwe `id`, `created_by` = huidige leerkracht, `archived = false`.
- 🔴 **Valkuil:** `choices_json` bevat per optie een eigen `id`. Die moeten **nieuwe** id's krijgen, anders delen twee vragen dezelfde optie-id's.
- De bestaande duplicaat-detectie op vraagtekst (`SELECT 1 FROM quiz_bank WHERE text = $1`) mag niet blokkeren — de `" (kopie)"`-suffix lost dat op; expliciet verifiëren.

**Frontend (`web/public/quiz-bank.html` + `quiz-bank.js`)** — "⧉ Dupliceren"-knop per vraagkaart; na dupliceren lijst herladen.

**Tests (`web/tests/export.test.js` uitbreiden)** — ~5 tests (alle velden gekopieerd; optie-id's zijn nieuw; `archived = false`; tekst gemarkeerd als kopie).

**Impact:** 🟢 Laag — nieuw endpoint, geen bestaande flow gewijzigd. Afhankelijk van 37b (`model_answer`).

---

## Sprint 40 — `class_memberships` → `v2026.2.40.0` (~2-3 dagen)

> **🟢 Vereenvoudigd (08/07/2026):** de database is leeg (enkel testdata die weg mag). We bouwen het juiste eindmodel meteen in het **verse schema**, zonder datamigratie. Dat schrapt het zwaarste deel. De eerste school (Atheneum Hoboken) start met een schone lei.

**Het probleem:** `students.class_id` is een directe verwijzing naar één klas. Een leerling hoort dus voor altijd bij precies één klas. Verplaats je hem naar volgend jaar, dan klopt de historiek van vorig jaar niet meer.

**Database (`web/db/database.js`)**
- Nieuwe tabel, meteen correct in het `CREATE TABLE`-blok:
  ```sql
  CREATE TABLE IF NOT EXISTS class_memberships (
    student_id  TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    class_id    TEXT NOT NULL REFERENCES classes(id)  ON DELETE CASCADE,
    school_year TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',
    PRIMARY KEY (student_id, class_id, school_year)
  );
  ```
- **`students.class_id` verdwijnt** uit het schema (niet langer nodig). Geen schaduwkolom, geen omzetting — vers schema.
- De `UNIQUE INDEX ON students(name, class_id)` wordt vervangen door een gepaste uniciteit op de membership-tabel (bv. voorkomen dat dezelfde leerling twee keer in dezelfde klas+jaar zit — dat borgt de samengestelde PK al).
- Aan te passen functies (de plaatsen die `class_id` gebruiken): `listStudents`, `createStudent`, `updateStudentClass`, `listClasses` (student-telling via join op memberships), `getStudentByName`, `getStudentHistory`, `archiveClass`.

**Server (`web/server.js`)** — alle klas-/leerling-endpoints gebruiken memberships i.p.v. `class_id`.

**Frontend (`web/public/admin.html` + `admin.js`)** — leerlingbeheer werkt per schooljaar.

**Tests (`web/tests/membership.test.js`, nieuw)** — ~8 tests
- leerling in twee jaren, twee klassen; historiek blijft correct; student-telling per jaar klopt; archiveren raakt memberships niet.

**Impact:** 🟡 **Middel.** Raakt veel functies, maar zonder datamigratie en zonder live-data-risico. De database wordt sowieso opnieuw opgezet.

> ⚠️ **Uitgesteld, niet weg:** het migratiepad (bestaande `class_id` → membership zonder verlies) is nog nodig zodra een school echte data heeft. Dat hoort bij **fase 3** (schema-evolutie zonder wissen) en wordt daar uitgewerkt + getest.


---

## Sprint 41 — Schooljaar-selector → `v2026.2.41.0` (~3 dagen)

Vereist sprint 40.

**Server (`web/server.js`)** — klas-/leerling-/toets-endpoints nemen een `schoolYear`-parameter; gearchiveerde jaren zijn **read-only** (schrijfacties → 403).

**Database (`web/db/database.js`)** — `listClasses`/`listStudents` filteren op `school_year`.

**Frontend** — `web/public/admin.html`, `quiz-bank.html`, `quiz-archive.html` (+ hun `.js`): een schooljaar-dropdown. Standaard huidig jaar; gearchiveerde jaren kiesbaar maar read-only (knoppen uitgeschakeld, duidelijke banner).

> Er bestaat al een "📅 Nieuw schooljaar"-tab in `quiz-archive.html` — daarop voortbouwen.

**Tests** — ~4 tests (filter op jaar; schrijfactie op gearchiveerd jaar → 403).

**Impact:** 🟡 Middel — vooral UI, maar de read-only-afdwinging moet **server-side** (niet enkel een uitgeschakelde knop).

---

## Sprint 42 — Instapstructuur → `v2026.2.42.0` (~2 dagen)

Onafhankelijk — kan ook eerder.

**Nieuw/gewijzigd**
- `pycodeflow.org`: keuzepagina leerkracht / leerling (buiten deze repo, of `web/public/index.html`).
- `app.pycodeflow.org/student` → leerling-ingang: login **of** vrije sessie.
- `app.pycodeflow.org/teacher` → leerkracht-login.

**Server (`web/server.js`)** — routes `/student` en `/teacher`; redirects.

**Frontend** — `web/public/index.html`, `student-start.html`, `teacher-login.html`.

**Belangrijk:** de **vrije oefensessie zonder account** moet blijven werken. Dat is een sterkte, niet iets om weg te ontwerpen.

**Tests** — ~2 tests (routes leiden naar de juiste pagina).

**Impact:** 🟢 Laag-middel — routing en pagina's, geen datamodel.

---

## Sprint 43 — School-keuze bij login → `v2026.2.43.0` (~3 dagen) — ⛔ GEBLOKKEERD

**Kan pas na:**
- **Fase 1** (echte per-gebruiker sessie — het cookie identificeert nu géén individuele leerkracht)
- **Fase 3** (`schools`-tabel + `teacher_schools`)

Beide zijn nog geen sprints; ze staan in de multi-tenant roadmap (~4 weken fundament). Zonder die twee is een school-keuze zinloos: de server weet vandaag niet eens *wie* er ingelogd is.

**Wanneer wel:** modal met school-keuze na login (indien >1 school), `active_school_id` in de **server-side sessie**.

🔴 **Beveiligingsregel:** de actieve school mag **nooit** uit een URL-parameter of request-body komen — enkel uit de sessie, na controle dat de leerkracht aan die school gekoppeld is.

---

# DEEL 2 — Uitgestelde sprints (door jou geparkeerd)

Deze staan bewust achteraan. Ze zijn niet vergeten, enkel niet nu ingepland.

## Sprint 30b-vol — CSP `unsafe-inline` volledig weg (~8-10 dagen) ⏸

Optie A is uitgevoerd (v2026.2.34.8): geen inline `<script>` meer, en een **Report-Only** CSP die in de browserconsole toont wat er nog geblokkeerd zou worden. Dat is meteen je werklijst.

- **Fase 1 (~5d):** 123 inline event-handlers → `addEventListener`, per pagina van klein naar groot (free-editor 2 → quiz-bank 46). Dynamische handlers via `data-action` + event-delegation.
- **Fase 2 (~3d):** 384 inline `style=` → CSS-klassen. Echt dynamische styles (progressbar-breedte) via JS `element.style`.
- **Fase 3 (~1d):** CSP verstrengen, **Report-Only header verwijderen** (was enkel meetinstrument), `⚠️ TIJDELIJK`-comment weg, tests aanpassen.

**Bestanden:** `server.js` · alle 12 `*.html` + hun `.js` · `styles.css` · `tests/security.test.js` · `check-deployment.sh`

**Impact:** 🟠 Middel-hoog — ~500 wijzigingen, maar mechanisch en per pagina testbaar.

---

## Prioriteit 6 — Toegankelijkheid (a11y) (~5 dagen) ⏸

⚠️ **Wordt een wettelijke vereiste** zodra je aan overheidsscholen verkoopt (EN 301 549 / WCAG 2.1 AA). Nu geparkeerd, maar niet vrijblijvend op termijn.

Er zijn vandaag **6 aria/role-attributen in de hele app**.

| Sprint | Wat | Bestanden |
|---|---|---|
| **35d** (~0.5d) | Modals: `role="dialog"`, `aria-modal`, focus-trap, focus-return, Escape | `app.js`, `styles.css` |
| **35b** (~1d) | Status niet enkel via kleur (grotendeels al OK — iconen ✓/✋/● bestaan) + `aria-label` | `app.js`, `styles.css` |
| **35a** (~2d) | `aria-label` op icon-knoppen (veel `title` bestaat al → kopiëren), landmarks, `aria-live` | alle `*.html` |
| **35c** (~1.5d) | Skip-links, `:focus-visible`, focus-volgorde, toetsenbordnavigatie | alle `*.html`, `styles.css` |

**Impact:** 🟡 Middel — veel kleine wijzigingen, laag technisch risico. Echte verificatie vraagt een screenreader (NVDA/VoiceOver) — dat kan ik niet in deze omgeving testen.

---

## Sprint 14 — Google OAuth leerlingen (~3 dagen) ⏸
## Sprint 15 — Smartschool SSO (~1 week) ⏸

**Nog te beslissen:** Smartschool SSO, Google OAuth, of eigen login (e-mail/gebruikersnaam).

**Raakt sprint 37:** zolang er geen echte leerling-login is, steunt de nakijk-toegang op naam + klas + sessiecode. Wie die drie kent, kan andermans nakijk-scherm openen. Dat is geen nieuwe zwakte (zo werkt deelnemen nu al), maar wel een bewust aanvaarde beperking — afgeschermd door rate-limiting en doordat de leerkracht de nakijk-modus expliciet moet openstellen.

**Bestanden (verwacht):** `server.js`, `lib/auth.js`, `db/database.js` (`students.google_sub` bestaat al), `student-start.html`

---

# Samenvatting

| # | Sprint | Versie | Duur | Risico | Afhankelijk van |
|---|---|---|---|---|---|
| 1 | 37d nakijk-modus | 37.0 | 2d | 🔴 | — |
| 2 | 37a nakijkscherm | 37.1 | 2d | 🟡 | 37d |
| 3 | 37b antwoorden + modelcode | 37.2 | 2d | 🟠 | 37a |
| 4 | 37c commentaar | 37.3 | 1d | 🟢 | 37a |
| 5 | 38 vraag dupliceren | 38.0 | 0.5d | 🟢 | 37b |
| 6 | 40 class_memberships (vers schema) | 40.0 | 2-3d | 🟡 | — |
| 7 | 41 schooljaar-selector | 41.0 | 3d | 🟡 | 40 |
| 8 | 42 instapstructuur | 42.0 | 2d | 🟢 | — |
| 9 | 43 school-keuze | 43.0 | 3d | 🟠 | ⛔ fase 1 + 3 |
| — | *30b-vol* | — | 8-10d | 🟠 | ⏸ geparkeerd |
| — | *Prio 6 a11y* | — | 5d | 🟡 | ⏸ geparkeerd |
| — | *14 / 15 login* | — | 3d–1w | 🟠 | ⏸ keuze open |

**Totaal actief:** ~4 weken (sprints 37 t/m 42).

## Vaste werkwijze per sprint

1. Onderzoek de code vóór wijziging (nooit aannemen).
2. Wijzig, dan onmiddellijk `node --check` op elk gewijzigd bestand.
3. Tests toevoegen/uitbreiden — nooit een sprint zonder tests.
4. `bash run-tests.sh` volledig groen.
5. `bash sync-version.sh <versie>` — VERSION is de single source of truth.
6. Bijwerken: `changelog.md`, `sprintlog.md`, `test-readme.md`, `check-deployment.sh`.
7. ZIP met **alle** gewijzigde én nieuwe bestanden.

**Sprint 40:** geen backup/migratie nodig — de database wordt vers opgezet (leeg-database-venster). Het migratiepad voor scholen mét data komt bij fase 3.

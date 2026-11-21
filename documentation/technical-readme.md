# PyCodeFlow — Technische documentatie

> Interne werking, architectuur, API-referentie en ontwikkelaarsinformatie.
> Versie: v2026.2.51.152 (bijgewerkt voor v124–v152; zie ook `changelog.md`)

---

## Versiebeleid

Formaat: `JAAR.MAJOR.MINOR.BUILD` (bv. `2026.2.34.3`).

**Regel:** het **MINOR-nummer volgt het sprintnummer** dat wordt uitgevoerd. De **BUILD**
(laatste cijfer) telt op voor opeenvolgende releases binnen dezelfde uitvoeringsfase.

- Zolang we werk uitvoeren binnen de "huidige" sprintreeks, blijft het minor-nummer gelijk
  en telt enkel de build op: `34.0 → 34.1 → 34.2 → 34.3`.
- Pas wanneer een sprint met een hoger nummer effectief wordt uitgevoerd, springt het
  minor-nummer mee: sprint 35 wordt `35.0`, sprint 36 wordt `36.0`.
- Zo blijft de nummering monotoon oplopend én uiteindelijk gekoppeld aan het sprintnummer,
  zonder gaten of downgrades.

**Voorbeeld uit de praktijk:** sprint 34 (testbasis) werd eerst uitgevoerd → `2026.2.34.0`.
Daarna volgde werk voor sprint 30 (config-fix) + de kopieerknop; dat werd *niet* `30.x`
(zou een downgrade zijn) en *ook niet* meteen `35.0`, maar `2026.2.34.3` — de volgende build
in de lopende 34-reeks. Wanneer sprint 35/36 echt aan de beurt zijn, gaat het minor-nummer
mee omhoog.

De versie staat in het `VERSION`-bestand (single source of truth). `scripts/general/sync-version.sh`
propageert die naar `.env` en alle HTML cache-bust strings. De server leest `VERSION` bij
opstart.

---

## Architectuur

```
Browser (leerling / leerkracht)
        │ HTTPS via Cloudflare Tunnel · Socket.IO (WebSocket)
        ▼
┌─────────────────────────────────────────────────────┐
│  web container  (Node.js :3000)                     │
│  server.js · Express · Socket.IO                    │
│  database.js (pg Pool → PostgreSQL)                 │
└────────────┬────────────────────────────────────────┘
             │ HTTP intern (Docker netwerk)
             ▼
┌─────────────────────────────────────────────────────┐
│  runner container (Python :5000)                    │
│  app.py · Flask · Gunicorn                          │
│  subprocess sandbox + rlimits                       │
└─────────────────────────────────────────────────────┘
             │
┌─────────────────────────────────────────────────────┐
│  postgres container (:5432)                         │
│  postgres:16-alpine                                 │
│  persistent volume: pgdata/                         │
└─────────────────────────────────────────────────────┘
```

## Technologiestack

| Laag | Technologie | Versie |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS + Monaco Editor | — |
| Backend | Node.js + Express + Socket.IO | Node 20 |
| Runner | Python + Flask + Gunicorn | Python 3.12 |
| Database | PostgreSQL via `pg` Pool | PG 16 |
| PDF export | pdfkit | ^0.15 |
| Markdown | marked.js | 9.1.6 (CDN — preview in vragenbank) |
| Schermbeeld (live-overzicht) | html2canvas | 1.4.1 (lokaal via `/vendor/html2canvas`, v145) |
| Tunnel | Cloudflare Tunnel (cloudflared) | latest |
| Deployment | Docker Compose | — |

---

## Bestandsstructuur

```
pycodeflow/
├── pycodeflow.sh              ← Beheertool (18 menu-opties)
├── .env                       ← Geheimen (NOOIT in git)
├── .env.example               ← Template
├── .gitignore
├── docker-compose.yml
├── check-deployment.sh        ← Verificatiescript
├── health-monitor.sh          ← Crash notificatie (cron)
│
├── pgdata/                    ← PostgreSQL databestanden
├── logs/                      ← Logbestanden (max LOG_RETENTION_DAYS)
├── backups/                   ← DB backups (max 7 dagen)
│
├── web/
│   ├── server.js              ← Express + Socket.IO server (MAIN)
│   ├── package.json           ← npm: pg, pdfkit, express, socket.io, dotenv
│   ├── db/database.js         ← PostgreSQL module (alle DB-methodes)
│   ├── scripts/
│   │   ├── manage-teacher.js  ← CLI leerkrachten beheren
│   │   ├── backup-db.sh       ← DB backup script
│   │   └── migrate-sqlite-to-pg.js
│   └── public/
│       ├── app.js             ← Frontend logica
│       ├── styles.css
│       ├── monaco-env.js      ← Monaco ESM worker config
│       ├── templates.json     ← Python oefentemplates
│       ├── index.html, teacher-login.html, teacher-sessions.html
│       ├── teacher-app.html, student-start.html, student-app.html
│       ├── free-editor.html, monitoring.html, admin.html
│       ├── quiz-bank.html, quiz-teacher.html, quiz-student.html
│       ├── quiz-review.html, quiz-archive.html, teacher-grid.html
│       └── assets/            ← Optioneel schoollogo
├── runner/
│   ├── app.py                 ← Flask + subprocess sandbox
│   └── requirements.txt
```

---

## Database schema (alle tabellen)

### Kern

| Tabel | Inhoud |
|---|---|
| `teachers` | Leerkrachten + gehashte wachtwoorden |
| `sessions` | Klassessies (+ `config_json` voor persistente editor-config) |
| `session_annotations` | Annotaties per sessie |
| `code_snapshots` | Code-history per leerling per sessie |
| `classes` | Klassen |
| `teacher_classes` | Koppeling leerkracht ↔ klas |
| `students` | Leerlingen (status: active/pending/blocked) |

### Quiz

| Tabel | Inhoud |
|---|---|
| `quiz_bank` | Vragenbank (type: code/open/single/multiple + choices_json) |
| `quiz_question_snapshots` | Snapshot van vragen op moment van toets |
| `quiz_meta` | Toets-instellingen (timer, tijdsvenster, volgorde, ...) |
| `quiz_answers` | Antwoorden per leerling per vraag (+ auto_scored) |
| `quiz_general_comments` | Algemeen commentaar per leerling |
| `quiz_student_order` | Gepersonaliseerde vraagvolgorde |
| `quiz_run_history` | Run-history per antwoord |
| `quiz_comment_templates` | Herbruikbare commentaar-templates |

### Systeem

| Tabel | Inhoud |
|---|---|
| `stress_results` | Stresstest historiek (stressload%, timing, RAM/CPU) |
| `audit_log` | Audit-log leerkrachtenacties (score gewijzigd, toets verwijderd, ...) |

---

## REST API (selectie)

### Authenticatie

| | Endpoint | Beschrijving |
|---|---|---|
| POST | `/api/teacher-login` | Login met username/password |
| GET | `/api/teacher-logout` | Uitloggen |
| GET | `/api/version` | Versie + uptime |
| GET | `/api/admin/school-years` | 41: beschikbare schooljaren + archief-status |
| POST | `/api/quiz/:code/review-mode` | 37d: nakijk-modus aan/uit (leerkracht + CSRF) |
| POST | `/api/quiz/:code/review-login` | 37d: leerling logt in met naam + klas → nakijk-token (publiek, rate-limited) |
| GET | `/api/quiz/:code/my-result` | 37a/b: eigen resultaten + juiste antwoorden + modelcode (nakijk-token vereist) |
| PUT | `/api/quiz/:code/question/:questionId/model` | 37b: modelantwoord per vraag opslaan (leerkracht + CSRF) |
| POST | `/api/quiz/bank/:id/duplicate` | 38: bankvraag dupliceren (leerkracht + CSRF) |
| GET | `/health` | Container health check |
| GET | `/api/school-info` | Schoolnaam + logo URL |

### Admin

| | Endpoint | Beschrijving |
|---|---|---|
| GET/POST | `/api/admin/teachers` | Leerkrachten beheren |
| GET/POST | `/api/admin/classes` | Klassen beheren |
| GET/POST | `/api/admin/students` | Leerlingen beheren |
| POST | `/api/admin/students/import-csv` | CSV import |
| GET | `/api/admin/logs/info` | Log status |
| POST | `/api/admin/logs/cleanup` | Logs opruimen |
| GET | `/api/admin/audit-log` | Audit-log (leerkrachtenacties) |
| GET | `/api/stress-results` | Stresstest historiek |

### Sessies

| | Endpoint | Beschrijving |
|---|---|---|
| GET | `/api/sessions` | Actieve sessies |
| GET | `/api/sessions/:code/export` | Export als ZIP |
| GET | `/api/sessions/:code/history/:id` | Code-history leerling |

### Quiz

| | Endpoint | Beschrijving |
|---|---|---|
| GET/POST | `/api/quiz/bank` | Vragenbank CRUD |
| POST | `/api/quiz/bank/import-csv` | CSV import vragen |
| POST | `/api/quiz` | Toets aanmaken |
| POST | `/api/quiz/:code/duplicate` | Toets dupliceren |
| GET | `/api/quiz/:code/answers` | Alle antwoorden |
| PUT | `/api/quiz/:code/answers/:id/score` | Score opslaan |
| POST | `/api/quiz/:code/release` | Resultaten vrijgeven |
| GET | `/api/quiz/:code/similarity` | Gelijkenis-rapport |
| GET | `/api/quiz/:code/pdf/questions` | PDF vragenblad |
| GET | `/api/quiz/:code/pdf/answers` | PDF antwoorden |
| GET | `/api/quiz/:code/pdf/overview` | PDF klasoverzicht |
| GET | `/api/quiz/archive` | Toets-archief |
| PUT | `/api/quiz/bank/:id/unarchive` | Vraag herstellen uit archief |
| GET | `/api/admin/db/tables` | Database viewer: tabeloverzicht |
| GET | `/api/admin/db/tables/:name/rows` | Database viewer: tabelinhoud (gepagineerd) |

---

## Socket.IO events (selectie)

### Leerling → Server

| Event | Beschrijving |
|---|---|
| `student_join` | Klassessie joinen |
| `run_request` | Code uitvoeren |
| `runtime_input` | Input invullen |
| `student_raise_hand` | Hand opsteken |
| `student_mark_done` | Klaar melden |
| `quiz_start` | Toets starten (timer begint) |
| `quiz_save_answer` | Antwoord opslaan |
| `quiz_submit_all` | Toets indienen |

### Server → Leerling

| Event | Beschrijving |
|---|---|
| `student_state` | Volledige sessie-staat |
| `run_output` | Code output |
| `run_error` | Runtime fout |
| `input_request` | Input gevraagd |
| `quiz_state` | Quiz staat + vragen |
| `quiz_timer_update` | Timer tick |
| `quiz_warning` | 10% tijd resterend |
| `quiz_force_submit` | Auto-submit (timer/deadline) |
| `quiz_reminder` | Herinnering van leerkracht |
| `quiz_access_expired` | Tijdsvenster verlopen |

---

## Python runner sandbox

### Geblokkeerde modules

```python
BLOCKED_MODULES = {
    'os', 'subprocess', 'socket', 'shutil', 'importlib',
    'ctypes', 'multiprocessing', 'signal', 'pty', ...
}
```

### Limieten

| Limiet | Waarde |
|---|---|
| RAM runner | 256 MB (Docker) |
| CPU runner | 1 core |
| Timeout | 30 seconden |
| Max output | 256 KB |
| Max code | 32 KB |
| Open bestanden | 64 (rlimit) |

---

## Omgevingsvariabelen (.env)

| Variabele | Verplicht | Beschrijving |
|---|---|---|
| `POSTGRES_PASSWORD` | ✅ | PostgreSQL wachtwoord (DATABASE_URL wordt auto-opgebouwd) |
| `CLOUDFLARE_TUNNEL_TOKEN` | ✅ | Cloudflare tunnel token |
| `POC_BASIC_COOKIE_SECRET` | ✅ | Cookie signing secret |
| `RUNNER_URL` | ✅ | Intern adres runner (`http://runner:5000`) |
| `SCHOOL_NAME` | — | Schoolnaam in PDF export |
| `SCHOOL_LOGO_PATH` | — | Pad naar schoollogo |
| `LOG_RETENTION_DAYS` | — | Logbestanden bewaren (standaard 7) |
| `STRESS_TEST_ENABLED` | — | Stresstest inschakelen (standaard false) |
| `WEBHOOK_URL` | — | URL voor crash notificaties |

---

## Beveiliging

| Maatregel | Status |
|---|---|
| HTTPS via Cloudflare | ✅ |
| CSP headers (geen unsafe-eval) | ✅ |
| Monaco workers via blob: | ✅ |
| Cookie HttpOnly + Secure + SameSite=Strict | ✅ |
| Wachtwoorden via scrypt + timingSafeEqual | ✅ |
| CSRF token + per-socket nonce | ✅ |
| SQL: geparameteriseerde queries | ✅ |
| Rate limiting login (6/30min) | ✅ |
| Rate limiting join (10/min) | ✅ |
| Runner op 127.0.0.1 (niet extern) | ✅ |
| Runner sandbox: rlimits + geblokkeerde modules | ✅ |
| Docker memory limiet runner (256MB) | ✅ |

**Beveiligingsscore: ~99/100** *(CSRF op alle muterende endpoints — sprint 23o)*

---

## pycodeflow.sh menu-opties

| Optie | Actie |
|---|---|
| 1 | Versie instellen |
| 2 | Start |
| 3 | Stop |
| 4 | Herstart |
| 5 | Rebuild & herstart |
| 6 | Logs bekijken (web/runner/postgres/fouten/DB-check) |
| 7 | Verificatie (check-deployment.sh) |
| 8 | SQLite → PostgreSQL migratie |
| 9 | npm packages controleren |
| 10 | Leerkrachtsaccount aanmaken |
| 11 | Container resources (docker stats) |
| 12 | Logs opruimen |
| 13 | Eerste-start opnieuw uitvoeren |
| 14 | Volledige reset (ALLES verwijderen, .env blijft) |
| 15 | Health monitor instellen (crash notificatie) |
| 16 | Database backup beheren |
| 17 | Wachtwoord leerkracht resetten |
| 18 | Mappenstructuur opschonen (verouderde bestanden verwijderen) |

---

*PyCodeFlow · Atheneum Hoboken · technical-readme.md · v2026.2.42.0*

---

## Nakijk-modus (sprint 37d)

Leerlingen kunnen na een toets hun eigen werk inkijken, zodra de leerkracht dit
expliciet openstelt (`quiz_meta.review_mode`).

**Identificatie zonder localStorage.** `quiz_answers.student_id` is géén `students.id`,
maar een sessie-gebonden UUID die bij het joinen wordt aangemaakt. De opzoeking gebeurt
daarom op `quiz_answers.student_name` + `student_class` (tekst-momentopname). Voordeel:
dit werkt ook nadat de live sessie uit het geheugen verdwenen is — dus dagen later,
op elk toestel.

> ⚠️ Een sessie **verwijderen** cascadeert naar `quiz_meta` en `quiz_answers`: de
> nakijk-data is dan weg. **Archiveren** behoudt ze.

**Token.** `lib/review-token.js` maakt een stateless, HMAC-SHA256-ondertekend token:
`base64url({ c: code, s: studentId, e: exp }).base64url(hmac)`, standaard 2 uur geldig,
ondertekend met `COOKIE_SECRET`. Handtekening wordt in constante tijd vergeleken.

**Toegangsregels.** De middleware `requireReviewToken` haalt het `studentId`
**uitsluitend uit het token** — nooit uit de URL. Ze weigert wanneer nakijken dichtstaat,
de handtekening niet klopt, het token verlopen is, of het token bij een andere toets hoort.

De `review-login`-endpoint geeft bewust identieke antwoorden voor "toets bestaat niet" en
"nakijken staat dicht" (403), zodat het geen toetscodes prijsgeeft, en een generieke 404
bij een onbekende naam zodat het geen namen prijsgeeft.

### Lekpreventie bij `/my-result` (sprint 37a)

`lib/review-result.js` bouwt de payload voor de leerling. Dat is de **enige** plek waar
de `correct`-vlag uit `choices_json` wordt gestript:

```js
buildMyResult(rows, { onthulJuisteAntwoorden: false })  // 37a: leerling ziet enkel eigen keuze
buildMyResult(rows, { onthulJuisteAntwoorden: true })   // 37b: juiste antwoorden onthuld
```

Tests borgen dat de JSON-payload in 37a nergens het woord `"correct"` bevat. Wie hier iets
wijzigt, moet die tests groen houden — anders lekken de juiste antwoorden tijdens de toets.

`getMyResult()` gebruikt een **LEFT JOIN** van `quiz_question_snapshots` naar `quiz_answers`,
zodat overgeslagen vragen zichtbaar blijven (score `null`) in plaats van te ontbreken.

---

## Toetsmodule — wijzigingen v124–v142

### Pure modules (`web/lib/`)

| Module | Doel |
|---|---|
| `scoring.js` | Single = alles of niets. Meerkeuze **klassiek** (pro-rata) of **gedeeld**: `score = punten × max(0, 1 − (1,5×gemist + 3×fout)/n)`, afgerond op halve punten; alle opties aanduiden = 0. `normaliseerScore` laat enkel veelvouden van 0,5 toe. |
| `vragenpool.js` | `pool_json` = `{ "<groepNr>": N | {n, mix:{makkelijk,gemiddeld,moeilijk}} }`. `trekVragen` (crypto-uniform, per niveau bij een mix), `controleerGelijkePunten`, `telUniekeToetsen` (BigInt, elementaire symmetrische polynomen), `puntenBereik`. |
| `placeholders.js` | `variables_json` (array van variabelen + optioneel laatste element `{voorwaarde}`). `berekenWaarden(variabelen, seed, voorwaarde)` = deterministisch (rejection sampling, seed `toetscode+leerling+vraag`); rekenen zonder `eval`. `controleerCombinaties` blokkeert delen door nul, geen geldige combinatie en dubbele opties. |
| `gelijkenis.js` | `eenhedenUit`, `bouwRapport`: tekst- en structuurgelijkenis (Levenshtein op tokens), gedeelde foute keuzes (met zeldzaamheidsgrens), placeholders, timing, incidentcontext. |
| `moeilijkheid.js` | Richtwaarden: makkelijk 70–100, gemiddeld 45–85, moeilijk 20–65; min. 5 leerlingen; setafwijking 5 procentpunt. |
| `klasbord.js` | `bouwBordLeerlingen(leerlingen, totaal, tijd)`, `eindTijdVan`; geen vraagnummer meer. |
| `link.js` | v147: `normaliseerLink(titel,url)` (enkel http/https, schema aanvullen, max 2000/80 tekens, titel standaard = domein), `normaliseerLinks(lijst)` voor `drafts.links`. |
| `sessie-status.js` | v146: `sessieStatus` (lopend/gepland/deadline voorbij/gestopt/gearchiveerd/geblokkeerd; klas: actief/rustig) voor de monitoringpagina. |
| `live-beeld.js` | v145: `normaliseerInterval` (30 / 0 = uit / 5–300), `isGeldigBeeld` (JPEG-data-URL ≤ 150 000 tekens), `antwoordSnippet`, `bouwLiveKaarten`. |
| `fraude.js` | v144: `groepeerFraude` (incidenten → groepen per soort en vraag met risico), `samenvatting`, `risicoVan`, `plakTellingen`; negeert info-/leerkrachtacties. |
| `herstel.js` | v146: `berekenTimer({start,timerSeconds,noTimer,deadline,extraSeconds})` → `{modus: geen\|deadline\|duur\|beide, heeftTeller, eindAt, totaalSec}`, eindAt = min(start+duur, deadline) + extra (alleen deadline: deadline + extra). `berekenHerstel` (gebruikt `berekenTimer`; `extraModus` `eind`\|`vanafNu`) (eigen eindtijd = start + duur [+ extra], nooit herberekend; toegangsvenster minstens 1 min), `bepaalHervatIndex` (eerste niet-bevestigde vraag bij *1 kans per vraag*, anders eerste onbeantwoorde). |
| `public/regelvergelijking.js` | Client én tests: `vergelijkRegels(a, b)` → regels met status `gelijk` / `verschillend` / `triviaal`. |

### Database (alle migraties idempotent)

| Kolom | Tabel | Sinds |
|---|---|---|
| `pool_json` | `assignment_bank` | v134 |
| `mc_scoring` (`gedeeld`/`klassiek`) | `assignment_bank` | v133 |
| `cursus_links` (JSON) | `assignment_bank` | v132 |
| `copy_paste_blocked`, `fullscreen_required` | `assignment_bank` | v113 |
| `variables_json` | `question_bank`, `quiz_question_snapshots` | v135 |
| `difficulty` | `quiz_question_snapshots` | v137 |
| `max_points`, `points`, `score` → `NUMERIC(6,1)` | bank, snapshots, answers | v133 |
| `quiz_incidents` (sessie, leerling, type, detail [max. 1500 tekens], tijd) | — | v122 |
| `confirmed_at` | `quiz_answers` | v143 |
| `live_screenshot_sec` (INTEGER, standaard 30) | `assignment_bank` | v145 |
| `extra_seconds` | `quiz_individual_access` | v143 |

### Endpoints (nieuw)

| Route | Doel |
|---|---|
| `POST /api/quiz/pool-telling` | Aantal unieke toetsen (per groep en totaal) vóór het bevestigen |
| `GET /api/quiz/:code/gelijkenisrapport[?drempel=80&format=csv]` | Rapport per leerlingenpaar |
| `GET /api/quiz/:code/similarity` | Waarschuwingen per vraag (zelfde berekening, oude vorm) |
| `GET /api/quiz/:code/moeilijkheidsrapport` | Moeilijkheid per vraag en per leerlingenset |
| `POST /api/quiz/bank/import-json` | JSON-import van vragen (max. 1 MB) |
| `POST /api/quiz/:code/release`, `/review-mode` | Scores vrijgeven / nazicht openen (ook via het overzicht) |
| `GET /api/quiz-sessions/:code/incidenten` | Incidentenlogboek |
| `GET /api/quiz-sessions/:code/fraude` | v144: spiek-/fraudepogingen per leerling, gegroepeerd (blok onderaan het nakijken) |
| `GET/POST /api/quiz-sessions/:code/roster/:studentId/herstel-info` · `…/herstel` | Toegang herstellen (v143): individuele toegang + extra seconden, ingediend-vlag weg, leerling terug in het geheugen, logboek. Werkt in elke toestand. |
| `GET /api/quiz/:code/deadline-info` · `PUT /api/quiz/:code/deadline` | Deadline aanpassen tijdens een lopende toets (v143); zet `_deadlineHandled` terug zodat het automatisch indienen de nieuwe waarde gebruikt |

### Socket.IO (nieuw)

- `review_run_request` / `review_runtime_input`: ▶ Uitvoeren in het nakijkscherm, **enkel leerkracht**; hergebruikt `runnerStart`, `runnerInput`, `RUN_RATE_LIMIT_MS` en `checkIpRateLimit`.
- `student_join_free { name, className, leerkracht }`: leerkracht oefent vrij; `alsLeerkracht = leerkracht === true && socketIsTeacherAuthorized(socket) && !ingelogd`.
- `quiz_save_answer` kent sinds v143 `bevestigd: true` (bewust bevestigd bij 1 kans per vraag); `quiz_state` stuurt `bevestigdeVragen`, `currentQuestion` (hervat-index na heropenen) en `timerSeconds` incl. extra minuten.
- `quiz_incident` (v144): `detail` is een JSON-string, bv. `{"q":"<vraagId>","len":12,"tekst":"…"}`; `weg_van_toets` heeft `fase` (`weg`/`terug`), `secs`, `oorzaak`, `ev`, `rand`, `toetsen`. Nieuwe types: grote_invoer, weinig_toetsen, sneltoets, venster_kleiner, wijziging_na_terugkeer. Rem per type is optioneel uit (`geenRem`); de server blijft op 30 meldingen/minuut. `public/tabdiagnose.js` (UMD) levert `systeemToetsLabel`, `randVan`, `bouwOordeel`, `maakDiagnose`.
- **Live-overzicht (v145)**: de leerkracht-socket stuurt `teacher_grid_observe` (elke 3 s) en bij sluiten `teacher_grid_stop`; de server houdt `session._gridObs` (socketId → laatst gezien, 12 s time-out, opruiming elke 5 s). Wordt de eerste observer toegevoegd, dan krijgt elke online, niet-ingediende leerling `quiz_screenshot_aan {intervalSec}` (ook bij later verbinden via `quiz_start`); is de laatste weg, dan `quiz_screenshot_uit` en wordt `student._beeld` gewist. De leerling stuurt `quiz_screenshot {img}` (JPEG-data-URL, ≤ 150 000 tekens, ≥ 2 s tussen beelden, genegeerd zonder observer); de server bewaart enkel het nieuwste beeld per leerling (`student._beeld`, geheugen) en stuurt `quiz_screenshot_update {studentId, img, at}` naar de observers. `quiz_live_data {kaarten, intervalSec, nu}` bevat de mini-kaartjes (zie `bouwLiveKaarten`). Leerlingvelden in het geheugen: `_quizTotaal`, `_quizEndAt`, `_laatsteActiviteitAt`, `_antwoordSnippet`.
- **Timer (v146)**: `timerVoorLeerling(meta, student)` in `server.js` is de enige plek die de eindtijd berekent (quiz_start, `herberekenTijden` na een deadline-wijziging, herstel). `quiz_state` stuurt `timerSeconds` (= effectieve duur), `timerModus`, `indienOp`; `quiz_tijd_wijziging` stuurt de nieuwe waarden bij een gewijzigde deadline. De deadline-job dient leerlingen met `quizExtraSeconds` pas in op `deadline + extra`.
- `student_copy_to_class`, `teacher_reset_copy` (v128); `teacher_set_cursus`, `cursus_update` (v126); `teacher_save_drafts`, `teacher_rebind`, `teacher_ping`, `teacher_cleanup_offline` (v124/v125); `quiz_incident` (type ∈ `INCIDENT_TYPES`, max. 30 per minuut per socket).

### Versie

`VERSION` en `web/VERSION` zijn de bron; elke `?v=` in `public/*.html|js` moet gelijk zijn (afgedwongen door een automatische test). Verhoog altijd alles samen.

### Test-tips

`DATABASE_URL=postgres://user:pw@127.0.0.1:5432/pycodeflow_test node --test tests/*.test.js`. Ligt de databank stil dan slaan 14 tests over (en logt de server "database niet bereikbaar"): eerst `service postgresql start`. Livetests (`tests/live/*.js`) vragen een draaiende server en runner; POST's hebben `origin: BASE` nodig (CSRF).

- **Link naar leerlingen (v147)**: `session.link = {id,titel,url,domein,at}` (enkel in het geheugen, niet bewaard na de les). Sockets: `teacher_send_link` (alleen `mode==='class'` en `classWorkspaceMode==='shared'`), `teacher_clear_link`, broadcast `link_update {link|null}`. `student_state.link` is `null` in de individuele werkfase; wisselen naar individueel wist de link. De voorbereide reeks staat in `session.drafts.links` (`[{titel,url}]`, via `teacher_save_drafts` → `config._drafts`, achterwaarts compatibel). Client: `studentLinkToepassen` (popup + knop; "geklikt" per link-id in `sessionStorage`), teacher-blok `setupLinkBlok` in `app.js`; fullscreen-slot `#tfs-slot-link`.

- **Afgedwongen indienen (v148)**: elk pad (timer, deadline, heropening verlopen, stopknop, tabwissel) gebruikt `rondForceInzendingAf(code, studentId, reden, naam)` = `submitQuizAnswers` + `autoScoreInzending` (leest uit de databank, scoort single/multiple en keuze-onderdelen van composite met `lib/scoring.js`). Bij het afdwingen krijgt de leerling `_forcedAt`/`_forcedReden`; `quiz_save_answer` aanvaardt nog 20 s daarna een opslag (daarna opnieuw indienen + scoren). Client: `onChoiceChange` roept meteen `saveCurrentAnswer()` aan.
- **Startscherm (v148)**: `quiz-student.js › renderStartRegels / updateStartKnop / startTijdTekst` bouwen de regels uit `GET /startinfo`; `startQuiz()` start enkel als `#start-akkoord` aangevinkt is en logt `startbevestiging {vinkje, soort}`. De tijd wordt elke 30 s herberekend.
- **Herstellen vanuit nazicht (v149)**: `quiz-review.js › herstelVanuitNazicht` roept `window.herstelLeerling(code, id, naam, { bron:'nazicht', verbeterd, naAfloop })` (app.js; hetzelfde venster als monitoring: presets 5/10/15/30, live voorbeeld via `herstel-info?extra=&modus=`). Met minuten > 0 wordt `extraModus='vanafNu'` verstuurd; `lib/herstel.js › berekenHerstel` geeft dan zonder timer/deadline exact dat aantal minuten (niet de 15 min terugval). Korter dan de eigen eindtijd kan niet (extra seconden zijn ≥ 0). Heropeningen: `laadHeropeningen()` leest `GET /reopen-open`, polling elke 15 s → `herlaadAntwoorden()`.
- **Heropenen (v150)**: `reopen-bulk` berekent per leerling via `bouwHerstelPlan(code,id,naam,minutenTotUntil,'vanafNu')` de extra seconden (opgeslagen in `quiz_individual_access.extra_seconds`; ook `live.quizExtraSeconds`). `GET /startinfo?name=` geeft `heropendTot` en `stopped=false` bij geldige individuele toegang; `quiz-student.js › haalStartInfo` stuurt de naam mee. `heropenLeerling` delegeert naar `herstelLeerling`.

## PyBlitz (v151)
- **Logica** (puur, getest): `lib/pyblitz.js` (vraagnormalisatie, punten, rangschikking, gastnamen, pincodes, import JSON/Excel-rijen, export) en `lib/pyblitz-spel.js` (spelmotor lobby→vraag→uitslag→eind→gesloten; server-autoritatief, injecteerbare klok/timers, `toestand(spelerId|null)` bouwt de payload per ontvanger; het juiste antwoord zit pas na de vraag in de payload).
- **Routes + sockets**: `lib/pyblitz-routes.js`. REST (leerkracht, CSRF): `/api/pyblitz/sets[/:id]`, `/export`, `/import` (JSON of xlsx base64, eigen 3 MB parser), `/sjabloon.xlsx`, `/image` (magic-bytes via `herkenAfbeelding`, max 600 kB; `GET /image/:id` publiek, onraadbaar id), `/games[/:id]`. Publiek: `POST /api/pyblitz/join` (pin + naam → token; rate-limit per IP, max 150 gasten; klasnamen via `dbModule.pyblitzKlasNamen`; nummer bij bezette naam). Pagina's: `/pyblitz.html` (requireTeacherAuth), `/play`.
- **Sockets** (`attach(socket)` in `io.on('connection')`): leerkracht `teacher_pyblitz_status|koppel|open|sync|begin|volgende|sluitvraag|pauze|hervat|sluit`; deelnemer `pyblitz_sync` (klasleerling), `pyblitz_guest_connect {token}`, `pyblitz_answer`, `pyblitz_guest_leave`; server → `pyblitz_state` (per ontvanger) en `pyblitz_closed` (room `pb:<gameId>`). `open` weigert wanneer `session.mode!=='class'` of de werkruimte niet `shared` is. Spellen leven in het geheugen (registry per id/pin/sessie), worden na 45 min inactiviteit gestopt; resultaat (`onEinde`) gaat naar `pyblitz_games`. Koppeling set↔sessie: `session.pyblitz` → `config._pyblitz` (persistSession).
- **DB**: `pyblitz_sets`, `pyblitz_images` (BYTEA), `pyblitz_games` (results JSONB) in `initSchema`.
- **Front-end**: `public/pyblitz-ui.js` (gedeelde weergave host/leerling/gast, enkel textContent; QR = `vendor/qrcode-generator.js`), `pyblitz-overlay.js` (popup/spelmodus in teacher-app en student-app via `window.__pcfSocket`), `pyblitz-bibliotheek.js` + `pyblitz.html` (bibliotheek/editor), `play.html` + `play.js` (gast; token in sessionStorage), `pyblitz.css`.

- **PyBlitz v152**: opties `{text, code}` (meerdere regels → `code=true`, max `OPTIE_REGELS_MAX`=6). **Proef** (`public/pyblitz-proef.js`): popup met 2 iframes op `/pyblitz-proef.html?rol=host|speler` (script `pyblitz-proef-frame.js`, hergebruikt `pyblitz-ui.js`); parent en iframes praten via `postMessage` (origin-check). De spelmotor draait in de browser via `GET /pyblitz-engine.js` (server verpakt `lib/pyblitz.js` + `lib/pyblitz-spel.js` in een wrapper; één bron van waarheid). Bots: kans 50–75 % juist, antwoordtijd 2–11 s. In `server.js` krijgt enkel `/pyblitz-proef.html` `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN`.

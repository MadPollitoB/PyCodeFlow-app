# PyCodeFlow — Sprintlog & Roadmap

> **Versie 2026.2.8.0** · Atheneum Hoboken
> Nieuwste sprint staat bovenaan.

**Andere documenten:**
- [TECHNICAL.md](TECHNICAL.md) — Architectuur & API referentie
- [CHANGELOG.md](CHANGELOG.md) — Versiegeschiedenis per release
- [USER-MANUAL.md](USER-MANUAL.md) — Gebruikershandleiding

---

## 9. Sprintoverzicht & Roadmap

| Sprint | Inhoud | Status | Inschatting |
|---|---|---|---|
| **12f** | Smartschool SSO | 🔄 Gepland (optioneel) | ~1 week |
| **12e** | Google OAuth leerlingen | 🔄 Gepland | ~3 dagen |
| **12d** | Klas-dropdown + zachte toegangscontrole | 🔄 Gepland | ~3 dagen |
| **12c** | Admin-pagina: leerlingenbeheer | 🔄 Gepland | ~3 dagen |
| **12b** | Admin-pagina: leerkrachten & klassen | 🔄 Gepland | ~3 dagen |
| **12a** | PostgreSQL + Monaco bundelen | 🔄 Gepland | ~2 dagen |
| **11** | Kleine features & polish | 🔄 Gepland | ~1 dag |
| **10** | UX verbeteringen vóór migratie | ✅ Afgerond (v2026.2.8.0) | ~4 dagen |
| **9** | Technische schuld & bugfixes | ✅ Afgerond (v2026.2.7.0) | ~0.5 dag |
| 1–8 | Zie CHANGELOG.md | ✅ Afgerond | — |

---

### Sprint 9 — Technische schuld & kritieke bugfixes *(~0.5 dag)*

**Impact:** Onzichtbaar voor eindgebruiker. Stabiliteit en correctheid verbeteren.
**Volgorde:** Eerst uitvoeren — clean codebase voor de grote migratie.
**Risico:** Laag. Kleine geïsoleerde fixes.

**A) Memory leak: `snapshotLastSaved` groeit onbeperkt**

Bij elke code-update wordt een entry toegevoegd aan `snapshotLastSaved` (Map). Wanneer een sessie sluit of een leerling verwijderd wordt, worden die entries nooit verwijderd. Bij intensief gebruik over meerdere weken stapelt dit op.

Fix: bij `teacher_close_session`, `teacher_delete_session` en bij leerling-verwijdering alle entries met prefix `sessionCode:` verwijderen uit de Map. Tevens een periodieke cleanup toevoegen (elke 30 minuten) die verouderde entries verwijdert van gesloten/verwijderde sessies.

**B) Timer `clearInterval` ontbreekt bij sessie sluiten**

Bij `teacher_close_session` en `teacher_delete_session` wordt `session.timerInterval` niet gecleaned. De interval blijft elke seconde draaien en probeert events te sturen naar een gesloten sessie. Fix: `clearInterval(session.timerInterval)` toevoegen aan beide handlers, identiek aan hoe `teacher_stop_timer` het doet.

**C) CSRF-token wordt nooit meegestuurd door de frontend**

De `csrf_token` cookie wordt correct gezet bij login maar de frontend stuurt de `X-CSRF-Token` header nooit mee bij API-calls. De token-laag is daardoor dode code — enkel de Origin/Referer check werkt. Twee opties:

- **Optie 1 (aanbevolen):** CSRF-token lezen uit cookie in `app.js` en meesturen als header bij alle `fetch` calls naar beveiligde endpoints. Één centrale `apiFetch()` wrapper schrijven.
- **Optie 2:** Token-check weghalen en enkel vertrouwen op `SameSite=Strict` + Origin-validatie. Minder diepgaande beveiliging maar eerlijker dan dode code.

**D) Annotatie tab-isolatie** *(toegevoegd na observatie)*
Annotaties zijn enkel relevant op het Klascode-tabblad. Ze lekten echter door naar Mijn werkblad en soms naar Klascode bij verkeerde timing. Fix:
- `window._savedAnnotations` array bijhouden met alle annotaties van de sessie
- Bij tab-wissel naar 'personal': decoraties wissen uit de editor-instantie
- Bij tab-wissel terug naar 'shared': decoraties herstellen vanuit `_savedAnnotations`
- `annotation_added` tekent decoraties enkel als de leerling op 'shared' staat; anders enkel opslaan + toast
- `annotations_cleared` wist zowel de decoraties als `_savedAnnotations`

**E) History: betere foutmeldingen + tabel-diagnose**
`alert('Fout bij laden history.')` vervangen door specifieke meldingen:
- 404: leerling niet gevonden
- 500 met "no such table": instructie om `docker compose restart web` uit te voeren
- Lege snapshots: uitleg dat typen snapshots genereert na 10 seconden
- Netwerkfout: foutmelding met details

**F) check-deployment.sh bijwerken**
Checks toevoegen voor de fixes in A, B, C, D en E.

---

### Sprint 10 — UX verbeteringen vóór migratie *(~1 dag)*

**Impact:** Zichtbaar voor leerkrachten. Verbetert examengebruik significant.
**Volgorde:** Na sprint 9. Vóór sprint 12a — wordt complexer na de PostgreSQL-migratie.

**A) Annotaties — gedrag per modus**

**Klasmodus:** blijft zoals nu. "📌 Annoteer"-knop staat in de editor toolbar. Annotatie gaat naar alle leerlingen tegelijk op de gedeelde code. Correct gedrag — iedereen werkt aan dezelfde regels.

**Examenmodus:** elke leerling heeft andere code op andere regels — naar iedereen tegelijk annoteren is zinloos.

Oplossing:
- "📌 Annoteer"-knop is **verborgen** in examenmodus zolang er geen leerling geselecteerd is
- Knop verschijnt **enkel** wanneer de leerkracht bij een leerling op "Live control" klikt
- Annotatie gaat dan **enkel naar die ene leerling** (`targetStudentId` meegeven)
- Toolbar toont de naam van de geselecteerde leerling: `[📌 Annoteer voor Emma]`
- Bij wisselen naar andere leerling: annotaties van vorige verborgen, nieuwe getoond
- "✕ Annotaties wissen" wist enkel de annotaties van de geselecteerde leerling

Toolbar visueel:
```
Klasmodus:
[Run] [📎 Voorbeeld] [📌 Annoteer] [✕ Voorbeeld]

Examenmodus — geen leerling geselecteerd:
[Run]

Examenmodus — Live control bij Emma:
[Run] [📌 Annoteer voor Emma] [✕ Annotaties wissen]
```

Wijzigingen in server.js: `teacher_send_annotation` event uitbreiden met optioneel `targetStudentId`. Als aanwezig → enkel naar die socket; afwezig → naar hele room (klasmodus). Geen breaking change voor bestaande klasmodus-flow.

Nieuw socket event: `teacher_send_annotation_to_student` met `{ studentId, startLine, endLine, message, color }`.

Geschatte extra implementatietijd bovenop bestaande sprint 10A planning: ~1 uur.

**B) Annotatie per stuk verwijderen**

Huidig: enkel "✕ Wis alle". Elke annotatie krijgt een uniek `id` (al aanwezig in het server-object). In de annotatie-floating-panel een lijst van verstuurde annotaties tonen met per annotatie een "✕"-knopje.

Nieuw socket event: `teacher_remove_annotation` met `{ annotationId }`. Server verwijdert uit `session.annotations` array en stuurt `annotation_removed` naar leerlingen.

**C) Sessie-export uitbreiden**

De huidige `.txt` export toont enkel "X keer tab verlaten". Uitbreiden met:
- Tijdstip van elke tab-verlating + duur
- Tijdstip eerste run en laatste run
- Aantal snapshots (proxy voor activiteit)
- Totale schrijftijd (eerste snapshot → laatste snapshot)

**D) Monitoring: waarschuwing bij hoge belasting tijdens les**

In `teacher-app.html` — runner-statusbalk uitbreiden. Als actieve runs > 12 (67% van max 18): oranje banner "⚡ Runner is zwaar belast — wacht even voor je Run all klikt". Als > 16: rode banner. Banner verdwijnt automatisch als belasting daalt.

Data is al beschikbaar via `GET /api/monitoring` — enkel client-side check toevoegen.

**E) check-deployment.sh bijwerken**
Checks voor annotatie per leerling, annotatie verwijderen, export uitbreiding, monitoring banner, editor thema toggle.

**F) Editor thema per gebruiker: licht/donker los van de interface**

De Monaco code-editor staat altijd op donker (`vs-dark`). Dit sprint voegt een **aparte editor-thema voorkeur** toe, volledig los van de interface dark/light toggle.

Kernprincipes:
- Elke gebruiker kiest zijn eigen editor-kleur: **donker** (Monaco `vs-dark`, huidige standaard) of **licht** (Monaco `vs`)
- Keuze opgeslagen in `localStorage` als `pycodeflow_editor_theme` — persoonlijk per browser, nooit gesynchroniseerd
- Output-paneel volgt het editor-thema: donker editor → zwarte output, licht editor → witte output
- Klas- en individuele modus zijn volledig onafhankelijk per leerling: student A kiest licht, student B en de leerkracht blijven donker — code-inhoud blijft gesynchroniseerd, kleur niet
- Leerkracht-editor en student-editor zijn aparte Monaco instanties → elk volgt eigen voorkeur

Implementatie:
- Toggle-knop in de editor toolbar van elke editor: `🖤` (donker) / `🤍` (licht) — duidelijk onderscheid met de interface-toggle `🌙/☀️`
- Bij klik: `monaco.editor.setTheme('vs-dark' | 'vs')` op die specifieke editor-instantie
- Output-paneel: CSS class `output-dark` of `output-light` met bijbehorende kleuren:

```css
.output-panel.output-dark {
  background: #1e1e1e;
  color: #d4d4d4;
}
.output-panel.output-light {
  background: #f8f9fa;
  color: #1f2937;
}
```

- Bij `ensureEditor()`: lees `pycodeflow_editor_theme` uit `localStorage` en pas thema toe bij aanmaak
- Vrije editor, klasmodus, individuele modus en examenmodus: allemaal eigen toggle

Wat NIET gesynchroniseerd wordt:
- Kleurvoorkeur van student A heeft geen invloed op student B of de leerkracht
- Code-inhoud blijft volledig gesynchroniseerd zoals nu
- Interface dark/light mode (navbar, panelen) blijft een aparte instelling

---

### Sprint 11 — Kleine features & polish *(~1 dag)*

**Impact:** Mix van zichtbare UX-verbeteringen en technische polish.
**Volgorde:** Na sprint 10. Laatste sprint voor de grote migratie.

**A) Dark mode: custom gutter correctie**

De custom gutter (regelnummers naast Monaco) heeft hardcoded kleuren (`#071737`, `#9fb3c8`). In dark mode steekt dit er lelijk uit — de gutter heeft een donkerblauwe achtergrond die niet overeenkomt met het dark mode kleurenpalet.

Fix: gutter CSS-kleuren vervangen door CSS-variabelen (`var(--surface)`, `var(--muted)`). Monaco `editorGutter.background` kleur aanpassen op basis van huidig thema bij toggle.

**B) Sessie-archief: gesloten sessies bekijken**

Gesloten sessies verdwijnen nu volledig uit het overzicht. De data zit in SQLite maar er is geen UI. In `teacher-sessions.html` een toggle "Toon gesloten sessies" toevoegen (standaard verborgen). Gesloten sessies worden grijs weergegeven met slotje-icoon, enkel "Export"-knop beschikbaar (geen "Open" of "Verwijderen").

Nieuw endpoint: `GET /api/sessions?includeClosed=true` — retourneert ook gesloten sessies.

**C) Leerling ziet eigen code-history**

Via de bestaande `GET /api/sessions/:code/history/:studentId` endpoint (al aanwezig) kan een leerling zijn eigen snapshots opvragen. In `student-app.html` een knop "📜 Mijn history" toevoegen die de bestaande `showHistoryPlayback` modal opent met de eigen snapshots. Leerkracht heeft geen actie nodig.

Vereist: leerling-sessie-ID beschikbaar in `localStorage` (al aanwezig als `studentId`).

**D) Runner-wachtrij visueel bij leerling**

Als een run in de wachtrij staat, ziet de leerling nu enkel "Run staat in wachtrij (positie X)". Uitbreiden met een animatie (pulserende stip) en een schatting van de wachttijd op basis van de gemiddelde run-duur van de afgelopen 5 runs.

**E) Autocheck dagelijkse resultaten zichtbaar in teacher-sessions**

De autocheck loopt elke ochtend om 06:00 maar het resultaat is enkel zichtbaar in `monitoring.html`. In `teacher-sessions.html` een kleine badge toevoegen rechtsboven: groen vinkje als laatste autocheck geslaagd, rood kruisje als gefaald, met tijdstip. Klikken opent `monitoring.html`.

**F) check-deployment.sh bijwerken**
Checks voor dark mode gutter, sessie-archief endpoint, leerling history knop, autocheck badge in teacher-sessions.

---

### Sprint 12a — PostgreSQL + Monaco bundelen *(~2 dagen)*

**Impact:** Architectuurmigratie. Eindgebruiker merkt niets. Hoogste risico van alle sprints.
**Volgorde:** Na sprint 11 volledig stabiel. Eerst 24u stabiliseren voor 12b te starten.
**Risico:** Hoog — driver-wissel raakt alle database-queries.

**A) PostgreSQL Docker service**
`postgres:16-alpine` toevoegen aan `docker-compose.yml`. Persistent volume op `/volume3/docker/pycodeflow/pgdata`. Health check via `pg_isready`. `DATABASE_URL=postgresql://pycodeflow:wachtwoord@postgres:5432/pycodeflow` in `.env`. `depends_on: postgres` toevoegen aan web service.

**B) Database driver wisselen**
`better-sqlite3` → `pg` met connection pool (`pg.Pool`). Alle queries herschrijven: synchrone SQLite → async/await PostgreSQL. Parameternotatie: `?` → `$1, $2, ...`. `database.js` volledig herschrijven met async methodes. `server.js`: alle `dbModule.*` aanroepen awaiten.

**C) Migratescript `scripts/migrate-sqlite-to-pg.js`**
Exporteert `teachers`, `sessions`, `code_snapshots` uit SQLite. Importeert in PostgreSQL in correcte volgorde. Verifieert row counts voor en na. Rollback-instructie als migratie mislukt. SQLite blijft ongewijzigd als fallback.

**D) Monaco bundelen via Vite/esbuild**
Vite build stap toevoegen aan web `Dockerfile`. Monaco AMD CDN-loader → ESM bundle. Output naar `web/public/monaco-bundle/`. Verwachte winst: 40–60% snellere initiële laadtijd.

**E) check-deployment.sh**
PostgreSQL container, `DATABASE_URL`, psql-verbinding, migratescript aanwezig, Monaco bundle aanwezig.

**Testprocedure na sprint 12a:**
1. `bash check-deployment.sh` → 0 fouten
2. Sessie aanmaken, leerling joinen, code runnen
3. Server herstarten → sessies hersteld uit PostgreSQL
4. Stresstest: gezondheidscheck + runner capaciteit
5. 24u monitoren voor sprint 12b te starten

---

### Sprint 12b — Admin-pagina: leerkrachten & klassen *(~3 dagen)*

**Impact:** Enkel zichtbaar voor systeembeheerder.
**Volgorde:** Na 12a volledig stabiel.

**A) Nieuwe pagina `/admin.html`**
Drie tabbladen: **Leerkrachten** / **Klassen** / **Leerlingen** (leerlingen in sprint 12c). `monitoring.html` krijgt enkel een knop "→ Gebruikersbeheer".

Twee toegangsniveaus:
- **Leerkracht** — ziet enkel eigen klassen en leerlingen daarin
- **Admin** — ziet en beheert alles

Een leerkracht kan tijdelijk admin-rechten activeren via "Admin-modus activeren" (vraagt admin-wachtwoord). Blijft actief voor de duur van de browsersessie.

**B) Database uitbreiden**
```sql
ALTER TABLE teachers ADD COLUMN role TEXT DEFAULT 'teacher';
-- 'teacher' | 'admin'

CREATE TABLE classes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  school_year TEXT NOT NULL DEFAULT '2025-2026',
  archived    BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE teacher_classes (
  teacher_id TEXT REFERENCES teachers(id) ON DELETE CASCADE,
  class_id   TEXT REFERENCES classes(id) ON DELETE CASCADE,
  PRIMARY KEY (teacher_id, class_id)
);
```

**C) Tabblad Leerkrachten** (enkel admin)
Lijst: gebruikersnaam, weergavenaam, rol, laatste login.
Acties: **Nieuw**, **Wachtwoord resetten**, **Rol wijzigen** (teacher↔admin), **Verwijderen** (enkel als geen actieve sessies).

**D) Tabblad Klassen**
Lijst: naam, schooljaar, aantal leerlingen, gekoppelde leerkrachten, status.
Acties: **Nieuwe klas**, **Leerkrachten koppelen**, **Archiveren**, **Verwijderen** (enkel als leeg).

**E) check-deployment.sh**
`/admin.html` aanwezig, `role` kolom, `classes` en `teacher_classes` tabellen.

---

### Sprint 12c — Admin-pagina: leerlingenbeheer *(~3 dagen)*

**Impact:** Zichtbaar voor systeembeheerder en leerkrachten.
**Volgorde:** Na 12b.

**A) Database leerlingen**
```sql
CREATE TABLE students (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  class_id   TEXT REFERENCES classes(id) ON DELETE SET NULL,
  status     TEXT DEFAULT 'active',
  -- 'active' | 'pending' | 'blocked'
  source     TEXT DEFAULT 'manual',
  -- 'manual' | 'csv' | 'google' | 'smartschool'
  created_at TIMESTAMPTZ DEFAULT now(),
  last_seen  TIMESTAMPTZ,
  notes      TEXT DEFAULT ''
);

CREATE INDEX idx_students_class ON students(class_id);
CREATE INDEX idx_students_name  ON students(name);
CREATE UNIQUE INDEX idx_students_name_class
  ON students(name, class_id) WHERE class_id IS NOT NULL;
```

**B) Tabblad Leerlingen**
Twee weergaves: per klas (leerkracht) en alle leerlingen (admin). Kolommen: naam, klas, status, bron, laatste sessie.

Acties per leerling: **✓ Bevestigen**, **✕ Blokkeren**, **↩ Deblokkeren**, **→ Klas wijzigen** (leerkracht: eigen klassen; admin: alle), **🗒 Notitie**, **Verwijderen**.

**C) CSV-import leerlingen**
Knop "📥 CSV-import". Formaat: `naam,klas` per rij.

Verwerkingslogica:
1. Klas opzoeken op naam → optie "Automatisch aanmaken" indien niet gevonden
2. Naam + klas al in DB → overslaan met melding
3. Naam in andere klas → keuze overslaan of verplaatsen
4. Nieuw → toevoegen als `active`, source `csv`

Rapport: X toegevoegd, Y overgeslagen, Z klassen aangemaakt, W fouten.

**D) check-deployment.sh**
`students` tabel, unieke index, CSV-import endpoint.

---

### Sprint 12d — Klas-dropdown + zachte toegangscontrole *(~3 dagen)*

**Impact:** Zichtbaar voor leerlingen (dropdown), leerkrachten (badges) en admins.
**Volgorde:** Na 12c.

**A) Klas-dropdown op joinen-pagina's**
Op `student-start.html` en `free-editor.html`: vrij tekstveld "klas" → dropdown via `GET /api/classes` (publiek endpoint).

```
— Geen klas / Gast —   ← standaard
6A Informatica
6B Informatica
5A
...
```

Enkel niet-gearchiveerde klassen. Lege DB → vrij tekstveld als fallback. Vorige keuze in `localStorage`.

**B) Duplicaat-detectie bij joinen**
Server controleert of naam al actief is in deze sessie:
- Uniek → normaal joinen
- Duplicaat → melding: *"Er is al iemand met de naam 'Emma' in deze sessie. Voeg je initialen of achternaam toe, bijv. 'Emma J.' of 'Emma Janssens'."*

**C) Toegangslogica bij joinen**

| Situatie | Toegang | Badge leerkracht |
|---|---|---|
| Naam in klas, status `active` | ✅ Direct | — |
| Naam in klas, status `pending` | ✅ Direct | ⏳ In afwachting |
| Naam in klas, status `blocked` | ❌ Geweigerd | — |
| Naam niet in klas | ✅ Direct + `pending` | ⚠️ Nieuw |
| Klas = "— Geen klas / Gast —" | ✅ Direct | 👤 Gast |

Leerlingen worden **nooit live geblokkeerd** tijdens een sessie.

**D) Leerkracht: onbevestigde leerlingen beheren vanuit de sessie**

Badges: **⚠️ Nieuw** (oranje), **⏳ Afwachting** (geel), **👤 Gast** (grijs).

Inline acties in de leerlingenrij (geen navigatie naar admin nodig):
- **✓ Aanvaarden** — `pending` → `active`, badge verdwijnt, leerling blijft verbonden
- **→ Klas** — dropdown eigen klassen, live bijgewerkt
- **✕ Blokkeren** — geldt bij volgende join-poging, niet live

Wijzigingen onmiddellijk opgeslagen in DB.

**E) check-deployment.sh**
`/api/classes` endpoint, dropdown in student-start en free-editor, duplicaat-detectie, badges in app.js.

---

### Sprint 12e — Google OAuth leerlingen *(~3 dagen)*

**Impact:** Leerlingen kunnen optioneel inloggen met schoolaccount. Naam+klas blijft als fallback.
**Volgorde:** Na 12d.

**A) Google OAuth setup**
`passport` + `passport-google-oauth20`. Callback: `https://app.pycodeflow.org/auth/google/callback`. Enkel `@leerling.atheneumhoboken.be` en `@atheneumhoboken.be` domeinen.

**B) Login-flow leerling**
`student-start.html` — twee opties:
```
┌─────────────────────────────────────┐
│  🔵 Doorgaan met Google             │
│  (voor leerlingen met schoolaccount)│
├─────────────────────────────────────┤
│  of joinen als gast                 │
│  Naam: [__________]                 │
│  Klas: [dropdown ▼]                 │
│  [Deelnemen]                        │
└─────────────────────────────────────┘
```

**C) Koppelingslogica**
1. Email in `students.google_email` → directe toegang
2. Email `blocked` → geweigerd
3. Niet gevonden → nieuw record: naam uit Google-profiel, klas NULL, status `pending`

```sql
ALTER TABLE students ADD COLUMN google_email TEXT UNIQUE;
ALTER TABLE students ADD COLUMN google_sub   TEXT UNIQUE;
```

**D) check-deployment.sh**
`passport-google-oauth20` in package.json, `GOOGLE_CLIENT_ID` en `GOOGLE_CLIENT_SECRET` in `.env`, routes `/auth/google` en callback, kolommen in students.

---

### Sprint 12f — Smartschool SSO *(~1 week, optioneel)*

**Impact:** Automatische klassenkoppeling via Smartschool.
**Volgorde:** Na 12e. Pas starten na afstemming met ICT-coördinator.
**Risico:** Afhankelijk van externe partij.

**Voorbereiding:**
- Aanvraag Smartschool OAuth via schoolbeheerder
- Afspreken welke data meekomt (naam, klas, rol)
- Testen in Smartschool sandbox

**A) Integratie**
Custom OAuth2 strategy. Callback: `https://app.pycodeflow.org/auth/smartschool/callback`. Token bevat: naam, klas, rol.

**B) Automatische klassenkoppeling**
Klas uit token → opzoeken in `classes` → koppelen (status `active`). Geen handmatige goedkeuring — Smartschool is bron van waarheid.

**C) Leerkrachten via Smartschool**
Parallel naast wachtwoordsysteem.
```sql
ALTER TABLE teachers ADD COLUMN smartschool_email TEXT UNIQUE;
ALTER TABLE students ADD COLUMN smartschool_email TEXT UNIQUE;
```

---

### Openstaande kleine items *(tussendoor)*

| Item | Prioriteit | Inschatting | Wanneer |
|---|---|---|---|
| Klassenarchief begin schooljaar | 🟡 Medium | 2 uur | Na 12b |
| Leerling ziet eigen code-history | 🟡 Medium | 1 uur | Sprint 11C |
| Autocheck badge in teacher-sessions | 🟢 Laag | 1 uur | Sprint 11E |

---

### Nice to haves *(na alle sprints)*

- Real-time samenwerkingscursors (Google Docs-stijl)
- Mobiel-vriendelijke editor (CodeMirror 6 als fallback < 768px)
- PDF-export leerling-voortgang (`puppeteer` of `pdfkit`)
- Webhook notificaties bij gefaalde autocheck (Slack/e-mail)
- Klassenarchief per schooljaar met historische sessie-data
---


*PyCodeFlow · Atheneum Hoboken · v2026.2.8.0*

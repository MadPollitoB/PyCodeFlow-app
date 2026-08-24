# PyCodeFlow — Volledig Testboek

> **Versie:** v2026.2.50.0 · **Bijgewerkt:** 12 augustus 2026 (sprint 50 bugfixes verwerkt)
> Volledig stappenplan voor alle functies, pagina's, layouts en PDF-exports.
> Voer tests uit op: `https://app.pycodeflow.org` (productie) of `http://localhost:3000` (lokaal)

---

## 0. Voorbereiding

### 0.1 Testdata aanmaken (eenmalig)

**Aanbevolen (sprint 54):** `scripts/app/pycodeflow.sh` → optie **21 🧬 Testdatabase** → `SEED` typen.
Dat bouwt in één keer een volledige testset (idempotent; wis met `WIS`):

| Item | Waarde |
|---|---|
| Scholen | `TESTDATA School A` en `TESTDATA School B` |
| Leerkrachten (ww = gebruikersnaam) | `superadmin` · `leerkrachtA` (admin, school A) · `leerkrachtA2` · `leerkrachtB` (admin, school B) |
| Klassen + startcodes (actief) | Klas 5A → `TDKLAS5A` · Klas 6A → `TDKLAS6A` · Klas 5B → `TDKLAS5B` |
| Leerlingen (ww = gebruikersnaam) | `studentA@testschool.local` (actief) · `studentA2@…` (pending) · `studentA3@…` (geblokkeerd) · 1 leerling zónder account |
| Vragenbank | Privé/school/publiek + 1 door admin verborgen vraag (53d) |
| Sjablonen | School- en publiek-scope, met gekoppelde vragen |
| Sessies | `TDLESA5` (les) · `TDTOETSA` (toets **met ingevulde antwoorden/scores**) · `TDTAAKA` (taak) |

> ⚠️ Enkel voor test/staging — nooit op productie. De wis-optie verwijdert **alleen** de
> gemarkeerde seed-rijen; wat je zélf tijdens het testen aanmaakt blijft staan. Wil je écht
> een lege databank, gebruik dan de volledige reset (optie 14).

**Handmatig alternatief** (als je bewust zonder seeder test) via `admin.html`: leerkracht
`testleerkracht`, klas `6A Informatica`, leerlingen via CSV-import, ≥3 vragen
(code/open/single), toets `Testtoets H1`.

> **Herstel na herinstall (47.2/47.3):** een verse DB heeft geen leerkracht → de web-container stopt zichzelf (`checkAuthConfig`). Maak dan een leerkracht aan **zonder** dat de web-container hoeft te draaien:
> ```bash
> docker compose run --rm web node scripts/manage-teacher.js add <naam> '<wachtwoord>' admin
> docker compose up -d --force-recreate web
> ```
> Controleer daarna dat `/api/version` het juiste versienummer toont (zie 0.2).

### 0.2 Regressie baseline (na elke deploy uitvoeren)

```bash
docker compose ps
# ✅ postgres: healthy
# ✅ web: running (healthy)
# ✅ runner: running
# ✅ cloudflared: running

curl -sf http://localhost:3000/health
# ✅ HTTP 200

curl -s http://localhost:3000/api/version | python3 -m json.tool
# ✅ version: "2026.2.24.0"
# ✅ uptime, node, platform zichtbaar
# ⚠️ REGRESSIE (47.2): version MOET gelijk zijn aan het VERSION-bestand.
#     Wijkt het af (bv. oude/fallback-waarde), dan kon de app zijn VERSION niet lezen
#     — controleer op "[versie] Lezen van ... mislukt" in de weblogs (fs-TDZ).

docker compose logs web --tail=20 | grep -iE "ERROR|FATAL|Cannot find"
# ✅ Geen kritieke fouten

bash scripts/general/check-deployment.sh
# ✅ 0 gefaald
```

---

## 1. Startpagina (index.html)

**URL:** `/`

### Layout
```
✅ PyCodeFlow logo zichtbaar linksboven
✅ Geen dark-mode toggle knop aanwezig
✅ Favicon zichtbaar in browsertab
✅ Paginatitel: "PyCodeFlow"
✅ Hero-sectie met twee panelen (links tekst, rechts mock-editor)
✅ Mock-editor toont donkere achtergrond met Python code-voorbeeld
✅ Drie actieknoppen zichtbaar: "Leerkracht", "Leerling", "Vrij oefenen"
✅ Footer: "© 2026 PyCodeFlow — ontwikkeld door B. Claes · v2026.2.27.0"
✅ Mobiele weergave: hero-panelen onder elkaar
```

### Navigatie
```
✅ Klik "Leerkracht" → redirect naar /teacher-login.html
✅ Klik "Leerling" → redirect naar /student-start.html
✅ Klik "Vrij oefenen" → redirect naar /free-editor.html
```

---

## 2. Leerkracht inloggen (teacher-login.html)

**URL:** `/teacher-login.html`

### Layout
```
✅ Paginatitel: "PyCodeFlow — Aanmelden"
✅ Favicon zichtbaar
✅ Formulier: gebruikersnaam + wachtwoord + Aanmelden knop
✅ Geen topbar/subnav (enkel login formulier)
```

### Functionaliteit
```
✅ Correct wachtwoord → redirect naar /teacher-sessions.html
✅ Fout wachtwoord → foutmelding "Gebruikersnaam of wachtwoord onjuist."
✅ Lege velden → client-side validatie

Rate limiting:
✅ 6 foutieve pogingen → 7e poging geeft HTTP 429
✅ 429-melding zichtbaar in UI

✅ Na login: sessiecookie aanwezig (HttpOnly, SameSite=Strict)
✅ Bezoek beveiligde pagina zonder cookie → redirect naar login
```

---

## 3. Sessieoverzicht (teacher-sessions.html)

**URL:** `/teacher-sessions.html`

### Layout (24f)
```
✅ Paginatitel: "PyCodeFlow — Sessies"
✅ Favicon zichtbaar
✅ Topbar: logo + "PyCodeFlow" + badge "Sessies" + "Afmelden" knop
✅ Geen dark-mode toggle
✅ Subnav aanwezig: Vragenbank · Nieuwe toets · Archief | Beheer · Systeem
✅ "Sessies" pagina NIET gemarkeerd in subnav (subnav is voor subpagina's)
✅ Twee-koloms layout: "Nieuwe sessie" links, "Lopende sessies" rechts
✅ Vrije sessie-panel onderaan over volledige breedte
✅ Footer zichtbaar met versienummer
```

### Sessie aanmaken
```
✅ Naam invullen: "Python oefening 1"
✅ Klasmodus card selecteerbaar (oranje/goud border als actief)
✅ Examenmodus card selecteerbaar
✅ Starttemplate dropdown: "— Geen template —" + aanwezige templates
✅ Template preview zichtbaar bij selectie (donkere code-box)
✅ Codehulp checkbox: aan/uit wisselbaar
✅ Badges tonen huidige status: "Klasmodus" + "Codehulp aan/uit"
✅ Klik "Sessie maken" → sessie aangemaakt
✅ Sessiecode verschijnt in lopende sessies (8 tekens, A-Z en 2-9)
```

### Lopende sessies (24f)
```
✅ Sessiekaart compact: naam + status badge boven
✅ Meta-grid 4 kolommen: Type | Leerlingen | Code (blauw) | Codehulp
✅ Sessiecode zichtbaar in primary kleur (blauw)
✅ Knoppen op één rij: Open · 👁 Waarnemen · Blokkeren · Verwijderen
✅ "Blokkeren" → kaart toont status "geblokkeerd" + knop wordt "Starten"
✅ "Starten" → status terug naar actief
✅ "Verwijderen" → in-app confirm modal (geen browser confirm)
✅ Tabblad "📝 Toetsen" toont aangemaakte toetsen
✅ "+ Nieuwe toets aanmaken" link in toetsen-tab
```

### Vrije sessie sectie
```
✅ "0 actief" badge zichtbaar als niemand vrij oefent
✅ "Niemand is momenteel aan het vrij oefenen." tekst
✅ Vrije leerlingen verschijnen hier na navigatie naar /free-editor.html
```

---

## 4. Leerling inloggen (student-start.html)

**URL:** `/student-start.html`

### Layout
```
✅ Paginatitel: "PyCodeFlow — Deelnemen"
✅ Favicon zichtbaar
✅ Formulier: naam + sessiecode + Deelnemen
✅ Klasdropdown zichtbaar als klassen bestaan in DB
✅ Fallback tekstveld als geen klassen bestaan
```

### Functionaliteit
```
✅ Naam invullen + geldige code → redirect naar /student-app.html
✅ Naam opgeslagen in localStorage (herlaad pagina → naam ingevuld)
✅ Foute code → foutmelding in UI
✅ Lege naam → validatie
✅ Code hoofdletter-onafhankelijk (kleine letters ook geldig)
```

---

## 5. Leerlingeneditor (student-app.html) — Klasmodus

**URL:** `/student-app.html` (na succesvolle login)

### Layout
```
✅ Paginatitel: "PyCodeFlow — Leerling"
✅ Favicon zichtbaar
✅ Toolbar bovenaan: naam leerling, verbindingsdot, sessienaam
✅ Monaco editor linker paneel (donker thema)
✅ Output paneel rechter paneel (donker achtergrond, lichtgroene tekst)
✅ Statusbalk onder editor: Ln/Kol, regels, Python
✅ Runtime-input: "Invoer niet beschikbaar" placeholder (grijs, disabled)
✅ Geen dark-mode toggle aanwezig
✅ Verbindingsdot: 🟢 verbonden / 🟠 herverbinden / 🔴 verbroken
```

### Editor functionaliteit
```
✅ Monaco editor laadt correct (Python syntax highlighting)
✅ Tab-toets voegt 4 spaties in
✅ Auto-indent na ":" (def/for/while/if)
✅ Auto-sluiten haakjes: ( [ {
✅ Auto-sluiten aanhalingstekens: " '
✅ Kopieer-knop 📋 op code-paneel
✅ Kopieer-knop 📋 op output-paneel
```

### Code uitvoeren
```python
# Test 1: Basisoutput
print("Hallo wereld")
# ✅ Output: Hallo wereld
# ✅ "===== Compiler klaar met runnen =====" verschijnt

# Test 2: Meerdere inputs
naam = input("Naam? ")
leeftijd = int(input("Leeftijd? "))
print(f"Hallo {naam}, je bent {leeftijd} jaar")
# ✅ Eerste input-veld activeert
# ✅ Invoer verzenden met Enter of Submit knop
# ✅ Tweede input-veld activeert
# ✅ "Invoer niet beschikbaar" → "Invoer..." bij actieve input
# ✅ Output correct

# Test 3: Oneindige loop
while True:
    print("loop")
# ✅ "⏹ Stoppen" knop actief tijdens uitvoering
# ✅ Klik Stoppen → loop onderbroken
# ✅ "Gestopt door gebruiker" in output

# Test 4: Fout
print(x)
# ✅ "NameError: name 'x' is not defined"
# ✅ 💡 Nederlandse uitleg verschijnt
# ✅ Fout-regel rood gemarkeerd in editor
```

### Toetsenbord sneltoetsen
```
✅ Ctrl+Enter → Code uitvoeren
✅ ? of klik op ❓ → sneltoetsen overlay zichtbaar
✅ Escape → overlay sluiten
✅ Ctrl+Shift+T → editor thema wisselen (licht/donker editor)
✅ Geen Ctrl+Shift+D (dark mode verwijderd)
```

### Klasmodus synchronisatie
```
1. Leerkracht schrijft code in teacher-app.html
✅ Code verschijnt live bij leerling (Socket.IO)
✅ Leerling kan eigen code daarna aanpassen

2. Leerkracht laat code lopen
✅ Output verschijnt bij alle leerlingen
```

---

## 6. Leerkrachteneditor (teacher-app.html) — Sessie actief

**URL:** `/teacher-app.html`

### Layout
```
✅ Paginatitel: "PyCodeFlow — Sessie actief"
✅ Favicon zichtbaar
✅ Toolbar: sessiecode zichtbaar, ⚙️ config knop, ⊞ grid knop
✅ Twee panelen: editor links, leerlingenlijst rechts
✅ Verbindingsdot zichtbaar
```

### Sessie-config (⚙️)
```
✅ 5 schakelknoppen zichtbaar
✅ Klasmodus: alle opties AAN bij opening
✅ Examenmodus: alle opties UIT bij opening
✅ Wijziging onmiddellijk actief bij leerling (geen reload)
✅ Sessie-config persistent na server-herstart (19g)
```

### Leerlingenlijst
```
✅ Elke leerling: naam, klasse, verbindingsstatus
✅ Klik op leerling → leerling-editor zichtbaar (examenmodus)
✅ "⚠️ Nieuw" badge bij onbekende leerling
✅ ✓ aanvaarden → badge verdwijnt
✅ Blokkeer-knop per leerling
```

### Grid-overzicht (⊞)
```
✅ Alle leerlingen tegelijk zichtbaar in grid
✅ Live code updates per leerling
✅ Klik op leerling → focus op die leerling
```

### Code-history playback (📜)
```
✅ Klik 📜 bij een leerling → playback modal opent
✅ Totaal aantal snapshots zichtbaar
✅ ▶ Play → automatisch afspeelbaar
✅ ⏸ Pauzeren → gestopt
✅ Slider → naar specifiek moment springen
✅ Tijdstip per snapshot zichtbaar
```

---

## 7. Vrije editor (free-editor.html)

**URL:** `/free-editor.html`

### Layout
```
✅ Paginatitel: "PyCodeFlow — Vrij oefenen"
✅ Favicon zichtbaar
✅ Geen topbar/subnav (standalone pagina)
✅ Template dropdown aanwezig
✅ Editor + output layout zelfde als student-app
```

### Functionaliteit
```
✅ Code uitvoeren werkt
✅ Code opgeslagen in localStorage (herlaad → hersteld, sprint 19a)
✅ Autosave elke 5 seconden
✅ Template selecteren → code laadt in editor
✅ Leerling verschijnt in "Vrije sessie" sectie bij leerkracht
```

---

## 8. Vragenbank (quiz-bank.html)

**URL:** `/quiz-bank.html`

### Layout
```
✅ Paginatitel: "PyCodeFlow — Vragenbank"
✅ Favicon zichtbaar
✅ Topbar: logo + "Vragenbank" badge + "← Sessies" + "👤 Beheer" knoppen
✅ Subnav: "📋 Vragenbank" actief (blauw), overige links aanwezig
✅ Drie tabs: Vragen | + Nieuwe vraag | 📥 CSV-import
✅ Stats-bar: Totaal, makkelijk, gemiddeld, moeilijk
✅ Filter: onderwerp-dropdown + niveau-dropdown + "Toon gearchiveerd" checkbox
```

### Vraagkaarten (tab: Vragen)
```
✅ Elke kaart toont: onderwerpbadge, moeilijkheidsbadge, typebadge, punten
✅ Vraagstelling rendert als Markdown (sprint 24b):
   - **vet** tekst verschijnt vet
   - `code` inline verschijnt in monospace kader
   - ```python blok verschijnt als donker code-blok
✅ Kaart hoogte begrensd (max 140px, scroll bij lange tekst)
✅ Knop "✏️ Bewerken" aanwezig
✅ Knop "🗑 Verwijderen" aanwezig (niet-gearchiveerd)
✅ Gearchiveerde kaart: "↩ Herstellen" + "🗑 Definitief verwijderen"
✅ Gearchiveerde kaart: rode "Gearchiveerd" badge
✅ Gearchiveerde kaart: lager opaciteit
```

### Nieuwe vraag — Python code (tab: + Nieuwe vraag)
```
✅ Vraagtype "Python code" geselecteerd (blauwe border)
✅ Vraagstelling textarea: Enter-toets werkt (geen form submit)
✅ Preview knop: toont gerenderde Markdown (marked.js)
✅ Preview → Bewerken → terug naar tekst
✅ Code-blokken in preview: donkere achtergrond
✅ Onderwerp: autocomplete datalist
✅ Moeilijkheid: dropdown Makkelijk/Gemiddeld/Moeilijk
✅ Max. punten: nummer input
✅ Klik "💾 Opslaan" → vraag verschijnt in overzicht
✅ Opslaan zonder vraagstelling → pyToast waarschuwing (geen browser alert)
```

### Nieuwe vraag — Open vraag
```
✅ Type "Open vraag" selecteren
✅ Geen antwoordopties-paneel zichtbaar
✅ Opslaan werkt
```

### Nieuwe vraag — Single choice (sprint 24c)
```
✅ Type "Single choice" selecteren → antwoordopties-paneel verschijnt
✅ Hint: "selecteer exact 1 juist antwoord"
✅ Twee lege opties standaard aanwezig
✅ Elke optie: radio-knop | tekstveld | </> knop | ✕ verwijder
✅ Tekstveld vult volledige breedte (niet gecentreerd!)
✅ Radio-knop links van tekstveld (niet gecentreerd in lege ruimte)
✅ Klik op radio → optie krijgt blauwe rand + "✓ Correct antwoord" label
✅ Klik op radio andere optie → vorige verliest correct-markering
✅ "+ Optie toevoegen" → nieuwe optie verschijnt
✅ Maximaal 8 opties (pyToast bij 9e poging)
✅ Minimaal 2 opties (pyToast bij verwijderen van 2e)
✅ </> knop → optie wisselt naar code-textarea (donker, monospace)
✅ </> Naar tekst → wisselt terug
✅ Opslaan zonder juiste optie → pyToast waarschuwing
✅ Opslaan met minder dan 2 opties → pyToast waarschuwing
```

### Nieuwe vraag — Meerkeuze (sprint 24c + 24d)
```
✅ Type "Meerkeuze" selecteren
✅ Hint: "selecteer alle juiste antwoorden"
✅ Bestaande opties wisselen van radio → checkbox (sprint 24d)
✅ Checkbox-knoppen links, niet gecentreerd
✅ Meerdere checkboxes kunnen tegelijk aangevinkt zijn
✅ Elke aangevinkte optie krijgt blauwe rand + "✓ Correct antwoord"
✅ Wisselen terug naar Single → checkboxes worden radio's
```

### Verwijderen/archiveren
```
✅ "🗑 Verwijderen" op actieve vraag → pyConfirm modal (niet browser confirm)
✅ Modal: titel "Vraag verwijderen", Ja/Annuleer knoppen
✅ Annuleer → niets gebeurt
✅ Bevestig → vraag niet in toets: definitief verwijderd
✅ Bevestig → vraag IN toets: tweede pyConfirm "archiveren?"
✅ Archiveer → vraag gearchiveerd, zichtbaar via "Toon gearchiveerd"
✅ "↩ Herstellen" op gearchiveerde vraag → terug actief
✅ "🗑 Definitief verwijderen" op gearchiveerde vraag → pyConfirm → weg
```

### CSV-import (tab: 📥 CSV-import)
```
✅ Formaat: onderwerp,moeilijkheid,max_punten,"vraag"
✅ Voorbeeld-CSV zichtbaar
✅ Plak CSV → klik Importeren
✅ Resultaat: "X toegevoegd · Y overgeslagen"
✅ Duplicaten (zelfde vraagtekst) worden overgeslagen
✅ Geïmporteerde vragen verschijnen in overzicht
```

---

## 9. Nieuwe toets aanmaken (quiz-teacher.html)

**URL:** `/quiz-teacher.html`

### Layout (sprint 24e)
```
✅ Paginatitel: "PyCodeFlow — Nieuwe toets aanmaken"
✅ Favicon zichtbaar
✅ Topbar: logo + "Nieuwe toets" badge + "← Sessies" + "📋 Vragenbank"
✅ Subnav: "📝 Nieuwe toets" actief
✅ Wizard-stappen balk: ① Basisinfo · ② Vragen · ③ Bevestigen
✅ Actieve stap blauw, voltooide stap groen
```

### Stap 1: Basisinfo
```
Naam:
✅ Tekstveld voor toetsnaam

Timer:
✅ Radio "Tijdslimiet" met minute-input (standaard 45)
✅ Radio "Geen tijdslimiet" met uitleg
✅ Keuze correct bewaard bij wisselen

Vraagvolgorde:
✅ Radio "Random per leerling" (standaard, aanbevolen)
✅ Radio "Vast voor iedereen"

Schooljaar + klas:
✅ Schooljaar tekstveld (bv. 2025-2026)
✅ Klas-dropdown met aanwezige klassen

Tijdsvenster:
✅ "Beschikbaar vanaf" datetime-local input
✅ "Deadline (tot)" datetime-local input
✅ Checkbox "Bij deadline automatisch indienen"
✅ Leeg laten = geen tijdsbeperking

Opties — checkbox-row card-stijl (sprint 24e):
✅ "Vraagstelling verbergen op scherm": label + checkbox samen in card
✅ "Minstens 1 run per vraag vereisen": card-stijl
✅ "Test als leerkracht PREVIEW": card-stijl, PREVIEW badge oranje

✅ Klik "Volgende: vragen selecteren →" → stap 2
✅ Lege naam → validatie bij bevestigen (stap 3)
```

### Stap 2: Vragen selecteren
```
✅ Filter: onderwerp-dropdown + niveau-dropdown
✅ Vragen uit bank zichtbaar als selecteerbare items
✅ Klik op vraag → aangevinkt (blauw border)
✅ Punten per vraag aanpasbaar (number input)
✅ "X geselecteerd · Y punten" counter
✅ Geselecteerde vragen verschijnen in lijst onderaan
✅ ← Terug → stap 1 (selectie bewaard)
✅ Bevestigen → stap 3
```

### Stap 3: Bevestigen
```
✅ Samenvatting: naam, timer, volgorde, punten, schooljaar, klas
✅ Lijst van geselecteerde vragen met punten
✅ PREVIEW badge zichtbaar indien PREVIEW gekozen
✅ "✅ Toets aanmaken" knop
✅ Loading state tijdens aanmaken (knop disabled + "⏳ Bezig…" tekst)
✅ Dubbele klik → slechts 1 toets aangemaakt
✅ Na aanmaken: redirect naar sessieoverzicht
✅ Sessiecode zichtbaar in sessieoverzicht
✅ Foutmelding via pyToast (geen browser alert) als aanmaken mislukt
```

---

## 10. Leerling — Toets maken (quiz-student.html)

**URL:** `/quiz-student.html?code=XXXXXXXX&name=...`

### Layout
```
✅ Paginatitel: "PyCodeFlow — Toets"
✅ Favicon zichtbaar
✅ START TOETS scherm: naam, klas, toetsnaam, timer, instructies
```

### Start scherm
```
✅ Timer start PAS bij klikken "START TOETS"
✅ Naam en klas correct zichtbaar
✅ Voor access_from → "nog niet beschikbaar" melding met tijdstip
✅ Na access_until → "Inlevertermijn verstreken" scherm
```

### Vraagnavigator
```
✅ Grijs = niet bezocht
✅ Blauw = bezocht maar niet opgeslagen
✅ Groen ✓ = opgeslagen
✅ Klik op vraagnummer → navigeert naar die vraag
✅ Antwoord wordt automatisch opgeslagen bij navigatie
```

### Python code-vraag
```
✅ Monaco editor actief
✅ Run-knop werkt
✅ Output zichtbaar
✅ Meerdere runs mogelijk
✅ Opgeslagen bij navigatie
```

### Open vraag
```
✅ Tekstveld zichtbaar (8 rijen)
✅ Tekenteller: "0 / 2000 tekens"
✅ Maximaal 2000 tekens (maxlength afgedwongen, sprint 23e)
✅ Enter-toets werkt in textarea (geen form submit, sprint 23e)
✅ Teller update bij typen
```

### Single choice
```
✅ Opties als klikbare label-cards (radio)
✅ Code-optie toont donker code-blok (sprint 23b)
✅ Geselecteerde optie: blauw border + lichtblauwe achtergrond
✅ Keuze opgeslagen bij navigatie
✅ Terug naar vraag → geselecteerde optie nog aangevinkt
✅ Keuze-antwoord persistent na server-herstart (sprint 23a)
```

### Meerkeuze
```
✅ Opties als checkboxes
✅ Meerdere opties selecteerbaar
✅ Code-opties tonen code-blok (sprint 23b)
✅ Opgeslagen bij navigatie
```

### Timer
```
✅ Timer voortgangsbalk zichtbaar
✅ 10% resterend → oranje waarschuwing banner
✅ Timer = 0 → editor vergrendelt → auto-submit
✅ Geen timer → ∞ symbool
✅ Tijdsvenster: deadline verstrijkt tijdens toets → auto-submit + vergrendeling
```

### Indienen
```
✅ Klik "📤 Indienen" → checklist per vraag
✅ Checklist: ✅ opgeslagen + gerund / ⚠️ niet gerund / ⚠️ niet bezocht
✅ "Toch indienen" knop beschikbaar
✅ Definitief indienen → bevestigingsscherm
✅ Na indienen: geen verdere bewerkingen mogelijk
```

---

## 11. Verbetermodule (quiz-review.html)

**URL:** `/quiz-review.html?code=XXXXXXXX`

### Layout
```
✅ Paginatitel: "PyCodeFlow — Toets verbeteren"
✅ Favicon zichtbaar
✅ Topbar: logo + "Toets verbeteren" badge + subnav actief op geen (subpagina)
✅ Subnav aanwezig
✅ Twee kolommen: leerlingenlijst links, vraagdetail rechts
```

### Leerlingenlijst
```
✅ Naam + voortgangsbalk (X/Y vragen verbeterd)
✅ Totaalscore per leerling
✅ Klik op leerling → vragen rechts zichtbaar
```

### Code-vragen verbeteren
```
✅ Monaco editor read-only met leerlingscode
✅ ▶ Uitvoeren → code runt (server-side)
✅ ✏️ Aanpassen & testen → editor tijdelijk bewerkbaar
✅ 📜 Run history → historiek modal
✅ Score invulveld met +/- knoppen
✅ Score opslaan → audit-log entry aangemaakt
```

### Open vragen verbeteren
```
✅ Antwoord als plain tekst zichtbaar
✅ Score invulveld
```

### Single/meerkeuze verbeteren
```
✅ Opties zichtbaar met correcte iconen:
   ✅ groen = correct gekozen
   ❌ rood = fout gekozen
   ☑ geel = correct maar niet gekozen
   ○ grijs = fout en niet gekozen
✅ Code-opties tonen als donker code-blok (sprint 23b)
✅ 🤖 Auto-gescoord badge aanwezig
✅ Score aanpasbaar door leerkracht (overschrijft auto-score)
```

### Gelijkenis detectie
```
✅ ⚠️ Verdachte gelijkenis waarschuwing bij >80% overeenkomst
✅ Welke leerling gemarkeerd
```

### Resultaten vrijgeven
```
✅ "🔓 Resultaten vrijgeven" knop
✅ pyConfirm modal voor bevestiging
✅ Na vrijgeven: leerlingen zien scores
```

---

## 12. PDF-exports (quiz-review.html)

**Alle PDF-types testen via quiz-review.html**

### Type 1 — Vragenblad (🖨️ Vragenblad)
```
✅ PDF download start
✅ Schoolnaam in header
✅ Toetsnaam + datum
✅ Alle vragen genummerd
✅ Python code-vragen: code in monospace blok
✅ Open vragen: lege schrijfruimte
✅ Single/meerkeuze: opties A/B/C/D met lege cirkel/vakje
✅ Paginanummering aanwezig
```

### Type 2a — Antwoordformulier zonder scores
```
✅ Naam leerling + klas in header
✅ Per vraag: leerling antwoord zichtbaar
✅ Geen scores zichtbaar
✅ Meerkeuze: aangevinkte opties gemarkeerd
```

### Type 2b — Antwoordformulier met scores
```
✅ Score per vraag zichtbaar
✅ Totaalscore onderaan
✅ Correcte opties gemarkeerd (groen/rood/geel)
```

### Type 3 — Klasoverzicht
```
✅ Tabel: leerlingen in rijen, vragen in kolommen
✅ Score per cel
✅ Totaalkolom rechts
✅ Gemiddelde onderaan
```

### Bulk ZIP-export (sprint 20 / 19h)
```
✅ "⬇ Exporteer alles" knop zichtbaar
✅ Optie 4: ZIP met individuele PDF's (zonder scores)
✅ Optie 5: ZIP met individuele PDF's (met scores)
✅ Download start als .zip bestand
✅ ZIP bevat: 01_Emma_Janssens.pdf, 02_Luca_Peeters.pdf, ...
✅ Elke PDF bevat alle vragen + antwoorden van die leerling
```

### TXT-export
```
✅ ⬇ TXT export beschikbaar
✅ Bevat alle antwoorden per leerling in leesbaar formaat
```

---

## 13. Toets-archief (quiz-archive.html)

**URL:** `/quiz-archive.html`

### Layout
```
✅ Paginatitel: "PyCodeFlow — Toets-archief"
✅ Favicon zichtbaar
✅ Topbar: logo + "Toets-archief" badge
✅ Subnav: "📦 Archief" actief
```

### Functionaliteit
```
✅ Lijst van afgelopen/gesloten toetsen
✅ Filter: schooljaar, klas, naam
✅ Per toets: naam, datum, klas, aantal leerlingen, gem. score
✅ Klik op toets → quiz-review.html
✅ Exporteer-knop per toets
✅ Verwijder-knop → pyConfirm → toets verwijderd → audit-log
```

---

## 14. Gebruikersbeheer (admin.html)

**URL:** `/admin.html`

### Layout (sprint 24h)
```
✅ Paginatitel: "PyCodeFlow — Beheer"
✅ Favicon zichtbaar
✅ Topbar: logo + "Beheer" badge + "Afmelden" knop (GEEN "← Sessies" of "Monitoring")
✅ Subnav: "👤 Beheer" actief
✅ Drie tabbladen: 👨‍🏫 Leerkrachten · 🏫 Klassen · 👤 Leerlingen
```

### Tabblad: Leerkrachten
```
Inline formulier:
✅ Gebruikersnaam + wachtwoord + weergavenaam + rol (Leerkracht/Admin)
✅ Klik "+ Toevoegen" → leerkracht aangemaakt
✅ pyToast bij lege velden (geen browser alert)
✅ Wachtwoord min. 8 tekens (pyToast bij te kort)

Lijst:
✅ Gebruikersnaam, weergavenaam, rol-badge, laatste login, acties
✅ "🔑 Wachtwoord" knop → nieuw wachtwoord instellen (pyConfirm)
✅ "↓ Leerkracht" knop → rol wijzigen naar Leerkracht (indien Admin)
✅ "Verwijderen" knop → pyConfirm → verwijderd
✅ Eigen account kan niet verwijderd worden
```

### Tabblad: Klassen
```
✅ Nieuwe klas aanmaken
✅ Klas archiveren → pyConfirm → gearchiveerd
✅ Klas verwijderen (enkel leeg) → pyConfirm
✅ Gearchiveerde klassen toggle
✅ Klassen verschijnen in student-start.html dropdown
```

### Tabblad: Leerlingen (sprint 22b + 22c)
```
Handmatig toevoegen:
✅ Naam + klas-dropdown + "+ Toevoegen"
✅ pyToast bij lege naam
✅ Klas-dropdown gevuld met aanwezige klassen
✅ Succesvol: leerling verschijnt in lijst
✅ Foutmelding via pyToast (geen browser alert)

Laadgedrag:
✅ Laadspinner verdwijnt altijd (ook bij API-fout)
✅ Foutmelding zichtbaar als API niet bereikbaar

Lijst:
✅ Naam, klas, status, bron, laatste sessie, acties
✅ Filter: per klas
✅ Zoekbalk op naam

CSV-import:
✅ "📥 CSV-import" toggle-knop
✅ Formaat: naam,klas per regel
✅ Importeer → leerlingen verschijnen
✅ Resultaat: "X toegevoegd · Y overgeslagen"
```

---

## 15. Systeembeheer (monitoring.html)

**URL:** `/monitoring.html`

### Layout (sprint 23l + 24h)
```
✅ Paginatitel: "PyCodeFlow — Systeembeheer"
✅ Favicon zichtbaar
✅ Topbar: logo + "Systeembeheer" badge + "← Sessies" + "Afmelden" knoppen
✅ "👤 Gebruikersbeheer" knop NIET buiten topbar (sprint 23l)
✅ Subnav: "⚙️ Systeem" actief
```

### PostgreSQL sectie
```
✅ "● Verbonden" of foutmelding
✅ Aantal tabellen zichtbaar
✅ Tabellen & records: rij-aantallen per tabel
✅ Quiz statistieken: vragen in bank, toetsen ooit aangemaakt
```

### Database viewer (sprint 24g)
```
✅ "↻ Verversen" knop zichtbaar
✅ Klik Verversen → tabelgrid laadt

Tabelgrid:
✅ Één blokje per tabel (16 verwacht)
✅ Kleurcodering:
   - kern-tabellen (teachers, classes, students): blauw
   - quiz-tabellen (quiz_bank, quiz_meta, ...): groen
   - systeem-tabellen (audit_log, ...): grijs
✅ Per blok: tabelnaam, rij-aantal, eerste 5 kolomnamen als badges
✅ Actieve tabel: donkerdere border

Tabelinhoud (klik op een blok):
✅ Detail-sectie verschijnt onder grid (volledige breedte)
✅ Tabelkop met kolomnamen
✅ Rijen (max 50 per pagina)
✅ Gevoelige kolommen gemaskeerd: "••••••" (password_hash, etc.)
✅ Lange celwaarden ingekort met "..." (tooltip bij hover)
✅ Zoekbalk: filter op waarde → resultaten updaten (350ms debounce)
✅ "← Vorige" / "Volgende →" paginering correct
✅ "X–Y van Z rijen" teller zichtbaar
✅ "✕ Sluiten" → detail verborgen, markering grid weg
```

### Systeemstatus sectie
```
✅ Web server: versie, uptime, Node.js versie
✅ Runner: status, geheugen
✅ Systeem: CPU cores, vrij geheugen
```

### Backup sectie
```
✅ "Nu een backup maken" knop
✅ Backup aangemaakt → bestand in backups/
✅ Bestandsnaam: pycodeflow-YYYYMMDD-HHMM.sql.gz
✅ Log entry in backups/backup.log
✅ Herstel-functie: selecteer backup → bevestig → data hersteld
```

### Audit-log sectie
```
✅ Tabel met recente acties
✅ Kolommen: tijdstip, leerkracht, actie, detail
✅ Filter op actie-type
✅ Score-wijziging → verschijnt in audit-log
✅ Toets verwijderen → verschijnt in audit-log
```

### Stresstest sectie
```
✅ Stresstest starten → resultaten zichtbaar
✅ Lijndiagram na stresstest
✅ Stressload % + label (LAAG/NORMAAL/MATIG/HOOG/KRITIEK)
✅ Kleurcodering: groen <40%, oranje 40-85%, rood >85%
```

### Log-viewer sectie
```
✅ Logbestanden zichtbaar
✅ Inhoud weergeven
✅ Cleanup stale logs knop
```

---

## 16. In-app modals (sprint 24a — alle pagina's)

**Geen enkele pagina mag meer een browser `confirm()` of `alert()` tonen.**

```
Test op quiz-bank.html:
✅ "🗑 Verwijderen" → pyConfirm modal (gestylede overlay, niet browser dialoog)
✅ Modal: titel, body-tekst, "Annuleren" + "Verwijderen" knoppen
✅ Verwijder-knop rood (btn-danger)
✅ Escape → modal sluit (= annuleren)
✅ Klik buiten modal → sluit
✅ Fout bij opslaan → pyToast rood rechtsonder
✅ Waarschuwing → pyToast oranje
✅ Klik op toast → verdwijnt meteen
✅ Toast verdwijnt automatisch na 4 seconden

Test op admin.html:
✅ Leerkracht verwijderen → pyConfirm
✅ Klas verwijderen → pyConfirm
✅ Wachtwoord reset → pyConfirm
✅ Validatie-fouten → pyToast

Test op quiz-bank.html archiveren:
✅ Vraag in toets → pyConfirm archiveren (2-staps flow)
```

---

## 17. pycodeflow.sh (beheertool)

**Op de NAS uitvoeren via: `bash scripts/app/pycodeflow.sh`**

```
✅ Menu toont 18 opties
✅ Optie 1: Status → containers zichtbaar
✅ Optie 2: Start → containers opstarten
✅ Optie 3: Stop → containers stoppen
✅ Optie 16: Backup → backup aangemaakt
✅ Optie 17: Wachtwoord reset → werkt
```

### Optie 18: Opschonen (sprint 23r)
```
✅ Optie 18 verschijnt in menu
✅ Scanfase toont gevonden items met reden + sprint
✅ Annuleren (n) → niets verwijderd
✅ Bevestigen (j) → items verwijderd
✅ Rapport: "X item(s) verwijderd · ~Y MB vrijgemaakt"
✅ Tweede uitvoering: "Alles al netjes"

Items die verwijderd worden:
✅ runner/__pycache__ (als aanwezig)
✅ start.bat / stop.bat (als aanwezig)
✅ web/scripts/migrate-*.js (als aanwezig)
✅ web/scripts/hash-password.js (als aanwezig)
✅ web/run_wrapper.py (als aanwezig)
✅ data/*.db SQLite bestanden (als aanwezig)
✅ Stale logs ouder dan LOG_RETENTION_DAYS
```

---

## 18. Opschonen-Lokaal.ps1 (Windows)

**Uitvoeren: `.\Opschonen-Lokaal.ps1 -DryRun`**

```
✅ Script start zonder PowerShell-fouten
✅ Rootmap validatie: fout als niet in PyCodeFlow-projectmap
✅ -DryRun: toont items maar verwijdert niets
✅ Verouderde projectbestanden sectie zichtbaar
✅ Lokaal-specifieke items sectie zichtbaar
✅ Zonder -DryRun: bevestiging per categorie
✅ -Force: alles zonder bevestiging
✅ Rapport: "X item(s) verwijderd · Y vrijgemaakt"
✅ .env nooit aangeraakt
```

---

## 19. Navigatie & subnav (alle leerkrachtpagina's)

**Controleer op elke pagina:**

| Pagina | Topbar badge | Subnav actief | Afmelden |
|---|---|---|---|
| teacher-sessions.html | Sessies | — | ✅ |
| quiz-bank.html | Vragenbank | Vragenbank | — |
| quiz-teacher.html | Nieuwe toets | Nieuwe toets | — |
| quiz-archive.html | Toets-archief | Archief | — |
| admin.html | Beheer | Beheer | ✅ |
| monitoring.html | Systeembeheer | Systeem | ✅ |
| quiz-review.html | Toets verbeteren | — | — |

```
✅ Subnav aanwezig op alle bovenstaande pagina's
✅ Actieve link blauw gemarkeerd
✅ Subnav sticky bij scrollen (blijft bovenaan)
✅ Geen "← Sessies" knop in topbar van admin.html (sprint 24h)
✅ Geen "📊 Monitoring" knop in topbar van admin.html (sprint 24h)
✅ Alle pagina's: geen dark-mode toggle knop (sprint 23q)
✅ Alle pagina's: favicon zichtbaar in browsertab (sprint 23j)
✅ Alle paginatitels: "PyCodeFlow — [naam]" formaat (sprint 23k)
```

---

## 20. Beveiliging

### HTTP Headers
```bash
curl -I https://app.pycodeflow.org 2>/dev/null | grep -i "content-security\|x-frame\|x-content"

✅ content-security-policy aanwezig
✅ script-src bevat 'self' 'unsafe-inline' https://cdnjs.cloudflare.com
✅ unsafe-eval NIET aanwezig
✅ worker-src 'self' blob: aanwezig
✅ x-frame-options: DENY
✅ x-content-type-options: nosniff
```

### Rate limiting
```bash
for i in {1..7}; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST \
    https://app.pycodeflow.org/api/teacher-login \
    -H "Content-Type: application/json" \
    -d '{"username":"test","password":"fout"}'
done
✅ 1-6: HTTP 401
✅ 7: HTTP 429
```

### Toegangscontrole
```
✅ /admin.html zonder cookie → redirect naar login
✅ /quiz-bank.html zonder cookie → redirect naar login
✅ /monitoring.html zonder cookie → redirect naar login
✅ /api/admin/db/tables zonder cookie → 401 of redirect
✅ /api/admin/db/tables/nonexistent → 403 Tabel niet toegestaan
✅ SQL-injectie via DB viewer onmogelijk (whitelist tabelnamen)
```

### CSRF
```
✅ POST /api/admin/students zonder CSRF-token → afgewezen
✅ POST /api/quiz/bank zonder CSRF-token → afgewezen
```

---

## 21. Mobiele weergave (browser devtools)

**Test met Chrome DevTools → iPhone 14 (390px breed)**

```
✅ index.html: hero-panelen onder elkaar
✅ teacher-sessions.html: twee-koloms → één kolom
✅ quiz-bank.html: vraagkaarten één kolom
✅ quiz-teacher.html: form-row-2 één kolom
✅ admin.html: tabel horizontaal scrollbaar
✅ Subnav wrapping: items breken netjes naar volgende rij
✅ Geen horizontale scrollbar op body-niveau
```

---

## 22. Manage-teacher CLI

```bash
# Op de NAS:
docker compose exec web node scripts/manage-teacher.js list
✅ Leerkrachten zichtbaar

docker compose exec web node scripts/manage-teacher.js add testuser Test1234 teacher
✅ Aangemaakt

# Inloggen als testuser
✅ Werkt

docker compose exec web node scripts/manage-teacher.js reset-password testuser NieuwWw9!
✅ Nieuw wachtwoord werkt

docker compose exec web node scripts/manage-teacher.js delete testuser
✅ Verwijderd

# Na verwijdering: inloggen als testuser
✅ Mislukt (401)
```

---

## 23. API endpoints (smoke test)

```bash
BASE=https://app.pycodeflow.org

# Publieke endpoints
curl -sf $BASE/api/version
✅ {"version":"2026.2.24.0",...}

curl -sf $BASE/health
✅ HTTP 200

# Beveiligde endpoints (zonder cookie → redirect)
curl -s -o /dev/null -w "%{http_code}" $BASE/api/system-stats
✅ 302 of 401

# Met geldige cookie:
curl -sf -b "teacher_auth=..." $BASE/api/system-stats
✅ JSON met stats

curl -sf -b "teacher_auth=..." $BASE/api/admin/db/tables
✅ {"ok":true,"tables":[...]}

curl -sf -b "teacher_auth=..." $BASE/api/admin/db/tables/teachers/rows
✅ {"ok":true,"columns":[...],"rows":[...],"total":...}

curl -sf -b "teacher_auth=..." $BASE/api/admin/db/tables/VERBODEN_TABEL/rows
✅ {"ok":false,"error":"Tabel niet toegestaan"}
```

---

## 24. Bekende beperkingen

| Situatie | Gedrag |
|---|---|
| Google/Smartschool login | Niet beschikbaar — uitgesteld |
| Mobiele Monaco editor | Beperkt — touch werkt niet goed |
| Word import vragenbank | Niet gepland |
| Dark mode UI | Verwijderd (sprint 23q) — altijd licht thema |
| Monaco op iOS Safari | Kan traag laden |

---


---

## 25. Notificatiesysteem (pyAlert + pyToast + pyConfirm)

**Regel: NOOIT een browser alert() of confirm() zichtbaar op enige pagina**

### pyAlert — blokkerende modal (25g)
```
✅ "Voer een naam in voor de toets." → gecentreerde modal met oranje ⚠️ rand
✅ Netwerkfout → rode modal met ✕ icoon
✅ "Ziet er goed uit" succes → groene modal (of toast — afhankelijk van context)
✅ Modal blokkeert de pagina (overlay zichtbaar op achtergrond)
✅ OK-knop sluit de modal
✅ Escape-toets sluit de modal
✅ Enter-toets sluit de modal (focus op OK-knop)
✅ Klik buiten de modal → sluit
✅ Meerdere modals: vorige wordt verwijderd vóór nieuwe opent
```

### pyToast — achtergrond succes (niet blokkerend)
```
✅ "Toets aangemaakt!" → groen toast rechtsonder
✅ "Resultaten vrijgegeven" → groen toast
✅ Toast verdwijnt automatisch na 4 seconden
✅ Klik op toast → verdwijnt meteen
✅ Meerdere toasts stapelen verticaal
```

### pyConfirm — destructieve bevestiging
```
✅ "Vraag verwijderen?" → centered modal, rode Verwijderen-knop
✅ Annuleren → niets gebeurt
✅ Bevestigen → actie uitgevoerd
✅ Escape annuleert
```

---

## 26. Vraagstelling editor met toolbar (sprint 25a/b/c/d)

**URL:** `/quiz-bank.html` → tab "+ Nieuwe vraag"

### 25a Toolbar knoppen
```
✅ Toolbar zichtbaar boven de textarea
✅ B → selecteer tekst → **tekst** ingevoegd
✅ I → *tekst* ingevoegd
✅ ‹› → `tekst` ingevoegd (inline code)
✅ H1 → ## aan begin van regel ingevoegd
✅ H2 → ### aan begin van regel ingevoegd
✅ • → - aan begin van regel (ongeordende lijst)
✅ 1. → 1. aan begin van regel (genummerde lijst)
✅ — → --- aan begin van regel (horizontale lijn)
✅ </> → ```python
...
✅ Codeknop voegt een ```-codeblok in
✅ 🎨 → kleurpopup opent met 6 kleuren
✅ Klik kleur (bv. rood) → <span style="color:#ef4444">tekst</span>
✅ Klik buiten popup → popup sluit
```

### 25b Info-kaders (toolbar knoppen)
```
✅ 💡 knop → :::tip
...
::: ingevoegd op cursorpositie
✅ ⚠️ knop → :::opgelet
...
:::
✅ 📌 knop → :::kader
...
:::
✅ ❓ knop → :::hint
...
:::

Preview/split-view rendering:
✅ :::tip → groene kader met "💡 Tip" titel
✅ :::opgelet → oranje kader met "⚠️ Opgelet" titel
✅ :::kader → blauwe kader met "📌 Kader" titel
✅ :::hint → paarse kader met "❓ Hint" titel
```

### 25c Tabel invoegen
```
✅ ⊞ knop → tabel-modal opent
✅ Standaard: 3 rijen, 3 kolommen
✅ Rijen/kolommen aanpassen → grid updatet meteen
✅ Eerste rij: vetgedrukt koptekst-stijl
✅ Cellen invullen
✅ "⊞ Invoegen" → correcte Markdown-tabel in textarea
✅ "Annuleren" → modal sluit, niets ingevoegd
✅ Tabel zichtbaar als gerenderde HTML tabel in preview/split-view
✅ Gestreepte rijen (even rijen lichte achtergrond)
```

### 25d Split-view editor
```
View-toggle (3 knoppen rechts in toolbar):
✅ ☐ (tekst) = standaard: enkel textarea, geen preview
✅ ⊞ (split) = textarea links + live preview rechts
✅ 👁 (preview) = enkel preview, textarea verborgen

Split-view gedrag:
✅ Typ in textarea → preview update na ~100ms
✅ Markdown opmaak zichtbaar in preview (vet, code, koppen)
✅ Info-kaders zichtbaar als gekleurde blokken
✅ Tabellen zichtbaar als HTML tabel

Voorkeur bewaren:
✅ Sluit browser, heropen → zelfde modus actief
✅ Wissel van vraag → modus bewaard

Smal scherm (< 900px):
✅ Klik ⊞ split → pyAlert "niet beschikbaar op smal scherm"
✅ ☐ en 👁 werken wel op smal scherm
```

---

## 27. Live preview wizard nieuwe toets (sprint 25h)

**URL:** `/quiz-teacher.html`

### Wizard stappen
```
✅ 4 stappen zichtbaar: ① Basisinfo · ② Vragen · ③ Live preview · ④ Bevestigen
✅ Actieve stap blauw, voltooide stap groen
✅ Stap 1 → Stap 2: naam verplicht (pyAlert bij leeg)
✅ Stap 2 → Stap 3: minstens 1 vraag verplicht (pyAlert bij geen)
```

### Stap 3: Live preview
```
✅ Gele banner: "🔍 PREVIEW MODUS — antwoorden worden niet opgeslagen"
✅ Knoppen: "✎ Aanpassen ←" en "✅ Ziet er goed uit →"
✅ Vraagnavigator links: alle vragen als knoppen
✅ Actieve vraag: blauw gemarkeerd in navigator

Per vraagtype:
✅ Python code-vraag: donker code-blok zichtbaar + "▶ Uitvoeren (niet actief)" knop grijs
✅ Open vraag: textarea zichtbaar, invulbaar
✅ Single choice: radio-opties klikbaar (zonder opslag)
✅ Meerkeuze: checkbox-opties klikbaar
✅ Code-opties: donker code-blok correct getoond
✅ Info-kaders in vraagstelling: groen/oranje/blauw/paars gerenderd
✅ Tabellen in vraagstelling: correct getoond

Navigatie in preview:
✅ "← Vorige" / "Volgende →" knoppen per vraag
✅ Klik vraagnummer in navigator → navigeert direct
✅ Laatste vraag: "Laatste vraag" tekst i.p.v. Volgende

Random volgorde:
✅ "🔀 Andere volgorde" knop zichtbaar bij random modus
✅ Klik → vragen in andere volgorde geschud
✅ Vaste volgorde: knop niet zichtbaar

✅ "✎ Aanpassen ←" → terug naar stap 2, selectie bewaard
✅ "✅ Ziet er goed uit →" → gaat naar stap 4 (bevestigen)
```

### Stap 4: Bevestigen (was stap 3)
```
✅ Samenvatting: naam, timer, volgorde, vragen, schooljaar, klas
✅ "← Terug naar preview" → terug naar stap 3
✅ "✅ Toets aanmaken" → toets aangemaakt, redirect naar sessies
```

---

## 28. Rendering info-kaders bij leerling en verbeteren (sprint 25e)

### quiz-student.html
```
✅ Vraag met :::tip → groen kader zichtbaar voor leerling
✅ Vraag met :::opgelet → oranje kader
✅ Vraag met :::kader → blauw kader
✅ Vraag met :::hint → paars kader
✅ Tabel in vraagstelling → HTML tabel gerenderd
✅ Kleurmarkeringen (<span style="color:...">) → tekst in kleur
```

### quiz-review.html
```
✅ Zelfde rendering als leerling
✅ Info-kaders zichtbaar bij verbetermodule
✅ Tekst niet afgekapt op 80 karakters (volledig gerenderd)
```

## 29. Versie-automatisering (sprint 29)

**Doel:** verifiëren dat het VERSION-bestand correct doorwerkt.

### VERSION-bestand
```
✅ VERSION-bestand aanwezig in project-root met formaat 2026.2.29.0
✅ Server-log toont bij opstart: "[versie] Geladen uit ... : 2026.2.29.0"
✅ /api/version geeft exact het nummer uit VERSION terug
✅ VERSION wijzigen + web herstarten → /api/version toont nieuw nummer (zonder rebuild)
```

### sync-version.sh
```bash
bash scripts/general/sync-version.sh 2026.2.40.0
# ✅ VERSION-bestand bevat nu 2026.2.40.0
# ✅ .env APP_VERSION* velden bijgewerkt
# ✅ Alle HTML app.js?v= strings tonen v2026.2.34.3
# ✅ Ongeldige versie (bv. "abc") → foutmelding, geen wijziging
```

### pycodeflow.sh integratie
```
✅ Optie 1 (versie instellen) → roept sync-version.sh aan, werkt alles bij
✅ Optie 5 (rebuild) → detecteert VERSION≠.env en synchroniseert automatisch
```

## 30. Sprint 29 bugfixes

### 29a — teacher-grid leerlingenoverzicht
```
✅ Open sessie als leerkracht, leerling meldt zich aan
✅ Klik "⊞ Overzicht" → nieuw tabblad opent met correcte ?code=XXXXXXXX (niet leeg)
✅ Leerlingenoverzicht toont de aangemelde leerling(en) — niet blijvend "Verbinden..."
✅ Direct openen van teacher-grid.html zonder ?code= → valt terug op localStorage (JSON-parsed)
```

### 29b — tooltip
```
✅ Hover over ✕ knop bij geselecteerde vraag (nieuwe toets, stap 2) → tooltip "Vraag uit selectie verwijderen"
```

### 29c — logging
```
✅ Geen enkele lege catch{} in de codebase (check-deployment sectie 8 controleert dit)
✅ Bij een API-fout verschijnt een [prefix] waarschuwing in de browser-console
```

## 31. Sprint 29_part2 bugfixes

### 29p2-a — Editor-config live update
```
✅ Klasmodus, leerkrachtscherm: wijzig een hulp-instelling (auto-indent) → editor past DIRECT aan
✅ Individuele modus: idem, geen vertraging, geen extra trigger nodig
✅ Leerling ziet de wijziging ook meteen (session_config_update)
✅ Bij (her)openen sessie: config-toggles staan correct volgens opgeslagen sessie-config
```

### 29p2-b — Vragenbank-knoppen
```
✅ Vragenbank openen → alle knoppen reageren (Nieuwe vraag, tabs, toolbar, opslaan)
✅ Vraag toevoegen/bewerken/verwijderen werkt
✅ Ook als een vraag niet laadt: knoppen blijven werken (exports vóór init)
```

### 29p2-c — Layout nieuwe toets
```
✅ "Nieuwe toets" → Timer/Vraagvolgorde tonen als nette keuze-kaarten
✅ "aanbevolen" badge correct naast "Random per leerling"
✅ Tijdslimiet-invoerveld netjes uitgelijnd met "minuten"
✅ Smal scherm (<600px): kaarten stapelen verticaal
```

### 29p2-d — Login na rebuild
```
✅ Serverlog toont bij lege DB een kader met de exacte inlognaam
✅ Serverlog toont bij bestaande leerkrachten de inlognaam/-namen
✅ pycodeflow.sh optie 19k toont leerkrachten + reset wachtwoord in één flow
✅ Na reset: inloggen met de getoonde inlognaam werkt gegarandeerd
```

## 32. Geautomatiseerd testen (sprint 34)

### Testsuite draaien
```bash
# Volledige CI (aanbevolen vóór elke deploy):
bash scripts/general/run-tests.sh

# Enkel de unit tests:
cd web && node --test

# Enkel de sandbox-tests:
cd runner && python3 -m unittest test_sandbox

# Of via het menu:
pycodeflow.sh → optie 20
```

### Wat wordt getest
```
✅ lib/auth.js       — 17 tests: hash/verify, timing-safe, header-parsing
✅ lib/scoring.js    — 16 tests: single/meerkeuze auto-scoring, pro-rata, randgevallen
✅ lib/validation.js — 12 tests: sessiecode, config-whitelist, clamp, rollen
✅ runner sandbox    — 12 tests: verboden imports geblokkeerd, toegestane werken
✅ syntax            — alle server-JS + inline HTML-scripts (vm.Script)
```

### CI-integratie
```
✅ run-tests.sh geeft exit-code ≠0 bij falen → deploy blokkeert
✅ pycodeflow.sh optie 5 (rebuild) draait tests eerst, vraagt bevestiging bij falen
✅ GitHub Actions (.github/workflows/ci.yml) draait bij elke push
✅ check-deployment.sh sectie 14 verifieert dat de testbasis aanwezig is + draait unit tests
```

### Regressietest voorbeeld
```
✅ Introduceer opzettelijk een syntaxfout in app.js → run-tests.sh faalt meteen
✅ Wijzig auto-scoring logica verkeerd → scoring.test.js vangt het
✅ Voeg een verboden module toe aan een toegelaten lijst → sandbox test faalt
```

## 33. Sessie-instellingen Toepassen-knop (sprint 30-cfg)

### Gedrag
```
✅ Open Sessie-instellingen → vink een instelling aan/uit → status toont "Niet-opgeslagen wijzigingen"
✅ Klik Toepassen → editor past DIRECT aan (leerkracht + alle leerlingen), status toont "✓ Toegepast"
✅ Geen off-by-one meer: elke wijziging werkt onmiddellijk na Toepassen (niet pas bij volgende checkbox)
✅ Meerdere wijzigingen tegelijk → in één keer toegepast
```

### Server-validatie
```
✅ teacher_apply_session_config accepteert enkel whitelist-sleutels met booleanwaarden
✅ Onbekende sleutels (evilKey, __proto__) worden genegeerd
✅ Niet-boolean waarden worden genegeerd
✅ Niet-gewijzigde sleutels behouden hun waarde
```

### Unit tests
```
cd web && node --test
✅ tests/validation.test.js — 9 config-tests (whitelist, booleans, behoud, leeg)
```

## 33. Sprint 30 — config-toepassen + contextuele kopieerknop

### 30-cfg — Sessie-instellingen "Toepassen"-knop
```
✅ Vink een instelling aan/uit → editor verandert NIET meteen (dirty-staat)
✅ Statusregel toont "Niet-opgeslagen wijzigingen"
✅ Klik "Toepassen" → alle wijzigingen meteen actief op leerkracht-editor
✅ Leerlingen krijgen de nieuwe config live (session_config_update)
✅ Statusregel toont kort "✓ Toegepast"
✅ Auto-indent werkt nu ONMIDDELLIJK — geen off-by-one meer
✅ Ongeldige config-sleutel via socket → server weigert (whitelist)
```

### 30-copy — Contextuele kopieerknop
```
✅ Code zichtbaar → knop kopieert de code (tooltip "Kopieer code")
✅ Output zichtbaar → knop kopieert de output (tooltip "Kopieer output")
✅ Werkt in klasmodus (gedeeld), individuele modus, student en vrije editor
✅ Tooltip verandert mee bij tabwissel
✅ Geen zwevende knop meer over het output-paneel
✅ "✓ Gekopieerd!" feedback na klikken
```

## 34. Sprint 30 — Security hardening

### 30a — Login-cookie Max-Age
```
✅ Log in als leerkracht → cookie heeft Max-Age (standaard 8u)
✅ Browser sluiten en heropenen binnen 8u → nog ingelogd
✅ POC_SESSION_MAX_AGE_HOURS=0 → sessiecookie (oud gedrag)
✅ Cookie behoudt HttpOnly, SameSite=Strict, Secure
```

### 30c — CSP upgrade-insecure-requests
```
✅ Response-header Content-Security-Policy bevat "upgrade-insecure-requests"
✅ Geen unsafe-eval; frame-ancestors 'none' behouden
```

### 30d — Automatische DB-backup
```
✅ scripts/general/backup-db.sh bestaat en is uitvoerbaar
✅ bash scripts/general/backup-db.sh → maakt backups/pycodeflow-<timestamp>.sql.gz
✅ Lege/mislukte dump wordt gedetecteerd en verwijderd
✅ Backups ouder dan BACKUP_RETENTION_DAYS (7d) worden opgeruimd
✅ pycodeflow.sh optie 16 → 2: cronjob dagelijks 02:00
✅ pycodeflow.sh optie 16 → 3: restore werkt (met PGPASSWORD)
```

## 35. Sprint 36 — Data-integriteit

### Kritieke hash-fix (admin teacher-beheer)
```
✅ admin.html → nieuwe leerkracht aanmaken werkt (was: crash door salt undefined)
✅ admin.html → wachtwoord van leerkracht wijzigen werkt
✅ De nieuw aangemaakte leerkracht kan inloggen (hash-formaat consistent)
✅ pycodeflow.sh reset-password blijft compatibel (zelfde scrypt-formaat)
```

### 36a — Transacties
```
✅ Toets aanmaken → quiz_meta + alle vraag-snapshots atomair
✅ Bij een gesimuleerde fout tijdens aanmaken → ROLLBACK, geen halve toets
✅ Per-leerling vraagvolgorde (saveQuizStudentOrder) atomair
✅ withTransaction geeft client altijd vrij (ook bij fout)
```

### 36c — Centrale validatie
```
✅ Ongeldige rol bij teacher-create/role-update → geweigerd (lib/validation.js)
✅ Te lange displayName wordt geclampt tot 64 tekens
```

### 36d — Dependencies gepind
```
✅ package.json: geen ^caret meer, exacte versies
✅ npm audit draait in run-tests.sh (sectie 5)
```

## 36. Sprint 31 — UX & consistentie

### 31b — localStorage prefix + migratie
```
✅ Nieuwe installatie: alle sleutels krijgen pycodeflow_ prefix
✅ Upgrade van oude versie: bestaande sessie/naam blijft behouden (migratie)
✅ Leerkracht ingelogd vóór upgrade → nog steeds ingelogd na upgrade
✅ Geen dubbele pycodeflow_pycodeflow_ prefix
```

### 31a — Loading states
```
✅ .spinner toont een draaiende indicator
✅ loadingHtml('...') geeft consistente laad-weergave
```

### 31c — Uniforme foutmeldingen
```
✅ Geen enkele browser alert()/confirm() meer in app.js
✅ Fouten tonen via pyAlert (blokkerend, rood)
✅ Successen via pyToast (niet-blokkerend)
✅ Bevestigingen (sessie sluiten) via pyConfirm
```

## 37. Sprint 32 — Technische schuld

### 32b — Logger
```
✅ Server-logs tonen [tijdstempel NIVEAU] prefix
✅ LOG_LEVEL=info (standaard) → geen debug-ruis
✅ LOG_LEVEL=debug → uitgebreide logs zichtbaar
✅ LOG_LEVEL=error → enkel fouten
✅ Bootstrap-kader (admin-account) blijft netjes leesbaar
```

### 32a — Inline scripts geëxtraheerd
```
✅ Alle 8 pagina's laden hun .js via <script src>
✅ Geen inline <script> blokken meer in die pagina's
✅ onclick-handlers werken nog (functies globaal)
✅ Laadvolgorde correct: marked/DOMPurify/socket.io/Monaco vóór pagina-script
✅ quiz-review.html laadt nu socket.io.js (was ontbrekend)
✅ CI syntax-checkt alle geëxtraheerde .js bestanden
```

### 32c — Monaco
```
✅ Monaco-versie enkel in package.json (0.47.0)
✅ Geen los versienummer in HTML
```

## 38. Sprint 30b-A — CSP-hardening (tijdelijk)

```
✅ Geen inline <script> blokken meer in enige HTML-pagina
✅ teacher-login.html laadt teacher-login.js extern
✅ Response bevat Content-Security-Policy-Report-Only header (strikt, geen unsafe-inline)
✅ App werkt normaal (handhavende CSP houdt unsafe-inline tijdelijk)
✅ Browserconsole toont CSP-Report-Only violations (input voor Optie C)
```

**Handmatige a11y/CSP-verificatie:** open de browserconsole (F12) op elke pagina en
noteer de "Content-Security-Policy-Report-Only" waarschuwingen — dit is de checklist
voor sprint 30b-vol (Optie C).

## 39. Sprint 33 — Nice-to-haves

### 33e — Toets dupliceren
```
✅ Dupliceer-knop maakt een kopie met "(kopie)" in de naam
✅ Meerkeuzevragen blijven meerkeuzevragen (question_type + choices bewaard)
✅ Alle instellingen (timer, randomize, ...) worden meegekopieerd
```

### 33d — Vraag-tags
```
✅ Tag-veld bij vraag toevoegen/bewerken (komma-gescheiden)
✅ Tags worden als chips op de vraagkaart getoond
✅ Filter op tag werkt (deelstring, hoofdletterongevoelig)
✅ Bestaande vragen zonder tags blijven werken (migratie)
```

### 33a — Excel-export (CSV)
```
✅ Export-menu → optie 8 → CSV download
✅ Opent direct in Excel met correcte kolommen (accenten kloppen door BOM)
✅ Eén rij per leerling, kolom per vraag, totaal-kolom
✅ Niet-beoordeelde vragen → lege cel
✅ Puntkomma/quotes in namen correct ge-escaped
```

### 33b — Voortgangsgrafiek
```
✅ Staafgrafiek verschijnt bij selecteren van een leerling
✅ Groen=volledig, oranje=deels, rood=nul, grijs=onbeoordeeld
✅ Score per vraag afleesbaar boven de vraag-details
```

## 40. Sprint 37d — Nakijk-modus + toegangscontrole

### Leerkracht
```
✅ Verbetermodule toont knop "👁 Nakijken: uit"
✅ Klikken → bevestigingsdialoog → knop wordt "👁 Nakijken: aan"
✅ Toast toont de toetscode die leerlingen moeten gebruiken
✅ Opnieuw klikken → nakijken gesloten
✅ Status blijft behouden na herladen (komt uit meta.review_mode)
```

### Leerling — nakijken open
```
✅ /quiz-student.html?code=XXX&nakijken=1 toont het nakijk-loginscherm
✅ Correcte naam + klas → "Welkom <naam>" (37a vult straks de resultaten)
✅ Werkt op een ANDER toestel (geen localStorage nodig)
✅ De gewone toetsflow (zonder ?nakijken=1) is ongewijzigd
```

### Leerling — toegang geweigerd
```
✅ Nakijken uit → "Nakijken is voor deze toets niet opengesteld" (403)
✅ Onbestaande toetscode → zelfde melding (verklapt niet welke codes bestaan)
✅ Onbekende naam → "Geen resultaten gevonden" (verklapt geen namen)
✅ Twee leerlingen met dezelfde naam+klas → "Vraag je leerkracht om hulp" (409)
✅ Meer dan 10 pogingen per minuut → "Te veel pogingen" (429)
```

### Token
```
✅ Token verloopt na 2 uur → "Je nakijk-sessie is verlopen"
✅ Token van toets A werkt niet op toets B
✅ Gemanipuleerd token wordt geweigerd (HMAC)
```

⚠️ **Let op bij testen:** een sessie *verwijderen* wist de nakijk-data (cascade).
Archiveren behoudt ze.

## 41. Sprint 37a — Leerling-nakijkscherm

### Weergave
```
✅ Na inloggen verschijnt "👁 Jouw toets" met naam en totaalscore
✅ Percentage klopt (totaal / maxtotaal)
✅ Staafgrafiek toont score per vraag (groen/oranje/rood/grijs)
✅ Per vraag: vraagtekst (markdown) + jouw antwoord
✅ Code-vraag → eigen code in een codeblok
✅ Meerkeuze → eigen keuze gemarkeerd met "◉ ... jouw keuze"
✅ Overgeslagen vraag → "Je hebt deze vraag niet ingevuld."
✅ Nog niet alles verbeterd → waarschuwing dat de score kan wijzigen
```

### 🔒 Lekpreventie (belangrijk!)
```
✅ De leerling ziet NIET welke optie juist was (komt pas in 37b)
✅ Netwerk-tabblad: de JSON van /my-result bevat nergens "correct"
✅ Score 0 telt als beoordeeld; niet-beoordeeld telt niet mee in het totaal
```

### Toegang
```
✅ Zonder geldig token → 403 (nakijk-token uit 37d vereist)
✅ Nakijk-modus uit → 403, ook met geldig token
✅ Verlopen token → "Je nakijk-sessie is verlopen"
```

## 42. Sprint 37b — Juiste antwoorden + modelcode

### Modelcode invoeren (leerkracht)
```
✅ Vragenbank: veld "Modelantwoord / modelcode" bij toevoegen/bewerken
✅ Verbetermodule: inklapbaar modelantwoord-veld per vraag met opslagknop
✅ Badge toont "(ingevuld)" of "(nog leeg)"
✅ Opgeslagen modelcode blijft na herladen
```

### Weergave bij het nakijken (leerling)
```
✅ Meerkeuze: juiste optie groen ✓, fout gekozen optie rood ✗
✅ Labels "jouw keuze" en "juist" verschijnen correct
✅ Code/open: modelantwoord in groen blok (indien ingevuld)
✅ Leeg modelantwoord → geen blok
```

### 🔒 Lek-grens (belangrijk!)
```
✅ Tijdens de toets lekken juiste antwoorden NIET (my-result vereist nakijk-token)
✅ Modelcode verschijnt enkel bij onthulling, niet tijdens de toets
```

### Duplicatie (regressietest)
```
✅ Toets dupliceren behoudt de modelcode
✅ Toets aanmaken uit bank: meerkeuze blijft meerkeuze (was stille bug)
✅ Modelcode komt correct in de snapshot terecht
```

## 43. Sprint 37c — Commentaar zichtbaar voor leerling

### Weergave
```
✅ Commentaar per vraag → blauw blok onder het antwoord (indien ingevuld)
✅ Algemeen commentaar → blauw blok bovenaan (indien ingevuld)
✅ Markdown werkt (code-blokjes, opmaak)
✅ Leeg commentaar → geen blok
```

### 🔒 Lek-grens
```
✅ Commentaar lekt NIET tijdens de toets (enkel bij onthulling)
✅ Zowel per-vraag als algemeen commentaar volgen de nakijk-grens
```

### Sprint 37 volledig (end-to-end test)
```
✅ Leerkracht: nakijken openstellen, punten + commentaar + modelcode invoeren
✅ Leerling: ?nakijken=1, inloggen met naam+klas
✅ Leerling ziet: score, juiste antwoorden, modelcode, commentaar, algemeen commentaar
✅ Werkt op een ander toestel dan waarop de toets gemaakt werd
✅ Niets zichtbaar zolang nakijken niet opengesteld is
```

## 44. Sprint 38 — Vraag dupliceren

```
✅ "⧉ Dupliceren"-knop op elke niet-gearchiveerde vraagkaart
✅ Kopie krijgt "(kopie)" achter de vraagtekst
✅ Alle velden mee: onderwerp, moeilijkheid, punten, tags, modelcode
✅ Bewerk-formulier opent meteen op de kopie
✅ Meerkeuze: opties behouden tekst + juist/fout, maar krijgen nieuwe id's
✅ Origineel blijft ongewijzigd
✅ Code-vraag blijft code-vraag (geen valse keuzes)
```

## 45. Sprint 40 — Leerling-lidmaatschap per schooljaar

### Verse installatie
```
✅ Schema maakt class_memberships aan; students heeft geen class_id meer
✅ Leerling aanmaken met klas → persoon + lidmaatschap ontstaan samen
✅ Admin-pagina toont leerlingen per klas (via lidmaatschap)
✅ Klas-overzicht toont juiste leerlingtelling per schooljaar
```

### Model-gedrag
```
✅ Leerling verplaatsen naar nieuwe klas → oude klas blijft in historiek
✅ Dezelfde leerling kan in twee schooljaren in verschillende klassen zitten
✅ Zelfde leerling niet dubbel in dezelfde klas+jaar (PK)
✅ CSV-import maakt personen + lidmaatschappen aan
```

⚠️ **Vereist een verse database** (of leeg volume). Geen migratie van bestaande
class_id-data — die komt pas bij fase 3.

## 46. Sprint 41 — Schooljaar-selector + read-only gearchiveerde jaren

### Selector
```
✅ Admin → Klassen: schooljaar-dropdown boven de lijst
✅ "Alle jaren" toont alles; een specifiek jaar filtert de klassen
✅ Volledig gearchiveerde jaren tonen een 🔒 in de dropdown
✅ Nieuwe klas in een nieuw jaar → dropdown ververst mee
```

### Read-only
```
✅ Gearchiveerd jaar geselecteerd → gele "alleen-lezen"-banner
✅ Actieknoppen vervangen door "🔒 alleen-lezen"
✅ Server weigert leerling toevoegen aan gearchiveerde klas (403)
✅ Server weigert leerling verplaatsen naar gearchiveerde klas (403)
✅ Bekijken en exporteren van oude jaren blijft mogelijk
```

## 47. Sprint 43 — Toetsen/taken scheiden van sessies

```
LEERKRACHT — Sessies vs Toetsen
✅ Maak een toets aan met een gekoppelde klas → verschijnt onder "Toetsen", NIET onder "Lopende sessies"
✅ "Lopende sessies" toont enkel echte codeersessies (geen toets/taak meer)
✅ Toetsen-tab: type-badge 🧪 Toets (met timer) of 📝 Taak (geen tijdslimiet)
✅ Toetsen-tab: status-badge 🟢 Open / ⏳ Nog niet open / ⛔ Venster voorbij / Gesloten
✅ Toetsen-tab: 👥-online-teller telt leerlingen die nu bezig zijn
✅ Toetsen-tab: 👁 Live opent teacher-grid.html?code=… in nieuw tabblad

LEERLING — juiste instap
✅ Leerling geeft een TOETS-code in op de deelnemen-pagina → belandt in de TOETS (niet in een gewone sessie-editor)
✅ Leerling met een gewone SESSIE-code → belandt zoals vroeger in de editor
```

## 48. Sprint 43.1 — Voortgang per klas-leerling

```
✅ Toets met gekoppelde klas → knop "👥 Voortgang" toont de klaslijst
✅ Leerling die niets deed → grijs (⚪ Nog niets)
✅ Leerling die bezig is (code/keuze/run, niet ingeleverd) → geel (🟡 Bezig)
✅ Leerling die inleverde → groen (🟢 Ingeleverd)
✅ Telling 🟢/🟡/⚪ bovenaan klopt met de chips
✅ Deelnemer met naam die niet in de klas zit → apart onder "Niet in de klas"
✅ Toets zonder gekoppelde klas → nette melding i.p.v. lege lijst
```

## 49. Sprint 44 — Dupliceren maakt exact één kopie

```
✅ Doe eerst een paar acties in het vragenoverzicht (bewerken/archiveren) om te her-renderen
✅ Klik daarna op "Dupliceren" → er verschijnt PRECIES ÉÉN kopie (niet meerdere)
✅ Herhaal na nog meer acties → nog steeds telkens één kopie
✅ Andere kaartknoppen (bewerken, verwijderen, herstellen) vuren ook één keer
```

## 50. Sprint 45 — Startpagina + instap-routes

```
✅ Open "/" → keuzepagina toont "Ben je leerling of leerkracht?"
✅ Footer toont de LIVE versie (klopt met /api/version), ook met JavaScript uit
✅ "Ik ben leerling" → /student → deelnemen-scherm werkt
✅ "Ik ben leerkracht" → /teacher → leerkracht-login/platform
✅ Oude links (/student-start.html, /teacher-sessions.html) blijven werken
✅ Vrije oefensessie blijft zonder account bereikbaar
```

## 51. Sprint 46 — Leerkracht-preview & toets-launch

```
✅ Toets aanmaken → stap "Live preview": keuze-opties netjes (selector links, tekst leesbaar ernaast, geen afgesneden tekst, ook bij lange opties/code)
✅ "Doen alsof je de toets maakt" → toets laadt door (geen eindeloze "Bezig met laden…")
✅ Bij een geweigerde start (bv. lege naam) → duidelijke foutmelding op het startscherm i.p.v. stil hangen
✅ Na ~10s zonder laden → nette time-out-melding
```

## 52. Sprint 47 — Vraag-editor & vraagweergave

```
✅ Toolbar: het blauwe kader heet nu "Extra informatie" (tooltip + gerenderd label 📌 Extra informatie)
✅ Bestaande vragen met :::kader tonen automatisch het nieuwe label
✅ Codeblok (```python) rendert als donker code-veld (monospace), niet als platte zwarte tekst
✅ In de editor kleurt het JUISTE keuze-antwoord GROEN (niet blauw)
✅ Nakijken: gekozen+juist groen, gekozen+fout rood, gemist+juist amber
```

## 53. Sprint 47.1 — Syntax highlighting + Tip/Hint

```
✅ Codeblok toont gekleurde tokens: keywords/builtins/strings/comments/getallen
✅ Consistent in editor-preview, leerkracht-preview én leerling-weergave
✅ Code met <, > of & rendert correct (geen kapotte weergave)
✅ Toolbar: Hint-knop is weg; "Tip" dekt nu advies én hulp
✅ Bestaande :::hint-vragen renderen nog steeds
✅ Automatische test: `cd web && npm test` → highlight.test.js slaagt (deel van 165 tests)
```

## 54. Sprint 47.4 — Toets zichtbaar + statistieken kloppen

```
✅ Maak een toets aan (checkbox "Test als leerkracht – PREVIEW" UIT) + enkele vragen
✅ Admin-dashboard → Quiz statistieken: "Vragen in bank" en "Toetsen ooit" tonen het echte aantal (niet 0)
✅ "Antwoorden totaal" en "Gem. runs/antwoord" tonen echte waarden (niet 0)
✅ Teacher → Toetsen-tab: de aangemaakte toets is zichtbaar
✅ Admin "Lopende sessies": een toets krijgt type "Toets" (een taak "Taak"), niet "Klas"
⚠️ Een toets die WÉL met de PREVIEW-checkbox is aangemaakt hoort NIET in de Toetsen-tab (preview blijft verborgen)
```

## 55. Sprint 43.2 — Toetsen-/takenbank

```
✅ Teacher → tab "Toetsen": toont álle toetsen/taken (ook oudere), niet enkel actieve sessies
✅ Filters werken: Klas, Type (toets/taak), Status (open/gesloten/preview), Schooljaar
✅ Een preview/onafgewerkte toets is nu zichtbaar met badge "👁 preview"
✅ 🗑 Verwijderen haalt een toets/taak uit de bank (bevestiging gevraagd)
✅ De eerder "zwevende" (onbereikbare) toets kan je nu terugvinden én verwijderen
✅ Verbeteren / Dupliceren / (Live + Voortgang bij niet-previews) werken per item
```

## 56. Sprint 43.2b — Bank vindbaar + status-groepen

```
✅ Nav-link "📚 Toetsen & taken" staat op elke leerkrachtpagina en opent de bank-tab
✅ Bank toont groepen: 🟢 Actief / 👁 Preview-onafgewerkt / ✅ Afgerond-te verbeteren
✅ Preview-item heeft knop "▶ Activeren" → wordt een echte toets (schuift naar Actief) en is startbaar
✅ Dupliceren vraagt de naam via een SCHERM-popup (niet de browser-prompt)
✅ Verwijderen vraagt bevestiging via scherm-popup
```

## 57. Sprint 43.6 — Leerling-login + sessie-tabs

```
✅ Leerling gaat naar landing → "Ik ben leerling" (/student), vult naam+klas+code in
✅ Knop "Deelnemen" WERKT (leerling komt in de sessie) — was stuk op /student
✅ Knop "Vrij oefenen" werkt
✅ Ook rechtstreeks /student-start.html blijft werken
✅ Sessie-overzicht heeft tabs: Sessies / Toetsen / Taken
✅ Toetsen-tab toont enkel actieve toetsen (geen preview); Taken-tab enkel actieve taken
✅ Volledige bank (incl. preview + activeren) blijft bereikbaar via nav "📚 Toetsen & taken"
```

## 58. Sprint 43.6c — Monaco web workers

```
✅ Open een pagina met code-editor (bv. leerling-toets of vrije editor) + F12-console
✅ Waarschuwing "Could not create web worker(s)" is WEG
✅ Editor voelt vlot aan (geen main-thread-fallback meer)
ℹ️ CSP report-only meldingen over inline styles zijn onschuldig (mogen blijven)
```

## 59. Sprint 43.5 + 43.7 — Rename + Toets/Taak overzicht

```
⚠️ MAAK EERST EEN DB-BACKUP vóór deploy (tabel-rename)
✅ Na deploy: app start normaal, geen "relation quiz_bank/quiz_meta does not exist" in de logs
✅ Bestaande toetsen/taken + vragen zijn nog aanwezig (data behouden na rename)
✅ Admin DB-viewer toont nu question_bank en assignment_bank (i.p.v. quiz_bank/quiz_meta)
✅ Nav: "Nieuwe toets" is weg; "🧪 Toets overzicht" en "📝 Taak overzicht" staan er
✅ "Toets overzicht" opent de bank met enkel toetsen; "Taak overzicht" met enkel taken
✅ Nieuwe toets/taak aanmaken kan nog via de "+ Nieuwe"-knop in het overzicht
```

## 60. Sprint 43.7b + 43.8 + 43.3 + 43.4

```
— Overzichtspagina's (43.7b) —
✅ Nav "🧪 Toets overzicht" opent een EIGEN pagina met titel "Toets overzicht" (niet "Lopende sessies")
✅ Nav "📝 Taak overzicht" idem met titel "Taak overzicht"
✅ Layout als de vragenbank: statistiek-chips, filterbalk, kaartenraster
✅ Filters werken: klas, status (Actief/Preview/Afgerond), schooljaar, zoeken op naam/code
✅ Sessiescherm: het zinnetje "Volledig overzicht & previews →" is weg

— Dupliceren (43.8) —
✅ Dupliceer een toets → vragenbank telt NIET meer vragen dan ervoor (geen dubbele vraagrecords)
✅ De kopie heeft dezelfde vragen, én de deadline/tijdsvenster is meegekopieerd

— Type + deadline (43.3) —
✅ Nieuwe toets zonder deadline → foutmelding "einddatum en uur is verplicht" (aanmaken lukt niet)
✅ Deadline vóór de startdatum → foutmelding
✅ Toets met timer verschijnt onder Toets overzicht; taak (geen tijdslimiet) onder Taak overzicht

— Leerling-selectie (43.4) —
✅ Zonder klas: knop "👥 Leerlingen" is uitgeschakeld ("Kies eerst een klas")
✅ Met klas: knop opent popup met alle leerlingen AANGEVINKT
✅ "Alles uit" / "Alles aan" werkt; teller toont "x van y"
✅ Annuleren wijzigt niets; Opslaan toont "x leerlingen geselecteerd"
✅ Alles aangevinkt + opslaan → info toont weer "Alle leerlingen van de klas"
✅ Leerling die NIET geselecteerd is → kan de toets niet starten (duidelijke melding)
✅ Leerling die WEL geselecteerd is → kan gewoon starten
```

## 61. Sprint 43.9 — Preview later doorlopen

```
✅ Maak een toets met de checkbox "Test als leerkracht – PREVIEW" AAN, klik de popup weg
✅ Ga naar "🧪 Toets overzicht" → de toets staat onder "👁 Preview / onafgewerkt"
✅ Kaart heeft knop "🧑‍🎓 Doorlopen" → opent de toets als leerling in een nieuw tabblad
✅ Doorlopen kan herhaald worden (ook later opnieuw)
✅ Ook mét een leerling-selectie (43.4) werkt Doorlopen — preview is vrijgesteld
✅ Leerlingen zien de preview NIET; pas na "▶ Activeren" is hij echt en startbaar
```

## 62. Sprint 43.10 — Toets-pagina's (scriptvolgorde)

```
✅ Open een toets als leerling (of preview via "🧑‍🎓 Doorlopen") + F12-console
✅ Klik "🚀 START TOETS" → de toets laadt écht (blijft NIET op "Toets laden…" hangen)
✅ Console: GEEN "io is not defined"
✅ Console: GEEN "Can only have one anonymous define call per script file"
✅ Console: GEEN "Cannot access '_startTimeout' before initialization"
✅ Console: GEEN geblokkeerde connect-src request naar cdnjs
✅ Code-editor in de toets werkt (Monaco laadt)
✅ Verbeterscherm (quiz-review) opent en toont vragen + codekleuring
ℹ️ CSP report-only meldingen over inline styles/handlers mogen blijven (onschuldig)
```

## 63. Sprint 43.11 + 43.12 — Toets: knoppen en layout

```
— Knoppen (43.11) —
✅ Open een toets (of preview via "Doorlopen") en start ze
✅ Knop "Run" voert de code uit en toont output
✅ Knop kopieer-code werkt
✅ Knoppen "Vorige" en "Volgende" werken
✅ Wisselen van vraag laadt de juiste code in de editor
✅ Eerder ingevulde code staat er nog bij terugkeren naar een vraag
✅ Console: GEEN "editorStore is not defined"

— Nakijkscherm (zelfde bug) —
✅ Verbeteren: de code van de leerling verschijnt WEL in de editor
✅ "Aanpassen & testen" maakt de editor bewerkbaar
✅ "Alleen lezen" zet hem terug op read-only
✅ "Herstel" zet de originele code terug
✅ Een run uit de geschiedenis laden werkt

— Layout: tabs (43.12) —
✅ De toets toont een tabbalk "Code | Output", net als een klassessie en vrij oefenen
✅ Tabs zien er identiek uit als in de sessie (zelfde stijl en plaats)
✅ Tab "Code" toont de editor; tab "Output" toont de uitvoer
✅ Klikken op "Run" springt automatisch naar de Output-tab
✅ Een nieuwe vraag start altijd op de Code-tab (niet op de output van de vorige vraag)
✅ De editor heeft de juiste breedte na het wisselen van tab of vraag (niet ingezakt)
✅ Op een Chromebook/smal scherm: geen horizontaal scrollen, geen gestapelde output
✅ Bij een meerkeuzevraag of open vraag verschijnt geen codeblok/tabbalk
```

## 64. Domeinregels per school (sprint 48a3) — 8 gevallen

```
Instelling: school heeft ALLEEN "athkiel.be"
✅ marie@athkiel.be              → toegelaten
✅ marie@leerling.athkiel.be     → GEWEIGERD (exact betekent exact)

Instelling: school heeft ALLEEN "*.athkiel.be"
✅ marie@leerling.athkiel.be     → toegelaten
✅ marie@a.b.athkiel.be          → toegelaten (alles eronder)
✅ marie@athkiel.be              → GEWEIGERD (kale domein zit niet in de wildcard)

Altijd geweigerd, ongeacht instelling
✅ marie@athkiel.be.aanvaller.com → GEWEIGERD (eindigt niet op .athkiel.be)
✅ marie@nepathkiel.be            → GEWEIGERD (punt vooraan telt)
✅ marie@ATHKIEL.BE               → toegelaten (hoofdletters genormaliseerd)

Adminveld
✅ Uitleg met ✓/✗-voorbeelden staat bij het veld
✅ Testveldje: plak een adres → toont toegelaten/geweigerd + via welke regel
✅ "*athkiel.be" (zonder punt) → melding over de juiste vorm
✅ "*.be" → geweigerd als te breed
✅ Laatste domein verwijderen → "Elke school heeft minstens 1 domein nodig"
✅ Dubbel domein → "Dit domein staat er al"
```

## 65. Leerling-instap zonder e-mail (sprints 52a-52i)

```
— Klascode (52b) — in admin.html → klasbeheer, kolom "Startcode" —
✅ Elke klas toont haar startcode groot leesbaar (voor op het bord) + 🟢 open / ⚪ dicht
✅ Knop ↻ geeft een andere code (oude code werkt daarna niet meer)
✅ "Sluiten" → registratie met die code geweigerd
✅ "Openen" → registratie lukt weer
✅ Leerkracht A kan de code van een klas van B NIET roteren (403)

— Zelfregistratie (52c) — student-register.html (link op student-start.html) —
✅ Leerling registreert met klascode + VOORNAAM + ACHTERNAAM + school-e-mail + wachtwoord (2×)
✅ Lege voornaam of achternaam → geweigerd
✅ Account hangt automatisch aan de JUISTE klas (die van de code)
✅ Nieuwe leerling krijgt status "pending"
✅ Adres buiten het schooldomein → geweigerd ("Gebruik je school-e-mailadres.")
ℹ️ Zolang er GEEN schooldomeinen geconfigureerd zijn wordt de domeincheck overgeslagen
   (test-/beginfase) — configureer eerst een domein om dit geval te testen
✅ Dubbel adres → geweigerd
✅ Foute/onbekende klascode → geweigerd
✅ Wachtwoorden verschillen → melding

— Login (52d) — student-login.html; aparte leerling-sessie (student_sid-cookie) —
✅ E-mail + wachtwoord werkt
✅ Fout wachtwoord → duidelijke melding
✅ Herhaald falen → tijdelijk geblokkeerd (rate-limiting, Retry-After)
✅ Geblokkeerd account → "Je account is geblokkeerd. Vraag je leerkracht om hulp."
✅ must_change_password → de pagina toont meteen de stap "Nieuw wachtwoord"
✅ Leerling-cookie geeft NOOIT toegang tot leerkracht-API's (en omgekeerd)

— TOEGANGSREGEL (52e) — de kern —
✅ PENDING leerling kan deelnemen aan een KLASSESSIE
✅ PENDING leerling kan VRIJ OEFENEN
✅ PENDING leerling wordt GEWEIGERD bij een toets, met duidelijke melding
✅ PENDING leerling wordt GEWEIGERD bij een taak
✅ Na aanvaarden door de leerkracht → toets en taak werken WEL
✅ GEBLOKKEERDE leerling kan niets (ook geen klassessie)
✅ De les valt nooit stil door een nog niet aanvaarde leerling

— Namen op toetsen/taken (52a + 52h) —
✅ Toets, taak, voortgang, nakijken en export tonen "Voornaam Achternaam"
✅ NERGENS op een toets/taak/export staat een e-mailadres
✅ Bestaande leerlingen behouden hun naam na de migratie
✅ Leerkracht corrigeert een verkeerd getypte voornaam → toets toont meteen de nieuwe naam
✅ Leerkracht corrigeert een e-mailadres → leerling logt in met het nieuwe adres, resultaten blijven

— Aanvaarden en beheer (52h) —
✅ Pending leerling verschijnt met badge in het sessiescherm (bestond al)
✅ Leerkracht kan aanvaarden vanuit het sessiescherm (bestond al)
✅ Leerkracht kan aanvaarden vanuit het leerlingenscherm (NIEUW — ook zonder live sessie)
✅ E-mailadres is zichtbaar in de BEHEERlijst (NIEUW) — enkel daar, niet op toetsen
✅ Voornaam, achternaam en e-mail zijn bewerkbaar door de leerkracht (NIEUW)
✅ Leerling van klas veranderen werkt
✅ Leerling verwijderen werkt
✅ Leerling blokkeren werkt

— Koppeling op id (52i) — geldt voor INGELOGDE leerlingen —
✅ Ingelogde leerling start toets → deelname onder zijn échte students.id
✅ Server herstarten midden in de toets → herverbinden: antwoorden én vraagvolgorde terug
✅ Twee leerlingen met dezelfde naam: voortgang (43.1) en selectie (43.4) blijven correct
✅ Leerling-selectie (43.4) toetst een ingelogd account op id, een gast op naam
✅ Gast (niet ingelogd) hervat zijn toets ondubbelzinnig op naam+klas

— Herstel (52f) — 🔑 Reset in het leerlingbeheer + student-recover.html —
✅ Leerkracht klikt 🔑 Reset → badge "reset" verschijnt bij de leerling
✅ Leerling herstelt via "Wachtwoord vergeten" met KLAS-startcode + e-mail + nieuw ww (2×)
✅ Herstel ZONDER voorafgaande reset → geweigerd met bewust vage melding
   (zo kan een klasgenoot met de klascode nooit andermans wachtwoord overnemen)
✅ Na herstel: inloggen met het nieuwe wachtwoord werkt, het oude niet meer
✅ Alternatief pad: na reset inloggen met het OUDE wachtwoord kan nog één keer,
   maar dwingt meteen een nieuwe wachtwoordkeuze af
✅ Geblokkeerd account kan nooit herstellen

— Na login (52g) — student-start.html is login-bewust —
✅ Ingelogd: banner "Ingelogd als … — aanvaard/nog niet aanvaard" + uitlog-link
✅ Naam is vooringevuld vanuit het account
✅ Bij pending: uitleg dat toets/taak pas na aanvaarding kan
✅ Sessiecode → juiste sessie/toets/taak · "Vrij oefenen" werkt
✅ Uitloggen → banner weg, gewone (naam-gebaseerde) instap werkt nog

ℹ️ Er wordt GEEN e-mail verstuurd. Verifieer dat nergens een mailscherm of
   "controleer je inbox"-melding opduikt.
⚠️ BEWUST RISICO: zolang er geen e-mailverificatie is, kan een klasgenoot zich
   registreren met andermans schooladres. De echte eigenaar krijgt dan "adres al
   in gebruik" en meldt dat — leerkracht verwijdert het valse account.
```

## 66. Leerkracht-login + schoolkeuze (sprints 48b1-48b2)

```
✅ Leerkracht met 1 school → logt meteen in, geen keuzescherm
✅ Leerkracht met 2+ scholen → keuzegrid met dropdown van ZIJN scholen
✅ Logingegevens worden grijs; knoppen zijn "Annuleren" en "Kiezen"
✅ De schoollijst verschijnt PAS na een geslaagde login (niet ervoor)
✅ "Annuleren" → schoon loginscherm, niet half-ingelogd
✅ "Kiezen" → juiste school actief
✅ Schoollogo verschijnt naast het PyCodeFlow-icoon
✅ Start- en loginscherm tonen GEEN schoollogo (nog geen school bekend)
✅ Wisselen van school wisselt het logo mee
```

## 67. Fase 1 — login per leerkracht (sprints 50a-50f)

```
✅ Twee leerkrachten krijgen VERSCHILLENDE tokens
✅ Token van A geeft nooit toegang tot de identiteit van B
✅ Afmelden → hetzelfde token geeft 401
✅ Verlopen sessie → 401 + terug naar login
✅ Audit-log toont de ECHTE leerkracht (niet de gedeelde gebruiker)
✅ Na 50f: oude gedeelde cookie geeft 401
```

## 68. Fase 2 — eigenaarschap (sprints 51a-51e)

```
✅ Nieuwe sessie krijgt de juiste eigenaar
✅ Leerkracht A kan sessie van B niet openen/sluiten/verwijderen (403)
✅ Admin kan alles binnen de eigen school
✅ Vragenbank: A ziet privé-vraag van B NIET
✅ Gedeelde vraag (scope school/publiek) is wel zichtbaar — zie hoofdstuk 69 (Bibliotheek)
✅ A kan een vraag van B niet bewerken/archiveren/verwijderen (403)
✅ GEWONE sessies (les/examen): enkel de MAKER ziet ze in het overzicht (51d)
   — géén admin-uitzondering en géén legacy-uitzondering (bewust strenger)

— Klassen (51e) —
✅ Maker van een nieuwe klas wordt automatisch gekoppeld (verschijnt in zijn overzicht)
✅ Leerkracht ziet enkel eigen (gekoppelde) klassen + nog NIET-toegewezen klassen
✅ Admin ziet alle klassen (klasbeheer is een admintaak)
✅ De leerling-dropdown (/api/classes) blijft ONgefilterd — leerling kiest altijd zijn klas
```

## 69. Bibliotheek — delen van vragen & sjablonen (51c) + admin-takedown (53d)

> Het oude 53a-53c-plan (is_template op assignment_bank, visibility owner/school/public)
> is VERVANGEN door de Bibliotheek van 51c: aparte tabellen `assignment_templates` +
> `template_questions`, en een `share_scope` op vragen. Test dus onderstaand gedrag.

```
— 📚 Bibliotheek-pagina (sjablonen.html; nav-item op alle leerkrachtpagina's) —
✅ Tabs Toetsen / Taken / Vragen, secties "school" en "publiek"
✅ Vraag delen: scope privé → school → publiek via de vragenbank (quiz-bank)
✅ "Bewaar als sjabloon" op een toets/taak (assignment-overview) maakt een sjabloon
✅ Sjabloon van een collega "materialiseren" → wordt een EIGEN sessie (kopie, los origineel)
✅ Enkel de eigenaar bewerkt/verwijdert zijn sjabloon; een ander krijgt 403
✅ Gedupliceerde vraag ("kopieer naar eigen bank") staat los van het origineel

— Integriteitsregels (verwacht 409 met duidelijke melding) —
✅ Vraag koppelen aan een sjabloon dat BREDER gedeeld is dan de vraag → geweigerd
✅ Sjabloon-scope verbreden terwijl een gekoppelde vraag dat niet toelaat → geweigerd
✅ Scope verkleinen of vraag verwijderen terwijl ze aan een sjabloon hangt → geweigerd

— Admin-takedown (53d) —
✅ Admin (of super-admin) ziet per kaart 🚫 Verbergen / 👁 Zichtbaar maken
✅ Verborgen item verdwijnt METEEN uit de Bibliotheek bij andere leerkrachten/scholen
✅ De EIGENAAR ziet zijn item nog (met 🚫 Verborgen-badge); een admin ook (kan terugzetten)
✅ De eigenaar kan een verborgen item NIET zelf weer zichtbaar maken (ook niet via scope)
✅ Gewone leerkracht heeft geen verberg-knop; rechtstreekse API-call → 403
✅ Takedown verschijnt in het audit-log
```

## 70. Fase 3 — schoolisolatie + super-admin (sprints 48c1-48c4)

> As-built: scoping in de APPLICATIELAAG (één regel `magRijVanSchoolZien` + identieke
> SQL-spiegel), niet via RLS (kan later als extra verdediging). Een geautomatiseerde
> isolatiesuite bestaat: `DATABASE_URL=… node --test tests/isolatie.test.js` (8 tests
> tegen een echte PostgreSQL; skipt zichzelf zonder DATABASE_URL). Onderstaande
> handmatige ronde bevestigt hetzelfde door de UI. Tip: seed eerst (optie 21).

```
— 48c1: schema + migratie —
✅ GET /api/admin/fase3/dekking (als admin): toont standaardSchoolId + tellers
✅ Op een single-school install: alle "zonderSchool"-tellers = 0 na de migratie
✅ Bij 2+ scholen: standaardSchoolId = null (bewust — er wordt niet gegokt)
✅ School verwijderen vernietigt GEEN data (rijen worden school-loos, ON DELETE SET NULL)

— 48c2: scoping (log in als leerkrachtA, actieve school A) —
✅ Nieuwe klas/vraag/toets/taak/klassessie krijgt automatisch school A mee
✅ Nieuwe leerling erft de school van zijn KLAS (niet van de leerkracht)
✅ Klassenlijst, leerlingenlijst, vragenbank, sessielijst, audit-log:
   NUL rijen van school B zichtbaar
✅ School-loze (legacy) rijen blijven WEL zichtbaar — die breken nooit
✅ De Bibliotheek is de ENIGE plek waar publiek werk van school B zichtbaar is
✅ Ook een gewone ADMIN volgt zijn actieve school (alziend = enkel super-admin)

— 48c3: isolatie hard maken —
✅ tests/isolatie.test.js draait groen tegen een lege testdatabank (8/8)
✅ URL-manipulatie (code/id van een andere school raden) → 403/404, geen data

— 48c4: super-admin —
✅ Rol-cyclus in leerkrachtenbeheer: leerkracht → admin → super-admin (paarse ★-badge)
✅ Eerste super-admin: een admin mag hem aanstellen (bootstrap)
✅ Daarna: ENKEL een super-admin kan de rol toekennen of afnemen (anders 403)
✅ Gewone leerkracht kan geen rollen wijzigen (403)
✅ Ingelogd als super-admin: klassen/leerlingen/vragen van ALLE scholen zichtbaar
✅ Super-admin kan cross-school een Bibliotheek-item verbergen (53d)
```

## 71. Sprint 50a — Sessietabel + sessie bij login

```
⚠️ VOORAF: log in met een ECHTE leerkracht (uit de databank), niet met de
   .env-fallback (POC_BASIC_USER). Die laatste heeft geen leerkracht-rij en
   krijgt dus bewust géén sessie. Aanmaken kan met pycodeflow.sh → optie 10.

— Niets mag stuk zijn (dit is een additieve sprint) —
✅ Inloggen werkt precies zoals vroeger
✅ Alle leerkracht-schermen blijven werken (sessies, vragenbank, beheer)
✅ Weblogs tonen geen ERROR bij het opstarten
✅ Inloggen met een FOUT wachtwoord → nog steeds geweigerd
✅ Te veel pogingen → nog steeds tijdelijk geblokkeerd

— De nieuwe sessie —
✅ Beheer → Database viewer: de tabel "teacher_sessions" bestaat
✅ Na inloggen staat er een NIEUWE rij in teacher_sessions
✅ De rij toont teacher_id, created_at, expires_at, user_agent en ip
✅ token_hash is GEMASKEERD in de viewer (geen leesbare waarde)
✅ Tweede keer inloggen (ander toestel/browser) → een TWEEDE rij, geen overschrijving
✅ Weblog toont "[auth] sessie aangemaakt voor <naam>"

— De cookies (F12 → Application → Cookies) —
✅ Er staan er DRIE: teacher_auth, teacher_sid en csrf_token
✅ teacher_sid is een lange willekeurige waarde
✅ teacher_sid verschilt per login (niet telkens dezelfde)
✅ teacher_sid is HttpOnly

— Fail-safe —
ℹ️ Log je in via de .env-fallback: login werkt, maar er komt GEEN rij bij.
   De weblog zegt dan: "login via .env-fallback — geen sessie aangemaakt".
   Dat is bedoeld gedrag tot sprint 50f.
```

## 72. Sprint 50b — De app weet wie je bent

```
⚠️ Maak eerst TWEE echte leerkrachten aan (pycodeflow.sh → optie 10).
   Bv. "anja" en "bram". De .env-fallback heeft geen identiteit.

— Niets mag stuk zijn (additieve sprint) —
✅ Inloggen werkt zoals vroeger
✅ Alle leerkracht-schermen werken (sessies, vragenbank, toetsen, beheer, systeem)
✅ Uitloggen en opnieuw inloggen werkt
✅ Zonder login → nog steeds doorgestuurd naar het loginscherm
✅ Weblogs tonen geen ERROR

— KERNTEST: twee leerkrachten, twee identiteiten —
✅ Browser 1: log in als "anja" → open /api/me → toont username "anja"
✅ Browser 2 (of incognito): log in als "bram" → /api/me → toont username "bram"
✅ De twee tonen VERSCHILLENDE namen (dit kon vroeger niet)
✅ Beide tonen "source": "session" en "identiteitBekend": true
✅ De rol klopt per leerkracht (teacher of admin)

— De oude weg blijft werken (tot 50f) —
✅ Heb je nog een oude browsersessie (enkel teacher_auth, geen teacher_sid)?
   Dan werkt alles nog, maar /api/me toont "source": "legacy"
   en "identiteitBekend": false
✅ Bij "legacy" is de rol "teacher" — GEEN stilzwijgende adminrechten
✅ Log opnieuw in → source wordt weer "session"

— Snelle controle —
✅ Open in je browser: /api/me
   Verwacht: {"username":"anja","role":"teacher","source":"session",
              "identiteitBekend":true}
```

## 73. Sprint 50c — Afmelden dat écht afmeldt

```
— Gewoon afmelden —
✅ Klik "Afmelden" → je belandt op het loginscherm
✅ Daarna een leerkracht-pagina openen → terug naar login
✅ F12 → Application → Cookies: teacher_auth EN teacher_sid zijn allebei weg
✅ Beheer → Database viewer → teacher_sessions: JOUW rij is verdwenen
✅ Weblog toont "[auth] sessie ingetrokken (afmelden)"

— KERNTEST: het token is overal dood (dit kon vroeger niet) —
✅ Log in, kopieer de waarde van teacher_sid (F12 → Cookies)
✅ Meld af
✅ Plak dat teacher_sid terug in de browser (of gebruik hem elders)
✅ Open /api/me → je wordt naar de LOGIN gestuurd (302), geen toegang
   → Vroeger bleef een gekopieerd teacher_auth eeuwig geldig

— Twee toestellen —
✅ Log in op browser 1 én browser 2 (zelfde leerkracht) → twee rijen
✅ Meld af op browser 1 → enkel DIE rij verdwijnt
✅ Browser 2 blijft gewoon ingelogd (dat hoort zo)

— Wachtwoord wijzigen beëindigt sessies —
✅ Log in als "anja" in browser 1
✅ Wijzig in Beheer het wachtwoord van "anja"
✅ Browser 1: volgende klik → terug naar login (sessie ingetrokken)
✅ teacher_sessions: de rijen van anja zijn weg
✅ Weblog: "[auth] sessies ingetrokken na wachtwoordwijziging van anja"
ℹ️ Wie zijn EIGEN wachtwoord wijzigt moet dus opnieuw inloggen — dat hoort zo

— Leerkracht verwijderen —
✅ Verwijder een leerkracht → zijn rijen in teacher_sessions verdwijnen mee
   (regelt de databank zelf via ON DELETE CASCADE)

— Niets mag stuk zijn —
✅ Inloggen werkt normaal
✅ Alle leerkracht-schermen werken
✅ Weblogs tonen geen ERROR
```

## 74. Sprint 50d — Sessie schuift mee, maar niet eeuwig

```
— Niets mag stuk zijn —
✅ Inloggen, werken en afmelden werkt zoals gewoonlijk
✅ Weblogs tonen geen ERROR
✅ Alle leerkracht-schermen werken

— Verlengen bij activiteit —
✅ Log in en werk gewoon verder → je vliegt er NIET uit na 8u
✅ Database viewer → teacher_sessions: expires_at schuift op naarmate je werkt
✅ Dat gebeurt pas HALFWEG (±4u), niet bij elke klik — anders zou de databank
   bij elke klik beschreven worden
✅ last_seen schuift mee op met expires_at

— Verlopen sessie (de kerntest) —
Snelle manier zonder 8u wachten: zet in .env tijdelijk
    POC_SESSION_MAX_AGE_HOURS=0.05      (= 3 minuten)
    POC_SESSION_ABSOLUTE_MAX_HOURS=0.05
en herstart. Daarna:
✅ Log in → er staat een rij in teacher_sessions
✅ Wacht 3+ minuten zonder te klikken
✅ Klik dan een leerkracht-pagina → je belandt op het LOGINSCHERM
✅ Het oude teacher_sid geeft geen toegang meer
✅ De rij wordt om 03:00 automatisch opgeruimd (of blijft tot dan staan — normaal)
→ Zet de waarden daarna terug op 8 en 24!

— De harde grens —
✅ Met de standaardwaarden: een sessie leeft nooit langer dan 24u,
   ook al werk je elke dag door
✅ Je logt dus hooguit één keer per dag opnieuw in

— Instelling —
✅ .env.example bevat POC_SESSION_ABSOLUTE_MAX_HOURS met uitleg
✅ Waarde aanpassen + herstarten → gedrag volgt
```

## 75. Sprint 50e — Het audit-log noteert wie het déed

```
✅ Log in als "anja"
✅ Wijzig een score bij het nakijken van een toets
✅ Beheer → Database viewer → audit_log: de nieuwste regel toont actor = "anja"
   (vroeger stond daar ALTIJD "onbekend")
✅ Geef resultaten vrij → audit_log toont "anja" bij results_released
✅ Open/sluit de nakijk-modus → audit_log toont "anja"
✅ Verwijder een toets → audit_log toont "anja" bij quiz_deleted
✅ Doe hetzelfde als "bram" → audit_log toont "bram", niet "anja"
```

## 76. Sprint 50f — 🎉 Fase 1 af: het gedeelde cookie is weg

```
⚠️ VOORAF: bij deze deploy word je UITGELOGD. Dat is bedoeld — het oude cookie
   betekent niets meer. Log gewoon opnieuw in.
⚠️ Zorg dat er een leerkracht in de databank staat (of POC_BASIC_USER/PASS in .env,
   dan maakt de bootstrap er bij de start automatisch een aan).

— Opstarten —
✅ App start normaal op
✅ Weblog: "[auth] X leerkracht(en) geladen vanuit database."
✅ Weblog zegt NIET meer "Fallback login actief via POC_BASIC_USER/POC_BASIC_PASS"
✅ Staat POC_BASIC_PASS in .env? Dan zegt de log dat die enkel dient om de eerste
   leerkracht aan te maken

— Inloggen en werken —
✅ Inloggen werkt met je leerkracht-account
✅ F12 → Cookies: er is GEEN teacher_auth meer, wel teacher_sid
✅ /api/me toont je naam met "source": "session"
✅ Alle leerkracht-schermen werken: sessies, vragenbank, toetsen, beheer, systeem
✅ Afmelden werkt

— KERNTEST: sockets werken nog (30 handlers hangen hieraan) —
✅ Maak een sessie aan en open het live-scherm
✅ Laat een leerling deelnemen → hij verschijnt bij de leerkracht
✅ Code van de leerling live meevolgen werkt
✅ Aankondiging sturen komt aan
✅ "Run all uit" / "Code all uit" werkt
✅ Sessie afsluiten werkt
✅ Leerlingenraster (teacher-grid) werkt
✅ Toets live opvolgen + voortgang werkt

— Het oude cookie is echt dood —
✅ Zet met de hand een teacher_auth-cookie (of gebruik een oude browsersessie)
✅ Open een leerkracht-pagina → je wordt naar de LOGIN gestuurd
   → Vroeger liet dat cookie je binnen zonder dat de app wist wie je was

— De .env-login is weg, maar je raakt niet buitengesloten —
✅ Log in met de naam/wachtwoord uit POC_BASIC_USER/POC_BASIC_PASS
   → werkt nog steeds: de bootstrap heeft daar een echte leerkracht van gemaakt
   → maar nu MET een sessie (zie teacher_sessions) en met /api/me = "session"
✅ Gebruik je POC_BASIC_PASS_HASH i.p.v. het platte wachtwoord? Dan maakt de
   bootstrap daar óók een leerkracht van (nieuw in 50f)

— Geen leerkracht = niet starten (bedoeld) —
✅ Lege databank + geen POC_BASIC_* → app stopt met een DUIDELIJKE melding
✅ Die melding geeft het reddingscommando:
     docker compose run --rm web node scripts/manage-teacher.js add <naam> '<pw>' admin
✅ Databank tijdelijk onbereikbaar → app stopt NIET (dat is een storing, geen fout)

— Nakijk-tokens (bijna-fout: PASSWORD_HASH is hier nog voor nodig) —
✅ Leerling kan zijn eigen nakijk-resultaat nog openen na vrijgave
```

## 77. Sprint 48a1 — Scholen

```
— Niets mag stuk zijn (additieve sprint) —
✅ App start normaal; weblogs tonen geen ERROR
✅ Alle bestaande schermen werken (sessies, vragenbank, toetsen, klassen, leerlingen)
✅ Inloggen en afmelden werkt

— De nieuwe tab —
✅ Beheer toont een tab "🏛 Scholen"
✅ Tab openen toont de lijst (of "nog geen scholen aangemaakt")
✅ Uitleg bovenaan zegt dat dit nog niets verandert aan de werking

— Aanmaken —
✅ School toevoegen met enkel een naam werkt
✅ School toevoegen met naam + logo + licentie + contact werkt
✅ Lege naam → melding "Naam is verplicht"
✅ Zelfde naam twee keer → "Er bestaat al een school met die naam."
✅ Ook met andere hoofdletters ("atheneum" vs "Atheneum") → geweigerd
✅ Een naam met een apostrof ("Sint-Jan's College") werkt en breekt de knoppen niet

— Bewerken —
✅ "Bewerken" vraagt achtereenvolgens naam, licentie en contact via scherm-popups
✅ Annuleren onderweg → er wijzigt niets
✅ Opslaan → de lijst toont de nieuwe waarden
✅ Naam leegmaken → geweigerd

— Deactiveren —
✅ "Deactiveren" → school wordt grijs en toont "Inactief"
✅ Standaard verdwijnt een inactieve school uit de lijst
✅ Vinkje "Toon ook inactieve scholen" → hij verschijnt weer
✅ "Heractiveren" → weer actief

— Verwijderen —
✅ "Verwijderen" vraagt bevestiging en raadt deactiveren aan
✅ Annuleren → school blijft
✅ Bevestigen → school is weg

— Audit-log (werkt sinds 50e) —
✅ Database viewer → audit_log: school_created / school_updated / school_deleted
✅ actor toont JOUW gebruikersnaam, niet "onbekend"

— Database viewer —
✅ De tabel "schools" staat in de lijst en toont je rijen
```

## 78. Sprint 48a2 — Leerkracht ↔ scholen

```
⚠️ VOORAF: maak eerst 2 scholen aan (tab Scholen) en 2 leerkrachten.

— Niets mag stuk zijn (additieve sprint) —
✅ App start normaal; weblogs zonder ERROR
✅ Leerkrachtenlijst laadt zoals vroeger
✅ Wachtwoord, rol en verwijderen werken nog

— De nieuwe kolom —
✅ Leerkrachtentabel heeft een kolom "Scholen"
✅ Zonder koppeling staat er "—"

— Koppelen —
✅ Knop "🏛 Scholen" opent een popup met alle scholen als vinkjes
✅ Vink 1 school aan → Opslaan → de kolom toont die school
✅ Vink een TWEEDE school aan → Opslaan → beide staan er
   (dit is wat straks het keuzescherm bij het inloggen voedt)
✅ Annuleren wijzigt niets
✅ Popup sluiten door naast het venster te klikken → geen wijziging

— Ontkoppelen —
✅ Vink een school UIT → Opslaan → hij verdwijnt uit de kolom
✅ Alles uitvinken → kolom toont weer "—"

— Inactieve scholen —
✅ Deactiveer een gekoppelde school (tab Scholen)
✅ Leerkrachtenlijst toont die school DOORSTREEPT (koppeling bestaat, school ligt stil)
✅ In de popup staat hij met de badge "inactief"

— Opruimen gebeurt vanzelf —
✅ Verwijder een school die aan een leerkracht hing → de koppeling verdwijnt mee
✅ Verwijder een leerkracht met scholen → zijn koppelingen verdwijnen mee
   (regelt de databank via ON DELETE CASCADE)

— Audit-log —
✅ audit_log toont teacher_school_linked / teacher_school_unlinked
✅ actor is JOUW gebruikersnaam

— Geen scholen? —
✅ Popup openen zonder scholen → melding "maak er eerst een aan in de tab Scholen"
```

## 79. Sprint 48a3 — E-maildomeinen per school

```
ℹ️ De 8 domeingevallen staan al in §64. Die zijn nu ALLEMAAL automatisch getest
   (21 unittests). Hieronder enkel wat je met de hand moet nakijken.

— Het scherm —
✅ Tab Scholen → knop "📧 Domeinen" per school
✅ Zonder domeinen: melding dat geen enkele leerling zich kan registreren
✅ "Hoe vul je dit in?" toont de ✓/✗-voorbeelden per vorm
✅ Elke regel toont of hij "exact" of "subdomeinen" is

— Toevoegen —
✅ "athkiel.be" toevoegen werkt
✅ "*.athkiel.be" toevoegen werkt
✅ "@Athkiel.BE" wordt opgeschoond tot "athkiel.be"
✅ "*athkiel.be" (zonder punt) → melding over de juiste vorm
✅ "*.be" → melding "te breed: dan kan iedereen met een .be-adres zich registreren"
✅ "athkiel be" (spatie) → "Geef enkel het domein"
✅ Zelfde domein twee keer → "Dit domein staat er al."

— HET TESTVELDJE (het nuttigste onderdeel) —
✅ Plak "marie@athkiel.be" met enkel regel "athkiel.be" → ✓ toegelaten via athkiel.be
✅ Plak "marie@leerling.athkiel.be" met enkel "athkiel.be" → ✗ geweigerd
✅ Voeg "*.athkiel.be" toe → zelfde adres → ✓ toegelaten via *.athkiel.be
✅ Plak "marie@athkiel.be.aanvaller.com" → ✗ ALTIJD geweigerd
✅ Plak "marie@nepathkiel.be" → ✗ geweigerd
✅ Bij weigering zie je het herkende domein en het aantal regels

— Verwijderen —
✅ Een domein verwijderen werkt (als er meer dan 1 is)
✅ Het LAATSTE domein verwijderen → "Elke school heeft minstens 1 domein nodig."

— Opruimen —
✅ School verwijderen → haar domeinen verdwijnen mee (ON DELETE CASCADE)

— Audit-log —
✅ school_domain_added / school_domain_removed met JOUW naam als actor

— Database viewer —
✅ school_domains en teacher_schools staan in de lijst
```

## 80. Sprint 48b1 — De actieve school in de sessie

```
— Niets mag stuk zijn (dit is de belangrijkste test) —
✅ Een leerkracht ZONDER gekoppelde school logt gewoon in en kan alles
   → dit is vandaag de normale toestand; 48b1 mag daar niets aan wijzigen
✅ Alle schermen werken; weblogs zonder ERROR

— Eén school → automatisch —
✅ Koppel leerkracht "anja" aan PRECIES 1 school
✅ Anja logt in → geen keuzescherm, ze werkt gewoon door
✅ /api/me toont "activeSchoolId" en "activeSchoolName" van die school
✅ Database viewer → teacher_sessions: active_school_id is ingevuld

— Meerdere scholen → nog geen keuze (dat wordt 48b2) —
✅ Koppel anja aan 2 scholen → opnieuw inloggen
✅ /api/me toont "activeSchoolId": null
✅ Ze kan gewoon werken (het keuzescherm komt in 48b2)

— Geen school —
✅ Leerkracht zonder scholen → /api/me toont "activeSchoolId": null
✅ Alles blijft werken

— Inactieve school telt niet —
✅ Koppel anja aan 1 school en DEACTIVEER die school
✅ Anja logt in → activeSchoolId blijft null
   (op een uitgeschakelde school hoor je niet te belanden)

— School verwijderen breekt geen sessie —
✅ Anja is ingelogd met een actieve school
✅ Verwijder die school in het beheer
✅ Anja klikt verder → GEEN foutmelding, ze werkt door zonder school
   (active_school_id wordt automatisch null — ON DELETE SET NULL)

— De browser kan niet kiezen —
✅ F12 → Cookies: er is GEEN cookie met een school-id
   (de actieve school staat server-side in teacher_sessions)
```

## 81. Sprint 48b2 — Het schoolkeuze-scherm

```
⚠️ VOORAF: 2 scholen aanmaken en leerkracht "anja" aan BEIDE koppelen.
   Leerkracht "bram" aan precies 1 school. Leerkracht "kris" aan geen enkele.

— Geen school (huidige toestand) —
✅ Kris logt in → GEEN keuzescherm, gaat meteen door
✅ Alles werkt zoals altijd

— Eén school → automatisch —
✅ Bram logt in → GEEN keuzescherm, gaat meteen door
✅ /api/me toont zijn school

— Meerdere scholen → het keuzescherm —
✅ Anja logt in → er verschijnt een grid met een dropdown
✅ De dropdown toont ENKEL haar 2 scholen (niet alle scholen van het systeem)
✅ Gebruikersnaam en wachtwoord zijn GRIJS (zichtbaar, maar niet meer aanpasbaar)
✅ De knop "Aanmelden" is weg; er staan "Annuleren" en "Kiezen"
✅ "Kiezen" → ze belandt op het sessiescherm
✅ /api/me toont de gekozen school
✅ Database viewer → teacher_sessions: active_school_id is ingevuld

— De lijst lekt niet —
✅ Vóór het aanmelden is er GEEN schoolkeuze zichtbaar
✅ Met een FOUT wachtwoord verschijnt de lijst NIET
   (zo kan niemand zien welke scholen er bestaan)

— Annuleren meldt echt af —
✅ Anja logt in → keuzescherm → "Annuleren"
✅ Ze komt op een SCHOON loginscherm (velden weer bruikbaar)
✅ F12 → Cookies: teacher_sid is weg
✅ Database viewer → teacher_sessions: haar rij is verdwenen
✅ Een leerkracht-pagina openen → terug naar login (geen half-aangemelde toestand)

— KERNTEST: je kan geen school kiezen die niet van jou is —
✅ Anja logt in en krijgt het keuzescherm
✅ Wijzig in F12 de waarde van de dropdown naar het id van een school
   waar ze NIET aan gekoppeld is (uit de tab Scholen)
✅ Klik "Kiezen" → melding "Je hebt geen toegang tot die school." (403)
✅ Weblog toont de poging MET haar naam
✅ active_school_id blijft ongewijzigd

— Andere wegen —
✅ Enter in de dropdown werkt als "Kiezen"
✅ Een gedeactiveerde school staat NIET in de dropdown
```

## 82. Sprint 48b3 — Het schoollogo

```
⚠️ VOORAF: zet bij een school een logo-pad dat op de NAS bestaat,
   bv. /app/public/assets/pycodeflow-logo.png (absoluut pad!)

— Waar het logo NIET hoort —
✅ Startscherm (/) → enkel het PyCodeFlow-logo, geen schoollogo
✅ Loginscherm → geen schoollogo
✅ Leerling deelnemen-scherm → geen schoollogo
✅ Leerling in een sessie → geen schoollogo (komt pas met 52 + 48c1)

— Waar het wel hoort —
✅ Log in als leerkracht met een actieve school (met logo-pad)
✅ Topbalk toont: PyCodeFlow-logo | PyCodeFlow | schoollogo | schoolnaam
✅ Op ALLE leerkrachtpagina's: sessies, vragenbank, toets/taak overzicht,
   archief, beheer, én systeem (14 pagina's)
✅ Wissel van school (afmelden → opnieuw → andere kiezen) → logo volgt mee

— Geen logo ingesteld —
✅ School zonder logo-pad → enkel de schoolnaam verschijnt, geen kapot icoon
✅ Logo-pad naar een onbestaand bestand → geen gebroken-afbeelding-icoon,
   enkel de naam blijft staan

— KERNTEST: padcontrole —
✅ Zet als logo-pad "../../etc/passwd" → /school-logo geeft 400, niets uitgeserveerd
✅ Zet "/etc/passwd" → 400 (geen afbeeldingsextensie)
✅ Zet "logo.png" (relatief) → 400
✅ Weblog toont "[school-logo] geweigerd pad"

— Terugval voor één school —
✅ Leerkracht zonder gekoppelde school + SCHOOL_LOGO_PATH in .env
   → dat logo verschijnt nog steeds (bestaande installaties blijven werken)
```

*PyCodeFlow · Atheneum Hoboken · test-readme.md · v2026.2.48.10 · 16 juli 2026*

## 83. Testdatabase-seeder (sprint 54 — pycodeflow.sh optie 21)

```
✅ Optie 21 → SEED typen → seed draait, samenvatting met alle logins verschijnt
✅ Verkeerde bevestiging (iets anders dan SEED) → geannuleerd, niets gebeurd
✅ Status (optie 21 → 2) toont tellers: 2 scholen / 4 leerkrachten / 3 klassen /
   6 leerlingen / 7 vragen / 3 sessies / 6 antwoorden
✅ TWEEDE keer seeden → identieke tellers (idempotent, geen duplicaten)
✅ Alle geseedete items zijn herkenbaar: namen beginnen met "TESTDATA", codes met "TD"
✅ Inloggen werkt: leerkrachtA/leerkrachtA · superadmin/superadmin ·
   studentA@testschool.local/studentA
✅ studentA2 (pending) wordt geweigerd bij toets TDTOETSA; studentA3 (blocked) kan niet inloggen
✅ Verbeterscherm van TDTOETSA toont ingevulde antwoorden, scores en commentaar
✅ Registratie met klascode TDKLAS5A werkt (nieuwe leerling → pending)
✅ WIS typen → status toont overal 0; zelf aangemaakte (niet-gemarkeerde) data blijft staan
✅ Na WIS opnieuw SEED → zelfde resultaat als eerste keer
⚠️ NOOIT op productie draaien — wachtwoord = gebruikersnaam
```

---

## 84. Sprint 50 — Bugfixes: toegang, aanpassen, logout & leerling-flow

> Testdata: seed via `scripts/app/pycodeflow.sh` optie 21. Log in als `leerkrachtA` (admin, School A).
> Handig: klas 5A/6A (School A) en 5B (School B).

### 84.1 Bug 1 — toets/taak enkel voor eigen, niet-gearchiveerde klas
- [ ] Nieuwe toets → klas-dropdown toont **enkel** klassen van je actieve school; **geen**
      gearchiveerde klassen; **geen** klassen van een collega/andere school.
- [ ] Als `leerkrachtA2` (niet gekoppeld aan 6A) een toets maakt: 6A staat **niet** in de lijst.
- [ ] Server-grendel: een `POST /api/quiz` met een `targetClass` waartoe je geen toegang hebt
      (bv. via de dev-console) geeft **403** met uitleg — er wordt niets aangemaakt.
- [ ] Een gearchiveerde klas als doel → **403** ("gearchiveerd").

### 84.2 Bug 2 — toets/taak aanpassen
- [ ] Maak een **verse** toets (niemand ingelogd). Op het **toets-overzicht** staat
      **✏️ Aanpassen**. (Controleer: de knop staat **niet** op het live-/sessiescherm.)
- [ ] Klik Aanpassen → het aanmaakscherm opent voorgevuld (naam, timer, volgorde, tijdvenster,
      vragen, punten, klas, leerlingselectie). De titel/badge zegt "aanpassen".
- [ ] Het **type** kan niet gewijzigd worden (een taak blijft een taak, een toets een toets);
      de preview-optie is verborgen.
- [ ] Wijzig iets (bv. een vraag toevoegen + deadline) → **Wijzigingen opslaan** → terug op het
      overzicht; open opnieuw → de wijziging is bewaard.
- [ ] Laat één leerling de toets **starten** (of dien een antwoord in). Ververs het overzicht:
      **✏️ Aanpassen** is nu **uitgeschakeld** met tooltip-uitleg.
- [ ] Server-grendel: een `PUT /api/quiz/:code` op een toets met activiteit geeft **409**.
- [ ] Een **preview**-toets toont geen Aanpassen-knop (activeer ze eerst).

### 84.3 Bug 3 — afmelden
- [ ] Op **Klasoverzicht** (`klasmatrix.html`) en **Mijn klassen**: klik **Afmelden** →
      je wordt afgemeld en op de login-pagina gezet (géén "Cannot GET /logout").
- [ ] Ga rechtstreeks naar `/logout` (oude bookmark) → zelfde: afgemeld + login-pagina.

### 84.4 Bug 4 — leerlingcode & toegang tot toets/taak
- [ ] Log in als **aanvaarde** leerling (`studentA`). Op het keuzescherm: geef de **toetscode**
      in → je komt op het **toetsstartscherm** (niet in de les-editor).
- [ ] Geef een **lescode** in (of kies een les uit de lijst) → je komt correct in de **les-app**.
- [ ] Log in als **pending** leerling (`studentA2`) → toetscode ingeven geeft de melding
      "nog niet aanvaard"; je kan **niet** starten. Een les/vrij oefenen werkt wél.
- [ ] Niet-ingelogd (gast) die op de deelnemen-pagina een **toetscode** gebruikt → melding dat
      inloggen vereist is; geen deelname.
- [ ] Preview (leerkracht) blijft werken zonder leerling-account.

### 84.5 Bug 5 — leerling-picker lay-out
- [ ] Nieuwe toets → kies een klas → **👥 Leerlingen**. De picker toont **kolommen**
      (meerdere per rij), een **zoekveld** en een **teller** ("x van y geselecteerd").
- [ ] Typ in het zoekveld → de lijst filtert; **Alles aan/uit** werkt op de **zoekresultaten**.
- [ ] Test met een klas met veel leerlingen (bv. tijdelijk ~40+): scrollt vlot, blijft leesbaar.
- [ ] Iedereen aangevinkt = geen beperking (hele klas mag). Een deelselectie wordt bewaard en
      is terug te zien bij **Aanpassen**.

### 84.6 Opruiming
- [ ] In de projectmap staat een map **`OLDIES/`** met de oude/dubbele bestanden
      (`scripts/web/`, `pgdata/`, …) in hun oorspronkelijke structuur. Niets daaruit draait mee;
      de app start en werkt normaal.

---

## 85. Sprint 51 — Mappenstructuur & OLDIES-opruiming

### 85.1 Structuur
- [ ] De hoofdmap bevat enkel `VERSION`, `.env(.example)`, `.gitignore` en de twee
      `docker-compose*.yml`. Geen losse scripts of `.md`/`.pdf` meer.
- [ ] `scripts/app/pycodeflow.sh` start normaal op; alle menu's werken.
- [ ] `bash scripts/general/run-tests.sh` draait en slaagt (BASE correct afgeleid).
- [ ] `bash scripts/general/check-deployment.sh` vindt alle bestanden op hun nieuwe plek.
- [ ] Documentatie staat volledig in `documentation/`.

### 85.2 OLDIES bij rebuild (menu 5)
- [ ] Menu 5 → tests draaien → "Doorgaan? (j/n)". Kies **n** → alles stopt, géén OLDIES-vragen.
- [ ] Menu 5 → "Doorgaan? (j/n): j" → daarna: "Wil je de oude OLDIES leegmaken? (j/n)".
- [ ] "Wil je de controle op oude/irrelevante files doen (verplaatsen)? (j/n): j" → toont een
      lijst en verplaatst naar `OLDIES/v<versie>/` met behoud van structuur.
- [ ] Echte projectbestanden blijven staan; enkel rommel (`.ug-tmp`, `(1)`-dubbels,
      stale `scripts/web`, verdwaalde root-`.md`/scripts, `.DS_Store`) verhuist.
- [ ] Na afloop bevat OLDIES precies één versie-submap.
- [ ] Standalone: `bash scripts/general/oldies-check.sh --dry-run` toont wat er zou gebeuren;
      zonder `--dry-run` voert het uit; `--leeg` maakt OLDIES eerst leeg.

---

## 86. Sprint 51c — Verbetermodule & realistische seeder

> Seed opnieuw via `pycodeflow.sh` (of `node scripts/seed-testdb.js seed`) na deze update.

- [ ] Open de verbetering van **TESTDATA Toets: Python basis** (code TDTOETSA).
- [ ] Selecteer **Sten Testers** → bij elke codevraag verschijnt nu de **echte code** in de
      editor (som-functie, for-lus); de single-choice toont de gekozen optie + auto-score.
- [ ] De regel "Ingediend …" toont een **geldige tijd** (geen "Invalid Date").
- [ ] Wissel tussen V1/V2/V3: telkens laadt de juiste code (editor herbouwt correct).
- [ ] **Nina Actief**: codevragen nog **niet gescoord** (?/punten), single auto-gescoord (fout → 0).
- [ ] **Run history** toont meerdere runs per codevraag.
- [ ] **Gelijkenis**: op de for-lus-vraag verschijnt een verdachte-gelijkenis-melding tussen
      Sten en Nina.
- [ ] **Pia Pending** en **Bo Blocked** staan **niet** als deelnemer bij de resultaten
      (enkel aanvaarde leerlingen). In de klas-voortgang staan ze als "niets/geen activiteit".
- [ ] De **taak** (TDTAAKA) heeft een ingeleverde, realistische oplossing van Sten.
- [ ] Probeer als **pending** leerling (studentA2) de toetscode → wordt geweigerd (kan geen toets maken).

---

## 87. Sprint 51j — Samengestelde vragen (composite)

> Seed opnieuw (`node scripts/seed-testdb.js seed`) na deze update voor de composite-testdata.

- [ ] **Vragenbank** → Nieuwe vraag → kies "🧩 Samengesteld". Voeg onderdelen toe: open-onderdeel
      vereist een label; probeer een 2de code-onderdeel toe te voegen → geweigerd (max 1).
      Voeg 7 onderdelen toe → 7de wordt geweigerd (max 6). Punten-veld is read-only en toont de som.
- [ ] Sla op, bewerk de vraag opnieuw → onderdelen komen correct terug.
- [ ] Maak een toets/taak met deze vraag → controleer dat de vraag correct in de lijst staat.
- [ ] **Leerlingscherm**: elk open-onderdeel heeft een eigen tekstveld met label; het
      code-onderdeel is de gewone, uitvoerbare editor (Run-knop werkt). Antwoorden blijven
      staan na paginawissel.
- [ ] **Verbeteren** (toets TDTOETSA, vraag "Gegeven onderstaande code…"): Sten Testers toont
      score 8/8 (alle onderdelen correct); Nina Actief toont nog geen score. Vul bij Nina de
      onderdeelscores in en klik "Onderdeelscores opslaan" → het totaal verschijnt correct.
- [ ] **PDF**: exporteer het vragenblad en de antwoorden (met en zonder scores) → de
      samengestelde vraag toont elk onderdeel apart, code-onderdeel als codeblok.
- [ ] **CSV-import**: importeer de voorbeeldregel uit de CSV-tab (composite) → 1 vraag met
      2 onderdelen en de juiste punten (som) verschijnt in de bank.

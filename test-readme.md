# PyCodeFlow — Volledig Testboek

> **Versie:** v2026.2.27.0 · **Bijgewerkt:** 27 juni 2026
> Volledig stappenplan voor alle functies, pagina's, layouts en PDF-exports.
> Voer tests uit op: `https://app.pycodeflow.org` (productie) of `http://localhost:3000` (lokaal)

---

## 0. Voorbereiding

### 0.1 Testdata aanmaken (eenmalig)

Via `admin.html` vóór je begint:

| Item | Waarde |
|---|---|
| Leerkracht | `testleerkracht` / wachtwoord naar keuze |
| Klas | `6A Informatica` |
| Leerlingen | `Emma Janssens`, `Luca Peeters`, `Sara Declercq` (CSV-import) |
| Vragen bank | Minstens 3 vragen: 1× Python code, 1× Open vraag, 1× Single choice |
| Toets | `Testtoets H1` — 3 vragen, timer 45 min, random volgorde |

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

docker compose logs web --tail=20 | grep -iE "ERROR|FATAL|Cannot find"
# ✅ Geen kritieke fouten

bash check-deployment.sh
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

**Op de NAS uitvoeren via: `bash pycodeflow.sh`**

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
``` code-blok ingevoegd
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
bash sync-version.sh 2026.2.40.0
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
bash run-tests.sh

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
✅ scripts/backup-db.sh bestaat en is uitvoerbaar
✅ bash scripts/backup-db.sh → maakt backups/pycodeflow-<timestamp>.sql.gz
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

*PyCodeFlow · Atheneum Hoboken · test-readme.md · v2026.2.41.1 · 8 juli 2026*

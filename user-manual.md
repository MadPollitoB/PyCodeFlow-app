# PyCodeFlow — Gebruikershandleiding

> Handleiding voor **systeembeheerder**, **leerkracht** en **leerling**.

---

## Inhoudsopgave

- [Systeembeheerder](#systeembeheerder)
- [Leerkracht](#leerkracht)
- [Leerling](#leerling)

---

## Systeembeheerder

### Toegang

Ga naar `https://app.pycodeflow.org` en log in met je leerkrachtsaccount. De admin-pagina is bereikbaar via `https://app.pycodeflow.org/admin.html` of via de knop "👤 Gebruikersbeheer" in monitoring.html.

### Leerkrachten beheren

**Leerkracht toevoegen:**
1. Ga naar admin.html → tabblad Leerkrachten
2. Vul gebruikersnaam, wachtwoord (min. 8 tekens), weergavenaam en rol in
3. Klik "+ Toevoegen"

**Wachtwoord resetten:**
Klik op 🔑 naast de leerkracht → voer nieuw wachtwoord in.

**Rol wijzigen:**
Klik op "↑ Admin" of "↓ Leerkracht" om de rol te wisselen.

**Leerkracht verwijderen:**
Klik op "Verwijderen". Niet mogelijk als er actieve sessies lopen.

### Klassen beheren

1. Ga naar admin.html → tabblad Klassen
2. Vul klasnaam en schooljaar in → "+ Toevoegen"
3. Archiveren: klas wordt verborgen maar data blijft bewaard
4. Verwijderen: enkel mogelijk als de klas leeg is

### Leerlingen beheren

**Via CSV-import (aanbevolen):**
1. Ga naar admin.html → tabblad Leerlingen → "📥 CSV-import"
2. Voer gegevens in: één leerling per regel, formaat `naam,klas`

```
Emma Janssens,6A Informatica
Luca Peeters,6A Informatica
Sara Declercq,6B Informatica
```

3. Klik "Importeren" → rapport toont toegevoegd/overgeslagen/nieuwe klassen

**Acties per leerling:**

| Actie | Wanneer |
|---|---|
| ✓ Aanvaarden | Leerling staat op "Afwachting" |
| ✕ Blokkeren | Leerling mag niet meer joinen |
| ↩ Deblokkeren | Geblokkeerde leerling terug toelaten |
| 🗒 Notitie | Vrije notitie toevoegen |
| ✕ Verwijderen | Leerling volledig verwijderen |

### Monitoring

Ga naar `https://app.pycodeflow.org/monitoring.html` voor:
- Actieve sessies en leerlingen
- Runner-status en wachtrij
- Geheugengebruik
- Autocheck resultaten

---

## Leerkracht

### Inloggen

Ga naar `https://app.pycodeflow.org` en log in met je gebruikersnaam en wachtwoord.

### Sessie aanmaken

1. Klik "Nieuwe sessie" in het sessieoverzicht
2. Kies een naam, modus (Klas of Examen) en optioneel een starttemplate
3. De sessiecode wordt automatisch aangemaakt (8 tekens)
4. Deel de sessiecode met de leerlingen

**Verschil klas- en examenmodus:**

| | Klasmodus | Examenmodus |
|---|---|---|
| Gedeelde code | ✅ Iedereen ziet hetzelfde | ❌ Eigen code per leerling |
| Auto-indent | ✅ Aan | ❌ Uit (aanpasbaar) |
| Autocomplete | ✅ Aan | ❌ Uit (aanpasbaar) |
| Tab-detectie | ❌ Uit | ✅ Aan |
| Foutmeldingen | ✅ Altijd | ✅ Altijd |

### Werken in een sessie

**Leerlingenlijst:**
- Klik op een leerling om "Live control" te openen
- Bekijk hun code en output live
- Run hun code met "Run" of stuur een snippet

**Navigatie:**
- ↑/↓ pijltjes om door leerlingen te bewegen
- Enter om Live control te openen
- ⊞ Overzicht voor grid-weergave met code-preview per leerling

**Statusfilters:**
- Alle / ✓ Klaar / ✋ Hand / ⚠️ Tab

### Sessie-instellingen (⚙️)

Klik op ⚙️ in de toolbar om het instellingenpaneel te openen. Wijzigingen zijn **direct actief** voor alle verbonden leerlingen.

| Instelling | Beschrijving |
|---|---|
| Auto-indent | Automatisch inspringen na `:` |
| Auto-sluiten haakjes | `(` wordt `()` |
| Auto-sluiten aanhalingstekens | `"` wordt `""` |
| Autocomplete | Suggesties bij typen |
| Parameter-info | Tooltip bij functies |

Fout-regel markering is altijd aan en kan niet uitgeschakeld worden.

### Annotaties

1. Klik 📌 in de toolbar
2. Selecteer regels, kleur en bericht (of kies een template)
3. Klik "Versturen" → leerlingen zien de markering in hun editor

### Aankondigingen

Typ een bericht in het aankondigingsveld en druk Enter. Alle leerlingen zien het onmiddellijk bovenaan hun scherm.

### Timer

Klik "▶ Timer" → voer aantal minuten in → start. Leerlingen zien een afteller met voortgangsbalk (groen → oranje → rood).

### Code snippets

Stuur een code-fragment naar alle leerlingen via "📎 Voorbeeld". Leerlingen zien het als een aankondiging met code-block.

### Examenmodus — badges

Leerlingen die joinen kunnen badges tonen:

| Badge | Betekenis | Actie |
|---|---|---|
| ⚠️ Nieuw | Niet gekend in systeem | ✓ Aanvaarden of → Klas toewijzen |
| ⏳ Afwachting | Wacht op bevestiging | ✓ Aanvaarden |
| 👤 Gast | Geen klas geselecteerd | → Klas toewijzen |

### Sessie sluiten

Klik "✕ Sessie sluiten" → bevestig in het dialoogvenster. Leerlingen worden teruggestuurd naar de startpagina. De sessie blijft beschikbaar in het archief (toggle "Toon gesloten sessies").

### Editor thema

Klik ☀️/🌙 in de toolbar om tussen licht en donker te wisselen. Jouw keuze is onafhankelijk van de leerlingen.

### Sneltoetsen

| Sneltoets | Actie |
|---|---|
| `Ctrl+Enter` | Code runnen |
| `Ctrl+?` of `?` | Sneltoetsen-overlay tonen |
| `Ctrl+Shift+T` | Editor thema wisselen |
| `↑/↓` | Leerling selecteren (in lijst) |
| `Enter` | Live control openen |

### Sessie-archief

In het sessieoverzicht: vink "Toon gesloten sessies" aan om gesloten sessies te zien. Klik "⬇ Export" om een sessie te downloaden als ZIP.

---

## Leerling

### Joinen

1. Ga naar de URL die je leerkracht heeft gegeven
2. Vul je naam in (exact zoals je leerkracht je kent)
3. Kies je klas uit de dropdown
4. Vul de sessiecode in (8 tekens, hoofdletters en cijfers)
5. Klik "Deelnemen"

> Als je naam niet in de klas gekend is, verschijnt er een badge bij de leerkracht. De leerkracht kan je dan bevestigen.

### Vrij oefenen

Ga naar de "Vrij oefenen" pagina om Python te schrijven zonder sessiecode. Je code is privé en niet zichtbaar voor de leerkracht.

### Code schrijven

- De editor ondersteunt syntax-kleuring voor Python
- Regelnummers staan links
- Auto-indent na `:` (tenzij uitgeschakeld door leerkracht)
- Auto-sluiten van haakjes en aanhalingstekens (tenzij uitgeschakeld)

### Code runnen

Klik "Run" of druk `Ctrl+Enter`. De output verschijnt in het output-paneel rechtsonder.

**Bij invoer (`input()`):**
- Een blauw veld verschijnt onderaan
- Typ je antwoord en druk Enter
- De ingevoerde waarde verschijnt tussen `[haakjes]` in de output

**Bij een fout:**
- De foutmelding verschijnt in de output (rood)
- De fout-regel wordt rood gemarkeerd in de editor
- Hover over de markering voor meer details
- Een Nederlandse uitleg 💡 verschijnt onder de foutmelding

**In wachtrij:**
- Als er veel leerlingen tegelijk runnen, kom je in een wachtrij
- Je ziet: "⏳ In wachtrij — positie X · ~Xs wachttijd"

### Editor thema

Klik ☀️/🌙 in de toolbar om tussen lichte en donkere editor te wisselen. Je voorkeur wordt onthouden.

### Hand opsteken

Klik "✋ Hand opsteken" om de leerkracht te verwittigen dat je hulp nodig hebt.

### Klaar melden

Klik "✓ Klaar" als je klaar bent met de opdracht. De leerkracht ziet dit.

### Code-history

Klik 📜 in de toolbar om je code-geschiedenis te bekijken. Je kan door eerdere versies scrollen of ze afspelen.

### Examenmodus

In een examensessie:
- Overschakelen naar een ander tabblad wordt gemeld aan de leerkracht (⚠️ Tab weg badge)
- Editor-hulpfuncties zijn standaard uitgeschakeld (tenzij leerkracht ze inschakelt)
- Foutmeldingen en Nederlandse uitleg zijn altijd zichtbaar

### Verbindingsstatus

De gekleurde stip rechtsboven toont je verbindingsstatus:
- 🟢 Verbonden
- 🟠 Verbinding herstellen...
- 🔴 Niet verbonden

Bij een onderbroken verbinding wordt automatisch geprobeerd te herverbinden.

---

*PyCodeFlow · Atheneum Hoboken*

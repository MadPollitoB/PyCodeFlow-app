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

**Handmatig toevoegen:**
1. Ga naar admin.html → tabblad Leerlingen
2. Vul naam in en kies een klas
3. Klik "+ Toevoegen"

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

### Navigatie (leerkrachten)

Elke leerkrachtpagina heeft een secundaire navigatiebalk met snelkoppelingen naar:
- 📋 Vragenbank · 📝 Nieuwe toets · 📦 Archief · 👤 Beheer · ⚙️ Systeem

De actieve pagina is gemarkeerd in blauw.

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

### Link naar de leerlingen

Onder *Opdracht voor leerlingen* en *Codevoorbeeld* staat het blok **🔗 Link voor leerlingen**: vul een **titel** (mag leeg) en een **URL** in.

- **↗ Open** opent de link bij jou in een nieuw tabblad.
- **Naar leerlingen** toont bij alle leerlingen een popup met de titel en een knop **Link openen**. Er wordt nooit automatisch iets geopend.
- Met **◀ Vorige / Volgende ▶ / + Nieuwe link** bereid je meerdere links voor. **💾 Bewaar** bewaart ze met je opdrachten bij de sessie, zodat ze er op een andere laptop of later nog staan.
- De popup verdwijnt als de leerling de link opent of als jij op **🗑 bij leerlingen verwijderen** klikt. Sluit een leerling de popup met *Later*, dan blijft een knop "🔗 Link van de leerkracht" op zijn pagina staan.
- Werkt enkel in **klasmodus** (niet in de individuele werkfase en niet bij toetsen of taken). Alleen http(s)-links.

### Sessie sluiten

Klik "✕ Sessie sluiten" → bevestig in het dialoogvenster. Leerlingen worden teruggestuurd naar de startpagina. De sessie blijft beschikbaar in het archief (toggle "Toon gesloten sessies").

### Editor thema

De Monaco code-editor heeft een donker thema. Klik ☀️ in de editor-toolbar om tussen licht en donker te wisselen. Dit geldt enkel voor de code-editor, niet voor de rest van de pagina.

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

### Vrij oefenen als leerkracht

Klik in het menu op **🐍 Vrij oefenen**: de editor opent in een nieuw tabblad, onder je eigen naam (klas "Leerkracht"). Je hoeft niet meer via een leerlingaccount. Je verschijnt niet in de statistiek van leerlingen; de knop bovenaan brengt je terug naar het sessieoverzicht.

### Toetsen en taken

**Vragenbank.** Vragen aanmaken of importeren (CSV of JSON, tab *Import*). Per vraag: titel, onderwerp, niveau (makkelijk/gemiddeld/moeilijk), punten (stappen van 0,5), vraagtype (code, open, enkelvoudige of meerkeuze, samengesteld). Een vraag die al bestaat (zelfde tekst) wordt bij import overgeslagen.

**Aanmaken (wizard, ook voor aanpassen en dupliceren).** Dupliceren neemt alle instellingen en groepen mee; resultaten beginnen leeg.

| Onderdeel | Wat het doet |
|---|---|
| **Gedeeld juist / Klassiek** | Score bij meerkeuze met meerdere juiste opties. *Gedeeld juist*: punten × (1 − (1,5 × gemist + 3 × fout) ÷ aantal juiste), afgerond op halve punten; alles aanduiden = 0. Nieuwe toetsen starten op *gedeeld*, bestaande blijven *klassiek*. |
| **Groepen en vragenpool** | Splits de vragen in groepen (✂️). Bovenaan een groep: *trek N uit M*. Elke leerling krijgt een eigen willekeurige selectie, die bij herladen gelijk blijft. Alle vragen in zo'n groep moeten **evenveel punten** waard zijn (knop *Zet alle op X punt*). Met ⚖️ kies je een niveaumix, bv. 2 makkelijk + 1 moeilijk. Het bevestigingsscherm toont hoeveel unieke toetsen mogelijk zijn. Zonder pool krijgt iedereen dezelfde vragen. |
| **🎲 Placeholders** | Vink per vraag aan; `{{a}}` in tekst, opties en modelantwoord krijgt per leerling een andere, vaste waarde. Per placeholder geef je het toegelaten bereik of de lijst, plus een eventuele voorwaarde (`a > b`). Onmogelijke situaties (delen door nul, geen geldige combinatie, gelijke opties) worden geblokkeerd. Zonder vinkje is `{{…}}` gewone tekst. |
| **Cursus-links** | Per link een titel, een https-adres en de vragen waarbij hij hoort (🔗 Vragen koppelen). De leerling ziet per vraag enkel de gekoppelde links. |
| **Beveiliging** | Anti-spiek bij tabwissel (drempel en respijt), volledig scherm verplicht, kopiëren/plakken blokkeren, 1 kans per vraag, zelfevaluatie, klasbord. Alles per toets instelbaar. |

**Klasbord (beamerscherm).** Elke tegel toont naam en resterende tijd (geen vraagnummer, om leerlingen niet zenuwachtig te maken). Klik op de sessiecode voor een grote popup.

**Overzicht.** Op elke kaart wissel je **Scores vrijgeven/intrekken** en **Nazicht openen/sluiten** met één klik.

**Nakijken.** Per leerling en vraag score en commentaar; ▶ Uitvoeren draait de code van de leerling (3 seconden tussen runs, `input()` werkt).
- **🔍 Gelijkenisrapport**: per paar leerlingen een risico (hoog/middel/laag) op basis van gelijke tekst of code (ook na hernoemen van variabelen), dezelfde foute meerkeuzekeuze, identieke antwoorden ondanks andere placeholder-waarden en timing. Drempel 50–100 %, export als CSV. Het is een **signaal, geen bewijs**.
- **Gele banner bij een vraag.** Klik op de banner (enkel bij open- en codevragen): het antwoord van de andere leerling komt naast dat van de leerling die je nakijkt. Met *Markeer: gelijk / verschillend* kleur je gelijke regels groen of afwijkende rood; blanco en triviale regels (`else:`, losse `}`) tellen niet. *Meer details* toont alle overeenkomsten met die leerling en een knop **👤 Open X**.
- **📊 Moeilijkheid**: gemiddelde en slaagpercentage per vraag, en per leerling de verwachte versus werkelijke score van zijn set (vanaf 5 leerlingen).

**Hoe de tijd werkt (duur en deadline).** Er zijn vier mogelijkheden. *Geen duur en geen deadline*: geen teller. *Alleen een deadline*: geen teller, de leerling ziet "wordt automatisch ingediend op …". *Alleen een duur*: een teller vanaf het starten. *Duur én deadline*: de teller toont de **kortste** van de twee; wie later start dan het begin van het venster, heeft dus minder dan de volledige duur. Leerling en overzicht tonen altijd hetzelfde. Pas je de deadline tijdens de toets aan, dan passen alle tellers zich meteen aan. Bij **Toegang herstellen** kies je of extra minuten *bovenop zijn eindtijd* komen of *vanaf nu* tellen; extra tijd mag de deadline overschrijden.

**Monitoring (systeembeheer).** *Lopende sessies* toont de echte status per sessie en standaard enkel wat loopt; vink "toon ook gestopt/afgerond/rustig" aan voor de rest.

**Live meekijken (toets/taak).** Klik bij een lopende toets op **Live**. Je ziet per leerling een kaartje met een klein **schermbeeld** van de toets, de huidige vraag, het begin van zijn antwoord, wanneer hij voor het laatst iets deed, de resterende tijd en of hij de toets verlaten heeft (rood, 🚪). Klik niet op de leerling in dit venster om iets te sturen; het is enkel meekijken. De beelden worden **enkel gemaakt zolang dit venster open is** en vervangen telkens het vorige; er wordt niets bewaard. Hoe vaak het beeld ververst stel je **per toets** in bij *Beveiliging → Schermbeeld in het live-overzicht om de … seconden* (standaard 30, **0 = uit**). Het beeld toont enkel de toetspagina, nooit andere programma's van de leerling.

**Spiek- en fraudepogingen.** Onderaan het nakijken van elke leerling staat het blok **🚨 Spiek-/fraudepogingen** (en een 🚨 in de leerlingenlijst). Het toont per vraag en soort wat er geprobeerd werd: geplakte of gekopieerde tekst (ook al werd die geblokkeerd), code die in één keer verscheen, opvallend weinig toetsaanslagen, sneltoetsen (print, F12, ontwikkelaarstools), een plots kleiner venster en elke keer dat de leerling de toets verliet, met de waarschijnlijke oorzaak (zoek-/startknop, Alt+Tab, muis naar de taakbalk of rechtsonder). Klap een regel open voor tijdstip en gegevens. Rood is zwaarwichtig, oranje opvallend, grijs ter info. Het is **geen bewijs**: beoordeel het zelf en geef eventuele strafpunten bij het rapport. In het gelijkenisrapport staat nu ook "plakken vraag X: N×". Bovenaan het nakijken staat of de leerling **zelf indiende** of **automatisch werd afgesloten**.

**Tijdens een toets.**
- **🔓 Toegang herstellen** (Voortgang-lijst, bij elke leerling, altijd mogelijk). De popup toont zijn eigen eindtijd en resterende tijd; die loopt gewoon door (hij krijgt de tijd dat hij weg was niet terug). Je kiest simpel **hoeveel tijd hij vanaf nu krijgt** (5, 10, 15, 30 min of een eigen aantal); het voorbeeld toont tot hoe laat hij kan verder werken. Heeft hij nog meer eigen tijd, dan behoudt hij die. **De knop "Heropenen" per leerling en "↻ Toets heropenen" (open tot …) geven de leerling echt werktijd tot het gekozen tijdstip.** **Ook in het verbeterscherm** (knop 🔓 Toegang herstellen naast PDF) en ook als je al verbeterd hebt: je scores blijven staan en enkel vragen die hij wijzigt gaan terug naar *Te verbeteren*; in de lijst staat 🔓 heropend tot hh:mm tot hij opnieuw indient of de tijd om is. Tabwissels blijven geregistreerd. Bewust bevestigde vragen (bij *1 kans per vraag*) blijven dicht; de leerling gaat verder op de eerste niet-bevestigde vraag.
- **⏰ Deadline aanpassen** (bij een lopende toets in het overzicht, onder het pijltje): het uur wijzigen terwijl de toets loopt, met snelknoppen +10/+30/+60 min. Vervroegen kan, wie dan nog bezig is wordt bij de nieuwe deadline ingediend. Een leerling blijft ook gebonden aan zijn eigen tijd.

**Toegang.** Bij te veel mislukte inlogpogingen wordt enkel dat account tijdelijk geblokkeerd. Op de pagina *Toegang* ontgrendel je een netwerk of leerling.

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

Klik ☀️ in de editor-toolbar om de code-editor tussen licht en donker te wisselen. Je voorkeur wordt onthouden.

### Hand opsteken

Klik "✋ Hand opsteken" om de leerkracht te verwittigen dat je hulp nodig hebt.

### Klaar melden

Klik "✓ Klaar" als je klaar bent met de opdracht. De leerkracht ziet dit.

### PyBlitz (live quiz)
1. Menu **⚡ PyBlitz** → *Nieuwe PyBlitz* (of *Importeren* met JSON/Excel; het Excel-sjabloon staat naast de knop). Een vraag kan tekst, Python-code, een foutmelding en/of een afbeelding bevatten; duid het juiste antwoord aan, kies tijd en punten.
2. Open je klassessie (klasmodus) en klik **⚡ PyBlitz**. Is er al een gekoppeld, dan opent die; anders kies je uit de lijst. ▾ naast de knop = een andere kiezen.
3. Leerlingen in de sessie krijgen automatisch een popup. Gasten scannen de **QR** of gaan naar **/play** en typen de code + hun naam. Een gast mag niet de naam van een klaslid gebruiken; dubbele namen krijgen een nummer.
4. **Start de quiz**, laat de vragen lopen (*Toon antwoord* / *Volgende vraag*; ⏸ pauze mag) en sluit het **Eindresultaat** af: bij iedereen verdwijnt de popup.
5. **Antwoorden met code:** in de editor kan elk antwoord uit meerdere regels bestaan (vinkje *code* = vaste breedte, inspringing blijft).
6. **▶ Uitproberen** (naast *Opslaan*): speel de quiz proef in een splitscreen — links wat jij/de beamer ziet, rechts wat een leerling op de gsm ziet. Je speelt rechts mee, drie bots doen ook mee, niets wordt bewaard. *▶ Vanaf hier* bij een vraag start bij die vraag.
7. Niet mogelijk tijdens een toets, taak, examensessie of individuele werkfase. Resultaten vind je later onder *Gespeelde spellen*.

### Wissen bij oefeningen, codevoorbeelden en links
**Wissen** haalt de getoonde oefening, het getoonde voorbeeld of de getoonde link uit de lijst: bij 3 oefeningen wordt 1/3 dus 1/2. Het laatste item blijft als leeg veld staan. Klik daarna op **Bewaar** om de kortere lijst ook bij de sessie te bewaren.

### Toets of taak maken

- Je krijgt je eigen vragen; bij sommige toetsen zijn de getallen in een vraag voor jou anders dan voor een klasgenoot. Bij herladen blijft alles gelijk.
- Staat **kopiëren/plakken geblokkeerd**, dan werkt Ctrl+C/V, rechtsklik en slepen niet. Pogingen worden geregistreerd.
- Bij het starten van een toets bevestig je (vinkje) dat alle andere tabbladen en programma's gesloten zijn. Open je dezelfde toets in twee tabbladen, dan werkt enkel het eerste.
- Kom je terug uit een ander venster of tabblad, dan verschijnt een scherm "Je hebt de toets verlaten"; klik op *Doorgaan*. Je tijd loopt gewoon door en je afwezigheid wordt gelogd.
- Is je toets automatisch ingediend, dan kan je leerkracht je weer binnenlaten. Je eindtijd blijft dezelfde; bij *1 kans per vraag* kom je op de eerste vraag die je nog niet bevestigd had.
- Bij **volledig scherm** moet je in volledig scherm blijven; bij **tabwissel** kan de toets automatisch ingediend worden (let op de waarschuwing).
- Bij meerkeuze met meerdere juiste opties: kies enkel wat je zeker weet. Een fout aangeduide optie kost meer dan een gemiste, en alles aanduiden geeft 0.
- Is er een **cursuslink** bij de vraag, dan staat die in het zijpaneel (tabs als er meerdere zijn).

### Werkblad naar de klas kopiëren

In klasmodus kopieert **⇪ Naar klas** (naast Run) je werkblad naar de gedeelde klascode, als je daar bewerkrecht op hebt. De leerkracht ziet "… heeft zijn code naar de klas gezet".

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

*PyCodeFlow · Atheneum Hoboken · user-manual.md · v2026.2.23.0*

# PyCodeFlow — Gebruikershandleiding

> **v2026.2.6.1** · Atheneum Hoboken
> URL: `https://app.pycodeflow.org`

---

## Inhoudsopgave

1. [Voor de systeembeheerder](#1-voor-de-systeembeheerder)
2. [Voor de leerkracht](#2-voor-de-leerkracht)
3. [Voor de leerling — klassessie](#3-voor-de-leerling--klassessie)
4. [Voor de leerling — examenmodus](#4-voor-de-leerling--examenmodus)
5. [Voor de leerling — vrije editor](#5-voor-de-leerling--vrije-editor)

---

## 1. Voor de systeembeheerder

### 1.1 Eerste keer opzetten

Na een nieuwe installatie bestaat er nog geen leerkrachtenaccount. Maak er één aan via de terminal op de NAS:

```bash
cd /volume3/docker/pycodeflow
docker compose exec web node scripts/manage-teacher.js add bjorn MijnWachtwoord123
```

Verifieer daarna of alles correct werkt:

```bash
bash check-deployment.sh
```

Je zou 110+ groene vinkjes moeten zien. Rode kruisjes vereisen actie.

### 1.2 Leerkrachtenaccounts beheren

```bash
# Nieuwe leerkracht toevoegen
docker compose exec web node scripts/manage-teacher.js add <gebruiker> <wachtwoord>

# Alle accounts bekijken
docker compose exec web node scripts/manage-teacher.js list

# Wachtwoord resetten (bijv. als een leerkracht het vergeten is)
docker compose exec web node scripts/manage-teacher.js reset-password <gebruiker> <nieuwWachtwoord>

# Account verwijderen
docker compose exec web node scripts/manage-teacher.js delete <gebruiker>
```

> **Belangrijk:** wachtwoorden staan nergens in een tekstbestand. Ze worden veilig opgeslagen als hash in de database. Zelfs de systeembeheerder kan een wachtwoord niet terugvinden — enkel resetten.

### 1.3 Updates installeren

Wanneer er nieuwe bestanden beschikbaar zijn:

1. Kopieer de bestanden naar de juiste locaties op de NAS
2. Voer uit:

```bash
cd /volume3/docker/pycodeflow
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

3. Controleer nadien:

```bash
bash check-deployment.sh
docker compose logs web --tail=20
```

Je zou `Listening on http://localhost:3000` moeten zien, zonder foutmeldingen.

### 1.4 Systeembeheer via de browser

Ga naar `https://app.pycodeflow.org/monitoring.html` (login vereist).

Hier zie je:

- **Live runner stats** — hoeveel Python-code er tegelijk uitgevoerd wordt
- **Historiek grafiek** — belasting over de laatste 10 minuten
- **Lopende sessies** — welke lessen actief zijn
- **Stresstest module** — test de server proactief voor een les begint

#### Stresstest uitvoeren

Selecteer een testtype en klik "▶ Test starten":

| Test | Wat het doet | Wanneer gebruiken |
|---|---|---|
| 🩺 Gezondheidscheck | Snel alles controleren | Elke ochtend |
| 🚀 Runner capaciteit | X runs tegelijk starten | Voor een grote les |
| 🔒 Sandbox verificatie | Gevaarlijke code proberen | Na een update |
| 🏫 Gelijktijdige sessies | Meerdere klassen simuleren | Voor een examendag |
| 📈 Ramp-up | Geleidelijk opschalen tot piek | Capaciteitstest |
| ⏳ Sustained load | Constante belasting X seconden | Stabiliteitstest |
| 🔍 Memory leak | 50 runs + geheugen vergelijken | Na een update |
| 🔧 Runner API | Volledige run-cyclus testen | Na een update |
| 💪 Volledig | Alles in volgorde | Uitgebreide test |

Gebruik de **sliders** om het aantal gelijktijdige runs en sessies in te stellen. De **"⬆ Max veilig"**-knop vult automatisch de maximale veilige waarden in. De kleurgecodeerde banner toont hoeveel procent van de runner-capaciteit je gebruikt.

### 1.5 Logs bekijken

Stresstest logs worden opgeslagen in `/volume3/docker/pycodeflow/logs/`. Ze zijn ook downloadbaar via de monitoring-pagina.

Vrije sessie auditlog (wie heeft wanneer code gerund):
```bash
cat /volume3/docker/pycodeflow/logs/free-audit.log
```

Server logs:
```bash
docker compose logs web --tail=50
docker compose logs runner --tail=20
```

### 1.6 Veelgestelde vragen

**De server start niet op ("Bad gateway")**
```bash
docker compose logs web --tail=30
```
Zoek naar `SyntaxError` of `Error`. Stuur de output naar de ontwikkelaar.

**Een leerling kan niet inloggen / sessie niet gevonden**
Controleer of de sessiecode correct is (6 tekens, geen O/0/I/1 verwarring). Controleer of de sessie niet gesloten is in teacher-sessions.

**Geen opslag meer beschikbaar**
```bash
du -sh /volume3/docker/pycodeflow/data/
du -sh /volume3/docker/pycodeflow/logs/
```
Oude logbestanden kunnen handmatig verwijderd worden.

---

## 2. Voor de leerkracht

### 2.1 Inloggen

Ga naar `https://app.pycodeflow.org`. Klik op "Leerkrachtenplatform" of ga direct naar `/teacher-sessions.html`. Log in met je gebruikersnaam en wachtwoord.

Bij vergeten wachtwoord: neem contact op met de systeembeheerder. Die kan het resetten via de CLI.

### 2.2 Een sessie aanmaken

1. Klik op **"Nieuwe sessie"**
2. Kies een naam (bijv. "Python les 6A")
3. Kies het type:
   - **Klasmodus** — voor gezamenlijk werken, één gedeelde editor
   - **Examenmodus** — elke leerling werkt in zijn eigen privé-editor
4. Kies eventueel een **starttemplate** (9 voorgeladen Python-oefeningen)
5. Klik **"Sessie aanmaken"**

Je wordt automatisch doorgestuurd naar de lessessie. De **sessiecode** (6 tekens) is zichtbaar voor de leerlingen.

### 2.3 Leerlingen laten joinen

Leerlingen gaan naar `https://app.pycodeflow.org`, klikken op **"Deelnemen"** en voeren:
- hun naam in
- de 6-tekens sessiecode

Projecteer de sessiecode op het bord of deel hem via Smartschool.

### 2.4 Klasmodus — gedeeld werken

**Standaard**: alle leerlingen zien en typen in de gedeelde editor. Jouw aanpassingen worden live gebroadcast.

**Run all** — start de gedeelde code bij alle leerlingen tegelijk.

**Naar individuele werkfase**:
Klik op "Individueel" om elke leerling een eigen leeg werkblad te geven. De gedeelde code blijft zichtbaar op het Klascode-tabblad maar is niet meer bewerkbaar. Leerlingen werken nu op hun persoonlijk werkblad.

Terug naar gedeeld: klik opnieuw op "Gedeeld".

### 2.5 Klasmodus — leerlingenlijst

Per leerling zie je:
- **online/offline** status
- **✓ Klaar** badge (groen) als de leerling klaar gemeld heeft
- **✋ Hand op** badge (geel, knipperend) als de leerling een vraag heeft
- **⚠️ Tab verlaten** badge (rood) in examenmodus

**Knoppen per leerling:**
- **✓ Reset** — wis de klaar-status van die leerling
- **✋ Wissen** — wis de hand van die leerling
- **📜 History** — bekijk hoe de code van die leerling is geëvolueerd
- **Run aan/uit** — blokkeer of sta toe dat leerling runt (klasmodus)
- **Code aan/uit** — blokkeer of sta toe dat leerling typt (klasmodus)
- **Verwijderen** — zet leerling terug naar de startpagina

**Bovenaan de leerlingenlijst:**
- **Zoekfilter** — type om te filteren op naam
- **Run all** / **Code all** — voor de hele klas tegelijk
- **↺ Klaar resetten** — zet alle klaar-statussen terug naar bezig

**Voortgangsteller**: `X online · Y ✓ klaar · Z ✋ · W ⚠️ tab weg`

### 2.6 Opdracht sturen naar leerlingen

In het rechterpaneel staat een tekstvak "Opdracht voor leerlingen". Typ je opdrachttekst en klik **"Sturen"**. De tekst verschijnt direct bij alle leerlingen bovenaan hun scherm.

**Vorige aankondigingen** verschijnen als klikbare chips eronder. Klik op een chip om die tekst terug in het tekstvak te laden.

**Wissen** — verwijdert de opdracht bij alle leerlingen.

### 2.7 Code-voorbeeld sturen

Klik op **"📎 Voorbeeld"** in de editor toolbar om de huidige code als read-only referentie naar alle leerlingen te sturen. Leerlingen zien een nieuw tabblad "📎 Voorbeeld" verschijnen.

Klik op **"✕ Voorbeeld"** (verschijnt nadat je verstuurd hebt) om het voorbeeld te verwijderen.

> Het voorbeeld vervangt **niet** de persoonlijke code van de leerling.

### 2.8 Annotaties toevoegen

Klik op **"📌 Annoteer"** in de editor toolbar. Een floating panel verschijnt rechtsonder:

1. Kies **start- en eindregel** (bijv. 5 tot 8)
2. Kies een **kleur** (geel / blauw / groen / rood)
3. Typ een korte **boodschap** (bijv. "Let op de inspringing hier!")
4. Klik **"📌 Verstuur"**

Alle leerlingen zien die regels gemarkeerd met de kleur en de boodschap als tooltip bij hover. Als een leerling op dat moment niet op het Klascode-tabblad staat, krijgt hij een melding onderaan het scherm.

Klik **"✕ Wis alle"** om alle annotaties bij leerlingen te verwijderen.

> **Beperking:** annotaties verschijnen op de gedeelde editor. In examenmodus ziet elke leerling dezelfde annotatie op dezelfde regelnummers, ongeacht zijn persoonlijke code.

### 2.9 Countdown timer

In het rechterpaneel staat een timer-widget:

1. Stel het aantal **minuten** in (1–90)
2. Klik **"Start"**

Alle leerlingen zien de timer linksboven hun editor. Onder de minuut kleurt de timer rood.

Klik **"Stop"** om de timer vroegtijdig te stoppen.

### 2.10 Code-geschiedenis bekijken

Klik op **"📜 History"** naast een leerling om te zien hoe zijn code geëvolueerd is:

- Een tijdlijnschuif toont alle opgeslagen momenten
- Gebruik **⏮ Vorige** / **Volgende ⏭** om stap voor stap te doorlopen
- Klik **▶ Afspelen** voor automatisch afspelen (kies snelheid: langzaam / normaal / snel / zeer snel)
- Het tijdstip van elk snapshot staat links bovenaan

> Snapshots worden elke 10 seconden automatisch opgeslagen zodra een leerling code typt.

### 2.11 Live meekijken bij leerling (Live control)

Klik op **"Live control"** naast een leerling in examenmodus. De editor toont dan de live code van die leerling. Je kan zijn code ook zelf runnen via de Run-knop.

Klik op een andere leerling om te wisselen, of klik op "Terug naar sessie" om de gedeelde weergave te herstellen.

### 2.12 Sessie exporteren

Klik op **"⬇ Export"** om alle leerlingencode en output te downloaden als `.txt` bestand. Bevat per leerling:
- Naam
- Code
- Laatste output
- Tab-detectie info (indien examenmodus)

### 2.13 Tweede leerkracht laten meekijken

Een tweede leerkracht gaat naar teacher-sessions.html en klikt op **"👁 Waarnemen"** naast de sessie. Ze zien alles wat jij ziet, maar kunnen niets aanpassen.

### 2.14 Sessiebeheer

- **Sessie blokkeren** — nieuwe leerlingen kunnen niet meer joinen (bestaande blijven verbonden)
- **Sessie afsluiten** — alle leerlingen worden teruggestuurd naar de startpagina, sessie blijft in de lijst
- **Sessie verwijderen** — sessie permanent verwijderd

### 2.15 Dark mode

Klik op **🌙** (rechtsboven) om naar donker thema te wisselen. Klik op **☀️** om terug te gaan. Voorkeur wordt onthouden per browser.

---

## 3. Voor de leerling — klassessie

### 3.1 Joinen

1. Ga naar `https://app.pycodeflow.org`
2. Klik op **"Deelnemen"**
3. Vul je **naam** in (zoals je leerkracht vraagt — bijv. voornaam + achternaam)
4. Vul de **sessiecode** in (6 tekens, te zien op het bord)
5. Klik **"Deelnemen"**

### 3.2 De editor

Je ziet drie tabbladen:
- **Klascode** — de gedeelde code van de leerkracht (lees-only of bewerkbaar, afhankelijk van de fase)
- **Mijn werkblad** — jouw persoonlijke werkruimte (zichtbaar in individuele werkfase)
- **Output** — de uitvoer van je laatste run

Druk op **Run** (of **Ctrl+Enter**) om je code uit te voeren. De output verschijnt op het Output-tabblad.

### 3.3 Gedeelde werkfase vs. individuele werkfase

**Gedeelde werkfase**: je kan de leerkracht zien typen in de Klascode-editor. Afhankelijk van de instellingen kan jij ook typen.

**Individuele werkfase**: je krijgt een eigen leeg werkblad op "Mijn werkblad". Typ je code hier. De leerkracht kan dit niet zien. Op het Klascode-tabblad staat nog de referentiecode van de leerkracht.

### 3.4 Invoer geven tijdens een run

Als je code om invoer vraagt (`input()`), verschijnt een invoerveld onderaan de output. Typ je antwoord en druk Enter.

### 3.5 Hand opsteken

Klik op **"✋ Hand opsteken"** als je een vraag hebt. De leerkracht ziet een geel badge verschijnen bij jouw naam. Klik nogmaals om de hand te laten zakken.

### 3.6 Klaar melden

Klik op **"✓ Klaar"** als je de oefening afgewerkt hebt. De knop kleurt groen en de leerkracht ziet een vinkje naast jouw naam.

Klik nogmaals om terug op "bezig" te gaan.

### 3.7 Voorbeeld van de leerkracht

Als de leerkracht een voorbeeld stuurt, verschijnt er een nieuw tabblad **"📎 Voorbeeld"** (knippert kort oranje). Klik erop om de referentiecode te bekijken. Dit vervangt **nooit** jouw eigen code.

### 3.8 Annotaties van de leerkracht

Als de leerkracht regels markeert, zie je gekleurde achtergronden in de editor. Beweeg je muis over de gemarkeerde regels om de boodschap te lezen.

### 3.9 Timer

Als de leerkracht een timer start, zie je een afteller links van de Run-knop. Onder de minuut kleurt hij rood.

### 3.10 Autosave

Je persoonlijke code wordt automatisch bewaard in de browser. Bij een onverwachte herverbinding staat je code er nog. Je ziet een korte "💾 Concept opgeslagen" melding als het opgeslagen wordt.

### 3.11 Herverbinden

Als je verbinding wegvalt en je de pagina herlaadt, verbind je automatisch terug met dezelfde sessie. Je code en naam worden onthouden.

---

## 4. Voor de leerling — examenmodus

In examenmodus heeft iedereen een volledig privé-editor. De leerkracht kan meekijken maar jij ziet de code van klasgenoten **niet**.

### 4.1 Joinen

Zelfde als een klassessie: ga naar `https://app.pycodeflow.org`, klik "Deelnemen", vul naam en sessiecode in.

### 4.2 Je editor gebruiken

- Typ je code in de editor
- Druk **Run** of **Ctrl+Enter** om uit te voeren
- De output verschijnt rechts of onderaan

### 4.3 Tab-detectie

Als je het browservenster van PyCodeFlow verlaat (naar een andere tab gaat, het venster minimaliseert), registreert het systeem dit. De leerkracht ziet:

- Hoe vaak je de tab verlaten hebt
- Hoe lang je weg was

> Blijf op de PyCodeFlow tab tijdens het examen.

### 4.4 Klaar melden

Klik op **"✓ Klaar"** als je klaar bent. De leerkracht ziet dit.

---

## 5. Voor de leerling — vrije editor

De vrije editor laat je Python oefenen **zonder sessiecode**. Niemand ziet jouw code.

### 5.1 Starten

1. Ga naar `https://app.pycodeflow.org`
2. Klik op **"Vrij oefenen"**
3. Vul je **naam** en **klas** in
4. Klik **"Start"**

### 5.2 Werken in de vrije editor

Identiek aan de klassessie:
- Typ Python code in de editor
- Druk **Run** of **Ctrl+Enter**
- Geef invoer als je code dat vraagt
- Syntax-fouten worden onderstreept in de editor (rood)

### 5.3 Herverbinden

Naam en klas worden onthouden in de browser. Als je de pagina herlaadt, hoef je enkel opnieuw op "Start" te klikken.

### 5.4 Zichtbaarheid voor leerkracht

De leerkracht ziet op de sessie-beheerpagina een lijst van leerlingen die vrij oefenen (naam + klas + tijdstip). Je code zelf is **niet** zichtbaar voor de leerkracht.

---

*PyCodeFlow · Atheneum Hoboken · v2026.2.6.1*

## v2026.2.51.55 — Bugfix: footer ontbrak op bijna alle schermen + groene selectie-indicatie + ping verder verstrakt

### De echte oorzaak van de ontbrekende footer
`injectFooter()` (de functie die overal de standaardfooter opbouwt: "© 2026 PyCodeFlow
— ontwikkeld door B. Claes • vX.X.X.X • Privacy") was in `app.js` wél **gedefinieerd**,
maar werd nergens **aangeroepen** — dode code. Daardoor kregen alle pagina's die enkel
app.js laden en zelf geen eigen footer-oplossing hebben — `mijn-klassen.html`,
`klasmatrix.html`, `admin.html`, `monitoring.html`, `teacher-app.html`,
`teacher-sessions.html`, `student-thuis.html`, `sjablonen.html`, alle `quiz-*.html`,
`taak-/toets-overzicht.html`, `free-editor.html`, `teacher-grid.html` — helemaal geen
footer. Nu wordt `injectFooter()` bovenaan het bestand geregistreerd op
`DOMContentLoaded`, zodat de footer gegarandeerd verschijnt, ongeacht wat er verderop
in het bestand op een specifiek scherm eventueel misloopt. `teacher-grid.html` (dat
zelfs geen app.js laadt) kreeg er `footer-note.js` bij voor dezelfde standaardfooter.

### Groene selectie-indicatie op mijn-klassen.html en klasmatrix.html
De sub-navigatiebalk gebruikt CSS-regel `.subnav a.active` om de huidige pagina te
markeren — maar deze twee pagina's gebruikten per ongeluk `class="actief"` (Nederlands)
in plaats van `class="active"` (Engels), een naam die nergens mee overeenkwam. Simpele
tikfout, nu gecorrigeerd; de huidige pagina krijgt voortaan overal dezelfde groene
markering in de sub-navigatie.

### Ping-timing verder verstrakt
Na de vorige verstrakking (~10s) voelde dat nog steeds traag. Verder aangedraaid naar
een worst-case van **~5 seconden** voor het detecteren van een stil weggevallen
verbinding, plus een nog snellere clientherverbinding. Bewust niet extremer: te
agressief zou net valse disconnects kunnen triggeren bij doodgewone
netwerkschommelingen op een druk klaslokaal-netwerk.

**Getest:** volledige testsuite (338 tests) blijft 100% groen; de gecorrigeerde
`class="active"` bevestigd aanwezig in de uitgeserveerde HTML via een live, ingelogde
serverronde. De footer zelf wordt door JavaScript in de browser toegevoegd (niet
zichtbaar in de kale server-HTML) — dat stuk is dus gecontroleerd via grondige
codereview (functie correct gedefinieerd, exact één keer aangeroepen, geen
syntaxfouten) in plaats van een directe visuele test, omdat hier geen browser
beschikbaar is om dat te renderen.

**Betrokken bestanden:** `web/public/app.js` · `web/public/teacher-grid.html` ·
`web/public/klasmatrix.html` · `web/public/mijn-klassen.html` · `web/server.js` ·
`VERSION` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.54 — Bugfix: 30-40s vertraging (of geheel geen doorkomen) bij run/code vrijgeven of blokkeren

### De oorzaak
socket.io stond ingesteld op `pingTimeout: 20000` + `pingInterval: 25000` — bij een
STIL weggevallen verbinding (bv. een kortstondige wifi-hapering zonder nette
TCP-afsluiting, heel gewoon op een druk klaslokaal-netwerk met veel toestellen) kon de
server tot **45 seconden** blijven denken dat een leerling nog verbonden was.
Zolang dat duurde, gingen ALLE server→leerling-meldingen (run/code vrijgeven of
blokkeren, individueel of "voor iedereen", de "leerkracht niet ingelogd"-melding, …)
gewoon nergens heen: `student.socketId` op de server wees nog naar die dode
verbinding. Pas zodra de server dat eindelijk opmerkte — of een handmatige F5 het
kortsloot — kwam alles in één keer door. Dit verklaart zowel de vertraging (~30-40s,
dicht bij de 45s-limiet) als "soms werkt het niet" (als de video net afliep vóór de
timeout verstreek).

### De fix
- Server: dode verbindingen worden nu binnen **~10 seconden** opgemerkt in plaats van
  tot 45s (`pingTimeout`/`pingInterval` fors verstrakt, zonder overdreven agressief te
  worden — dat zou net valse disconnects kunnen triggeren bij normale
  netwerkschommelingen).
- Client: de herverbindingsvertraging na een gedetecteerde disconnect is verkort, zodat
  de herverbinding zelf (en dus elke wachtende melding) merkbaar sneller hersteld is.

Samen met de sprint 60.2-fix (`student_reconnect` bij elke herverbinding i.p.v. enkel
bij paginalading) zou een écht weggevallen verbinding zich nu binnen enkele seconden
moeten herstellen in plaats van tot 45 seconden.

**Getest:** volledige testsuite (338 tests) blijft 100% groen; server opgestart en
bevestigd foutloos met de nieuwe instellingen. De exacte, real-world timing van een
stille verbindingsonderbreking is inherent moeilijk in enkele seconden te simuleren in
een geautomatiseerde test — laat gerust weten of dit in de praktijk voldoende
verbetert, of dat de instellingen nog verder bijgesteld moeten worden.

**Betrokken bestanden:** `web/server.js` · `web/public/app.js` · `VERSION` ·
overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.53 — Leerkrachtenscherm herschikt: Leerlingen over volle hoogte

Onder de code-editor stonden Leerlingen/Status/Systeem/Sessie voorheen in ÉÉN kolom
gestapeld — omdat de Leerlingenlijst van nature langer is dan de andere drie, bleef er
rechts steeds lege ruimte over onderaan. Nieuwe indeling (CSS Grid met expliciete
rij/kolomplaatsing):

- **Sessie** (iets smaller, meer hoogte voor o.a. de countdown-timer) onder de
  code-editor, links.
- **Status** en **Systeem** ernaast, gestapeld onder elkaar.
- **Leerlingen** rechts, over de volle hoogte van editor + Sessie samen — kan nu
  groeien zonder dat de rest uitgerekt of te laag wordt.

Op smalle schermen (onder 980px) valt alles gewoon terug naar één kolom, in dezelfde
volgorde als voorheen.

**Getest:** volledige testsuite (338 tests) blijft 100% groen (zuiver layout, geen
backend-impact); bevestigd via een live, ingelogde serverronde dat de nieuwe
grid-structuur en -klassen effectief in de uitgeserveerde pagina staan.

**Betrokken bestanden:** `web/public/teacher-app.html` · `web/public/styles.css` ·
`VERSION` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.52 — Bugfix: "leerkracht niet ingelogd"-popup bleef soms ~10s hangen (F5 nodig)

### De échte oorzaak
`student_reconnect` — het event dat de server vertelt "dit is DEZE leerling, koppel me
aan hun sessie" — werd voorheen maar **één keer** verstuurd, meteen bij het laden van
`student-app.html`. Niet telkens de onderliggende socket zelf herverbindt (bv. na een
korte netwerkhapering, wifi-hapering, of gewoon socket.io's eigen periodieke
herverbinding — zónder dat de leerling de pagina herlaadt). socket.io geeft een
herverbonden socket een NIEUW id; zonder een nieuwe `student_reconnect` bleef de server
dan naar de oude, dode verbinding wijzen (`student.socketId`) — waardoor **geen enkele**
server→leerling-melding meer aankwam, inclusief de nieuwe "leerkracht niet
ingelogd"-popup uit v2026.2.51.48. Pas een volledige F5 (die dit stuk code opnieuw
uitvoert) herstelde de koppeling.

### De fix
`student_reconnect` wordt nu verstuurd bij **elke** `'connect'`-gebeurtenis — die vuurt
zowel bij de allereerste verbinding als bij elke latere, stille herverbinding.
Bijkomend, als extra vangnet: zolang de "leerkracht niet ingelogd"-popup zichtbaar is,
vraagt de leerling-kant elke 3 seconden actief de actuele status op (nieuw, side-effect-
vrij server-event `student_check_status`) — zodat een eventuele gemiste melding zich
sowieso binnen enkele seconden zelf corrigeert, ongeacht de precieze oorzaak.

**Getest:** een end-to-end socket.io-smoketest die het exacte scenario naspeelt (sessie
aangemaakt → leerkracht verlaat meteen → leerling joint, ziet popup → leerling-socket
valt weg en herverbindt ZONDER paginaherlading → leerkracht logt écht in) bevestigt dat
de herverbonden leerling meteen de correcte, live status krijgt — geen F5 meer nodig.
Volledige testsuite (338 tests) blijft daarnaast 100% groen.

**Betrokken bestanden:** `web/server.js` · `web/public/app.js` · `VERSION` ·
overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.51 — Bugfix: gekleurde randen ontbraken + kleurenlayout leerkrachten-sessieoverzicht

### Waarom de gekleurde randen niet zichtbaar waren
Op `student-login.html`, `student-register.html` en `student-thuis.html` was de
`panel-accent-*`-kleurklasse wel netjes toegevoegd, maar zonder zichtbaar effect: elke
pagina heeft een eigen, pagina-lokale `<style>`-blok dat óók een `border` instelt op
diezelfde `.auth-card`/`.blok`-klasse — en omdat dat lokale blok ná `styles.css` in de
broncode staat, won die (kleurloze) rand bij gelijke CSS-specificiteit altijd. Opgelost
door de `border`(/`background`)-declaratie uit die 3 pagina-lokale stijlen te
verwijderen; `panel-accent-*` in `styles.css` bepaalt nu overal de rand.

### Nieuw: kleurenlayout voor het leerkrachten-sessieoverzicht
`teacher-sessions.html` krijgt dezelfde 3-kleurenbehandeling als het leerlingenscherm:
**Nieuwe sessie** (groen), **Lopende sessies** (blauw), **Vrije sessie** (roodoranje) —
plus de kleurstaaf onderaan. Terloops ook de vastgeklikte topbalk-afstand (`subnav`)
bijgewerkt naar de nieuwe, hogere topbalk (was nog op de oude 72px afgestemd).

**Getest:** volledige testsuite (338 tests) blijft 100% groen; alle 4 gewijzigde
bestanden bevestigd via een live serverronde (incl. ingelogde sessie voor
teacher-sessions.html) — geen pagina-lokale `border:` meer op de betrokken klassen, en
de 3 kleurklassen + kleurstaaf effectief aanwezig in de uitgeserveerde HTML.

**Betrokken bestanden:** `web/public/student-login.html` ·
`web/public/student-register.html` · `web/public/student-thuis.html` ·
`web/public/teacher-sessions.html` · `VERSION` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.50 — Bugfix: leerkracht-blokkade werkte niet als de leerkracht enkel op het sessieoverzicht stond

### Het echte probleem
De vorige fix (v2026.2.51.48) verwittigde leerlingen correct wanneer de leerkracht
**disconnect**e (bv. de browser sluit, of de verbinding valt echt weg). Maar `session.
teacherSocketId` wordt AL bij het **aanmaken** van een sessie gezet op de socket van de
makende leerkracht — en als die leerkracht nadien gewoon op het sessieoverzicht blijft
staan (zoals in het gemelde geval: sessie "actief", maar nooit op "Open" geklikt), blijft
diezelfde socket-verbinding gewoon bestaan. Er gebeurt dan geen disconnect, dus
`teacherSocketId` bleef onterecht bezet — leerlingen zagen nooit de melding, ook al zat
er niemand écht "in" de sessie.

### De fix
Nieuw, expliciet signaal `teacher_leave_all_sessions`: `teacher-sessions.html` (de
lijst-pagina, nooit een specifieke sessie) stuurt dit meteen bij het laden. De server
zoekt dan alle sessies waar deze socket nog als `teacherSocketId` geregistreerd staat,
zet die terug op leeg, en verwittigt de leerlingen — ongeacht OF er een échte disconnect
plaatsvond. Dit dekt zowel "sessie aangemaakt en op de lijst blijven staan" als eventuele
andere gevallen waarbij een disconnect om wat voor reden dan ook niet (tijdig) doorkwam.

**Getest:** een gerichte end-to-end socket.io-smoketest die exact het gemelde scenario
naspeelt (leerkracht maakt sessie aan, blijft verbonden zonder te disconnecten, leerling
joint) bevestigde eerst de bug (`teacherOnline:true` terwijl de leerkracht enkel op het
overzicht stond) en daarna de fix (`teacherOnline:false` na `teacher_leave_all_sessions`).
Volledige testsuite (338 tests) blijft daarnaast 100% groen.

**Betrokken bestanden:** `web/server.js` · `web/public/app.js` · `VERSION` ·
overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.49 — Nieuwe stijl doorgevoerd op index, registratie, sessiekeuze

Vervolg op de warme-stijl-omslag (v2026.2.51.47): vijf bijkomende schermen krijgen
dezelfde behandeling.

### Index (rol-keuzescherm)
Blauwe accentkleur (zoals het leerkrachten-inlogscherm) op de hero-kaart; "Ik ben
leerkracht" is nu een effen marineblauwe knop i.p.v. een bleke pil; kleurstaaf onderaan;
de bestaande, server-side ingevulde footer (`{{APP_VERSION}}`) is nu via de gedeelde
`.footer-note`-stijl consistent met de rest van de app.

### Account aanmaken (registratie) + inloggen (leerlingen)
Beide kregen dezelfde blauwe accentkleur, een "Home"-knop in de kop, de correcte
standaardfooter (`student-register.html` laadde voorheen `footer-note.js` niet eens en
had ook geen "Home"-knop — hetzelfde euvel als eerder bij `student-login.html`), en de
kleurstaaf onderaan. Ook de twee inlogschermen (leerling én leerkracht) kregen alsnog
de kleurstaaf, want die ontbrak er nog.

### Sessiekeuze (student-thuis.html — "Waar wil je naartoe?")
Zelfde herstructurering als bij het gastenscherm (student-start.html, v2026.2.51.40):
de twee hoofdopties — **Open lessen van jouw klas** (dropdown) en **Ik heb een
sessiecode** (voor een toets/taak) — staan nu naast elkaar in een breder, responsief
grid (2 kolommen vanaf 980px, erna 1 kolom), met **Vrij oefenen** als apart, volle-
breedte blok eronder. Zelfde groen/blauw/roodoranje-kleurencombinatie als op het
gastenscherm, plus de kleurstaaf onderaan.

**Betrokken bestanden:** `web/public/index.html` · `web/public/student-register.html` ·
`web/public/student-login.html` · `web/public/teacher-login.html` ·
`web/public/student-thuis.html` · `web/public/styles.css` · `VERSION` ·
overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.48 — Leerling-blokkade wanneer leerkracht niet ingelogd is + reset-logica

### Het probleem
Een leerling kon een gewone (klas-/examen)sessie gewoon "binnen", zelfs als de
leerkracht daar helemaal niet (meer) op ingelogd was — `session.teacherSocketId` werd
wel `null` gezet bij het wegvallen van de leerkracht, maar dat werd nergens naar de
leerling doorgestuurd. Diens scherm bleef gewoon staan zoals het was (code zichtbaar,
soms zelfs nog "run" aan), zonder enige aanwijzing dat er niemand meer aan het stuur zat.

### Blokkerende melding bij de leerling
Zodra `session.teacherSocketId` leeg is, toont `student-app.html` nu een **fixed
overlay-popup** ("Je leerkracht is nog niet ingelogd") bovenop het scherm (dat blijft
erachter zichtbaar/geladen). De leerling kan:
- **wachten** — de popup verdwijnt automatisch zodra de leerkracht opnieuw inlogt op de
  sessie, of
- **de popup sluiten** via "Terug naar mijn overzicht" → `student-thuis.html`.

Dit werkt zowel bij het **joinen** (leerling komt binnen terwijl de leerkracht al weg
is) als **live** (leerkracht valt weg terwijl de leerling al aan het werk is) — beide
paden sturen nu een bijgewerkte `student_state` (met het nieuwe `teacherOnline`-veld)
naar alle actieve leerlingen in de sessie.

### Reset-logica bij het (opnieuw) inloggen van de leerkracht
Bij elke `teacher_join_session` op een sessie **die op dat moment in klasmodus staat**
(gedeelde code, `classWorkspaceMode === 'shared'`) worden ALLE leerlingen teruggezet
naar **geen recht op code, geen recht op run** — ongeacht wat daarvoor ingesteld stond.
Staat de sessie op **individuele werkmodus**, dan wordt niets aangeraakt. Dit dekt élke
manier waarop de leerkracht terugkeert na Sessieoverzicht, Afmelden, Home, of een
verbindingsonderbreking — die lopen in deze niet-SPA-opzet allemaal via dezelfde
`teacher_join_session`. **Geldt uitdrukkelijk niet voor toets-/taaksessies** (die
gebruiken een eigen, apart controlesysteem).

**Getest:** een volledige end-to-end socket.io-smoketest (leerkracht maakt sessie aan →
leerling joint → rechten expliciet aangezet → leerkracht valt weg (bevestigd:
`teacherOnline:false`, rechten blijven ongewijzigd) → leerkracht logt opnieuw in
(bevestigd: `teacherOnline:true` én rechten teruggezet naar false)) — alle beweringen
geslaagd. Volledige testsuite (338 tests) blijft daarnaast 100% groen.

**Betrokken bestanden:** `web/server.js` · `web/public/app.js` ·
`web/public/student-app.html` · `web/public/styles.css` · `VERSION` ·
overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.47 — Warme stijl definitief, schuifknopje weg, leerkrachten-inlog groter

### De nieuwe stijl is nu de enige, permanente stijl
Het experiment (schuifknopje "Nieuwe stijl proberen" / "Te verfrissend? → oude look")
is afgerond en goedgekeurd. Alle inhoud van `theme-warm.css` is samengevoegd in
`styles.css` zelf (onvoorwaardelijk, geen `data-theme`-attribuut meer nodig).
`theme-warm.css` en `theme-toggle.js` zijn verwijderd, samen met het schuifknopje op
alle drie de betrokken schermen (Deelnemen, leerling-inlog, leerkracht-inlog).

**De oude (koel-blauwe) stijl blijft volledig bewaard** in het nieuwe
`web/public/styles-classic-archief.css` — een niet-ingeladen archiefbestand met alle
oorspronkelijke waarden. Wil je ooit terugkeren: kopieer de inhoud terug naar
`styles.css`.

### Hoogte-bug op de inlogschermen
Op beide inlogschermen (leerling én leerkracht) zorgde de sitebrede regel
`html, body { min-height:100% }` ervoor dat de pagina altijd minstens de volledige
vensterhoogte kreeg, met een leeg gat tussen het (korte) kaartje en de footer op elk
venster dat hoger is dan de eigenlijke inhoud. Nieuwe `body.compact-page`-klasse
schakelt dat specifiek op deze twee schermen uit — de footer volgt nu meteen na de
kaart, net zoals op het leerling-platform.

### Leerkrachten-inlogscherm ~15% groter
Kaart, logo, titel, invoervelden en de aanmeld-knop zijn ongeveer 15% vergroot,
getoetst tegen een 1366×768 chromebookscherm (totale paginahoogte komt daarmee op
ongeveer 700px — past nog ruim).

### Terloops
- De titel "Deelnemen" behoudt haar kleinere formaat via een nieuwe, specifieke
  `.titel-compact`-klasse i.p.v. een generieke `.screen h1`-regel — zo blijven alle
  ANDERE pagina-titels in de app op hun gewone formaat.
- De pagina-achtergrond (`body`, en `.bg-page` op het leerkrachtenscherm) gebruikt nu
  overal `var(--bg)` in plaats van een hard gecodeerde kleur.

**Betrokken bestanden:** `web/public/styles.css` ·
`web/public/styles-classic-archief.css` (nieuw, archief) ·
`web/public/student-start.html` · `web/public/student-login.html` ·
`web/public/teacher-login.html` · `web/public/theme-warm.css` (verwijderd) ·
`web/public/theme-toggle.js` (verwijderd) · `VERSION` ·
overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.46 — Te veel lege ruimte op het leerkrachten-inlogscherm

Het inlogkaartje werd verticaal gecentreerd over (bijna) de volle vensterhoogte
(`calc(100vh - 220px)`) — op een normaal, hoog browservenster gaf dat een veel te grote
lege ruimte boven en onder het kaartje. Nu, net als bij het leerling-inlogscherm, gewoon
een vaste bovenmarge in plaats van verticaal centreren over de hele resterende hoogte.

**Betrokken bestanden:** `web/public/teacher-login.html` · `VERSION` ·
overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.45 — Volgorde "Account" en "Snel deelnemen" verwisseld

Op het Deelnemen-scherm stond "Snel deelnemen" (gast, zonder account) links en "Account"
rechts. Omgedraaid: "Account" staat nu eerst (links) — normaal gezien loggen leerlingen
in via hun account; "Snel deelnemen" is de uitzondering voor wie (nog) geen account
heeft, niet de standaard.

**Betrokken bestanden:** `web/public/student-start.html` · `VERSION` ·
overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.44 — Footer-bug gefixt + header/footer voor beide inlogschermen + nieuwe stijl als standaard

### Footer-bug (echte oorzaak gevonden)
De footer op het "Deelnemen"-scherm bleek onvolledig — enkel "· Privacy", zonder de
standaard "© 2026 PyCodeFlow — ontwikkeld door B. Claes • vX.X.X.X" ervoor. Oorzaak: ik
had daar zelf een LEGE `<div class="footer-note">` klaargezet "voor privacy.js" —
maar `app.js` z'n eigen `injectFooter()` slaat het aanmaken van de footer juist over
zodra er al een `.footer-note` bestaat (bedoeld om dubbele footers te vermijden). Mijn
lege div bleef dus leeg op de Privacy-link na. Opgelost door die vooraf-lege div gewoon
weer te verwijderen: `app.js` (al geladen op deze pagina) bouwt de STANDAARD footer nu
zelf, exact zoals op elk ander scherm.

### Nieuw: leerkrachten- en leerling-inlogscherm kregen kop en voet
- `teacher-login.html` was een volledig losstaand fullscreen-overlayscherm zonder enige
  kop of voet. Herstructureerd naar een gewone pagina: sticky header bovenaan (logo +
  "Home"), het inlogkaartje gecentreerd ertussenin, standaard footer onderaan. Kaart,
  velden en alle bestaande JS/gedrag blijven functioneel ongewijzigd.
- `student-login.html` had al een kop maar geen footer — zelfde soort probleem als
  hierboven (geen `.footer-note` → povere fallback van privacy.js na 8s). Nu ook een
  "Home"-knop in de kop en een correcte standaardfooter.
- Nieuw gedeeld bestand `footer-note.js`: exact dezelfde footer-opbouw als `app.js`'
  `injectFooter()`, voor de lichte inlogschermen die app.js zelf niet laden.

### Warm thema uitgebreid naar beide inlogschermen — en nu de standaard
- Beide inlogschermen kregen dezelfde blauwe accentstijl als het "Account"-blok op het
  Deelnemen-scherm (kader + titel + knop), met het schuifknopje rechtsboven.
- **De nieuwe (warme) stijl is nu overal de standaard-weergave** (was voorheen opt-in).
  Het schuifknopje is daarom omgedraaid naar een opt-OUT: **"Te verfrissend? → oude
  look"**. Wie nog nooit koos, ziet voortaan de nieuwe stijl; wie expliciet terugschakelt
  (onthouden per browser), ziet de klassieke stijl.
- Terloops meegenomen: de pagina-achtergrond (buiten de witte kaart) was hard gecodeerd
  in `styles.css`/`teacher-login.html` i.p.v. via de themavariabele, en bleef daardoor
  ook onder het warme thema koelgrijs — nu correct via `var(--bg)`.

**Betrokken bestanden:** `web/public/footer-note.js` (nieuw) ·
`web/public/theme-warm.css` · `web/public/theme-toggle.js` ·
`web/public/student-start.html` · `web/public/student-login.html` ·
`web/public/teacher-login.html` · `VERSION` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.43 — Paars vervangen door roodoranje uit het PyCodeFlow-logo

Het paars van "Vrij oefenen" paste niet echt bij het merk. Het PyCodeFlow-logo zelf
gebruikt navy, goud en oranje/roodoranje — géén paars. "Vrij oefenen" krijgt daarom nu een
diep roodoranje (`#c8431a`, geleend van de roodoranje hoek van het logo) i.p.v. paars, en
het kleurstaafje onderaan eindigt nu op het logo-goud i.p.v. schoolwebsite-oranje: groen →
blauw → roodoranje → goud.

**Betrokken bestanden:** `web/public/theme-warm.css` · `web/public/student-start.html` ·
`VERSION` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.42 — Warm thema: meerkleurig (render B) + leesbaarder header/footer

Vervolg op v2026.2.51.41, enkel op `student-start.html`, nog steeds volledig achter het
"Nieuwe stijl proberen"-schuifknopje:

- **Meerkleurig, geïnspireerd op GO! Atheneum Hoboken** (het gekozen 2de renderconcept):
  elk blok krijgt zijn eigen accentkleur i.p.v. overal dezelfde — "Snel deelnemen" groen,
  "Account" blauw ("Inloggen" in het diepere schoolblauw, "Account aanmaken" lichter
  blauw), "Vrij oefenen" paars. Onderaan een dun kleurstaafje (groen→blauw→paars→oranje)
  als knipoog naar de 4-kleurige kaartjes-indeling van de schoolwebsite. Titel "Deelnemen"
  in het schoolblauw.
- **Header (topbar) iets hoger + groter lettertype** — was te krap/moeilijk leesbaar.
- **Footer iets hoger + groter lettertype.** Bijkomend: er stond op deze pagina nog geen
  eigen footer-element, waardoor `privacy.js` na 8 seconden zelf een minimale
  fallback-footer aanmaakte met een vaste, moeilijk leesbare inline stijl (0.8rem,
  lichtgrijs) — nu staat er een echte `.footer-note`, die meteen (niet pas na 8s) de
  Privacy-link krijgt én via CSS (dus ook aanpasbaar/groter onder het warme thema) gestyled
  wordt i.p.v. via een ingebakken inline waarde.
- **Titel "Deelnemen" iets kleiner** om de extra hoogte van header/footer te compenseren.

Alle overige onderdelen (lay-out van de blokken, teksten, gedrag) blijven ongewijzigd.

**Bewuste scheiding blijft behouden**: alles zit in `theme-warm.css`
(`html[data-theme="warm"] ...`), niets in `styles.css` zelf gewijzigd; classic-thema
(schuifknopje uit) blijft pixel-voor-pixel hetzelfde als voorheen.

**Betrokken bestanden:** `web/public/theme-warm.css` · `web/public/student-start.html` ·
`VERSION` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.41 — Experimenteel warm kleurenthema met schuifknopje (enkel op het instapscherm)

Een werkend, uitprobeerbaar thema-schuifknopje rechtsboven op het instapscherm
(`student-start.html`): "Nieuwe stijl proberen" wisselt live tussen het huidige koele
kleurenschema en een warmer schema geïnspireerd op de hub-/cursus-webapps (cremekleurige
achtergrond, marineblauwe tekst, salie-groen als primaire actiekleur, terracotta voor
foutmeldingen). De keuze wordt onthouden per browser (localStorage), niet server-kant.

**Bewuste, strikte scheiding voor eenvoudige opruiming achteraf:**
- `web/public/theme-warm.css` (nieuw) — overschrijft ENKEL de bestaande CSS-variabelen
  uit `styles.css`, en dat ook nog eens uitsluitend onder `html[data-theme="warm"]`.
  Zonder dat attribuut verandert er niets.
- `web/public/theme-toggle.js` (nieuw) — los van `app.js`, regelt enkel het
  aan/uitzetten en onthouden van het thema.
- Beide bestanden voorlopig enkel ingeladen op `student-start.html`.
- Wordt dit afgekeurd: verwijder gewoon die twee bestanden + de 4 regels die ernaar
  verwijzen in `student-start.html`. Wordt het goedgekeurd: verhuis de waarden naar
  `:root` in `styles.css` en verwijder pas dan de oude waarden daar.

**Betrokken bestanden:** `web/public/theme-warm.css` (nieuw) ·
`web/public/theme-toggle.js` (nieuw) · `web/public/student-start.html` · `VERSION` ·
overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.40 — Startscherm leerling gebruikt de beschikbare breedte

Het instapscherm (`student-start.html`) stond alles — naam/code, inloggen/account maken,
vrij oefenen — voorheen in ÉÉN smalle kolom (max-breedte 760px), ook op een breed
chromebookscherm. Alles stond daardoor onnodig compact op elkaar. Nu twee gelijkwaardige
blokken naast elkaar zodra er plaats is — **Snel deelnemen** (naam + sessiecode) en
**Account** (inloggen/account maken) — met **Vrij oefenen** als apart, volle-breedte blok
eronder. Op smallere schermen (chromebook rechtop, tablet, telefoon) vallen de twee
blokken automatisch terug naar één kolom (zelfde responsieve patroon als de bestaande
`.mode-cards`, breekpunt 980px).

**Betrokken bestanden:** `web/public/student-start.html` · `web/public/styles.css` ·
`VERSION` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.39 — Klassen zichtbaar in sessieoverzicht + leerling kan altijd terug naar eigen overzicht

### Klassen niet zichtbaar in het sessieoverzicht
Bij het aanmaken van een sessie kon je al kiezen welke klassen toegang krijgen (sprint 59),
maar in het sessieoverzicht zelf was nergens te zien welke klas(sen) dat dan waren. Elke
sessiekaart toont nu een extra veld "Klassen": de gekoppelde klasnamen, of "Alle klassen"
wanneer er geen restrictie is.

### Leerling kon niet terug naar zijn eigen overzicht
Vanuit een lopende les (leerling-app) of vrij oefenen kon een leerling niet rechtstreeks
terug naar "Mijn overzicht" (student-thuis.html, met zijn open lessen en resultaten) —
enkel een algemene "Home"/"Stoppen"-knop naar de generieke rol-keuzepagina. Er staat nu
een directe knop **Mijn overzicht** naast Home/Stoppen op de leerling-app en de
vrij-oefenen-pagina.

**Betrokken bestanden:** `web/server.js` · `web/db/database.js` · `web/public/app.js` ·
`web/public/student-app.html` · `web/public/free-editor.html` · `VERSION` ·
overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.38 — Drie bugs n.a.v. screenshots: melding bij verwijderde les, layout-sprong, knoppen-uitlijning

### Geen melding bij deelnemen aan een ondertussen verwijderde les
Koos een leerling in de dropdown "Open lessen van jouw klas" een les die de leerkracht
intussen al verwijderd had, dan gebeurde er zichtbaar niets: de server stuurde wel een
foutmelding terug, maar die verscheen altijd in het (ongerelateerde) veld bij "Ik heb een
sessiecode" — niet bij de dropdown waar de leerling net op klikte. Er verschijnt nu een
duidelijke melding vlak bij de dropdown zelf, en de lijst wordt meteen daarna herladen
zodat de verdwenen les niet opnieuw gekozen kan worden.

### Layout sprong bij "Start individuele werkfase"
Op het leerkrachtenplatform stonden "Sessieoverzicht" en de modus-knop in dezelfde
flex-rij als de titel en de sessiecode-badge; of ze wel of niet naar een eigen regel
verhuisden, hing af van de tekstlengte van de knop ("Start individuele werkfase" vs
"Terug naar klasmodus") — vandaar de zichtbare "sprong" bij het wisselen van modus. Die
knoppenrij staat nu altijd op een eigen, vaste regel, in beide modi identiek (de
klasmodus-layout, zoals gevraagd).

### Topbalk-knoppen niet altijd uiterst rechts
Op pagina's met een extra topbalk-element (de groene verbindingsstatus-stip op het
leerkrachtenplatform) duwde de bestaande centrering ("space-between" met 3 elementen)
de knoppen ("Home", "Sessieoverzicht", "Afmelden") naar het midden i.p.v. helemaal
rechts. De knoppen staan nu altijd zo ver mogelijk naar rechts, ongeacht hoeveel andere
elementen er in de balk staan.

**Betrokken bestanden:** `web/public/student-thuis.html` · `web/public/teacher-app.html` ·
`web/public/styles.css` · `VERSION` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.37 — Zeven gemelde bugs: leerling verwijderen, klas-gebonden sessies, UI-consistentie, opruiming

### Leerling écht verwijderen
Leerkrachten (en admins/superadmins) konden een leerling voorheen enkel blokkeren, nooit
écht verwijderen — een per ongeluk dubbel aangemaakte leerling bleef dan voorgoed staan.
Verwijderen is nu mogelijk vanaf "Mijn klassen" (voor eigen klassen) en Beheer, en ruimt
in een transactie ALLES op wat aan de leerling hangt (resultaten, code-geschiedenis,
opmerkingen, taakstatus, …) — niet enkel de tabellen met een echte FK-constraint zoals
voorheen.

### Sessie ↔ klas-koppeling
Bij het aanmaken van een gewone sessie verschijnt nu een pop-up: welke klas(sen) krijgen
toegang (of "Alle klassen")? Leerlingen zien voortaan enkel de sessies die aan hun eigen
klas gekoppeld zijn, in plaats van alle sessies van elke leerkracht die hen in ÉÉN van hun
klassen lesgeeft.

### Consistente topbalk
Rechtsbovenaan staan nu op elke leerkracht-/admin-/superadminpagina dezelfde twee acties:
**Sessieoverzicht** en **Afmelden** — behalve op het sessieoverzicht zelf, waar enkel
Afmelden nog zin heeft.

### Klaar / Hand opsteken enkel op eigen werkblad
Deze knoppen staan nu automatisch grijs zodra de klascode actief staat, en worden pas
weer bruikbaar op het eigen werkblad (of in examenmodus).

### Login-blokkade vrijgeven
Nieuw paneel op de Systeem-pagina toont welke IP-adressen momenteel geblokkeerd zijn na
te veel mislukte inlogpogingen, met een knop om zo'n blokkade meteen vrij te geven —
handig om snel opnieuw te kunnen testen.

### Verwijderde sessie bleef zweven
Een verwijderde gewone sessie verdween voorheen enkel uit het geheugen van de server,
nooit uit de databank — na een herstart dook ze daardoor gewoon weer op in de lessenlijst
van leerlingen. Dat is nu gefixt; de knop markeert de sessie ook effectief in de DB.

**Betrokken bestanden:** `web/server.js` · `web/db/database.js` · `web/public/app.js` ·
`web/public/mijn-klassen.js` · `web/public/monitoring.js` · `web/public/monitoring.html` ·
`web/public/nav-rechten.js` · `web/tests/bugfixes-2026-09.test.js` (nieuw) · `VERSION` ·
overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.36 — Datumvermelding op "Mijn resultaten"

Elke kaart in "Mijn resultaten" toont nu de deadline-datum van de toets/taak (enkel de
datum, geen uur — bv. "26/8/2026") naast de klasnaam. Toetsen zonder deadline tonen gewoon
geen datum.

De sortering (meest recente deadline eerst) stond al server-kant correct ingesteld, maar
werd nooit zichtbaar gemaakt op de kaart zelf — bevestigd met een test met twee
verschillende deadlines: de nieuwste (26/8/2026) verschijnt boven de oudere (23/7/2026).

**Betrokken bestanden:** `web/public/student-thuis.html` · `VERSION` · overige
`web/public/*.html` (cache-bust)

---

## v2026.2.51.35 — Negen bugs/features n.a.v. gebruikersfeedback

### Samengestelde vragen — structuur en weergave
- De overbodige, niet-doorkomende "Algemene opmerking bij deze vraag" is verwijderd bij
  samengestelde vragen — commentaar staat nu enkel en correct per onderdeel.
- De 🤖 AI-badge staat nu ook bovenaan een samengestelde vraag als minstens één onderdeel
  door de AI beoordeeld is (zonder feedback-knop daar — die staat al per onderdeel).
- **Leerling-resultaten**: een samengestelde vraag toonde voorheen enkel de totaalscore met
  één (leeg) commentaar. Nu wordt elk onderdeel apart getoond, met eigen score en
  commentaar — zowel in het volledige nakijkscherm als in de vereenvoudigde
  "Mijn resultaten"-lijst.
- Code in die vereenvoudigde lijst (zowel de vraagtekst als het leerling-antwoord) wordt nu
  herkenbaar als code gestyld (monospace, donkere achtergrond) i.p.v. platte tekst met
  zichtbare markdown-tekens.

### AI-verbeteren sluit niet-deelnemers nu volledig uit
Een leerling die niet deelnam werd al uitgesloten van AI-verbeteren via zijn
antwoord-status. Maar een leerling die **achteraf** als "gewettigd afwezig" gemarkeerd werd
(een aparte status, los van wat er per antwoord gebeurde) bleef tot nu toe gewoon in de
AI-verbeter-lijst staan. Nu sluit de AI-taak zo iemand ook altijd uit — geen zichtbare knop,
en bij klassikaal verbeteren wordt hij stilzwijgend overgeslagen. Bevestigd met een
end-to-end-test: de AI-taak verwerkte de andere leerlingen normaal, maar liet de gewettigd-
afwezige leerling volledig ongemoeid.

### "Gewettigd afwezig" nu overal duidelijk
- Op de verbeterpagina: een aparte, blauwe indicator in de leerlingenlijst en een duidelijke
  melding bij het openen van die leerling's toets — niet langer dezelfde, verwarrende
  melding als bij een leerling die gewoon niet kwam opdagen.
- Bij de leerling zelf: de toets staat gewoon in zijn resultatenlijst, maar toont
  "Gewettigd afwezig" in plaats van een (onterechte) 0.

### Kleurcodering resultatenlijst
Elke kaart in "Mijn resultaten" krijgt nu een zachte, transparante kleurindicatie: groen bij
geslaagd, rood bij niet geslaagd, blauw bij gewettigd afwezig — een snel, luchtig overzicht
voor de leerling.

### Vrijgeven kan nu weer ingetrokken worden
"Vrijgeven" was voorheen een one-way-knop — eenmaal aangezet, bleef een toets voor altijd in
de resultatenlijst van elke leerling staan, ook als dat niet meer gewenst was. Nu een echte
toggle, net als de bestaande "Nakijken"-knop.

### Klascode-scherm: grotere URL
Op het volledig-scherm-klascode-display (bv. op een beamer) schaalde enkel de code zelf mee
met het scherm — de registratie-URL eronder bleef piepklein. Nu schaalt die tekst ook mee.

**Getest:** volledige end-to-end-tests met een mock-Ollama-server en een mock-runner-service,
plus browsertests van alle visuele wijzigingen (screenshots bevestigen composite-badges,
kleurcodering, en de gewettigd-afwezig-weergave op zowel de verbeterpagina als bij de
leerling zelf). Volledige testsuite: 324/324 groen.

**Betrokken bestanden:** `web/server.js` · `web/db/database.js` · `web/lib/review-result.js` ·
`web/public/quiz-review.html` · `web/public/quiz-review.js` · `web/public/student-thuis.html` ·
`web/public/mijn-klassen.html` · `VERSION` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.34 — Sprint 51-ai (v5): echte AI-training, periodiek en handmatig

Vervolg op het feedback-mechanisme: het materiaal dat je met de 👍/👎-knopjes verzamelt kan
nu ook daadwerkelijk gebruikt worden om het model zelf bij te trainen — niet enkel als
prompt-geheugen, maar als een echte, periodieke fine-tuning van de AI zelf.

### Belangrijke, eerlijke kanttekening
Dit is geen automatisch, ingebouwd trainingsproces — dat vereist een GPU die een NAS niet
heeft. Het is een **handmatig, periodiek traject**: eenmaal per maand (of zo vaak als je
wil) trainingsgegevens downloaden, op een machine met een GPU (bv. je laptop) trainen, en
het resultaat terug opladen.

### Twee nieuwe bronnen van trainingsdata
1. **Expliciete feedback** (de bestaande 👍/👎-knopjes) heeft er nu een optioneel veld bij:
   bij "kon beter" kan je meteen ook de exacte, juiste score en commentaar invullen — niet
   enkel een losse notitie.
2. **Stille, automatische correctie**: past je zelf een score aan die eerder door de AI
   gezet was (zonder de feedback-knop te gebruiken), dan wordt dat "voor/na"-paar nu vanzelf
   bewaard als trainingsmateriaal — geen aparte actie nodig.

Beide leggen de volledige vraag-context vast op het moment zelf (niet pas bij een latere
export), zodat een export maanden later nog steeds correct werkt, ook als de vraag intussen
gewijzigd of verwijderd is.

### Nieuw in `pycodeflow.sh`: menu 22, "AI-training"
- **Trainingsgegevens downloaden**: exporteert alle verzamelde correcties als een
  JSONL-bestand — in exact hetzelfde promptformaat als het AI-verbeteren zelf gebruikt,
  zodat een training zo dicht mogelijk aansluit bij de echte praktijk. Een
  samenvattingsbestand erbij waarschuwt eerlijk als er nog te weinig data is om zinvol te
  trainen (te weinig voorbeelden kan het model net onnauwkeuriger maken).
- **Nieuw getraind model opladen**: neemt een zip met een getrainde LoRA-adapter
  (bv. geëxporteerd via Unsloth Desktop), bouwt automatisch een Ollama-Modelfile, maakt een
  nieuwe, gedateerde modelversie aan, en stelt die in — met behoud van de vorige versie
  voor het geval een training tegenvalt.
- **Actief AI-model tonen**: overzicht van de huidige instelling en alle geïnstalleerde
  Ollama-modellen.

**Getest:** een volledig end-to-end-scenario (expliciete correctie via feedback + stille
correctie via een gewone handmatige aanpassing) bevestigt dat beide paden correct in de
database terechtkomen, en dat het export-script ze correct omzet naar geldige
trainingsvoorbeelden — inclusief de juiste, gecorrigeerde score/commentaar en het
consistente promptformaat. Volledige testsuite: 324/324 groen.

**Betrokken bestanden:** `web/server.js` · `web/db/database.js` · `web/scripts/export-ai-training.js`
(nieuw) · `web/public/quiz-review.html` · `web/public/quiz-review.js` · `VERSION` · overige
`web/public/*.html` (cache-bust) — plus een aparte, gelijktijdige update van
`scripts/app/pycodeflow.sh` en `docker-compose.yml` (zie de begeleidende script-zip).

---

## v2026.2.51.33 — Sprint 51-ai (v4): AI-verbeteren — structuurbug, beleid, log & feedback

Vierde, grote herwerking van de AI-verbeterfunctie na verder gebruik in de praktijk.

### De echte oorzaak van de ontbrekende badge bij samengestelde vragen
Er bestond helemaal geen aparte opslagplek voor commentaar per onderdeel van een
samengestelde vraag — enkel het ene, gedeelde "Algemene opmerking"-veld voor de hele vraag.
Het AI-commentaar per onderdeel schreef daar per ongeluk naartoe, en het laatst-verwerkte
onderdeel overschreef steeds de vorige. Nieuwe `part_comments`-kolom lost dit structureel
op: elk onderdeel krijgt nu zijn **eigen** commentaarveld én zijn **eigen** 🤖-badge, zowel
op de verbeterpagina als in het leerlingscherm. De "Algemene opmerking" bij een
samengestelde vraag is voortaan een aparte, bewust losstaande sectie met een eigen
opslagknop.

### Strenger en eerlijker beoordelingsbeleid
- **Partiële punten bij code**: een deels correcte oplossing (bv. juiste logica maar
  verkeerde opmaak van de uitvoer) krijgt nu een tussenscore in plaats van automatisch 0 of
  de volle punten. Het commentaar benoemt het **exacte, concrete verschil** — nooit meer een
  vage of verzonnen vergelijking.
- **Open vragen**: geen puntenaftrek meer voor spelling-, schrijf- of taalfouten — enkel de
  inhoud telt. De correcte schrijfwijze mag wel als suggestie in het commentaar staan.
- **Vlottere, natuurlijkere taal** voor het algemene toetscommentaar.
- Uitspraken als "geen puntenverlies" verschijnen voortaan enkel als dat ook echt klopt.

### Gedetailleerd log i.p.v. enkel een percentage
Een klik op de voortgangspil toont nu een scrollbare log met per verwerkte vraag/onderdeel
wie er verbeterd werd, met welke score, en wanneer — blijft ook na afloop bekijkbaar.

### Feedback op AI-scores — de praktische invulling van "wordt de AI beter?"
Bij elke AI-gescoorde vraag staat nu een klein "📝 Feedback"-knopje: "👍 Goed" of "👎 Kon
beter" (met een korte, eigen verbetering). Eenmaal gegeven verdwijnt het knopje voor dat
specifieke item. **Belangrijk om eerlijk te zijn: dit is geen echte model-training** — een
lokaal Ollama-model "leert" niet vanzelf tussen sessies. Wat wél gebeurt: de meest recente
"kon beter"-notities voor **dezelfde vraag** worden als extra context meegegeven bij een
volgende AI-verbeterbeurt van die vraag — een groeiend, vraag-specifiek correctie-geheugen
dat de AI expliciet op eerdere fouten wijst, bevestigd doeltreffend in een end-to-end-test.

### Overig
- De AI-badge verdwijnt correct zodra de leerkracht zelf een score/commentaar aanpast —
  bevestigd voor zowel gewone vragen als per samengestelde-vraag-onderdeel.

**Getest:** volledige end-to-end-tests met een mock-Ollama-server én een mock-runner-service
die nu écht Python-code uitvoert (i.p.v. patroonherkenning) voor realistische, willekeurige
scenario's. Bevestigd: composite-onderdelen behouden elk hun eigen commentaar, de
hoofdvraag-opmerking blijft ongemoeid, het letter-per-regel-scenario geeft nu correcte
partiële punten met een accuraat commentaar, feedback wordt opgeslagen en komt terug in een
volgende prompt, en de badge verdwijnt bij handmatige aanpassing. Volledige testsuite:
324/324 groen.

**Betrokken bestanden:** `web/server.js` · `web/db/database.js` · `web/lib/ai-grading.js` ·
`web/lib/review-result.js` · `web/public/quiz-review.html` · `web/public/quiz-review.js` ·
`web/public/quiz-student.js` · `VERSION` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.32 — Sprint 51-ai (v3): AI-verbeteren — vijf gemelde problemen opgelost

Grondige herwerking van de AI-verbeterfunctie na feedback uit echt gebruik.

### 1. Geen zicht meer op de voortgang na het sluiten van het venster
Er staat nu een blijvende, klikbare statuspil naast de "🤖 AI verbeteren"-knop die zichtbaar
blijft ongeacht of de popup open of dicht staat — inclusief wie er net verbeterd wordt. Ze
verschijnt ook vanzelf terug als je de pagina herlaadt of later terugkomt, en blijft nog 5
minuten "✅ klaar" tonen na afloop. **Nieuw: dezelfde melding staat nu ook op het Toets/Taak
overzicht**, als badge op de betreffende kaart — je hoeft niet meer op de verbeterpagina zelf
te zijn om te weten dat er iets loopt of klaar is.

### 2. Geen algemeen commentaar
Na het verbeteren van alle vragen van een leerling schrijft de AI nu ook een kort,
samenvattend algemeen commentaar — gebaseerd op de score en de net gegeven per-vraag
commentaren. Wordt enkel ingevuld als er nog niets stond, tenzij je expliciet "overschrijven"
aanvinkt.

### 3. Een vraag die de AI wél verbeterde toonde soms geen badge; een andere vraag werd
### stilzwijgend overgeslagen
Root cause gevonden: een vraag die automatisch op score 0 gezet was (leerling liet ze
onbeantwoord, of nam niet deel) werd door de AI-taak foutief beschouwd als "al beoordeeld" —
en dus overgeslagen, ook al was die 0 geen echte beoordeling maar een automatische
placeholder. Zulke vragen worden nu gewoon normaal door de AI verbeterd. Bevestigd met een
gerichte test: vóór de fix bleef zo'n vraag onaangeroerd, na de fix krijgt ze een echte
score en commentaar.

### 4. Foute uitvoer kreeg toch de volle punten (bv. `range(1, 10)` i.p.v. `range(1, 11)`)
De AI kreeg voorheen enkel de modelcode te lezen en moest zelf "berekenen" wat de juiste
uitvoer zou moeten zijn — foutgevoelig voor een lokaal, CPU-gebonden model. Nu wordt bij een
code-vraag **ook de modeloplossing zelf uitgevoerd**, en krijgt de AI beide echte
uitvoerresultaten om rechtstreeks te vergelijken. De instructies zijn ook aangescherpt: een
afwijkende uitvoer betekent altijd puntenverlies, nooit de volle punten. Daarnaast redeneert
de AI voortaan eerst kort intern (wat klopt, wat niet) vóór ze een score bepaalt — een lichte
vorm van "hardop nadenken" die de nauwkeurigheid duidelijk verbetert, tegen een kleine
tijdskost. Bevestigd met het exacte gemelde scenario: een leerling met `range(1, 10)` i.p.v.
`range(1, 11)` krijgt nu 2 van de 4 punten, met als commentaar — letterlijk — "Gebruik van de
for-lus en het printen van de getallen zijn goed, maar de range klopt niet helemaal."

**Getest:** volledige end-to-end-tests met een mock-Ollama-server én een mock-runner-service
(om de code-uitvoer-vergelijking realistisch te simuleren), plus een browsertest van de
voortgangspil op beide pagina's (blijft zichtbaar na sluiten, na herladen, en op het
overzicht). Volledige testsuite: 324/324 groen.

**Betrokken bestanden:** `web/server.js` · `web/db/database.js` · `web/lib/ai-grading.js` ·
`web/public/quiz-review.html` · `web/public/quiz-review.js` ·
`web/public/assignment-overview.js` · `VERSION` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.31 — Sprint 51-ai: AI-verbeteren + drie echte bugs opgelost

Grote, samengestelde levering met een nieuwe functie en drie stevige, grondig onderzochte
bugfixes.

### Nieuw: automatisch verbeteren via een lokale AI
Op de verbeterpagina staat nu een **"🤖 AI verbeteren"**-knop. Die laat open- en code-vragen
(ook onderdelen van samengestelde vragen) automatisch nakijken door een lokale Ollama-server —
geen enkel leerlingantwoord verlaat het eigen netwerk. Een popup laat kiezen tussen de hele
klas of specifieke leerlingen, met een expliciete "ook al beoordeelde antwoorden
overschrijven"-optie (standaard uit, zodat eigen werk van de leerkracht nooit per ongeluk
overschreven wordt). Bij code-vragen wordt de code ook écht uitgevoerd via de bestaande
sandbox, en de werkelijke uitvoer meegegeven aan de AI voor een betrouwbaardere beoordeling.

**Belangrijk:** de AI-markering is strikt leerkracht-only. Een nieuwe, aparte
database-kolom (los van de zichtbare commentaartekst) houdt bij welke scores van de AI
komen — enkel de verbeterpagina toont die info (met een duidelijke badge). De leerling ziet
zijn score en commentaar gewoon als tekst, zonder ooit te weten dat een AI die schreef.
Bevestigd met een volledige end-to-end-test: de leerling-respons bevat geen enkel spoor van
"ai_graded", "AI" of 🤖.

### Bug: output-scherm groeide oneindig i.p.v. te scrollen
Het outputvenster (Vrij oefenen en elders) had geen maximumhoogte, waardoor lange output de
hele pagina liet meegroeien in plaats van binnen een vaste hoogte te scrollen. Één CSS-regel
loste dit op — het bestaande "scroll naar onderen"-knopje werkte al helemaal correct in de
code, maar had nooit zichtbaar effect omdat het venster nooit een echte scroll-container was.

### Bug: meermaals op "Run" klikken gaf de code 2-3 keer
Een achtergrondtaak die de uitvoer van een lopende code volgt, las een gedeelde eigenschap
opnieuw uit bij elke stap in plaats van een vaste, eigen kopie vast te houden. Klikte je
snel meermaals op "Run" (bijvoorbeeld tijdens het wachten op invoer), dan gingen oudere,
nog actieve achtergrondtaken de nieuwste uitvoering volgen — elk vanaf het begin — waardoor
de uitvoer letterlijk werd samengevoegd en meermaals verstuurd. Gefixt op beide plekken waar
dit voorkwam (vrij oefenen en tijdens een toets), met een extra beveiliging: de Run-knop
wordt nu ook even uitgeschakeld tijdens een lopende uitvoering.

### Bug: automatische stop bij een oneindige lus "werkte niet" op iPad
Grondig onderzocht waarom dit op laptop wel en op iPad niet werkte. Oorzaak: Safari/iOS
sluit een actieve verbinding vaker dan andere browsers bij tab-wissel of
schermvergrendeling. Stopte de server een vastgelopen lus daarna (via de bestaande
tijdslimiet), dan werd dat bericht naar de inmiddels *verbroken* verbinding gestuurd en kwam
het dus nooit aan — na de automatische herverbinding bleef de gebruikersinterface (o.a. de
Run-knop) hangen in "bezig", ook al was er server-kant allang niets meer aan de hand. Bij
elke herverbinding wordt de actuele status nu opnieuw opgehaald, zowel bij vrij oefenen als
tijdens een toets — bevestigd met een test die de verbinding daadwerkelijk verbreekt
(server-herstart) in plaats van enkel te simuleren.

### Bug: twee onderdelen van de ingebouwde stresstest faalden
Grondig geanalyseerd waarom de WebSocket-belastingstest en de daaropvolgende
rate-limit-verificatie in de logs faalden. Oorzaak gevonden: de stresstest laat tot 15
clients gelijktijdig joinen, allemaal vanaf hetzelfde (lokale) adres — ver boven de
bestaande, terechte limiet van 10 joinpogingen per minuut per adres. Dat blokkeerde niet
enkel de belastingstest zelf, maar liet ook de daaropvolgende rate-limit-test falen: de
teller stond dan al vol, dus die test se eigen verbindingspoging werd ook geweigerd, nog
vóór er ooit iets getest kon worden. Geen bug in de rate-limit-logica zelf (apart bevestigd
correct) — de bestaande beveiliging tegen misbruik van buitenaf botste met de stresstest
zijn eigen, interne verkeer. Opgelost met een gerichte, veilige uitzondering: enkel voor
herkenbaar stresstest-verkeer, en enkel vanaf het eigen adres, zodat er voor echte
gebruikers niets verandert. Bevestigd: de rate-limit-test toont nu consistent "PASS".

**Betrokken bestanden:** `web/server.js` · `web/db/database.js` · `web/lib/ai-grading.js`
(nieuw) · `web/public/app.js` · `web/public/quiz-student.js` · `web/public/quiz-review.html` ·
`web/public/quiz-review.js` · `web/public/styles.css` · `VERSION` · overige
`web/public/*.html` (cache-bust)

---

## v2026.2.51.30 — Sprint 51-fix: "Gewettigd afwezig" markeren was te beperkt

Sinds de automatische score-0-toekenning bij niet-deelname/onbeantwoorde vragen (sprint 51s)
kon een leerling die *wél* iets had ingeleverd (bv. een halve inlevering, of gewoon een
volledige, echte score) niet meer als "gewettigd afwezig" gemarkeerd worden — de checkbox was
enkel zichtbaar bij een leerling die letterlijk niets deed. En zelfs waar de checkbox wél
zichtbaar was, bleef de eerder toegekende score (bv. de automatische 0) gewoon getoond staan
na het aanvinken.

### Twee samenhangende problemen gefixt
1. **De "gewettigd"-checkbox** (bij Toets/Taak overzicht → "👥 Voortgang") is nu altijd
   zichtbaar, ongeacht de huidige inleverstatus — de leerkracht heeft hier altijd het laatste
   woord, bijvoorbeeld voor een leerling die pas halverwege de toets ziek werd.
2. **De score verdwijnt nu écht** zodra een leerling als gewettigd afwezig gemarkeerd wordt —
   zowel in de roster-weergave als in het klasoverzicht (en dus ook in de Excel-export die
   daarop steunt). Voorheen bleef de score (bv. 18/18, of de automatisch toegekende 0) gewoon
   zichtbaar staan, ook al werd de leerling niet meer meegeteld voor het gemiddelde.

**Getest:** een volledig end-to-end-scenario met een leerling die écht en volledig deelnam
(score 18/18) bevestigt: vóór het aanvinken toont de score gewoon 18, ná het aanvinken van
"gewettigd" verdwijnt die naar `null` — zowel via de API als bevestigd met een browsertest.
Volledige testsuite: 324/324 groen.

**Betrokken bestanden:** `web/server.js` · `web/public/app.js` · `VERSION` · overige
`web/public/*.html` (cache-bust)

---

## v2026.2.51.29 — Sprint 51-fix: Verwarrende "Stoppen"-knop bij een verlopen toets

Een toets die "⛔ Venster voorbij" én "🔍 nazicht open" toonde, bleef toch nog een "⏹ Stoppen"-
knop tonen — terwijl er niets meer te stoppen viel.

### Oorzaak
Twee gescheiden concepten die niet op elkaar afgestemd waren: `availability='expired'` is
puur tijd-gebaseerd (de deadline is verstreken), terwijl `stoppedAt` **uitsluitend** gezet
werd als de leerkracht expliciet op "Stoppen" klikte — de automatische deadline-afhandeling
deed dat nooit. De "Stoppen"-knop keek enkel naar `stoppedAt`, dus een toets waarvan de
deadline gewoon vanzelf verstreek hield de knop, ook al kon er niemand meer deelnemen.

### Fix — bij de bron én in de weergave
- **Bron**: zowel de bestaande deadline-cronjob als een nieuwe, "lazy" controle bij het
  ophalen van het toetsoverzicht zetten `stoppedAt` nu ook bij een automatisch verstreken
  venster. De lazy-controle vangt ook toetsen die nooit in het geheugen van een actieve
  server zaten (bv. na een herstart) — er is nu nog maar één plek die "is dit gestopt?"
  bepaalt.
- **Weergave**: een nieuwe `isActief()`-check (niet preview, niet gestopt, venster niet
  verstreken/gesloten) bepaalt voortaan of de "Stoppen"-knop verschijnt — niet langer enkel
  `stoppedAt`. De statusbadge toont bij een verstreken venster nu specifiek "⛔ Venster
  voorbij" (in plaats van het minder informatieve "⏹ gestopt") wanneer beide gelden.

**Getest:** een volledig end-to-end-scenario (toets aanmaken met een deadline in het
verleden, zonder ooit handmatig te stoppen) bevestigt dat `stoppedAt` automatisch gezet
wordt en de "Stoppen"-knop verdwijnt, met een browsertest en screenshot die het exacte
gemelde scherm reproduceren. Twee controlescenario's (nog actieve toets, en een toets die
vóór de deadline handmatig gestopt werd) bevestigen dat daar niets veranderd is.

**Betrokken bestanden:** `web/server.js` · `web/public/assignment-overview.js` · `VERSION` ·
overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.28 — Sprint 51-fix (v2): Nakijkscherm — eigen antwoord en antwoordsleutel apart

Vervolg op de vorige levering: het readonly-nakijkscherm toonde antwoord en correctheid
door elkaar, en code werd als platte tekst getoond in plaats van een echte editor.

### Wat er nu anders is
Elke vraag toont voortaan **twee duidelijk gescheiden secties**:
- **"Jouw antwoord"** — uitsluitend wat de leerling zelf invulde of koos, zonder enig
  correct/fout-oordeel. Bij een keuzevraag zonder gekozen optie blijft de volledige lijst
  gewoon zichtbaar, niets aangeduid — in plaats van een tekst als "niet ingevuld" die de
  opties verborg en het onmogelijk maakte om te zien wat er te kiezen was.
- **"Juiste antwoord"** — een aparte sectie eronder: bij keuzevragen dezelfde lijst met het/
  de juiste antwoord(en) groen, als een echte antwoordsleutel; bij code een **echte,
  syntax-gekleurde Monaco-editor** met de modelcode (readonly) — niet langer een platte
  tekstblok.

Dit geldt ook voor elk onderdeel van een samengestelde vraag.

### Technisch
Meerdere gelijktijdige, readonly Monaco-editors op één scherm (leerlingcode + modelcode,
per code-vraag/-onderdeel) via een eigen, lichte mount-helper — bewust niet de gedeelde
editor-component die maar 1 instance per scherm ondersteunt.

### Getest
Volledige browsertests bevestigen beide scenario's: een volledig ingevulde toets (alle
vraagtypes, incl. een samengestelde vraag) toont eigen antwoord én antwoordsleutel correct
naast elkaar; een halve inlevering (één vraag niet beantwoord) toont de keuzelijst leeg en
ongemarkeerd bij "Jouw antwoord", met de antwoordsleutel er gewoon apart naast — bevestigd
met screenshots. Geen JS-fouten. Volledige testsuite: 324/324 groen.

**Betrokken bestanden:** `web/public/quiz-student.js` · `VERSION` · overige
`web/public/*.html` (cache-bust)

---

## v2026.2.51.27 — Sprint 51-fix: Toets readonly openen bij nakijken + vragenbank-tabs

Twee grote uitbreidingen, allebei grondig getest en met een aantal pre-existing bugs
onderweg gevonden en gefixt.

### 1. "Toets openen"-knop bij nakijken — leerling ziet zijn volledige toets readonly
Op "Mijn resultaten" verschijnt nu, zodra jij "Nakijken" aanzet, een echte
**"📖 Toets openen"**-knop. Die opent dezelfde, volledige toets-interface die de leerling
tijdens het maken zag, nu readonly gevuld met zijn eigen antwoorden, score per vraag, en
jouw commentaar. Geen naam+klas meer nodig — de leerling is al ingelogd, en het bestaande
"nakijk"-mechanisme (voorheen enkel via een los naam+klas-formulier) wordt nu ook voor
ingelogde leerlingen naadloos hergebruikt (het token gaat via een tijdelijke, niet-URL-
gebonden opslag mee, om lekken via browsergeschiedenis te vermijden).

De resultatenlijst zelf toont, zoals gevraagd, voortaan enkel nog de score per vraag en het
commentaar van de leerkracht (algemeen bovenaan, per vraag ernaast) — niet langer de
volledige antwoorden inline.

**Twee pre-existing bugs gevonden en gefixt** tijdens het bouwen (het nakijk-scherm was
duidelijk nog nooit end-to-end getest):
- Twee kernfuncties voor het weergeven van de toetstekst stonden per ongeluk diep genest in
  een andere functie, waardoor het hele nakijk-scherm crashte zodra een leerling het
  probeerde te openen.
- Samengestelde vragen (met meerdere onderdelen) werden nergens volledig getoond aan de
  leerling — enkel het eventuele code-onderdeel kwam toevallig door. Nu toont het
  nakijk-scherm elk onderdeel apart, met een eigen score.

**Getest:** een volledige browsertest met een toets die alle vraagtypes bevat (open, code,
single-choice, en een samengestelde vraag met drie onderdelen) bevestigt dat alles correct
en zonder JS-fouten verschijnt — met een screenshot ter controle. Ook bevestigd dat de
gewone, live toetsafname (die dezelfde onderliggende code gebruikt) geen regressie heeft.

### 2. Vragenbank: gedeelde vragen van collega's in een eigen tabblad
"Mijn vragen" toont voortaan enkel je eigen vragen. Vragen die een collega met de school
deelde, staan nu in een apart tabblad **"📚 Overneembaar"** (met een teller-badge), met
enkel een "⧉ Overnemen"-knop — nooit meer per ongeluk tussen je eigen vragen.

**Onderweg een bug gevonden en gefixt:** de klik-afhandeling voor de vraagkaarten was enkel
aan het bestaande vragenraster gekoppeld, niet aan het nieuwe. De "Overnemen"-knop op het
nieuwe tabblad deed daardoor eerst niets, zonder foutmelding.

**Getest:** een volledige browsertest bevestigt dat een gedeelde vraag correct enkel in
"Overneembaar" verschijnt (nooit in "Mijn vragen"), dat daar geen Bewerken/Verwijderen-knop
staat, en dat "Overnemen" een echte kopie maakt en meteen het bewerkscherm opent.

**Betrokken bestanden:** `web/server.js` · `web/db/database.js` · `web/lib/review-result.js` ·
`web/public/quiz-student.js` · `web/public/student-thuis.html` · `web/public/quiz-bank.html` ·
`web/public/quiz-bank.js` · `VERSION` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.26 — Sprint 51-fix: Eigendom vragenbank verwarrend + kritieke bug in eigenaar-toewijzing

Naar aanleiding van de melding "ik krijg de fout 'Je kan enkel je eigen vragen bewerken' —
maar vragen in de vragenbank zijn toch altijd van mij?" — dit bleken **twee samenhangende
problemen** te zijn, waarvan één een écht belangrijke, onderliggende bug.

### 1. UI toonde "Bewerken"/"Verwijderen" ook voor gedeelde vragen van collega's
De vragenbank toont bewust ook vragen die een collega met de hele school deelde (via de
"Delen"-instelling), zodat je ze kan hergebruiken. Maar de "Bewerken"- en "Verwijderen"-
knoppen stonden **altijd** in de kaart, ook bij zo'n gedeelde, niet-eigen vraag — de server
weigerde dat terecht, maar pas ná het volledig invullen van het formulier en op "Opslaan"
klikken, zonder enige eerdere hint. Nu tonen die knoppen enkel nog bij je eigen vragen; een
gedeelde vraag van een collega krijgt in de plaats een duidelijke **"⧉ Overnemen"**-knop, die
een eigen, volledig bewerkbare kopie maakt (het bestaande "dupliceren"-mechanisme, nu
hergebruikt met een duidelijkere naam voor dit doel).

### 2. Kritieke bug: nieuw aangemaakte/overgenomen vragen kregen géén echte eigenaar
Bij het uitzoeken van punt 1 kwam een dieperliggende, belangrijkere bug aan het licht: het
aanmaken van een nieuwe vraag — én het "overnemen" (dupliceren) van een gedeelde vraag —
bepaalde de eigenaar via een **verouderd mechanisme** (het uitlezen van een HTTP Basic-Auth-
header), dat helemaal niet meer bestaat sinds de app overschakelde op sessie-cookie-login.
Gevolg: zulke vragen kregen stelselmatig **geen eigenaar** toegewezen, wat een bestaande
"onbekende eigenaar"-uitzondering activeerde die *elke* leerkracht toestond de vraag te
bewerken of te verwijderen — niet enkel de leerkracht die hem aanmaakte of overnam. Vijf
plekken in de code hadden deze bug; alle vijf zijn nu overgeschakeld naar de juiste,
sessie-gebaseerde manier om de ingelogde leerkracht te bepalen.

### Getest
Volledige end-to-end-tests (server én browser) bevestigen: een gedeelde vraag van een
collega toont enkel "Overnemen", geen "Bewerken"/"Verwijderen"; rechtstreeks bewerken van
andermans vraag wordt terecht geweigerd; na "Overnemen" krijgt de kopie een échte, eigen
eigenaar en is ze meteen bewerkbaar; een zelf aangemaakte vraag blijft gewoon van jezelf en
bewerkbaar/verwijderbaar. Ook bevestigd dat de bestaande, bewuste regel dat een school-admin
alle vragen van zijn school mag beheren (niet enkel eigen) intact blijft. Volledige
testsuite: 324/324 groen.

**Betrokken bestanden:** `web/server.js` · `web/public/quiz-bank.js` · `VERSION` · overige
`web/public/*.html` (cache-bust)

---

## v2026.2.51.25 — Sprint 51z: Beveiligingslek Archief + nakijken zonder vrijgave

Twee gemelde problemen, beide bevestigd en opgelost.

### 1. Beveiligingslek: Toets-archief toonde toetsen van andere scholen
`GET /api/quiz/archief` had **geen enkele filter** op eigendom — elke leerkracht zag toetsen
van álle scholen in het systeem. Bij nader onderzoek bleek dit nog verder te reiken:
- `PUT /api/quiz/new-school-year` ("Nieuw schooljaar starten") kon zo toetsen van **andere**
  leerkrachten/scholen laten **archiveren**, niet enkel bekijken.
- `GET /api/quiz/archive/student` ("Per leerling" zoeken) liet leerlingnamen van eender
  welke school doorzoeken.

Dit lek bestond waarschijnlijk al langer, maar was tot de vorige levering (v2026.2.51.23,
routing-fix) nooit daadwerkelijk bereikbaar — die fix heeft het onbedoeld zichtbaar gemaakt.
Alle drie de endpoints gebruiken nu dezelfde autorisatieregel als het bestaande, al-werkende
toets-overzicht: enkel eigen toetsen, of toetsen van een klas waaraan je als co-leerkracht
gekoppeld bent.

**Getest:** een volledig end-to-end-scenario met een leerkracht van school A en een van
school B bevestigt dat school B nu niets van school A ziet, niets kan archiveren, en geen
leerlingen kan vinden — terwijl school A gewoon toegang tot zijn eigen toetsen behoudt.

### 2. "Nakijken" aanzetten gaf de leerling geen toegang meer
De code die bepaalt of een toets in de resultatenlijst van een leerling verschijnt, vereiste
altijd dat de leerkracht apart ook "Resultaten vrijgeven" had aangeklikt — dit ondanks een
bestaande code-comment die expliciet zei dat "nakijken" (review-modus) **los van** vrijgave
zou moeten werken. Zette een leerkracht dus enkel "Nakijken" aan, dan verdween de leerling
volledig buiten beeld: geen toegang meer tot zijn eigen toets.

**Getest:** vier scenario's bevestigen het correcte gedrag — zonder nakijken/vrijgave geen
toegang; met enkel nakijken (geen vrijgave) verschijnt de toets in de resultatenlijst en kan
de leerling hem volledig readonly openen; met enkel vrijgave (geen nakijken) ziet de leerling
zijn score maar niet de volledige code/antwoorden.

**Betrokken bestanden:** `web/server.js` · `web/db/database.js` · `VERSION` · overige
`web/public/*.html` (cache-bust)

---

## v2026.2.51.24 — Sprint 51-fix: Echte Monaco-code-editor voor modelantwoorden

Vervolg op de vorige levering: een donkere, monospace textarea is geen echte code-editor.
Het modelantwoord bij een code-vraag (en bij het code-onderdeel van een samengestelde vraag)
gebruikt nu **dezelfde Monaco-editor-component die leerlingen tijdens een toets krijgen** —
regelnummers, Python-syntaxherkenning met kleuren, bracket-matching, hetzelfde donkere thema.

### Drie problemen gevonden en opgelost tijdens het bouwen
1. **Verkeerde scriptvolgorde** veroorzaakte een JS-fout (`Can only have one anonymous define
   call per script file`): Monaco's loader-scripts stonden vóór `marked.min.js`, dat een
   AMD/UMD-detectie bevat die botst met een al-aanwezige RequireJS-loader. Rechtgezet naar
   dezelfde (werkende) volgorde als het leerlingscherm.
2. **"+ Nieuwe vraag"-knop** initialiseerde het formulier niet correct, waardoor de editor
   soms niet verscheen. Gefixt door dezelfde nette reset-functie te hergebruiken als
   "Annuleren".
3. **Editor bleef leeg bij het bewerken van een bestaande vraag**: Monaco meet zijn
   containergrootte op het moment van aanmaken — gebeurde dat terwijl het tabblad nog
   verborgen was, bleef de editor 0×0 pixels en toonde niets, ook nadat het tabblad zichtbaar
   werd. Gefixt door het tabblad altijd eerst zichtbaar te maken.

Bewust een eigen, lichte editor-component gebouwd in plaats van de bestaande gedeelde
editor-machinerie te hergebruiken: die stuurt bij elke toetsaanslag automatisch updates naar
een live toets-sessie (bedoeld voor een lopende toets) — hier is er geen sessie, enkel een
gewoon formulierveld, en die neveneffecten zouden ruis geven.

### Getest
Uitgebreide browsertests bevestigen: de editor verschijnt correct bij het aanmaken van een
nieuwe code-vraag, wisselen tussen alle vraagtypes (code → open → composite → terug naar
code) verliest geen data, een composite-vraag met een code-onderdeel werkt, en — cruciaal —
het bewerken van een bestaande code-vraag toont de opgeslagen modelcode correct terug, met
volledige syntaxherkenning. Geen enkele JS-fout meer in het volledige scenario. Bevestigd met
screenshots.

**Betrokken bestanden:** `web/public/quiz-bank.html` · `web/public/quiz-bank.js` · `VERSION`
· overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.23 — Sprint 51-fix: Route-onbereikbaarheid Toets-archief + codeveld-styling

Twee gemelde problemen na het testen van v2026.2.51.21.

### 1. "Toets niet gevonden", "undefined toetsen" en de archiveerfout — alle drie dezelfde oorzaak
Een systematische Express-routingbug: routes worden gematcht in **registratievolgorde**, en
`GET /api/quiz/:code` (een generieke "haal deze ene toets op"-route) stond ver vóór een reeks
specifieke routes met een vast pad-segment. Elke aanroep naar zo'n route werd daardoor
altijd onderschept door de generieke route, met het vaste pad-segment als (niet-bestaande)
toets-code:
- `GET /api/quiz/archive` → verklaart zowel "een aangemaakte toets is niet terug te vinden"
  in het overzicht als de **"undefined toetsen"**-teller (die rekende op een array die er
  door deze bug nooit was).
- `PUT /api/quiz/new-school-year` → verklaart exact de **"Fout: Toets/taak niet gevonden."**
  bij het bevestigen van "Nieuw schooljaar starten".

Bij het systematisch doorzoeken van alle `/api/quiz/…`-routes zijn nog **twee sluimerende,
niet-gemelde gevallen** met hetzelfde probleem gevonden en meteen mee gefixt
(`/api/quiz/comment-templates` en `/api/quiz/stats`). Alle vier zijn verplaatst naar vóór de
generieke `:code`-route.

**Getest:** een volledige browsertest herhaalt het exacte gemelde scenario — een toets
aanmaken → verschijnt correct in het Archief-overzicht → teller toont het juiste aantal (geen
"undefined" meer) → "Nieuw schooljaar starten" slaagt met een zichtbare succesmelding.

### 2. Modelantwoord bij een code-vraag is nu een echt codeveld
Er bestond al een donkere, code-editor-stijl (gebruikt bij het code-alternatief in
keuzevragen) — het modelantwoord-veld gebruikt die nu ook, zowel bij een gewone code-vraag als
bij het code-onderdeel van een samengestelde vraag. Onderweg een CSS-specificiteitsbotsing
gevonden en gefixt: een generieke stijlregel voor formuliervelden had toevallig hogere
specificiteit en overschreef de bedoelde donkere code-stijl stilzwijgend.

**Getest:** in een echte browser bevestigd dat het veld zowel bij het openen van het formulier
als bij het wisselen tussen vraagtypes correct donker/monospace wordt bij "Python code" en
weer normaal bij andere types — voor zowel het hoofdvraag- als het onderdeel-modelantwoord.

**Betrokken bestanden:** `web/server.js` · `web/public/quiz-bank.html` ·
`web/public/quiz-bank.js` · `VERSION` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.22 — Sprint 51y/51z: Single/multiple-choice als onderdeel-type + PDF-fix

Het vijfde, grotere punt uit de vorige feedback-ronde: bij een samengestelde vraag kon je
enkel "Open" en "Code" als onderdeel-type kiezen. Nu zijn ook **Single choice** en
**Multiple choice** volwaardige onderdeel-types.

### Nieuw
- **Vragenbank-editor**: de onderdelen-dropdown heeft nu ook "◉ Single choice" en
  "☑ Multiple choice", met een volledige keuze-editor per onderdeel (opties toevoegen/
  verwijderen, correct(e) antwoord(en) aanvinken — radiogedrag bij single, checkboxgedrag
  bij multiple). Dezelfde regels als bestaande onderdelen blijven gelden (max 6, max 1
  code-onderdeel).
- **Leerlingscherm**: toont radio's/checkboxes voor deze onderdelen, met behoud van eerder
  gekozen antwoorden bij het wisselen tussen vragen.
- **Automatische scoring**: single/multiple-onderdelen worden bij het indienen automatisch
  gescoord — hergebruikt dezelfde, al bestaande `computeAutoScore`-logica als een gewone
  keuzevraag (volle punten bij correct; bij multiple: 0 zodra één fout antwoord meegekozen is).
- **Verbeterpagina**: toont welke optie(s) een leerling koos, met welke correct was — de
  auto-score staat al ingevuld en kan door de leerkracht overruled worden.
- **PDF-export**: single/multiple-onderdelen tonen de gekozen optietekst(en) met een
  correct/fout-markering.

### Twee echte bugs gevonden en gefixt tijdens het testen
1. **`quiz_submit_all` gaf `partAnswers` niet door aan `saveQuizAnswer`** bij het indienen —
   een pre-existing bug (niet vandaag geïntroduceerd) die de tussentijds opgeslagen
   onderdeel-antwoorden van een composite-vraag kon overschrijven met een lege waarde.
2. **`compositeAnswerBlock` was enkel bereikbaar binnen `generateQuizPDF`'s closure** — de
   ZIP-export (`/pdf/zip`) is een volledig aparte route-handler die er, ondanks een
   misleidende commentaar ("hergebruikt dezelfde helper"), nooit bij kon. Gaf een
   `ReferenceError` zodra een composite-vraag in de ZIP-export voorkwam. Nu op module-niveau
   verplaatst zodat beide plekken hem correct gebruiken.

### Getest
Volledige HTTP + socket.io end-to-end-test tegen een echte server: een leerling die het
correcte antwoord kiest krijgt automatisch de volle punten, een fout antwoord krijgt 0 —
bevestigd voor zowel single- als multiple-choice. Een uitgebreide test met alle vier
onderdeel-types tegelijk (open, code, single, multiple) bevestigt zowel de PDF- als de
ZIP-export correct genereren (voorheen crashte de ZIP-export hierop). Volledige testsuite:
324/324 groen.

**Betrokken bestanden:** `web/db/database.js` · `web/server.js` · `web/public/quiz-bank.js` ·
`web/public/quiz-student.js` · `web/public/quiz-review.js` · `VERSION` · overige
`web/public/*.html` (cache-bust)

---

## v2026.2.51.21 — Sprint 51x: Vier meldingen na de jaarwissel-feedback

Vier van de vijf gemelde punten opgelost en getest. Het vijfde (single/multiple-choice als
onderdeel-type bij een samengestelde vraag) is een grotere, meerlagige uitbreiding die apart
zorgvuldig gebouwd wordt — zie onderaan.

### 1. "Leerling toevoegen" gaf geen feedback bij een fout
Kon niet reproduceren met verse testdata (zowel als admin- als als gewone leerkracht werkte
het correct), maar wél een structurele kwetsbaarheid gevonden: zonder try/catch rond de
fetch-aanroep zou een netwerk- of CSRF-fout de hele functie **stil** laten crashen — precies
het "de knop werkt niet, zonder melding"-patroon van eerdere sprints. Nu altijd een duidelijke
foutmelding, ongeacht wat er precies misgaat.

### 2. Schooljaar-dropdown toonde het verkeerde jaar na een jaarwissel
De dropdown op het toets-aanmaakscherm gebruikte nog de oude, kale kalenderberekening
(augustus = nieuw jaar) als standaardwaarde, niet het echte actieve schooljaar van de
leerkracht (sprint 51u). Na een jaarwissel bleef de dropdown dus het oude jaar tonen. Nu haalt
hij het echte actieve jaar op via `/api/teacher/active-school-year`.
**Getest:** na een jaarwissel toont de dropdown correct het nieuwe jaar.

### 3. Modelantwoord bij een code-vraag toonde rode spellingskronkels
Het modelantwoord-veld had al een monospace-lettertype, maar geen `spellcheck="false"` —
Nederlandse woorden binnen Python-strings werden dus als spelfouten onderstreept. Simpele fix:
spellcheck/autocorrect uitgeschakeld op zowel het hoofdvraag- als het onderdeel-modelantwoord-
veld. Dit blijft bewust een gewoon tekstveld — geen uitvoerbare editor, zoals gevraagd.

### 4. Layout-bug bij samengestelde-vraag-onderdelen (het rode kader in de screenshots)
Root cause gevonden: de onderdelen-editor hergebruikte de CSS-klasse `.choice-row` (een
3-koloms grid, ontworpen voor de radio-knop + tekst + verwijderknop van een
single/multiple-choice-optie) maar met slechts 2 elementen — CSS Grid perste daardoor de hele
onderdeel-inhoud in de eerste, 24px-brede kolom. Vandaar de woord-voor-woord-afgebroken tekst
en de "lege pil-vormige vakjes" (dat waren gewoon de tekstvelden, samengeperst tot een paar
pixels breed). Nieuwe, eigen CSS-klasse (`.part-row`, correcte 2-koloms-indeling) lost dit op.
**Getest:** kolombreedte ging van ~24px naar 957px, tekst blijft nu op één regel — visueel
bevestigd met een screenshot.

### Nog te doen (bewust apart gehouden)
Single- en multiple-choice toestaan als onderdeel-type bij een samengestelde vraag raakt het
datamodel, de vragenbank-editor, het leerlingscherm, het scoren én de verbeterpagina — een
te grote, meerlagige uitbreiding om ongetest bij deze fixes te proppen. Wordt apart gebouwd.

**Betrokken bestanden:** `web/public/mijn-klassen.js` · `web/public/quiz-teacher.js` ·
`web/public/quiz-bank.html` · `web/public/quiz-bank.js` · `VERSION` · overige
`web/public/*.html` (cache-bust)

---

## v2026.2.51.20 — Sprint 51w: Onduidelijke actieve tab op het sessiescherm

Op het sessiescherm (Sessies/Toetsen/Taken-knoppen boven "Lopende sessies") was niet te zien
welke tab je bekeek.

### Oorzaak
`.active-tab` werd door `showTab()` correct toegevoegd/verwijderd, maar had **geen enkele
CSS-regel** — de klasse deed dus visueel niets. Daarnaast bleef de titel boven het paneel
altijd "Lopende sessies" tonen, ongeacht welke tab actief was.

### Fix
- **Duidelijk kleurverschil**: de actieve tab krijgt nu de primaire kleur (donkerblauw, wit
  label), de andere blijven neutraal grijs.
- **Dynamische titel**: "Lopende sessies" (Sessies-tab) / "Openstaande toetsen" (Toetsen-tab) /
  "Openstaande taken" (Taken-tab) — precies zoals gevraagd.

**Getest** in een echte browser: bij elke tab-klik is het kleurverschil bevestigd
(`rgb(51,78,162)` actief vs. `rgb(238,241,245)` niet-actief) en de titel wisselt correct mee,
inclusief terugklikken naar Sessies.

**Betrokken bestanden:** `web/public/styles.css` · `web/public/app.js` ·
`web/public/teacher-sessions.html` · `VERSION` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.19 — Sprint 51v: Toets/taak verwijderen + DELETE_ALL-bevestiging

Toets/taak verwijderen "lukte niet" zonder enige melding. Twee samenhangende bugs gevonden en
gefixt, plus de gevraagde extra bevestigingsstap toegevoegd.

### Wat er mis was
1. De knop riep het **verkeerde endpoint** aan (`/api/sessions/:code` i.p.v. het echte
   `/api/quiz/:code`), zonder de al langer verplichte naam-bevestiging mee te sturen.
2. De fetch-respons werd **nooit gecontroleerd** — zowel een succesvolle als een mislukte
   verwijdering gaven dus letterlijk geen enkele melding.
3. Onderweg ook een aparte, pre-existing crash-bug gevonden in `pyPrompt()` zelf
   (`cancelLabel is not defined` — een ontbrekende variabele-declaratie): **elke** plek in de
   app die een tekstinvoer-bevestiging vraagt (waaronder deze nieuwe flow, en de
   licentie-vervaldatum-editor uit een vorige sprint) crashte hierdoor stil.

### Nieuw: DELETE_ALL-bevestiging bij bestaande activiteit
Zoals gevraagd: heeft de toets/taak al scores, commentaren of runs, dan volstaat de gewone
naam-bevestiging niet meer. Er verschijnt een tweede, duidelijke waarschuwing die uitlegt dat
dit ALLE scores/commentaren/resultaten van leerlingen definitief verwijdert, en pas na het
letterlijk intypen van **DELETE_ALL** gaat de verwijdering door. Zonder bestaande activiteit
blijft de gewone (bestaande) naam-bevestiging volstaan.

In beide gevallen — geslaagd of mislukt — verschijnt nu een duidelijke melding.

### Getest
Volledige HTTP end-to-end-test tegen een echte server (5 scenario's: zonder DELETE_ALL
geweigerd met duidelijke reden, mét DELETE_ALL geslaagd en de toets écht weg, foute naam
geweigerd, verkeerd gespelde DELETE_ALL geweigerd) én een volledige browsertest van de
tweetraps-modal-flow zelf (beide modals verschijnen in de juiste volgorde, eindigt met een
zichtbare succes-toast). De `pyPrompt`-crash apart bevestigd en na de fix opnieuw getest.

**Betrokken bestanden:** `web/server.js` · `web/public/app.js` · `VERSION` · overige
`web/public/*.html` (cache-bust)

---

## v2026.2.51.18 — Sprint 51t: Licentiesysteem per school

Naar aanleiding van de vraag hoe een superadmin een school toegang kan geven/ontzeggen voor een
nieuw schooljaar (los van of de klassen/toetsen van die school al gewisseld zijn): een
licentiesysteem met een vervaldatum, bovenop het bestaande handmatige `active`-veld.

### Nieuw
- **`schools.license_expires_at`** (vervaldatum, `null` = nooit verloopt). `active` blijft de
  **handmatige** noodschakelaar; de vervaldatum is de **automatische**, geplande kant.
- **Login-blokkade**: zowel leerkracht- als leerlingaccounts van een school zonder geldige
  licentie (`active=false` of vervaldatum in het verleden) krijgen een duidelijke `403` bij het
  inloggen. Een super-admin is hier altijd van vrijgesteld (hangt nooit aan een school). Dit
  telt bewust **niet** mee als een mislukte inlogpoging — het wachtwoord was correct, enkel de
  school is (nog) niet geldig.
- **Beheer-UI**: de superadmin ziet per school een statusbadge (✅ geldig tot / ⚠️ verloopt
  binnen 30 dagen / ⛔ verlopen) en kan de vervaldatum wijzigen via een nieuwe knop —
  platform-only, net als de bestaande `active`/`license`-velden.

### Ontwerpkeuze: bewust geïsoleerd tot de login-flow
De licentiecontrole zit **niet** verweven in brede, overal-gebruikte functies zoals
`getSchoolsForTeacher` (enkel de kolom is daar toegevoegd, geen extra filter) — dat voorkomt
dat een net-verlopen licentie een al-ingelogde leerkracht midden in zijn werk de toegang tot
zijn eigen klas zou ontzeggen. De check gebeurt uitsluitend op het moment van inloggen.

### Getest
9 losse scenario's tegen een echte database (geldig/verlopen/verloopt-binnenkort/handmatig-
inactief, super-admin altijd toegestaan, andere school niet geraakt, na verlenging weer
toegestaan, leerling-variant) — waarbij een echte bug gevonden en gefixt is (de licentiedatum
werd niet meegegeven door `getSchoolsForTeacher`, waardoor de check altijd "geldig" concludeerde).
Daarna een volledige HTTP end-to-end-test tegen een draaiende server: leerkracht/leerling van
de verlopen school krijgen 403, andere leerkracht en de superadmin loggen gewoon in.

**Betrokken bestanden:** `web/server.js` · `web/db/database.js` · `web/public/admin.js` ·
`VERSION` · overige `web/public/*.html` (cache-bust)

---

### Aanvulling op deze versie: Sprint 51u — Jaarwissel-workflow

Tweede deel van dezelfde vraag als de licentie (Sprint 51t hierboven): hoe een leerkracht zijn
schooljaar consistent kan laten meelopen door de hele app, en hoe hij overgaat naar een nieuw
schooljaar.

### Het probleem
Er bestond geen "actief schooljaar"-concept per leerkracht. Een klas aanmaken viel terug op een
**hardcoded `'2025-2026'`**; een toets/taak zonder klaskoppeling viel terug op een kale
kalenderberekening (augustus = nieuw jaar). Twee leerkrachten konden zo, zonder enige
samenhang, in totaal verschillende "jaren" werken.

### Nieuw
- **`teachers.active_school_year`** — permanent op het account (bewust *niet* sessie-gebonden
  zoals de schoolkeuze). Bron van waarheid, in volgorde: expliciet gezet → meest recente
  niet-gearchiveerde klas van de leerkracht → kalenderberekening als laatste redmiddel.
- **Klas aanmaken en toets/taak zonder klaskoppeling** gebruiken nu dit actieve jaar in plaats
  van de oude hardcoded/kale fallbacks.
- **"Nieuw schooljaar starten"** in Mijn klassen: een checkbox-lijst van je eigen,
  niet-gearchiveerde klassen in je huidige jaar. Bevestigen: elke gekozen klas wordt
  gearchiveerd (**globaal** — geldt voor alle eraan gekoppelde leerkrachten, geen aparte
  per-leerkracht-status) en krijgt een **lege** vervanger met dezelfde naam in het nieuwe jaar,
  gekoppeld aan dezelfde leerkracht(en) als de oude klas (geen dubbele klassen als een
  co-leerkracht al gewisseld heeft). Leerlingen voeg je daarna zelf toe via de bestaande
  "klas wisselen"-tool. Historische data blijft altijd raadpleegbaar via de gearchiveerde klas.
- Eigendom wordt bij elke stap gevalideerd — een leerkracht kan nooit andermans klas archiveren.

### Getest
11 backend-scenario's tegen een echte database (incl. het co-leerkracht-geval en een
IDOR-poging die correct geweigerd wordt), een volledige HTTP end-to-end-test (bevestigt dat een
nieuwe klas zonder expliciet schooljaar meteen het juiste, bijgewerkte jaar krijgt), en een
browsertest van de modal-UI zelf. Een schema-fout (ontbrekende transactie-wrapper) tijdens het
testen gevonden en gefixt.

**Extra betrokken bestanden:** `web/public/mijn-klassen.html` · `web/public/mijn-klassen.js` ·
`scripts/general/run-tests.sh`

---


## v2026.2.51.17 — Sprint 51s: Schooljaar-koppeling, ontbrekende leerlingen & auto-0

Drie samenhangende meldingen onderzocht en opgelost, allemaal grondig getest tegen een echte
database en (waar relevant) een echte browser.

### 1. Toetsen verdwenen stilzwijgend uit het klasoverzicht
Het schooljaar van een toets werd altijd blind berekend uit de **systeemdatum** (augustus =
nieuw jaar) — nooit uit de gekozen klas. Werd een toets aangemaakt na de jaarwissel voor een
klas die zelf nog het vorige schooljaar draagt, dan kreeg de toets een ander schooljaar dan de
klas, en viel hij stil uit het Klasoverzicht (dat filtert op exact dat schooljaar).

**Fix:** het schooljaar is nu een **dropdown** (met de bestaande, actieve schooljaren) die
automatisch het schooljaar van de gekozen klas overneemt en vergrendelt — de klas is de bron
van waarheid. Zonder gekozen klas blijft het vrij instelbaar. Bij het bewerken van een
bestaande toets met een mismatch blijft het opgeslagen (foutieve) schooljaar zichtbaar tot je
zelf de klas aanraakt, zodat je nooit stilzwijgend "gecorrigeerd" wordt.

### 2 & 3. Ontbrekende leerling in de verbeterzone + geen automatische 0
Uitgebreid t.o.v. sprint 51o: `fillMissingQuizAnswers` vult nu **twee** situaties aan, allebei
met een automatische score van **0** (niet langer een lege/NULL-score die apart handmatig
gegeven moest worden):
- leerlingen die **nooit deelnamen** (marker `geen_deelname`),
- leerlingen die **wél deelnamen maar niet alle vragen beantwoordden** — halve inlevering
  (marker `niet_beantwoord`), enkel voor de ontbrekende vraag/vragen.

Deze aanvulling gebeurt nu ook **robuuster**: niet enkel op het moment van stoppen, maar
idempotent telkens de verbeterpagina een reeds-gestopte toets opent — ongeacht via welke weg
die stopte (handmatig, de deadline-cronjob, of iets anders). De verbeterpagina toont een
duidelijke gele banner ("automatisch op 0 gezet bij het stoppen") zodat dit nooit verward
wordt met een score die de leerkracht zelf gaf.

### Getest
- Backend (echte database): beide aanvul-scenario's geven correct `score: 0`, idempotent bij
  herhaalde aanroepen.
- Schooljaar-dropdown (echte browser): correct gevuld, synchroniseert automatisch bij
  klaskeuze, blijft correct tonen bij het bewerken van een bestaande (foutieve) toets.
- Volledige integratietest: een toets met correct gekoppeld schooljaar verschijnt meteen in
  het Klasoverzicht; na het stoppen staan alle klasleden automatisch met score 0 in de
  verbeterzone.
- Volledige testsuite: 324/324 groen.

**Betrokken bestanden:** `web/server.js` · `web/db/database.js` · `web/public/quiz-review.js` ·
`web/public/quiz-teacher.js` · `web/public/quiz-teacher.html` · `VERSION` · overige
`web/public/*.html` (cache-bust)

---

## v2026.2.51.16 — Sprint 51r: Bevestiging bij opslaan algemene commentaar

`saveGeneralComment()` gaf geen enkele feedback — geen bevestiging bij succes, en bij een
mislukte opslag (bv. een netwerkfout) merkte de leerkracht dat niet eens. Nu, consistent met
het scoren van een vraag: een groene toast **"✅ Algemene commentaar opgeslagen."** bij succes,
en bij een fout **"❌ Opslaan van de commentaar is mislukt."** in plaats van stil niets doen.

**Getest** in een browser (Playwright): beide toasts verschijnen met de juiste tekst in
respectievelijk het succes- en het foutscenario.

**Betrokken bestanden:** `web/public/quiz-review.js` · `VERSION` · overige `web/public/*.html`
(cache-bust)

---

## v2026.2.51.15 — Sprint 51q: Vrijgegeven resultaten onzichtbaar + score opslaan faalde stil

Twee losstaande bugs gemeld met screenshots, allebei onderzocht en end-to-end opgelost.

### Leerling zag vrijgegeven resultaten niet
`listReleasedResultsForStudent`/`getReleasedResultDetail` vereisten een **actief
class_membership bij precies de doelklas** van de toets. Maar `quiz_start` staat elke actieve
leerling toe deel te nemen — ook van een andere klas — zodra er geen expliciete
leerlingselectie is ingesteld. Bovendien verdwijnt een class_membership bewust na een
klasverhuizing (sprint 51e), terwijl de resultaten juist moesten blijven bestaan. Gevolg: een
leerling die zelf een toets aflegde, zag zijn eigen vrijgegeven resultaat soms nooit.

**Fix:** de klaslidmaatschap-eis vervangen door de juiste, eenvoudigere grens — "heeft deze
leerling zelf deelgenomen" (er bestaat een `quiz_answers`-rij met zijn `student_id`). Dat sluit
nooit iemand anders in (elke leerling ziet nog steeds enkel zijn eigen resultaten), maar sluit
niet langer terecht-deelgenomen leerlingen buiten.

### Score opslaan bij de laatste vraag deed niets
Als de leerling een vraag **nooit bekeek/beantwoordde** (typisch de laatste vraag bij een
onvolledige inlevering), bestond er geen `quiz_answers`-rij en dus geen `answerId`. De
verbeterpagina deed dan `if (!answerId) return;` — "Opslaan" klikken had zichtbaar geen effect.

**Fix:** nieuw upsert-endpoint (`PUT /api/quiz/:code/students/:studentId/questions/:questionId/score`)
dat de rij aanmaakt als ze nog niet bestaat, i.p.v. enkel een bestaande rij te kunnen
bijwerken. De verbeterpagina gebruikt dit automatisch wanneer er nog geen `answerId` is.

**Getest** tegen een echte database: score opslaan voor een expres verwijderde (niet-bestaande)
antwoordrij lukt nu correct; een leerling van een andere klas dan de doelklas ziet zijn
vrijgegeven resultaat (4/4, `ok:true` op het detail-endpoint) waar hij eerder niets zag.
Regressie-check bevestigt: wie **niet** deelnam, blijft terecht zonder toegang — geen nieuw lek.

**Betrokken bestanden:** `web/db/database.js` · `web/server.js` · `web/public/quiz-review.js` ·
`VERSION` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.14 — Sprint 51p: Herhalende output bij code uitvoeren in een toets

Regressie uit sprint 51n (`quiz_run_request`): de code-output in een toets/taak toonde een
kwadratisch groeiend, herhalend patroon — bv. bij `for i in range(1,11): print(i)` verscheen
`1, 1, 2, 1, 2, 3, 1, 2, 3, 4, …` in plaats van gewoon `1, 2, 3, … 10`.

### Oorzaak
De server stuurt bij elke nieuwe regel output de **volledige, al cumulatief opgebouwde**
tekst (`student._outputAccum`), niet enkel het nieuwe stukje — dat is bewust zo (zelfde patroon
als bij "vrij oefenen"). De listener in `quiz-student.js` deed echter `panel.textContent +=
output`, waardoor de al-cumulatieve serverstring **telkens opnieuw bovenop** de al-opgebouwde
clientstring kwam. `app.js` (vrij oefenen) doet dit al langer correct met `=` (vervangen);
`quiz-student.js` had per ongeluk `+=`.

### Fix
`panel.textContent += output` → `panel.textContent = output`, exact zoals bij vrij oefenen.

**Getest:** de oude logica gesimuleerd bevestigt het exacte, gemelde screenshot-patroon
(`1, 1, 2, 1, 2, 3, …`). Met de fix, tegen een echte server + de echte Python-runner-service,
geeft precies dezelfde code (`for i in range(1,11): print(i)`) nu de correcte output:
`1, 2, 3, 4, 5, 6, 7, 8, 9, 10` — elk getal exact één keer.

**Betrokken bestanden:** `web/public/quiz-student.js` · `VERSION` · overige `web/public/*.html`
(cache-bust)

---

## v2026.2.51.13 — Sprint 51o: Niet-deelgenomen leerlingen in de verbeterzone

Bij het stoppen van een toets/taak (handmatig door de leerkracht, of automatisch bij het
verstrijken van het toegangsvenster) bleven leerlingen die **nooit gestart** waren volledig
onzichtbaar in de verbeterzone. Oorzaak: de verbeterpagina (en het klasoverzicht) bouwen hun
leerlingenlijst uitsluitend uit bestaande `quiz_answers`-rijen — een leerling die nooit een
vraag bekeek, heeft daar geen enkele rij, dus verscheen nergens.

### Wat er nu gebeurt bij het stoppen (beide triggers)
Voor elke **actieve** leerling van de doelklas zonder één enkele inzending wordt nu een
duidelijk gemarkeerde, lege "geen deelname"-inlevering aangemaakt (één placeholder-rij per
vraag: `code=''`, `score=NULL`, `submitted_by='geen_deelname'`). Resultaat:
- **Verbeterzone:** de leerling verschijnt nu in de lijst met een expliciete **"❌ niet
  deelgenomen"**-badge (i.p.v. een misleidende score of gewoon afwezig zijn).
- **Klasoverzicht:** toont automatisch **"⬜ Niets ingeleverd"** — geen aparte aanpassing
  nodig, want dat volgt al uit de bestaande `heeft_inhoud`-logica (lege code/keuzes/runs).

Leerlingen die wél gestart zijn maar niet alle vragen bekeken (halve inlevering) hoefden geen
fix — die tonen al correct "(geen antwoord)" per vraag, want de verbeterpagina loopt over de
volledige vragenlijst, niet enkel de aanwezige antwoorden.

**Idempotent:** meermaals stoppen (of een herhaalde deadline-check) voegt nooit duplicaten toe.
Enkel leerlingen met account-status `active` worden aangevuld — wie sowieso nooit mocht
deelnemen (pending/geblokkeerd) krijgt terecht geen "niet deelgenomen"-vermelding in de
verbeterzone (die staat al gewoon in het klasoverzicht via de normale klas-ledenlijst).

**Getest** tegen een echte database + de echte HTTP-endpoint: `fillMissingQuizParticipants`
vult correct aan (1 leerling, 4 placeholder-rijen), idempotent bij een tweede aanroep, en de
volledige `/stop`-flow toont nadien alle klasleden in `/api/quiz/:code/answers`
(`nietDeelgenomen: 2` in de response, 3 leerlingen zichtbaar waar er eerst maar 1 was).

**Betrokken bestanden:** `web/db/database.js` · `web/server.js` · `web/public/quiz-review.js` ·
`VERSION` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.12 — Sprint 51n: Code uitvoeren in toets/taak + monitoring-widget

Twee losstaande bugs gemeld en opgelost, allebei end-to-end getest tegen een echte server +
runner-service.

### Code uitvoeren in een toets/taak deed niets
Een leerling in een toets/taak heeft socket-rol `quiz_student`, maar de "Run"-knop stuurde
de code naar `free_run_request` — een handler die enkel rol `free` accepteert en bij een
mismatch **stilzwijgend** niets deed (geen foutmelding). Resultaat: het output-tabblad opende
netjes, maar er verscheen nooit iets. Twee nieuwe, parallelle handlers toegevoegd
(`quiz_run_request` en `quiz_runtime_input` voor stdin), met de juiste databron voor een
quiz-leerling. Getest: code uitvoeren + een `input()`-programma werken beide volledig,
inclusief de echo van de ingevoerde waarde.

### Systeem-grid op het sessiescherm gaf 403
Het runner-belasting-balkje op het sessiescherm (bedoeld voor élke leerkracht) riep
`/api/monitoring` aan — een endpoint dat naast onschadelijke capaciteitscijfers ook gevoelige
info teruggeeft (namen/codes van alle actieve sessies van alle leerkrachten, OS-geheugen,
server-heap), en dus terecht superadmin-only staat. Nieuw, minimaal endpoint
`/api/runner-health`: wél een ingelogde leerkracht vereist, geen systeembeheer-rechten, geeft
uitsluitend de vier onschadelijke capaciteitscijfers terug. Het widget gebruikt nu dat
endpoint. Getest met 4 scenario's: gewone leerkracht krijgt de cijfers (200), `/api/monitoring`
blijft voor haar 403, superadmin behoudt volledige toegang tot beide.

**Betrokken bestanden:** `web/server.js` · `web/public/quiz-student.js` · `web/public/app.js` ·
`VERSION` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.11 — Sprint 51m: Secrets interactief (opnieuw) instellen in pycodeflow.sh

Bij "Eerste-start opnieuw" (menu 13) — het scherm dat je na een "Volledige reset" (menu 14)
draait — kon je de beveiligingsgeheimen nooit herzien: het PostgreSQL-wachtwoord werd bij een
leeg volume stilzwijgend hergebruikt, en het cookie-secret en het Cloudflare Tunnel-token
werden nergens gevraagd. Nu kan alles interactief (opnieuw) ingegeven worden, vlak vóór het
effectief gebruikt wordt.

### Wat er nu gebeurt in "Eerste-start opnieuw"
- **PostgreSQL-wachtwoord**: staat er al een in `.env` en is het volume (nog) leeg — bv. net na
  een reset — dan wordt nu expliciet gevraagd of je een nieuw wachtwoord wil ingeven, in plaats
  van het oude stilzwijgend te hergebruiken.
- **Cookie-secret**: nieuwe stap. Staat er al een, dan kan je een nieuwe willekeurige waarde
  laten genereren (`openssl rand -base64 32`, met een terugval als openssl ontbreekt). Bestaat
  er nog geen, dan wordt er automatisch één aangemaakt.
- **Cloudflare Tunnel-token**: nieuwe stap. Kan (opnieuw) geplakt worden — bv. na rotatie in het
  Cloudflare-dashboard — en wordt meteen naar `.env` weggeschreven.
- **Leerkrachtaccount (ClaesAdmin)**: kan ook herzien worden als er al één ingesteld staat, met
  een duidelijke waarschuwing dat dit alleen effect heeft zolang het account nog niet écht in de
  database staat (dus typisch net na een reset) — bestaat het account al, dan gebeurt een
  wachtwoordwijziging via de app zelf (Beheer → Leerkrachten).
- **Tikfout-bescherming**: elk wachtwoord/geheim dat je zelf intypt wordt nu twee keer gevraagd
  (nieuwe helper `lees_geheim_met_herhaling`), met duidelijke foutmelding bij een mismatch of
  een te korte waarde — zelfde bescherming overal consistent toegepast.

Bij elke stap: **Enter (of "n") laat de bestaande waarde ongewijzigd** — je hoeft dus niets in
te typen als je gewoon verder wil met wat er al staat.

**Getest:** vier scenario's met gesimuleerde interactieve invoer — (1) alle geheimen vervangen
op een bestaande `.env`, (2) alles behouden (enter/n), (3) een volledig verse, lege `.env`,
(4) een opzettelijke tikfout bij de herhaling wordt correct geweigerd. Alle vier gaven het
verwachte resultaat, met de juiste waarden in `.env` en geen duplicaten/beschadigde regels.

**Betrokken bestanden:** `scripts/app/pycodeflow.sh` · `VERSION` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.10 — Sprint 51l: Security-audit Fase 3 & 4 (verharding + proces)

Afronding van de security-audit: verharding van bestaande beveiliging en procesmaatregelen
om herhaling te voorkomen. Geen van deze punten was acuut exploiteerbaar (in tegenstelling
tot Fase 1/2), maar sluiten samen het aanvalsoppervlak verder af.

### Dependency-updates
- **DOMPurify: 3.0.6 → 3.4.13.** Dicht **alle 13** bekende hoge-severity CVE's in de vorige
  versie (o.a. XSS-bypasses, prototype pollution, mutation-XSS). Getest: lokaal geserveerd via
  `/vendor/dompurify` (pad ongewijzigd), en live in de browser bevestigd — sanitisatie werkt
  nog correct (XSS-poging verwijderd, normale markdown blijft intact).
- **marked: bewust NIET geüpdatet.** Onderzocht: marked heeft géén enkele CVE in de huidige
  versie (npm audit bevestigt — alle 13 kwetsbaarheden kwamen van dompurify). Een upgrade naar
  een recente major (13+/18) brengt wél reëel regressierisico: de UMD-bundel `marked.min.js`
  bestaat sinds v18 niet meer in de packageroot (enkel nog `lib/marked.umd.js`), en de
  renderer-API wijzigde van `(code, lang)` naar een token-object. Zonder securitywinst weegt
  dat risico niet op — blijft op 9.1.6.
- **npm audit**: van 13 naar **12** kwetsbaarheden (de dompurify-groep is weg). De resterende
  12 zitten allemaal in transitieve dependencies van express/socket.io/exceljs en vereisen
  stuk voor stuk een breaking major-upgrade (`npm audit fix --force`) — bewust niet doorgevoerd
  in deze hardening-ronde; verdient een apart, grondig geteste sprint.

### Kleinere verharding
- **`initials(naam)`** in teacher-grid.js gaat nu door `esc()` vóór het in `innerHTML`
  terechtkomt (was een theoretisch, laag-risico gat: max 2 tekens, geen praktische XSS, maar
  onnodig ongesaneerd).
- **Lengtelimiet op het `announcement`-bericht** (max 1000 tekens) — voorkomt dat een
  onbegrensd bericht naar alle actieve leerlingen tegelijk uitgezonden wordt.

### Proces (voorkomt herhaling van de secrets-lekken uit Fase 1)
- Voortaan wordt **nooit meer het volledige `.env`-bestand** in een leverbare zip meegestuurd.
  Nodige env-wijzigingen (bv. een versienummer) worden als aparte, expliciete instructie
  gegeven, zonder de geheimen zelf te tonen.

### Getest
Volledige testsuite (324/324) + syntax-checks + een live browsertest (marked + DOMPurify samen,
via de echte lokale vendor-routes) die bevestigt dat markdown-rendering en XSS-sanitisatie
beide correct blijven werken na de dompurify-upgrade.

**Betrokken bestanden:** `web/package.json` · `web/server.js` · `web/public/teacher-grid.js` ·
`VERSION` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.9 — Sprint 51k: Security-audit Fase 1 & 2 (kritiek + hoog)

Volledige, kritische audit van de applicatie (auth, autorisatie, XSS, injectie, secrets).
Alle kritieke en hoge-risico bevindingen uit die audit zijn hier gefixt en end-to-end getest
(8 scenario's tegen een echte server, plus de volledige testsuite: 324/324 groen).

### 🔴 Kritiek
- **Privilege escalation:** `POST`/`DELETE /api/admin/teachers/:id/schools` hadden **geen**
  autorisatiecheck — elke ingelogde leerkracht (niet enkel admins) kon zichzelf aan een
  willekeurige school koppelen en zo toegang krijgen tot een andere school. Nu: enkel
  beheerders, en een school-admin enkel binnen zijn **eigen** school(en) (`magSchoolBeheren`).
- **IDOR in `/api/quiz/:code/stop`:** de eigendomscheck gebeurde enkel als de toets toevallig
  in het servergeheugen zat; ontbrak die (bv. na een herstart), dan kon elke leerkracht
  andermans toets stoppen. Nu via `requireSessionAccess` (DB-eigenaar, faalt dicht).
- **Cross-school toegang via `requireSessionAccess`:** dieper liggende bug, tijdens het testen
  ontdekt — elke `admin`-rol kreeg via `magSessieBeheren` toegang tot **elke** toets/taak van
  **elke** school. Geraakt: alle 15+ mutatie-endpoints op een toets/taak (bewerken, scores,
  vrijgeven, verwijderen…). Nu: een gewone admin enkel binnen zijn eigen school(en)
  (`dbModule.delenSchool`); de eigenaar en de super-admin blijven ongewijzigd overal bij kunnen.
- **Bugfix gevonden tijdens het testen van bovenstaande:** `magSessieBeheren` gaf een
  **super-admin** géén toegang tot andermans sessies (checkte enkel `role === 'admin'`, niet
  `'superadmin'`) — een pre-existing bug, los van deze sprint. Nu via `isBeheerder()` (dekt
  beide rollen). Regressietest toegevoegd.

### 🟠 Hoog
- **Zwakke CSRF-validatie:** `origin.includes(host)` was een substring-check, te omzeilen met
  een domein dat de host-string toevallig bevat (bv. `app.pycodeflow.org.evil.com`). Nu een
  exacte host-vergelijking (`new URL(...).host === host`); bovendien wordt een mutatie nu
  geweigerd als zowel `Origin` als `Referer` ontbreken (voorheen stilzwijgend toegestaan).
- **`X-Forwarded-For` ongevalideerd vertrouwd:** rate-limiting/audit-IP's gebruikten de
  client-spoofbare header rechtstreeks, zonder `trust proxy`. Nu: `app.set('trust proxy', …)`
  (env-configureerbaar via `TRUST_PROXY_HOPS`) en één centrale `getClientIp()`/`getSocketIp()`
  die `CF-Connecting-IP` prioriteert (door Cloudflare's edge zelf gezet, niet client-spoofbaar).
- **CSV-formule-injectie:** in de scores-export (`/export/csv`) kon een leerlingnaam die begint
  met `=`, `+`, `-` of `@` als Excel-formule uitgevoerd worden bij het openen. Nu voorkomen
  (OWASP-aanbevolen aanpak: onschuldig aanhalingsteken vooraan bij zo'n cel).

### Getest
Volledige testsuite (324/324, incl. een nieuwe regressietest voor de superadmin-bug) +
8 end-to-end scenario's tegen een draaiende server (embedded PostgreSQL): elke aanval correct
geblokkeerd, elk legitiem gebruikspatroon (eigenaar, superadmin, eigen-school-admin, dev-poorten)
bevestigd nog werkend. Een socket.io-rooktest bevestigt dat de gewone leerling-join-flow intact is.

**Nog open (Fase 3, gepland):** gelekte secrets roteren (actie bij jou), DOMPurify/marked naar
laatste patch, `initials()` escapen, announcement-lengtelimiet, npm audit fix.

**Betrokken bestanden:** `web/server.js` · `web/lib/auth.js` · `web/tests/auth.test.js` ·
`VERSION` · `.env` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.8 — Sprint 51j: Samengestelde vragen (composite)

Nieuw vraagtype **"🧩 Samengesteld"**: een vraag met meerdere antwoordonderdelen (bv.
"waarde van x" + "waarde van y", of een open verklaring + een uitvoerbare code-check).

### Regels (zoals afgesproken)
- Score **per onderdeel**; het totaal van de vraag is de **som** van de onderdeel-punten.
- Enkel **open** en **code** onderdelen zijn combineerbaar — geen single/multiple in een
  samengestelde vraag.
- **Max 6 onderdelen**, waarvan **max 1 code-onderdeel**. Een code-onderdeel heeft **nooit**
  een voorafgaand label (het is altijd de gewone, **altijd uitvoerbare** code-editor — net als
  een normale code-vraag, met Run-knop en output).

### Vragenbank
Nieuwe radio-optie "🧩 Samengesteld" met een onderdelen-editor: per onderdeel het type
(open/code), label, punten en modelantwoord; toevoegen/verwijderen met de regels hierboven
bewaakt. Het puntenveld van de vraag wordt automatisch de som en is read-only.

### Leerlingscherm
Per open-onderdeel een apart tekstveld met label; het code-onderdeel gebruikt de bestaande,
altijd uitvoerbare Monaco-editor. Antwoorden worden per onderdeel opgeslagen en overleven een
paginawissel/reconnect net als de andere types.

### Verbeteren
Per onderdeel: het leerlingantwoord, het modelantwoord (indien ingevuld), en een eigen
scoreveld. Het totaal wordt automatisch herberekend als som van de onderdeel-scores — de rest
van de app (klasoverzicht, PDF, gemiddeldes) blijft gewoon met de totaalscore werken.

### PDF-export
Vragenblad, antwoordformulier (los + ZIP per leerling) tonen elk onderdeel apart, met score
per onderdeel indien gescoord.

### CSV-import
Extra kolom `onderdelen` (labels, `|`-gescheiden); de bestaande `keuzes`- en `punten`-kolommen
worden bij `type=composite` hergebruikt als `[type1;type2]` resp. `[score1;score2]`
(dezelfde volgorde als de labels). Velden met een `;` moeten tussen aanhalingstekens staan.

**Getest tegen embedded PostgreSQL:** bank-vraag met 3 onderdelen (8 punten), snapshot-kopie
naar de toets, realistische seed-antwoorden (Sten volledig gescoord = 8/8, Nina nog niet
gescoord), en het scoren-per-onderdeel-endpoint (totaal na scoren = som, exact geverifieerd).
CSV-import met een composite-voorbeeldregel: 2/2 correct geïmporteerd met juiste punten/types.

**Betrokken bestanden:** `web/db/database.js` · `web/server.js` · `web/public/quiz-bank.js` ·
`web/public/quiz-bank.html` · `web/public/quiz-student.js` · `web/public/quiz-student.html` ·
`web/public/quiz-review.js` · `web/scripts/seed-testdb.js` · `VERSION` · `.env` ·
overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.7 — Sprint 51i: Bugfix leerling → klassessie

- **Leerling kaatste terug naar home bij het kiezen van een (klas)sessie.** Het keuzescherm
  (`student-thuis`) schreef de sessie-status naar localStorage zónder de prefix (`pycodeflow_`)
  en niet JSON-geëncodeerd, terwijl `app.js` op `student-app.html` net die geprefixte,
  JSON-geparste sleutels leest. Daardoor vond de leerling-app geen `studentState` → meteen
  terug naar het startscherm (home). Nu schrijft `student-thuis` exact zoals `app.js` (prefix +
  JSON), en `student-app.html` stopt netjes (`return`) als er echt geen state is.
  Getest: de server-flow (join → reconnect) blijft correct, en de localStorage-sleutels komen
  nu overeen tussen beide schermen.

**Betrokken bestanden:** `web/public/student-thuis.html` · `web/public/app.js` · `VERSION` · `.env` · `web/public/*.html` (cache-bust)

---

## v2026.2.51.6 — Sprint 51h: Rollenregels superadmin

Een **super-admin** is beheerder van het volledige platform en hangt daarom **nooit** aan een
school. Deze invariant wordt nu overal afgedwongen:

- Een super-admin **kan niet aan een school gekoppeld** worden (`POST /api/admin/teachers/:id/schools`
  weigert dit).
- Iemand die nog **aan een school hangt**, kan **niet** tot super-admin gepromoveerd worden —
  ook niet door een super-admin. Ontkoppel de persoon eerst van alle scholen. (`PUT
  /api/admin/teachers/:username/role`).
- Het **bootstrap-account** (ClaesAdmin) dat automatisch superadmin wordt, wordt bij die
  promotie meteen van alle scholen **losgekoppeld**.
- De **seeder** koppelt de superadmin niet langer aan scholen.

Getest tegen embedded PostgreSQL: superadmin heeft 0 schoollinks; een school-gebonden admin
kan niet gepromoveerd worden.

**Betrokken bestanden:** `web/server.js` · `web/scripts/seed-testdb.js` · `VERSION` · `.env` ·
`web/public/*.html` (cache-bust)

---

## v2026.2.51.5 — Sprint 51f: CSV meerregelig + 'open'-type

- **CSV-parser** verwerkt nu geciteerde velden **met newlines**, zodat een vraag een
  markdown **code-blok over meerdere regels** mag bevatten (```` ```python … ``` ````).
  Vroeger werd eerst op regeleindes gesplitst → meerregelige velden braken.
- **'open'-vraagtype** wordt nu ook door de CSV-import herkend (naast code/single/multiple).
- **Privacyverklaring als popup:** een "Privacy"-link in de footer (op elke pagina) opent een
  modal met een beknopte privacyverklaring (welke gegevens, waarvoor, enkel noodzakelijke
  sessiecookies — geen tracking, bewaartermijn, rechten). Geen aparte pagina; één bron
  (`web/public/privacy.js`) die op alle pagina's werkt, ook zonder app.js.

Getest tegen embedded PostgreSQL: een voorbeeld-CSV met 10 vragen (open/single/multiple/code,
markdown + code-blokken) → 10/10 geïmporteerd, keuzes en juiste antwoorden correct.

**Betrokken bestanden:** `web/server.js` · `web/db/database.js` · `web/public/privacy.js` (nieuw) · alle `web/public/*.html` (privacy.js + cache-bust) · `VERSION` · `.env`

---

## v2026.2.51.4 — Sprint 51e: Security-visibility, bugfixes & batch-2 features

Groot pakket: het zichtbaarheidslek gedicht, meerdere bugs uit de vorige batch opgelost,
en de resterende batch-2 features afgewerkt.

### Security — toetsen/taken van anderen zichtbaar (gedicht)
- `/api/quiz-sessions` gebruikte `magSessieBeheren` (admin ziet **álles** + toetsen zonder
  eigenaar zichtbaar voor iedereen) én had **geen school-scope**. Daardoor zag o.a. ClaesAdmin
  (superadmin zonder school) toetsen van collega's. Nu strikt: je ziet **enkel je eigen
  toetsen/taken óf die van een klas waaraan je gekoppeld bent** (co-leerkracht). Geen
  admin-alziend-oog en geen null-eigenaar-uitzondering meer. Getest: superadmin en een
  leerkracht van een andere school zien de toets niet meer.

### ClaesAdmin = superadmin
- Het bootstrap-account wordt voortaan als **superadmin** aangemaakt. Bestaande installaties
  promoveren het bootstrap-account (`BASIC_AUTH_USER`) éénmalig automatisch bij de herstart.

### Bugfixes
- **Geen refresh na "Stoppen":** `stopQuiz` riep een onbestaande functie aan → geen refresh.
  Nu ververst het overzicht meteen; de badge toont **"⏹ gestopt"** (op toets-overzicht én
  op de Sessies-pagina) i.p.v. "Open".
- **ZIP-export gaf 502 (Bad Gateway):** `/pdf/zip` gebruikte een niet-gedefinieerde
  `school`-variabele → crash in een `Promise` zonder reject → de request hing → 502. Gefixt.
- **Algemene commentaar niet opgeslagen/getoond:** opslaan faalde (raw `fetch` zonder
  CSRF-token → 403) en laden miste de join. Nu via `apiFetch` (CSRF) én met een
  `LEFT JOIN quiz_general_comments`, zodat de commentaar bij heropenen verschijnt. Meteen
  alle mutaties op de verbeterpagina (score, release, nazicht, modelantwoord) op `apiFetch` gezet.
- **Vrijgave-status onzichtbaar:** het overzicht toont nu **"✅ scores vrijgegeven"** en
  **"🔍 nazicht open"**, zodat je niet nodeloos opnieuw vrijgeeft.

### Features (batch 2)
- **Klasverhuizing (echt):** een leerling wordt uit zijn klas van hetzelfde schooljaar
  gehaald en aan de nieuwe klas gekoppeld. Historische toetsdata (ook van het huidige jaar)
  blijft, want die hangt aan `student_id` + de toets. Getest: 5A → 6A, resultaten behouden.
- **CSV-import met alle velden:** onderwerp, niveau, type (code/single/multiple), punten,
  vraag, keuzes, juiste antwoord(en), modelantwoord, tags, delen — met header-mapping en
  `;`/`,`-detectie. Volledig gedocumenteerd in de CSV-tab.
- **Student "Mijn resultaten"-tab:** een leerling ziet zijn **vrijgegeven** toetsen/taken van
  zijn **actieve klas/jaar**. Commentaar is altijd zichtbaar; de **volledige toets** enkel als
  de leerkracht **nazicht (`review_mode`)** heeft opengezet.

**Betrokken bestanden:** `web/server.js` · `web/db/database.js` · `web/public/assignment-overview.js`
· `web/public/quiz-bank.js` · `web/public/quiz-review.js` · `web/public/app.js` ·
`web/public/student-thuis.html` · `web/public/quiz-bank.html` · `web/scripts/seed-testdb.js` ·
`VERSION` · `.env` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.3 — Sprint 51d: UI-fixes + security (lokale libs)

Batch 1 van de gemelde punten: bevestigde UI-bugs en een security-verbetering.
(Batch 2 volgt: CSV-volledig, student-resultaten-tab, klasoverzicht-scroll, klasverhuizing.)

### Vragenbank
- "🗑 Verwijderen" is nu **rood** (`btn-danger`), consistent met de rest van de app.

### Toets-/taakoverzicht
- Een door de leerkracht **gestopte** toets/taak toont nu de status **"⏹ gestopt"** op de
  badge-plek (was misleidend "🟢 Open"). De dubbele "gestopt"-pil in de actierij is weg.
- **"Aanpassen"** verdwijnt nu **volledig** zodra de toets/taak gestopt is óf er echte
  activiteit is (leerling gestart/ingeleverd). Vroeger stond er een uitgegrijsde knop.
  Een leerkracht-preview telt niet als activiteit.

### Verbeteren — export
- De export ging via een **browser-prompt + `window.open`**, wat de popup-blocker tegenhield
  ("doet niets"). Nu een **PyCodeFlow-modal met checkboxes**: je kan **meerdere exports
  tegelijk** aanvinken, en downloaden gebeurt via een betrouwbare `<a download>` (geen popup).

### Security — DOMPurify & marked lokaal (geen CDN meer)
- DOMPurify en marked werden van `cdnjs.cloudflare.com` geladen **zonder SRI**. Dat gaf een
  supply-chain-/MITM-risico (externe JS die je XSS-sanitizer ís) én een beschikbaarheidsrisico
  (viel de CDN weg, dan werd niet-gesaniteerde HTML ingespoten).
- Beide libs zijn nu **exact gepind** (`dompurify@3.0.6`, `marked@9.1.6`) en worden **lokaal**
  geserveerd via `/vendor/…` (zoals Monaco). `cdnjs.cloudflare.com` is **uit de CSP** gehaald →
  kleiner aanvalsoppervlak, en de `purify.min.js.map`-CSP-melding is weg. Netto veiliger.

**Betrokken bestanden:** `web/public/quiz-bank.js` · `web/public/assignment-overview.js` ·
`web/public/quiz-review.js` · `web/server.js` (vendor-routes + CSP) · `web/package.json` ·
`web/public/quiz-bank.html` · `web/public/quiz-review.html` · `web/public/quiz-student.html` ·
`web/public/quiz-teacher.html` · `VERSION` · `.env` · overige `web/public/*.html` (cache-bust)

---

## v2026.2.51.2 — Sprint 51c: Verbetermodule + realistische seeder

Drie echte fouten in de verbetermodule (toets/taak) opgelost, plus een realistischere
testdatabase. De toegangsregel voor toetsen/taken is geverifieerd (geen wijziging nodig).

### Toegang tot een toets/taak (geverifieerd — regel klopte al)
Enkel **aanvaarde** leerlingen (status `active`) met een account kunnen een toets/taak maken.
Pending, geblokkeerd en gasten worden geweigerd door de grendel in `quiz_start` (vóór de
leerling een deelname-context krijgt), en `quiz_save_answer`/`quiz_submit_all` vereisen die
context — dus die paden zijn onbereikbaar voor niet-aanvaarde leerlingen. De schijnbare
uitzondering in de testdatabase kwam enkel doordat de **seeder** rechtstreeks antwoorden voor
een pending leerling invoegde; dat is nu rechtgezet (zie onder).

### Bug A — leerlingcode onzichtbaar in de verbetering
De review-editor werd nooit gemount: `#quiz-editor` bestaat pas nadat een vraag gerenderd is,
maar `ensureEditor('quiz')` liep enkel bij het laden van de pagina (host bestond toen nog niet)
→ `setEditorValue` deed niets. Bovendien herbouwt de pagina `#q-detail` (en dus de editor-host)
bij élke vraag, waardoor een eenmaal gemounte Monaco-editor telkens loskoppelde.
- `ensureEditor` (app.js) detecteert nu een losgekoppelde/vervangen host en herbouwt de editor.
- `quiz-review.js` (her)mount de editor per vraag mét de leerlingcode.

### Bug B — "Ingediend Invalid Date"
`BIGINT`-timestamps komen als string uit PostgreSQL; `new Date("1734…")` → Invalid Date. De
review zet nu `Number(...)` rond `submitted_at`/`saved_at` en `ran_at`.

### Realistischere testdatabase (seeder)
- **Enkel aanvaarde leerlingen** nemen deel (Sten Testers + nieuwe Nina Actief). Pia (pending)
  en Bo (blocked) blijven klaslid maar krijgen géén antwoorden — conform de regels.
- **Realistische, per-vraag verschillende code** (echte `som`, for-lus, string-omkering),
  echte keuzevraag-antwoorden met **auto-score**, geldige oplopende **timestamps**,
  **run-history**, en een ingeleverde **taak**. Twee leerlingen krijgen een gelijkaardige
  for-lus zodat de **gelijkenis-detectie** iets te tonen heeft. Nina's codevragen zijn nog
  niet gescoord (demo van "nog te verbeteren").

**Betrokken bestanden:** `web/public/app.js` · `web/public/quiz-review.js` ·
`web/scripts/seed-testdb.js` · `VERSION` · `.env` · `web/public/*.html` (cache-bust)

---

## v2026.2.51.1 — Sprint 51b: Layoutfixes sessie-overzicht (Chromebook)

Kleine layout-patch op het leerkracht-sessie-overzicht (`teacher-sessions.html`),
geoptimaliseerd voor een 13" Chromebook (1366×768).

- **Reuzenvinkjes opgelost (systemisch).** De globale regel `input, textarea` maakte élke
  kale checkbox/radio 100% breed en 48px hoog — zichtbaar in o.a. de toets/taak-voortgang
  ("gewettigd afwezig"), maar ook in admin-, vragenbank- en toetsschermen. Een nette
  normalisatie (`input[type="checkbox"], input[type="radio"]` → 16×16, geen padding) zet
  ze overal op een natuurlijke grootte. Class-specifieke regels (`.checkbox-row`,
  `.config-toggle-label`) blijven gelden.
- **Voortgangstabel liep buiten de kaart.** Het label "gewettigd afwezig" (met
  `white-space:nowrap`) duwde de tabel uit het paneel. Nu compacter ("gewettigd", de
  kolomkop zegt al "Afwezigheid"), met een overflow-veilige wrapper.
- **Bredere rechterkolom.** De sessiepagina staat niet langer 50/50 maar **~35/65**:
  "Nieuwe sessie" smaller, "Lopende sessies / toetsen / taken" breder. `minmax(0,…)`
  voorkomt dat brede tabelinhoud de kolom laat overlopen.

**Betrokken bestanden:** `web/public/styles.css` · `web/public/app.js` · `VERSION` · `.env` ·
alle `web/public/*.html` (cache-bust v2026.2.51.1)

---

## v2026.2.51.0 — Sprint 51: Propere mappenstructuur + OLDIES-opruiming bij rebuild

Structurele opkuis van het project, zonder functionele wijziging aan de app zelf.

### Hoofdmap opgeruimd
De hoofdmap bevat voortaan enkel nog configuratie en Docker: `VERSION`, `.env`,
`.env.example`, `.gitignore`, `docker-compose.yml`, `docker-compose.prod.yml`.

- **Alle scripts** verhuisd naar `scripts/` met subdomeinen:
  - `scripts/app/pycodeflow.sh` (de beheertool),
  - `scripts/general/` (`sync-version.sh`, `run-tests.sh`, `check-deployment.sh`,
    `backup-db.sh`, `health-monitor.sh`, `diagnose-html.sh`, `oldies-check.sh`,
    `Opschonen-Lokaal.ps1`).
- **Alle documentatie** (`.md`/`.pdf`) verhuisd naar `documentation/`.
- Alle onderlinge scriptverwijzingen, `BASE`-berekeningen, de CI-workflow
  (`.github/workflows/ci.yml`) en de health-monitor-cron zijn mee aangepast. Scripts met
  een vast NAS-pad kregen een fallback (`projectroot t.o.v. het script`) zodat ze ook los
  van de NAS werken.

> **Belangrijk voor wie de tool via een snelkoppeling/cron start:** het pad is nu
> `scripts/app/pycodeflow.sh` (en `scripts/general/health-monitor.sh` voor de cron).

### OLDIES-opruiming ingebouwd in de rebuild (menu 5)
Bij een rebuild wordt nu — ná de tests en de rebuild-bevestiging, vóór de effectieve
rebuild — een opruimstap aangeboden met twee aparte j/n-vragen:

```
⚠ Dit rebuildt alle Docker images (kan enkele minuten duren).
  Doorgaan? (j/n): j          ← n = alles annuleren (géén OLDIES-vragen)

── Opruiming oude bestanden (OLDIES) ──
  Wil je de oude OLDIES leegmaken? (j/n): j
  Wil je de controle op oude/irrelevante files doen (verplaatsen)? (j/n): j

  [rebuild + install]
```

- Oude/dubbele/irrelevante bestanden gaan naar **`OLDIES/v<versie>/`** met behoud van de
  oorspronkelijke mapstructuur. Zo staat er altijd precies **één versie** rommel terug,
  mocht er iets fout gelopen zijn.
- Kies je bij "Doorgaan? (j/n)" **n**, dan stopt alles daar — geen OLDIES-vragen, geen rebuild.
- Dezelfde opruiming kan ook los gedraaid worden: `bash scripts/general/oldies-check.sh`
  (met `--dry-run` en `--leeg`).

**Betrokken bestanden:** `VERSION` · `.env` · `.github/workflows/ci.yml` ·
`scripts/app/pycodeflow.sh` · `scripts/general/*` (verplaatst + paden) ·
`documentation/*` (verplaatst + paden) · alle `web/public/*.html` (cache-bust v2026.2.51.0)

---

## v2026.2.50.0 — Sprint 50: Toegang, bewerken, logout & leerling-flow (5 bugfixes)

Vijf gemelde bugs opgelost rond het aanmaken/beheren van toetsen & taken en de
leerling-instap. Daarnaast is de projectmap opgeruimd (zie "Opruiming" onderaan).

### Bug 1 — Toets/taak maken voor een klas zónder toegang (opgelost)
Een leerkracht kon een toets/taak koppelen aan een klas waartoe hij geen toegang had,
of aan een gearchiveerde klas.
- `GET /api/classes` vereist nu authenticatie en geeft enkel **zichtbare, niet-gearchiveerde**
  klassen terug (via `listClassesVisibleTo` — zelfde regel als "Mijn klassen"). Vroeger was
  dit endpoint publiek en gaf het via `listClasses(false)` álle klassen van álle scholen.
- `POST /api/quiz` valideert nu server-side dat de gekozen klas bestaat, niet gearchiveerd is
  en dat de leerkracht er toegang toe heeft (nieuwe helper `klasBruikbaarVoorToets`). Zo kan
  de gefilterde dropdown niet omzeild worden door de request rechtstreeks te versturen.

### Bug 2 — Toets/taak aanpassen (nieuw)
Er was geen enkele manier om een bestaande toets/taak te bewerken.
- Nieuwe endpoints `GET /api/quiz/:code/edit` en `PUT /api/quiz/:code`.
- Nieuwe knop **"✏️ Aanpassen"** op het **toets-/taakoverzicht** (bewust niet in het live-
  of sessiescherm). Het aanmaakscherm opent in bewerkmodus via `?edit=CODE`.
- **Alles** is aanpasbaar (naam, timer, volgorde, tijdvenster, vragen, punten, klas,
  leerlingselectie, opties) **behalve het type** — een taak blijft een taak, een toets een toets.
- Bewerken kan **enkel zolang niemand gestart is en er geen resultaten zijn**. Een
  leerkracht-**preview** telt nooit als activiteit. Zodra er activiteit is, wordt de knop
  uitgeschakeld met uitleg; de server weigert een late `PUT` sowieso (409).

### Bug 3 — "Cannot GET /logout" bij afmelden (opgelost)
`klasmatrix.html` en `mijn-klassen.html` linkten naar `/logout`, dat niet bestond.
- Beide links wijzen nu naar `/api/teacher-logout`.
- Extra vangnet: een `/logout`-alias op de server die de sessie intrekt, de cookies wist
  en naar de login-pagina leidt (voor oude bookmarks/links).

### Bug 4 — Leerlingcode voor toets/taak deed niets (opgelost)
Op het keuzescherm (`student-thuis.html`) werd een code **altijd** naar de les-app gestuurd,
ook voor een toets/taak — waar niets bruikbaars gebeurde.
- Het keuzescherm gebruikt nu dezelfde **socket-join-flow** als het startscherm. De server
  beslist op basis van de code: een les → naar de leerling-app; een toets/taak → naar de
  toets-flow (`redirect_to_quiz`). Zo werkt ook het **joinen van een les** vanaf dit scherm.
- Server dwingt nu af dat je aan een toets/taak **enkel kan deelnemen als je ingelogd bent
  met een aanvaard account**. Het oude "naam-only gast"-gat in `quiz_start` is dicht; een
  gast of nog-niet-aanvaard account krijgt een duidelijke boodschap. Preview blijft vrijgesteld.

### Bug 5 — Lay-out leerling-keuze bij een toets (opgelost)
De leerling-picker was één lange kolom zonder zoekfunctie en onwerkbaar bij veel leerlingen.
- Nieuwe picker met **zoekveld**, een **teller** ("x van y geselecteerd"), knoppen
  "alles aan/uit" die op de **zoekresultaten** werken, en een **responsief kolom-raster**
  (auto-fill) dat vlot naar ~100 leerlingen schaalt.

### Opruiming van de projectmap
Alle verouderde/dubbele bestanden zijn verplaatst naar **`OLDIES/`** (met behoud van de
volledige mapstructuur, zodat terugzetten makkelijk blijft):
- de verouderde dubbele web-boom `scripts/web/` (kopie van 25 juli),
- een verdwaalde `web/public/sprintlog.md`,
- `(1).env.example`, de stale `pgdata/`-bind-mount (compose gebruikt een named volume),
- lege `.ug-tmp`-uploadrestanten en een oude testdocument-PDF (v48.12).

**Betrokken bestanden:** `web/server.js` · `web/db/database.js` ·
`web/public/quiz-teacher.js` · `web/public/quiz-teacher.html` · `web/public/assignment-overview.js` ·
`web/public/student-thuis.html` · `web/public/klasmatrix.html` · `web/public/mijn-klassen.html` ·
`web/tests/sprint50.test.js` (nieuw) · `run-tests.sh` · `VERSION` · `.env`

---

## v2026.2.42.0 — Sprint 42 (Deel C): Branding & schoollogo

### Eigen PyCodeFlow-logo
Het eigen PyCodeFlow-logo (pycodeflow-logo.png) vervangt nu:
- het kleine balk-logo bovenaan op alle 13 pagina's (was logo.svg)
- het grote landingslogo op de startpagina (was atheneum-hoboken-logo.png)

### Atheneum Hoboken-verwijzingen verwijderd
- Footer: "GO! Atheneum Hoboken — alle rechten voorbehouden" → verwijderd.
  Blijft: "© 2026 PyCodeFlow — ontwikkeld door B. Claes" + versie.
- De uitgecommentarieerde AH-subtitel op de startpagina is verwijderd.
- Geen enkele Atheneum/Hoboken-verwijzing meer in de app.

### Nog te komen in sprint 42
- Deel A: startpagina die door de app geserveerd wordt met live versienummer
- Deel B: instapstructuur (/student en /teacher routes)
- Deel C-structuur: balk-logo dynamisch via /api/school-info (default = PyCodeFlow-logo)

**Betrokken bestanden:** public/app.js · public/index.html · 13× public/*.html (balk-logo) ·
public/assets/pycodeflow-logo.png (nieuw)

---

## v2026.2.41.1 — Hotfix: opstart-crash (TDZ ReferenceError)

### Kritieke opstartbug opgelost
De web-container crashte bij het starten met:
`ReferenceError: Cannot access 'log' before initialization` (server.js:124).

Oorzaak: loadVersionFromFile() draait tijdens het laden van de module (regel 130),
maar gebruikte log.* — terwijl `const log` pas op regel 151 wordt geïnitialiseerd.
Een `const` in de "temporal dead zone" aanspreken vóór zijn declaratie gooit een
ReferenceError. Gevolg: de app startte nooit op → Cloudflare toonde 502 Bad Gateway.

Fix: loadVersionFromFile() gebruikt nu console.* i.p.v. log.* — dit is bootstrap-code
die per definitie vóór de logger draait, dus console is hier correct. De 4 andere
log.*-aanroepen vóór regel 151 zitten in de async db-init-callback en draaien pas
ná initialisatie — die zijn veilig en ongewijzigd.

Extra: check-deployment.sh heeft nu een guard die faalt als loadVersionFromFile ooit
opnieuw log.* zou gebruiken.

**Betrokken bestanden:** web/server.js · check-deployment.sh

---

## v2026.2.41.0 — Sprint 41: Schooljaar-selector + read-only gearchiveerde jaren

### Schooljaar-selector
De admin-pagina heeft nu een schooljaar-dropdown boven de klassenlijst. Leerkrachten
kunnen zo de klassen (en leerlingen) van vorige jaren inzien. Gearchiveerde jaren staan
gemarkeerd met een slotje. Bouwt op het membership-model uit sprint 40.

### Gearchiveerde jaren zijn alleen-lezen
Een volledig gearchiveerd schooljaar toont een "alleen-lezen"-banner en de actieknoppen
worden vervangen door "🔒 alleen-lezen". Bekijken en exporteren kan; wijzigen niet.

### Read-only server-side afgedwongen
Niet enkel in de UI: de endpoints POST /api/admin/students en
PUT /api/admin/students/:id/class weigeren een gearchiveerde klas (403). Zo kan een
read-only jaar ook niet via een directe API-call gewijzigd worden — een uitgeschakelde
knop alleen zou onvoldoende zijn.

### Nieuw
- GET /api/admin/school-years — beschikbare jaren met archief-status
- db: getSchoolYears(), isClassArchived(), listClasses() met jaar-filter

### Tests
10 nieuwe tests (tests/schoolyear.test.js). Totaal 159 unit tests.

**Betrokken bestanden:** db/database.js · server.js · public/admin.html · public/admin.js ·
tests/schoolyear.test.js (nieuw)

---

## v2026.2.40.0 — Sprint 40: leerling-lidmaatschap per schooljaar

### class_memberships (vers schema, geen datamigratie)
students.class_id verdwijnt; students is nu puur de PERSOON. Een nieuwe koppeltabel
class_memberships(student_id, class_id, school_year, status) legt vast in welke klas
een leerling per schooljaar zit. Zo kan dezelfde leerling over de jaren heen in
verschillende klassen zitten zonder dat de historiek verloren gaat.

Mogelijk omdat de database leeg herstartbaar is — het juiste model gaat meteen in het
verse schema, zonder de risicovolle migratie. De eerste school start met een schone lei.

### Functies herschreven (signaturen behouden)
listStudents, createStudent, getStudentByName, updateStudentClass en listClasses werken
nu via de koppeltabel. Nieuw: addStudentToClass / removeStudentFromClass. Server en
frontend blijven ongewijzigd omdat de functie-signaturen gelijk bleven.
"Verplaatsen" naar een andere klas laat oude lidmaatschappen staan → historiek intact.

### Uitgesteld (niet weg)
Het migratiepad (bestaande class_id → membership zonder verlies) is nog nodig zodra een
school echte data heeft. Dat hoort bij fase 3 van de multi-tenant roadmap.

### Tests
8 nieuwe tests (tests/membership.test.js). Totaal 154 unit tests.

**Betrokken bestanden:** db/database.js · tests/membership.test.js (nieuw)

---

## v2026.2.38.0 — Sprint 38: Vraag dupliceren in het vragenoverzicht

### Losse vraag dupliceren
Nieuwe "⧉ Dupliceren"-knop op elke vraagkaart in de vragenbank. Maakt een kopie met
alle velden (onderwerp, moeilijkheid, punten, vraagtype, keuzes, tags én modelcode) en
een "(kopie)"-suffix. Na dupliceren opent meteen het bewerk-formulier op de kopie.

### Meerkeuze-valkuil afgevangen
Bij keuzevragen krijgt elke antwoordoptie een NIEUWE id (tekst + correct blijven behouden).
Anders zouden origineel en kopie dezelfde optie-id's delen — dezelfde soort fout als de
33e-bug bij toets-duplicatie.

### Onderscheid met 33e
33e dupliceert een hele TOETS (sessie + snapshots). Sprint 38 dupliceert één BANKVRAAG
in het overzicht — de bron, niet een snapshot.

### Tests
4 nieuwe tests. Totaal 146 unit tests.

**Betrokken bestanden:** server.js · db/database.js · quiz-bank.js · tests/export.test.js

---

## v2026.2.37.3 — Sprint 37c: Commentaar zichtbaar (sprint 37 VOLLEDIG afgerond)

### Commentaar voor de leerling
Het nakijk-scherm toont nu ook het commentaar van de leerkracht:
- Per vraag: een blauw blok "💬 Commentaar van je leerkracht" onder het antwoord
- Algemeen: een blauw blok bovenaan het scherm
Beide via Markdown (marked + DOMPurify), en enkel getoond als ze ingevuld zijn.

### Lek-grens
Commentaar kan een hint naar het antwoord bevatten, dus het wordt — net als de
juiste antwoorden en de modelcode — enkel meegestuurd bij onthulling (nakijk-modus),
nooit tijdens de toets.

### Leerkracht-kant bestond al
Commentaar per vraag (via de score-opslag) en algemeen commentaar waren al aanwezig.
37c bouwde enkel de leerlingweergave.

### Tests
6 nieuwe tests. Totaal 142 unit tests.

### 🎉 Sprint 37 volledig afgerond
De leerling-nakijkmodus is compleet: nakijk-modus openstellen (37d), eigen scherm met
score (37a), juiste antwoorden + modelcode (37b), commentaar per vraag + algemeen (37c).

**Betrokken bestanden:** db/database.js · server.js · lib/review-result.js ·
quiz-student.js · tests/review-result.test.js

---

## v2026.2.37.2 — Sprint 37b: Juiste antwoorden + modelcode

### Juiste antwoorden onthuld bij het nakijken
Het nakijk-scherm toont nu bij meerkeuzevragen welke optie juist was (groen ✓),
en markeert een fout gekozen optie rood ✗. buildMyResult() draait nu met
onthulJuisteAntwoorden: true — maar enkel achter de nakijk-token-guard, dus de
antwoorden lekken nooit tijdens de toets.

### Modelcode / modelantwoord
De leerkracht kan per vraag een modelantwoord ingeven:
- In de vragenbank (nieuw veld, hangt aan de bronvraag)
- In de verbetermodule per toets (inklapbaar veld, eigen opslagknop)
De leerling ziet het modelantwoord bij het nakijken in een groen blok (Markdown).

### Twee duplicatie-bugs opgelost
- Toets DUPLICEREN kopieert nu ook de modelcode mee.
- Toets AANMAKEN uit de bank haalde enkel id/tekst/punten op → vraagtype, keuzes
  én modelantwoord gingen verloren in de snapshot. Nu wordt de volledige bankvraag
  opgehaald (getQuizBankByIds). Dit repareerde meteen een sluimerende bug waarbij
  meerkeuzevragen uit de bank code-vragen werden.

### Tests
7 nieuwe tests (modelAnswer-grens, onthulde correct-vlag, duplicatie behoudt modelcode
+ vraagtype/keuzes). Totaal 136 unit tests.

**Betrokken bestanden:** db/database.js · server.js · lib/review-result.js ·
quiz-bank.html · quiz-bank.js · quiz-review.js · quiz-student.js ·
tests/review-result.test.js · tests/export.test.js

---

## v2026.2.37.1 — Sprint 37a: Leerling-nakijkscherm

### Eigen resultaten inkijken
Nieuw endpoint GET /api/quiz/:code/my-result achter de nakijk-token-guard uit 37d.
Geen studentId in het pad — dat komt uitsluitend uit het ondertekende token.
De leerling ziet: totaalscore + percentage, een staafgrafiek per vraag, en per vraag
een kaartje met de vraagtekst en het eigen antwoord.

### Lekpreventie (lib/review-result.js, nieuw)
buildMyResult() strippt de `correct`-vlag uit de antwoordopties. Een leerling ziet in
37a wel zijn eigen keuze, maar nog NIET welke optie juist was. De vlag
onthulJuisteAntwoorden is de bewuste hook die sprint 37b aanzet.
Twee tests borgen dat het woord "correct" nergens in de payload voorkomt.

### Ook niet-beantwoorde vragen zichtbaar
getMyResult() gebruikt een LEFT JOIN van de vraag-snapshots naar de antwoorden, zodat
overgeslagen vragen in het overzicht verschijnen ("Je hebt deze vraag niet ingevuld")
in plaats van stilletjes te ontbreken.

### Details
- Waarschuwing wanneer nog niet alles verbeterd is (score kan nog wijzigen)
- Score 0 telt als beoordeeld; niet-beoordeeld telt niet mee in het totaal
- Robuust tegen null-waarden en kapotte choices_json

### Tests
15 nieuwe tests (tests/review-result.test.js). Totaal 129 unit tests.

**Betrokken bestanden:** db/database.js · server.js · lib/review-result.js (nieuw) ·
quiz-student.js · run-tests.sh · check-deployment.sh · tests/review-result.test.js (nieuw)

---

## v2026.2.37.0 — Sprint 37d: Nakijk-modus + toegangscontrole

### Nakijk-modus (leerkracht stelt expliciet open)
Nieuwe vlag quiz_meta.review_mode, los van results_released. De leerkracht zet nakijken
aan met de knop "Nakijken: aan/uit" in de verbetermodule. Zolang die aan staat, kunnen
leerlingen hun eigen toets read-only inkijken.

### Leerling-herlogin op elk toestel (geen localStorage)
Via ?nakijken=1 krijgt de leerling een apart loginscherm (naam + klas). De live-toetsflow
blijft ongemoeid. Het nakijk-token blijft in het geheugen van de pagina — niet in
localStorage — dus inzage werkt thuis op een andere pc en laat niets achter op een
gedeelde computer.

### Stateless nakijk-token (lib/review-token.js, nieuw)
HMAC-SHA256 ondertekend token met { toetscode, studentId, vervaltijd }, 2u geldig,
constante-tijd handtekeningcontrole. Geen extra tabel nodig.

### Strenge toegangscontrole
- nakijk-modus uit OF toets bestaat niet → 403 met identieke melding (lekt geen toetscodes)
- onbekende naam → 404 generiek (geen naam-enumeratie)
- dubbele naam+klas → 409 met verwijzing naar de leerkracht
- rate-limiting (10/min) via de bestaande checkJoinRateLimit
- middleware requireReviewToken haalt studentId UITSLUITEND uit het token, nooit uit de URL
- token van toets A werkt niet op toets B

### Belangrijke vondst
quiz_answers.student_id is een sessie-gebonden UUID, geen students.id. De opzoeking
naam+klas gebeurt daarom op quiz_answers zelf (tekst-momentopname). Voordeel: nakijken
werkt ook nadat de les voorbij is. Let op: een sessie verwijderen wist de nakijk-data;
archiveren behoudt ze.

### Tests
12 nieuwe tests (tests/review.test.js). Totaal 114 unit tests.

**Betrokken bestanden:** db/database.js · server.js · lib/review-token.js (nieuw) ·
quiz-review.html · quiz-review.js · quiz-student.html · quiz-student.js · run-tests.sh ·
check-deployment.sh · tests/review.test.js (nieuw)

---

## v2026.2.34.9 — Sprint 33: Nice-to-haves (33a/b/d/e)

### 33e — Toets dupliceren (bugfix)
De dupliceer-functie bewaarde vraagtype + keuzes niet → meerkeuzevragen werden code-vragen.
Nu worden question_type en choices correct meegekopieerd.

### 33d — Vraag-tags in de vragenbank
Nieuwe tags-kolom (komma-gescheiden, met migratie). Tags-invoerveld + tag-filter in de UI,
tags als chips op de vraagkaarten. Client-side filtering (deelstring, hoofdletterongevoelig).

### 33a — Scores naar Excel (CSV)
Nieuw endpoint /api/quiz/:code/export/csv: scores-samenvatting, één rij per leerling, kolom
per vraag + totaal. Puntkomma + UTF-8 BOM → opent direct correct in Excel. Bewust CSV i.p.v.
.xlsx (geen dependency nodig). Optie 8 in het export-menu.

### 33b — Voortgangsgrafiek
SVG-staafgrafiek (geen dependency) in de verbetermodule: score per vraag t.o.v. maximum,
kleurgecodeerd (groen/oranje/rood/grijs).

### 33c — GESCHRAPT (donker/licht thema, wordt niet gedaan)

### Tests
10 nieuwe tests (CSV-matrix + tag-filtering). Totaal 102 unit tests.

**Betrokken bestanden:** server.js · db/database.js · quiz-bank.html · quiz-bank.js ·
quiz-review.js · styles.css · tests/export.test.js (nieuw)

---

## v2026.2.34.8 — Sprint 30b Optie A: CSP-hardening (tijdelijk) + Optie C-plan

### 30b-A — Report-Only strikte CSP (tijdelijke beveiligingswinst)
Het laatste inline <script> (teacher-login.html) geëxtraheerd naar teacher-login.js —
er zijn nu nergens nog inline <script> blokken. Een strikte CSP toegevoegd in Report-Only
modus (script-src 'self', style-src 'self', geen unsafe-inline): breekt niets, maar toont
in de browserconsole exact welke inline handlers/styles Optie C moet opruimen. De
handhavende CSP houdt voorlopig unsafe-inline met een duidelijke TIJDELIJK-markering.

### Optie C volledig gepland (sprint 30b-vol)
Gefaseerd plan in de sprintlog om unsafe-inline volledig te verwijderen: 123 inline
event-handlers → addEventListener (fase 1, per pagina), 384 inline style= → CSS-klassen
(fase 2), dan enforce strikte CSP én verwijder de Report-Only header van Optie A (fase 3).
~8-10 dagen, veilig gefaseerd met test na elke pagina.

### Tests
2 nieuwe Report-Only CSP-tests. Totaal 92 unit tests.

**Betrokken bestanden:** server.js · teacher-login.html · teacher-login.js (nieuw) ·
run-tests.sh · sprintlog.md · tests/security.test.js

---

## v2026.2.34.7 — Sprint 32: Technische schuld (32a/b/c)

### 32b — Gestructureerde logger met niveaus
Nieuwe lib/logger.js: niveaus error/warn/info/debug via LOG_LEVEL env-var (standaard info).
Alle 43 console.* in server.js vervangen door log.* met tijdstempel + niveau-prefix.
LOG_LEVEL=debug voor uitgebreide logs; info onderdrukt debug-ruis. 11 tests.

### 32c — Monaco-versie centraal
Geverifieerd: versie gepind in package.json (0.47.0, sinds 36d), geserveerd uit
node_modules. HTML verwijst enkel naar route-prefix /monaco/min/vs. Comment toegevoegd.

### 32a — Inline scripts naar aparte bestanden
8 pagina's met grote inline <script> (monitoring 758 rgls, quiz-bank 552, ...) → alle JS
geëxtraheerd naar aparte .js-bestanden via <script src>. Deblokkeert sprint 30b (unsafe-
inline uit CSP). Laadvolgorde bewaakt (marked/DOMPurify/socket.io/Monaco vóór pagina-script).
CI checkt nu alle 8 geëxtraheerde bestanden.

Bonusvangst: quiz-review.html laadde nooit socket.io.js terwijl het io() aanroept — gefixt.

### Tests
11 logger-tests. Totaal 90 unit tests.

**Betrokken bestanden:** server.js · lib/logger.js (nieuw) · 8× *.js (geëxtraheerd) ·
8× *.html · run-tests.sh · .env.example · check-deployment.sh · tests/logger.test.js (nieuw)

---

## v2026.2.34.6 — Sprint 31: UX & consistentie (31a/b/c)

### 31b — localStorage-sleutels geharmoniseerd
De sleutels gebruikten inconsistent de pycodeflow_ prefix. Nu voegen setLS/getLS/delLS
die transparant toe; alle directe localStorage-calls vervangen door de helpers. Een
eenmalige migratie hernoemt bestaande oude sleutels → geen sessie/naam-verlies bij upgrade.

### 31a — Consistente loading states
Herbruikbare .spinner / .loading-row CSS + loadingHtml() helper voor uniforme laad-weergave.

### 31c — Uniforme foutmeldingen
Alle browser alert()/confirm() (11 alerts + 1 confirm) in app.js vervangen door de eigen
pyAlert (fouten), pyToast (successen) en pyConfirm (bevestigingen). Consistente, niet-
blokkerende meldingen overal.

### Tests
9 nieuwe storage-tests (prefix + migratie). Totaal 79 unit tests.

**Betrokken bestanden:** app.js · styles.css · tests/storage.test.js (nieuw) · check-deployment.sh

---

## v2026.2.34.5 — Sprint 36: Data-integriteit (36a/b/c/d) + kritieke hash-fix

### 🚨 Kritieke bug: hash-formaat mismatch (admin teacher-beheer kapot)
De sprint 34a-refactor liet twee admin-endpoints achter met `const {hash,salt} =
createPasswordHash()` terwijl die functie nu één string teruggeeft → salt undefined →
crash. Het aanmaken/wijzigen van leerkrachten via admin.html was stuk. Beide endpoints
gebruiken nu direct de scrypt-string. 3 tests borgen de consistentie.

### 36a — Transacties bij multi-step schrijfacties
Nieuwe withTransaction(fn) helper (BEGIN/COMMIT/ROLLBACK). createQuizSession (meta +
vraag-snapshots) en saveQuizStudentOrder draaien nu atomair — geen half-geschreven toets
meer bij een crash.

### 36b — persistSession debounce
Geverifieerd al aanwezig (schedulePersist 2s debounce + persistNow voor kritieke ops).

### 36c — Centrale validatie breder ingezet
Admin-endpoints (teacher-create, role-update) valideren nu via lib/validation.js.

### 36d — Dependencies gepind
Alle deps van ^caret naar exacte versies (reproduceerbare builds). npm audit draait in CI.

### Tests
3 hash-consistentie + 4 transactie-tests. Totaal 70 unit tests.

**Betrokken bestanden:** database.js · server.js · package.json · lib/validation.js ·
tests/auth.test.js · tests/transaction.test.js (nieuw) · check-deployment.sh

---

## v2026.2.34.4 — Sprint 30: Security hardening (30a/c/d)

### 30a — Login-cookie met Max-Age (bewuste sessieduur)
Het teacher_auth cookie had geen Max-Age (verdween bij browser sluiten). Nu configureerbare
sessieduur via POC_SESSION_MAX_AGE_HOURS (standaard 8u = schooldag). 0 = oud gedrag.

### 30c — upgrade-insecure-requests in CSP
CSP-directive toegevoegd zodat mixed content automatisch naar HTTPS wordt geüpgraded.

### 30d — Automatische DB-backup werkt nu écht
Het backup-menu (pycodeflow.sh optie 16) verwees naar een niet-bestaand backup-db.sh —
de hele functie was dood. Nieuw scripts/backup-db.sh: pg_dump → gzip → backups/, met
retentie (BACKUP_RETENTION_DAYS, standaard 7d), lege-dump-detectie en logging. De cron-optie
(dagelijks 02:00) werkt nu. Restore-flow gefixed (ontbrekende PGPASSWORD).

### Tests
10 nieuwe tests in tests/security.test.js (cookie Max-Age, CSP-structuur). Totaal 64 unit tests.

**Betrokken bestanden:** server.js · scripts/backup-db.sh (nieuw) · pycodeflow.sh ·
.env.example · check-deployment.sh · tests/security.test.js

---

## v2026.2.34.3 — Sprint 30-cfg + 30-copy: config-toepassen + contextuele kopieerknop

> Let op: het versienummer loopt monotoon op en is ontkoppeld van het sprintnummer.
> Dit is sprint 30-werk, maar het bouwt voort op v2026.2.34.x, dus het nummer is 36.0
> (hoger = nieuwer). Het sprintnummer staat in de titel, niet in het versienummer.

### 30-cfg — Sessie-instellingen met "Toepassen"-knop (KRITIEK)
De config-toggles (auto-indent enz.) namen pas effect zodra een ándere checkbox werd
aangeklikt (Monaco off-by-one). Opgelost met de deterministische knop-aanpak:
- checkboxes zetten enkel een "dirty"-vlag (markConfigDirty)
- een "Toepassen"-knop verzamelt alle waarden, stuurt ze in één keer (teacher_apply_session_config)
  en past ze meteen toe op de leerkracht-editor + broadcast naar leerlingen
- server valideert via lib/validation.js (whitelist + booleancheck)
- 9 nieuwe tests; totaal 54 unit tests

### 30-copy — Contextuele kopieerknop
De zwevende "Kopieer output"-knop is vervangen door één contextbewuste knop in de toolbar
(teacher, student, free). Kopieert code als het code-paneel zichtbaar is, output als het
output-paneel zichtbaar is. Werkt in klas-, individuele en vrije modus. Tooltip volgt de
context. Oude zwevende knoppen, CSS en losse listeners verwijderd.

**Betrokken bestanden:** app.js · teacher-app.html · student-app.html · free-editor.html ·
server.js · styles.css · lib/validation.js · tests/validation.test.js

---

## v2026.2.34.2 — Testdiagnose + quiz-student.html verificatie

### run-tests.sh toont nu exacte foutlocatie
Bij een gefaald inline-script toont de CI nu de foutmelding én het bestandsregelnummer,
i.p.v. enkel "syntaxfout". Zo is meteen duidelijk wat en waar het probleem zit.

### Nieuw: diagnose-html.sh
Standalone hulpmiddel: `bash diagnose-html.sh web/public/<bestand>.html` toont de exacte
syntaxfout, het regelnummer en de omliggende code. Handig om NAS-specifieke problemen
op te sporen.

### quiz-student.html
De referentieversie is geverifieerd geldig (vm.Script, browser-equivalent). Als de CI
op de NAS een fout meldt voor dit bestand, is de lokale versie afwijkend — vervang door
de meegeleverde versie of gebruik diagnose-html.sh om het verschil te vinden.

**Betrokken bestanden:** run-tests.sh · diagnose-html.sh (nieuw) · quiz-student.html

---

## v2026.2.34.1 — Hotfix: pycodeflow.sh test-integratie

### Bug: `fail: command not found` bij rebuild
De rebuild-flow (optie 5) riep `fail` aan om gefaalde tests te melden, maar die
functie bestaat niet in pycodeflow.sh (heet daar `err`). Gecorrigeerd naar `err`.

### run-tests.sh: onderscheid ontbrekende bestanden vs syntaxfouten
Als de sprint 34 test-bestanden (web/lib/, web/tests/, runner/test_sandbox.py) nog
niet gedeployed zijn, gaf `node --check` een verwarrende "syntaxfout". Nu een duidelijke
melding "bestand ONTBREEKT (niet gedeployed?)". Idem voor de tests/ map en sandbox-tests.

**Oorzaak:** de nieuwe pycodeflow.sh + run-tests.sh werden gedraaid vóór de nieuwe
lib/tests-bestanden waren uitgepakt. Na volledige deploy van de sprint 34 ZIP is dit opgelost.

**Betrokken bestanden:** pycodeflow.sh · run-tests.sh

---

## v2026.2.34.0 — Sprint 34: Geautomatiseerd testen + CI

### 34a — Testbasis voor kritieke paden
Kritieke logica geëxtraheerd naar herbruikbare, testbare modules in `web/lib/`:
- `lib/auth.js` — safeEqual, scrypt hash/verify, Basic-Auth & cookie parsing
- `lib/scoring.js` — automatische scoring (single/meerkeuze, pro-rata)
- `lib/validation.js` — sessiecode, config-whitelist, clamp-helpers, rolvalidatie
`server.js` requiret deze modules (één bron van waarheid, geen duplicatie meer).
45 unit tests via het ingebouwde `node:test` (geen extra dependencies).

### 34b — CI-pipeline
- `run-tests.sh`: lokale CI — JS syntax, inline-HTML-scripts (via `vm.Script`,
  browser-equivalente parser), unit tests, sandbox-tests, npm audit
- `.github/workflows/ci.yml`: draait bij elke push/PR
- pycodeflow.sh optie 20 draait tests handmatig; optie 5 (rebuild) draait ze
  automatisch vóór deploy en blokkeert bij falen

### 34c — Sandbox-escape tests geautomatiseerd
`runner/test_sandbox.py`: 12 tests die verifiëren dat verboden modules (os,
subprocess, ctypes, socket …) geblokkeerd blijven, ook via submodule-omzeiling,
terwijl toegestane modules (math, random, json) blijven werken.

### Bonusvangst — echte bug ontdekt door de CI
`quiz-review.html` bevatte een niet-afgesloten geneste template-literal (het
editor-blok bij code-vragen). Browsers waren lenient, maar het was technisch
ongeldig. Meteen gecorrigeerd — precies waarvoor de testbasis bedoeld is.

**Betrokken bestanden:** web/lib/{auth,scoring,validation}.js (nieuw) ·
web/tests/*.test.js (nieuw) · runner/test_sandbox.py (nieuw) · run-tests.sh (nieuw) ·
.github/workflows/ci.yml (nieuw) · server.js · quiz-review.html · package.json ·
pycodeflow.sh · check-deployment.sh

---

## v2026.2.29.1 — Sprint 29_part2: Vervolgbugs uit gebruikerstests

### 29p2-a — Editor-config nu direct toegepast
`emitConfigChange` werkt `_sessionConfig` bij én past de wijziging meteen toe op de
leerkracht-editor. `updateEditorConfig` gebruikt `_sessionConfig` voor teacher én student.
De teacher session data handler populeert nu `_sessionConfig` uit `data.config`.
Auto-indent enz. verschijnen nu onmiddellijk, in individuele én klasmodus.

### 29p2-b — Vragenbank-knoppen werken weer
Window-exports staan nu vóór de init-code (elk in eigen try/catch), zodat een fout in
loadSubjects/loadQuestions de knoppen niet meer blokkeert. Sprint 26-regressiepatroon.

### 29p2-c — Layout "nieuwe toets" eerste blok hersteld
Timer/Vraagvolgorde herstructureerd met uniforme `.opt-card` keuze-kaarten. "aanbevolen"
is nu een nette badge-pill. Responsive behouden.

### 29p2-d — Login-probleem na rebuild opgelost
- server.js toont bij bootstrap de exacte inlognaam in een duidelijk kader, en logt bij
  bestaande leerkrachten de inlognaam/-namen (inloggen met username, niet weergavenaam)
- pycodeflow.sh optie 19k "🆘 Kan niet inloggen?" — toont leerkrachten + reset wachtwoord
  in één flow, met duidelijke inloginstructie

**Betrokken bestanden:** app.js · quiz-bank.html · quiz-teacher.html · server.js · pycodeflow.sh

---

## v2026.2.29.0 — Sprint 29: Kritieke bugs + versie-automatisering

### 29a — teacher-grid leerlingenoverzicht bleef leeg
De sprint 27i fallback las `localStorage.getItem('teacherSessionCode')` raw, maar `setLS()`
slaat JSON-encoded op (met quotes) → ongeldige sessiecode. En `pycodeflow_teacherSessionCode`
werd nergens geschreven. Fix: `readStoredSessionCode()` in teacher-grid.html JSON-parset de
waarde correct met fallback.

### 29b — Laatste icon-only knop zonder tooltip
quiz-teacher.html lijn 303 (✕ vraag uit selectie): `title` + `aria-label` toegevoegd.

### 29c — Stille fouten door lege catch-blokken
Alle 20 lege `catch {}` blokken over app.js, admin/monitoring/quiz-bank/quiz-review/quiz-teacher
en server.js voorzien van contextuele `console.warn` logging (of expliciete comment bij
best-effort operaties).

### Versie-automatisering bij deploy (nieuw)
- `VERSION`-bestand in project-root = single source of truth
- server.js leest het bij opstart (boven .env), gecontroleerd op meerdere paden
- docker-compose mount `./VERSION:/VERSION:ro` → wijziging actief zonder rebuild
- nieuw `sync-version.sh`: propageert versie naar .env + alle HTML cache-bust strings
- pycodeflow.sh optie 1 gebruikt sync-version.sh; optie 5 (rebuild) auto-synct

**Deploy-flow:** pas VERSION aan → herstart. Geen handmatige multi-file versie-edits meer.

**Betrokken bestanden:** VERSION (nieuw) · sync-version.sh (nieuw) · app.js · teacher-grid.html · quiz-teacher.html · admin.html · monitoring.html · quiz-bank.html · quiz-review.html · server.js · docker-compose.yml · pycodeflow.sh · check-deployment.sh

---

## v2026.2.28.0 — Sprint 28: DOMPurify + subnav + structuurfix

### 28c — DOMPurify XSS-beveiliging (security R-01)
`DOMPurify` CDN toegevoegd aan `quiz-student.html`, `quiz-review.html` en `quiz-bank.html`.
`renderMarkdown()` sanitiseert nu de HTML na `marked.parse()`. Inline `<script>` en
`onerror`-handlers in vraagstellingen worden verwijderd; `style` (kleuren) blijft toegestaan.

### 28d — quiz-review.html subnav actief-markering
"📦 Archief" krijgt nu `class="active"` in de subnav van de verbetermodule.

### 28f — free_run_rate_limited structuurfout
Loshangende regels (lijn 1490-1494 in `app.js`) buiten de handler verwijderd — restant van
sprint 27k merge. `setTab` + `forEach` nu correct binnen de handler. `node --check` OK.

### 28a + 28b — geverifieerd als al aanwezig
- 28a (automatische scoring keuze-vragen): al aanwezig in server.js sinds eerdere sprint
- 28b (check-deployment sprint 12+): al voldoende in v2026.2.27.0

**Betrokken bestanden:** `app.js` · `quiz-student.html` · `quiz-review.html` · `quiz-bank.html` · `server.js` · `check-deployment.sh`

---

## v2026.2.27.0 — Sprint 27: Bugfixes + tooltips + DB-beheer

### 27a–27g — check-deployment.sh fixes
- **27a:** bash syntaxfout lijn 311 — `grep -c || echo 0` gaf `"0\n0"` string → vervangen door `grep -q` check
- **27b–27e:** `grep -qE "A\|B"` werkt niet in bash (`\|` = letterlijk) → herschreven naar `check_contains_any` met aparte `-e` vlaggen
- **27f:** "Geen leerkrachten" warning verduidelijkt — normaal bij verse installatie, verwijst naar bootstrap
- **27g:** `check_contains_any()` hulpfunctie toegevoegd voor multi-patroon grep

### 27h — Tooltips op knoppen zonder label
`title` attributen toegevoegd op 34 knoppen over 4 pagina's: `teacher-app.html` (18), `student-app.html` (8), `quiz-student.html` (5), `quiz-teacher.html` (1).

### 27i — teacher-grid.html leerlingenoverzicht leeg
Dubbele fallback voor sessiecode: `window._currentSessionCode || getLS('teacherSessionCode')`. Bij lege code: `pyAlert` i.p.v. leeg venster. Zelfde fallback in `teacher-grid.html`.

### 27j — Editor dark/light toggle verwijderd
`applyEditorTheme()`, `toggleEditorTheme()`, `_editorTheme` localStorage, `Ctrl+Shift+T` handler, shortcut-overlay rij en 6 CSS-klassen verwijderd. Monaco altijd `pycodeflow-dark`.

### 27k — Leerling kan niet runnen in individuele modus
1. `run_rate_limited`: `setTimeout` toegevoegd — bericht verdwijnt automatisch na `waitMs + 300ms`
2. `server.js`: bij wissel naar individuele modus alle `personalCanRun` teruggezet op `true`

### 27l — Database viewer "query is not a function"
`query` functie toegevoegd aan `module.exports` in `database.js`. `server.js` DB viewer endpoints gebruiken nu `dbModule.query` i.p.v. `require('./db/database.js').query`.

### 27m — Bootstrap admin bij lege DB
Bij serverstart: als `teachers` tabel leeg is én `POC_BASIC_USER` + `POC_BASIC_PASS` in `.env` staan → admin-account automatisch aangemaakt. Nooit meer "kan niet inloggen na verse installatie".

### 27n — pycodeflow.sh optie 19: DB-beheer menu
Volledig sub-menu met opties a–i: leerkrachten/klassen/leerlingen tonen en beheren, noodtoegang bootstrap, DB-statistieken.

**Betrokken bestanden:** `check-deployment.sh` · `app.js` · `server.js` · `database.js` · `teacher-app.html` · `student-app.html` · `free-editor.html` · `quiz-student.html` · `quiz-teacher.html` · `teacher-grid.html` · `styles.css`

---

## v2026.2.27.0 — Sprint 27: Bugfixes + tooltips + DB-beheer

### 27a-g — check-deployment.sh volledig gefixed
- Bash syntaxfout lijn 311: ERRORS-berekening herschreven (geen `grep -c || echo 0`)
- Alle `grep -qE "A\\|B"` patronen herschreven naar `check_contains_any` met aparte grep-calls
- Nieuw: `check_contains_any file label pat1 pat2 ...` hulpfunctie voor multi-patroon checks
- 27f: "Geen leerkrachten" warning uitgebreid met context + verwijzing naar bootstrap (27m)
- 27n check: controleert `actie_db_beheer` aanwezig in pycodeflow.sh

### 27h — Tooltips op knoppen
`title` attributen toegevoegd op alle icon-only knoppen in `teacher-app.html` (statusfilters,
Run all, Code all, Export, Sessie afsluiten, timer), `student-app.html` (Run),
`quiz-student.html` (navigatie, indienen), `quiz-teacher.html` (✕ verwijder).

### 27i — teacher-grid.html sessiecode fallback
Dubbele fallback: `window._currentSessionCode || getLS('teacherSessionCode')`.
`pyAlert` als beide leeg zijn. Zelfde fallback in `teacher-grid.html` zelf via `localStorage`.

### 27j — Editor thema-toggle verwijderd
☀️ knop verwijderd uit `teacher-app.html`, `student-app.html`, `free-editor.html`.
`Ctrl+Shift+T` handler verwijderd. Monaco altijd `pycodeflow-dark`. `applyEditorTheme`
aanroep en `window.applyEditorTheme` export verwijderd.

### 27k — Leerling run-melding wist zichzelf
`run_rate_limited` en `free_run_rate_limited` handlers: `setTimeout` toegevoegd om
"⏳ Even wachten"-melding automatisch te wissen na `waitMs + 300ms`.

### 27l — Database viewer "query is not a function" gefixed
`query` toegevoegd aan `module.exports` in `database.js`. Server.js DB viewer endpoints
gebruiken nu `dbModule.query` i.p.v. een inline `require()`.

### 27m — Bootstrap admin bij lege teachers-tabel
Bij serverstart: als `teachers` leeg is én `POC_BASIC_USER` + `POC_BASIC_PASS` in `.env`
staan, wordt automatisch een admin-account aangemaakt. Inloggen altijd mogelijk.

### 27n — pycodeflow.sh optie 19: DB-beheer
Nieuw submenu met 9 opties: leerkrachten/wachtwoorden, klassen, leerlingen, statistieken,
en noodtoegang (bootstrap admin uit .env).

**Betrokken bestanden:** `check-deployment.sh` · `app.js` · `teacher-app.html` ·
`student-app.html` · `free-editor.html` · `teacher-grid.html` · `quiz-student.html` ·
`quiz-teacher.html` · `database.js` · `server.js` · `pycodeflow.sh`

---

## v2026.2.26.1 — Hotfix: Deelnemen + Vrij oefenen knop kapot

### Rootcause: student-start.html niet in _socketPages

`app.js` initialiseert Socket.IO enkel op pagina's in de `_socketPages` whitelist.
`student-start.html` ontbrak in die lijst — beide knoppen riepen `socket.emit(...)` aan
op een no-op stub die niets doet. Fix: `'student-start.html'` toegevoegd aan `_socketPages`.

**Betrokken bestanden:** `app.js`

---

## v2026.2.26.0 — Sprint 26: Bugfixes + check-deployment bijgewerkt

### Versie-consolidatie

Sprint 26 bugfixes werden eerder uitgebracht als hotfixes v2026.2.25.1 en v2026.2.25.2.
Dit is de officiële versie-bump naar v2026.2.26.0 waarbij alle bestanden consistent zijn bijgewerkt.

### Overzicht sprint 26 (alle subtaken afgerond)

- **26a** — app.js IIFE: 40 functies op `window` gezet (leerkrachtsessie, leerling-join, vrije editor, editor-knoppen, Monaco, sneltoetsen, ...)
- **26b** — `window.pyAlert` definitie toegevoegd aan app.js (ontbrak volledig na sprint 25g)
- **26c** — quiz-bank.html + quiz-archive.html: onclick-functies onbereikbaar door `'use strict'` scoping → window-exports
- **26d** — quiz-archive.html: `exportStudentPDF()` niet async maar gebruikte `await` → fixed
- **26e** — admin.html: leerling-actieknoppen uitgebreid met labels en `title`-attributen
- **26f** — check-deployment.sh volledig herschreven (v2026.2.14 → v2026.2.26.0):
  - templates.json: correct pad (web/ niet web/public/)
  - monaco-env.js: dynamisch endpoint, geen statisch bestand
  - Sectie 8: app.js window-exports gecontroleerd (16 functies)
  - Sectie 9: beveiligingscontroles (CSP, cookies, CSRF, rate limiting)
  - Sectie 10: runner sandbox controles
  - Sectie 11: per-tabel DB-controle + archived kolom + Monaco endpoint
  - Sectie 13: alle documentatiebestanden

**Betrokken bestanden:** alle HTML-bestanden · `app.js` · `server.js` · `check-deployment.sh` · `.env`

---

## v2026.2.25.2 — Kritieke hotfix: app.js IIFE window-exports + pyAlert

### Bug 26a+26b — ROOT CAUSE: app.js IIFE sluit alle functies in closure

**Oorzaak:** `app.js` is verpakt in een IIFE (`(() => { ... })()`). Alle 51 functies
erin zijn daardoor scoped aan die closure — HTML `onclick`-handlers kunnen ze
**niet** bereiken. Dit brak: leerkrachtsessie starten, leerling-join,
vrije editor, sessies laden/verwijderen, editor-functies, Monaco,
aankondigingen, leerlingenlijst, sneltoetsen, history-playback, ...

**Fix:** 40 functies expliciet op `window` gezet aan het einde van de IIFE,
zodat ze globaal bereikbaar zijn vanuit alle HTML-pagina's.

**Fix pyAlert:** `window.pyAlert` definitie ontbrak volledig — de 42 aanroepen
gaven `TypeError: pyAlert is not a function`. Definitie toegevoegd na de IIFE.

**Betrokken bestanden:** `app.js` · (indirect alle pagina's)

---

## v2026.2.25.1 — Hotfix sprint 26: knoppen vragenbank & archief, tooltips admin

### Bug 1 — quiz-bank.html: switchTab + alle onclick-functies niet bereikbaar (ReferenceError)
**Oorzaak:** `'use strict'` in inline `<script>` maakt functies module-scoped — `onclick="switchTab(...)"` in HTML kan ze niet bereiken.
**Fix:** Alle onclick-functies expliciet op `window` gezet (`window.switchTab = switchTab`, etc. — 20 functies).

### Bug 2 — quiz-archive.html: `await` buiten async context (SyntaxError)
**Oorzaak:** `exportStudentPDF()` gebruikte `await pyAlert(...)` maar was niet als `async` gedeclareerd.
**Fix:** `function exportStudentPDF()` → `async function exportStudentPDF()`.
Tevens zelfde globale window-exports toegevoegd als bug 1 (switchTab + alle archive-functies).

### Bug 3 — admin.html: actieknoppen leerlingen zonder label/tooltip
**Oorzaak:** "🗒" en "✕" knoppen hadden geen tekst en geen `title` attribuut — bij hoveren geen feedback.
**Fix:** Knoppen uitgebreid met labels ("🗒 Notitie", "🗑 Verwijderen") en `title` attributen op alle actieknoppen (Blokkeren, Aanvaarden, Deblokkeren, Notitie, Verwijderen).

**Betrokken bestanden:** `quiz-bank.html` · `quiz-archive.html` · `admin.html`

---

## v2026.2.25.0 — Sprint 25: Rijke vraagstelling editor

### 25g — pyAlert() — blokkerende notificatie-modal
Nieuw `window.pyAlert(message, type)` in `app.js`. Blokkeert de pagina met een gecentreerde modal + overlay. Kleurgecodeerd (rood/oranje/groen/blauw). Alle `pyToast(..., 'warn'/'error')` op alle pagina's vervangen door `await pyAlert(...)`. Succes-meldingen blijven toast.

### 25a — Visuele opmaaktoolbar
Toolbar boven de vraagstelling-textarea: **B** · *I* · `‹›` · H1 · H2 · • · 1. · — · `</>` (code-blok) · 🎨 (kleurpicker 6 kleuren) · 💡⚠️📌❓ (info-kaders) · ⊞ (tabel) · view-toggle.

### 25b — Gekleurde info-kaders
`:::tip`, `:::opgelet`, `:::kader`, `:::hint` syntax. Preprocessing-stap vóór `marked.parse()` zet ze om naar gestylede `<div class="info-kader ...">` blokken. CSS in `styles.css`.

### 25c — Tabel-invoer modal
⊞ knop in toolbar opent modal: rijen + kolommen kiezen, cellen invullen, klik "Invoegen" → Markdown-tabel ingevoegd op cursorpositie.

### 25d — Live split-view editor
Drieknops view-toggle rechts in toolbar: ☐ Tekst · ⊞ Split · 👁 Preview. Voorkeur opgeslagen in `localStorage`. Split-view: textarea links, live preview rechts (100ms debounce). Uitgeschakeld op < 900px (pyAlert bij poging).

### 25e — Leerlingscherm + verbetermodule: uitgebreide rendering
`preprocessMarkdown()` toegevoegd in `quiz-student.html` en `quiz-review.html`. Info-kaders, tabellen en kleurmarkeringen renderen correct bij leerling en bij verbeteren.

### 25h — Live leerkracht-preview (stap 3 in wizard)
Wizard uitgebreid van 3 naar 4 stappen: ① Basisinfo → ② Vragen → ③ Live preview → ④ Bevestigen.
Stap 3 toont exacte leerlingeninterface: vraagnavigator, Markdown rendering, keuze-opties klikbaar, code-blok zichtbaar. "🔀 Andere volgorde" bij random mode. "✅ Ziet er goed uit →" gaat door naar stap 4.

### 25f — Alle browser alert()/confirm() weg (v2026.2.24.1 — eerder geleverd)
Zie changelog v2026.2.24.1.

**Betrokken bestanden:** `app.js` · `styles.css` · `quiz-bank.html` · `quiz-teacher.html` · `quiz-student.html` · `quiz-review.html` · `admin.html` · `quiz-archive.html` · `monitoring.html`

---

## v2026.2.24.0 — Sprint 24: UI/UX ronde 2

### 24a — pyToast + pyConfirm (al in v2026.2.23.4)
Zie v2026.2.23.4 — vervroegd geleverd.

### 24b — Vraagstelling rendeert als Markdown in kaartweergave
Code-snippets in vraagstellingen (backtick-blokken) worden nu gerenderd als opgemaakt code-blok in de vragenbank-kaarten, niet enkel in de Preview. Gebruikt `marked.parse()` + `md-preview` CSS. Kaartinhoud begrensd op max. 140px hoogte met scroll.

### 24c — Single/meerkeuze keuze-opties layout volledig herschreven
`.choice-row` omgezet van flex naar CSS grid (selector | body | remove). `.choice-body` heeft nu `min-width:0` en `width:100%`. Correcte opties krijgen een blauwe rand + "✓ Correct antwoord" label. `</> Naar code` / `</> Naar tekst` toggle staat binnen de kaart.

### 24d — Wisselen single↔meerkeuze herrendert opties correct
`onTypeChange()` roept nu altijd `renderChoices()` aan, ook als er al opties zijn. Radio's wisselen correct naar checkboxes en omgekeerd.

### 24e — "Nieuwe toets" checkboxes gebruiken checkbox-row card-stijl
"Vraagstelling verbergen", "Min. 1 run vereisen" en "Test als leerkracht" gebruiken nu de consistente `checkbox-row` card-stijl i.p.v. losse labels.

### 24f — Sessieoverzicht lopende sessies compacter en overzichtelijker
`renderSessions()` herschreven: sessiekaarten zijn compacter (grid voor meta, code-badge in primary kleur), knoppen op één rij. Gesloten sessies compacter met datum inline.

### 24g — Database viewer in monitoring.html
Twee nieuwe API-endpoints: `GET /api/admin/db/tables` en `GET /api/admin/db/tables/:name/rows`. In monitoring.html: tabelgrid (kleurgecodeerd per categorie), klik opent scrollbare tabelinhoud onder het grid, zoekbalk, paginering (50 rijen). Gevoelige kolommen (password_hash, etc.) worden server-side gemaskeerd. Whitelist van 16 toegestane tabelnamen.

### 24h — admin.html topbar opgeruimd
"← Sessies" en "📊 Monitoring" knoppen verwijderd uit primaire topbar. Topbar gebruikt nu `topbar-inner` wrapper consistent met andere pagina's. "Afmelden" knop toegevoegd.

**Betrokken bestanden:** `quiz-bank.html` · `quiz-teacher.html` · `admin.html` · `monitoring.html` · `teacher-sessions.html` · `app.js` · `server.js` · `.env`

---

## v2026.2.23.4 — Hotfix: leerling toevoegen + in-app modals (24a)

### Bugfix: constraint "idx_students_name_class" does not exist

`ON CONFLICT ON CONSTRAINT` werkt niet op partial indexes in PostgreSQL. `createStudent()` herschreven: controleert eerst via SELECT of naam+klas al bestaat, dan pas INSERT. Geen named constraint meer nodig.

### Sprint 24a (vroeg): pyToast + pyConfirm live

`window.pyToast(message, type, duurMs)` en `window.pyConfirm({ title, body, confirmLabel, danger })` toegevoegd aan `app.js`. Alle `alert()` en `confirm()` in `admin.html` en `quiz-bank.html` vervangen door deze in-app varianten. Styling via geïnjecteerde CSS (modal overlay + toast rechtsonder).

**Betrokken bestanden:** `database.js` · `app.js` · `admin.html` · `quiz-bank.html`

---

## v2026.2.23.3 — Hotfix: geneste template literals + io() crash

### Bugfix: SyntaxError door geneste backtick template literals

`renderQuestions()` gebruikte backtick template literals binnen een outer backtick literal voor de onclick-knoppen. Dit brak de JS parser. Opgelost door over te schakelen naar **event delegation**: knoppen krijgen CSS-klassen (`q-btn-edit`, `q-btn-delete`, etc.), de kaart krijgt `data-qid`, en één `click`-listener op de grid handelt alles af. Apostrofs en backticks in vraagteksten zijn nu volledig irrelevant voor de knoppen.

### Bugfix: `io is not defined` op quiz-bank.html

`app.js` lijn 2 riep `io()` aan op elke pagina, ook op pagina's zonder Socket.IO (quiz-bank, admin, monitoring, ...). Fix: `io()` wordt nu enkel aangeroepen als de pagina in de whitelist zit én als `typeof io !== "undefined"`. Op andere pagina's krijgt `socket` een no-op stub.

**Betrokken bestanden:** `quiz-bank.html` · `app.js`

---

## v2026.2.23.2 — Hotfix: apostrof crasht verwijderknop + CSP fix

### Bugfix: SyntaxError bij vraagtekst met apostrof

`esc()` escapede geen apostrofs waardoor `onclick="verwijderOfArchiveer('...Dit is een zin.'...')"` een SyntaxError gaf. Nieuwe `escAttr()` helper vervangt ook `'` door `&#39;`. Alle `onclick`-attributen op vraagteksten gebruiken nu `escAttr()`.

### Bugfix: CSP blokkeerde marked.js van cdnjs.cloudflare.com

`script-src` uitgebreid met `https://cdnjs.cloudflare.com` zodat de Markdown preview in de vragenbank correct laadt.

**Betrokken bestanden:** `quiz-bank.html` · `server.js`

---

## v2026.2.23.1 — Hotfix: vragenbank verwijderknop

### Bugfix: niet-gearchiveerde vragen konden niet verwijderd worden

**Probleem:** de "Archiveren"-knop werd altijd getoond op actieve vragen, ook als ze nergens aan gekoppeld waren. Er was geen manier om een losse vraag direct te verwijderen zonder haar eerst te archiveren.

**Fix:** de "Archiveren"-knop op niet-gearchiveerde vragen vervangen door een slimme "Verwijderen"-knop (`verwijderOfArchiveer()`):
- Vraag **niet in gebruik** in een toets → direct definitief verwijderd
- Vraag **wel in gebruik** → server geeft melding, gebruiker krijgt keuze om te archiveren

**Flow overzicht:**

| Toestand | Knoppen |
|---|---|
| Actieve vraag, niet in toets | ✏️ Bewerken · 🗑 Verwijderen (definitief) |
| Actieve vraag, in gebruik in toets | ✏️ Bewerken · 🗑 Verwijderen → melding → optie archiveren |
| Gearchiveerde vraag | ↩ Herstellen · 🗑 Definitief verwijderen |

**Betrokken bestanden:** `quiz-bank.html`

---

## v2026.2.23.0 — Sprint 23: Senior tester audit + dark mode verwijderd

### 23q — Dark/light mode volledig verwijderd
- Alle `dark-toggle` knoppen verwijderd uit alle 15 HTML-pagina's
- `initDarkMode()`, `Ctrl+Shift+D` shortcut en `pycodeflow_theme` localStorage uit `app.js` verwijderd
- Alle 24 `[data-theme="dark"]` CSS-blokken verwijderd uit `styles.css`
- Monaco editor gebruikt altijd `pycodeflow-dark` thema (ongewijzigd)
- `styles.css` geherschreven: van 742 → ~380 regels, duplicaten verwijderd (lost 23n op)

### 23a 🔴 — selected_choices niet opgeslagen in DB (dataverlies-bug)
- `quiz_save_answer` handler stuurde `selectedChoices` niet naar `dbModule.saveQuizAnswer()`
- Fix: `selectedChoices: JSON.stringify(data?.selectedChoices || [])` toegevoegd op beide call-sites (tussentijds opslaan + auto-submit)
- Keuze-antwoorden (single/meerkeuze) gaan nu niet meer verloren bij herstart

### 23b — isCode-opties renderen als code-blok
- `quiz-student.html` `renderChoices()`: opties met `isCode:true` tonen als `<pre>` code-blok
- `quiz-review.html` verbetermodule: zelfde fix, keuzes met code correct weergegeven

### 23c — Orphan route verwijderd (was 500-error)
- `GET /teacher-start.html` route verwijderd uit `server.js` — bestand bestond niet op schijf

### 23d — student-app.html versie gecorrigeerd
- `app.js?v2026.2.8.2` (kapotte querystring, 10 sprints achter) → `app.js?v=v2026.2.23.0`

### 23e — quiz-student: open antwoord verbeterd
- `maxlength="2000"` attribuut toegevoegd (limiet werd getoond maar niet afgedwongen)
- `onkeydown="event.stopPropagation()"` toegevoegd (Enter-fix consistent met sprint 22a)

### 23f — admin.html logo fix
- `/favicon.ico` (niet-bestaand bestand) vervangen door `/assets/logo.svg`
- Favicon-tag toegevoegd aan `<head>`

### 23g — Engelstalige placeholders vervangen
- `placeholder="Input unavailable"` → `placeholder="Invoer niet beschikbaar"` in `student-app.html` en `teacher-app.html`

### 23h — CSS/JS versiestrings genormaliseerd
- `monitor1`, `blockfix2`, leeg → allemaal `v2026.2.23.0` over alle 15 HTML-pagina's

### 23i — Subnav toegevoegd aan alle leerkrachtpagina's
- `quiz-bank.html`, `quiz-teacher.html`, `quiz-archive.html`, `admin.html`, `quiz-review.html`, `monitoring.html` krijgen de secundaire navigatiebalk (eerder enkel op `teacher-sessions.html`)
- Actieve pagina gemarkeerd met `class="active"`

### 23j — Favicon-tag op alle pagina's
- 8 pagina's zonder favicon-tag aangevuld: `quiz-*.html`, `teacher-sessions.html`, `teacher-login.html`, `teacher-grid.html`

### 23k — Paginatitels consistent
- Alle titels volgen nu `PyCodeFlow — [naam]` formaat
- `"Leerling"` → `"PyCodeFlow — Leerling"`, `"Leerkracht"` → `"PyCodeFlow — Sessie actief"`, `"Systeembeheer — PyCodeFlow"` → `"PyCodeFlow — Systeembeheer"`, etc.

### 23l — monitoring.html topbar layout fix
- "👤 Gebruikersbeheer" knop stond buiten `topbar-inner` wrapper → verwijderd en verwerkt in subnav (23i)
- Badge "Systeembeheer" toegevoegd aan topbar

### 23m — teacher-sessions.html consistentie
- `<h1>Leerkrachtenplatform</h1>` → `<h1>Sessies</h1>`
- Badge "Sessies" toegevoegd aan topbar
- Overbodige "Sessies" terugknop verwijderd (actieve pagina)

### 23n — styles.css gededupliceerd (samen met 23q opgelost)
- 24 dark-mode blokken verwijderd, overige duplicaten opgeruimd

### 23o — CSRF-beveiliging versterkt
- `admin.html`: 12 muterende `fetch()` calls vervangen door `apiFetch()` met CSRF-token
- `quiz-bank.html`: 5 calls idem
- `apiFetch()` helper geïnjecteerd in beide bestanden (apart van app.js)

### 23p — Retroactieve log-cleanup bij start
- `pycodeflow.sh actie_start()`: verwijdert automatisch logs ouder dan 7 dagen bij elke start

### 23r — Optie 18: Mappenstructuur opschonen

Nieuw menu-item **18 🧹 Mappenstructuur opschonen** in `pycodeflow.sh`:
- Scant de servermap op verouderde/ongebruikte bestanden via een sprint-catalogus
- Toont gevonden items (bestand, grootte, reden, sprint) vóór er iets verwijderd wordt
- Na bevestiging: verwijdert alle gedetecteerde items + rapporteert vrijgemaakte ruimte
- Idempotent: tweede uitvoering toont "Alles al netjes"
- Catalogus wordt bij elke sprint bijgehouden
- `Opschonen-Lokaal.ps1`: PowerShell equivalent voor lokale Windows ontwikkelmap (met extra lokaal-specifieke items: node_modules, monaco, pgdata, IDE-mappen, OS junk)

**Sprint 23 catalogus (eerste versie):**
- `runner/__pycache__/` — Python bytecode cache (sprint 22k)
- `start.bat` / `stop.bat` — Windows scripts, vervangen door pycodeflow.sh
- `web/scripts/migrate-env-to-db.js` — eenmalig (sprint 4, voltooid)
- `web/scripts/migrate-sqlite-to-pg.js` — eenmalig (sprint 12a, voltooid)
- `web/scripts/hash-password.js` — vervangen door manage-teacher.js
- `web/run_wrapper.py` — legacy run wrapper, niet meer gerefereerd
- `data/*.db / .db-shm / .db-wal` — SQLite legacy, vervangen door PostgreSQL
- `logs/` stale bestanden — ouder dan `LOG_RETENTION_DAYS` (sprint 17a/23p)

### Bestanden
`server.js` · `app.js` · `styles.css` · `database.js` · `pycodeflow.sh` · `Opschonen-Lokaal.ps1` · alle 15 HTML-pagina's

### 22a — Enter-toets in Python-code editor
- `onkeydown="event.stopPropagation()"` op alle `<textarea>` elementen in vragenbank en CSV-import

### 22b — Leerlingenoverzicht laadspinner opgelost
- `loadStudents()` in `admin.html` herschreven met `try/catch/finally`: spinner verbergt altijd, zichtbare foutmelding bij API-falen

### 22c — Leerlingen handmatig toevoegen in klasbeheer
- Nieuw inline formulier (Naam + Klas-dropdown + Toevoegen) boven leerlingenlijst in `admin.html`
- `addStudentManual()` POST naar `/api/admin/students`
- `loadClassFilter()` vult zowel de filterdropdown als de nieuwe klas-dropdown

### 22d — Preview toont nu gerenderde Markdown
- `marked.js` geladen vóór inline script
- `toggleMarkdownPreview()` gebruikt `marked.parse()` met `{ breaks: true, gfm: true }`
- Gestyled `.md-preview` blok met CSS voor `code`, `pre`, `strong`, `ul`

### 22e — Single/meerkeuze UI volledig herschreven
- `.choice-row` cards met tekstveld per optie
- `</>` toggle per optie voor code-modus (monospace textarea)
- Radio (single) / checkbox (meerkeuze) correctie-selector
- `_choices[].isCode` state bijgehouden en opgeslagen

### 22f — Vragen verwijderen/archiveren logica
- "Verwijderen" enkel zichtbaar op gearchiveerde vragen (server valideert gebruik)
- "↩ Herstellen" knop op gearchiveerde vragen
- Nieuw `PUT /api/quiz/bank/:id/unarchive` endpoint + `unarchiveQuizQuestion()` in `database.js`

### 22g — Layout "Nieuwe toets" verbeterd
- Consistent card-stijl, badge in topbar, logische volgorde velden

### 22h — Toets bevestigen werkt nu correct
- `createQuiz()`: disabled-guard (verhindert dubbele submit), loading state op knop, `try/catch/finally`, duidelijke foutmeldingen
- confirm-panel toont nu ook schooljaar en klasnaam

### 22i — Paginaheaders nieuwe schermen
- `quiz-teacher.html` en `quiz-review.html`: badge in topbar, consistente `<title>`

### 22j — Leerkrachten-header herstructureerd
- `teacher-sessions.html`: compacte primaire topbar (logo + Afmelden) en sticky secundaire `.subnav` balk

### 22k — Mappenstructuur opgeschoond
- `runner/__pycache__` verwijderd

### Bestanden
`server.js` · `database.js` · `quiz-bank.html` · `quiz-teacher.html` · `quiz-review.html` · `teacher-sessions.html` · `admin.html`

---
## v2026.2.17.0 — Sprint 20: Afwerking

### 19h — Bulk PDF ZIP (aparte PDF per leerling)

Nieuw endpoint `GET /api/quiz/:code/pdf/zip?scored=true/false`:
- Genereert een echte ZIP met per leerling een aparte PDF (`01_Emma_Janssens.pdf`, ...)
- PDF bevat alle vragen + antwoorden per vraagtype (code, open, meerkeuze)
- Meerkeuze: ✅/❌/☑ iconen voor correct/fout/gemist
- Scores en commentaar inbegrepen bij `scored=true`
- Geen externe packages — ZIP gebouwd via handmatige Buffer + CRC32
- `exportAll()` in quiz-review.html uitgebreid: 7 exportopties (waaronder nieuw ZIP)

### 20a — Audit-log leerkrachtenacties

Nieuwe tabel `audit_log` in PostgreSQL:
- Gelogde acties: `score_changed`, `quiz_deleted`, `results_released`
- Per actie: actor (leerkracht), tijdstip, IP, oud/nieuw waarde
- Endpoint: `GET /api/admin/audit-log?limit=50&action=score_changed`
- Zichtbaar in monitoring.html als scrollbare tabel met filteroptie

### 20b — Wachtwoord-reset via pycodeflow.sh

Nieuw menu-item **17 🔑 Wachtwoord leerkracht resetten**:
- Toont bestaande leerkrachten
- Invoer nieuw wachtwoord (met bevestiging)
- Reset via `manage-teacher.js` in de container

### Sprint 21 — Systeembeheer volledig up-to-date

**monitoring.html** uitgebreid met 4 nieuwe secties:

**PostgreSQL sectie:** verbindingsstatus, tabelaantal, leerkrachten/klassen/leerlingen/sessies, quiz statistieken (vragen in bank, toetsen ooit, antwoorden totaal).

**Backup sectie:** laatste backup status, logbestand info, versie + uptime + Node.js versie.

**Audit-log tabel:** filterbaar op actie-type, toont de laatste 25 acties.

**Stresstest historiek:**
- Lijndiagram van laatste 10 tests (kleurgecodeerd: groen/oranje/rood op stressload%)
- Tabel met type, datum, **stressload percentage + label**, runs OK/totaal, gemiddelde tijd, foutenpercentage
- Stressload = gewogen gemiddelde: RAM runner (25%) + CPU runner (20%) + run-tijd vs target (20%) + gefaalde runs (20%) + PG pool (15%)
- Labels: LAAG (0–40%) / NORMAAL (41–70%) / MATIG (71–85%) / HOOG (86–95%) / KRITIEK (>95%)

**server.js:** `berekenStressload()` functie voor gewogen stressload berekening.

### Database
`audit_log` tabel (actor, action, target, detail_json, ip, created_at)
`stress_results` tabel (testtype, stressload%, runs, timing, RAM/CPU)
Methodes: `auditLog()`, `getAuditLog()`, `saveStressResult()`, `getStressResults()`

### pycodeflow.sh
Menu nu 17 opties. Nieuw: optie 17 wachtwoord-reset.

### Bestanden
`server.js` · `database.js` · `pycodeflow.sh` · `monitoring.html` · `quiz-review.html`

---

## v2026.2.16.0 — Sprint 19: Betrouwbaarheid & uitbreidingen

### 19a — Quiz backup 15s + vrije editor localStorage + versie-endpoint
- Quiz tussentijdse backup: antwoorden worden nu bij **elke navigatie** naar DB geschreven
- Vrije editor (`free-editor.html`): code bewaard in `localStorage`, hersteld bij pagina-verversing
- `/api/version` endpoint uitgebreid met `uptime` en `node` versie

### 19b — Schoollogo + schoolinfo
- Nieuw endpoint `/api/school-info` retourneert schoolnaam en logo URL
- Nieuw endpoint `/school-logo` serveert het logo bestand
- PDF export gebruikt `SCHOOL_NAME` uit `.env` als header

### 19d — Quiz reminder voor niet-gestarte leerlingen
- Leerkracht kan leerling een herinnering sturen via `quiz_send_reminder` socket event
- Leerling ziet opvallende rode banner: "⚠️ Start de toets!"

### 19e — Servercrash notificatie
- `health-monitor.sh`: controleert elke 5 minuten of de server bereikbaar is
- Automatische herstart poging bij crash
- Webhook notificatie bij falen (optioneel via `WEBHOOK_URL` in `.env`)
- Installeerbaar via `pycodeflow.sh` → optie 15
- Docker-compose.yml: healthcheck toegevoegd aan web container

### 19f — Markdown rendering in vraagstellingen
- `marked.js` (v9.1.6 via CDN) geladen in alle quiz-pagina's
- Vraagstellingen worden gerenderd als Markdown bij leerling
- Markdown preview in vragenbank (`quiz-bank.html`) via 👁 knop
- Ondersteunt: **vet**, `code`, lijsten, codeblokken

### 19g — Sessie-config persistent na herstart
- `config_json` kolom toegevoegd aan `sessions` tabel
- `persistSession()` slaat editor-configuratie op
- `loadActiveSessions()` herstelt configuratie bij serverstart
- Schakelknoppen (auto-indent, autocomplete, ...) blijven bewaard na herstart

### 19i — Automatische PostgreSQL backup
- `scripts/backup-db.sh`: dagelijkse backup om 02:00 via cron
- 7 dagen bewaren, oudere backups automatisch verwijderd
- Logging van succes/falen in `backups/backup.log`
- Webhook notificatie bij mislukte backup
- `pycodeflow.sh` → optie 16: backup beheren (nu backuppen / cronjob / restore)

### 19j — Tijdsvenster voor toetsen/taken
- `quiz_meta`: kolommen `access_from`, `access_until`, `auto_submit_late` toegevoegd
- Toets aanmaken: datumvelden voor "beschikbaar vanaf" en "deadline"
- Server checkt tijdsvenster bij joinen: te vroeg → foutmelding met openingstijd
- Server checkt tijdsvenster bij joinen: te laat → "TAAK NIET TIJDIG INGELEVERD" scherm
- Deadline interval (elke minuut): auto-submit bij verlopen tijdsvenster
- Leerlingen die bezig zijn bij deadline worden automatisch ingediend
- `docker-compose.yml`: healthcheck op web container

### Database
`sessions.config_json` · `quiz_meta.access_from` · `quiz_meta.access_until` ·
`quiz_meta.auto_submit_late`
Alle via `ALTER TABLE ... IF NOT EXISTS` bij serverstart.

### pycodeflow.sh
Nieuw menu-item 15: Health monitor instellen
Nieuw menu-item 16: Database backup beheren

### Bestanden
`server.js` · `database.js` · `app.js` · `docker-compose.yml` ·
`pycodeflow.sh` · `health-monitor.sh` · `backup-db.sh` ·
`quiz-teacher.html` · `quiz-student.html` · `quiz-bank.html` ·
`quiz-review.html` · `quiz-teacher.html`

---

## v2026.2.15.0 — Sprint 18: Vraagtypen + navigatiefix

### Sprint 18a — Vraagtypen: open + meerkeuze + single choice

**Vragenbank** (`quiz-bank.html`): vier vraagtypen selecteerbaar bij aanmaken:
- 🐍 Python code (bestaand — Monaco editor + run)
- ✏️ Open vraag (vrije tekst, max 2000 tekens)
- ◉ Single choice (radio — één juist antwoord)
- ☑ Meerkeuze (checkbox — meerdere juiste antwoorden)

Antwoordopties beheer: opties toevoegen/verwijderen, juiste aanduiden.
Vraagtype-badge zichtbaar op elke vraagkaart.

**Leerling quizscherm** (`quiz-student.html`): scherm past zich automatisch aan per vraagtype.
Open vraag: textarea met tekenteller. Meerkeuze/single: klikbare opties met visuele feedback.

**Verbetermodule** (`quiz-review.html`): per vraagtype andere weergave.
Meerkeuze/single: kleurgecodeerde weergave (✅ correct gekozen, ❌ fout gekozen, ☑ gemist).

### Sprint 18b — Automatische scoring meerkeuze/single

Bij indiening: server berekent automatisch score voor meerkeuze en single choice.
- Single: volledig punt bij juist antwoord, 0 bij fout
- Meerkeuze: pro-rata (fout antwoord geselecteerd → 0; gedeeltelijk correct → proportioneel)
- Badge 🤖 Auto-gescoord zichtbaar in verbetermodule
- Leerkracht kan score altijd overschrijven

### Navigatiefix

Knop "👤 Beheer" (→ admin.html) toegevoegd aan navigatiebalk in teacher-sessions.html.

### Database
`quiz_bank` + `quiz_question_snapshots`: `question_type`, `choices_json` kolommen.
`quiz_answers`: `selected_choices`, `auto_scored` kolommen.
Automatische `ALTER TABLE IF NOT EXISTS` bij serverstart.

### Bestanden
`server.js` · `database.js` · `quiz-bank.html` · `quiz-student.html` ·
`quiz-review.html` · `teacher-sessions.html`

---

## v2026.2.14.0 — Sprint 17: Log rotatie + Toets-archief

### Sprint 17a — Log rotatie

**Automatische cleanup:** logbestanden ouder dan `LOG_RETENTION_DAYS` dagen (standaard 7) worden automatisch verwijderd. Cleanup bij serverstart én dagelijks om 03:00. Configureerbaar via `.env`.

**Wat NOOIT verwijderd wordt:** quiz_answers, quiz_run_history, code_snapshots, annotaties, PostgreSQL database.

**pycodeflow.sh:** nieuw menu-item "🗑 Logs opruimen" (optie 12) toont schijfgebruik en biedt handmatige cleanup.

**API endpoints:** `GET /api/admin/logs/info`, `POST /api/admin/logs/cleanup`, `POST /api/admin/logs/cleanup-all`

### Sprint 17b — Toets/taak archief

**Toets zonder tijdslimiet:** bij aanmaken van een toets/taak kan de leerkracht "Geen tijdslimiet" kiezen. Leerlingen zien ∞ in de timer. Geschikt voor taken thuis of projecten op eigen tempo.

**Schooljaar + klas koppeling:** bij aanmaken wordt schooljaar (automatisch berekend) en klas meegegeven aan de toets. Zoeken en filteren in het archief op jaar, klas en onderwerp.

**quiz-archive.html:** nieuw beheerscherm met drie tabbladen:
- Overzicht: alle toetsen filterbaar op schooljaar/klas/status, met statistieken per vraag (gemiddelde, %)
- Per leerling: zoek op naam → alle toetsen + scores → PDF rapport
- Nieuw schooljaar: archiveert alle actieve toetsen in één klik

**Archiveren vs verwijderen:**
- Archiveren: zachte verwijdering, data blijft bewaard, deblokkeerbaar
- Definitief verwijderen: vereist typen van toetsnaam als bevestiging, verwijdert antwoorden/scores/commentaren maar NIET de vragen in de bank

**Begin schooljaar reset:** één knop archiveert alle actieve toetsen en stelt nieuw jaar in.

**Statistieken per vraag:** gemiddelde score, percentage, gemiddeld aantal runs per vraag — zichtbaar per toets in het archief.

**Leerlingenrapport:** alle toetsen van één leerling over een schooljaar in één overzicht + PDF.

### Database
`quiz_meta` uitgebreid: `no_timer`, `school_year`, `target_class`, `archived`, `archived_at`.
Kolommen worden via `ALTER TABLE ... IF NOT EXISTS` toegevoegd bij update (geen volledige migratie nodig).

Nieuwe methodes: `archiveQuiz`, `unarchiveQuiz`, `deleteQuizFully`, `getQuizArchive`,
`getStudentHistory`, `getQuizStatsDetailed`, `getAvailableYears`

### Bestanden
`server.js` · `database.js` · `pycodeflow.sh` · `quiz-teacher.html` · `quiz-student.html` ·
`quiz-review.html` · `quiz-archive.html` · `teacher-sessions.html`

---

## v2026.2.13.0 — Sprint 16: Toetsmodule

### Nieuw

**16a — Vragenbank**
Herbruikbare vragen beheren in `quiz-bank.html`. Vragen per onderwerp en moeilijkheidsgraad, met autocomplete. Handmatig aanmaken of CSV bulk-import (`onderwerp,moeilijkheid,max_punten,vraag`). Vragen archiveren (niet verwijderen als al gebruikt in toets).

**16b — Toets aanmaken**
`quiz-teacher.html` met wizard (3 stappen): basisinfo → vragen selecteren → bevestigen. Timer per leerling, random of vaste volgorde, optioneel vraagstelling verbergen op scherm. Leerkracht preview als leerling. Toets dupliceren. Toetsen-tabblad in teacher-sessions.html.

**16c — Leerling quizscherm**
`quiz-student.html` met startscherm (timer start bij klik op START TOETS). Vraagnavigator met kleurcodes (grijs/blauw/groen/oranje). Antwoord opgeslagen bij navigatie én elke 60s naar DB. Offline tolerantie via sessionStorage. Timer met 10% waarschuwing. Auto-submit bij timer = 0. Bevestigingsscherm voor indienen met waarschuwingen per vraag. Dubbele verbinding detecteren. Leerling kan opnieuw starten (leerkracht reset).

**16d — Verbetermodule**
`quiz-review.html`: code per leerling per vraag, uitvoerbaar in sandbox. Run-history tijdlijn. Gelijkenis-detectie (Levenshtein, waarschuwing bij >80%). Score + opmerking per vraag. Algemeen commentaar. Commentaar templates aanmaken en hergebruiken. Resultaten vrijgeven aan leerlingen.

**16e — PDF export (pdfkit)**
- Type 1: Vragenblad (voor op papier, met invulvakken)
- Type 2a: Antwoordformulier zonder scores (nieten aan vragenblad)
- Type 2b: Antwoordformulier met scores + commentaar (teruggeven aan leerling)
- Type 3: Klasoverzicht / scoreblad (voor administratie)
- Export als .txt bestand met alle antwoorden per leerling

**16f — Monitoring**
`/api/quiz/stats` endpoint. Stresstest quiz-type. check-deployment uitbreidbaar.

### Database
Nieuwe tabellen: `quiz_bank`, `quiz_question_snapshots`, `quiz_meta`, `quiz_answers`,
`quiz_general_comments`, `quiz_student_order`, `quiz_run_history`, `quiz_comment_templates`

### Bestanden
`server.js` · `app.js` · `database.js` · `teacher-sessions.html` ·
`quiz-bank.html` · `quiz-teacher.html` · `quiz-student.html` · `quiz-review.html`

**Nieuwe npm dependency:** `pdfkit` — installeer via `npm install pdfkit` in de web map.

---

## v2026.2.12.0 — Sprint 12a-D: Monaco bundelen + CSP versterkt

### Beveiligingsverbetering

**`unsafe-eval` verwijderd uit CSP**
Monaco's AMD-loader vereiste `unsafe-eval` in de Content-Security-Policy omdat het via `eval()` modules laadt. Dit was het laatste beveiligingsgat (7 van de 100 punten).

**Oplossing:**
- Nieuw endpoint `/monaco-env.js` configureert `window.MonacoEnvironment` met `getWorkerUrl()`
- Monaco workers laden nu via blob: URLs in plaats van eval()
- CSP `worker-src` uitgebreid met `blob:` zodat Monaco workers mogen laden
- `unsafe-eval` volledig verwijderd uit `script-src`
- Per-request CSP nonce toegevoegd via `crypto.randomBytes(16)` voor toekomstige inline scripts

**Nieuwe CSP:**
```
script-src 'self' 'unsafe-inline' 'nonce-{per-request-nonce}';
worker-src 'self' blob:;
```

**Beveiligingsscore: 93/100 → 98/100**

De resterende 2 punten: `unsafe-inline` in script-src (vereist voor Socket.IO inline init) en mTLS intern (bewuste architectuurkeuze — geen multiserver).

### Bestanden
`server.js` · `app.js` · `teacher-app.html` · `student-app.html` · `free-editor.html`

---

# PyCodeFlow — Changelog

> Nieuwste versie staat bovenaan.

---

## v2026.2.11.0 — Sprint 13: Klas-dropdown + Sessie-config

### Nieuw

**Sessie-instellingenpaneel (⚙️)**
Leerkracht kan per sessie 5 editor-opties live aan/uitzetten. Wijzigingen worden onmiddellijk gesynchroniseerd naar alle verbonden leerlingen.

| Optie | Klas standaard | Examen standaard |
|---|---|---|
| Auto-indent na `:` | ✅ Aan | ❌ Uit |
| Auto-sluiten haakjes | ✅ Aan | ❌ Uit |
| Auto-sluiten aanhalingstekens | ✅ Aan | ❌ Uit |
| Autocomplete suggesties | ✅ Aan | ❌ Uit |
| Parameter-info tooltip | ✅ Aan | ❌ Uit |
| Fout-regel markering | ✅ Aan | ✅ Altijd aan |

**Klas-dropdown op joinpagina**
Klas-tekstveld op `student-start.html` vervangen door dropdown met klassen uit de database. Vorige keuze hersteld via `localStorage`. Fallback naar vrij tekstveld als geen klassen aangemaakt zijn.

**Toegangslogica bij joinen**
Server zoekt leerling op in `students` tabel bij joinen. Badges zichtbaar bij leerkracht:
- ⚠️ Nieuw — naam niet in klas gekend, aangemaakt als pending
- ⏳ Afwachting — status pending
- 👤 Gast — geen klas geselecteerd
- Geblokkeerde leerlingen worden geweigerd met foutmelding

**Duplicaat-detectie**
Foutmelding als naam al actief is in dezelfde sessie.

**Inline badge beheer**
Leerkracht aanvaardt leerlingen of wijst klas toe direct vanuit de sessie.

### Bestanden
`server.js` · `app.js` · `styles.css` · `teacher-app.html` · `student-start.html`

---

## v2026.2.10.0 — Sprint 12: PostgreSQL + Admin-pagina

### Nieuw

**PostgreSQL migratie**
Database volledig gemigreerd van synchrone SQLite naar async PostgreSQL. `DATABASE_URL` vereist in `.env`. Migratescript beschikbaar via `node scripts/migrate-sqlite-to-pg.js`.

**Admin-pagina `/admin.html`**
Drie tabbladen voor systeembeheer:
- Leerkrachten: toevoegen, wachtwoord resetten, rol wijzigen, verwijderen
- Klassen: aanmaken, archiveren, verwijderen
- Leerlingen: CSV-import, statusbeheer, notities

**CSV-import leerlingen**
Formaat: `naam,klas` per regel. Rapport met toegevoegde / overgeslagen / nieuwe klassen.

### Bestanden
`database.js` · `server.js` · `admin.html` · `monitoring.html` · `migrate-sqlite-to-pg.js`

---

## v2026.2.8.4 — Beveiligingsaudit

### Fixes (19 stuks)

| # | Fix | Impact |
|---|---|---|
| 1 | `Math.random()` → `crypto.randomBytes()` voor sessiecodes | Sessiecodes niet langer voorspelbaar |
| 2 | Runner gebonden aan `127.0.0.1` | Runner niet bereikbaar van buitenaf |
| 3 | HTTP security headers: CSP, X-Frame-Options, HSTS, Referrer-Policy, Permissions-Policy | XSS/clickjacking-bescherming |
| 4 | Socket.IO `maxHttpBufferSize: 64KB` | DoS via grote payloads geblokkeerd |
| 5 | Per-socket CSRF nonce | Sterkere CSRF-bescherming |
| 6 | Cookie `Secure + SameSite=Strict` | Cookie enkel via HTTPS, nooit cross-site |
| 7 | Student naam max 64 tekens | DoS via grote namen geblokkeerd |
| 8 | Annotatie max 500 tekens, line/color validatie | Invoervalidatie |
| 9 | `express.json({ limit: '64kb' })` | Expliciete body limiet |
| 10 | Stresstest achter `STRESS_TEST_ENABLED` flag | Stresstest uitgeschakeld in productie |
| 11 | Rate limiting `student_join`: 10/min per IP | Bruteforce sessiecodes geblokkeerd |
| 12 | Sessiecode 8 tekens (was 6) | 32^8 ≈ 1 biljoen combinaties |
| 13 | Code max 32KB per run | DoS via grote code geblokkeerd |
| 14 | Output max 256KB per run | Geheugen-aanvallen via print-loops geblokkeerd |

**Beveiligingsscore: 54/100 → 93/100**

### Bestanden
`server.js` · `app.py`

---

## v2026.2.9.0 — Sprint 11: Polish & archief

### Nieuw

- **Gutter thema**: regelnummers volgen editor thema (licht/donker) via CSS variabelen
- **Sessie-archief**: toggle "Toon gesloten sessies" in teacher-sessions.html
- **Leerling code-history**: 📜 knop in student-app opent playback modal
- **Wachtrij animatie**: ⏳ pulserende animatie + tijdschatting bij wachtrij
- **Autocheck badge**: groen/rood badge in teacher-sessions toont systeemstatus
- **Docker memory limiet**: runner container beperkt tot 256MB RAM en 1 CPU

### Bestanden
`server.js` · `app.js` · `styles.css` · `database.js` · `teacher-sessions.html` · `student-app.html`

---

## v2026.2.8.0 — Sprint 10: UX verbeteringen

### Nieuw

- Editor thema toggle ☀️/🌙 (onafhankelijk per gebruiker, `localStorage`)
- Gutter, output en statusbalk volgen editor thema
- Auto-indent na `:`, auto-sluiten haakjes en aanhalingstekens
- Fout-regel markering (rode decoratie) bij runtime errors
- Hover over fout-regel toont foutmelding
- Wacht-op-invoer indicator (pulserende blauwe balk)
- Sneltoetsen overlay: `?` of `Ctrl+?`
- Timer voortgangsbalk groen → oranje → rood
- Statusbalk onderaan editor: Ln/Kol, regels, Python, UTF-8
- Kopieer knoppen 📋 op code en output
- Grid overzichtsmodus leerkracht (⊞ Overzicht)
- Statusfilter knoppen: Alle / ✓ Klaar / ✋ Hand / ⚠️ Tab weg
- Annotatie-templates dropdown (7 voorgedefinieerde teksten)
- Live run-status iconen ▶/⌨️/⏳
- Bevestigingsdialoog bij sessie sluiten
- Naam wijzigen via klikbare badge (leerling)
- Verbindingsstatus dot 🟢/🟠/🔴 in topbar
- Auto-scroll output + handmatige scroll-knop
- Toetsenbordnavigatie leerlingenlijst leerkracht (↑/↓/Enter)

### Bestanden
`server.js` · `app.js` · `styles.css` · `teacher-app.html` · `student-app.html` · `free-editor.html`

---

## v2026.2.7.13 — Input-bug definitieve fix

### Fix
Runner weigert nu input als `waiting_for_input = False` (HTTP 409). Server herkent 409 en zet `runId` terug in `runnerWaitingForInput`. Ghost keypresses volledig geblokkeerd.

### Voorgeschiedenis (v2026.2.7.1 t/m .12)
Reeks van 12 bugfix-releases voor het probleem waarbij de tweede `input()` aanroep een lege string ontving. Oorzaak: ghost keypresses via `keydown` events. Definitieve fix zit in de runner zelf.

---

## v2026.2.7.0 — Sprint 9: Technische schuld

### Nieuw
- `apiFetch()` wrapper met automatische CSRF-header
- `session_annotations` tabel in SQLite
- 21 Python-errors met Nederlandse uitleg 💡
- Memory leak `snapshotLastSaved` opgeruimd
- Timer `clearInterval` bij sessie-sluiting

### Bestanden
`server.js` · `app.js` · `database.js` · `app.py`

---

## v2026.2.6.0 — Sprint 8: Code history

### Nieuw
- `code_snapshots` tabel (SQLite)
- History playback modal met tijdlijn en play/pauze
- Observer-rol voor tweede leerkracht

---

## v2026.2.5.0 — Sprint 7: UI & annotaties

### Nieuw
- 9 Python-oefentemplates
- Dark mode interface (`data-theme="dark"`)
- Gestructureerd `run_error` event met regelnummer
- Leerkrachtannotatie met Monaco decoraties (📌)

---

## v2026.2.4.0 — Sprint 6: Beveiliging & stresstest

### Nieuw
- IP rate limiting vrije editor
- `/health` endpoint
- Python subprocess `rlimits` (NOFILE, FSIZE, NPROC)
- Stresstest types: ramp-up, sustained load, memory leak, custom

---

## v2026.2.3.0 — Sprint 5: UX verfijning

### Nieuw
- Aankondigingen als chip-grid
- ✓ Klaar-knop + leerkracht reset
- 💾 Autosave indicator
- 📎 Snippet broadcast naar alle leerlingen

---

## v2026.2.2.0 — Sprint 4: Kwaliteit

### Nieuw
- ✋ Hand opsteken
- Aankondigingsgeschiedenis
- Python syntaxcheck voor run (`ast.parse()`)
- Monitoring historiek + Canvas grafiek
- Reconnect vrije sessie na verbroken verbinding

---

## v2026.2.1.0 — Sprint 3: Examengereedheid

### Nieuw
- Export sessie als `.txt`
- Tab-detectie examenmodus (⚠️ badge bij leerkracht)
- `Ctrl+Enter` sneltoets voor run
- `run_end` feedback bij lege output

---

## v2026.2.0.0 — Sprint 2: Database & login

### Nieuw
- SQLite persistentie via `better-sqlite3`
- Leerkrachtenlogin uit database (niet meer uit `.env`)
- `manage-teacher.js` CLI
- `migrate-env-to-db.js` eenmalig migratescript

---

## v2026.1.35.7 → v2026.1.38.0 — Sprint 1: Basiswerking

### Basis platform
- Real-time code-editor (Monaco Editor + Socket.IO)
- Python runner (Flask + subprocess in Docker)
- Klassessie en examenmodus
- Vrije editor (zonder sessiecode)
- Run rate limiting (3s per socket)
- Logout leerkrachten
- Monitoringpagina met systeemstatus

---

*PyCodeFlow · Atheneum Hoboken*

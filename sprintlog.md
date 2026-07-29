# PyCodeFlow — Sprintlog & Roadmap

> **Structuur van dit document:**
> 1. **Openstaande sprints** — nog te doen, op dalende prioriteit.
> 2. **Uitgestelde sprints** — bewust geparkeerd, op dalende prioriteit.
> 3. **Afgewerkte sprints** — in volgorde van uitvoering (oudste eerst).
>
> Daarna volgen de roadmap (multi-tenant), het domeinmodel, en de gedetailleerde
> beschrijvingen per sprint als naslag.

**Huidige versie: v2026.2.48.12**

> **Nummering-afspraak:** sprintnummers zijn **vast** zodra ze bestaan — ze worden niet meer hernummerd. Komt er tussentijds iets belangrijks bij dat vóór een bestaande sprint moet, dan krijgt het een **decimaal subnummer** (bv. **44.1** schuift tussen 44 en 45). Zo blijft de volgorde leesbaar zonder alles te verschuiven.

---

## 1. Openstaande sprints (op dalende prioriteit)

> ### 🔒 Vastgelegde beslissingen (15/07/2026)
>
> | Beslissing | Gevolg |
> |---|---|
> | **Model B — echte multi-tenant** | Eén leerkracht kan meerdere scholen hebben en kiest bij login. Model A (installatie per school) **vervalt definitief**: dat kan niet met één login over twee scholen. Fase 3 (isolatie + RLS) is daarmee **verplicht**, niet optioneel. |
> | **Leerling-login = school-e-mail + wachtwoord** | Sprints **14 (Google)** en **15 (Smartschool)** vervallen. Het **e-mailadres is de inlognaam**: stabiel en uniek, dus geen gedoe met "eerst voornaam of eerst achternaam". `students.id` blijft de sleutel — een adres mag wijzigen zonder resultaatverlies. |
> | **📧 GEEN e-mail versturen** (16/07) | Geen mailserver, geen relay, geen SMTP. De **leerkracht maakt de klaslijst** en is het **herstelmechanisme**. Het e-mailpakket (49a-c, 52-x1/x2/x3) staat bij *Uitgesteld* — later toevoegen is puur additief. |
> | **Eén startcode per klas** (beslist 16/07) | De leerkracht zet de code op het bord; in de **eerste les** stelt elke leerling **verplicht** een eigen wachtwoord in. Het venster valt daarna **per leerling automatisch dicht** (de code werkt enkel zolang `must_change_password = true`), en de leerkracht kan de code voor de hele klas uitschakelen. *Aanvaard restrisico:* tijdens die eerste les, vóór Marie haar wachtwoord kiest, zou een klasgenoot met haar adres + de klascode kunnen inloggen. Beperkt doordat het onder toezicht in de klas gebeurt en het venster kort is. |
> | **E-maildomein op schoolniveau** | Nooit per klas. Minstens 1 domein per school. Dient nu als **validatie** van de klaslijst (typfouten, verkeerde school) en straks als grendel bij zelfregistratie. |
> | **Templates** | Geen deadline, geen klas/school; enkel de eigenaar past het origineel aan; zichtbaarheid `owner` / `school` / `public`. |
>
> **Zo werkt de leerling-instap zonder e-mail:** leerkracht zet **één klascode** op het bord → elke leerling registreert **zichzelf** met die code + zijn **school-e-mail** (domeincheck) + een eigen wachtwoord → hij mag meteen meedoen aan een **klassessie en vrij oefenen** (de les valt nooit stil), maar **pas na aanvaarding** aan **toetsen en taken** → vergeten? de leerkracht klikt *herstel*. Geen enkele mail nodig, en de leerkracht hoeft geen e-mailadressen te kennen.

> ### ⚠️ Databank-beleid — testfase vs. go-live (vastgelegd 19/07/2026)
>
> **Nu (testfase):** verse installatie bij elke build (`pycodeflow.sh` **optie 13 = reset**, **optie 14 = testdatabase**). De DB is telkens leeg, dus migraties en backfills mogen ervan uitgaan dat er geen bestaande data is.
>
> **Vanaf go-live** (alle sprints af, toets-taak/login/scholen 100% in orde → deploy op een **werkend systeem met echte data**) gelden deze **vaste regels bij élke DB-wijziging**:
> - **Altijd additief + idempotent.** Enkel `ADD COLUMN … DEFAULT` (nooit `NOT NULL` zonder default op een gevulde tabel), `CREATE TABLE/INDEX IF NOT EXISTS`, `DO $$ … duplicate_column`. **Nooit** `DROP`, nooit een kolomtype dat data afkapt, nooit een destructieve `UPDATE`/`DELETE` zonder afgebakende `WHERE`.
> - **Backup eerst.** `backup-db.sh` draaien vóór elke migratie; pas deployen na een geslaagde backup.
> - **Testen op een kopie van productie**, niet enkel op een lege DB — echte data is rommelig (NULLs, dubbels, legacy-rijen).
> - **Backfills defensief.** Guards zoals "enkel bij precies 1 leerkracht" en `ON CONFLICT DO NOTHING` behouden; bij twijfel/ambiguïteit niet gokken maar overslaan.
> - **Unieke indexen kunnen op live data falen** door bestaande dubbels — eerst dubbels opsporen/oplossen. *Concreet na te kijken vóór go-live:* `idx_students_email_unique` op `LOWER(email)` (kan de migratie doen falen als er dubbele/rommelige adressen bestaan).
> - **Reset-/seed-tooling (opties 13/14, sprint 54) mag NOOIT op productie draaien** — harde omgevingsguard toevoegen vóór go-live.
> - **Forward-only.** In productie is "gewoon opnieuw opzetten" geen optie meer; elke wijziging is onomkeerbaar. Wijzigingen die gedrag veranderen voor bestaande data (bv. een default die iets verbergt) worden expliciet afgetoetst vóór deploy.

| Sprint | Prio | Cat | Inhoud | Inschatting |
|---|---|---|---|---|
| **43.13** | 🟡 P5 | BUG | *(opgelost in sprint 65)* **Monaco-worker-warning** *"Could not create web worker(s)"* blijft, ondanks `monaco-env.js` (43.6c). Diagnose was fout. Niet fataal: de editor werkt, maar valt terug op de main-thread (mogelijke UI-freezes bij grote bestanden). Vereist onderzoek in de browser (Network-tab: laadt `/monaco/min/vs/base/worker/workerMain.js`?). Ook de geblokkeerde `purify.min.js.map` (sourcemap) hoort hierbij — onschuldig. | ~0.5 dag |
| **51c** | 🟠 P8 | FEAT | **Fase 2 — Bibliotheek.** Vragen krijgen een `share_scope` (privé/school/publiek, default privé); toetsen/taken worden deelbaar als **sjablonen** (aparte tabel `assignment_templates` + koppeltabel `template_questions`), want een toets/taak is een levende sessie. Bekijker **materialiseert** een sjabloon tot een eigen sessie; enkel de eigenaar bewerkt. *✅ AFGEROND (backend + 📚 Bibliotheek-pagina + nav).* | ~2.5 dag |
| **51d** | 🟠 P8 | AUTH | **Fase 2 — Gewone sessies enkel voor de eigenaar.** Les-/examensessies (géén toetsen/taken, die volgen `/api/quiz-sessions`) zijn in het overzicht enkel zichtbaar voor hun maker — strenger dan 51b: géén admin-alziend-oog en géén null-legacy-uitzondering, anders loopt de lijst vol met sessies van collega's. Pure regel `magSessieZien`. *✅ AFGEROND.* | ~0.5 dag |
| **51e** | 🟠 P8 | AUTH | **Fase 2** — `teacher_classes` echt gebruiken: een leerkracht ziet in het klasoverzicht enkel eigen (gekoppelde) klassen + nog niet-toegewezen klassen; de maker wordt bij aanmaak gekoppeld; admin ziet alle. Pure regel `magKlasZien`. *✅ AFGEROND.* | ~1 dag |
| **52a** | 🟠 P8 | AUTH | **Leerling** — `students`: **`email`** (UNIEK, hoofdletter-ongevoelig, wijzigbaar; overgenomen uit `google_email`) + `pass_hash` + `must_change_password` + **`first_name`** + **`last_name`**. `name` **blijft** de weergavenaam. *✅ AFGEROND (schema + accessors).* | ~0.5 dag |
| **52b** | 🟠 P8 | FEAT | **Leerling** — **Klas-startcode** (`classes.start_code` + `start_code_active`): leerkracht genereert een board-leesbare code (6 tekens, geen 0/1/O/I) en kan het venster sluiten/heropenen. Backend + endpoints, display + open/dicht + ↻ in klasbeheer én in 👥 Mijn klassen. *✅ AFGEROND.* | ~0.5 dag |
| **52c** | 🟠 P8 | FEAT | **Leerling** — **Zelfregistratie**: klascode + voornaam + achternaam + school-e-mail (domeincheck via 48a3) + eigen wachtwoord (2×) → account met **`status = 'pending'`**, gekoppeld aan de klas van de code. *✅ AFGEROND (deel 2).* | ~1.5 dag |
| **52d** | 🟠 P8 | AUTH | **Leerling** — **Login**: e-mail + wachtwoord + sessie (`student_sessions` + `student_sid`-cookie) + rate-limiting + geforceerde wachtwoordwijziging. *✅ AFGEROND (deel 2).* | ~1 dag |
| **52e** | 🔴 P10 | SEC | **Leerling** — **Toegangsregel** (de kern van je ontwerp): `pending` mag **wél** een klassessie en vrij oefenen (les nooit onderbreken), maar **géén toets/taak**. `blocked` mag niets. `quiz_start` controleert nu de status. Pure regel `magLeerlingActiviteit` + tests én afdwinging in `quiz_start`. *✅ AFGEROND.* | ~0.5 dag |
| **52f** | 🟠 P8 | UX | **Leerling** — **Herstel door de leerkracht**: reset-knop zet `must_change_password` → leerling herstelt zelf via klas-startcode + e-mail (`student-recover.html`). Leerkracht bewaart nooit een wachtwoord. *✅ AFGEROND (deel 3).* | ~0.5 dag |
| **52g** | 🟠 P8 | UX | **Leerling** — Na login: de instappagina herkent de ingelogde leerling (naam vooringevuld, status + uitloggen), sessiecode → juiste sessie/toets/taak (bestaande `redirect_to_quiz`), óf **Vrij oefenen**. *✅ AFGEROND (deel 3).* | ~0.5 dag |
| **52h** | 🟠 P8 | UX | **Leerling-beheer aanvullen.** Voornaam/achternaam/e-mail bewerkbaar door de leerkracht + e-mail getoond in de beheerlijst + reset-knop; aanvaarden buiten een live sessie bestond al. *✅ AFGEROND (deel 3).* | ~1 dag |
| **52i** | 🟠 P8 | ARCH | **Toets-deelname op leerling-`id`.** ✅ Een INGELOGDE leerling neemt nu deel onder zijn échte `students.id` (stabiel over een herstart heen + robuust bij dubbele namen); 43.4-selectie is voor accounts id-gebaseerd. Eén centrale resolver `bepaalToetsDeelnameId`; gasten houden een sessie-id maar hervatten ondubbelzinnig op naam. *✅ AFGEROND (deel 4).* | ~1 dag |
| **53d** | 🟡 P6 | SEC | **Templates** — Admin-knop **"openbaar → verbergen"** (takedown): een `hidden`-vlag op vraag/sjabloon, los van de scope van de eigenaar; verborgen items verdwijnen uit de Bibliotheek voor iedereen behalve eigenaar + admin. Pure regel `magBibliotheekModereren`. *✅ AFGEROND.* | ~0.5 dag |
| **48c1** | 🔵 P9 | ARCH | **Fase 3** — `school_id` (NULLbaar, `ON DELETE SET NULL`) op `classes`, `students`, `question_bank`, `sessions`, `audit_log` + indexen + migratie (single-school install → alles aan die ene school; leerkrachten via `teacher_schools`, geen redundante kolom). Diagnose-endpoint `/api/admin/fase3/dekking`. Enkel schema + migratie; afdwinging = 48c2. *✅ AFGEROND.* | ~2 dagen |
| **48c2** | 🔵 P9 | SEC | **Fase 3** — Filtering centraal afdwingen (applicatielaag; RLS later als extra verdediging). **Deel a (schrijven) ✅**: nieuwe rij krijgt `school_id` uit de actieve school; leerling erft de school van zijn klas. **Deel b (lezen) ✅**: één regel `magRijVanSchoolZien` (SQL-spiegel identiek) op klassen-, leerlingen-, vragenbank-, sessie- en auditloglijsten; Bibliotheek blijft de enige cross-school-uitzondering (publiek/school, 51c). *✅ AFGEROND.* | ~1 week |
| **48c3** | 🔵 P9 | SEC | **Fase 3** — **Isolatie-testsuite** (`tests/isolatie.test.js`): integratietests tegen een échte PostgreSQL — klassen, leerlingen (erven school van klas), vragenbank, sessies, auditlog: A ziet **nul** rijen van B; Bibliotheek-publiek kruist als enige (en 53d-hidden wint); dekking-diagnose. Skipt zichzelf zonder `DATABASE_URL`. **Al bewezen groen (7/7, herhaald) tegen PostgreSQL 16.** *✅ AFGEROND.* | ~3 dagen |
| **48c4** | 🔵 P9 | ARCH | **Fase 3** — **Super-admin** (rol `superadmin`, hosting-beheerder): leesscope zónder schoolfilter (ziet alle scholen), telt overal als beheerder, mag cross-school Bibliotheek-takedown; rol enkel toe te kennen door een super-admin (admin-bootstrap zolang er geen bestaat); rol-cyclus in de admin-UI. *✅ AFGEROND — daarmee is Fase 3 compleet.* | ~2 dagen |
| **61** | 🟢 P3 | FEAT | **Facturatierapport** — per schooljaar/maand per school tellen hoeveel leerlingen geregistreerd zijn en hoe lang (actief/pending/geblokkeerd), als basis voor een fee per leerling. Automatisch maandelijks document (CSV/PDF) voor de platformbeheerder. Vereist een lichte historiek (bv. `student_school_periods` of tellingen-snapshot), want `students` bewaart nu enkel de huidige status. *✅ AFGEROND.* | ~2 dagen |
| **65** | 🔴 P10 | BUG | **(a) Startfout in v2026.2.49.5** — de logo-endpoints van sprint 64 belandden vóór `const app = express()`: de server startte niet op. Verplaatst + een test die dit voortaan vangt. **(b) 43.13 opgelost** — er bestond een tweede, verouderde `/monaco-env.js` als serverroute die vóór `express.static` geregistreerd stond en dus won van de fix uit 43.6c; ze gaf worker-paden op die in de min-build niet bestaan → 404 → *"Could not create web worker(s)"*. Route verwijderd. *✅ AFGEROND.* | ~0.5 dag |
| **64** | 🟠 P8 | ARCH | **Schoollogo in de databank** — was een absoluut **bestandspad** dat je moest intypen (viel buiten de back-up, verdween bij een rebuild, en een schooladmin kon er niets mee). Nu een echte upload: bestand kiezen op je eigen computer → `BYTEA` in `schools`. PNG/JPEG/WebP toegelaten, **SVG geweigerd** (kan scripts bevatten), grootte instelbaar via `SCHOOL_LOGO_MAX_KB` in `.env`, controle op **magic bytes** i.p.v. extensie. Serveren met ETag/caching; `logo_path` blijft als terugval. *✅ AFGEROND.* | ~1 dag |
| **63** | 🟡 P6 | BUG | **Twee testbevindingen** — (1) startpagina toonde de voettekst **dubbel**: `index.html` heeft een eigen `<footer>` met server-side versie, maar de guard in `app.js` keek enkel naar `.footer-note`; (2) een school **inklappen** verborg wel de klaskoppen maar niet de leerlingrijen, want die horen tot twee groepen (school én klas). *✅ AFGEROND.* | ~0.25 dag |
| **62** | 🟠 P8 | UX | **Topbalk: wie ben ik?** — de balk toonde enkel 'Afmelden', maar wél een schoolnaam; daardoor leek die naam een klas-/schoolkoppeling te bevestigen. Nu: 'Ingelogd als <naam>' + rolbadge + de **actieve school** (met wisselmodal bij meerdere scholen). 'Mijn klassen' legt in de lege staat uit dat school ≠ klas. *✅ AFGEROND.* | ~0.5 dag |
| **60** | 🟠 P8 | UX | **Beheer overzichtelijk + Scholen-tab per rol** — admin beheert de gegevens van zijn EIGEN scholen (naam, logo, contact, e-maildomeinen); aanmaken/verwijderen/deactiveren/licentie blijven platformwerk. Inklapbare groepen per school (en per klas bij leerlingen) met bewaarde stand, tellers + 'x wachtend', klasfilter, 'enkel wachtend', 🔀 klas wisselen en bulkacties (aanvaarden/blokkeren/verplaatsen). *✅ AFGEROND.* | ~1.5 dag |
| **59** | 🔴 P10 | SEC | **Beheer-lekken gedicht** — `PUT /teachers/:username/password` had **géén** rolcontrole (elke ingelogde leerkracht kon eender wiens wachtwoord overschrijven, ook dat van de super-admin); idem grendel op verwijderen. Super-admin verdwijnt uit de lijst van een schooladmin. Wachtwoord wijzigen gaat nu via een PyCodeFlow-modal met bevestigingsveld i.p.v. een kale browser-prompt. *✅ AFGEROND.* | ~0.5 dag |
| **58** | 🟠 P8 | SEC/UX | **Schoolbranding lekte naar leerlingpagina's** — `/api/school-info` las de leerkracht-cookie, dus op een gedeelde computer zag een leerling de school van de leerkracht die daar eerder inlogde. Nieuwe `?rol=leerling`-modus kijkt enkel naar de leerling-sessie (eigen school ná login), anders install-brede .env-naam. *✅ AFGEROND.* | ~0.5 dag |
| **57** | 🟠 P8 | UX/SEC | **Klas ↔ leerkracht koppelen (UI)** — de endpoints bestonden sinds 48 maar werden door géén enkel scherm aangeroepen, waardoor een klas nooit bij een collega raakte. Beheer → Klassen toont nu een kolom **Leerkrachten** (of '⚠ niemand gekoppeld') met een 🧑‍🏫-modal om te koppelen/ontkoppelen. Server-side gescoped: een admin koppelt enkel leerkrachten van zijn eigen scholen aan klassen van zijn eigen scholen (anders 403); beide acties in het audit-log. *✅ AFGEROND.* | ~0.5 dag |
| **56** | 🟠 P8 | UX/SEC | **"Mijn klassen"** — eigen scherm voor élke leerkracht met zijn gekoppelde klassen: startcode (bord-formaat, open/dicht, ↻), wachtende leerlingen bovenaan met ✓ aanvaarden, blokkeren/deblokkeren, 🔑 reset en leerling toevoegen. Leerlingacties nu klas-gescoped (`magLeerlingBeheren`): leerkracht enkel eigen klasleerlingen, beheerder school-breed. Herstelt de klastoegang die sprint 55 achter Beheer zette. *✅ AFGEROND.* | ~1 dag |
| **55** | 🟠 P8 | SEC/UX | **Beheer-RBAC + groepering + zoek** — Beheer enkel admin/super-admin (admin gescoped op zíjn scholen), Systeem enkel super-admin; nav-links per rol verborgen (`nav-rechten.js`) én server-side afgedwongen (`requireBeheer`/`requireSysteem` op pagina's + API's). Leerkrachten/klassen/leerlingen gegroepeerd per school (leerlingen per school→klas) met zoekvelden per tab. Rollen: super-admin alles; admin enkel teacher↔admin binnen gedeelde school (bootstrap geschrapt → eerste super-admin via CLI). Pure regels `magBeheerZien`/`magSysteemZien`/`magRolToekennen`. *✅ AFGEROND.* | ~1.5 dag |
| **54** | 🟢 P4 | DX | **Testdatabase-seeder** — `web/scripts/seed-testdb.js` (seed/wipe/status, idempotent, alles TESTDATA-gemarkeerd, wachtwoord = gebruikersnaam) + menu-optie **21** in `pycodeflow.sh` (met SEED/WIS-bevestiging, nooit op prod). 2 scholen · 4 leerkrachten (incl. superadmin) · 3 klassen met actieve startcodes · 6 leerlingen (actief/pending/geblokkeerd/zonder account) · vragenbank privé/school/publiek + 1 hidden · 3 sjablonen · les + toets + taak · ingevulde antwoorden/scores. **Bewezen tegen echte PostgreSQL: seed→status→seed (idempotent)→wipe→her-seed + isolatie-spot-check.** *✅ AFGEROND.* | ~1.5 dag |

> **Sprint 42 is gesplitst:** Deel C (branding/schoollogo) is afgerond in v2026.2.42.0 (zie afgewerkte sprints); het restant (startpagina + leerling/leerkracht-ingang) leeft nu als **sprint 45**.

---

## 2. Uitgestelde sprints (bewust geparkeerd, op dalende prioriteit)

> ### 📧 E-mailpakket — geparkeerd (beslist 16/07/2026)
>
> **Beslissing:** PyCodeFlow verstuurt **geen e-mail**. Geen mailserver, geen relay, geen SMTP.
>
> **Waarom dit kan:** het e-mailadres is de **inlognaam** (stabiel en uniek — geen gedoe met voornaam/achternaam-volgorde), maar er hoeft niets *naartoe* gestuurd te worden. De leerkracht maakt de klaslijst, deelt startcodes uit en is zelf het herstelmechanisme. Dat is hoe schoolsystemen sowieso werken, en het is sneller dan een mailtje afwachten.
>
> **Wat dit bespaart:** mailserver of VPS (~€60/jaar), DNS/SPF/DKIM/DMARC, deliverability-gevecht met schoolfilters, spamlijsten, en ~1-2 uur onderhoud per maand. Plus de kalendertijd voor IP-reputatie die anders sprint 52 zou blokkeren.
>
> **Waarom je tóch voorbereid bent:** door nu al met e-mailadres + domeincheck te werken, is de stap naar zelfregistratie en herstel-per-mail later **puur additief** — geen migratie van inlognamen, geen herbouw. De app blijft **SMTP-agnostisch**: enkel host/poort/gebruiker/wachtwoord uit `.env`, nergens iets provider-specifieks in de code.

| Sprint | Cat | Inhoud | Reden van uitstel | Inschatting |
|---|---|---|---|---|
| **49a** | INFRA | Mail versturen: nodemailer + SMTP-config in `.env` + `sendMail()`-helper + admin-knop "stuur testmail" | E-mailpakket geparkeerd — de leerkracht is het herstelmechanisme | ~0.5 dag |
| **49b** | OPS | Deliverability: afzenderdomein + SPF/DKIM/DMARC. **Vereist eerst een keuze:** relay (Brevo/Mailjet, EU) óf eigen mailserver op een **VPS** (~€60/jaar). Op de NAS kan het niet: Tailscale/Cloudflare Tunnel dragen geen SMTP, en een thuis-IP staat op de Spamhaus PBL zonder instelbare PTR | Idem | ~0.5 dag + kalendertijd |
| **49c** | INFRA | Mail-wachtrij met retry + logging | Idem | ~1 dag |
| **52-x1** | SEC | **E-mailverificatie** bij registratie (link/code). **Voorwaarde** om zelfregistratie veilig te maken | Vereist 49a | ~1 dag |
| **52-x2** | FEAT | **Zelfregistratie via klascode** (naam + e-mail + klascode + eigen wachtwoord) + vlag "open voor registratie" per klas | ⛔ Onveilig zonder 52-x1: een klasgenoot kent de klascode en schooladressen zijn voorspelbaar — zonder verificatie registreert hij zich als iemand anders | ~1.5 dag |
| **52-x3** | SEC | **Wachtwoordherstel per e-mail**: code ±20 min geldig, eenmalig, altijd dezelfde melding (tegen account-enumeratie) | Vereist 49a; herstel gebeurt nu door de leerkracht (52f) | ~1 dag |
| **35b** | A11Y | Statusinformatie niet enkel via kleur (klaar/hand/tab-weg) — voor kleurenblinden | Toegankelijkheid pas wettelijk vereist bij verkoop aan overheidsscholen — bewust geparkeerd | ~1 dag |
| **35a** | A11Y | Aria-labels/roles toevoegen (vrijwel geen nu) — screenreaders bruikbaar maken | Idem — toegankelijkheidspakket samen geparkeerd | ~2 dagen |
| **35c** | A11Y | Toetsenbordnavigatie: focus-volgorde, focus-trap, skip-links | Idem — toegankelijkheidspakket samen geparkeerd | ~1.5 dag |
| **35d** | A11Y | Modals (pyAlert/pyConfirm): `role="dialog"` + `aria-modal` + focus-return | Idem — toegankelijkheidspakket samen geparkeerd | ~0.5 dag |
| **30b-vol** | SEC | CSP `unsafe-inline` VOLLEDIG weg (Optie C): 123 inline handlers → addEventListener, 384 inline `style=` → CSS, dan enforce + Report-Only weg | Grote, risicovolle migratie (~8-10 dagen); Report-Only CSP uit 30b-A dekt de acute nood al | ~8-10 dagen |

> **Toegankelijkheid (P6) wordt een wettelijke vereiste** (EN 301 549 / WCAG 2.1 AA) zodra je aan overheidsscholen verkoopt. Nu geparkeerd, maar niet vrijblijvend op termijn — 35a-d horen samen als één toegankelijkheidspakket weer geactiveerd te worden.

> **Leerling-authenticatie — BESLIST (15/07/2026).** Het wordt een **eigen login op e-mail + wachtwoord** (sprint 52). Daarmee **vervallen sprint 14 (Google OAuth) en 15 (Smartschool SSO)** — ze zijn uit de uitgestelde lijst gehaald. Google kan later nog als *extra* inlogmethode op hetzelfde account, maar is geen voorwaarde meer. Deze keuze raakt sprint 37 (nakijk-modus): zolang er geen echte login is, steunt de nakijk-toegang op naam+klas+code — een bewust aanvaarde beperking, afgeschermd door rate-limiting en doordat de leerkracht de nakijk-modus expliciet moet openstellen.

---

## 3. Afgewerkte sprints (in volgorde van uitvoering)

Oudste eerst. Versienummer = de versie waarin de sprint werd afgerond.

| # | Sprint | Inhoud | Versie |
|---|---|---|---|
| 1 | **1-11** | Basiswerking → PostgreSQL-migratie (fundament: editor, runner, login, sessies, annotaties, history, archief) | tot v2026.2.9.0 |
| 2 | **12-13** | PostgreSQL + admin-pagina + klas-dropdown + sessie-config | v2026.2.11.0 |
| 3 | **12a-D** | Monaco bundelen + CSP versterkt | v2026.2.12.0 |
| 4 | **16** | Toetsmodule | v2026.2.13.0 |
| 5 | **17** | Log-rotatie + toets-archief | v2026.2.14.0 |
| 6 | **18** | Vraagtypen (open/meerkeuze/single) + auto-scoring | v2026.2.15.0 |
| 7 | **19** | Betrouwbaarheid & uitbreidingen (quiz-backup, logo, notificaties, Markdown) | v2026.2.16.0 |
| 8 | **20** | Afwerking | v2026.2.17.0 |
| 9 | **22** | Bugfix & UX ronde | v2026.2.22.0 |
| 10 | **23** | Senior tester audit + dark mode verwijderd | v2026.2.23.0 |
| 11 | **24** | UI/UX ronde 2 + in-app modals | v2026.2.24.0 |
| 12 | **25** | Rijke vraagstelling-editor | v2026.2.25.0 |
| 13 | **26** | Bugfixes + check-deployment bijgewerkt | v2026.2.26.0 |
| 14 | **27** | Bugfixes + tooltips + DB-beheer | v2026.2.27.0 |
| 15 | **28** | DOMPurify + subnav + structuurfix | v2026.2.28.0 |
| 16 | **29 + 29_part2** | Kritieke bugs + versie-automatisering + vervolgbugs | v2026.2.29.1 |
| 17 | **34** | Geautomatiseerd testen + CI (testbasis) | v2026.2.34.0 |
| 18 | **30-copy** | Contextuele kopieerknop | v2026.2.34.3 |
| 19 | **30-cfg** | Sessie-instellingen live toepassen ("Toepassen"-knop) | v2026.2.34.x |
| 20 | **30 (a/c/d)** | Security hardening (cookie Max-Age, upgrade-insecure, DB-backup-script) | v2026.2.34.4 |
| 21 | **36** | Data-integriteit (transacties, validatie, debounce, deps pinnen) | v2026.2.34.5 |
| 22 | **31** | UX & consistentie (localStorage-prefix, spinners, uniforme fouten) | v2026.2.34.6 |
| 23 | **32** | Technische schuld (logger, scripts extraheren, Monaco pinnen) | v2026.2.34.7 |
| 24 | **30b-A** | CSP-hardening tijdelijk (Optie A): Report-Only CSP | v2026.2.34.8 |
| 25 | **33** | Nice-to-haves (toets dupliceren, tags, CSV-export, voortgangsgrafiek) | v2026.2.34.9 |
| 26 | **37d** | Nakijk-modus + toegangscontrole (leerling-inzage fundament) | v2026.2.37.0 |
| 27 | **37a** | Leerling-nakijkscherm (score + eigen antwoorden) | v2026.2.37.1 |
| 28 | **37b** | Juiste antwoorden + modelcode tonen | v2026.2.37.2 |
| 29 | **37c** | Commentaar per vraag + algemeen commentaar zichtbaar | v2026.2.37.3 |
| 30 | **38** | Vraag dupliceren in het vragenoverzicht | v2026.2.38.0 |
| 31 | **40** | `class_memberships`: leerling-lidmaatschap per schooljaar (vers schema) | v2026.2.40.0 |
| 32 | **41** | Schooljaar-selector + read-only gearchiveerde jaren | v2026.2.41.0 |
| 33 | **hotfix** | Opstart-crash (TDZ: `log` gebruikt vóór init in `loadVersionFromFile`) | v2026.2.41.1 |
| 34 | **42 (deel C)** | Branding: eigen PyCodeFlow-logo in app-balk + landingspagina, footer opgeschoond (school-verwijzing weg) — deel A+B verplaatst naar sprint 45 | v2026.2.42.0 |
| 35 | **43** | Toetsen/taken scheiden van sessies + live-overzicht (filter uit sessielijst, leerling-redirect naar toets-flow, toets/taak-label, online-teller + open/gesloten-status + teacher-grid-link) | v2026.2.43.0 |
| 36 | **43.1** | Voortgang per gekoppelde klas-leerling bij een toets/taak (groen=ingeleverd, geel=bezig, grijs=niets) via de Voortgang-knop | v2026.2.43.1 |
| 37 | **44** | Bug fix: dupliceren maakte meerdere kopieën — click-listener op #q-grid werd bij elke re-render gestapeld; nu exact één keer gebonden | v2026.2.44.0 |
| 38 | **45** | Instapstructuur Deel A+B: app serveert startpagina op `/` met server-side versie-injectie (`{{APP_VERSION}}`) + nette routes `/student` en `/teacher` | v2026.2.45.0 |
| 39 | **46** | Leerkracht-preview & toets-launch: keuze-opties in preview renderen correct (geen overflow/afgesneden tekst) + startscherm hangt niet meer stil (inline foutmelding + time-out) | v2026.2.46.0 |
| 40 | **47** | Vraag-editor & vraagweergave: kader→"Extra informatie", Tip/Hint-doel verduidelijkt, Python-codeblok als donker code-veld, juist-antwoord groen in editor | v2026.2.47.0 |
| 41 | **47.1** | Follow-ups van 47: echte Python syntax highlighting (zelf-gehost, CSP-veilig) + Tip/Hint samengevoegd tot één kader | v2026.2.47.1 |
| 42 | **47.2** | Testbevinding: opstart-crash na herinstall gediagnosticeerd (auth-guard) + fs-TDZ in versie-loader gefixt | v2026.2.47.2 |
| 43 | **47.3** | Deadlock-fix: `pycodeflow.sh` maakt leerkracht nu aan via wegwerp-container (`docker compose run`) i.p.v. `docker exec` in de down-zijnde web-container | v2026.2.47.3 |
| 44 | **47.4** | Testbevinding: admin-quizstatistieken stonden op 0 (niet-geëxporteerde `dbModule.pool`) + toets onzichtbaar in Toetsen-tab (lijst nu uit `quiz_meta`) + admin-sessietype herkent toets/taak | v2026.2.47.4 |
| 45 | **43.2** | Toetsen-/takenbank: overzicht van álle toetsen/taken (incl. previews) met filters (klas/type/status/jaar) + verwijderen — lost de zwevende toets op | v2026.2.47.5 |
| 46 | **43.2b** | Bank vindbaar via nav-link "📚 Toetsen & taken" + status-groepen (Actief/Preview/Afgerond) + preview activeren + dupliceer-naam via scherm-modal (pyPrompt) | v2026.2.47.6 |
| 47 | **43.6** | Bugfix: leerlingen konden niet inloggen op de clean `/student`-route — `'student'` ontbrak in `_socketPages`, dus de socket was een no-op stub (knoppen deden niets) | v2026.2.47.7 |
| 48 | **43.6b** | Sessie-overzicht: aparte tabs **Sessies / Toetsen / Taken**, elk enkel actieve items (geen previews); volledige bank blijft via nav bereikbaar | v2026.2.47.7 |
| 49 | **43.6c** | `public/monaco-env.js` hersteld (werd door 5 pagina's ingeladen maar ontbrak). ⚠️ **Loste de worker-warning NIET op** — zie openstaand punt 43.13 | v2026.2.47.8 |
| 50 | **43.5** | Tabellen hernoemd: `quiz_bank` → `question_bank`, `quiz_meta` → `assignment_bank` (data-behoudende migratie + alle queries + DB-viewer) | v2026.2.47.9 |
| 51 | **43.7** | Nav: "Nieuwe toets" weg; **Toets overzicht** + **Taak overzicht** erbij (bank per type via `?tab=quizzes&type=`) | v2026.2.47.9 |
| 52 | **43.7b** | Herbouw: **echte aparte pagina's** `toets-overzicht.html` + `taak-overzicht.html` (kaartenraster zoals de vragenbank) i.p.v. de sessie-tab; inline-notes uit sessiescherm weg | v2026.2.47.10 |
| 53 | **43.8** | Dupliceren: enkel meta kopiëren + vragen koppelen via bestaande bank-id's (geen nieuwe vraagrecords); tijdsvenster/deadline kopieert nu mee | v2026.2.47.10 |
| 54 | **43.3** | Expliciet `type`-veld (toets/taak) op `assignment_bank` + **deadline verplicht** voor béide (server + client) | v2026.2.47.10 |
| 55 | **43.4** | Leerling-selectie per toets/taak: tabel `assignment_students`, popup met checkboxes (standaard alles aan, alles aan/uit, opslaan/annuleren) + afdwingen bij start | v2026.2.47.10 |
| 56 | **43.9** | Preview later doorlopen: knop **🧑‍🎓 Doorlopen** op preview-kaarten + bugfix: previews vrijgesteld van de leerling-selectie-check (uit 43.4) | v2026.2.47.11 |
| 57 | **43.10** | **Toets-pagina's stuk**: UMD-libs laadden ná Monaco's AMD-loader → `io is not defined`. Scriptvolgorde hersteld op quiz-student + quiz-review | v2026.2.47.12 |
| 58 | **43.11** | Knoppen in de toets deden niets: `editorStore is not defined` (interne const van app.js). Nu via `window.getEditorValue`/`setEditorValue`. Zelfde bug in het nakijkscherm mee gefixt | v2026.2.47.13 |
| 59 | **43.12** | Toets-layout: code en output in **tabs** (Code | Output), exact zoals de klassessie en vrij oefenen | v2026.2.47.14 |
| 60 | **50a** | **Fase 1 start** — tabel `teacher_sessions` + echte sessie per leerkracht bij login (naast het oude cookie, breekt niets). Token enkel als SHA-256 in de databank | v2026.2.48.0 |
| 61 | **50b** | **Fase 1** — `requireTeacherAuth` vult `req.teacher` uit de sessie (101 endpoints in één keer). Beslisregel als pure functie + `/api/me` om te zien wie je bent | v2026.2.48.1 |
| 62 | **50c** | **Fase 1** — Afmelden trekt de sessie nu écht in (was onmogelijk: het oude cookie is een vaste waarde). Ook: wachtwoord wijzigen beëindigt lopende sessies | v2026.2.48.2 |
| 63 | **50d** | **Fase 1** — Sessie schuift mee zolang je werkt (nooit buitenvliegen in een les) + harde grens van 24u zodat een sessie niet eeuwig leeft | v2026.2.48.3 |
| 64 | **50e** | **Fase 1** — Audit-log noteert eindelijk wie het déed (zei altijd 'onbekend': het las een header die bij cookie-login nooit meekomt) | v2026.2.48.4 |
| 65 | **50f** | **🎉 FASE 1 AF** — het gedeelde cookie is weg. Sockets krijgen identiteit via `io.use`; `.env`-login vervalt (bootstrap blijft); `checkAuthConfig` eist een echte leerkracht | v2026.2.48.4 |
| 66 | **48a1** | **Scholen** — tabel `schools` + beheer (aanmaken/bewerken/deactiveren/verwijderen). Puur additief: eerste steen van het multi-tenant fundament | v2026.2.48.5 |
| 67 | **48a2** | **Leerkracht ↔ school** — koppeltabel `teacher_schools` (veel-op-veel) + vinkjes-popup in het leerkrachtenbeheer. Voedt straks het schoolkeuze-scherm | v2026.2.48.6 |
| 68 | **48a3** | **E-maildomeinen** — `school_domains` + de regels (`athkiel.be` exact vs `*.athkiel.be` subdomeinen), uitleg en **testveldje** in het beheer. 21 unittests | v2026.2.48.7 |
| 69 | **48b1** | **Actieve school** — `active_school_id` server-side in de sessie; bij precies 1 school automatisch gekozen. Zichtbaar via `/api/me` | v2026.2.48.8 |
| 70 | **48b2** | **Schoolkeuze-scherm** — grid met dropdown bij >1 school, logingegevens grijs, knoppen Annuleren/Kiezen. Lijst verschijnt pas ná een geslaagde login | v2026.2.48.9 |
| 71 | **48b3** | **🎉 BLOK 2 AF** — schoollogo naast het PyCodeFlow-merk, volgt de actieve school. Niet op start-/loginscherm. Padcontrole op het logo-bestand | v2026.2.48.10 |
| 72 | **43.14** | **"+ Nieuwe taak" maakte een toets**: type komt nu uit de link (`?type=`), staat al vast bij het openen en is niet meer af te leiden uit de timerkeuze. Titel/kop/veldnamen/knoppen/meldingen bewegen mee met het type; ontbreekt het (rechtstreekse link) dan vraagt een kort keuzescherm het éénmalig op. Bevestigd: een taak MAG een tijdslimiet hebben (niet verplicht) — timer en type staan voortaan los van elkaar | v2026.2.48.11 |
| 73 | **51a** | **Fase 2 start** — kolom `teacher_id` op `sessions` (eigenaar), gevuld bij elke nieuwe sessie (REST én socket) via `bepaalSessieEigenaar`. Backfill: bij precies 1 leerkrachtaccount krijgen bestaande sessies die eigenaar, anders blijft het bewust onbekend (`NULL`) — er was voordien nergens geregistreerd wie een sessie aanmaakte | v2026.2.48.11 |
| 74 | **51b** | **Fase 2 autorisatie** — een leerkracht beheert/ziet enkel **eigen** sessies, een admin alle. Pure regel `magSessieBeheren`; REST-middleware `requireSessionAccess` op alle 31 `:code`-endpoints (openen/sluiten/verwijderen/inzien → **403** voor andermans sessie); socketguards op openen/waarnemen/grid + dubbele grendel op sluiten/verwijderen; `/api/sessions` en `/api/quiz-sessions` tonen enkel eigen sessies | v2026.2.48.12 |
| 75 | **51c** | **Bibliotheek** — vragen krijgen `share_scope` (privé/school/publiek); toetsen/taken worden deelbaar als **sjabloon** via nieuwe tabellen `assignment_templates` + `template_questions`. Nieuwe pagina 📚 Bibliotheek; materialiseren maakt een eigen sessie. Drie integriteitsregels (vraag ≥ zichtbaar als sjabloon; scope niet verbreden/verkleinen bij koppeling) | v2026.2.49.0 |
| 76 | **51d-51e** | **Fase 2 af** — gewone sessies enkel voor de maker (`magSessieZien`); `teacher_classes` echt gebruikt: leerkracht ziet eigen + niet-toegewezen klassen, maker wordt automatisch gekoppeld (`magKlasZien`) | v2026.2.49.0 |
| 77 | **52a-52i** | **Leerling-accounts** — e-mail+wachtwoord op `students`, klas-startcodes, zelfregistratie (pending), login met aparte sessie, toegangsregel (`pending` = wel les/oefenen, geen toets/taak), herstel via klascode, login-bewuste instap, leerlingbeheer, en toets-deelname op de échte `students.id` | v2026.2.49.0 |
| 78 | **53d** | **Admin-takedown** — `hidden`-vlag op vraag/sjabloon, los van de scope van de eigenaar; verborgen items verdwijnen uit de Bibliotheek behalve voor eigenaar + admin | v2026.2.49.0 |
| 79 | **48c1-48c4** | **🎉 FASE 3 AF** — `school_id` op alle kerntabellen + migratie; scoping op schrijven én lezen (`magRijVanSchoolZien`); isolatiesuite tegen echte PostgreSQL (school A ziet nul rijen van B); **super-admin** met leesscope zonder schoolfilter | v2026.2.49.0 |
| 80 | **54** | **Testdatabase-seeder** — `seed-testdb.js` (seed/wipe/status, idempotent) + menu-optie 21 in `pycodeflow.sh`: 2 scholen, 4 leerkrachten, klassen met startcodes, leerlingen in alle statussen, vragen/sjablonen, toets mét resultaten | v2026.2.49.0 |
| 81 | **55** | **Beheer-RBAC** — Beheer enkel admin/super-admin (gescoped op eigen scholen), Systeem enkel super-admin; leerkrachten/klassen/leerlingen gegroepeerd per school met zoekvelden per tab; rolregels (`magRolToekennen`) | v2026.2.49.0 |
| 82 | **56** | **Mijn klassen** — eigen scherm voor élke leerkracht: startcode in bord-formaat, wachtende leerlingen aanvaarden, blokkeren, wachtwoordreset en leerling toevoegen — enkel voor eigen gekoppelde klassen (`magLeerlingBeheren`) | v2026.2.49.0 |
| 83 | **57** | **Klas ↔ leerkracht koppelen** — de endpoints bestonden maar hadden geen UI; Beheer → Klassen toont nu de gekoppelde leerkrachten met een 🧑‍🏫-modal, gescoped per school | v2026.2.49.0 |
| 84 | **58** | **Brandingfix** — `/api/school-info` las de leerkracht-cookie, waardoor een leerling op een gedeelde computer de school van de leerkracht zag; leerling-modus kijkt enkel naar de leerling-sessie | v2026.2.49.0 |

> Gedetailleerde beschrijvingen van de recentste sprints staan verderop onder "Detailbeschrijvingen".

---

## Detailbeschrijvingen (recentste sprints)

### 📐 Specificatie — E-maildomeinen per school (sprint 48a3)

**Regel — `*.` maakt het verschil. Dit zijn TWEE aparte regels:**

| Invoer | Betekent | ✓ toegelaten | ✗ geweigerd |
|---|---|---|---|
| `athkiel.be` | **exact** dit domein | `marie@athkiel.be` | `marie@leerling.athkiel.be` |
| `*.athkiel.be` | alles wat **eindigt** op `.athkiel.be` — **niet** `athkiel.be` zelf | `marie@leerling.athkiel.be`<br>`marie@a.b.athkiel.be` | `marie@athkiel.be` |

Wie "alles" wil, voegt **beide** regels toe. Nooit toegelaten, ongeacht de instelling: `marie@athkiel.be.aanvaller.com`, `marie@nepathkiel.be`.

**Matching (achtervoegsel-anker, geen "bevat"):**

```js
function domainMatches(email, pattern) {
  const d = email.split('@').pop().toLowerCase().replace(/\.$/, '');  // laatste @, punt weg
  const p = pattern.toLowerCase();
  if (p.startsWith('*.')) return d.endsWith(p.slice(1));  // '*.athkiel.be' -> '.athkiel.be'
  return d === p;                                          // exact
}
```

`p.slice(1)` maakt van `*.athkiel.be` het achtervoegsel `.athkiel.be` **met punt** — daardoor vallen `nepathkiel.be`, `athkiel.be.aanvaller.com` én het kale `athkiel.be` af.

**Validatie bij invoeren.** Vergevingsgezind: `@athkiel.be` → `athkiel.be`; hoofdletters → kleine letters; spaties en afsluitende punt weg. Weigeren met duidelijke melding:
- spatie of `@` middenin → *"Geef enkel het domein, bv. `athkiel.be`."*
- `*athkiel.be` (zonder punt) → *"Een wildcard begint met `*.` — bv. `*.athkiel.be`."*
- dubbel → *"Dit domein staat er al."*
- laatste verwijderen → *"Elke school heeft minstens 1 domein nodig."*
- **te breed** (`*.be`, `*.com` — wildcard met één label) → *"`*.be` is te breed: dan kan iedereen met een `.be`-adres zich registreren."*

**Adminveld bevat verplicht:** de uitleg met ✓/✗-voorbeelden per vorm, én een **testveldje** ("plak een adres → toegelaten/geweigerd + via welke regel"). Zonder dat testveldje ontdekt een leerling de fout op de dag van de toets.

---

### 📐 Specificatie — Leerling-instap zonder e-mail (sprints 52a-52i)

**Waarom e-mail als inlognaam, ook zonder mailserver.** Een naam is dubbelzinnig ("Janssens Marie" of "Marie Janssens"?) en niet uniek. Een schooladres is beide wél. Bovendien ben je zo **voorbereid**: komt er later verificatie bij (52-x1), dan is dat puur additief.

**Belangrijk:** `students.id` blijft de primaire sleutel; `email` is enkel de **inlognaam** (uniek, maar wijzigbaar). Wijzigt een schooladres, dan blijven alle resultaten hangen aan het id.

**De flow:**
1. **Leerkracht zet de klascode op het bord** (`start_code_active` aan).
2. **Leerling registreert zichzelf**: klascode + zijn **school-e-mail** (domeincheck) + eigen wachtwoord. De leerkracht kent die adressen niet — de leerling maakt zijn account dus zelf aan.
3. Account krijgt **`status = 'pending'`** en hangt aan de klas van de code.
4. **De leerling kan meteen meedoen** met een klassessie en vrij oefenen — de les mag nooit stilvallen. In het sessiescherm verschijnt hij met een **pending-badge** *(bestaat al)*.
5. **De leerkracht aanvaardt** hem *(bestaat al: `teacher_update_student_badge`, action `accept` → `pending` → `active`)*. **Pas dan** kan hij toetsen en taken maken.
6. **Vergeten wachtwoord?** De leerkracht zet `must_change_password` terug; de leerling gebruikt opnieuw de klascode.

**De toegangsregel (52e) — dit is de kern:**

| Status | Klassessie | Vrij oefenen | Toets / taak |
|---|---|---|---|
| `pending` | ✅ | ✅ | ⛔ **geweigerd** |
| `active` | ✅ | ✅ | ✅ |
| `blocked` | ⛔ | ⛔ | ⛔ |

Vandaag kijkt **`quiz_start` niet naar de status** — een pending leerling kan dus gewoon een toets maken. Dat is precies wat 52e toevoegt.

**Namen — waar wat komt te staan.** De leerling geeft **voornaam en achternaam apart** in. `name` (= "Voornaam Achternaam") blijft de weergavenaam en verschijnt op **toetsen, taken, voortgang, nakijken en exports**. Het **e-mailadres is enkel de inlognaam** en hoort **nergens** op toets- of taakweergaven — dat is een expliciete eis, geen detail: het staat in exports die de klas rondgaan.

**Waarom apart en niet één naamveld.** Zo bestaat "Janssens Marie of Marie Janssens?" structureel niet meer — geen afspraak die iemand ooit vergeet. De leerkracht kan beide velden **corrigeren** (52h) als een leerling zich vertypt.

**Wat al bestaat** (en dus niet herbouwd hoeft): aanvaarden, blokkeren, van klas veranderen, verwijderen, en de pending-badge in het sessiescherm. 52h vult aan: naam/e-mail bewerkbaar, e-mail tonen in de beheerlijsten, en aanvaarden ook buiten een live sessie.

> **⚠️ Aanvaard restrisico (16/07).** Zolang er geen e-mailverificatie is (52-x1, uitgesteld), kan een klasgenoot zich registreren met andermans schooladres — die zijn voorspelbaar en hij kent de klascode. Het **aanvaarden lost dat niet op**: de leerkracht ziet enkel het adres, niet wie het typte. **Wél zelfcorrigerend:** de echte Marie krijgt "adres al in gebruik" en meldt dat meteen; de leerkracht verwijdert het valse account en zij registreert opnieuw. Beperkt doordat het onder toezicht in de eerste les gebeurt. Wil je dit sluiten, dan is 52-x1 (verificatie) de enige echte oplossing.


---

### 📐 Specificatie — Templates (sprints 53a-53d)

> **⚠️ Grotendeels vervangen door sprint 51c (Bibliotheek).** De onderstaande oorspronkelijke aanpak (`is_template`-vlag op `assignment_bank`, `visibility owner/school/public`, dupliceren-vanuit-template) is **niet** uitgevoerd zoals hier beschreven. In plaats daarvan koos 51c voor een **aparte tabel `assignment_templates` + koppeltabel `template_questions`** (want een toets/taak is een levende sessie) en een `share_scope` (privé/school/publiek) op vragen. Enkel **53d (admin-takedown)** blijft open. Deze specificatie blijft staan als historische context; de werkende beschrijving staat bij **Sprint 51c** hieronder.

- `is_template BOOLEAN` op `assignment_bank`. Staat **los van `type`**: een template kan een toets óf een taak zijn.
- Template = **geen deadline** (uitzondering op 43.3), **geen klas/school**.
- Gebruiken = **dupliceren**; het origineel is enkel door de **eigenaar** aanpasbaar.
- `visibility`: **`owner`** (alle scholen van de eigenaar) · **`school`** (deze school) · **`public`** (iedereen).
- Scholen tekenen vooraf een toestemmingsformulier; delen is **nooit verplicht** — alles kan binnen de eigen school blijven.
- **53d — takedown-knop.** Een contract haalt niets offline: een admin moet een publieke template meteen kunnen verbergen.

> **⚠️ Architecturaal — dit is de enige uitzondering op de isolatie-regel.** Fase 3 zegt *"elke query filtert op `school_id`"*. `visibility = 'public'` doorbreekt dat bewust. Die uitzondering hoort op **één plek** (48c2), en enkel in deze vorm: `is_template = true AND visibility = 'public'`. Elders is cross-school lezen nooit toegestaan. Wordt dit per query geregeld, dan is dit het gaatje waardoor ooit echte toetsdata lekt.

---

### 📐 Specificatie — Leerkracht-login + schoolkeuze (sprints 48b1-48b2)

Startscherm → "Ik ben leerkracht" → login. **Na een geslaagde login:**
- **1 school** → automatisch ingelogd met die school.
- **>1 school** → extra grid met dropdown van **zijn** scholen; logingegevens **grijs**; knoppen **Annuleren** / **Kiezen**.

**Twee dingen die goed moeten:**
- De schoollijst verschijnt **pas ná authenticatie** — zo verklap je aan niemand welke scholen bestaan. (Dit zat al goed in het ontwerp.)
- **Annuleren** vernietigt de half-ingelogde toestand (terug naar een schoon loginscherm), niet enkel het grid verbergen.
- `active_school_id` staat **server-side** in de sessie — nooit iets dat de browser meestuurt.

**Branding (48b3):** schoollogo naast het PyCodeFlow-icoon, **pas ná de schoolkeuze**. Op start- en loginscherm is er nog geen school bekend → enkel het PyCodeFlow-logo. Bij leerlingen pas ná login.

---


### Sprint 43.2 — Toetsen-/takenbank (overzichtspagina) *(~1.5 dag)* — ✅ AFGEROND (v2026.2.47.5)

**Aangemeld:** 12/07/2026 (testronde) · **Afgerond:** 12/07/2026 · **Cat:** UX/BUG

**Wat is gebouwd:** de "Toetsen"-tab (`teacher-sessions.html` + `app.js`) is uitgebouwd tot een **toetsen-/takenbank**. `/api/quiz-sessions?bank=1` levert nu álle items uit `quiz_meta` — **inclusief previews** (met vlag `isPreview`) en met `schoolYear`, `targetClass` + `className`. De bank toont per item type (toets/taak), status, preview-badge, klas en datum, met filters (**klas, type, status, schooljaar**, client-side) en acties **Live, Voortgang, Verbeteren, Dupliceren en Verwijderen**. Verwijderen hergebruikt `DELETE /api/sessions/:code` (soft-delete) — dat haalt de zwevende/preview-toets uit de lijst. Zo is niets nog onbereikbaar.

---

### Sprint 43.2b — Bank vindbaar + status-groepen + preview activeren *(~0.5 dag)* — ✅ AFGEROND (v2026.2.47.6)

**Aangemeld:** 12/07/2026 (testronde) · **Cat:** UX

**Wat is gebouwd:**
- **Vindbaarheid:** nav-link **"📚 Toetsen & taken"** toegevoegd op alle leerkrachtpagina's → `teacher-sessions.html?tab=quizzes`, dat de bank-tab meteen opent. (De bank zat al in de "Toetsen"-tab maar was niet bereikbaar vanuit het toets-aanmaakscherm.)
- **Status-groepen** in de bank: **🟢 Actief**, **👁 Preview / onafgewerkt**, **✅ Afgerond / te verbeteren** — met kop per groep.
- **Preview activeren:** knop **▶ Activeren** op preview-items → `POST /api/quiz/:code/activate` zet `is_teacher_preview=false`, waardoor de preview een echte, startbare toets wordt (los daarmee ook het "kan preview niet later starten"-probleem op).
- **Dupliceer-naam** vraagt nu via een **scherm-modal** (`pyPrompt`) i.p.v. de browser-`prompt()`. Meteen ook een bug in de verwijder-bevestiging gefixt (`pyConfirm` kreeg een string i.p.v. een options-object).

---

### Sprint 43.6 — Bugfix leerling-login + sessie-overzicht tabs *(~0.5 dag)* — ✅ AFGEROND (v2026.2.47.7)

**Aangemeld:** 12/07/2026 (testronde: "knoppen doen niets") · **Cat:** BUG + UX

**Login-bug (root cause):** sinds sprint 45 serveert de app de leerling-ingang op de nette route **`/student`**, waardoor `page === 'student'`. Maar `_socketPages` in `app.js` (de lijst pagina's die een echte Socket.IO-verbinding krijgen) bevatte wél `'student-start.html'` maar **niet `'student'`**. Op `/student` werd de socket dus een **no-op stub** → `socket.emit('student_join', …)` deed niets → "Deelnemen" en "Vrij oefenen" leken dood. **Fix:** `'student'` toegevoegd aan `_socketPages`. (De CSP-report-only-meldingen in de console waren onschuldig en niet de oorzaak.)

**Sessie-overzicht (Req A):** `teacher-sessions.html` heeft nu drie tabs **Sessies / 🧪 Toetsen / 📝 Taken**. De Toetsen- en Taken-tabs tonen **enkel actieve** items (geen previews, geen gesloten/verlopen), gefilterd op type. De volledige bank (incl. previews, met activeren/verwijderen/filters) blijft bereikbaar via de nav-link "📚 Toetsen & taken" (`?tab=quizzes`).

---

### Sprint 43.14 — "+ Nieuwe taak" maakt een toets *(~0.5 dag)* — ✅ AFGEROND (v2026.2.48.11)

**Aangemeld:** 16/07/2026 (testronde) · **Cat:** BUG · **Prio:** 🔴 P10

**Symptoom:** klik je op **"+ Nieuwe taak"**, dan krijg je een scherm dat overal *toets* zegt — en wat je aanmaakt is ook echt een **toets**, geen taak.

**Oorzaak — drie dingen die samenvallen:**
1. De knop linkt naar `/quiz-teacher.html` **zonder enige aanduiding** van het type. Dat geldt op **twee plekken**: de knop "+ Nieuwe taak" in `taak-overzicht.html` (43.7) én "+ Nieuwe taak aanmaken" in de Taken-tab van `teacher-sessions.html` (43.6b).
2. `quiz-teacher.html` is volledig **hardgecodeerd op "toets"**: `<title>`, de kop *"Nieuwe toets aanmaken"*, de uitleg *"Stel een toets in…"* en het veld *"Naam van de toets"*.
3. Het type wordt **afgeleid uit de timer** (`type: noTimer ? 'taak' : 'toets'`, quiz-teacher.js), en de standaard staat op **Tijdslimiet 45 minuten** → dus een toets.

Je moet dus tóevallig weten dat "Geen tijdslimiet" er een taak van maakt. Dat is geen taak aanmaken; dat is een toets aanmaken die per ongeluk een taak wordt.

**Waarom dit nu pas opvalt:** vóór 43.7 bestond er geen aparte weg naar "taak aanmaken" — je maakte gewoon een toets en zette de timer uit. De knoppen die 43.6b en 43.7 toevoegden beloven iets wat het scherm niet waarmaakt.

**Fix-richting:** sprint **43.3** gaf `assignment_bank` al een echte `type`-kolom, maar het **formulier vraagt er niet naar**. Het type is nog steeds een neveneffect van de timerkeuze. Te doen:
- Type meegeven in de link (`/quiz-teacher.html?type=taak`) én de pagina laten meebewegen: titel, uitleg, veldnamen, en de timer standaard op *"Geen tijdslimiet"*.
- Beter nog: het type een **expliciete keuze** op het formulier maken (zoals Klasmodus/Examenmodus bij een sessie), met de timer als gevolg i.p.v. als oorzaak. Dan kan je ook een taak mét tijdslimiet maken, als dat ooit nodig blijkt.
- Nakijken of "Geen tijdslimiet" nog steeds automatisch `type='taak'` mag betekenen, of dat die afleiding volledig moet vervallen zodra het type expliciet gekozen wordt.

**❓ Beantwoord (17/07/2026):** ja, een **taak** mag een tijdslimiet hebben — dat is enkel niet meer verplicht. Gevolg: het type moet al vaststaan **vóór** het aanmaakscherm opent (via de link) en is **niet meer wijzigbaar** eenmaal je aan het aanmaken bent. Meldingen tijdens het aanmaken volgen dat vaste type.

**Gebouwd — gekozen richting: fix-optie 1 (link + meebewegende pagina), niet de expliciete formulierkeuze.** Precies omdat het type al vaststaat vóór het openen, is er geen radio-knop "toets of taak" nodig op het scherm zelf:
- Alle 6 plekken die naar `quiz-teacher.html` linken (`taak-overzicht.html`, `toets-overzicht.html`, `quiz-archive.html`, en de 3 links in `teacher-sessions.html` — Toetsen-tab, Taken-tab, Toetsen-/takenbank-tab) geven nu `?type=toets` of `?type=taak` expliciet mee.
- `quiz-teacher.html`/`.js` lezen dat type bij het laden en laten titel, topbar-badge, kop, subtekst, veldlabel, placeholder, knoptekst, bevestigingstitel en toast/meldingtekst overal meebewegen (`QUIZ_TYPE_META`). De timer-radio start op de zinvolle default per type (toets → tijdslimiet, taak → geen tijdslimiet) maar blijft voor **beide** types vrij instelbaar — een taak MAG dus nu ook een tijdslimiet krijgen.
- Ontbreekt het type (rechtstreekse link, oude bookmark) dan verschijnt een klein keuzescherm (`#type-chooser`) vóór de wizard zelf zichtbaar wordt — de wizard blijft verborgen tot het type vaststaat, dus geen manier om "per ongeluk" in een half-bepaald scherm te belanden.
- Server (`POST /api/quiz`) vertrouwt het type niet blind: `isValidAssignmentType` (nieuw, `lib/validation.js`) weigert de aanvraag zonder geldig `'toets'`/`'taak'`. De oude afleiding `type: noTimer ? 'taak' : 'toets'` is weg, zowel in `server.js` als in `database.js` zelf (`createQuizSession`, waar diezelfde afleiding als vangnet stond) — een expliciet type wint nu altijd.
- **Bijkomend gevonden en meegefixt:** `/api/quiz/:code/duplicate` gaf `type` helemaal niet mee aan `createQuizSession`, en viel dus terug op diezelfde noTimer-afleiding — een taak dupliceren kon in theorie stiekem een toets opleveren. Kopieert nu `meta.type` expliciet mee.
- Tests: `web/tests/validation.test.js` (sprint 43.14-sectie, `isValidAssignmentType`).

*Bestanden: quiz-teacher.html, quiz-teacher.js, taak-overzicht.html, toets-overzicht.html, quiz-archive.html, teacher-sessions.html, server.js, database.js, lib/validation.js, tests/validation.test.js*

---

### Sprint 51a — Fase 2 start: sessie-eigenaar (`teacher_id`) *(~0.5 dag)* — ✅ AFGEROND (v2026.2.48.11)

**Cat:** AUTH · **Prio:** 🟠 P8 · **Gebouwd samen met 43.14** (17/07/2026)

**Wat:** `sessions.teacher_id` (FK → `teachers`, `ON DELETE SET NULL`) + index. Elke nieuwe sessie krijgt meteen haar eigenaar mee:
- `POST /api/quiz` (nieuwe toets/taak) en `POST /api/quiz/:code/duplicate` (kopie) → `req.teacher`.
- `teacher_create_session` (klassessie/examenmodus via socket) → `socket.data.teacher`, beschikbaar sinds de `io.use`-middleware van **50f** (die het hier expliciet al aankondigde: *"de socket weet nu WIE de leerkracht is — dat heeft sprint 51 nodig"*).

Beide lopen via één nieuwe pure functie `bepaalSessieEigenaar(teacher)` in `lib/auth.js` (naast `bepaalTeacherIdentiteit`), zodat REST en socket exact dezelfde regel volgen en het los van Express/sockets test baar blijft. Bij `authUit` (open modus, geen accounts) is er bewust geen eigenaar.

`persistSession` schrijft `teacher_id` enkel bij de **INSERT**, niet bij de `ON CONFLICT DO UPDATE` — de eigenaar staat vast bij aanmaken en latere autosaves/sluitacties overschrijven hem niet.

**Backfill bestaande rijen:** er werd vóór deze sprint nergens geregistreerd wie een sessie aanmaakte, dus de werkelijke aanmaker van oude sessies is niet meer te achterhalen. Bij **precies 1** leerkrachtaccount is er maar één mogelijke eigenaar — die kennen we dus wél zeker en die krijgen alle bestaande sessies zonder eigenaar. Bij **0 of meerdere** accounts blijft `teacher_id` bewust `NULL` ("onbekend/legacy") in plaats van te gokken. Idempotent: draait bij elke opstart, raakt alleen rijen die nog geen eigenaar hebben.

**Niet in deze sprint:** autorisatie die op `teacher_id` filtert (leerkracht ziet/beheert enkel eigen sessies) — dat is **51b**, expliciet de volgende stap in Fase 2.

*Test: nieuwe sessie krijgt de juiste eigenaar (`tests/auth.test.js`, sectie 51a — dekt `bepaalSessieEigenaar` én de backfill-logica met een in-memory replica, zelfde patroon als `membership.test.js`).*

*Bestanden: database.js, lib/auth.js, server.js, tests/auth.test.js*

---

### Sprint 51b — Fase 2: autorisatie op eigenaarschap *(~1.5 dag)* — ✅ AFGEROND (v2026.2.48.12)

**Cat:** AUTH · **Prio:** 🟠 P8 · Bouwt voort op **51a** (eigenaar op `sessions`).

**Wat:** vanaf nu beheert en ziet een leerkracht enkel zijn **eigen** sessies; een **admin** mag/ziet alles. Concreet: A kan B's sessie niet meer openen, sluiten, verwijderen of inzien — dat geeft **403** (REST) of een weigering (socket).

**Eén regel, twee kanten.** De beslissing zit in de pure functie **`magSessieBeheren(teacher, sessionOwnerId)`** (`lib/auth.js`), zodat de REST- en de socketkant identiek beslissen en ze zonder databank testbaar is. Volgorde: geen leerkracht → nooit; **admin → alles** (de open-modus krijgt rol `admin` en valt hier, dus niets breekt bij één gebruiker); **onbekende eigenaar (`NULL`) → toegestaan** (legacy-sessies van vóór 51a niemand buitensluiten); anders enkel de eigenaar zelf.

**REST — `requireSessionAccess`-middleware** op **alle 31** `:code`-endpoints van `/api/quiz`, `/api/sessions` en `/api/quiz-sessions` (na `requireTeacherAuth`). Haalt de eigenaar op via de nieuwe `getSessionOwner(code)` (bron = databank, dus klopt ook voor gesloten/gearchiveerde toetsen die niet in het geheugen staan). **Belangrijke subtiliteit:** `/api/quiz/:code` staat qua route-volgorde vóór literals als `/api/quiz/archive`, `/api/quiz/stats` en `/api/quiz/comment-templates`, die daardoor (Express first-match) óók via `:code` binnenkomen. De middleware dwingt daarom enkel af wanneer de code een **echte sessiecode** is (`isValidSessionCode`, 8× A-Z0-9); die literals laten we ongemoeid doorlopen, exact hun bestaande gedrag. De student-endpoints (`/review-login`, `/my-result`) hebben geen `requireTeacherAuth` en blijven dus onaangeroerd.

**Socket — `socketMagSessie(socket, session)`** (eigenaar rechtstreeks uit `session.teacherId` in het geheugen, identiteit uit `socket.data.teacher` van 50f, geen DB nodig):
- `teacher_join_session` (**openen**) en `teacher_join_as_observer` (**waarnemen**) en `teacher_grid_observe` (grid-overzicht) → weigeren bij een vreemde sessie. Openen is de deur: wie er niet binnenkomt, bereikt de sluit-/verwijder-acties sowieso niet.
- `teacher_close_session` en `teacher_delete_session` krijgen bovendien een **dubbele grendel** — ze controleren het eigenaarschap nog eens expliciet, zodat verwijderen nooit op andermans sessie kan slaan.

**Lijsten filteren** — `/api/sessions` (actief + gesloten) en `/api/quiz-sessions` tonen enkel sessies die de leerkracht mag beheren. Zo verdwijnt andermans werk uit het overzicht zelf, niet enkel uit het beheer. `loadClosedSessions` geeft daarvoor nu `teacher_id` mee.

**Bewust nog niet:** de school-grens op "admin ziet alles" (nu schooloverstijgend) hoort bij Fase 3 (`school_id`, 48c-reeks). De vragenbank-privacy is **51c**, klas-filtering **51d**. Los opgemerkt (bestaande bug, buiten 51b): door dezelfde route-volgorde is het **archief-overzicht** (`GET /api/quiz/archive`) al langer afgeschermd door `/api/quiz/:code` — apart op te lossen door de literals vóór `:code` te registreren.

*Test: `tests/auth.test.js`, sectie 51b — A mag B's sessie niet beheren (kern), eigenaar wel, admin overal, open-modus overal, legacy-`NULL` blijft beheerbaar, geen leerkracht → nooit. Aanvullend end-to-end gesimuleerd met een mini-Express: eigenaar 200, vreemde 403, admin 200, legacy 200, onbestaand 404, en de shadowed literal `/api/quiz/archive` loopt ongewijzigd door.*

*Bestanden: lib/auth.js, db/database.js, server.js, tests/auth.test.js*

---

### Sprint 51c — Fase 2: Bibliotheek (delen van vragen & sjablonen) *(~2.5 dag)* — ✅ AFGEROND (backend + frontend)

**Cat:** FEAT · **Prio:** 🟠 P8 · Bouwt voort op **51a/51b** (eigenaar + `magSessieBeheren`).

**Kernbeslissing datamodel.** Twee types delen op twee manieren, bewust:
- **Vragen** zijn losse records → één kolom `question_bank.share_scope` (`private`/`school`/`public`, default **`private`**). Bestaande vragen worden dus privé; delen is een expliciete keuze (geen overload aan dubbele info).
- **Toetsen/taken** zijn géén losse records maar **levende sessies** (`sessions` + `assignment_bank` + snapshots, mét code/klas/leerlingen/antwoorden). Een deel-vlag daarop zou een lopende toets tegelijk "sjabloon" maken. Daarom een **aparte tabel `assignment_templates`** (herbruikbare definitie: enkel instellingen, géén klas/tijdvenster/leerlingen) + koppeltabel **`template_questions`** (levende referentie naar `question_bank`). Voordeel: een sjabloon overleeft het wissen van de oorspronkelijke sessie, en **materialiseren** ("Maak toets/taak") maakt een nieuwe sessie via de bestaande `createQuizSession`-weg met de uitvoerder als eigenaar.

**Zichtbaarheid (pure regels, `lib/auth.js`).** Niveaus van smal→breed: `private(0) < school(1) < public(2)`. `sjabloonItemZichtbaar(item, viewer, {deeltSchool})` beslist voor vraag én sjabloon: eigen altijd; publiek→iedereen; school→wie een school deelt (of admin); privé→enkel eigenaar. Beheren = alias van `magSessieBeheren` (enkel eigenaar/admin/legacy).

**Integriteit sjabloon ↔ vraag** (de koppeltabel maakt vragen een *levende* referentie, dus deze drie regels bewaken de invariant "een sjabloon is nooit breder gedeeld dan zijn vragen"):
1. **Koppelen** (`magVraagKoppelen`): publiek sjabloon ← enkel publieke vragen; school-sjabloon ← school + publiek; privé sjabloon ← alles wat de eigenaar ziet.
2. **Sjabloon-scope wijzigen** (`magSjabloonScopeWorden`): breder maken kan enkel als álle gekoppelde vragen dat toelaten; privater maken mag altijd.
3. **Vraag-scope grendel**: een vraag die aan ≥1 sjabloon hangt, kan **niet** van scope wijzigen (409) — je moet ze eerst losmaken. Idem: zo'n vraag kan niet verwijderd worden.

**Bewuste gevolgen** (afgeleid uit de koppeltabel-keuze, geen bugs):
- *Referentie i.p.v. snapshot:* de inhoud van een gedeelde vraag bewerken werkt door in élk sjabloon dat ze gebruikt. Veilig omdat een **gematerialiseerde toets een bevroren snapshot** is — leerlingen zien nooit een wijziging tijdens de toets.
- *Cross-eigenaar grendel:* hangt collega A jouw publieke vraag in A's sjabloon, dan kan jij (eigenaar) de scope van die vraag pas wijzigen als A ze losmaakt. Dit beschermt A's gedeelde sjabloon.
- *Ad-hoc vragen bij "Bewaar als sjabloon":* snapshot-vragen zonder bank-id worden als **privé** bankvraag van de eigenaar aangemaakt en gekoppeld, zodat het sjabloon volledig bank-gedekt is.

**Backend (dit deel).** Migraties (idempotent, `duplicate_column`-patroon): kolom `share_scope` + tabellen `assignment_templates`/`template_questions`. Datalaag: `listSharedQuestions`, `listTemplates`, `getTemplate(Questions/Scopes)`, `create/update/deleteTemplate`, `set(Template)Scope`, `attach/detachQuestionToTemplate`, `setTemplateQuestionOrder`, `createTemplateFromSession`, `getQuizQuestionById`, `countTemplatesForQuestion`, `setQuestionScope`; `deleteQuizQuestion` weigert nu ook bij een sjabloon-koppeling. REST: `GET /api/library/questions|templates|templates/:id`, `POST .../from-session/:code`, `PATCH/DELETE .../:id`, `PUT .../:id/scope`, `POST/DELETE .../:id/questions[/:qid]`, `PUT .../:id/questions/order`, `POST .../:id/materialize`, plus `PUT /api/quiz/bank/:id/scope` en een **eigenaarsgrendel** op bewerken/archiveren/verwijderen van vragen (sloot een bestaand gat: die hadden géén eigenaarscheck).

**Deel 2 (frontend) — afgerond.** Nieuwe pagina **📚 Bibliotheek** (`sjablonen.html` + `sjablonen.js`), toegevoegd aan de subnav van alle 9 balk-pagina's, met een eigen beveiligde serve-route. Drie tabs (Toetsen/Taken/Vragen); binnen elke tab twee secties **🏫 Gedeeld binnen school** en **🌍 Publiek** (privé-items verschijnen hier bewust niet). Eigen items tonen een zichtbaarheids-`select` (privé/school/publiek) en — bij sjablonen — een beheer-paneel (vragen herordenen ▲▼, los-/koppelen, hernoemen) + verwijderen; andermans items tonen **➕ Maak toets/taak** (materialiseren → redirect naar het juiste overzicht) of **📋 Dupliceren naar mijn bank** (vragen). De **scope-schakelaar op vragen** staat óók in de Vragenbank (`quiz-bank.js`) — dat is het startpunt om een privé-vraag te delen, want de Bibliotheek toont enkel al-gedeelde vragen. Op het toets-/taakoverzicht kwam **💾 Bewaar als sjabloon** (`assignment-overview.js` → `POST /api/library/templates/from-session/:code`). De `GET /api/quiz/bank`-respons kreeg een `isOwner`-vlag zodat de scope-schakelaar enkel bij eigen vragen verschijnt.

**Bewust ongewijzigd:** de bestaande Vragenbank/Toets/Taak-overzichten filteren hun lijst niet op scope (geen leeggelopen bank op een install met feitelijk één leerkracht); de zichtbaarheid leeft op de nieuwe pagina + de scope-schakelaar.

*Test: `tests/auth.test.js`, sectie 51c — `scopeRang`, `sjabloonItemZichtbaar` (eigen/privé/school/publiek/admin), `magVraagKoppelen`, `magSjabloonScopeWorden`, `magSjabloonBeheren`. 72 → alle groen.*

*Bestanden (deel 1): lib/auth.js, db/database.js, server.js, tests/auth.test.js. Deel 2: public/sjablonen.html, public/sjablonen.js, public/quiz-bank.js, public/assignment-overview.js, public/{admin,monitoring,quiz-archive,quiz-bank,quiz-review,quiz-teacher,teacher-sessions,toets-overzicht,taak-overzicht}.html, server.js, sprintlog.md*

---

### Sprint 51d — Fase 2: gewone sessies enkel zichtbaar voor de eigenaar *(~0.5 dag)* — ✅ AFGEROND

**Cat:** AUTH · **Prio:** 🟠 P8 · Bouwt voort op **51a/51b**.

**Waarom.** 51b filterde het sessie-overzicht al met `magSessieBeheren`, maar die regel laat bewust twee dingen door: een **admin ziet alles**, en een sessie **zonder eigenaar (`NULL`)** is voor iedereen zichtbaar (legacy-veiligheid). Voor **gewone** sessies (les/examen) betekende dat nog steeds een volgelopen overzicht: elke leerkracht zag sessies zonder eigenaar (en een admin die van iedereen). Toetsen/taken volgen een ander systeem (`/api/quiz-sessions`) en blijven ongemoeid.

**Wat.** Een aparte, strengere pure regel **`magSessieZien(teacher, session)`** (`lib/auth.js`), enkel voor het gewone-sessie-overzicht: geen admin-uitzondering, geen `NULL`-uitzondering — je ziet enkel sessies met `teacherId === jouw id`. De **open modus** (geen echte accounts, dus geen `teacher.id`) ziet alles: er is dan maar één gebruiker. Toegepast op beide takken van `GET /api/sessions` (actieve sessies uit de geheugen-Map én gesloten sessies uit de databank). Beheer (openen/sluiten/verwijderen) blijft via `magSessieBeheren` lopen — een admin kan dus nog steeds ingrijpen, hij ziet de sessie alleen niet standaard in *zijn* lijst; systeemtoezicht loopt via `/api/monitoring`.

**Gevolg (bewust).** Een gewone sessie zonder eigenaar (legacy van vóór 51a) verschijnt niet langer in wélk overzicht dan ook. Op een verse install bestaan die niet; bestaande installs kunnen ze desnoods via het systeemscherm terugvinden. Nieuwe gewone sessies krijgen sinds 51a altijd een eigenaar (REST én socket), dus dit is een aflopende zaak.

*Test: `tests/auth.test.js`, sectie 51d — eigenaar ziet eigen sessie; ander niet; admin ziet andermans gewone sessie niet (wel eigen); `NULL`-eigenaar niet voor iedereen; open modus ziet alles; geen leerkracht → nooit. 78 → alle groen.*

*Bestanden: lib/auth.js, server.js, tests/auth.test.js, sprintlog.md*

---

### Sprint 51e — Fase 2: leerkracht ziet enkel eigen klassen (`teacher_classes`) *(~1 dag)* — ✅ AFGEROND

**Cat:** AUTH · **Prio:** 🟠 P8 · Sluit Fase 2 af.

**Wat bleek.** De koppeltabel `teacher_classes` en de link/unlink-endpoints bestonden al (48-reeks), maar werden **nergens** gebruikt om het klasoverzicht te filteren: elke leerkracht zag álle klassen. Ook werd de **maker** van een klas niet aan zichzelf gekoppeld.

**Wat.** Drie ingrepen, met dezelfde "breek-niets"-voorzichtigheid als 51a: 
1. **Aanmaak koppelt de maker** — `POST /api/admin/classes` roept nu `linkTeacherClass(maker, klas)` (open modus zonder id: overgeslagen). 
2. **Overzicht filtert** — `GET /api/admin/classes` gebruikt de nieuwe `listClassesVisibleTo(...)`: een admin ziet alle klassen (klasbeheer is een admintaak), een leerkracht ziet klassen waaraan hij gekoppeld is **plus** klassen zónder enige koppeling ("legacy" → nog niemands eigendom, blijft zichtbaar). De leerling-dropdown (`GET /api/classes`, publiek) blijft **ongefilterd** — een leerling moet zijn klas kunnen kiezen ongeacht de leerkracht. Interne klasnaam-lookups (bank-overzicht, socket-join) blijven ook op de volledige lijst. 
3. **Backfill** — bij precies één leerkrachtaccount worden alle bestaande klassen aan die leerkracht gekoppeld (idempotent, `ON CONFLICT DO NOTHING`), zodat de regel meteen klopt zonder iets te verbergen. Bij meerdere accounts blijven bestaande klassen ongekoppeld tot ze aangemaakt/geclaimd worden.

**Waarom de admin/legacy-uitzondering hier wél (anders dan 51d).** Klassen zijn fundamenteel — je hebt ze nodig om toetsen/taken/sessies aan te koppelen. Een te agressieve filter zou een leerkracht de toegang tot zijn eigen klas kunnen ontnemen. Vandaar: nog niet-toegewezen klassen blijven zichtbaar, en een admin (klasbeheerder) ziet alles. Pure regel `magKlasZien(teacher, { isLinked, heeftEigenaar })` spiegelt exact de SQL-filter.

*Test: `tests/auth.test.js`, sectie 51e — gekoppelde leerkracht ziet zijn klas; niet-gekoppelde niet; niet-toegewezen (legacy) klas blijft zichtbaar; admin ziet alles; geen leerkracht → nooit. 83 → alle groen.*

*Bestanden: lib/auth.js, db/database.js, server.js, tests/auth.test.js, sprintlog.md*

---

### Sprint 52 — Leerling-accounts, deel 1: fundament *(52a + 52b + 52e-regel)* — ✅ AFGEROND

**Cat:** AUTH/SEC · Sprint 52 (leerling-login & zelfregistratie) is groot en beveiligingsgevoelig, dus opgedeeld. **Deel 1 = het fundament** (schema + startcodes + de toegangsregel), bewust volledig backend/pure zodat er nog geen half-open loginoppervlak ontstaat. Deel 2 = zelfregistratie + login (52c/52d); deel 3 = herstel/routing/beheer/id-koppeling (52f–52i).

**52a — leerling-account (schema).** `students` kreeg `email` (login, hoofdletter-ongevoelig **uniek** via partiële index, overgenomen uit `google_email`), `pass_hash`, `must_change_password`, `first_name`, `last_name`. `name` blijft de weergavenaam en blijft in alle schermen + de bevroren `quiz_answers.student_name` — niets breekt. Accessors: `getStudentByEmail`, `getStudentById`, `setStudentPassword`, `setStudentMustChangePassword`.

**52b — klas-startcode.** `classes` kreeg `start_code` (partieel uniek) + `start_code_active`. Pure generator `genereerKlascode` (6 tekens, alfabet zonder 0/1/O/I — board-leesbaar; de databank bewaakt uniciteit, de server hertest bij botsing). Endpoints: `POST /api/admin/classes/:id/start-code` (nieuwe code, meteen actief) en `PUT …/start-code/active` (venster sluiten/heropenen). Beheerrecht via `magKlasBeheren`: admin of een aan de klas gekoppelde leerkracht (51e) — leerkracht A kan de code van klas B niet roteren. DB: `isTeacherLinkedToClass`, `getClassById`, `classCodeInGebruik`, `setClassStartCode(Active)`, `getClassByActiveStartCode` (klaar voor 52c).

**52e — toegangsregel (pure kern).** `magLeerlingActiviteit(student, activiteit)`: `active` → alles; `pending` → wél klassessie + vrij oefenen (les valt nooit stil), géén toets/taak; `blocked` → niets; geen/onbekende status → niets (veilige default), status ontbrekend → `active` (bestaande data). De regel + tests staan er; de **afdwinging in `quiz_start`** volgt in deel 2 zodra de leerling-login een identiteit met status oplevert.

**Bewust nog niet:** zelfregistratie-pagina + endpoint (52c), leerling-login + sessie + rate-limiting (52d), en dus ook de wiring van de toegangsregel. Zonder die is er geen leerling-authenticatieoppervlak actief — dit deel is puur voorbereidend en breekt niets aan de bestaande (naam-gebaseerde) leerling-instap.

*Test: `tests/auth.test.js`, secties 52b (klascode: lengte, toegelaten alfabet, geen 0/1/O/I) en 52e (active/pending/blocked × klassessie/oefenen/toets/taak, veilige defaults). 90 → alle groen.*

*Bestanden: lib/auth.js, db/database.js, server.js, tests/auth.test.js, sprintlog.md*

---

### Sprint 52 — Leerling-accounts, deel 2: zelfregistratie + login *(52c + 52d + 52b-UI)* — ✅ AFGEROND

**Cat:** AUTH/SEC. De verweven, gebruikersgerichte brok: een leerling maakt zelf een account en logt in.

**52c — Zelfregistratie.** Pagina `student-register.html` + `POST /api/student/register` (rate-limited per IP). Flow: **klascode** → `getClassByActiveStartCode` (enkel een *actieve* code van een niet-gearchiveerde klas telt; foute/gesloten code → geweigerd) · **e-mail** → vormcheck (`isGeldigEmail`) + **schooldomein-check** (`findSchoolByEmailDomain` met de veilige `domainMatches` uit 48a3; zolang er nog géén domeinen bestaan — test-/beginfase — wordt dit overgeslagen) · **dubbel adres** → geweigerd (`getStudentByEmail`, hoofdletter-ongevoelig uniek) · **wachtwoord** min. 8 tekens, 2× gelijk. Resultaat: `createStudentAccount(...)` maakt een leerling met `status = 'pending'`, `name = voor + achter`, gekoppeld aan de klas (`class_memberships`) voor het juiste schooljaar. Bron `self`.

**52d — Login.** Pagina `student-login.html` + `POST /api/student/login` (rate-limited met dezelfde IP-throttle + oplopende vertraging als de leerkracht-login). Verifieert e-mail + wachtwoord (`verifyPasswordWithHash`), weigert `blocked`, maakt anders een **leerling-sessie**: aparte tabel `student_sessions` + apart cookie `student_sid` (HttpOnly/Strict/Secure) — strikt gescheiden van de leerkracht-sessie. `must_change_password` → de pagina toont meteen een **"nieuw wachtwoord"-stap** (`POST /api/student/change-password`, achter `requireStudentAuth`). Verder: `GET /api/student/me` en `POST /api/student/logout`. Nieuwe middleware `requireStudentAuth` vult `req.student = { id, name, email, status, mustChange }`.

**52b — startcode-UI.** In het klasbeheer (admin) toont elke klas nu haar startcode groot, met **open/dicht**-schakelaar en een **↻ nieuwe code**-knop. Beheerrecht via `magKlasBeheren` (admin of gekoppelde leerkracht). De leerling-instap (`student-start.html`) kreeg knoppen **Inloggen** / **Account aanmaken**.

**Bewust nog niet (deel 3):** de **afdwinging van de toegangsregel** (52e) in de live toets-socket — dat vergt dat de socket-deelname de ingelogde leerling-identiteit + status draagt, wat samenhangt met **id-gebaseerde deelname (52i)** en de **routing na login (52g)**. Ook **herstel door de leerkracht (52f)** en het **leerling-beheer aanvullen (52h)** zitten in deel 3. Deel 2 voegt dus accounts + login toe zonder de bestaande (naam-gebaseerde) sessie-instap te wijzigen; de `pending`-status bestaat al maar knijpt pas dicht in deel 3.

**Aanvaard restrisico (uit je ontwerp):** geen e-mailverificatie (52-x1 geparkeerd) — de grendel is klascode + schooldomein, met de leerkracht als herstelmechanisme.

*Test: `tests/validation.test.js`, sectie 52c — `isGeldigEmail` aanvaardt normale adressen, weigert onzin. Samen met de eerdere secties: 140 → alle groen. (De registratie/login-endpoints zelf vergen een DB en worden bij de isolatie-/e2e-testronde gedekt.)*

*Bestanden: lib/validation.js, db/database.js, server.js, public/student-register.html, public/student-login.html, public/student-start.html, public/admin.html, public/admin.js, tests/validation.test.js, sprintlog.md*

---

### Sprint 52 — Leerling-accounts, deel 3: afdwinging, herstel, routing, beheer *(52e-wiring + 52f + 52g + 52h + 52i-deels)* — ✅ AFGEROND (52i deels)

**Cat:** SEC/UX/ARCH. Sluit de leerling-cyclus: de toegangsregel bijt nu écht, en de leerkracht kan alles beheren.

**Socketidentiteit.** De bestaande `io.use`-middleware (die `socket.data.teacher` zet uit `teacher_sid`) resolvet nu óók `socket.data.student` uit het `student_sid`-cookie. Zo kent elke socket de échte, ingelogde leerling (id + status) — de basis voor 52e en 52i.

**52e — afdwinging.** In `quiz_start` staat nu de statuscontrole: bij voorkeur op de ingelogde identiteit (`socket.data.student`), anders op naam binnen de gekoppelde klas. `magLeerlingActiviteit(account, 'toets')` weigert `pending` en `blocked` met een duidelijke boodschap ("nog niet aanvaard … je kan wel vrij oefenen en aan een klassessie meedoen"). Preview-toetsen zijn vrijgesteld. Vinden we geen account, dan blijft de bestaande naam-flow ongemoeid — dit is puur een extra grendel.

**52f — herstel door de leerkracht.** Knop **🔑 Reset** in het leerlingbeheer → `POST /api/admin/students/:id/reset-password` zet `must_change_password`. De leerling herstelt daarna zélf via **`student-recover.html`** (klascode + e-mail + nieuw wachtwoord) → `POST /api/student/recover`. De pure regel **`magWachtwoordHerstel`** bewaakt de grendel: herstel kan **enkel** na een reset door de leerkracht (anders zou iemand die de klascode kent het wachtwoord van een klasgenoot kunnen overnemen), het e-mailadres moet bij de klas van de code horen, en een geblokkeerd account herstelt nooit. De foutmelding is bewust vaag (verklapt niet of e-mail of code fout was). De leerkracht kent of bewaart dus nooit een wachtwoord.

**52g — routing na login.** De instappagina (`student-start.html`) haalt `GET /api/student/me` op: is de leerling ingelogd, dan wordt de naam vooringevuld, verschijnt een statusbanner (aanvaard / nog niet aanvaard) met een uitlog-link, en bij `pending` een uitleg dat toets/taak nog niet kan. De sessiecode-routing naar een toets/taak liep al via `redirect_to_quiz`.

**52h — leerlingbeheer.** In de admin-leerlinglijst staat nu een **e-mail**-kolom, een **✏️ Bewerken**-knop (voornaam/achternaam/e-mail via `PUT /api/admin/students/:id/identity`, met dubbel-adres-check) en de reset-knop. Aanvaarden/blokkeren/klas/notitie/verwijderen bestonden al; aanvaarden buiten een live sessie werkt via de bestaande statusknop.

**52i — deels.** Een ingelogde leerling die een toets start, krijgt zijn account-`id` op de deelname (`dbStudentId = socket.data.student.id`). De **volledige** overstap van naam- naar id-sleutel in de antwoordopslag (`quiz_answers`, en de matching in 43.1/43.4) is een grotere, risicovolle refactor die ik **bewust heb uitgesteld** tot je end-to-end kan testen — nu zou dat blind gebeuren. De naam-gebaseerde matching blijft intact, dus niets breekt; de id-koppeling is een eerste, veilige stap.

*Test: `tests/auth.test.js`, sectie 52f — `magWachtwoordHerstel` (enkel na reset; e-mail moet bij klas horen; geblokkeerd nooit; geen student nooit). Samen: 144 → alle groen. De socket-/endpoint-flows vergen een DB en horen bij de isolatie-/e2e-testronde.*

*Bestanden: lib/auth.js, db/database.js, server.js, public/student-recover.html, public/student-login.html, public/student-start.html, public/admin.html, public/admin.js, tests/auth.test.js, sprintlog.md*

---

### Sprint 52 — Leerling-accounts, deel 4: id-gebaseerde toets-deelname (52i volledig) — ✅ AFGEROND

**Cat:** ARCH. Maakt 52i volledig af, nu bewust nadat de rest van 52 er stond.

**Kern.** Tot nu kreeg elke toets-deelname een **sessie-gebonden willekeurige UUID** als `student_id`; alle kruisverwijzing liep op **naam** (fragiel bij dubbele namen of een naamcorrectie, en een deelname ging verloren bij een serverherstart). Nu bepaalt **één centrale resolver** `bepaalToetsDeelnameId(socket, code, naam, klas)` de id:
1. **Ingelogde leerling** → zijn échte `students.id`. Stabiel over een herstart heen (zijn antwoorden en persoonlijke vraagvolgorde worden dan gewoon hervat) en robuust bij dubbele namen.
2. **Gast** (niet ingelogd) → een sessie-gebonden id, maar met **ondubbelzinnige hervatting**: bestaat er in `quiz_answers` precies één deelname met die naam+klas, dan wordt die id hergebruikt; anders een nieuwe. We leiden **bewust géén account-id af uit een niet-geverifieerde getypte naam** — dat zou het accountsysteem ondermijnen.

Omdat vrijwel alles al op de in-memory `student.id` sleutelde (`quiz_answers`, `quiz_student_order`, `quiz_run_history`, `quiz_general_comments`), volgt de rest vanzelf uit dat ene beslispunt. De **persoonlijke vraagvolgorde** wordt bij hervatting **hergebruikt** (geen nieuwe hussel) i.p.v. overschreven. De **43.4-selectiecheck** is voor ingelogde leerlingen nu **id-gebaseerd** (`allowedIds.includes(socket.data.student.id)`), met de naam-match als terugval voor gasten.

**Waarom nu veilig.** Het grootste risico van deze refactor — gemengde sleutels in bestaande `quiz_answers`-data — is er niet, omdat je van een lege database vertrekt. De gasten-terugval voorkomt dat code ooit aanneemt dat `student_id` altijd een account is. `student_name`/`student_class` blijven de bevroren weergave-momentopname, dus verbeter-/exportschermen tonen ongewijzigd de naam.

**Restpunt (bewust).** De verbeter-/plagiaat-/exportgroepering sorteert nog op `student_name`; dat blijft correct (naam = weergave) en hoeft niet naar id tenzij je ooit historische resultaten live aan gewijzigde namen wil koppelen. Geen nieuwe DB-wijziging nodig.

*Test: pure regels ongewijzigd groen (144). De socketflow (id-toewijzing, hervatting, selectie) vergt een draaiende server + DB en hoort bij je end-to-end testronde — start een toets als ingelogde leerling, herstart de server, en herverbind: antwoorden en volgorde blijven.*

*Bestanden: server.js, db/database.js, sprintlog.md*

---

### Sprint 53d — Admin-takedown van gedeelde bibliotheekitems ("openbaar → verbergen") — ✅ AFGEROND

**Cat:** SEC · **Prio:** 🟡 P6 · Rondt het Bibliotheek-blok (51c) af.

**Wat.** Een admin kan een gedeeld (publiek of school-breed) sjabloon of vraag **verbergen** — een moderatie-takedown, los van de zichtbaarheidskeuze van de eigenaar. Een nieuwe `hidden BOOLEAN DEFAULT false` op `question_bank` én `assignment_templates` (additief + idempotent). Bewust géén `share_scope = private` als mechanisme: dan zou de eigenaar het meteen opnieuw publiek kunnen zetten. De `hidden`-vlag is een aparte override die enkel een admin terugdraait.

**Zichtbaarheid.** `listSharedQuestions` en `listTemplates` kregen `AND (NOT hidden OR eigenaar OR admin)`: een verborgen item verdwijnt onmiddellijk uit de Bibliotheek voor alle andere leerkrachten, maar blijft zichtbaar voor de **eigenaar** (die ziet dat het weg is) en voor een **admin** (die het kan terugzetten).

**Backend.** Admin-only endpoints `PUT /api/library/questions/:id/hidden` en `PUT /api/library/templates/:id/hidden` (`{ hidden }`), met `magBibliotheekModereren`-guard (pure regel: enkel `role === 'admin'`; wordt bij Fase 3 / 48c4 verfijnd naar de super-admin voor cross-school takedown) en een audit-log-regel. De library-lijsten geven nu `canModerate` + per item `hidden` mee. DB: `setQuestionHidden`, `setTemplateHidden`.

**Frontend.** In de Bibliotheek zien admins per kaart een **🚫 Verbergen / 👁 Zichtbaar maken**-knop; verborgen items dragen een **🚫 Verborgen**-badge.

*Test: `tests/auth.test.js`, sectie 53d — admin mag modereren, gewone leerkracht en niet-ingelogd niet. 147 → alle groen. (De zichtbaarheidsfilter zelf is SQL en hoort bij de e2e-/isolatietestronde.)*

*Bestanden: lib/auth.js, db/database.js, server.js, public/sjablonen.js, tests/auth.test.js, sprintlog.md*

---

### Sprint 48c1 — Fase 3, deel 1: `school_id` op de kern-datatabellen + migratie — ✅ AFGEROND

**Cat:** ARCH · **Prio:** 🔵 P9 · Eerste steen van de multi-tenant-afdwinging. Bewust **enkel schema + migratie**; het echte scopen van elke lees/schrijf volgt in 48c2.

**Wat.** Een NULLbare `school_id TEXT REFERENCES schools(id) ON DELETE SET NULL` op **`classes`, `students`, `question_bank`, `sessions`, `audit_log`**, met een index per tabel. Additief en idempotent (`duplicate_column`-patroon) → bestaande installaties breken niet. `ON DELETE SET NULL` i.p.v. `CASCADE`: een school verwijderen mag **nooit** data vernietigen (conform het DB-beleid), het maakt de rijen enkel school-loos.

**Bewuste afwijking van de plantekst.** De oorspronkelijke rij noemde ook `teachers.school_id`. Maar leerkrachten hangen al aan scholen via de bestaande **M:N-tabel `teacher_schools`** (+ `active_school_id` op de sessie). Eén enkele `teachers.school_id` zou dat model tegenspreken (een leerkracht kan aan meerdere scholen lesgeven). Daarom **geen kolom op teachers**, maar een backfill van `teacher_schools`. (Zeg het als je tóch een primaire-school-kolom wil.)

**Migratie ("→ school 1").** Enkel wanneer er **precies één school** bestaat (de realistische single-school install) worden alle NULL-rijen aan die school gehangen en wordt elke leerkracht eraan gekoppeld. Bij **0 of meerdere** scholen blijft `school_id` bewust NULL — dan valt de juiste school niet eenduidig af te leiden en gokken we niet (DB-beleid). Idempotent: enkel NULL-rijen worden geraakt.

**Diagnose.** `getStandaardSchoolId()` (de ene school, of null bij ambiguïteit) en `schoolDekking()` (aantal NULL-rijen per tabel), plus admin-endpoint **`GET /api/admin/fase3/dekking`**. Na de migratie op een single-school install horen alle tellers **0** te zijn — zo controleer je "alle bestaande data hangt aan school 1".

**Bewust nog niet (48c2):** nieuwe rijen krijgen nog géén `school_id` op de schrijfpaden, en er is nog géén filtering. Dat komt samen in 48c2 (RLS of `scopedQuery`), inclusief het invullen van `school_id` bij aanmaak vanuit de actieve school van de leerkracht. Zo blijft dit deel puur schema/migratie en breekt het niets aan de huidige werking.

*Test: geen pure logica toegevoegd, dus de suite blijft 147 groen. Verificatie van de migratie gebeurt op een echte DB via `/api/admin/fase3/dekking` (alle tellers 0 op single-school) — hoort bij je e2e-/isolatietestronde (48c3).*

*Bestanden: db/database.js, server.js, sprintlog.md*

---

### Sprint 48c2 — Fase 3, deel 2: school-scoping op schrijven én lezen — ✅ AFGEROND

**Cat:** SEC · **Prio:** 🔵 P9 · De eigenlijke multi-tenant-afdwinging, in twee helften gebouwd.

**Keuze: applicatielaag, niet (nog) RLS.** De plantekst noemde PostgreSQL Row-Level Security als aanrader. Gekozen voor scoping in de applicatielaag omdat (1) de regel dan één pure, unit-testbare functie is (`magRijVanSchoolZien`) met een letterlijke SQL-spiegel, (2) er geen sessie-variabele-machinerie (`SET app.school_id`) door de pool moet, en (3) RLS er later **bovenop** kan als tweede verdedigingslinie zonder iets te herbouwen. Dat staat genoteerd als optionele verharding bij go-live.

**Deel a — schrijven (tenant vastzetten bij aanmaak).** Helper `schrijfSchoolVoor(teacher)` = de actieve school van de sessie. Toegepast op: `createClass` (3e parameter), `createQuizQuestion` (`schoolId`), alle **vier** sessie-aanmaakpunten (toets maken, toets dupliceren, sjabloon materialiseren, klassessie via socket) → `session.schoolId`, gepersisteerd in `sessions.school_id` en (net als `teacher_id`) **niet** herzien in de ON-CONFLICT-update: de tenant ligt vast bij aanmaak. Leerlingen **erven de school van hun klas** (`createStudent` + `createStudentAccount` lezen `classes.school_id`) — de klas is de bron van waarheid, niet de leerkracht die toevallig aanmaakt. `auditLog` kreeg een optionele `schoolId`. `loadActiveSessions`/`loadClosedSessions` geven `schoolId` mee terug zodat her-persist en lijstfilters hem niet verliezen.

**Deel b — lezen (één regel, overal identiek).** Pure regel `magRijVanSchoolZien(actieveSchoolId, rijSchoolId)`: rij zonder school → zichtbaar (legacy breekt nooit); geen actieve school → geen filtering (0 scholen, of single-school zonder keuze; bij >1 school dwingt de login al een schoolkeuze af); anders enkel de actieve school. De SQL-spiegel `(x.school_id IS NULL OR $n::text IS NULL OR x.school_id = $n)` staat op: **`listClassesVisibleTo`** (beide takken — óók de admin volgt de actieve school; de cross-school super-admin is 48c4), **`listStudents`** (enkel de alle-leerlingen-tak; een specifieke klas ís al de scope), **`listQuizBank`**, **`getAuditLog`**, en de **in-memory sessielijst** (`/api/sessions`, actief + gesloten) via de pure regel zelf. De **Bibliotheek (51c) blijft bewust ongewijzigd**: dat is de enige plek met legitiem cross-school lezen (publiek/school-gedeeld), precies de uitzondering die de plantekst eiste.

**Wat bewust niet gescoped is:** de leerling-dropdown (`/api/classes`, publiek — een leerling moet zijn klas kunnen kiezen), klasnaam-lookups binnen een gegeven klas/sessie (de klas is daar al de scope), en detail-op-id-endpoints (die volgen eigenaarschap/51-regels; blinde id-gokken over scholen heen levert geen lijstlek op). 48c3 (isolatietests op een echte DB, school A ziet nul rijen van school B) is de geplande verificatie hiervan.

*Test: `tests/auth.test.js`, sectie 48c2b — eigen school zichtbaar, andere school niet, legacy-rij altijd, geen actieve school → geen filtering. 151 → alle groen.*

*Bestanden: lib/auth.js, db/database.js, server.js, tests/auth.test.js, sprintlog.md*

---

### Sprint 48c3 — Fase 3, deel 3: isolatie-testsuite tegen een échte PostgreSQL — ✅ AFGEROND

**Cat:** SEC · **Prio:** 🔵 P9 · De verificatie van 48c1+48c2 — en meteen de zwaarste testinspanning van het project, zoals gepland.

**Wat.** Nieuwe suite **`tests/isolatie.test.js`**: géén mocks maar integratietests tegen een echte PostgreSQL. De suite draait het volledige schema (`db.init()`, incl. de 48c1-migratie), zet **school A + school B** op met elk een leerkracht, en bewijst per domein dat A **nul** rijen van B ziet: **klassen** (ook als admin — de actieve school blijft de scope tot 48c4), **leerlingen** (én dat een leerling de school van zijn klas **erft**), **vragenbank** (met de legacy-regel: een school-loze vraag blijft zichtbaar), **sessies** (schoolId overleeft persist→load), **auditlog**. Plus het uitzonderingspad: in de **Bibliotheek** kruist een públieke vraag wél de schoolgrens (de enige bedoelde uitzondering), een privévraag niet, en een **53d-takedown (hidden) wint van publiek**. Tot slot de 48c1-diagnose: `schoolDekking` telt school-loze rijen, `getStandaardSchoolId` is null bij twee scholen.

**Draaien.** `DATABASE_URL=postgres://…/testdb node --test tests/isolatie.test.js` tegen een **lege testdatabank** (nooit prod — de suite maakt testdata met prefix `isotest-` aan en ruimt die bij de start op). Zonder `DATABASE_URL` **skipt** de suite zichzelf (7 skipped), zodat `npm test` ook zonder databank groen blijft.

**Al bewezen.** De suite is tijdens de bouw tegen een echte PostgreSQL 16 gedraaid: **7/7 groen, twee keer na elkaar** (herhaalbaarheid aangetoond). De eerste run ving twee echte lessen in de suite zelf: opruimen moet ook rijen met random-UUID-ids raken (via naam/tekst/actie-prefix), omdat het wissen van de testscholen achterblijvers via `ON DELETE SET NULL` school-loos — en dus per ontwerp weer zichtbaar — maakt. Precies het legacy-gedrag van 48c2, nu ook door de tests zelf gerespecteerd.

*Test: 7/7 integratie (met DB) + 151 pure — alle groen.*

*Bestanden: tests/isolatie.test.js, sprintlog.md*

---

### Sprint 48c4 — Fase 3, sluitstuk: de super-admin — ✅ AFGEROND (Fase 3 compleet)

**Cat:** ARCH · **Prio:** 🔵 P9 · De hosting-beheerder (jij als leverancier) versus de school-admin.

**Model.** Nieuwe rolwaarde **`superadmin`** naast `teacher`/`admin` (`isValidRole` uitgebreid). Drie pure regels: `isSuperAdmin`, `isBeheerder` (admin óf superadmin — overal waar "admin" volstond telt de super-admin nu mee: `magKlasZien`, de `isAdmin`-vlaggen van klassenlijst en Bibliotheek, `magBibliotheekModereren` → **cross-school takedown**, precies de verfijning die bij 53d was aangekondigd), en **`leesScopeVoor(teacher)`**: een super-admin krijgt leesscope **null** — hetzelfde mechanisme als "geen actieve school", dus álle bestaande SQL-spiegels en `magRijVanSchoolZien` werken ongewijzigd en er hoefde geen enkele query herschreven te worden. De zes 48c2b-callsites gebruiken nu `leesScopeVoor(...)`.

**Rolbeheer beveiligd.** `PUT /api/admin/teachers/:username/role` kreeg (eindelijk) een beheerder-guard, en de superadmin-rol zelf kent een strengere regel: enkel een super-admin kan hem **toekennen of afnemen** — met één bootstrap-uitzondering: zolang er nog géén super-admin bestaat (`heeftSuperAdmin()`), mag een admin de eerste aanstellen. Zo raak je nooit op slot én kan een school-admin zichzelf niet stilletjes promoveren zodra de hosting-rol vergeven is.

**UI.** In het leerkrachtenbeheer: paars **★ Super-admin**-badge en een rol-cyclus leerkracht → admin → super-admin → leerkracht (de server bewaakt de superadmin-overgangen).

*Test: pure secties 48c4 (rolherkenning, beheerder-hiërarchie, leesscope null, moderatie/klaszicht) → 154 groen; isolatiesuite uitgebreid met "superadmin ziet klassen van beide scholen" → 8/8 groen tegen echte PostgreSQL. `isValidRole`-test aangepast (superadmin is nu geldig).*

*Bestanden: lib/auth.js, lib/validation.js, db/database.js, server.js, public/admin.js, tests/auth.test.js, tests/validation.test.js, tests/isolatie.test.js, sprintlog.md*

---

### Sprint 54 — Testdatabase-seeder (`pycodeflow.sh` optie 21) — ✅ AFGEROND

**Cat:** DX · **Prio:** 🟢 P4 · Bewust ná de laatste schemawijziging (Fase 3) gebouwd, zodat de seed het definitieve schema weerspiegelt.

**Wat.** Nieuw script **`web/scripts/seed-testdb.js`** (zelfde patroon als `manage-teacher.js`: draait in de web-container, identiek scrypt-hashformaat) met drie commando's: **seed** (idempotent — alle inserts `ON CONFLICT DO NOTHING`, snapshots enkel als de toets nog niet bestaat), **wipe** (verwijdert uitsluitend gemarkeerde rijen) en **status**. Alle testrijen zijn drievoudig gemarkeerd: id-prefix `testdata-`, sessiecodes `TD…`, zichtbare namen `TESTDATA …`.

**Inhoud van de seed.** 2 scholen · 4 leerkrachten — `superadmin`, `leerkrachtA` (admin school A), `leerkrachtA2`, `leerkrachtB` (admin school B), wachtwoord = gebruikersnaam · 3 klassen met **actieve startcodes** (TDKLAS5A/6A/5B, dus zelfregistratie meteen testbaar) · 6 leerlingen die alle statussen dekken (actief account, **pending**, **geblokkeerd**, zonder account) mét klas-lidmaatschappen en geërfde school · vragenbank met privé/school/publiek én **één 53d-verborgen** vraag · 3 sjablonen (school + publiek, gekoppelde vragen) · een klassessie, een **toets met ingevulde antwoorden, scores en commentaar** (deelname op échte `students.id`, conform 52i) en een taak. Verbeter-, export- en Bibliotheekschermen hebben dus meteen data.

**pycodeflow.sh.** Menu-optie **21 🧬 Testdatabase (seed / wis)** met een submenu, een grote ENKEL-VOOR-TEST-waarschuwing, en typbevestiging (`SEED` resp. `WIS`) vóór er iets gebeurt — de drempel tegen een verstrooide productie-run.

**Bewezen tijdens de bouw** tegen een echte PostgreSQL 16: seed → status (2/4/3/6/7/3/6) → **tweede seed levert identieke tellingen** (idempotent) → wipe → alles 0 → her-seed. Plus een spot-check dat de geseedete data de Fase-3-isolatie respecteert: leerkrachtA (scope A) ziet 0 B-klassen en 0 B-vragen; de superadmin ziet alle 3 de klassen; het studentA-account heeft een geldige login-hash.

*Bestanden: web/scripts/seed-testdb.js (nieuw), pycodeflow.sh, sprintlog.md*

---

### Sprint 55 — Beheer-RBAC, groepering per school en zoekvelden — ✅ AFGEROND

**Cat:** SEC/UX · Rechtstreekse testfeedback: het beheerscherm was met multi-school data onbruikbaar en de rechten klopten niet.

**Toegangsmodel.** Pure regels + afdwinging op twee lagen (nav verbergen = comfort, server = de echte grens): **leerkracht** ziet Beheer noch Systeem (pagina's redirecten, API's → 403) — zijn lesgereedschap blijft: de 43.4-leerlinglijst per klas (`?classId=`) en aanvaarden/blokkeren/klas/notitie vanuit de les. **Admin** ziet Beheer gescoped op ál zijn scholen, géén Systeem (serverlogs/db-viewer/stresstest = hosting-terrein). **Super-admin** ziet alles. Open modus (geen login) behoudt alles. Middlewares `requireBeheer`/`requireSysteem` op /admin.html, /monitoring.html en ±20 API's; `/api/me` geeft `magBeheer`/`magSysteem` mee en `nav-rechten.js` (op 12 pagina's) verbergt de links + autocheck-badge.

**Groepering.** Leerkrachten: per school (leerkracht met 2 scholen staat in beide groepen; zonder school → aparte groep); admin ziet enkel leerkrachten waarmee hij ≥1 school deelt. Klassen: per school, admin over ál zijn scholen (niet enkel de actieve — beheer ≠ lesgeven). Leerlingen: per **school → klas** (één rij per lidmaatschap; 'Zonder klas'/'Zonder school' apart), via nieuwe `listClassesBeheer`/`listStudentsBeheer` (school-loze rijen blijven zichtbaar).

**Zoekvelden** per tab (client-side, JS-geïnjecteerd boven de tabel): leerkrachten op naam/gebruikersnaam/school, klassen op naam/jaar/school, leerlingen op naam/e-mail/klas/school.

**Rollen.** `magRolToekennen`: super-admin → alles; admin → enkel teacher↔admin, enkel binnen een **gedeelde school** (`delenSchool`), en nooit een super-admin raken. De 48c4-bootstrap (admin stelt eerste super-admin aan) is **geschrapt** op expliciete vraag; de eerste super-admin komt via de CLI: `manage-teacher.js add <naam> <ww> superadmin` (CLI aangepast). De UI toont per bevoegdheid de juiste knoppen; de server weigert de rest (403).

*Test: pure secties 55 (Beheer/Systeem-zicht, roltoekenning incl. gedeelde-school-eis) → 159 groen; isolatiesuite onveranderd 8/8. Testdocument-tab 9 uitgebreid met de RBAC-, groeperings- en zoekpunten (168 punten).*

*Bestanden: lib/auth.js, db/database.js, server.js, scripts/manage-teacher.js, public/nav-rechten.js (nieuw), public/admin.js, 12× html (navscript), tests/auth.test.js, testdocument-html/testpunten.js, sprintlog.md*

---

### Sprint 56 — "Mijn klassen": de klasleerkracht krijgt zijn klassen terug — ✅ AFGEROND

**Cat:** UX/SEC · Rechtstreeks gevolg van sprint 55: klasbeheer verhuisde naar Beheer (admin-only), waardoor een gewone leerkracht zijn eigen klassen niet meer zag — en de startcode is nu net iets wat je *in de les* op het bord zet.

**Nieuw scherm `/mijn-klassen.html`** (nav-item 👥 op alle 11 leerkrachtpagina's), bewust **naast** Beheer: Beheer = admin over álle klassen van de school; Mijn klassen = lesgereedschap over enkel je **gekoppelde** klassen (`teacher_classes`, niet-gearchiveerd). Per klas één kaart met (1) de **startcode** groot — klikken opent bord-formaat met de registratie-URL — plus 🟢/⚪ open-dicht en ↻ nieuwe code; (2) **wachtende leerlingen bovenaan** in een geel blok met teller en ✓ Aanvaarden; (3) de klaslijst met blokkeren/deblokkeren, 🔑 reset en "+ Leerling toevoegen". Data via één endpoint `GET /api/mijn-klassen`.

**Rechten aangescherpt.** Nieuwe pure regel `magLeerlingBeheren(teacher, inEigenKlas)` + `isStudentInTeachersClasses`: een leerkracht mag status/klas/notitie/reset enkel voor leerlingen in **zijn** klassen (voordien kon technisch elke leerkracht elke leerling van de school blokkeren — dat is nu dicht); een beheerder blijft school-breed. Toevoegen kan een leerkracht enkel aan een eigen klas. Verwijderen en naam/e-mail bewerken blijven Beheer. De startcode-endpoints zijn ont-gate'd van `requireBeheer` terug naar `magKlasBeheren` (gekoppelde leerkracht óf admin). De 🔑-reset keert daarmee terug naar het oorspronkelijke 52f-ontwerp: de **klas**leerkracht is het herstelmechanisme, niet de schooladmin.

**Bewust expliciet:** blokkeren geldt voor het **hele account** (de status staat op `students`, niet per klas) — de bevestigingsdialoog zegt dat nu letterlijk, zodat een leerkracht niet per ongeluk iemands toegang bij een collega afneemt. E-mail is zichtbaar in de klaslijst (nodig voor herstel en om dubbele namen te onderscheiden), maar blijft weg uit toetsen, exports en leerlingschermen.

**Randgeval:** klassen die een admin voor iemand anders aanmaakt, moeten nog aan die leerkracht **gekoppeld** worden (Beheer → 🏛), anders blijven ze onzichtbaar in Mijn klassen; zelf aangemaakte klassen koppelen automatisch (51e). Het lege-staat-scherm legt dat uit.

*Test: pure sectie 56 (eigen klas / andermans klas / beheerder / open modus) → 163 groen. Tegen echte PostgreSQL geverifieerd met de seed: leerkrachtA2 mag de leerling van zijn klas 6A wél en die van 5A niet. De seeder kreeg er `studentA7` (pending in klas 6A) bij zodat het aanvaarden-scenario meteen testbaar is. Testdocument: nieuw tabblad "9 · Mijn klassen" (183 punten).*

*Bestanden: lib/auth.js, db/database.js, server.js, public/mijn-klassen.html + mijn-klassen.js (nieuw), 11× html (nav), web/scripts/seed-testdb.js, tests/auth.test.js, testdocument-html/testpunten.js, sprintlog.md*

---

### Sprint 57 — Klas ↔ leerkracht koppelen: de ontbrekende schakel — ✅ AFGEROND

**Cat:** UX/SEC · Gevonden tijdens het testen: als admin/super-admin kon je **niet zien** welke leerkrachten aan een klas hingen, en ze ook niet toevoegen of verwijderen.

**Wat er mis was.** De endpoints `POST/DELETE /api/admin/classes/:id/teachers` bestonden al sinds de 48-reeks, maar werden door **geen enkel scherm** aangeroepen — er was nooit UI voor gebouwd. Daardoor was `teacher_classes` in de praktijk alleen te vullen door zélf een klas aan te maken (51e koppelt de maker automatisch). Een klas die een admin vóór een collega aanmaakte, kon die collega dus nooit bereiken — en sinds sprint 56 is die koppeling net de sleutel tot "Mijn klassen".

**Opgelost.** `listClassesBeheer` geeft nu per klas de gekoppelde leerkrachten mee (geaggregeerd in SQL). Beheer → Klassen toont een kolom **Leerkrachten** met badges, of een duidelijke **⚠ niemand gekoppeld** wanneer de klas nog van niemand is. De knop 🧑‍🏫 opent een modal met alle koppelbare leerkrachten (aanvinken = koppelen, uitvinken = loskoppelen); alleen de verschillen worden weggeschreven, zodat het audit-log leesbaar blijft.

**Rechten.** Nieuwe guard `magKoppelingBeheren`: super-admin (en open modus) mag alles; een admin enkel binnen zijn eigen scholen — de klas moet van een van zijn scholen zijn (of school-loos) én hij moet minstens één school delen met de leerkracht die hij koppelt. Zo kan hij geen leerkracht van een andere school in zijn klassen zetten, en evenmin zijn leerkrachten aan andermans klassen hangen. Beide acties worden gelogd (`class_teacher_linked` / `class_teacher_unlinked`).

*Test: tegen echte PostgreSQL geverifieerd — de drie geseedete klassen tonen hun leerkracht, koppelen van leerkrachtA2 aan klas 5A verschijnt meteen in de lijst en verdwijnt na ontkoppelen; `delenSchool` bevestigt dat admin A wél met leerkracht A2 en niet met leerkracht B mag koppelen. Pure suites onveranderd 163 groen, isolatie 8/8. Testdocument uitgebreid met vijf koppelpunten (188).*

*Bestanden: db/database.js, server.js, public/admin.js, public/admin.html, testdocument-html/testpunten.js, sprintlog.md*

---

### Sprint 58 — Schoolbranding op leerlingpagina's — ✅ AFGEROND

**Cat:** SEC/UX · Uit de testronde: op `/student` stond "TESTDATA School A" bovenaan, terwijl er nog geen leerling was ingelogd.

**Oorzaak.** `/api/school-info` bepaalde de branding uit het **`teacher_sid`-cookie**. De brandingfunctie in `app.js` draait op élke pagina die app.js laadt — dus ook op de leerlingpagina's. Op een gedeelde computer (leerkracht logde eerder in op dezelfde browser) kreeg de leerling zo de **actieve school van die leerkracht** te zien. Onlogisch (een toestel kan niet weten bij welke school een leerling hoort vóór hij inlogt) én een klein informatielek naar een publieke pagina.

**Opgelost.** `/api/school-info?rol=leerling` negeert de leerkracht-cookie volledig en kijkt enkel naar de **leerling-sessie**: is die leerling ingelogd, dan toont hij zijn **eigen** school (`students.school_id`); anders valt hij terug op de install-brede `.env`-naam (een bewuste keuze van de installatie, niet iemands sessie). `app.js` vraagt die modus op alle publieke/leerlingpagina's: `/`, `/index.html`, `/student`, `student-start`, `student-app`, `student-login`, `student-register`, `student-recover`, `quiz-student`, `free-editor`.

*Test: tegen echte PostgreSQL — studentA hangt aan school A en krijgt in leerling-modus "TESTDATA School A"; zonder leerling-sessie verschijnt er niets school-specifieks meer. Pure suites 163 groen.*

*Bestanden: server.js, public/app.js, testdocument-html/testpunten.js, sprintlog.md*

---

### Sprint 59 — Beheer: rolgrendels en een echte wachtwoord-modal — ✅ AFGEROND

**Cat:** SEC · Uit de testronde als admin (`leerkrachtA`).

**Het ernstigste punt was niet zichtbaar in de UI.** `PUT /api/admin/teachers/:username/password` had enkel `requireTeacherAuth` — géén beheerdersgrendel en géén controle op de doel-leerkracht. Elke ingelogde leerkracht kon dus via de API het wachtwoord van **eender wie** overschrijven, inclusief de super-admin, en werd daarmee de facto platformbeheerder. Nu: `requireBeheer` + een admin raakt enkel leerkrachten van zijn eigen school en **nooit** een super-admin (403). Dezelfde grendel staat op verwijderen.

**Super-admin uit de schooladmin-lijst.** De filter van sprint 55 hield leerkrachten over die ≥1 school delen — maar een super-admin is vaak aan álle scholen gekoppeld, dus die kwam er doorheen. Platformbeheer hoort niet in het schoolscherm: super-admins worden nu expliciet weggefilterd voor iedereen behalve een super-admin.

**Wachtwoord-modal.** De knop gebruikte een kale `prompt()` — geen huisstijl, en vooral: **geen bevestigingsveld**, dus één typfout sloot een collega buiten. Nu een PyCodeFlow-modal met wachtwoord + herhaling, inline validatie (≥8 tekens, moeten overeenkomen) en een duidelijke foutmelding; pas bij een geldige invoer wordt er iets opgeslagen.

*Test: pure suites 163 groen. Tegen de testdatabank bevestigd waaróm de super-admin zichtbaar was (hij is aan beide scholen gekoppeld, dus deelde hij school A met leerkrachtA).*

*Bestanden: server.js, public/admin.js, testdocument-html/testpunten.js, sprintlog.md*

---

### Sprint 60 — Beheer overzichtelijk + Scholen-tab per rol — ✅ AFGEROND

**Cat:** UX · Uit de testronde: met twee scholen werd het beheerscherm onwerkbaar, en de Scholen-tab toonde álles aan iedereen.

**Scholen-tab per rol.** `GET /api/admin/schools` is nu beheer-only én gefilterd: een admin ziet enkel de scholen waaraan hij gekoppeld is. Hij **bewerkt** hun gegevens (naam, logo, contact, 📧 e-maildomeinen) — dat is schoolwerk. **Platformwerk** blijft bij de super-admin: scholen aanmaken en verwijderen (`requirePlatform`), activeren/deactiveren en de licentie (server weigert die velden voor een schooladmin met 403). De domein-endpoints kregen naast de beheer-gate ook een eigen-school-controle, zodat admin A niet aan de domeinen van school B kan — wie de domeinen bepaalt, bepaalt immers wie zich kan registreren.

**Overzichtelijkheid.** Klassen en leerlingen staan in **inklapbare** schoolgroepen (bij leerlingen met een tweede niveau per klas); de in-/uitklapstand wordt lokaal onthouden, met knoppen om alles in één keer te openen of te sluiten. De groepskoppen tonen tellers en — belangrijk in de praktijk — een geel **"x wachtend"** zodat je meteen ziet waar leerlingen op aanvaarding wachten. Daarnaast een **klasfilter** en een **"enkel wachtend"**-schakelaar die samenwerken met het bestaande zoekveld.

**Leerlingen verplaatsen + bulk.** Het endpoint om een leerling van klas te wisselen bestond al maar had (net als bij 57) geen knop: nu **🔀 Klas** per leerling, met een modal die enkel niet-gearchiveerde klassen toont die jij mag beheren. Met vinkjes selecteer je meerdere leerlingen; de bulkbalk kan ze in één keer **aanvaarden, blokkeren of verplaatsen** — bij een klas die zich massaal registreert scheelt dat tientallen klikken. Blokkeren waarschuwt opnieuw expliciet dat het voor het hele account geldt.

*Test: pure suites 163 groen, isolatie 8/8. Tegen de testdatabank bevestigd dat admin A enkel "TESTDATA School A" ziet en dat de twee wachtende leerlingen (klas 5A en 6A) correct als 'wachtend' geteld worden.*

*Bestanden: server.js, public/admin.js, public/admin.html, testdocument-html/testpunten.js, sprintlog.md*

---

### Sprint 62 — Topbalk: wie ben ik, en in welke school werk ik? — ✅ AFGEROND

**Cat:** UX · Uit de testronde: op "Mijn klassen" stond *"Je bent nog aan geen enkele klas gekoppeld"* terwijl de topbalk **TESTDATA School A** toonde — dat leek tegenstrijdig.

**Wat er werkelijk aan de hand was.** Beide meldingen waren correct, maar onmogelijk te rijmen zonder te weten wie je bent. De tester was ingelogd als **superadmin**: die is (in de seed) aan **beide scholen** gekoppeld maar aan **geen enkele klas**. De naam in de balk was dus de **actieve school** van de sessie (gekozen bij het inloggen), geen uitspraak over klaskoppelingen. Omdat de balk enkel "Afmelden" bevatte, was er geen enkele aanwijzing over identiteit of rol.

**Opgelost.** De topbalk toont nu op alle leerkrachtpagina's: **"Ingelogd als &lt;naam&gt;"**, een **rolbadge** (Leerkracht / Admin / ★ Super-admin, met tooltip die de rol uitlegt) en de **actieve school** — met de tooltip dat dáárin nieuwe klassen, toetsen en vragen terechtkomen. Dat laatste is precies wat een super-admin moet weten: hij **leest** alles, maar **schrijft** in één school. Hangt hij aan meerdere scholen, dan is de schoolnaam klikbaar en opent een **wisselmodal** (via het bestaande, gescopede endpoint); daarna volgen alle lijsten mee. Zonder koppeling staat er eerlijk "🏛 geen school".

Alles zit in het bestaande `nav-rechten.js` (al op elke leerkrachtpagina aanwezig, haalde al `/api/me` op) — geen nieuw script om te onderhouden. `/api/me` geeft nu ook de scholen van de leerkracht mee. De lege staat van **Mijn klassen** benoemt nu expliciet het verschil tussen school en klas, verwijst naar *Beheer → Klassen → 🧑‍🏫*, en vertelt een beheerder dat het volledige klasoverzicht in Beheer staat.

*Test: pure suites 163 groen. Met de testdatabank bevestigd dat superadmin aan 2 scholen maar 0 klassen hangt (leerkrachtA/A2 elk 1 school + 1 klas) — precies het waargenomen gedrag.*

*Bestanden: server.js, public/nav-rechten.js, public/mijn-klassen.js, testdocument-html/testpunten.js, sprintlog.md*

---

### Sprint 63 — Dubbele voettekst + inklappen van schoolgroepen — ✅ AFGEROND

**Cat:** BUG · Twee bevindingen uit de testronde.

**Dubbele voettekst op `/`.** `injectFooter()` in `app.js` voegt onderaan elke pagina een versieregel toe en sloeg dat over als er al een `.footer-note` stond. Maar de startpagina heeft een **eigen `<footer>`-element** met de server-side ingevulde `{{APP_VERSION}}` (sprint 45) — zonder die klasse. Gevolg: twee regels onder elkaar. De guard kijkt nu ook naar een bestaand `<footer>`.

**Inklappen liet leerlingen staan.** Een leerlingrij hoort tot **twee** groepen: haar school én haar klas. De oude `klapGroep` verborg enkel rijen waarvan `data-groep` exact overeenkwam, dus bij het inklappen van een school verdwenen de klaskoppen (die hangen aan de schoolsleutel) maar bleven de leerlingrijen staan (die hangen aan de klassleutel). Opgelost met **`pasKlapToe()`**, dat na elke klik de zichtbaarheid van álle rijen herrekent: een rij is verborgen zodra **één** van haar groepen ingeklapt is. De schoolkop zelf draagt bewust geen groepssleutel, zodat je altijd kan heropenen; en een afzonderlijk ingeklapte klas onthoudt zijn eigen stand wanneer je de school weer opent. Dezelfde functie draait na elk hertekenen (zoeken, filteren, bulkactie), zodat de stand niet verspringt.

*Test: de klaplogica is met een nagebootste DOM doorgerekend — school dicht → klaskop en beide leerlingen verborgen, schoolkop zichtbaar; enkel klas 5A dicht → alleen die leerling weg; school heropenen → klas 5A blijft dicht. Pure suites 163 groen.*

*Bestanden: public/app.js, public/admin.js, testdocument-html/testpunten.js, sprintlog.md*

---

### Sprint 64 — Schoollogo's naar de databank — ✅ AFGEROND

**Cat:** ARCH · Vraag uit de testronde: waar staan de logo's eigenlijk?

**Hoe het was.** `schools.logo_path` bewaarde een **absoluut pad op de server**, en `/school-logo` las dat bestand van de schijf. Uploaden bestond niet — je typte een pad in een tekstveld. Drie problemen: het logo zat **niet in de back-up** (`backup-db.sh` dumpt enkel de databank), het **overleefde geen rebuild** tenzij het pad toevallig in een gemount volume lag, en een **schooladmin kon er niets mee** (hij heeft geen bestandstoegang tot de container) — terwijl sprint 60 hem net dat recht gaf.

**Hoe het nu is.** Nieuwe kolommen `logo_blob BYTEA` + `logo_mime` + `logo_updated_at` (additief, idempotent). In Beheer → Scholen zit een knop **🖼 Logo**: je kiest een bestand op je eigen computer, ziet meteen een voorbeeld, en uploadt. De browser stuurt het als base64; de server bewaart de ruwe bytes.

**Grendels.** Toegelaten zijn **PNG, JPEG en WebP**; **SVG wordt geweigerd** omdat dat JavaScript kan bevatten en op ons eigen domein zou worden uitgeserveerd (XSS). De controle gebeurt op de **magic bytes** van de inhoud, niet op de extensie of de meegestuurde mimetype — een hernoemd tekstbestand komt er dus niet door. De maximumgrootte staat in `.env` als **`SCHOOL_LOGO_MAX_KB`** (standaard 512). De globale JSON-limiet blijft bewust 64 kB: enkel deze ene route krijgt een ruimere parser (base64 is ~33% groter, plus marge). Rechten volgen sprint 60: een admin enkel zijn eigen school, en elke wijziging komt in het audit-log.

**Prestatie-detail.** `getSchool()` deed `SELECT *` en zou de afbeelding dus bij **elke paginalading** meeslepen (de topbalk vraagt de schoolinfo op). Die query haalt nu enkel een vlag `heeft_logo` op; de bytes komen alleen via `/school-logo`, met **ETag** op `logo_updated_at` en `Cache-Control`, zodat browsers cachen maar een nieuw logo meteen zien.

*Test: tegen echte PostgreSQL een PNG opgeslagen en teruggelezen — 75 bytes, bit-voor-bit identiek, vlaggen en `updated_at` correct, `getSchool` sleept de blob niet mee, verwijderen werkt. De magic-byte-herkenning is apart doorgerekend: PNG/JPEG/WebP aanvaard; SVG, SVG-met-BOM, een hernoemd tekstbestand en een leeg bestand geweigerd.*

*Bestanden: db/database.js, server.js, public/admin.js, .env, .env.example, testdocument-html/testpunten.js, sprintlog.md*

---

### Sprint 65 — Startfout uit 49.5 + de Monaco-worker-warning (43.13) — ✅ AFGEROND

**Cat:** BUG · Twee zaken, gevonden door de server voor het eerst écht op te starten.

**(a) v2026.2.49.5 startte niet op.** De twee logo-endpoints van sprint 64 zijn per ongeluk ingevoegd vóór `const app = express()` (regel 235 versus 455), omdat het ankerpunt waarop ik ze plaatste — de helper `magSchoolBeheren` uit sprint 60 — hoger in het bestand staat dan verwacht. `node --check` ziet dat niet (het is geen syntaxfout), maar bij het opstarten volgt meteen `ReferenceError: Cannot access 'app' before initialization`. De endpoints staan nu bij de andere school-endpoints. **Nieuwe test** (`tests/validation.test.js`, sectie 65) controleert statisch dat er nergens `app.use/get/post/...` staat vóór de aanmaak van `app` — deze klasse fouten kan nu niet meer ongemerkt meegaan.

**(b) 43.13 — "Could not create web worker(s)".** De warning bleef ondanks de fix van 43.6c, en de oorzaak was een **dubbele definitie**: naast het statische `public/monaco-env.js` bestond er nog een **serverroute** `app.get('/monaco-env.js')` uit sprint 12a-D. Die route stond op regel ~1505 geregistreerd, ruim vóór `express.static(public)` op regel ~4063 — en Express matcht op registratievolgorde, dus de route won en het statische bestand werd **nooit** uitgeserveerd. De route gaf bovendien worker-paden op uit de **ESM/webpack**-distributie (`vs/editor.worker.js`, `vs/language/typescript/ts.worker.js`), terwijl wij de **min/AMD**-build serveren waarin die bestanden niet bestaan → 404 op elke worker → terugval op de main-thread. Route verwijderd; het statische bestand (blob → `vs/base/worker/workerMain.js`) doet het correct en is CSP-conform (`worker-src 'self' blob:`).

*Test: de min-build van monaco-editor 0.47.0 opgehaald en geverifieerd dat `vs/editor.worker.js` en `ts.worker.js` er **niet** in zitten terwijl `vs/base/worker/workerMain.js` er **wel** is. Daarna de echte server opgestart tegen PostgreSQL: `/health` → 200, `/monaco-env.js` levert nu het 43.6c-bestand (geen ESM-paden meer), en `/monaco/min/vs/base/worker/workerMain.js` → 200. Suites: 164 groen.*

*Bestanden: server.js, tests/validation.test.js, testdocument-html/testpunten.js, sprintlog.md*

---

### Sprint 61 — Leerlingtelling & facturatiebasis — ✅ AFGEROND

**Cat:** FEAT · Jouw aanvraag: een fee per leerling vraagt om cijfers die je altijd kan raadplegen.

**Het probleem.** `students` bewaart enkel de **huidige** status. Zonder momentopnames is er dus geen historiek: je kan vandaag tellen, maar niet meer achterhalen hoeveel leerlingen er in maart aan school B hingen. Vandaar een aparte tabel.

**Wat er is.** `student_count_snapshots`: één rij per **maand × school × schooljaar**, met actief/wachtend/geblokkeerd/totaal. De telling loopt automatisch — bij het opstarten en daarna elke 6 uur — en werkt de rij van de **lopende** maand bij (upsert). Zo bevat elke afgesloten maand de stand zoals ze op het einde was, en blijft die daarna ongewijzigd. Een super-admin kan met **📌 Nu vastleggen** handmatig forceren, bijvoorbeeld vlak vóór het factureren.

**Bewuste keuze: de schoolnaam wordt bevroren** in elke telling. Een school kan later hernoemd of verwijderd worden (`ON DELETE SET NULL`), maar een factuur van vorig jaar moet blijven kloppen — dus de naam gaat mee de momentopname in.

**In Beheer** staat een nieuwe tab **💶 Leerlingtelling** met kaarten per school (het getal waarop je factureert), een tabel per school × schooljaar, de maandhistoriek en **CSV-export** (semikolon + BOM, dus Excel-NL toont accenten correct). Scoping volgt de rest: een admin ziet enkel zijn eigen scholen en heeft geen vastleg-knop; de super-admin ziet alles.

**Telregel:** een leerling telt per schooljaar waarin hij lid is van een klas; wie nergens lid is valt onder schooljaar "(geen)" zodat hij niet stilletjes uit de telling verdwijnt.

*Test: pure sectie 61 (`maandPeriode`: JJJJ-MM met voorloopnul, tekstsortering = chronologisch, ongeldige invoer → null) → 167 groen. Tegen echte PostgreSQL: de telling komt exact uit op de seed (School A 3 actief / 2 wachtend / 1 geblokkeerd = 6), tweemaal vastleggen geeft 4 rijen en geen 8 (idempotent), en de CSV-export levert kloppende kolommen met BOM.*

*Bestanden: db/database.js, lib/validation.js, server.js, public/admin.html, public/admin.js, tests/validation.test.js, testdocument-html/testpunten.js, sprintlog.md*

---

---

**Cat:** UX · **Prio:** 🟡 P6

**Wat bleek:** `/api/school-info` bestond al sinds sprint 19b, maar **niemand riep het aan**. De branding-hook was dode code — het logo werd nooit getoond.

**Wat is gebouwd:** het schoollogo (met naam) verschijnt naast het PyCodeFlow-merk in de topbalk, en **volgt de actieve school** uit de sessie.

**De server beslist, niet de client.** Dat is de kern van de opzet:

| Toestand | Resultaat |
|---|---|
| geen leerkracht-sessie | **niets** — startscherm, loginscherm en leerlingpagina's |
| sessie mét actieve school | het logo van **die** school |
| sessie zónder school | terugval op `.env` (installatie met één school) |

Zo hoefde er geen lijst van *"op welke pagina's wel"* bijgehouden te worden — precies zo'n lijst die je gegarandeerd ooit vergeet bij te werken. De eis *"niet op start- en loginscherm"* volgt vanzelf: daar is geen sessie.

**⚠️ Padcontrole toegevoegd op `/school-logo`.** Het logo-pad komt uit de databank en wordt door een beheerder **ingetypt**. Een pad als `../../etc/passwd` zou zomaar uitgeserveerd worden. Nu: enkel **absolute** paden, geen `..`, en enkel afbeeldingsextensies. Nagetrokken op acht paden — `/etc/passwd`, `/data/../etc/passwd.png` en relatieve paden worden allemaal geweigerd.

**Twee details die anders opvallen:**
- **Een kapot logo-pad** geeft geen gebroken-afbeelding-icoon: de afbeelding verwijdert zichzelf en enkel de naam blijft staan.
- **`monitoring.html` laadde `app.js` niet** en zou als enige pagina zonder logo staan. Vóór het toevoegen gecontroleerd op naamconflicten tussen `app.js` en `monitoring.js` (geen) en op page-blokken (geen). Nu dragen alle **14** pagina's met een topbalk de branding.

**Nog niet voor leerlingen.** Zij hebben nog geen login (52) en sessies hebben nog geen `school_id` (48c1), dus de app kan hun school niet kennen. Dat volgt vanzelf zodra die er zijn — de server-logica hoeft dan niet te wijzigen.

**Tests:** geen nieuwe unittests (branding + een endpoint). Wel de padcontrole apart nagetrokken op acht gevallen. Suite blijft **218/218 groen**.

---

### Sprint 48b2 — Het schoolkeuze-scherm *(~1 dag)* — ✅ AFGEROND (v2026.2.48.9)

**Cat:** UX · **Prio:** 🟠 P8 · *(jouw ontwerp, precies zoals beschreven)*

**Wat is gebouwd, exact volgens je ontwerp:**
- Werkt de leerkracht op **meerdere scholen**, dan verschijnt na het aanmelden een **extra grid met een dropdown** van *zijn* scholen.
- De **logingegevens worden grijs** — uitgeschakeld, niet verborgen, zodat je ziet met welk account je binnen bent.
- De knop "Aanmelden" verdwijnt en wordt **Annuleren** / **Kiezen**.
- Bij **1 school** verschijnt er niets: je gaat meteen door (48b1).

**De lijst komt pas ná een geslaagde login.** Dat zat al goed in je ontwerp en is bewust zo gebouwd: zolang je niet aangemeld bent, verklapt de app aan niemand welke scholen er bestaan.

**Annuleren meldt écht af.** Je *bent* aangemeld — enkel zonder school. Alleen het scherm verbergen zou een half-aangemelde toestand laten staan. Daarom gaat "Annuleren" naar `/api/teacher-logout`: de server trekt de sessie in, wist de cookies, en je komt terug op een schoon loginscherm.

**Het beveiligingspunt: de browser stuurt enkel een wens.** `POST /api/teacher-login/school` controleert **server-side** of die school wel aan deze leerkracht gekoppeld is — enkel actieve scholen tellen. Zonder die controle zou iedereen zich op eender welke school kunnen zetten, en dat is precies het lek dat fase 3 moet voorkomen. Een poging wordt gelogd met naam en al (dankzij 50e) en geeft **403**.

**De regel wanneer het scherm verschijnt** is nagespeeld op vijf gevallen: geen scholen → doorgaan · 1 school → doorgaan · 2 scholen zonder keuze → **tonen** · 2 scholen met er al één actief → doorgaan · geen sessie → doorgaan.

**Detail:** de `select` had nog geen styling (die bestond enkel voor `input`) en zou uit de loginkaart vallen. Meegenomen.

**Tests:** geen nieuwe unittests — dit is een scherm plus een endpoint met een databankcontrole. De keuzeregel zelf (`kiesActieveSchool`) is al getest in 48b1. Suite blijft **218/218 groen**. Checklist in `test-readme.md` §81.

---

### Sprint 48b1 — De actieve school in de sessie *(~0.5 dag)* — ✅ AFGEROND (v2026.2.48.8)

**Cat:** AUTH · **Prio:** 🟠 P8

**Wat is gebouwd:**
- **Kolom `active_school_id`** op `teacher_sessions` — **server-side**, precies zoals afgesproken: de browser mag nooit kunnen kiezen namens welke school hij werkt. Er is dus geen cookie of veld dat je kan omzetten.
- **De keuzeregel** `kiesActieveSchool()` als pure functie in `lib/validation.js`.
- **Bij het inloggen** wordt de school bepaald; `req.teacher` en `socket.data.teacher` dragen hem mee; `/api/me` toont hem.

**De regel:**

| Scholen | Gevolg |
|---|---|
| **0** | `null` — **dit is vandaag de normale toestand**, dus 48b1 breekt niets |
| **1** | meteen die school; geen keuzescherm voor een keuze die er niet is |
| **meerdere** | `null` — de leerkracht kiest zelf (48b2) |

**Een inactieve school telt niet mee**, ook niet als het je enige is: op een uitgeschakelde school hoor je niet te belanden. Er is een test die dat vastlegt.

**Drie keuzes die stille fouten voorkomen:**
- **`ON DELETE SET NULL`** op de verwijzing: verdwijnt de school, dan valt de sessie terug op "geen school" i.p.v. te breken op iets dat niet meer bestaat.
- **`LEFT JOIN` op scholen** bij het ophalen van de sessie: een sessie zonder actieve school is normaal en mag zeker niet uit het resultaat wegvallen — een `JOIN` zou je stilletjes uitloggen.
- **Scholen ophalen mag het inloggen niet tegenhouden.** Faalt dat, dan log je gewoon in zonder actieve school.

**De socket krijgt hem gratis mee**, want `io.use` (50f) gebruikt dezelfde `bepaalTeacherIdentiteit`. Dat heeft sprint 51 nodig.

**Tests:** 9 nieuwe (6 op de keuzeregel, 3 op de identiteit), waaronder *"een inactieve school telt niet mee"* en *"de actieve school komt uit de sessie, niet uit de browser"*. Suite: **218/218 groen** (was 209).

---

### Sprint 48a3 — E-maildomeinen per school *(~1 dag)* — ✅ AFGEROND (v2026.2.48.7)

**Cat:** ARCH · **Prio:** 🟠 P8 · *(eerste sprint van dit blok met echte pure logica — dus met echte tests)*

**Wat is gebouwd:**
- **Tabel `school_domains`** (`school_id`, `domain`). Domein is **altijd schoolniveau**, nooit klasniveau — een klas heeft geen eigen mailomgeving.
- **De regels als pure functies** in `lib/validation.js`: `domainMatches`, `valideerDomein`, `normaliseerDomein`, `domeinUitEmail`, `emailPastBijDomeinen`.
- **API** voor toevoegen/verwijderen/opvragen + het **testveldje**.
- **Knop 📧 Domeinen** per school: lijst, toevoegen, uitleg met ✓/✗-voorbeelden, en een **testveld** waar je een adres plakt en meteen ziet of het mag — én via welke regel.

**De kern: ankeren op het einde, nooit "bevat".** Een naïeve check op *"bevat athkiel.be"* laat `marie@athkiel.be.aanvaller.com` binnen. `*.athkiel.be` wordt daarom het achtervoegsel `.athkiel.be` **mét punt**, waardoor ook `nepathkiel.be` afvalt.

**Twee vormen, bewust verschillend:** `athkiel.be` = exact · `*.athkiel.be` = enkel subdomeinen, **niet** het kale domein. Wie beide wil, zet beide regels. Dat is strenger dan "de wildcard dekt ook het hoofddomein", maar **voorspelbaar**: je krijgt precies wat er staat.

**Bug gevonden door de eigen test.** Mijn eerste versie gaf bij `*.be` de melding *"Dat is geen geldig domein"* i.p.v. *"te breed"* — de volgorde van de controles klopte niet. `*.be` heeft namelijk een **geldige vorm**; het probleem is dat iedereen met een `.be`-adres zich dan bij die school kan registreren. Die verdient zijn eigen melding, anders zoekt de beheerder in de verkeerde richting. Volgorde omgedraaid; de test bewaakt het nu.

**Randgeval dat een leerling zou raken:** `marie@athkiel.be.` (met afsluitende punt) is technisch een geldig adres. Zonder normalisatie zou dat **niet** matchen en de leerling onterecht geweigerd worden. Wordt nu weggestript, net als hoofdletters en een `@` vooraan.

**Minstens één domein per school** wordt afgedwongen bij het verwijderen: zonder domein kan straks geen enkele leerling zich registreren (52c). Beter nu tegenhouden dan het later niet begrijpen.

**Waarom de match in JS gebeurt en niet in SQL:** de wildcard-regel (`*.athkiel.be` dekt niet `athkiel.be`) is met `LIKE` niet correct uit te drukken. `findSchoolByEmailDomain` haalt de regels op en vergelijkt in code — met dezelfde functie die getest is.

**Tests: 21 nieuwe** in `tests/validation.test.js`, waaronder de 8 gevallen uit testboek §64 en de kerntests *"athkiel.be.aanvaller.com wordt altijd geweigerd"*, *"nepathkiel.be wordt geweigerd (de punt telt)"* en *"`*.be` is te breed"*. Suite: **209/209 groen** (was 188).

---

### Sprint 48a2 — Leerkracht ↔ school koppelen *(~1 dag)* — ✅ AFGEROND (v2026.2.48.6)

**Cat:** ARCH · **Prio:** 🟠 P8

**Wat is gebouwd:**
- **Tabel `teacher_schools`** (veel-op-veel), gemodelleerd op het bestaande `teacher_classes`. Beide kanten **CASCADE**: verdwijnt de school óf de leerkracht, dan verdwijnt de koppeling mee — een koppeling zonder één van beide heeft geen betekenis.
- **DB-helpers** `linkTeacherSchool`, `unlinkTeacherSchool`, `getSchoolsForTeacher`, `getTeachersForSchool`.
- **API**: `POST/DELETE /api/admin/teachers/:id/schools[/:schoolId]` en `GET /api/admin/schools/:id/teachers`, met audit-log op koppelen en ontkoppelen.
- **Kolom "Scholen"** in het leerkrachtenbeheer + knop **🏛 Scholen** die een popup opent met **vinkjes** — zelfde patroon als je ontwerp voor de leerling-selectie.

**Dit is wat model B mogelijk maakt.** Een leerkracht op twee scholen krijgt straks een keuzescherm na het inloggen (48b2). Meteen ook de reden dat model A wegvalt: met een installatie per school zou diezelfde leerkracht twee losse omgevingen en twee logins hebben.

**Drie bewuste keuzes:**
- **`getSchoolsForTeacher` toont standaard enkel actieve scholen** — dit wordt de bron voor het keuzescherm, en je kan niet inloggen op een school die niet meer draait. Het beheerscherm vraagt expliciet óók de inactieve op, want een beheerder moet zien dát er een koppeling naar een uitgeschakelde school bestaat. Die staan **doorstreept** in de lijst.
- **Enkel de verschillen wegschrijven.** De popup vergelijkt met de begintoestand en stuurt alleen wat wijzigt, in plaats van alles te verwijderen en opnieuw aan te maken. Dat scheelt verzoeken en houdt het audit-log leesbaar. Nagetrokken op zes gevallen — inclusief "niets gewijzigd" (nul verzoeken).
- **Scholen zijn bijzaak in de lijst.** Faalt het ophalen ervan, dan blijft de leerkrachtenlijst gewoon werken — dat scherm mag niet stuklopen op een nevenfunctie.

**Nog steeds additief.** Er hangt nog niets aan een koppeling; 48b1/48b2 gaan ze pas gebruiken bij het inloggen.

**Tests:** geen nieuwe unittests (koppeltabel + UI, geen pure logica). Wel de diff-logica van de popup apart nagetrokken op zes gevallen. Suite blijft **188/188 groen**. Checklist in `test-readme.md` §78.

---

### Sprint 48a1 — Scholen: de tabel + het beheer *(~1 dag)* — ✅ AFGEROND (v2026.2.48.5)

**Cat:** ARCH · **Prio:** 🟠 P8 · *(eerste steen van het multi-tenant fundament — model B)*

**Volledig additief.** Er verwijst nog niets naar deze tabel, dus je bestaande installatie merkt hier niets van. 48a2 koppelt er leerkrachten aan, 48a3 hangt er e-maildomeinen onder, 48c1 zet `school_id` op de rest.

**Wat is gebouwd:**
- **Tabel `schools`** (`id`, `name`, `logo_path`, `license`, `contact`, `active`, `created_at`) met een **unieke index op de naam** (kleine letters). Twee scholen met dezelfde naam is altijd een vergissing — en bij de schoolkeuze (48b2) zou een leerkracht met twee identieke namen onmogelijk kunnen kiezen.
- **DB-helpers** `listSchools`, `getSchool`, `createSchool`, `updateSchool`, `deleteSchool`.
- **Admin-API** `GET/POST/PUT/DELETE /api/admin/schools`, met audit-log op aanmaken, wijzigen en verwijderen — dat werkt nu ook echt, dankzij 50e.
- **Nieuwe tab "🏛 Scholen"** in het beheerscherm: toevoegen, bewerken, **deactiveren/heractiveren**, verwijderen, en een schakelaar om inactieve te tonen.
- `schools` toegevoegd aan de **DB-viewer**.

**Deactiveren staat naast verwijderen.** Een school met geschiedenis wil je bewaren maar niet meer aanbieden bij de schoolkeuze. De verwijder-bevestiging zegt dat er ook bij, zodat niemand per ongeluk een jaar aan data weggooit.

**`updateSchool` wijzigt enkel de meegegeven velden**, zodat een scherm één veld kan aanpassen zonder de rest per ongeluk leeg te maken. De kolomnamen komen daarbij uit een **vaste lijst** — nooit uit de invoer — en waarden blijven parameters. Nagetrokken met kwaadaardige invoer: die belandt als parameter, en onbekende velden worden genegeerd.

**Eigen valkuil opgemerkt en meteen gefixt:** ik zette de schoolnaam eerst rechtstreeks in een `onclick`. Een school als *"Sint-Jan's College"* zou de attribuut-quotes breken — exact dezelfde fout die ik in 43.2 al eens maakte. Nu gaat enkel het `id` mee en komt de naam uit een cache.

**Leesbare fouten:** de unieke index geeft anders een ruwe databankfout; die wordt vertaald naar *"Er bestaat al een school met die naam."*

**Tests:** geen nieuwe unittests — dit is CRUD op de databank, geen pure logica. Wel de dynamische `UPDATE` apart nagetrokken op SQL-injectie (zie hierboven). Suite blijft **188/188 groen**. Handmatige checklist in `test-readme.md` §77.

---

### Sprint 50f — 🎉 Fase 1 af: het gedeelde cookie is weg *(~1 dag)* — ✅ AFGEROND (v2026.2.48.4)

**Cat:** AUTH · **Prio:** 🔴 P10 · *(het afscheidsmoment — vanaf nu weet de app altijd wie er werkt)*

**Verwijderd:** `teacherCookieValue()`, `hasValidTeacherCookie()`, `setTeacherCookie()`, de `.env`-login in `authenticateTeacher()`, en de `legacy`-tak in `bepaalTeacherIdentiteit()`. Toegang loopt nu **uitsluitend** via `teacher_sessions`.

**De socket-kant — de grootste hap.** `socketIsTeacherAuthorized()` gebruikte het gedeelde cookie en wordt door **30 handlers** synchroon aangeroepen. Die allemaal async maken zou een enorme, riskante wijziging zijn. In plaats daarvan bepaalt een **`io.use`-middleware** de identiteit **één keer per verbinding** en zet ze op `socket.data.teacher`. `socketIsTeacherAuthorized()` blijft synchroon en **geen enkele van de 30 handlers wijzigt**. Bonus: de socket weet nu **wie** de leerkracht is — dat heeft sprint 51 (eigenaarschap) nodig.
> *Nuance:* de identiteit wordt bepaald bij het openen van de verbinding. Verloopt de sessie terwijl de socket openstaat, dan blijft die socket geldig tot hij sluit. Aanvaardbaar — een socket ís een lopende sessie — en bij elke paginaverversing wordt opnieuw gecontroleerd.

**Waarom de `.env`-login veilig weg kon.** Er blijkt al een **bootstrap** te bestaan (sprint 27m): bij een lege `teachers`-tabel maakt de app automatisch een leerkracht aan uit `POC_BASIC_USER`/`POC_BASIC_PASS`. Die `.env`-waarden waren dus geen noodzaak maar een **dubbele weg**. Ze zaaien nu enkel nog de eerste leerkracht; je logt daarna in met dezelfde naam en hetzelfde wachtwoord — maar tegen de databank, met een echte, intrekbare sessie.

**Gat gedicht tijdens het bouwen:** die bootstrap keek enkel naar het **platte** `POC_BASIC_PASS`. Wie `POC_BASIC_PASS_HASH` gebruikte, kreeg geen bootstrap-leerkracht — en zou na 50f **volledig buitengesloten** zijn, want de `.env`-login bestond dan niet meer. De bootstrap accepteert nu ook een vooraf gehasht wachtwoord.

**Bijna-fout die ik onderweg opving:** `PASSWORD_HASH` leek dood na het schrappen van de `.env`-login — maar `reviewTokenSecret()` gebruikt hem als geheim voor de leerling-nakijk-tokens. Weggooien had die tokens stilletjes ongeldig gemaakt. Blijft dus staan, nu enkel als geheim, niet als inloggegeven.

**`checkAuthConfig` herzien.** Eist nu een echte leerkracht: geen leerkracht = niemand kan binnen = niet starten. De foutmelding is **bruikbaar** gemaakt en geeft meteen het reddingscommando uit 47.3 (`docker compose run --rm web …`), dat óók werkt als de container stilligt. Bij een **onbereikbare databank** sluit de app niet meer af — dat is een tijdelijke storing, geen configuratiefout.

**Misleidende melding uit 47.2 rechtgezet.** De log zei *"Fallback login actief via POC_BASIC_USER/POC_BASIC_PASS"* terwijl de app zich meteen daarna afsloot — die regel keek enkel naar het wachtwoord, terwijl de opstartcontrole óók een gebruikersnaam eiste. Nu zegt ze wat er écht gebeurt.

**Gedragswijziging bij het aanmaken van de sessie.** In 50a mocht dat stil falen (het oude cookie ving je op). Dat vangnet is weg, dus stil falen zou betekenen: *"ingelogd"* te zien krijgen en meteen weer op het loginscherm belanden. De login **faalt nu eerlijk** met een 500 en een leesbare melding.

**⚠️ Bij deze deploy word je uitgelogd.** Het `teacher_auth`-cookie betekent niets meer; iedereen logt één keer opnieuw in. Dat is het hele punt van deze sprint.

**Tests:** de legacy-tests zijn vervangen door 50f-tests, waaronder de kerntest *"het oude gedeelde cookie geeft geen toegang meer"*. Suite: **188/188 groen**.

---

### Sprint 50e — Fase 1: het audit-log noteert wie het déed *(~0.5 dag)* — ✅ AFGEROND (v2026.2.48.4)

**Cat:** AUTH · **Prio:** 🔴 P10

**Het probleem.** `getActorFromReq()` las de **`Authorization`-header**. Maar de app logt in via een cookie, en dan stuurt de browser die header **nooit** mee. Gevolg: élke regel in het audit-log zei **`onbekend`**. Niet stuk — waardeloos. Je kon niet nagaan wie een score wijzigde, resultaten vrijgaf of een toets verwijderde.

**De fix.** Sinds 50b draagt elk beschermd verzoek een echte identiteit, dus de functie leest nu `req.teacher.username`. Alle 4 de aanroepers (`score_changed`, `results_released`, `review_mode_opened/closed`, `quiz_deleted`) zitten achter `requireTeacherAuth`, dus de identiteit is er gegarandeerd.

**Vanaf nu klopt het audit-log** — en dat is meteen de waarde van fase 1 die je kan zién: *"anja wijzigde de score van vraag 3"* in plaats van *"onbekend deed iets"*.

---

### Sprint 50d — Fase 1: verval + verlengen bij activiteit *(~0.5 dag)* — ✅ AFGEROND (v2026.2.48.3)

**Cat:** AUTH · **Prio:** 🔴 P10

**Verval werkte al.** `getTeacherSession()` filtert sinds 50a op `expires_at > now`, dus een verlopen sessie geeft `null` → je belandt op de login. Deze sprint gaat dus over het **verlengen**.

**Het probleem dat het oplost.** Met een vaste looptijd van 8u vlieg je eruit terwijl je bezig bent — midden in een toets meekijken, en plots terug naar de login. Maar onbeperkt verlengen is even fout: op een klaslokaal-pc zou een sessie dan **maandenlang** blijven leven door dagelijks gebruik.

**De oplossing: meeschuiven met een plafond.**
- De looptijd (standaard **8u**) schuift mee zolang je werkt.
- Een **harde grens** (standaard **24u**, instelbaar via `POC_SESSION_ABSOLUTE_MAX_HOURS`) kapt dat af. Je logt dus hooguit **één keer per dag** opnieuw in.
- Ten opzichte van vandaag is dit **strikt gunstiger**: nu vlieg je er sowieso na 8u uit.

**Drie valkuilen, elk apart afgedekt en getest:**
1. **Niet bij élk verzoek schrijven.** De middleware hangt aan 101 endpoints — verlengen per klik zou een databankschrijfactie per klik betekenen. We verlengen pas **halfweg** de looptijd.
2. **Nooit inkorten.** Vlak vóór de harde grens valt `now + 8u` *later* dan de grens, dus kappen we af — maar dan zou het nieuwe einde **vroeger** kunnen liggen dan wat er al staat. Dat zou de leerkracht tijd afpakken. Er is een test die dit bewaakt.
3. **Het cookie moet mee opschuiven.** Anders gooit de browser het weg terwijl de sessie in de databank nog leeft — en vlieg je alsnog buiten. `Max-Age` wordt mee verlengd.

**Opbouw:** de rekenregel `berekenSessieVerlenging()` staat in `lib/auth.js` — pure functie, geen databank, geen klok van buitenaf. `server.js` doet enkel het schrijfwerk. **Fail-safe:** mislukt het verlengen, dan slaagt het verzoek gewoon; je verliest hooguit wat looptijd, geen toegang.

**Tests:** 8 nieuwe, waaronder *"net ingelogd → niet verlengen"*, *"voorbij de helft → wel"*, *"verlengen gaat nooit voorbij de harde grens"*, *"verlengen mag nooit inkorten"* en een simulatie van een werkdag (klikken om 5u, 10u en 15u → sessie blijft leven, maar nooit voorbij 24u). Suite: **190/190 groen** (was 182).

**Ook bijgewerkt:** `.env.example` met de nieuwe instelling en uitleg waarom ze bestaat.

---

### Sprint 50c — Fase 1: afmelden dat écht afmeldt *(~0.5 dag)* — ✅ AFGEROND (v2026.2.48.2)

**Cat:** AUTH · **Prio:** 🔴 P10

**Waarom afmelden tot nu niet kón.** `teacher_auth` is een **vaste waarde** — een HMAC van `BASIC_AUTH_USER|BASIC_AUTH_REALM`. Afmelden wiste dat cookie enkel in **jouw** browser. Wie de waarde ooit kopieerde, bleef binnen: je kan een constante niet intrekken. Dat is geen slordige implementatie, het is een gevolg van het ontwerp — en precies waarom fase 1 nodig is.

**Wat is gebouwd:**
- **Afmelden verwijdert de sessierij.** Daarmee is dat token **overal** dood: ook in een andere browser, op een ander toestel, en voor wie het gekopieerd zou hebben. Dát is echt afmelden.
- **Beide cookies worden gewist.** Enkel `teacher_sid` wissen zou niet volstaan: de terugval op het oude `teacher_auth` (uit 50b) zou je meteen weer binnenlaten.
- **Fail-safe:** lukt het intrekken niet (databank even weg), dan worden de cookies tóch gewist — beter afgemeld in de browser dan een half scherm met een foutmelding.

**Meegenomen: hetzelfde gat bij wachtwoord wijzigen.** `PUT /api/admin/teachers/:username/password` liet lopende sessies gewoon leven. Dat is dezelfde bug in een ander jasje: je wijzigt je wachtwoord juist **omdat** je vermoedt dat iemand meekijkt — en die bleef dan binnen. Nu worden alle sessies van die leerkracht ingetrokken. *Gevolg:* wie zijn eigen wachtwoord wijzigt, moet opnieuw inloggen. Dat hoort zo.

**Al geregeld door het schema:** `deleteTeacher()` doet een echte `DELETE`, en de foreign key staat op `ON DELETE CASCADE` — sessies van een verwijderde leerkracht verdwijnen dus vanzelf. Geen extra code nodig.

**Waarom de GET-logout geen CSRF-probleem is.** Een aanvaller kan `<img src=".../api/teacher-logout">` op een andere site zetten, maar door **`SameSite=Strict`** stuurt de browser de cookies niet mee. Zonder cookie is er geen sessie te vinden en valt er dus niets in te trekken. Het ergste gevolg zou sowieso "iemand meldt je af" zijn, geen toegang.

**Tests — eerlijk:** hier zitten **geen nieuwe unittests** bij. De logica is databank + HTTP, geen pure functie; een unittest zou hier alleen maar dekking veinzen. Wel nagespeeld dat **beide** cookies leeg én met `Max-Age=0` teruggaan — een vergeten cookie zou betekenen dat afmelden niet werkt. Suite blijft **182/182 groen**. De echte test staat in `test-readme.md` §73: na afmelden moet het oude `teacher_sid` een 302 naar de login geven.

---

### Sprint 50b — Fase 1: req.teacher — de app weet wie je bent *(~1 dag)* — ✅ AFGEROND (v2026.2.48.1)

**Cat:** AUTH · **Prio:** 🔴 P10

**Wat is gebouwd:**
- **`requireTeacherAuth` vult nu `req.teacher`** met `{id, username, displayName, role, source}`. Die middleware hangt aan **101 endpoints**, dus heel het leerkrachtdeel draagt in één klap een identiteit.
- **De beslisregel staat in `lib/auth.js`** als `bepaalTeacherIdentiteit()` — pure logica, los van Express en de databank, en dus **rechtstreeks testbaar**. `requireTeacherAuth` haalt enkel de bouwstenen op.
- **`GET /api/me`** toont wie de app dénkt dat je bent. Dat is meteen de test van deze sprint: log in als A en als B in twee browsers → twee verschillende namen.

**De volgorde is de kern.** Een echte sessie **wint altijd** van het oude gedeelde cookie. Wie met 50a inlogde krijgt dus meteen zijn echte identiteit, terwijl een oude browsersessie gewoon blijft werken.

**`source` maakt zichtbaar wat de app écht weet:**

| source | Betekenis | id |
|---|---|---|
| `session` | betrouwbaar — we weten wie | ✅ |
| `legacy` | oud gedeeld cookie: we weten enkel **dát** je mag | `null` |
| `open` | authenticatie staat uit | `null` |

Dat `id: null` bij `legacy` is geen slordigheid maar de **hele reden voor fase 1**: zolang je op het oude cookie zit, kán de app niet weten wie je bent. `/api/me` toont dat als `identiteitBekend: false`.

**Twee bewuste keuzes:**
- **Geen stilzwijgende adminrechten.** Bij `legacy` krijg je rol `teacher`, niet `admin` — het oude cookie zegt niets over wie je bent, dus krijg je de laagste rol. Er is een test die dit bewaakt.
- **Geen extra databanklast.** Zonder `teacher_sid`-cookie doet `leesLeerkrachtSessie` **geen** query (hij stopt bij het ontbrekende cookie). Wie nog op het oude cookie zit, merkt dus niets.

**Plaatsing gecorrigeerd tijdens het bouwen:** `/api/me` stond eerst vlak na de definitie van `requireTeacherAuth` (regel ~454) — dus **vóór** de CSP-middleware (472) en `express.json` (527). Express draait middleware in registratievolgorde, waardoor die route buiten de beveiligingsheaders zou vallen. Verplaatst naar de andere API-endpoints.

**Niet in deze sprint:** de socket-kant. `socketIsTeacherAuthorized()` gebruikt nog het gedeelde cookie en kent dus geen identiteit. Dat is nodig voor het audit-log (**50e**) en eigenaarschap (**51**), en gebeurt daar.

**Tests:** 10 nieuwe, waaronder de kerntest *"sessie van A geeft A, sessie van B geeft B"*, *"een echte sessie wint van het oude cookie"* en *"oud cookie krijgt nooit stilzwijgend adminrechten"*. Suite: **182/182 groen** (was 172).

---

### Sprint 50a — Fase 1: sessietabel + sessie bij login *(~0.5 dag)* — ✅ AFGEROND (v2026.2.48.0)

**Cat:** AUTH · **Prio:** 🔴 P10 · *(eerste steen van fase 1 — de poort waar alles aan hangt)*

**Het probleem, bevestigd in de code.** `teacherCookieValue()` maakt een HMAC van `BASIC_AUTH_USER|BASIC_AUTH_REALM` — een **vaste waarde**. Iedereen die inlogt krijgt letterlijk hetzelfde cookie. Vandaar dat de app niet weet wie er werkt, afmelden niet kan (je kan een vaste waarde niet intrekken) en het audit-log niet klopt.

**Wat is gebouwd:**
- **Tabel `teacher_sessions`** (`token_hash` PK, `teacher_id` → FK op `teachers` met CASCADE, `created_at`, `expires_at`, `last_seen`, `user_agent`, `ip`) + indexen op `teacher_id` en `expires_at`.
- **Token-helpers in `lib/auth.js`**: `createSessionToken()` (32 willekeurige bytes) en `hashSessionToken()`. **De databank bewaart enkel de SHA-256** — het echte token bestaat alleen in de cookie van de browser. Lekt de databank, dan zijn de sessies daarmee niet bruikbaar. Dat is nu bijna gratis; achteraf inbouwen is pijnlijk.
- **`authenticateTeacher(authHeader)`** geeft nu de **leerkracht** terug i.p.v. `true`/`false` — je kan geen sessie koppelen aan een booleaan. `credentialsAreValid()` blijft bestaan als dunne wrapper, dus alle bestaande aanroepers werken ongewijzigd.
- **Bij login** wordt een sessie aangemaakt en komt er een **`teacher_sid`**-cookie bij, **naast** het oude `teacher_auth`. Dat oude cookie bepaalt voorlopig nog of je binnen mag.
- **DB-laag ziet nooit een token** — enkel de hash. `server.js` genereert en hasht.
- **Opruiming** van verlopen sessies hangt aan de bestaande nachtelijke cleanup (03:00).
- **Zichtbaar in de DB-viewer**: `teacher_sessions` toegevoegd aan de tabellijst, `token_hash` aan de maskeerlijst.

**Bewust fail-safe.** Gaat het aanmaken van de sessie mis, dan **slaagt de login alsnog** via het oude cookie — er wordt enkel gelogd. Zo kan 50a uitgerold worden zonder enig risico dat niemand meer binnen raakt.

**Bekende beperking (verdwijnt in 50f).** Log je in via de **`.env`-fallback** (`POC_BASIC_USER`), dan is er geen rij in `teachers` en dus **geen sessie** — de tabel heeft een foreign key. De log zegt dat dan expliciet. Maak een echte leerkracht aan (`pycodeflow.sh` → optie 10) om sessies te zien.

**Tests:** 7 nieuwe in `tests/auth.test.js` (tokenlengte, 200× uniek, hash stabiel, hash bevat het token niet, lege invoer). Suite: **172/172 groen** (was 165). Daarnaast de cookie-samenstelling nagespeeld: `teacher_auth` + `teacher_sid` + `csrf_token` overleven alle drie in één antwoord — een overschreven header zou de login breken.

---

### Sprint 43.11 — Knoppen in de toets deden niets (editorStore) *(~0.25 dag)* — ✅ AFGEROND (v2026.2.47.13)

**Aangemeld:** 14/07 (testronde: Run, kopieer en Volgende werkten niet) · **Cat:** BUG · **Prio:** 🔴 P10

**Root cause:** `quiz-student.js` gebruikte `editorStore.quiz` rechtstreeks, maar `editorStore` is een **`const` binnen de IIFE van `app.js`** en staat dus niet op `window`. Elke aanroep gaf `Uncaught ReferenceError: editorStore is not defined` in `getCurrentCode()` en `setEditorCode()` — en die worden gebruikt door Run, kopiëren, Vorige/Volgende en het laden van een vraag. Daardoor deed vrijwel elke knop niets.

**Fix:** `app.js` exporteert wél `window.getEditorValue(owner)` en `window.setEditorValue(owner, value, resetView)`. `quiz-student.js` gebruikt nu die helpers.

**Zelfde bug gevonden in `quiz-review.js`** (nakijkscherm): daar stond `window.editorStore?.quiz` — dat is `undefined`, dus de `if` sloeg **stil** over en de code van de leerling werd **nooit in de editor geladen**; de regels *buiten* die `if` (`editorStore.quiz.updateOptions(...)`) gaven een harde ReferenceError. Ook omgezet naar de geëxporteerde helpers, met een kleine helper `setQuizEditorReadOnly()` die `updateEditorConfig('quiz', { assist:false, readOnly })` gebruikt — `assist:false` expliciet, exact zoals de review-editor wordt aangemaakt.

---

### Sprint 43.12 — Toets-layout: code en output in tabs *(~0.25 dag)* — ✅ AFGEROND (v2026.2.47.14)

**Aangemeld:** 14/07 (testronde) · **Cat:** UX

**Probleem:** in de toets stond de output **onder** het codeblok. De leerling kent dat niet zo: in een **klassessie** (`student-app`) en bij **vrij oefenen** (`free-editor`) zitten code en uitvoer in **tabs**. Op een Chromebook betekende de gestapelde indeling bovendien voortdurend scrollen.

**Eerste poging (fout, v47.13):** ik zette code en output naast elkaar in een grid, omdat ik `.workspace { grid-template-columns:1.7fr .95fr }` als "de sessie-indeling" las. Dat is echter de **leerkracht**-indeling; de leerling ziet tabs. Teruggedraaid.

**Fix (v47.14):** `quiz-student.html` heeft nu een tabbalk **Code | Output** met exact hetzelfde patroon als `free-editor.html` (`<div class="tabs">` + `tab-btn` met `data-tab`/`data-owner="quiz"`). Het output-paneel staat nu **binnen** de editor-shell met de klasse `hidden`, zodat de bestaande `setTab('quiz', tab)` uit `app.js` het toont/verbergt — die zet ook de juiste knop actief en roept `layoutEditor('quiz')` aan (nodig omdat de editor verborgen kan zijn geweest). `quiz-student.js` koppelt de knoppen, springt bij **Run** automatisch naar **Output** (zoals vrij oefenen) en start elke nieuwe vraag weer op **Code**. Geen nieuwe CSS nodig: `.tabs`, `.tab-btn` en `.hidden` bestonden al, dus de toets ziet er identiek uit als de sessie.

---

### Sprint 43.10 — Toets-pagina's werkten niet (AMD/UMD-scriptvolgorde) *(~0.25 dag)* — ✅ AFGEROND (v2026.2.47.12)

**Aangemeld:** 14/07 (testronde: "START TOETS" bleef op *Toets laden…* hangen) · **Cat:** BUG · **Prio:** 🔴 P10

**Symptomen in de console:** `Uncaught ReferenceError: io is not defined` (quiz-student.js:5), `Can only have one anonymous define call per script file` (marked + purify), `Cannot access '_startTimeout' before initialization`, en een geblokkeerde `connect-src`-request naar cdnjs.

**Root cause — één oorzaak, vier symptomen.** Monaco's `loader.js` zet een globale AMD-`define` (met `.amd`). Alle **UMD**-libraries die daarná laden (socket.io, marked, DOMPurify) detecteren die en registreren zich als **anonieme AMD-module** i.p.v. `window.io` / `window.marked` / `window.DOMPurify` te zetten. Gevolg: `io` bestond niet → `quiz-student.js` crashte op regel 5 → de rest van het bestand werd nooit uitgevoerd. Omdat functiedeclaraties wél gehoist worden maar `let _startTimeout` niet meer geïnitialiseerd raakte, gaf de knop daarna de misleidende TDZ-fout `Cannot access '_startTimeout' before initialization`. De geblokkeerde cdnjs-request was de AMD-loader die purify als module probeerde op te halen (`connect-src` staat dat terecht niet toe).

**Waarom net deze twee pagina's?** `student-app`, `teacher-app` en `free-editor` laadden socket.io **vóór** `loader.js` en werkten daarom gewoon. Enkel **`quiz-student.html`** en **`quiz-review.html`** hadden de omgekeerde volgorde — precies de twee toets-pagina's.

**Fix:** op beide pagina's staan de UMD-libs nu **vóór** `monaco-env.js` + `loader.js`, gelijk aan het werkende patroon. Meteen ook `code-highlight.js` op `quiz-review.html` gezet, zodat codeblokken bij het verbeteren dezelfde kleuring krijgen. Alle pagina's met `loader.js` zijn nagelopen: nu allemaal correct.

---

### Sprint 43.9 — Preview later doorlopen *(~0.25 dag)* — ✅ AFGEROND (v2026.2.47.11)

**Aangemeld:** 14/07 (vraag: "kan ik een preview-toets later nog doorlopen, en hoe?") · **Cat:** UX + BUG

**Situatie vóór deze sprint:** technisch kón een preview doorlopen worden (`quiz_start` blokkeert previews niet), maar het enige aanknopingspunt was de popup **direct na het aanmaken** ("Wil je de preview openen als leerling?"). Wie die wegklikte, kon de preview enkel nog bereiken door zelf de URL te typen.

**Bugfix (geïntroduceerd in 43.4):** de leerling-selectie-check weigerde **"Leerkracht Test"**, want die naam staat niet in de klaslijst. Zodra je dus leerlingen selecteerde, was je eigen preview onbruikbaar. Previews zijn nu **expliciet vrijgesteld** van die check — ze dienen net om zelf te testen.

**Wat is gebouwd:** knop **🧑‍🎓 Doorlopen** op elke preview-kaart in het toets-/taakoverzicht. Die opent de leerling-weergave in een nieuw tabblad (`/quiz-student.html?code=…&name=Leerkracht Test&class=Preview`) — zo vaak als je wil, ook dagen later. Een preview blijft daarnaast onzichtbaar voor leerlingen tot je op **▶ Activeren** klikt.

---

### Sprint 43.8 — Dupliceren: enkel meta kopiëren, vragen refereren *(~0.5 dag)* — ✅ AFGEROND (v2026.2.47.10)

**Afgerond:** 14/07. Bevestigd: er worden **geen** nieuwe `question_bank`-records aangemaakt — de kopie koppelt via `bank_question_id` aan dezelfde bankvragen (klopt met jouw observatie dat er geen dubbels zijn). De duplicate-code is opgeschoond (dode `req.body`-simulatie weg) en **uitgebreid**: `access_from`/`access_until` (deadline) en `individual_timer` werden **niet** meegekopieerd en nu wél. Per-sessie `quiz_question_snapshots` blijven by design (bevriezen de vraagtekst per toets).

**Aangemeld:** 12/07/2026 (testronde) · **Cat:** BUG · **Prio:** 🟠 P8

**Wens:** bij het dupliceren van een toets/taak mag enkel de **meta** gekopieerd worden; de vragen moeten **dezelfde id's refereren** als de originele, niet als nieuwe records opduiken.

**Technische stand van zaken:** de duplicate-endpoint (`/api/quiz/:code/duplicate`) + `createQuizSession` schrijven momenteel enkel naar `quiz_meta` en `quiz_question_snapshots`, met `bank_question_id` = het originele bank-id. Er worden dus **geen nieuwe `quiz_bank`-records** aangemaakt (de vraagbank blijft gedeeld). Wél krijgt elke kopie eigen `quiz_question_snapshots`-rijen (per-sessie snapshots, by design).

**❓ Te bevestigen:** in welke tabel zie je de dubbele records — `quiz_bank` (dan is er ergens tóch een insert, echte bug) of `quiz_question_snapshots` (dan is het per ontwerp één set per sessie en moeten we het datamodel herzien, bv. toetsen die rechtstreeks bank-vragen refereren zonder snapshot)? Met dat antwoord mik ik de fix juist.

---

### Sprint 43.7b — Toets-/taak-overzicht als échte pagina's *(~1 dag)* — ✅ AFGEROND (v2026.2.47.10)

**Aangemeld:** 14/07 (terechte feedback: de tab toonde nog de titel "Lopende sessies"). **Wat is gebouwd:** twee **eigen pagina's** `toets-overzicht.html` en `taak-overzicht.html`, opgebouwd zoals de **vragenbank**: eigen titel, statistiek-chips, filterbalk (klas/status/schooljaar/zoeken) en een **kaartenraster** per item, gegroepeerd in Actief / Preview / Afgerond. Gedeelde logica in `assignment-overview.js`; de nav wijst nu naar deze pagina's (niet meer naar de sessie-tab). De inline-notes *"Volledig overzicht & previews →"* zijn uit het sessiescherm verwijderd.

---

### Sprint 43.7 — Toets-overzicht & taak-overzicht *(~1.5 dag)* — ✅ AFGEROND (v2026.2.47.9, herbouwd in 43.7b)

**Afgerond:** 14/07 — **lean uitvoering:** i.p.v. twee losse HTML-pagina's wijzen de nav-items **Toets overzicht** en **Taak overzicht** naar de bestaande bank vóór-gefilterd op type (`?tab=quizzes&type=toets|taak`); de bank is functioneel het volledige overzicht per type (filters, groepen, aanmaken/bewerken/dupliceren/verwijderen). **"Nieuwe toets" is uit de nav** (aanmaken gebeurt via de "+ Nieuwe"-knop in het overzicht). Wil je het écht als twee aparte pagina's (zoals de vragenbank), dan is dat een kleine opvolgstap.


**Aangemeld:** 12/07/2026 · **Cat:** FEAT · **Prio:** 🟠 P8

**Te bouwen (Req B+C):** twee volwaardige beheerpagina's **"Toets overzicht"** en **"Taak overzicht"**, opgebouwd zoals de **vragenbank** (`quiz-bank.html`): volledig overzicht per type, met aanmaken/bewerken/dupliceren/verwijderen en filters. In de nav: **"Nieuwe toets" verdwijnt**, en er komen **"Toets overzicht"** + **"Taak overzicht"** bij (aanmaken gebeurt dan vanuit die overzichten).

**Nota (afhankelijkheid):** dit is gekoppeld aan **43.3** (expliciet `type`-veld toets/taak). Nu wordt het type nog afgeleid uit `no_timer`; met een echt `type`-veld wordt de splitsing robuuster. Aanrader: 43.3 eerst of samen.

**Extra (12/07):** verwijder in de sessie-tabs (Toetsen/Taken) het tussenzinnetje *"Actieve toetsen/taken (zonder previews). [Volledig overzicht & previews →]"* — dat is een tijdelijke doorverwijzing die overbodig wordt zodra deze aparte overzichtspagina's bestaan.

---

### Sprint 43.3 — Type toets vs taak (expliciet) + deadline-regels *(~1 dag)* — ✅ AFGEROND (v2026.2.47.10)

**Afgerond:** 14/07. Kolom **`type`** ('toets'|'taak') op `assignment_bank` + migratie die bestaande rijen afleidt uit `no_timer` (timerloos → taak). `createQuizSession` schrijft het type; `/api/quiz-sessions` leest het uit de kolom (met `no_timer` als fallback voor oude rijen). **Deadline verplicht voor béide**: server weigert aanmaken zonder `accessUntil` (preview uitgezonderd) én controleert dat de deadline ná de start ligt; client blokkeert met een duidelijke melding en het veld is als *verplicht* gemarkeerd.

**Aangemeld:** 12/07/2026 · **Cat:** FEAT · **Prio:** 🟠 P8

**Te bouwen:** kolom **`type`** op `quiz_meta` ('toets'|'taak'; bestaande rijen afgeleid uit `no_timer`). Bij aanmaken kiest de leerkracht expliciet toets/taak; bank + lijst tonen/filteren op type.

**✅ Deadline-regel (beslist 12/07, verfijnd 15/07):** een **einddatum + uur (`access_until`) is verplicht voor béide** — toets én taak. **Uitzonderingen: preview** (dient om zelf te testen) **en template** (sprint 53a — heeft geen klas/school en dus geen deadline). Bestaande toetsen/taken zonder deadline blijven geldig; nieuwe vereisen een deadline.

---

### Sprint 43.4 — Leerling-selectie per toets/taak *(~1.5 dag)* — ✅ AFGEROND (v2026.2.47.10)

**Afgerond:** 14/07. Nieuwe tabel **`assignment_students`** (`session_code`,`student_id`) — **geen rijen = alle leerlingen** van de klas mogen. UI: knop **👥 Leerlingen** naast de klaskeuze opent een popup met de klaslijst als checkboxes (**standaard alles aan**), met **Alles aan/uit**, **Opslaan/Annuleren**; is alles aangevinkt dan bewaren we géén beperking (zo mag een later toegevoegde leerling ook mee). API: `GET/PUT /api/quiz/:code/students`. **Afdwingen bij start**: `quiz_start` weigert niet-geselecteerde leerlingen (matching op naam binnen de gekoppelde klas, want toets-leerlingen krijgen een random id).

**Aangemeld:** 12/07/2026 · **Cat:** FEAT · **Prio:** 🟠 P8

**Te bouwen:** nieuwe tabel **`assignment_students`** (`session_code`, `student_id`); afwezig/leeg = ALLE klasleerlingen. UI: klas kiezen → knop **"Leerlingen"** → popup met checkboxes (standaard alles aan), **alles aan/uit**, opslaan/annuleren. Afdwingen bij `student_join`/`quiz_start`.

**Aanname (te bevestigen):** we slaan de **toegelaten** leerlingen op (subset); geen rij = iedereen. Matching op `student_id` uit `class_memberships` van het actieve schooljaar.

---

### Sprint 43.5 — Hernoemen `quiz_bank` → `question_bank`, `quiz_meta` → `assignment_bank` *(~1-1.5 dag)* — ✅ AFGEROND (v2026.2.47.9)

**Afgerond:** 14/07. Data-behoudende migratie in `init()` (`ALTER TABLE ... RENAME`, geguard met `information_schema`, vóór de `CREATE`s) + indexen hernoemd. Alle ~53 query-referenties in `database.js`/`server.js` omgezet, incl. de hardgecodeerde DB-viewer-tabellijst. Client raakt niets (praat via API's). **Scope:** enkel `quiz_bank`+`quiz_meta` (zoals gevraagd); `quiz_answers`/`quiz_student_sessions` behouden hun naam. **⚠️ Deploy:** maak eerst een DB-backup — de rename is niet tegen jouw live-Postgres getest.


**Aangemeld:** 12/07/2026 · **Cat:** REFACTOR · **Prio:** 🟡 P6 · *(bewust als laatste: risicovol + mechanisch)*

**Te doen:** DB-migratie (`ALTER TABLE ... RENAME`) + alle codereferenties (`db/database.js`, `server.js`, client, DB-viewer-labels), eenmalig en data-behoudend.

**❓ Te bevestigen — scope.** Enkel `quiz_bank`+`quiz_meta`, of ook `quiz_answers` → `assignment_answers` en `quiz_student_sessions` → `assignment_student_sessions` mee voor de consistentie? Ik raad aan ze mee te nemen.

> **Waarom als laatste:** de rename raakt zowat elke quiz-query. Ná 43.3–43.4 bouwen we de features één keer en migreren daarna in één gecontroleerde stap. Kan ook uitgesteld worden.

---

### Sprint 43 — Toetsen/taken scheiden van sessies + live-overzicht *(~2-3 dagen)* — ✅ AFGEROND (v2026.2.43.0)

**Aangemeld:** 11/07/2026 (leerkracht-feedback + screenshots) · **Afgerond:** 11/07/2026 · **Cat:** ARCH/BUG

**Wat is gebouwd:**
- **(a)** `renderSessions()` in `app.js` filtert nu toets-/taaksessies (`mode==='quiz'`/`'task'`) uit de "Lopende sessies"-lijst — zowel actief als gesloten. Ze verschijnen enkel nog onder de "Toetsen"-tab.
- **(b)** De `student_join`-handler in `server.js` herkent een toets/taak-sessie en stuurt de leerling met een `redirect_to_quiz`-event naar `quiz-student.html?code=…&name=…&class=…` i.p.v. hem in de editor-sessie te zetten. De join-pagina (`app.js`) luistert op dat event en navigeert door. Leerling-instap toets vs. sessie is nu gescheiden.
- **(c)** Type-label toets ↔ taak: afgeleid uit `quiz_meta.no_timer` (timerloos = **taak**, met timer = **toets**) en getoond als badge in de lijst. *Opmerking:* dit is de bestaande conventie ("∞ Geen tijdslimiet (taak)"); een volledig expliciete toets/taak-keuze bij het aanmaken kan later als kleine follow-up (bv. sprint 43.1) indien gewenst.
- **(d)** Nieuw endpoint `GET /api/quiz-sessions` (`server.js`) levert per toets/taak: **online-teller** (leerlingen nu verbonden), **beschikbaarheid** op basis van het tijdsvenster (`open` / `pending` / `expired` / `closed`, via `access_from`/`access_until`), type en aantallen. De "Toetsen"-tab toont nu die badges plus een **👁 Live**-knop naar `teacher-grid.html?code=…` om read-only mee te kijken. Preview-sessies (`is_teacher_preview`) worden uit de lijst gefilterd.

**Oorspronkelijke analyse (bij aanmelding):**

**Kern van het probleem:** een toets is intern een sessie met `mode: 'quiz'` (zie `server.js` waar de quiz-sessie met `mode:'quiz'` wordt aangemaakt). Er is nog geen echte scheiding tussen "gewone codeersessie" en "toets/taak" in de leerkracht-UI én in de leerling-instap. Daardoor lekken toetsen door als gewone sessies en belanden leerlingen met een toetscode in het verkeerde scherm.

**Deelpunten (uit de feedback):**

- **(a) Toetsen verschijnen in "Lopende sessies".** `renderSessions()` in `app.js` filtert de lijst enkel op `!s.closed` — nooit op `mode`. Quiz-/taaksessies staan dus óók in de gewone sessielijst (zie screenshot met "sdcxzxcz"-kaarten van type "Klas" die eigenlijk toetssessies zijn). Openen geeft een sessiescherm waar niks gebeurt.
  - **Fix:** in `renderSessions()`/`loadSessions()` sessies met `mode === 'quiz'` (en toekomstig `'task'`) uitfilteren. De "Type"-cel kent nu enkel `exam` vs `Klas` — die logica moet toets/taak leren herkennen (of ze horen er simpelweg niet in thuis).

- **(b) Leerling met toetscode krijgt sessiescherm, geen toets.** De server-handler `student_join` (`server.js`) is **mode-agnostisch**: hij zet elke join op als gewone editor-sessie en stuurt `emitStudentState` — er is geen tak die bij `session.mode === 'quiz'` de leerling naar de toets-flow (`quiz-student.html` / `quiz_start`) leidt. Een toetscode ingegeven op de generieke "Deelnemen"-pagina levert dus een codeersessie op.
  - **Fix:** bij join detecteren dat de sessie een toets/taak is en de leerling doorsturen/omschakelen naar de toets-weergave (of de generieke deelnamepagina de code laten herkennen en naar `quiz-student.html?code=…` routeren). Leerling-instap toets vs. sessie moet ondubbelzinnig gescheiden zijn.

- **(c) Geen onderscheid toets ↔ taak.** Er bestaat nu geen apart `task`-type; een "taak" is de facto gewoon een toets **zonder timer** (`quiz-teacher.js` toont "∞ Geen tijdslimiet (taak)"). Er is geen type-label om taken van toetsen te onderscheiden in lijsten.
  - **Fix:** expliciet type-label (toets/taak) toevoegen dat door de listings gebruikt wordt. Een taak volgt dezelfde flow als een toets maar krijgt een ander label.

- **(d) Toetsen-tab mist live-status.** De "Toetsen"-tab (`loadQuizSessions()` in `app.js`) toont enkel naam, "Toets"-badge, evt. "Gesloten", code, datum en de knoppen Verbeteren/Dupliceren. Ontbreekt:
  - **online-teller** (hoeveel leerlingen nu bezig zijn) — zoals bij sessies;
  - **open/gesloten op basis van het tijdsvenster** — de server kent al `access_from`/`access_until` (`server.js`, "Deze toets/taak is nog niet beschikbaar. Toegang start op …"), maar de UI toont enkel de handmatige `closed`-vlag, niet of de toets nú binnen zijn geldige venster valt;
  - **link naar de live-popup** `teacher-grid.html?code=…` om read-only mee te kijken met de online leerlingen.
  - **Fix:** het live-overzicht van leerlingen die aan een toets/taak werken hoort **vanuit het toetsdeel** bereikbaar te zijn (niet via de sessielijst), met online-teller, duidelijke open/dicht-status en een `teacher-grid`-link per toets.

**Waarom P10:** (a) en (b) zijn functionele breuken die leerlingen een verkeerd scherm tonen tijdens een echte toets — hoge impact.

---

### Sprint 43.1 — Voortgang per gekoppelde klas-leerling *(~0.5 dag)* — ✅ AFGEROND (v2026.2.43.1)

**Aangemeld:** 11/07/2026 · **Afgerond:** 11/07/2026 · **Cat:** UX · *(tussengeschoven vóór 44 volgens de decimale nummering-afspraak)*

**Vraag:** bij een toets/taak (en de Live-knop) wil de leerkracht zien wie al **ingeleverd** heeft, wie **bezig** is en wie **nog niets** deed — met kleur: 🟢 groen = ingeleverd, 🟡 geel = al iets gemaakt maar niet ingeleverd, ⚪ grijs = niets.

**Wat is gebouwd:**
- Nieuw endpoint `GET /api/quiz-sessions/:code/roster` (`server.js`). De "gekoppelde leerlingen" komen uit de **klas die aan de toets hangt** (`quiz_meta.target_class` = klas-id) voor het schooljaar van die klas, via `class_memberships` (`dbModule.listStudents(classId)`, actieve lidmaatschappen).
- Status per leerling wordt bepaald uit `quiz_answers`: `submitted_at` gezet → **ingeleverd**; wel inhoud (code, gekozen opties, runs of een eerste run) maar niet ingeleverd → **bezig**; geen zinvolle activiteit → **nog niets**. Matching gebeurt op **naam** (genormaliseerd), want een toets-leerling krijgt bij `quiz_start` een eigen, niet-globale id — dus id-matching met `class_memberships` zou niet kloppen.
- Deelnemers die niet in de gekoppelde klas zitten (bv. verkeerde naam ingetypt) worden apart als "Niet in de klas" getoond, zodat niemand onzichtbaar blijft.
- UI: een **👥 Voortgang**-knop per toets/taak (naast 👁 Live) in de Toetsen-tab (`app.js`) klapt een paneel open met gekleurde leerling-chips + een telling (🟢/🟡/⚪) en een vernieuw-knop.

**Bewust nu niet gedaan (maar voorzien):** er wordt **één** klas aan een toets gekoppeld; de roster-logica werkt al per klas-id, dus meerdere klassen koppelen is later een kleine uitbreiding (klas-id's → meerdere `listStudents`-oproepen samenvoegen) zonder herontwerp.

---

### Sprint 44 — Bug: dupliceren maakt meerdere kopieën *(~0.5 dag)* — ✅ AFGEROND (v2026.2.44.0)

**Aangemeld:** 11/07/2026 (leerkracht-feedback) · **Afgerond:** 11/07/2026 · **Cat:** BUG

**Symptoom:** in het vragenoverzicht maakte "⧉ Dupliceren" niet één kopie maar een schijnbaar willekeurig aantal kopieën.

**Root cause (bevestigd in `quiz-bank.js`):** de click-listener voor de kaartknoppen werd **binnen** `renderQuestions()` gebonden — na het opbouwen van de kaarten werd `document.getElementById('q-grid').addEventListener('click', …)` uitgevoerd. `#q-grid` is een blijvend element (enkel z'n `innerHTML` wisselt), dus bij elke re-render kwam er een extra listener bovenop. `renderQuestions()` loopt via `loadQuestions()` bij het laden én na elke bewaar-, verwijder-, archiveer-, herstel- en dupliceer-actie. Gevolg: na N renders vuurde één klik op "Dupliceren" `duplicateQuestion()` N keer → N kopieën. Het leek willekeurig maar was gelijk aan het aantal re-renders sinds paginaladen.

**Fix (gebouwd):** de delegatie-listener is uit `renderQuestions()` gehaald en zit nu in `bindQGridActionsOnce()`, met een module-vlag `_qGridActionsBound` zodat hij **exact één keer** aan `#q-grid` hangt, ongeacht hoe vaak er opnieuw gerenderd wordt. Alle knoppen (bewerken, dupliceren, verwijderen, herstellen, definitief verwijderen) vuren nu één keer.

**Bredere check (uit de aanmelding):** hetzelfde patroon is elders nagekeken. `renderSessions()` in `app.js` bindt per knop op **vers aangemaakte** elementen (`host.querySelectorAll('[data-…]').forEach(btn => btn.addEventListener(…))`) die bij elke re-render weggegooid worden — daar stapelt dus niets op. De bug was uniek voor `quiz-bank.js`; geen verdere fixes nodig.

---

### Sprint 45 — Instapstructuur Deel A+B (startpagina + leerling/leerkracht-ingang) *(~2 dagen)* — ✅ AFGEROND (v2026.2.45.0)

**Aangemeld:** 08/07/2026 (als deel van sprint 42) · **Afgerond:** 11/07/2026 · Deel C (branding) was al afgerond in v2026.2.42.0.

**Wat is gebouwd (Deel A + B):**
- **Deel A — startpagina met live versie:** de Node-app serveert de keuzepagina nu zélf op `/` en `/index.html` en vult server-side de placeholder `{{APP_VERSION}}` in met `APP_VERSION` (helper `renderLanding()` in `server.js`, gecachet per proces). Geen `fetch`/CORS, werkt zonder JavaScript, en klopt altijd (VERSION → .env → APP_VERSION). De losse statische pagina met handmatig versienummer is daarmee overbodig; in Cloudflare laat je `pycodeflow.org` naar dezelfde app wijzen.
- **Deel B — instap-routes:** nette routes `/student` (serveert de leerling-ingang) en `/teacher` (leidt naar het leerkrachtenplatform → login indien nodig). De landingspagina vraagt nu expliciet "Ben je leerling of leerkracht?" met twee `<a>`-links die zónder JavaScript werken. `page`-detectie in `app.js` herkent nu ook de clean URL `/student`. Oude `.html`-links blijven werken via `express.static`. De vrije oefensessie blijft zonder account werken.
- **Haak voor later:** `/teacher` is het aanknopingspunt waar sprint 48 (school-keuze) later op voortbouwt.

**Oorspronkelijk plan (bij aanmelding):**

**Doel:** een duidelijke instapstructuur (leerling vs. leerkracht), een startpagina waarvan het versienummer **automatisch** meeloopt, en een **schoollogo** dat de app per school personaliseert.

#### Deel A — Startpagina met live versie (aanpak B)

**Situatie nu:** `pycodeflow.org` is een **losse statische pagina** met een **handmatig ingetypt** versienummer (staat verouderd op `v2026.1.12.3` terwijl de app op `2026.2.41.0` zit) en het AH-logo. Volledig los van de app.

**Aanpak B — de app serveert de startpagina zelf** (gekozen boven een losse static site + fetch/CORS, en boven versie-injectie bij build):
- De keuzepagina wordt door de Node-app geserveerd op `/`. Het versienummer wordt **server-side ingevuld**: de app vervangt een placeholder (bv. `{{APP_VERSION}}`) door `APP_VERSION` op het moment van serveren. **Geen `fetch`, geen CORS, werkt zelfs zonder JavaScript**, en klopt altijd omdat de app zijn eigen versie kent (`sync-version.sh` → `VERSION` → `.env`).
- Zo verdwijnt de losse statische pagina; er is nog maar **één** ding te onderhouden.
- In Cloudflare laat je `pycodeflow.org` naar dezelfde tunnel/app wijzen als `app.pycodeflow.org` (één DNS-instelling; de app-code regelt de rest). `app.pycodeflow.org` blijft exact zoals hij is.

**Waarom niet aanpak A (static + fetch):** vereist CORS openzetten voor het kale domein en breekt zonder JavaScript. **Waarom niet C (injectie bij build):** houdt twee werelden gescheiden en vergt aparte deploy van de statische pagina.

#### Deel B — Instapstructuur (leerling vs. leerkracht)

```
/  (keuzepagina)  → "Ben je leerling of leerkracht?"
   ├── /student   → leerling-ingang
   │                 ├─ Vrije sessie (naam + klas + code)   ← blijft ZONDER account
   │                 └─ Mijn toets nakijken (?nakijken=1, sprint 37)
   └── /teacher   → leerkracht-login → leerkrachtenplatform
```
- Nette, sprekende routes `/student` en `/teacher` (i.p.v. `.html`-bestandsnamen), met redirects zodat oude links blijven werken.
- De **vrije oefensessie blijft werken zonder account** — bewuste sterkte, niet weg-ontwerpen.
- `/teacher` is meteen de haak waar **sprint 48** later de school-keuze-modal aan hangt.
- **Niet in scope:** echte leerling-login (14/15, methode nog niet gekozen) en school-keuze (48, vereist multi-tenant fundament). *(Update 15/07: beslist — e-mail + wachtwoord, sprint 52; 14/15 vervallen. School-keuze = 48b.)*

#### Deel C — Schoollogo per school (personalisatie) + branding-opschoning — ✅ AFGEROND (v2026.2.42.0)

**Situatie nu:** het logo in de app-balk is op **elke** pagina hardgecodeerd naar `/assets/logo.svg`. Er bestaat al een half-af mechanisme uit sprint 19b (`/api/school-info` + `/school-logo`, gevoed door `SCHOOL_LOGO_PATH`), maar **de frontend gebruikt het nergens**.

**Concrete branding-wijzigingen (assets aangeleverd 08/07/2026):**
- **Eigen PyCodeFlow-logo** (`pycodeflow-logo.png`, 1024×1024) vervangt:
  - het **kleine balk-logo** bovenaan (nu `logo.svg`) op alle pagina's;
  - het **grote landingslogo** op de startpagina (nu `atheneum-hoboken-logo.png`).
- **Footer opschonen:** de regel "GO! Atheneum Hoboken — alle rechten voorbehouden" (in `app.js`) → de schoolverwijzing verdwijnt. Blijft: "© 2026 PyCodeFlow — ontwikkeld door B. Claes" + versie.

**Uit te voeren (structureel):**
- De balk-logo's koppelen aan `/api/school-info` → toont het **schoollogo** als dat er is, anders valt het terug op het PyCodeFlow-logo (default). Eén kleine helper die op elke pagina de `<img>` in `.logo-group` invult.
- **Voorbereiding op multi-tenant:** het schoollogo hoort uiteindelijk bij de `schools`-tabel (fase 3), niet bij één env-var. In sprint 42 leggen we de **placeholder + het ophaalmechanisme** aan; bij het aanmaken van een school (fase 3 / sprint 48) wordt een logo meegegeven en per school geserveerd. Voor nu is de **default** het eigen PyCodeFlow-logo.
- Zo heeft elke school straks een licht gepersonaliseerde app (eigen logo in de balk) zonder de rest te wijzigen.

**Logo aangeleverd:** `pycodeflow-logo.png` (eigen PyCodeFlow-logo) — vervangt zowel het balk- als het schoollogo. Het AH-logo mag volledig verdwijnen.

**Tests (verwacht):** startpagina bevat de live versie (geen hardcoded string); `/student` en `/teacher` routes leiden juist; school-info valt terug op default als er geen logo is. ~4-5 tests.

**Betrokken bestanden (verwacht):** `server.js` · `public/index.html` (keuzepagina) · `public/student-start.html` · nieuwe/aangepaste routes · `public/*.html` (balk-logo haak) · een klein `public/school-branding.js` · `tests/`

---

### Sprint 46 — Leerkracht-preview & toets-launch fixes *(~1 dag)* — ✅ AFGEROND (v2026.2.46.0)

**Aangemeld:** 11/07/2026 (leerkracht-feedback + screenshots) · **Afgerond:** 11/07/2026 · **Cat:** BUG/UX

**Wat is gebouwd:**
- **(a) Preview-opties renderen nu correct.** Root cause gevonden: de echte leerling-weergave (`quiz-student.js`) zette al `min-width:0` op de tekstkolom, maar de **preview** (`renderPreviewQuestion` in `quiz-teacher.js`) niet — daardoor liepen lange opties/code over en werd de tekst rechts afgesneden. Bovendien lekte de globale regel `label{display:block;font-weight:800;margin-bottom:8px}` (styles.css) in de preview. Fix: de optiekaart is gelijkgetrokken met de leerling-weergave — `min-width:0;overflow-wrap:anywhere` op de tekstkolom, expliciete `font-weight:400;margin:0;box-sizing:border-box;width:100%` op de `<label>`, en een vaste checkbox-grootte. Selector links, tekst leesbaar ernaast, geen overflow.
- **(b) Startscherm hangt niet meer stil.** De preview opende `quiz-student.html` mét naam (`Leerkracht Test`) maar zonder klas; nu wordt ook een klas (`Preview`) meegegeven. Belangrijker: `startQuiz()` toont nu een laadstatus en zet een **time-out van 10s** — komt er geen `quiz_state`, dan verschijnt een duidelijke melding i.p.v. eindeloos "Bezig met laden…". En elke `error_message` wordt nu **inline op het startscherm** getoond (naast de modal), zodat een geweigerde start (lege naam, dubbele verbinding, config weg, …) zichtbaar is i.p.v. stil te hangen. `quiz_state`, `error_message` en `quiz_access_expired` wissen de time-out.

**Oorspronkelijke analyse (bij aanmelding):**

- **(a) Keuze-opties in de "Live preview" (stap 3 van toets aanmaken) renderen verkeerd.** Screenshot toont grote lege kaders met de checkbox los in het midden en de optietekst afgesneden aan de rechterrand ("tes 1", "pri tes"). De optie-`<label>`-opbouw zit in `renderPreviewQuestion()` (`quiz-teacher.js`, tak voor `single`/`multiple`). Uitzoeken of de flex-layout niet doorkomt (bv. conflicterende globale `.choice-*`-CSS die inlekt, of lege/whitespace optietekst uit de duplicatie-bug van sprint 44) en de optiekaart correct laten uitlijnen (selector links, tekst leesbaar ernaast, geen overflow).

- **(b) "Doen alsof je de toets maakt" blijft hangen op "Toets laden…".** De leerkracht-preview opent `quiz-student.html` die bij load `quiz_start` emit en wacht op `quiz_state` (`quiz-student.js`). De server-handler `quiz_start` (`server.js`) doet o.a. `if (!studentName) return socket.emit('error_message', 'Naam is verplicht.')` — als de preview zonder naam/klas opent (screenshot toont "Jouw naam: —", "Klas: —") komt er dus nooit een `quiz_state` en blijft het startscherm hangen; de `error_message` wordt op dat scherm niet getoond. **Te bevestigen** in de browser, daarna: ofwel de preview een naam/klas meegeven, ofwel `error_message` op het "Toets laden…"-scherm zichtbaar maken zodat het niet stil hangt.

---

### Sprint 47.4 — Testbevinding: quizstatistieken 0 + toets onzichtbaar *(~0.5 dag)* — ✅ AFGEROND (v2026.2.47.4)

**Aangemeld:** 12/07/2026 (jouw testronde: toets + 3 vragen aangemaakt, zichtbaar in DB, maar dashboard toont 0 en toets niet in de Toetsen-tab) · **Cat:** BUG

**Drie problemen gevonden:**

1. **Admin-quizstatistieken stonden altijd op 0** (Vragen in bank, Toetsen ooit, Antwoorden totaal, Gem. runs). Oorzaak: die vier queries gebruikten `dbModule.pool`, maar `db/database.js` exporteert **enkel `query`**, niet `pool` → `dbModule.pool` was `undefined` → de ternary viel telkens terug op `0`. **Fix:** de vier queries gebruiken nu `dbModule.query(…)` (dat wél geëxporteerd is). Latente bug, niets met 43–47.x te maken.
2. **Aangemaakte toets niet zichtbaar in de Toetsen-tab.** `/api/quiz-sessions` bouwde de lijst op uit de **in-memory sessies**. Daardoor kon een toets die wel in de DB stond (`quiz_meta`) maar niet (meer) in het geheugen zat, ontbreken. **Fix:** de lijst komt nu uit **`quiz_meta`** (de bron van waarheid voor ‘toetsen’), verrijkt met sessie-info uit geheugen óf DB en met de online-teller. Elke echte toets verschijnt nu, ongeacht de geheugenstaat. Preview-toetsen (`is_teacher_preview = true`) blijven bewust verborgen — dus als een toets écht niet opduikt, check of de checkbox **“Test als leerkracht – PREVIEW”** aanstond bij het aanmaken.
3. **Admin ‘Lopende sessies’ labelde een toets als “Klas”.** `monitoring.js` kende enkel `exam` vs `Klas`. Nu toont het ook **Toets**/**Taak**.

**Tests:** volledige suite **165/165 groen**; `test-readme.md` uitgebreid met een regressiecheck (na een toets aanmaken: telt in de statistieken én verschijnt in de Toetsen-tab). *Kanttekening:* deze fixes raken serverlogica die inline in `server.js` zit; echte unit-tests vereisen die stukjes eerst naar een `lib/`-module te trekken (kandidaat voor later).

---

### Sprint 47.3 — Deadlock-fix: leerkracht aanmaken terwijl de web-container down is *(~0.5 dag)* — ✅ AFGEROND (v2026.2.47.3)

**Aangemeld:** 12/07/2026 (vervolg op 47.2 — 502 bleef, teacher-add via optie 10 gaf "Container is restarting") · **Cat:** BUG (tooling)

**De deadlock:** de web-container stopt (`checkAuthConfig` → `process.exit(1)`) omdat er geen leerkracht is. Om dat op te lossen laat `pycodeflow.sh` (optie 10 én de auto-rescue) de leerkracht aanmaken via `docker exec pycodeflow-web-1 node .../manage-teacher.js add …` — máár dat exect *in de web-container die net down is*. Resultaat: `Error response from daemon: Container … is restarting` en de "✓ aangemaakt"-melding was misleidend (de exec draaide nooit). Je kon dus de leerkracht niet toevoegen omdat de container down was, en de container was down omdat er geen leerkracht was.

**De fix:** `manage-teacher.js` praat rechtstreeks met Postgres (`pg.Pool` → `postgres:5432`) en heeft de web-container helemaal niet nodig. Beide teacher-*add*-aanroepen in `pycodeflow.sh` gebruiken nu een **wegwerp-container**:

```
$COMPOSE --project-directory "$BASE" run --rm -T web node /app/scripts/manage-teacher.js add …
```

`docker compose run` start een nieuwe container uit dezelfde `web`-service (zelfde image, env en netwerk), draait enkel het script en verdwijnt — los van de crashende `pycodeflow-web-1`. Zo werkt de rescue net **wanneer** je hem nodig hebt: als de web-container down is. Het schema bestaat al (de crashende container draait `dbModule.init()` elke cyclus), dus de INSERT slaagt. `bash -n` OK.

**Handmatige noodgreep** (zonder scriptwijziging, meteen bruikbaar): `docker compose run --rm web node scripts/manage-teacher.js add <naam> '<wachtwoord>' admin`, daarna `docker compose up -d --force-recreate web`.

---

### Sprint 47.2 — Testbevinding: opstart-crash na herinstall + versie-loader-fix *(~0.5 dag)* — ✅ AFGEROND (v2026.2.47.2)

**Aangemeld:** 12/07/2026 (jouw testronde, na *herinstall* + eerste start) · **Cat:** BUG · *(eerste bevinding uit de 47.x-testreeks)*

**Symptoom:** de web-container blijft herstarten (exponentiële back-off). In de logs: `[versie] Lezen van /VERSION mislukt: Cannot access 'fs' before initialization` én `POC Basic Auth is actief maar er zijn geen leerkrachtenaccounts gevonden`.

**Twee losse oorzaken — gevonden en uit elkaar getrokken:**

1. **De crash-loop = de auth-guard, niet de code van 43–47.1.** `checkAuthConfig()` in `server.js` doet `process.exit(1)` als er **geen** leerkracht in de DB én **geen** geldige `.env`-credentials zijn. Na een *herinstall* (optie 14) is de database leeg, en de `.env` had blijkbaar wel `POC_BASIC_PASS` maar geen geldige `POC_BASIC_USER` (leeg of `CHANGE_ME`). De log `[auth] Fallback login actief via POC_BASIC_USER/POC_BASIC_PASS` is misleidend: die kijkt enkel naar het wachtwoord, terwijl de guard óók een geldige gebruikersnaam eist. Omdat de guard *na* `Listening` draait, lijkt de start eerst te lukken en volgt de exit een fractie later. **Dit staat los van de sprint-wijzigingen** — geen van die wijzigingen draait bij het opstarten.
   - **Operationele fix (om weer te starten):** zet in `.env` een echte `POC_BASIC_USER` én `POC_BASIC_PASS` (geen lege waarde / geen `CHANGE_ME`) en herstart; óf voeg een leerkracht toe via `pycodeflow.sh → optie 10` (werkt tegen de DB terwijl de webserver stil ligt — admin.html kan niet, want die heeft de draaiende server nodig). Daarna start de server en kun je verder leerkrachten beheren via admin.html.
2. **`fs`-TDZ in de versie-loader (echte codefix).** `loadVersionFromFile()` draait tijdens module-load (regel ~132) maar `const fs = require('fs')` stond pas op regel ~3262 — dus `fs` zat in zijn *temporal dead zone*. De `try/catch` ving dit op, dus het craêshte niet, maar de app kon zijn eigen `VERSION` niet lezen en viel terug op een **verkeerd versienummer** (o.a. de startpagina-footer uit sprint 45). **Fix:** `const fs = require('fs')` verplaatst naar het requires-blok bovenaan `server.js`, vóór elk gebruik. Latente bug (bestond al vóór 43–47.1), nu opgelost nu hij zichtbaar werd.

**Bewust niet aangeraakt:** de `process.exit(1)`-guard zelf. Dat is opzettelijke beveiliging (draai geen auth-app zonder accounts). Wel een **kleine, veilige verbetering mogelijk** als je wil: de "Fallback login actief"-melding pas tonen als óók de gebruikersnaam volledig is, en de fatale melding het exacte `.env`-pad noemen — zeg maar of ik dat als 47.3 meepak.

**Tests:** regressiestap toegevoegd aan `test-readme.md` (0.2): `/api/version` moet gelijk zijn aan het `VERSION`-bestand — wijkt het af, dan is de versie-loader teruggevallen (precies dit TDZ-symptoom).

---

### Sprint 47.1 — Follow-ups: syntax highlighting + Tip/Hint samenvoegen *(~0.5 dag)* — ✅ AFGEROND (v2026.2.47.1)

**Aangemeld:** 12/07/2026 (afronding van de open puntjes uit sprint 47) · **Cat:** UX · *(decimaal tussengeschoven na 47)*

**Wat is gebouwd:**
- **(c-vervolg) Echte Python syntax highlighting.** Nieuw, **zelf-gehost** bestand `public/code-highlight.js` (geen externe library, geen CDN, CSP-veilig onder `script-src 'self'`). Het haakt in op de code-renderer van `marked` (al geladen op de quizpagina's) en tokeniseert Python: keywords, builtins, strings, comments en getallen krijgen `.tok-…`-spans; kleuren staan in `styles.css` onder `.hl-python`. **Fail-safe:** gaat er iets mis, dan valt een blok terug op gewone (ge-escapete) tekst — code wordt nooit kapotgemaakt, en operatoren als `<`, `>`, `&` worden correct ge-escaped. Ingeladen op `quiz-bank.html`, `quiz-teacher.html` en `quiz-student.html`, dus consistent in editor-preview, leerkracht-preview én leerling-weergave.
- **(a-vervolg) Tip en Hint samengevoegd.** De aparte **Hint-knop** is uit de editor-toolbar gehaald; "Tip" dekt nu één begrip (advies óf hulp). Bestaande vragen met `:::hint` blijven gewoon renderen (backwards-compatibel) — enkel de knop verdwijnt, zodat de verwarring "twee bijna-identieke kaders" weg is. `:::hint` handmatig typen kan technisch nog; wil je het volledig als alias van Tip laten renderen (paars → groen), dan is dat een piepkleine extra stap.

**Tests:** `web/tests/highlight.test.js` toegevoegd (6 unit-tests; `public/code-highlight.js` exporteert de pure functie in een Node-omgeving zodat ze testbaar is). Volledige suite: **165/165 groen**. Handmatig testboek `test-readme.md` uitgebreid met secties 47–53 (sprints 43 t/m 47.1) en bijgewerkt naar v2026.2.47.1.

---

### Sprint 47 — Vraag-editor & vraagweergave verbeteringen *(~1.5 dag)* — ✅ AFGEROND (v2026.2.47.0)

**Aangemeld:** 11/07/2026 (leerkracht-feedback + screenshot) · **Afgerond:** 11/07/2026 · **Cat:** UX

**Wat is gebouwd:**
- **(a) Tip vs Hint — beide behouden, doel verduidelijkt.** Bewust *niet* samengevoegd (dat zou bestaande vragen met `:::hint`/`:::tip` breken). In plaats daarvan zijn de toolbar-tooltips expliciet gemaakt: "Tip: advies vooraf" vs "Hint: hulp bij vastlopen", zodat het onderscheid duidelijk is. Samenvoegen blijft een optie (47.x) als je dat later toch wil. → **gedaan in 47.1** (Hint-knop verwijderd, samengevoegd met Tip).
- **(b) "Kader" → "Extra informatie".** Het label van het blauwe kader is hernoemd in `styles.css` én `quiz-bank.html` (`.info-kader-blauw::before` → "📌 Extra informatie") en de toolbar-tooltip. De onderliggende `:::kader`-syntax blijft ongewijzigd, dus bestaande vragen tonen automatisch het nieuwe label — backwards-compatibel.
- **(c) Python-codeblok als echt code-veld.** Fenced code (```python) rendert via marked als `<pre><code>`; er was geen styling → platte zwarte tekst. Toegevoegd in `styles.css`: `.md-preview pre`/`.q-text pre` als **donker code-veld** (achtergrond #1e1e1e, licht monospace, padding, rounded, horizontale scroll) + nette inline-code-stijl. Consistent in editor-preview, leerling-weergave én leerkracht-preview (alle drie `.md-preview`). *Token-kleuring (echte syntax highlighting) is bewust niet meegenomen:* dat vereist een highlight-library + CSP-uitzondering en is een optionele follow-up (47.x); het donkere code-veld dekt de gevraagde "code-veld layout". → **gedaan in 47.1** (zelf-gehoste highlighter, geen library/CDN).
- **(d) Juist-antwoord groen in de editor.** De nakijk-/verbeterweergave (`quiz-review.js`) kleurde al groen/rood/amber. De resterende gap zat in de **editor**: `.choice-row.correct-row` gebruikte `--primary` (blauw) → nu **groen** (#10b981 / #f0fdf4), consistent met "juist = groen".

**Oorspronkelijke analyse (bij aanmelding):**

Context: de vier info-kaders staan in `quiz-bank.js`/`quiz-student.js`/`quiz-teacher.js` (`:::tip` → `.info-tip`, `:::opgelet` → `.info-opgelet`, `:::kader` → `.info-kader-blauw`, `:::hint` → `.info-hint`); de labels/kleuren in `styles.css` (regels ~352-355).

- **(a) `hint` vs `tip` — is dit niet hetzelfde?** Beide bestaan als aparte kaders (💡 Tip, groen · ❓ Hint, paars). Overwegen om ze samen te voegen tot één begrip, of het onderscheid expliciet te documenteren (bv. Tip = advies vooraf, Hint = hulp bij vastlopen). Beslissing nog te maken.

- **(b) "Kader" hernoemen naar "Extra informatie".** Het blauwe kader achter de duimspijker heet nu "📌 Kader" (`styles.css` + `quiz-bank.html`, `.info-kader-blauw::before { content:'📌 Kader'; }`, en de toolbar-knop-tooltip "Informatiekader (blauw)"). Label wijzigen naar "Extra informatie". *(De onderliggende `:::kader`-syntax kan blijven of mee hernoemd worden — bij hernoemen let op bestaande vragen die `:::kader` gebruiken; best backwards-compatibel houden.)*

- **(c) Python-codeblok als echt code-veld.** Codeblokken in de vraagstelling worden via `marked.parse` als kale `<pre><code>` gerenderd; er is **geen** syntax-highlighting-library (geen Prism/hljs) en **geen** `pre`/`code`-styling in `styles.css` → de Python-code verschijnt als platte zwarte tekst. Toevoegen: een code-veld-look (donkere achtergrond, monospace) en bij voorkeur syntax highlighting, consistent in editor-preview, leerling-view én leerkracht-preview.

- **(d) Juist/fout groen/rood bij nakijken.** *Deels al aanwezig:* in de nakijk-/verbeterweergave (`quiz-review.js`) krijgen keuzes al kleur — gekozen+juist → groen, gekozen+fout → rood, niet-gekozen+juist → amber. Wat de leerkracht als "modelantwoord" bij single/meerkeuze invult werkt als feedbackveld — dat is oké. **Resterende gap:** in de **editor** kleurt het juiste antwoord nu **blauw** (`.choice-row.correct-row` gebruikt `--primary`, niet groen). Afstemmen op groen voor "juist", en verifiëren dat de groen/rood-weergave overal consistent is (editor, nakijk, en waar de leerling zijn resultaat ziet).

---

### Sprint 41 — Schooljaar-selector + read-only gearchiveerde jaren *(~3 dagen)* — ✅ AFGEROND (v2026.2.41.0)

**Aangemeld:** 07/07/2026 · **Uitgevoerd:** 08/07/2026 · bouwt op het membership-model uit sprint 40

**Doel:** leerkrachten kunnen per **schooljaar** filteren en de gegevens van vorige jaren inzien. Gearchiveerde jaren zijn **alleen-lezen** (bekijken en exporteren mag, wijzigen niet) zodat oude cijfers niet per ongeluk veranderen.

**Uitgevoerd:**
- **Database (`db/database.js`):**
  - `listClasses(includeArchived, schoolYear)` — optioneel filteren op schooljaar.
  - Nieuw `getSchoolYears()` — distinct schooljaren uit `classes` (de bron van waarheid voor het membership-model), nieuwste eerst, elk met `allArchived` (via `bool_and`) en `classCount`.
  - Nieuw `isClassArchived(classId)` — `null` (bestaat niet) / `true` / `false`, voor de server-side read-only afdwinging.
- **Server (`server.js`):**
  - `GET /api/admin/classes` accepteert `?schoolYear=`.
  - Nieuw `GET /api/admin/school-years` voor de selector.
  - 🔒 **Read-only afgedwongen server-side**, niet enkel in de UI: `POST /api/admin/students` en `PUT /api/admin/students/:id/class` weigeren een gearchiveerde klas (**403**), of geven 404 als de klas niet bestaat. Zo kan een read-only jaar ook niet via een directe API-call gewijzigd worden.
- **Frontend (`admin.html` + `admin.js`):**
  - Schooljaar-dropdown boven de klassenlijst (gearchiveerde jaren met 🔒). Standaard "Alle jaren".
  - Bij een volledig gearchiveerd jaar: een gele "alleen-lezen"-banner en de actieknoppen worden vervangen door "🔒 alleen-lezen".
  - De selector ververst mee wanneer een klas in een nieuw jaar wordt toegevoegd.

**Belangrijk ontwerp:** de read-only-afdwinging zit **server-side** (403), de UI-markering is enkel een hulpmiddel. Een uitgeschakelde knop alleen zou onvoldoende zijn.

**Tests:** 10 nieuwe in `tests/schoolyear.test.js` (jaar-aggregatie + `allArchived`; sortering nieuwste eerst; de 404/403/200-beslisregel; read-only in de UI). Totaal **159 unit tests**.

**Betrokken bestanden:** `db/database.js` · `server.js` · `public/admin.html` · `public/admin.js` · `tests/schoolyear.test.js` (nieuw)

---

### Sprint 40 — `class_memberships`: lidmaatschap per schooljaar *(~2-3 dagen)* — ✅ AFGEROND (v2026.2.40.0)

**Aangemeld:** 07/07/2026 · **Uitgevoerd:** 08/07/2026 · vers schema, geen datamigratie

**Het probleem dat dit oplost:** `students.class_id` was een directe verwijzing naar één klas. Een leerling hoorde in het datamodel dus voor altijd bij precies één klas. Verplaatste je hem naar volgend jaar, dan klopte de historiek van vorig jaar niet meer. Nu de database leeg herstartbaar is, kon het juiste model meteen in het verse schema — zonder de risicovolle datamigratie.

**Uitgevoerd:**
- **Schema herzien.** `students` is nu puur de **persoon** (naam, status, google-koppeling) — `class_id` is eruit. Nieuwe tabel:
  ```sql
  CREATE TABLE class_memberships (
    student_id  TEXT REFERENCES students(id) ON DELETE CASCADE,
    class_id    TEXT REFERENCES classes(id)  ON DELETE CASCADE,
    school_year TEXT NOT NULL,
    status      TEXT DEFAULT 'active',   -- active | left | pending
    PRIMARY KEY (student_id, class_id, school_year)
  );
  ```
  De oude `UNIQUE INDEX ON students(name, class_id)` verdwijnt; de samengestelde PK borgt nu dat dezelfde leerling niet dubbel in dezelfde klas+jaar zit.
- **Functies herschreven** (`db/database.js`), met behoud van hun signaturen zodat server en frontend ongewijzigd blijven werken:
  - `listStudents(classId)` — via de koppeltabel; zonder classId een lijst met per persoon de samengevatte klassen.
  - `createStudent(name, classId, …)` — maakt de persoon aan en koppelt via het lidmaatschap.
  - `getStudentByName(name, classId)` — zoekt via lidmaatschap.
  - `updateStudentClass(id, classId)` — koppelt aan de nieuwe klas; **oude lidmaatschappen blijven staan** → historiek behouden.
  - `listClasses()` — leerlingtelling via de koppeltabel (matcht op klas + schooljaar).
  - Nieuw: `addStudentToClass(studentId, classId, status)` en `removeStudentFromClass(studentId, classId)`.
  - CSV-import aangepast naar het membership-model.
- **Server & frontend:** ongewijzigd — alle endpoints roepen dezelfde DB-functies aan, en de admin-UI gebruikt `student_count` / `class_name` die de nieuwe queries nog steeds leveren.

**Bewust uitgesteld (niet weg):** het migratiepad (bestaande `class_id` → membership zonder verlies) is nog nodig zodra een school echte, te behouden data heeft. Dat hoort bij **fase 3** van de multi-tenant roadmap (schema-evolutie zonder wissen).

**Tests:** 8 nieuwe in `tests/membership.test.js` (leerling in twee jaren/klassen; historiek intact bij verplaatsen; geen dubbel lidmaatschap; telling per jaar; klassen met dezelfde naam maar ander jaar zijn los). Totaal **154 unit tests**.

**Betrokken bestanden:** `db/database.js` · `tests/membership.test.js` (nieuw)

---

## 🏫 Roadmap — van één school naar een verkoop-/verhuurbaar product (multi-tenant)

**Aangemeld:** 07/07/2026 · **Status:** 🔄 Analyse + plan · **Totale inschatting: ~10-14 weken**

### Waar het systeem nu vastloopt (bevindingen uit de code, 07/07/2026)

De app is gebouwd als **single-tenant**: één installatie = één school. Dat werkt uitstekend voor Atheneum Hoboken, maar deze vijf zaken blokkeren uitrol naar meerdere scholen. Ze zijn hier concreet vastgesteld, niet verondersteld:

1. **🔴 Geen tenant-begrip.** Er bestaat nergens een `school`/`tenant`/`organisatie`-entiteit. De schoolnaam is één omgevingsvariabele (`SCHOOL_NAME` in `server.js`). Geen enkele tabel (`teachers`, `classes`, `students`, `quiz_bank`, `sessions`, …) heeft een `school_id`. **Gevolg:** twee scholen kunnen niet in dezelfde database zonder elkaars data te zien.

2. **🔴 Het leerkracht-cookie identificeert de leerkracht niet.** `teacherCookieValue()` berekent één HMAC uit `BASIC_AUTH_USER` — **dezelfde waarde voor iedereen**. `requireTeacherAuth()` controleert enkel *dát* er een geldig cookie is, niet *wie* het is. **Gevolg:** alle ingelogde leerkrachten zijn onderling inwisselbaar; er is geen echte per-gebruiker sessie. Ook `getActorFromReq()` leest een Basic-auth header die bij de cookie-flow niet meegestuurd wordt, dus de audit-log registreert waarschijnlijk vaak `onbekend`.

3. **🔴 Geen data-isolatie tussen leerkrachten.** `listQuizBank()` filtert niet op `created_by` → elke leerkracht ziet elke vraag. `listClasses()` geeft alle klassen terug. De tabel `teacher_classes` (leerkracht↔klas) bestáát en er is zelfs een `listClassesForTeacher`-query, maar die wordt **nergens gebruikt om toegang te beperken**. De tabel `sessions` heeft **geen eigenaar-kolom** — geen `teacher_id`, niets.

4. **🟠 Eén server-instance.** De live sessiestaat zit in een in-memory `Map` (`const sessions = new Map()`) en er is **geen Redis-adapter voor Socket.IO**. **Gevolg:** je kunt niet horizontaal schalen (geen tweede web-container), en bij een herstart is de live staat weg (wordt wel uit de DB hersteld, maar niet de socket-verbindingen).

5. **🟠 Gedeelde runner.** Alle scholen zouden dezelfde Python-runner delen (`MAX_CONCURRENT_RUNS = 18`). Eén school die de runner belast, vertraagt alle andere. Geen quota of eerlijke verdeling per school.

### Twee mogelijke modellen

| | **A. Instance-per-school** | **B. Echte multi-tenant** |
|---|---|---|
| **Hoe** | Elke school krijgt een eigen container + eigen database | Eén installatie, alle scholen in dezelfde DB, gescheiden via `school_id` |
| **Werk nu** | Weinig (~2-3 weken) | Veel (~10-14 weken) |
| **Isolatie** | Perfect (fysiek gescheiden) | Logisch (afhankelijk van correcte filtering) |
| **Beheer** | Zwaar: elke school apart updaten, backuppen, monitoren | Licht: één update voor iedereen |
| **Kosten/school** | Hoog (eigen container + DB) | Laag (gedeeld) |
| **Schaalt tot** | ~10-20 scholen handmatig | Honderden |

> **✅ BESLIST (15/07/2026) — het wordt model B.** Het ontwerp van de leerkracht-login (één leerkracht, meerdere scholen, keuze bij het inloggen) sluit model A definitief uit: met een installatie per school zou die leerkracht twee losse omgevingen en twee logins hebben. Gevolg: **fase 3 (isolatie + RLS) is verplicht**, niet optioneel. De onderstaande fase-indeling blijft gelden; de concrete uitvoering staat als sprints **49-53 + 48a/b/c** in sectie 1.

*(Historisch — de oorspronkelijke afweging:)* begin met **model A** als je 1-5 scholen wil bedienen (snel geld verdienen, weinig risico), maar bouw **stap 1 en 2 hieronder nu al** zodat de overstap naar B later geen herschrijving vraagt. Voor een echt "verkoopbaar" SaaS-product (>10 scholen) is **B** nodig.

### Plan van aanpak — gefaseerd

#### Fase 1 — Echte per-gebruiker authenticatie *(~2 weken)* 🔴 FUNDAMENT
Dit moet sowieso, in beide modellen. Zonder dit is niets anders zinvol.
- Vervang het gedeelde HMAC-cookie door een **sessie per gebruiker**: een `teacher_sessions`-tabel (of ondertekende JWT) met `teacher_id`, `expires_at`, `created_at`.
- `requireTeacherAuth()` laadt de leerkracht uit de sessie en zet `req.teacher = { id, username, role, school_id }`.
- `getActorFromReq()` gebruikt `req.teacher` i.p.v. de Basic-auth header → audit-log klopt eindelijk.
- Uitloggen = sessie invalideren (nu onmogelijk, want het cookie is een vaste waarde).
- **Tests:** twee leerkrachten krijgen verschillende cookies; leerkracht A's cookie geeft geen toegang tot B's identiteit; verlopen sessie → 401.

#### Fase 2 — Eigenaarschap + autorisatie *(~2 weken)* 🔴 FUNDAMENT
- Voeg `teacher_id` (eigenaar) toe aan `sessions` en gebruik `created_by` op `quiz_bank` daadwerkelijk om te filteren.
- Autorisatiemiddleware: een leerkracht mag enkel eigen sessies openen/sluiten/verwijderen; een admin mag alles binnen de school.
- Gebruik de bestaande `teacher_classes` om klassen te filteren (`listClassesForTeacher` bestaat al, wordt nu genegeerd).
- **Deelbaarheid:** vragenbank wordt standaard privé, met een expliciete "delen met collega's"-vlag per vraag (`shared` boolean). Anders is de bank onbruikbaar in een school met 10 leerkrachten.
- **Tests:** A ziet B's sessies niet; A kan B's vraag niet bewerken; gedeelde vragen zijn zichtbaar; admin ziet alles binnen de eigen school.

#### Fase 3 — Tenant-model (`school_id`) *(~3 weken)* — alleen bij model B
- Nieuwe tabel `schools` (naam, logo, licentie, contact, aangemaakt_op, actief).
- `school_id` toevoegen aan: `teachers`, `classes`, `students`, `quiz_bank`, `sessions`, `audit_log` (+ migraties, bestaande data → school 1).
- **Elke** query filtert op `school_id`. Dit is het risicovolste deel: één vergeten filter = datalek tussen scholen.
- Mitigatie: filtering afdwingen op één centrale plek (een `scopedQuery(schoolId, …)`-helper of PostgreSQL **Row-Level Security**), niet per query handmatig. RLS is hier sterk aan te raden — de database dwingt het dan af, niet de applicatiecode.
- Aparte super-admin rol (Anthropic-style "beheerder over scholen heen") voor jou als leverancier.
- **Tests:** uitgebreide isolatie-suite — school A ziet nul rijen van school B, per tabel. Dit verdient de zwaarste testinspanning van het hele project.

#### Fase 4 — Schaalbaarheid *(~2 weken)*
- **Socket.IO Redis-adapter** + verwijder de in-memory `sessions`-Map als bron van waarheid (of synchroniseer via Redis) → meerdere web-containers mogelijk.
- **Runner-quota per school**: eerlijke verdeling van `MAX_CONCURRENT_RUNS`, of een runner-pool per school. Voorkomt dat één school de rest platlegt.
- Connection pooling nakijken (`pg` pool-grootte) en indexen controleren op de nieuwe `school_id`-kolommen.
- Load-test met de bestaande stress-test-tooling, maar dan met meerdere scholen tegelijk.

#### Fase 5 — Product-laag *(~3 weken)* — pas zinvol na 1-3
Wat een systeem "verkoopbaar" maakt bovenop de techniek:
- **Onboarding**: een school aanmaken, eerste admin uitnodigen, klassen importeren (CSV), zonder dat jij handmatig in de DB moet.
- **Licentie/abonnement**: limieten per school (aantal leerkrachten, leerlingen, sessies), vervaldatum, en wat er gebeurt bij verlopen.
- **Branding per school**: logo en naam nu via `SCHOOL_NAME`/`SCHOOL_LOGO_PATH` env-var → naar de `schools`-tabel. Sprint 42 legt de **frontend-haak** (`/api/school-info` → balk-logo) en de placeholder aan; fase 3 koppelt dit per school aan de `schools`-tabel en laat een logo meegeven bij het aanmaken van een school.
- **Facturatie**: buiten scope van de app zelf, maar de licentiedata moet het ondersteunen.
- **Selfservice-beheer**: wachtwoord-reset per e-mail (nu enkel via `pycodeflow.sh` op de NAS — onwerkbaar voor externe scholen).
- **Status/monitoring per school**: de bestaande monitoring-pagina uitbreiden met een school-filter.

#### Fase 6 — Juridisch & operationeel *(parallel, niet-technisch)*
Bij verkoop aan scholen worden dit harde eisen, geen bijzaken:
- **GDPR/AVG**: verwerkersovereenkomst per school, bewaartermijnen (leerlingdata!), recht op verwijdering, dataportabiliteit. Je verwerkt persoonsgegevens van minderjarigen — dit is zwaarder gereguleerd.
- **Toegankelijkheid**: Prioriteit 6 (a11y) is voor overheidsscholen een **wettelijke** vereiste (EN 301 549 / WCAG 2.1 AA). Nu geparkeerd; wordt bij verkoop verplicht.
- **Hosting**: de NAS + Cloudflare-tunnel volstaat niet voor meerdere scholen (beschikbaarheid, backup-garanties, SLA). Verhuizen naar een echte hostingomgeving.
- **Backup & herstel per school**: `backup-db.sh` dumpt nu de hele database. Bij multi-tenant wil je per school kunnen herstellen zonder de rest te raken.
- **Support & updates**: hoe rol je een fix uit, hoe communiceer je downtime, wie is aanspreekpunt.

### Aanbevolen volgorde

1. **Eerst de openstaande sprints afwerken** (37, 38, en Prioriteit 6 a11y — die laatste wordt juridisch verplicht).
2. **Fase 1 + 2** (echte login + eigenaarschap): ~4 weken. Dit heeft **ook nu al waarde** voor één school met meerdere leerkrachten — vandaag zien collega's elkaars vragen en sessies. Dit is de beste eerstvolgende investering, ongeacht of je ooit verkoopt.
3. **Beslismoment:** model A (instance per school) of B (multi-tenant)? Hangt af van je ambitie: 5 scholen of 50.
4. Bij model B: **fase 3** met Row-Level Security, en een isolatie-testsuite die je serieus neemt.
5. **Fase 4 + 5** wanneer de eerste betalende school er is.
6. **Fase 6** parallel opstarten zodra verkoop concreet wordt — juridisch loopt vaak trager dan techniek.

### Belangrijkste risico's

- **Datalek tussen scholen** (fase 3). Eén vergeten `WHERE school_id = …` en school A ziet de toetsen van school B. Daarom RLS op databaseniveau i.p.v. vertrouwen op applicatiecode.
- **Migratie van bestaande data** (relevant vanaf fase 3, niet nu). Zolang de database leeg herstartbaar is, bouwen we het schema vers. Zodra een school echte data heeft die behouden moet blijven, moet de schema-evolutie (o.a. `school_id` toevoegen, `class_memberships` invullen) mét migratie gebeuren, zonder verlies. Dat migratiepad wordt in fase 3 uitgewerkt en getest.
- **Scope-creep in fase 5.** Facturatie en onboarding zijn een product op zich. Begin handmatig (jij maakt scholen aan), automatiseer pas bij volume.
- **De fundament-fases overslaan.** Fase 3 bouwen zonder fase 1-2 betekent dat je tenant-isolatie bouwt op een auth-systeem dat gebruikers niet eens uit elkaar houdt.

---

## 🧭 Domeinmodel & instapstructuur (aanvulling 07/07/2026)

Deze sectie werkt het **datamodel** en de **entry points** uit die bij fase 2-3 horen. Ze vormen de kern van het multi-tenant ontwerp.

### Instapstructuur (domeinen & flows)

Huidige situatie: `pycodeflow.org` = startpagina, `app.pycodeflow.org` = keuzepagina.

**Voorgestelde structuur:**

```
pycodeflow.org                      → publieke startpagina + keuze: leerkracht of leerling
   ├── leerling   → app.pycodeflow.org/student   → leerling-login  OF  "vrije sessie"
   └── leerkracht → app.pycodeflow.org/teacher   → leerkracht-login
                                                     └── indien >1 school: school-keuze (pop-up)
```

- **`pycodeflow.org`** blijft de marketing-/landingspagina. Enige functie in de app-flow: doorverwijzen naar de juiste ingang. Geen inlogformulier hier.
- **Leerling** → `app.pycodeflow.org` met ofwel de leerling-login (zodra sprint 14/15 gekozen is), ofwel de bestaande **vrije sessie** (code + naam + klas). De vrije-oefenmodus moet blijven werken **zonder** account — dat is een sterkte, niet iets om weg te ontwerpen.
- **Leerkracht** → eigen login. **Als de leerkracht aan meerdere scholen hangt**, verschijnt na het inloggen een **school-keuze** (modal). De gekozen school komt in de sessie (`req.teacher.active_school_id`) en bepaalt vanaf dan **alle** zichtbare data. Wisselen van school = een expliciete actie in de navigatiebalk die de sessie-scope herzet.

**Belangrijk beveiligingspunt:** de actieve school mag **nooit** uit een URL-parameter of request-body komen — enkel uit de server-side sessie, en enkel na controle dat de leerkracht daadwerkelijk aan die school gekoppeld is. Anders volstaat het een id te wijzigen om andermans school te bekijken.

### Domeinmodel

De hiërarchie die je beschrijft:

```
school
  └── leerkracht        (veel-op-veel: een leerkracht kan aan meerdere scholen hangen)
        └── klas        (per school én per schooljaar)
              └── leerling  (lidmaatschap geldt per schooljaar)
```

**Wat er al is (goed nieuws):**
- `classes` heeft **al** `school_year` én `archived`. Archiveren van een jaar bestaat dus al.
- `quiz_meta` heeft **al** `school_year` — toetsen zijn al per jaar getagd.
- `teacher_classes` (leerkracht↔klas, veel-op-veel) bestaat al — maar wordt nergens gebruikt om toegang te beperken (zie fase 2).

**Wat ontbreekt — en één echt modelprobleem:**

1. **Geen `schools`-tabel** en geen `school_id` op `classes`/`teachers`. → fase 3.

2. **🔴 Leerling-lidmaatschap is niet per jaar.** Dit is het belangrijkste ontwerppunt. `students.class_id` is een **directe verwijzing naar één klas**. Een leerling hoort dus in het datamodel voor altijd bij precies één klas. Maar terecht opgemerkt: *"de klas met hun studenten is altijd afhankelijk van jaar aangezien de samenstelling wijzigt."*

   Met het huidige model kan dat niet. Verplaats je een leerling naar de klas van volgend jaar, dan lijkt het alsof hij vorig jaar óók al in die klas zat — de historiek klopt niet meer. Maak je een nieuwe leerling-rij per jaar, dan verlies je de identiteit (dezelfde persoon, twee records; `google_email` is bovendien `UNIQUE`, dus dat botst zelfs).

   **Oplossing: een koppeltabel voor lidmaatschap.**
   ```sql
   CREATE TABLE class_memberships (
     student_id   TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
     class_id     TEXT NOT NULL REFERENCES classes(id)  ON DELETE CASCADE,
     school_year  TEXT NOT NULL,
     status       TEXT NOT NULL DEFAULT 'active',   -- active | left | pending
     PRIMARY KEY (student_id, class_id, school_year)
   );
   ```
   De leerling (persoon) bestaat **één keer**; het lidmaatschap van een klas bestaat **per schooljaar**. Zo blijft de historiek intact: je ziet dat Jan in 2024-2025 in 3A zat en in 2025-2026 in 4B. `students.class_id` wordt daarmee overbodig.

   > **🟢 Vereenvoudigd (08/07/2026):** de database is op dit moment leeg (enkel testdata die weg mag). We bouwen het **juiste eindmodel meteen in het verse schema** — `class_memberships` als koppeltabel, géén `students.class_id` meer — zonder datamigratie. Dat schrapt het zwaarste en risicovolste deel van sprint 40. **De eerste school (Atheneum Hoboken) begint dus met een schone lei**, net als elke latere school. Zie de aangepaste inschatting hieronder.
   >
   > ⚠️ **Wel bewust van:** de migratielogica (bestaande `class_id` → membership zonder verlies, en de `UNIQUE INDEX` veilig verhuizen) is hiermee **niet weg, enkel uitgesteld**. Zodra een school echte, te behouden leerlingdata heeft, is een beproefd migratiepad nodig. Dit hoort thuis bij **fase 3** van de multi-tenant roadmap (schema-evolutie zonder wissen) en wordt daar opgepakt.

3. **Inzage in vorige jaren.** Zodra lidmaatschap per jaar bestaat, wordt dit vanzelf mogelijk. Nodig:
   - Een **schooljaar-selector** in de leerkracht-UI (klassen, vragenbank, toetsarchief). Standaard het huidige jaar; gearchiveerde jaren blijven kiesbaar.
   - Gearchiveerde klassen/jaren zijn **read-only**: bekijken en exporteren mag, wijzigen niet. Dat voorkomt dat oude cijfers per ongeluk veranderen.
   - De bestaande `archived`-vlag blijft de "verborgen tenzij expliciet getoond"-schakelaar; ze mag data **nooit verwijderen**.
   - Let op bewaartermijnen (GDPR, fase 6): oude leerlingdata mag niet eeuwig bewaard blijven. Een expliciet bewaarbeleid per school is nodig.

### Extra sprints die hieruit volgen

| Sprint | Cat | Inhoud | Status | Inschatting |
|---|---|---|---|---|
| **40** | 🔵 ARCH | `class_memberships`-tabel in **vers schema** (leerling-lidmaatschap per schooljaar; géén datamigratie nu) | ✅ Afgerond (v2026.2.40.0) | ~2-3 dagen |
| **41** | 🔵 ARCH | Schooljaar-selector in de leerkracht-UI + read-only gearchiveerde jaren | ✅ Afgerond (v2026.2.41.0) | ~3 dagen |
| **42** | 🔵 ARCH | Instapstructuur: deel C (branding/schoollogo) ✅ afgerond v2026.2.42.0; deel A+B (startpagina + `/student`/`/teacher`) → **sprint 45** | 🔄 Deels afgerond | ~2 dagen (restant) |
| **48** | 🔵 ARCH | School-keuze bij leerkracht-login (modal indien >1 school) + `active_school_id` in de sessie | 🔄 Gepland | ~3 dagen |

**Afhankelijkheden:** sprint 48 vereist fase 1 (echte per-gebruiker sessie) én fase 3 (`schools`-tabel). Sprint 40 kan **nu al**, onafhankelijk van multi-tenancy — en is ook voor één school waardevol, want vandaag kun je de klassamenstelling van vorig jaar niet correct bewaren. Sprint 42 kan eveneens nu al.

**Aanbeveling:** doe **sprint 40 vroeg** en benut het lege-database-venster. Nu bouwen betekent het juiste model meteen goed, zonder migratiecode. Zodra er echte leerlingdata in zit, is dat venster gesloten en wordt een schema-evolutie mét migratie nodig (fase 3).

---

> **Leerling-authenticatie — ✅ BESLIST (15/07/2026):** eigen login op **e-mail + wachtwoord** (sprint 52; registratie via klascode + domeincheck + e-mailverificatie). **Sprints 14 en 15 vervallen.** Dit raakt sprint 37 (nakijk-modus): zolang 52 niet af is, steunt de nakijk-toegang op naam+klas+code — een bewust aanvaarde beperking, afgeschermd door rate-limiting en doordat de leerkracht de nakijk-modus expliciet moet openstellen. **Zodra 52e (leerling-login) live is, wordt de nakijk-toegang daarop gebaseerd.**

---


## Detailtabel — alle sprints (legacy overzicht)

> Dit is het historische overzicht met alle sub-sprints en hun status.
> De beknopte uitvoervolgorde staat bovenaan in sectie 3.

| Sprint | Cat | Inhoud | Status | Inschatting |
|---|---|---|---|---|
| **28a** | 🔴 BUG | Vraagtypen automatische scoring (sprint 18a/18b) | ✅ Al aanwezig in server.js | ~4 dag |
| **28b** | 🟡 TECH | check-deployment.sh sprint 12+ | ✅ Al voldoende in v2026.2.27.0 | ~0.5 dag |
| **28c** | 🟠 UX | DOMPurify na marked.parse() — XSS-beveiliging (R-01) | ✅ Afgerond | ~0.5 dag |
| **28d** | 🟠 UX | quiz-review.html subnav actief-markering | ✅ Afgerond | ~0.5 dag |
| **28f** | 🔴 BUG | free_run_rate_limited structuurfout (loshangende regels) | ✅ Afgerond | ~0.5 dag |
| **27a-g** | 🔴 BUG | check-deployment.sh: bash regex + syntaxfouten (5 valse FAILs) | ✅ Afgerond | ~0.5 dag |
| **27h** | 🟠 UX | Tooltips op 34 icon-only knoppen | ✅ Afgerond | ~1 dag |
| **27i** | 🔴 BUG | teacher-grid leerlingenoverzicht leeg (deels — zie 29a) | ✅ Afgerond | ~0.5 dag |
| **27j** | 🟠 UX | Editor dark/light toggle verwijderd | ✅ Afgerond | ~0.5 dag |
| **27k** | 🔴 BUG | Leerling kan niet runnen in individuele modus | ✅ Afgerond | ~0.5 dag |
| **27l** | 🔴 BUG | Database viewer "query is not a function" | ✅ Afgerond | ~0.5 dag |
| **27m** | 🔴 BUG | Kan niet inloggen na verse installatie (bootstrap admin) | ✅ Afgerond | ~0.5 dag |
| **27n** | 🟠 UX | pycodeflow.sh optie 19: DB-beheer menu | ✅ Afgerond | ~1.5 dag |
| **25a-h** | 🟠 UX | Rijke vraagstelling editor (toolbar, kaders, tabel, split-view, pyAlert, live preview) | ✅ Afgerond | ~6 dagen |
| **24a-h** | 🟠 UX | UI/UX ronde 2 (modals, layout, DB-viewer) | ✅ Afgerond | ~5.5 dagen |
| **23a-r** | 🔴 BUG | Senior tester audit (18 subtaken) | ✅ Afgerond | ~9 dagen |
| **22a-k** | — | Bugfix & UX ronde | ✅ Afgerond (v2026.2.22.0) | ~6.5 dagen |
| **21** | 🟠 P2-3 | Systeembeheer volledig up-to-date | ✅ Afgerond (v2026.2.17.0) | ~1.5 dag |
| **20a-b** | 🟠 P2 | Audit-log + wachtwoord-reset flow | ✅ Afgerond (v2026.2.17.0) | ~2 dagen |
| **19a-j** | 🔴 P1 | Betrouwbaarheid + Markdown + backup + notificaties | ✅ Afgerond (v2026.2.16.0/17.0) | ~8 dagen |
| **17a-b** | — | Log rotatie + toets/taak archief | ✅ Afgerond (v2026.2.14.0) | ~2.5 dagen |
| **16a-f** | — | Toetsmodule (volledig) | ✅ Afgerond (v2026.2.13.0) | ~10 dagen |

---

### Sprint 29 — Bugs & regressies *(~1.1 dag)*

**Aangemeld:** 05/07/2026 · **Status:** ✅ Afgerond (v2026.2.29.0) · gepland voor v2026.2.29.0

---

### Sprint 29_part2 — Vervolgbugs uit gebruikerstests *(~1.5 dag)*

**Aangemeld:** 05/07/2026 · **Status:** ✅ Afgerond (v2026.2.29.1)
**Aanleiding:** Bij het testen kwamen vier problemen naar boven die in één vervolgsprint zijn opgelost.

#### 29p2-a 🔴 — Editor-config niet direct toegepast
**Probleem:** In individuele modus werden hulp-instellingen (auto-indent, auto-brackets enz.) niet meteen toegepast — pas na een andere trigger. Op het leerkrachtscherm in klasmodus veranderde dit ook niet.

**Rootcause:** `emitConfigChange` stuurde de wijziging enkel naar de server (die broadcastte naar leerlingen), maar de **leerkracht-editor zelf** werd nooit lokaal bijgewerkt. Bovendien las `updateEditorConfig('teacher')` een lege `_sessionConfig` omdat die nooit uit de teacher session data werd gepopuleerd.

**Fix:**
1. `emitConfigChange` werkt nu `_sessionConfig` bij én roept meteen `updateEditorConfig('teacher')` aan → directe toepassing
2. `updateEditorConfig` gebruikt `_sessionConfig` voor zowel `student` als `teacher` owner
3. De teacher session data handler populeert nu `_sessionConfig` uit `data.config` (zoals de leerling al deed) + werkt het config-paneel bij

#### 29p2-b 🔴 — Vragenbank-knoppen werkten niet
**Probleem:** Knoppen in de vragenbank reageerden niet, waardoor toetselementen niet getest konden worden.

**Rootcause:** De window-exports stonden ná de init-code (`loadSubjects`/`loadQuestions`). Als de init faalde, werden de window-toewijzingen nooit bereikt — precies het sprint 26-regressiepatroon.

**Fix:** Window-exports verplaatst vóór de init, elk in een eigen try/catch. Alle handler-functies zijn hoisted `function`-declaraties zodat ze altijd beschikbaar zijn.

#### 29p2-c 🟠 — Layout "nieuwe toets" eerste blok onleesbaar
**Probleem:** Het Timer/Vraagvolgorde-blok bovenaan "nieuwe toets" liep visueel op niets — radio's en labels door elkaar, "aanbevolen" badge verkeerd geplaatst.

**Fix:** Herstructureerd met uniforme `.opt-card` keuze-kaarten (radio + titel + beschrijving in een nette kaart). De "aanbevolen" tekst is nu een `.opt-badge` pill. Responsive via bestaande `.form-row-2` media-query.

#### 29p2-d 🟠 — Login onmogelijk na rebuild (verkeerd verwacht wachtwoord)
**Probleem:** Na een rebuild kon niet ingelogd worden, ook al stond er een leerkracht in admin. Oorzaak was operationeel: de gebruiker kende de inlognaam/wachtwoord van het bootstrap-account niet.

**Fix (meerledig):**
1. **server.js bootstrap-logging** toont nu in een duidelijk kader de exacte inlognaam bij het aanmaken, en logt bij bestaande leerkrachten de inlognaam/-namen zodat altijd zichtbaar is waarmee ingelogd moet worden (inlognaam = username, NIET de weergavenaam).
2. **pycodeflow.sh optie 19k** — "🆘 Kan niet inloggen?" — toont alle leerkrachten en zet in één flow een nieuw wachtwoord, met duidelijke instructie om met de inlognaam in te loggen. `manage-teacher.js reset-password` gebruikt exact hetzelfde scrypt-hashformaat als server.js, dus de reset werkt gegarandeerd.

**Betrokken bestanden:** `app.js` · `quiz-bank.html` · `quiz-teacher.html` · `server.js` · `pycodeflow.sh`

---

### Sprint 30-cfg — Sessie-instellingen niet live *(~0.5 dag, KRITIEK)*

**Aangemeld:** 05/07/2026 · **Status:** ✅ Afgerond (v2026.2.34.3)

**Probleem (zie screenshot):** In het paneel "Sessie-instellingen" nemen wijzigingen (auto-indent, auto-sluiten haakjes enz.) niet onmiddellijk effect. Een aangevinkte wijziging wordt pas toegepast op de editor zodra een **andere** checkbox wordt aangeklikt. De aanhef belooft nochtans "Wijzigingen worden live gesynchroniseerd naar alle leerlingen".

**Waarom nog steeds stuk na 29p2-a:** Sprint 29p2-a zorgde ervoor dat `emitConfigChange` `_sessionConfig` bijwerkt en `updateEditorConfig('teacher')` aanroept. Maar het effect blijft één stap achterlopen. Vermoedelijke rootcause: `editor.updateOptions()` van Monaco past sommige opties (met name `autoIndent`) niet toe op de **reeds geopende** editor tot er een nieuwe render/interactie plaatsvindt — de volgende checkbox-klik triggert die render, waardoor de vórige wijziging "ineens" actief lijkt. Het is dus een off-by-one in de toepassing, niet in de dataflow.

**Twee mogelijke oplossingen (afgewogen bij aanmelding):**

1. *Live echt laten meevolgen:* na `editor.updateOptions(...)` een re-layout forceren. Behoudt het live-gevoel maar blijft gevoelig voor Monaco-timing bij `autoIndent`.
2. **Bevestigen met een knop (GEKOZEN):** de checkboxes registreren enkel de gewenste staat; pas bij een expliciete **"Toepassen"-knop** wordt de volledige config in één keer naar server + editors gestuurd. Deterministisch, geen Monaco-timingissues.

**Gekozen aanpak — oplossing 2:**
- De config-toggles roepen niet langer per wijziging `emitConfigChange` aan; ze werken enkel een lokale "pending"-staat bij en markeren dat er niet-opgeslagen wijzigingen zijn.
- Een nieuwe **"Toepassen"-knop** onderaan het paneel stuurt alle waarden in één keer door (server-broadcast + directe toepassing op de leerkracht-editor).
- De knop toont enkel als er wijzigingen zijn (of is altijd zichtbaar maar disabled tot er iets wijzigt), met een korte bevestiging ("✓ Toegepast") na klikken.
- Zo is het gedrag volledig deterministisch en verdwijnt de off-by-one.

**Uitgevoerd (v2026.2.34.3):**
- `teacher-app.html`: checkboxes roepen nu `markConfigDirty()` aan; "Toepassen"-knop + statusregel. Belofte-tekst aangepast ("Kies je instellingen en klik op Toepassen").
- `app.js`: `emitConfigChange` vervangen door `markConfigDirty()` (zet dirty-vlag) en `applyConfigChanges()` (verzamelt alle toggles, stuurt de volledige config via `teacher_apply_session_config`, past meteen toe op de leerkracht-editor, toont "✓ Toegepast").
- `server.js`: handler `teacher_apply_session_config` valideert de volledige config via `lib/validation.js` (whitelist + booleancheck) en broadcast in één keer. Oude per-key handler blijft voor compatibiliteit.
- Tests: 9 nieuwe validatie/scenario-tests in `tests/validation.test.js` (whitelist, non-boolean weigering, lege config). Totaal nu 54 unit tests.

**Betrokken bestanden:** `app.js` · `teacher-app.html` · `server.js` · `lib/validation.js` · `tests/validation.test.js`

---

### Sprint 30-copy — Contextuele kopieerknop *(~0.5 dag)* — ✅ AFGEROND (v2026.2.34.3)

**Probleem:** De "Kopieer output"-knop zweefde absoluut-gepositioneerd over het output-paneel (ongelukkig geplaatst), los van de "Kopieer code"-knop in de toolbar.

**Oplossing:** Eén contextbewuste kopieerknop in de toolbar van teacher-app, student-app en free-editor:
- `copyContextual(owner)` kopieert de **code** als het code-paneel zichtbaar is, de **output** als het output-paneel zichtbaar is.
- Werkt in alle modi: klas (gedeeld), individueel (examen), student en vrije editor.
- `updateCopyButtonLabel(owner)` houdt de tooltip actueel bij tabwissel (via `setTab`).
- Zwevende `copy-output-btn` knoppen + CSS verwijderd; oude losse listeners opgeruimd.

**Betrokken bestanden:** `app.js` · `teacher-app.html` · `student-app.html` · `free-editor.html` · `styles.css`

---

### Sprint 30 — Security hardening (30a/c/d) *(~1.7 dag)* — ✅ AFGEROND (v2026.2.34.4)

**Aangemeld:** 05/07/2026 · **Status:** ✅ Afgerond (v2026.2.34.4)

#### 30a — Login-cookie met Max-Age
Het `teacher_auth` cookie werd zonder `Max-Age` gezet → sessiecookie dat verdween bij het sluiten van de browser, zonder bewuste sessieduur. **Fix:** configureerbare sessieduur via `POC_SESSION_MAX_AGE_HOURS` (standaard 8u = schooldag). `setTeacherCookie` voegt nu `Max-Age` toe; `0` behoudt het oude sessiecookie-gedrag. 6 tests.

#### 30c — upgrade-insecure-requests in CSP
De CSP miste `upgrade-insecure-requests`, waardoor mixed content niet automatisch naar HTTPS werd geüpgraded. **Fix:** directive toegevoegd aan de Content-Security-Policy header. 4 tests op de CSP-structuur.

#### 30d — Automatische DB-backup
Het backup-menu (pycodeflow.sh optie 16) verwees naar `scripts/backup-db.sh` dat **nooit bestond** — de hele backup- en cron-functie was dood. **Fix:** volwaardig `scripts/backup-db.sh` gemaakt: `pg_dump` → gzip → `backups/`, met retentie (`BACKUP_RETENTION_DAYS`, standaard 7d), lege-dump-detectie en logging. De bestaande cron-optie (dagelijks 02:00) werkt nu. Restore-flow gefixed (ontbrekende `PGPASSWORD`).

**Tests:** 10 nieuwe tests in `tests/security.test.js` (cookie Max-Age, CSP). Totaal 64 unit tests.

**Betrokken bestanden:** `server.js` · `scripts/backup-db.sh` (nieuw) · `pycodeflow.sh` · `.env.example` · `tests/security.test.js`

---

### Sprint 36 — Data-integriteit (36a/b/c/d) *(~4.5 dagen)* — ✅ AFGEROND (v2026.2.34.5)

**Aangemeld:** 05/07/2026 · **Status:** ✅ Afgerond (v2026.2.34.5)

#### 36a — Transacties bij multi-step schrijfacties
`createQuizSession` schreef `quiz_meta` en dan in een lus alle vraag-snapshots, elk met een **aparte** DB-connectie. Bij een crash midden in de lus bleef een toets met meta maar zonder (of met halve) vragen achter. **Fix:** nieuwe `withTransaction(fn)`-helper in database.js (BEGIN/COMMIT, ROLLBACK bij fout, client altijd vrijgegeven). `createQuizSession` én `saveQuizStudentOrder` (per-leerling volgorde) draaien nu atomair. `persistSession` bleek al atomair (single INSERT ON CONFLICT) → geen wijziging nodig.

#### 36b — persistSession debounce
Al aanwezig en correct: `schedulePersist` (2s debounce) voorkomt dat elke toetsaanslag een DB-write triggert; `persistNow` voor kritieke operaties (delete/close). Sessie-creatie persisteert bewust meteen. Geverifieerd, geen wijziging nodig.

#### 36c — Centrale validatie breder ingezet
De ad-hoc validatie in de admin-endpoints (teacher-create, role-update) loopt nu via `lib/validation.js` (`isValidRole`, `clampString`). Consistent met de config-validatie uit sprint 30-cfg.

#### 36d — Dependencies gepind
`package.json` gebruikte overal `^` (caret) → minor auto-updates, niet-reproduceerbare builds. Alle dependencies gepind op exacte versies (express 4.19.2, socket.io 4.7.5, pg 8.13.0, enz.). `npm audit` draait al in de CI (run-tests.sh sectie 5).

#### 🚨 Kritieke bug ontdekt & opgelost: hash-formaat mismatch
Bij het onderzoek voor 36c bleek dat de sprint 34a-refactor een latente bug had geïntroduceerd: `lib/auth.js createPasswordHash` geeft **één string** terug (`scrypt$...`), maar twee admin-endpoints (`POST /api/admin/teachers`, `PUT .../password`) deden nog `const { hash, salt } = createPasswordHash(...)` en bouwden `${hash}:${salt.toString('hex')}`. Omdat de functie een string teruggeeft, waren `hash` en `salt` **undefined** → `.toString('hex')` crashte, en het aanmaken/wijzigen van leerkrachtaccounts via admin.html was **kapot**. **Fix:** beide endpoints gebruiken nu direct de string. Het canonieke formaat (`scrypt$N$r$p$saltB64$hashB64`) is consistent tussen lib/auth.js, verifyPasswordWithHash, manage-teacher.js en de bootstrap. 3 nieuwe tests borgen dit.

**Tests:** 3 hash-consistentie + 4 transactie-tests. Totaal 70 unit tests.

**Betrokken bestanden:** `database.js` · `server.js` · `package.json` · `lib/validation.js` · `tests/auth.test.js` · `tests/transaction.test.js` (nieuw)

---

### Sprint 31 — UX & consistentie (31a/b/c) *(~2.5 dagen)* — ✅ AFGEROND (v2026.2.34.6)

**Aangemeld:** 05/07/2026 · **Status:** ✅ Afgerond (v2026.2.34.6)

#### 31b — localStorage-sleutels geharmoniseerd
De sleutels gebruikten inconsistent de `pycodeflow_` prefix (sommige wel, meeste niet) — botsingsrisico en verwarrend, gerelateerd aan de 29a-bug. **Fix:** `setLS`/`getLS`/`delLS` voegen de prefix nu transparant toe (`_lsKey`), zodat call-sites de korte naam gebruiken en alles consistent `pycodeflow_`-geprefixt is. Alle directe `localStorage.*`-calls in app.js vervangen door de helpers. Een eenmalige migratie hernoemt bestaande oude sleutels naar de geprefixte variant, zodat gebruikers hun sessie/naam niet verliezen bij de upgrade. 9 tests.

#### 31a — Consistente loading states
Er was geen herbruikbare laad-indicator (pagina's toonden ad-hoc "Laden…" tekst). **Fix:** herbruikbare `.spinner` / `.spinner-lg` / `.loading-row` CSS-component + een `loadingHtml(tekst)` JS-helper voor een uniforme laad-weergave.

#### 31c — Uniforme foutmeldingen
De app mengde blokkerende browser-`alert()`/`confirm()` met de eigen pyAlert/pyToast/pyConfirm. **Fix:** alle 11 browser-`alert()` en de resterende `confirm()` in app.js vervangen door `pyAlert` (fouten/waarschuwingen), `pyToast` (successen) en `pyConfirm` (bevestigingen). Consistente, niet-blokkerende in-app meldingen overal.

**Tests:** 9 nieuwe storage-tests (prefix + migratie). Totaal 79 unit tests.

**Betrokken bestanden:** `app.js` · `styles.css` · `tests/storage.test.js` (nieuw)

---

### Sprint 32 — Technische schuld (32a/b/c) *(~5.5 dagen)* — ✅ AFGEROND (v2026.2.34.7)

**Aangemeld:** 05/07/2026 · **Status:** ✅ Afgerond (v2026.2.34.7)

#### 32b — Gestructureerde logger met niveaus
43 losse `console.*`-statements in server.js, alles altijd geprint. **Fix:** nieuwe `lib/logger.js` met niveaus (error < warn < info < debug) en een `LOG_LEVEL` env-var (standaard `info`). Elke regel krijgt een tijdstempel + niveau-prefix. Alle `console.*` (behalve de decoratieve bootstrap-box) vervangen door `log.error/warn/info`. Op `info` geen debug-ruis; zet `LOG_LEVEL=debug` voor uitgebreide logs. 11 tests.

#### 32c — Monaco-versie centraal
Monaco wordt geserveerd vanuit `node_modules/monaco-editor`; de versie is sinds 36d al centraal gepind in package.json (0.47.0). De HTML verwijst enkel naar het route-prefix `/monaco/min/vs` — nergens een los versienummer. Verificatie + verduidelijkende comment toegevoegd. Eén Monaco-update = enkel package.json + rebuild.

#### 32a — Inline scripts naar aparte bestanden
8 pagina's hadden grote inline `<script>`-blokken (monitoring 758 rgls, quiz-bank 552, quiz-student 502, …). **Fix:** alle inline JS geëxtraheerd naar aparte bestanden (`monitoring.js`, `quiz-bank.js`, enz.), ingeladen via `<script src>`. De code verhuist alleen — top-level functies blijven globaal (external scripts delen global scope), dus de inline `onclick`-handlers blijven werken. Laadvolgorde bewaakt: pagina-scripts laden ná hun afhankelijkheden (marked, DOMPurify, socket.io, Monaco). Dit deblokkeert sprint 30b (unsafe-inline uit CSP kan nu). De CI syntax-checkt nu ook alle 8 geëxtraheerde bestanden.

**Bonusvangst:** de extractie legde bloot dat `quiz-review.html` nooit `socket.io.js` inlaadde, terwijl het script `io()` aanroept — een latente bug die nu gefixt is (socket.io-tag toegevoegd).

**Tests:** 11 logger-tests. Totaal 90 unit tests.

**Betrokken bestanden:** `server.js` · `lib/logger.js` (nieuw) · 8× `*.js` (nieuw, geëxtraheerd) · 8× `*.html` · `run-tests.sh` · `.env.example` · `tests/logger.test.js` (nieuw)

---

### Sprint 38 — Vraag dupliceren in het vragenoverzicht *(~0.5 dag)* — ✅ AFGEROND (v2026.2.38.0)

**Aangemeld:** 07/07/2026 · **Status:** ✅ Afgerond (v2026.2.38.0)

**Doel:** naast een hele toets dupliceren (33e) kan nu ook een **losse vraag** in de vragenbank gedupliceerd worden. Handig om een variant te maken (andere getallen, andere opties) zonder alles opnieuw in te typen.

**Onderscheid met 33e:** 33e dupliceert een **toets** (sessie + vraag-snapshots). Sprint 38 dupliceert één **bankvraag** in het vragenoverzicht — de bron, niet een snapshot.

**Uitgevoerd:**
- **Database:** `duplicateQuizQuestion(id, createdBy)` — haalt de bronvraag op en hergebruikt `createQuizQuestion`. Kopieert alle velden: `text` (met `" (kopie)"`-suffix), `subject`, `difficulty`, `max_points`, `question_type`, `choices_json`, `tags` én `model_answer`. Nieuwe `id`, `created_by` = huidige leerkracht, `archived = false`.
- 🔴 **Meerkeuze-valkuil afgevangen:** bij keuzevragen krijgt elke antwoordoptie een **nieuwe `id`** (tekst + `correct` blijven behouden). Anders zouden origineel en kopie dezelfde optie-id's delen — dezelfde soort fout als de 33e-bug.
- **Endpoint** `POST /api/quiz/bank/:id/duplicate` (teacher + CSRF).
- **UI:** "⧉ Dupliceren"-knop op elke niet-gearchiveerde vraagkaart, via event-delegation (CSP-vriendelijk, geen inline onclick). Na dupliceren wordt de lijst herladen en meteen het bewerk-formulier op de kopie geopend, zodat de leerkracht direct kan aanpassen.
- **Duplicaat-detectie:** de tekst-controle (`SELECT 1 FROM quiz_bank WHERE text = $1`) zit enkel in de CSV-import, niet in `createQuizQuestion` — de duplicatie wordt dus niet geblokkeerd. De `" (kopie)"`-suffix maakt de kopie sowieso onderscheidbaar.

**Tests:** 4 nieuwe in `tests/export.test.js` (suffix; alle velden incl. tags + modelcode; nieuwe optie-id's; code-vraag houdt lege choices). Totaal **146 unit tests**.

**Betrokken bestanden:** `server.js` · `db/database.js` · `quiz-bank.js` · `tests/export.test.js`

---

### Sprint 37 — Leerling-inzage in resultaten (37a/b/c/d) *(~7 dagen)* — ✅ AFGEROND

**Aangemeld:** 07/07/2026 · **Status:** ✅ VOLLEDIG AFGEROND — 37d (v37.0) · 37a (v37.1) · 37b (v37.2) · 37c (v37.3)

**Doel:** na een toets kan de leerkracht een **nakijk-modus** openstellen. Leerlingen loggen dan (op om het even welk toestel) opnieuw in met dezelfde toets en zien hun eigen antwoorden, score per vraag, de juiste antwoorden, de modelcode van de leerkracht, en het commentaar per vraag + algemeen.

**Bevestigde ontwerpkeuzes:**
1. **Inzage wanneer de leerkracht het aanzet.** Niet automatisch bij "resultaten vrijgeven", maar via een aparte **nakijk-modus** die de leerkracht expliciet aanvinkt. Zolang die aan staat, kunnen leerlingen de betreffende toets (sessiecode is bekend) opnieuw openen — maar in **read-only nakijk-modus**, niet om te antwoorden.
2. **Elk toestel.** De leerling-identificatie mag **niet** op localStorage steunen. Herkenning gebeurt via **naam + klas + sessiecode** (exact zoals bij het oorspronkelijke deelnemen). Zo kan een leerling thuis op een andere pc de nakijk-modus openen.
3. **Modelcode.** De leerkracht kan per vraag een **modelantwoord/modelcode** ingeven, die in de nakijk-modus getoond wordt. De modelcode hoort bij de vraag, dus hij wordt automatisch meegekopieerd wanneer een toets gedupliceerd wordt (33e) én wanneer een vraag gedupliceerd wordt (nieuw, sprint 38).

**Uitgangspunt (wat er al is):**
- `quiz_meta.results_released` + `POST /api/quiz/:code/release` + socket-event `quiz_results_released` bestaan. De leerling-handler is echter leeg.
- Per antwoord: `score`, `teacher_comment`, `selected_choices`. Plus `quiz_general_comments`-tabel.
- Vraag-snapshots (`quiz_question_snapshots`) met `choices_json` (juiste antwoorden), maar **nog geen modelcode-veld**.
- Leerling-join via `student_join` (naam + klas + code) — dit is de sleutel voor herkenning op elk toestel.

#### 37d — Nakijk-modus + toegangscontrole — ✅ AFGEROND (v2026.2.37.0)

**🔑 Belangrijke vondst tijdens de bouw:** `quiz_answers.student_id` is **niet** het id uit de `students`-tabel, maar een sessie-gebonden `crypto.randomUUID()` die bij het joinen wordt aangemaakt (server.js). Het DB-student-id staat apart als `student.dbStudentId`. Naam+klas → `student_id` kan dus **niet** via de `students`-tabel; het gebeurt via `quiz_answers` zelf, dat `student_name` en `student_class` als tekst-momentopname bewaart. Dat blijkt een voordeel: die tabel overleeft het einde van de les, dus nakijken werkt ook dagen later zonder dat de sessie nog in het geheugen zit.
> ⚠️ Gevolg: een sessie **verwijderen** cascadeert en wist de nakijk-data. Archiveren behoudt ze.

**Uitgevoerd:**
- **Database:** kolom `quiz_meta.review_mode BOOLEAN DEFAULT false` (+ migratie én in `CREATE TABLE` voor verse installaties). Functies `setReviewMode(code, enabled)` en `findAnswerStudent(code, naam, klas)` (case-insensitive, trim).
- **Nieuw: `lib/review-token.js`** — stateless, HMAC-SHA256-ondertekend token `base64url(payload).base64url(hmac)` met `{ code, studentId, exp }`, standaard 2u geldig. Ondertekend met `COOKIE_SECRET`. Constante-tijd handtekeningvergelijking. Geen extra tabel nodig.
- **`POST /api/quiz/:code/review-mode`** (teacher + CSRF): zet nakijken aan/uit, audit-log, socket-event `quiz_review_mode`.
- **`POST /api/quiz/:code/review-login`** (publiek, rate-limited via bestaande `checkJoinRateLimit`, 10/min):
  - `review_mode = false` **of** toets bestaat niet → **403** met identieke melding (lekt geen toetscodes).
  - Geen match → **404** met generieke tekst (geen naam-enumeratie).
  - Meerdere matches (dubbele naam+klas) → **409** met verwijzing naar de leerkracht.
  - Unieke match → **200** + token.
- **`requireReviewToken`-middleware:** haalt `studentId` **uitsluitend** uit het ondertekende token, nooit uit de URL. Controleert nakijk-modus, handtekening, vervaltijd, én dat `token.code === :code` (token van toets A werkt niet op toets B). Klaar voor gebruik in 37a.
- **Leerkracht-UI:** knop "👁 Nakijken: aan/uit" naast "Vrijgeven" in `quiz-review.html`/`.js`, met bevestigingsdialoog en statusweergave uit `meta.review_mode`.
- **Leerling-UI:** `?nakijken=1` toont een apart nakijk-loginscherm (naam + klas) in `quiz-student.html`. De live-toetsflow blijft **volledig ongemoeid**. Het token blijft in een JS-variabele — **geen localStorage**, dus inzage werkt op elk toestel en laat niets achter op een gedeelde computer.
- Leeg `#review-screen` klaargezet; wordt in 37a gevuld.

**Tests:** 12 nieuwe tests in `tests/review.test.js` (token geldig/verlopen/vervalst/gemanipuleerd/onzin, token van andere toets, en de vijf beslisregels van review-login). Totaal **114 unit tests**.

**Bewust aanvaarde beperking:** wie naam, klas én toetscode kent, kan andermans nakijk-scherm openen. Dat is exact hoe deelnemen vandaag al werkt (zie sprint 14/15). Afgeschermd door rate-limiting en doordat de leerkracht de modus expliciet moet openstellen.

**Betrokken bestanden:** `db/database.js` · `server.js` · `lib/review-token.js` (nieuw) · `quiz-review.html` · `quiz-review.js` · `quiz-student.html` · `quiz-student.js` · `run-tests.sh` · `tests/review.test.js` (nieuw)

#### 37a — Leerling-nakijkscherm — ✅ AFGEROND (v2026.2.37.1)

**Uitgevoerd:**
- **Database:** `getMyResult(sessionCode, studentId)` — **LEFT JOIN** van `quiz_question_snapshots` naar `quiz_answers`, zodat óók niet-beantwoorde vragen in het overzicht verschijnen (score `null`) i.p.v. stilletjes te ontbreken. `teacher_comment` wordt bewust nog niet geselecteerd (dat is 37c).
- **Nieuw: `lib/review-result.js`** — `buildMyResult(rows, opties)` zet de ruwe rijen om naar de leerling-payload en berekent totaal, maxtotaal en aantal ingevulde vragen.
  - 🔒 **Lekpreventie:** dit is de enige plek waar de `correct`-vlag uit `choices_json` wordt **gestript**. Een leerling ziet in 37a wél zijn eigen keuze, maar nog **niet** welke optie juist was. De vlag `onthulJuisteAntwoorden` is de bewuste hook die sprint 37b aanzet.
  - Robuust tegen `null`-waarden uit de LEFT JOIN en tegen kapotte `choices_json`.
- **Nieuw endpoint** `GET /api/quiz/:code/my-result` — achter `requireReviewToken` (37d). **Geen `studentId` in het pad**: dat komt uitsluitend uit het ondertekende token. Roept `buildMyResult(..., { onthulJuisteAntwoorden: false })` aan.
- **Leerling-UI** (`quiz-student.js`): het scherm uit 37d wordt nu gevuld.
  - Kop met naam, aantal ingevulde vragen, totaalscore + percentage.
  - Waarschuwing wanneer nog niet alles verbeterd is ("de score kan nog wijzigen").
  - Eigen SVG-staafgrafiek (score per vraag, groen/oranje/rood/grijs) — geen dependency.
  - Kaartje per vraag: vraagtekst via `renderMarkdown` (marked + DOMPurify), daaronder het eigen antwoord — code in een codeblok, meerkeuze met de eigen keuze gemarkeerd (`◉ … jouw keuze`).
  - Niet-ingevulde vragen tonen expliciet "Je hebt deze vraag niet ingevuld."

**Tests:** 15 nieuwe tests in `tests/review-result.test.js`, waaronder twee expliciete lek-tests (de payload bevat nergens `"correct"`). Totaal **129 unit tests**.

**Betrokken bestanden:** `db/database.js` · `server.js` · `lib/review-result.js` (nieuw) · `quiz-student.js` · `run-tests.sh` · `tests/review-result.test.js` (nieuw)

#### 37b — Juiste antwoorden + modelcode tonen — ✅ AFGEROND (v2026.2.37.2)

**Uitgevoerd:**
- **Database (was grotendeels voorbereid):** kolommen `quiz_bank.model_answer` én `quiz_question_snapshots.model_answer` (TEXT, default '') met migratie; `createQuizQuestion`/`updateQuizQuestion` nemen `modelAnswer`; `setSnapshotModelAnswer(code, questionId, modelAnswer)`; `getMyResult` selecteert `model_answer`. Nieuw toegevoegd: `getQuizBankByIds(ids)`.
- **Juiste antwoorden onthuld:** het `/my-result`-endpoint roept nu `buildMyResult(..., { onthulJuisteAntwoorden: true })`. `lib/review-result.js` geeft daardoor de `correct`-vlag terug én stuurt de modelcode mee — **maar enkel bij onthulling**, nooit tijdens de toets. Twee tests borgen die grens.
- **Modelcode-opslag leerkracht:** `POST/PUT /api/quiz/bank` nemen `modelAnswer` mee; nieuw veld "Modelantwoord / modelcode" in het vragenbank-formulier (`quiz-bank.html`/`.js`). In de verbetermodule (`quiz-review.js`) staat per vraag een inklapbaar modelantwoord-veld met eigen opslagknop → `PUT /api/quiz/:code/question/:questionId/model`.
- 🔴 **Duplicatie-fix (twee plaatsen):**
  - *Toets dupliceren:* de `questions.map(...)` kopieert nu ook `modelAnswer: q.model_answer || ''` (zelfde patroon als de 33e-fix).
  - *Toets áánmaken uit de bank:* deze route mapte enkel id/tekst/punten — vraagtype, keuzes én modelantwoord gingen verloren in de snapshot. Opgelost met `getQuizBankByIds`: de volledige bankvraag wordt opgehaald zodat `question_type`, `choices_json` én `model_answer` correct in de snapshot belanden. (Dit repareerde meteen een sluimerende bug waarbij meerkeuzevragen uit de bank code-vragen werden.)
- **Leerlingweergave:** meerkeuze toont nu de juiste optie groen ✓, een fout gekozen optie rood ✗, met labels "jouw keuze" / "juist". Code/open toont het eigen antwoord plus, indien ingevuld, een groen "Modelantwoord"-blok (Markdown via marked + DOMPurify).

**Tests:** 7 nieuwe (4 in `review-result.test.js` voor de modelAnswer-grens + onthulde `correct`-vlag; 3 in `export.test.js` die borgen dat modelcode én vraagtype/keuzes een toets-duplicatie overleven). Totaal **136 unit tests**.

**Betrokken bestanden:** `db/database.js` · `server.js` · `lib/review-result.js` · `quiz-bank.html` · `quiz-bank.js` · `quiz-review.js` · `quiz-student.js` · `tests/review-result.test.js` · `tests/export.test.js`

#### 37c — Commentaar zichtbaar voor leerling — ✅ AFGEROND (v2026.2.37.3)

**Meevaller:** de leerkracht-kant bestond al volledig. Commentaar per vraag wordt opgeslagen via `saveScore` (`quiz_answers.teacher_comment`), en algemeen commentaar via `saveGeneralComment` → `quiz_general_comments`. 37c hoefde enkel de leerlingweergave te bouwen.

**Uitgevoerd:**
- **Database:** `getMyResult` selecteert nu ook `a.teacher_comment`.
- **`lib/review-result.js`:** commentaar per vraag (`commentaar`) en algemeen commentaar (`algemeenCommentaar`) worden meegestuurd — **enkel bij onthulling** (`onthulJuisteAntwoorden`), want een opmerking kan een hint naar het juiste antwoord bevatten. Leeg commentaar → veld weggelaten / `null`.
- **Endpoint:** `/my-result` haalt het algemeen commentaar op via `getQuizGeneralComment` en geeft het door aan `buildMyResult`.
- **Leerlingweergave (`quiz-student.js`):** commentaar per vraag in een blauw "💬 Commentaar van je leerkracht"-blok onder het antwoord (Markdown via marked + DOMPurify). Algemeen commentaar in een blauw blok bovenaan het nakijk-scherm. Beide enkel getoond als ze gevuld zijn.

**Tests:** 6 nieuwe tests (commentaar per vraag lekt niet vóór onthulling; verschijnt erna; leeg → weggelaten; algemeen commentaar idem; robuust bij ontbreken). Totaal **142 unit tests**.

**Betrokken bestanden:** `db/database.js` · `server.js` · `lib/review-result.js` · `quiz-student.js` · `tests/review-result.test.js`

---

**✅ Sprint 37 volledig afgerond.** De leerling-nakijkmodus is compleet: nakijk-modus openstellen (37d), eigen scherm met score (37a), juiste antwoorden + modelcode (37b), en commentaar per vraag + algemeen (37c). Van v2026.2.37.0 tot v2026.2.37.3.

**Volgorde van uitvoering:** 37d eerst (fundament + beveiliging), dan 37a (scherm), dan 37b (antwoorden + modelcode), dan 37c (commentaar). Test na elke stap.

**Opmerking over leerling-authenticatie:** de herlogin steunt op naam + klas + sessiecode, wat overeenkomt met hoe leerlingen nu al deelnemen. Dit is dus geen nieuwe zwakte, maar wel een bewust aanvaarde beperking: iemand die naam, klas én sessiecode kent, kan andermans nakijk-scherm openen. Een echte leerling-login is voorzien maar nog niet gekozen — zie sprints 14/15 (uitgesteld). *(Update 15/07: **beslist** — eigen login op e-mail + wachtwoord, **sprint 52**; sprints 14/15 vervallen.)* Zodra die er is, wordt de nakijk-toegang daarop gebaseerd i.p.v. op naam+klas. **Tot dan:** rate-limiting op de herlogin en enkel toegang wanneer de leerkracht de nakijk-modus expliciet openstelt.

**Tests (verwacht):** toegangscontrole (nakijk aan/uit, eigen/andermans), correct-answer-marking, modelcode-opslag + weergave, modelcode overleeft toets-duplicatie, commentaar leeg vs. gevuld. ~12-15 nieuwe tests.

**Betrokken bestanden (verwacht):** `server.js` · `db/database.js` (review_mode + model_answer kolommen + queries) · `quiz-student.html` · `quiz-student.js` · `quiz-review.js` · `styles.css` · `tests/`

---

### Sprint 33 — Nice-to-haves (33a/b/d/e) *(~3.5 dagen)* — ✅ AFGEROND (v2026.2.34.9)

**Aangemeld:** 05/07/2026 · **Status:** ✅ Afgerond (v2026.2.34.9) · 33c GESCHRAPT

#### 33e — Toets dupliceren
De knop + endpoint bestonden al, maar de duplicate-logica bewaarde `question_type` en `choices_json` niet → meerkeuzevragen werden code-vragen bij het dupliceren. **Fix:** vraagtype + keuzes worden nu meegekopieerd.

#### 33d — Vraag-tags in de vragenbank
Nieuwe `tags`-kolom in `quiz_bank` (komma-gescheiden, met migratie). De vragenbank-UI heeft nu een tags-invoerveld en een tag-filter. Tags worden als chips op de vraagkaarten getoond. Filtering client-side (deelstring, hoofdletterongevoelig). Server valideert (max 200 tekens).

#### 33a — Scores exporteren naar Excel (CSV)
Nieuw endpoint `/api/quiz/:code/export/csv`: een scores-samenvatting met één rij per leerling, een kolom per vraag + totaal. Puntkomma-gescheiden en met UTF-8 BOM zodat het direct correct in Excel opent (NL-locale). **Bewuste keuze voor CSV i.p.v. .xlsx**: opent net zo goed in Excel, maar zonder externe dependency — past bij de minimal-deps aanpak (36d). Toegevoegd als optie 8 in het export-menu van de verbetermodule.

#### 33b — Voortgangsgrafiek in de verbetermodule
Een kleine SVG-staafgrafiek (geen dependency) toont per vraag de score t.o.v. het maximum, met kleurcodering: groen = volledig, oranje = deels, rood = nul, grijs = nog niet beoordeeld. Verschijnt boven de vraag-details zodra een leerling geselecteerd wordt.

#### 33c — ❌ GESCHRAPT
Donker/licht UI-thema: bewust geschrapt (07/07/2026) — wordt niet gedaan.

**Tests:** 10 nieuwe tests (CSV-matrix + tag-filtering). Totaal 102 unit tests.

**Betrokken bestanden:** `server.js` · `db/database.js` · `quiz-bank.html` · `quiz-bank.js` · `quiz-review.js` · `styles.css` · `tests/export.test.js` (nieuw)

---

### Sprint 30b-A — CSP-hardening TIJDELIJK (Optie A) *(~0.5 dag)* — ✅ AFGEROND (v2026.2.34.8)

**Aangemeld:** 07/07/2026 · **Status:** ✅ Afgerond (v2026.2.34.8)

**Doel:** een échte, veilige beveiligingswinst nu, zonder de ~500 wijzigingen van de volledige oplossing (Optie C) te riskeren.

**Uitgevoerd:**
- Het laatste resterende inline `<script>`-blok (`teacher-login.html`) geëxtraheerd naar `teacher-login.js`. Er zijn nu **nergens** nog inline `<script>`-blokken.
- Een strikte CSP toegevoegd in **Report-Only**-modus (`Content-Security-Policy-Report-Only`): `script-src 'self'`, `style-src 'self'` — dus **zonder** `unsafe-inline`. Deze breekt niets (report-only), maar laat in de browserconsole exact zien wat geblokkeerd zou worden. Zo levert Optie C straks een concrete checklist op.
- De handhavende CSP houdt voorlopig `unsafe-inline` (nodig voor de 123 inline event-handlers + 384 inline styles), met een duidelijke `⚠️ TIJDELIJK`-comment die naar het Optie C-plan verwijst.

**Betrokken bestanden:** `server.js` · `teacher-login.html` · `teacher-login.js` (nieuw) · `run-tests.sh` · `tests/security.test.js`

---

### Sprint 30b-vol — `unsafe-inline` VOLLEDIG verwijderen (Optie C) *(~8-10 dagen)* — ⏸️ UITGESTELD

**Doel:** de handhavende CSP volledig verstrengen naar `script-src 'self'` en `style-src 'self'` (geen `unsafe-inline` meer), zodat geïnjecteerde inline scripts én styles hard geblokkeerd worden. Dit is de definitieve XSS-hardening.

**Waarom gefaseerd:** het gaat om **123 inline event-handlers** (`onclick=`, `onchange=`, …) en **384 inline `style=` attributen** over 13 bestanden. Alles-in-één is te risicovol; per pagina met een test na elke stap is veilig. De Report-Only CSP uit 30b-A geeft per pagina de exacte violation-lijst.

**Randvoorwaarde:** sprint 32a (inline scripts → aparte `.js`) moet af zijn — ✅ dat is zo. De handlers worden verplaatst naar de bijbehorende geëxtraheerde `.js`-bestanden.

#### Fase 1 — Event-handlers → addEventListener *(~5 dagen)*
Per pagina de inline `on*=`-handlers vervangen door `addEventListener` in het bijbehorende `.js`-bestand. Volgorde van klein naar groot (risico-opbouw), met `bash run-tests.sh` + handmatige smoke-test na elke pagina:

| Stap | Pagina | Handlers | Aanpak |
|---|---|---|---|
| 1.1 | free-editor, student-app | 2 + 2 | Eenvoudig, statische handlers → `id`-based listeners |
| 1.2 | quiz-review, teacher-sessions | 3 + 3 | Idem |
| 1.3 | teacher-grid, admin | 4 + 8 | Deels dynamisch (`data-*` attributen introduceren) |
| 1.4 | quiz-student, quiz-archive | 8 + 10 | Dynamische lijsten → event-delegation op container |
| 1.5 | teacher-app, quiz-teacher | 11 + 12 | Event-delegation + `data-action` patroon |
| 1.6 | monitoring | 14 | Idem |
| 1.7 | quiz-bank | 46 | Grootste; volledig event-delegation via `data-action` |

**Techniek voor dynamische handlers** (`onclick="fn('${id}')"`): vervangen door `data-action="fn" data-id="${id}"` op het element, en één gedelegeerde listener per container die `data-action` afhandelt. Dit schaalt en vermijdt her-binding bij herrenderen.

#### Fase 2 — Inline `style=` → CSS-klassen *(~3 dagen)*
De 384 inline styles vervangen door herbruikbare CSS-klassen in `styles.css`. Veel zijn herhalingen (bv. `style="display:none"` → `.hidden`, die al bestaat). Aanpak: eerst de meest voorkomende patronen als utility-klassen, dan de rest per pagina. Monitoring (105) en teacher-app/quiz-teacher (~50 elk) zijn de grootste.

| Stap | Focus | Styles |
|---|---|---|
| 2.1 | Utility-klassen aanmaken (display, spacing, kleuren) | — |
| 2.2 | quiz-bank, quiz-archive, admin, quiz-review | ~90 |
| 2.3 | quiz-student, teacher-sessions, student-app, free-editor | ~80 |
| 2.4 | teacher-app, quiz-teacher | ~100 |
| 2.5 | monitoring | 105 |

*Let op:* echt dynamische styles (bv. een progressbar-breedte `style="width:${pct}%"`) kunnen NIET naar een klasse. Die blijven, en vereisen `style-src 'unsafe-inline'` OF een nonce OF het zetten via `element.style.width` in JS. Voorkeur: via JS zetten, zodat `style-src 'self'` haalbaar blijft.

#### Fase 3 — CSP verstrengen + Optie A verwijderen *(~1 dag)*
Zodra fase 1 en 2 af zijn en de Report-Only CSP geen violations meer meldt:
1. In `server.js` de handhavende CSP wijzigen naar `script-src 'self' https://cdnjs.cloudflare.com` en `style-src 'self'` (dus **`unsafe-inline` weg** uit beide).
2. **De `Content-Security-Policy-Report-Only` header VERWIJDEREN** (die was enkel het meetinstrument van Optie A — niet meer nodig zodra de echte CSP strikt is).
3. De `⚠️ TIJDELIJK`-comment uit 30b-A verwijderen.
4. `dompurify`/`marked` van cdnjs: overwegen deze lokaal te hosten zodat ook `https://cdnjs.cloudflare.com` uit `script-src` kan (volledige `'self'`).
5. Tests: security.test.js aanpassen zodat de enforce-CSP nu `unsafe-inline`-vrij is; de Report-Only-tests verwijderen.
6. check-deployment.sh: controle toevoegen dat `unsafe-inline` niet meer in de CSP staat.

**Definition of done:** geen `unsafe-inline` in de handhavende CSP, geen Report-Only header meer, alle 12 pagina's functioneel getest, testsuite groen, en de browserconsole toont geen CSP-violations.

**Betrokken bestanden (verwacht):** `server.js` · alle 12 `*.html` · bijbehorende `*.js` · `styles.css` · `tests/security.test.js` · `check-deployment.sh`

---
`quiz-teacher.html` lijn 303: de ✕ knop (vraag uit selectie verwijderen) heeft nog geen `title`. Sprint 27h ving deze niet omdat de replace-string niet exact matchte. **Fix:** `title="Vraag uit selectie verwijderen"` toevoegen.

#### 29c 🔴 — Stille fouten door lege catch-blokken
15× `catch {}` in `app.js` zonder enige logging. Bij een fout gebeurt er niets — geen console-melding, geen gebruikersfeedback. Dit maakt debuggen zeer moeilijk. **Fix:** minimaal `catch(e) { console.warn('...', e); }` toevoegen, of waar zinvol een pyAlert.

**Uitgevoerd:** Alle 20 lege catch-blokken over `app.js`, `admin.html`, `monitoring.html`, `quiz-bank.html`, `quiz-review.html`, `quiz-teacher.html` en `server.js` voorzien van contextuele `console.warn` logging. Best-effort catches (runner-cancel, log-cleanup) kregen een expliciete comment i.p.v. logging.

#### 29-deploy 🟠 — Versie-automatisering bij deploy
**Aanleiding:** De versie moest bij elke deploy handmatig via pycodeflow.sh gezet worden, met het risico dat `.env`, HTML cache-bust strings en de gerapporteerde versie uit sync liepen.

**Oplossing — `VERSION`-bestand als single source of truth:**
- Een `VERSION`-bestand in de project-root bevat het nummer (bv. `2026.2.29.0`)
- `server.js` leest dit bestand bij opstart (via `loadVersionFromFile()`) en gebruikt het boven `.env` — gecontroleerd op meerdere paden (lokaal + container-mount `/VERSION`)
- `docker-compose.yml` mount `./VERSION:/VERSION:ro` zodat een versiewijziging **zonder rebuild** actief wordt na herstart
- Nieuw script `sync-version.sh` propageert het nummer naar `.env` én alle HTML cache-bust querystrings in één commando
- `pycodeflow.sh` optie 1 (versie instellen) gebruikt nu `sync-version.sh`; optie 5 (rebuild) synchroniseert automatisch als `VERSION` afwijkt van `.env`

**Deploy-flow nu:** pas `VERSION` aan (of `bash sync-version.sh 2026.2.40.0`) → herstart web-container. Geen handmatige versie-edits meer op meerdere plaatsen.

**Betrokken bestanden:** `VERSION` (nieuw) · `sync-version.sh` (nieuw) · `server.js` · `docker-compose.yml` · `pycodeflow.sh`

---

### Sprint 30 — Security hardening *(~4.7 dagen)*

**Aangemeld:** 05/07/2026 · **Status:** 🔄 Gepland

#### 30a 🟠 — Login-cookie zonder Max-Age
Het `teacher_auth` cookie wordt gezet zonder `Max-Age` of `Expires` → het is een sessiecookie dat verdwijnt bij het sluiten van de browser. Er is geen bewuste sessieduur en geen server-side timeout. **Fix:** expliciete `Max-Age` (bv. 8 uur voor een schooldag) + server-side sessievalidatie met vervaldatum. Overweeg "onthoud mij" optie.

#### 30b 🟠 — CSP unsafe-inline door 130 inline onclick handlers
De CSP bevat `'unsafe-inline'` in `script-src`, wat de XSS-bescherming aanzienlijk verzwakt (security-testplan R-02). Oorzaak: 130 inline `onclick=`/`onchange=` handlers verspreid over alle HTML. **Fix:** migreren naar event delegation / `addEventListener` in app.js, daarna `unsafe-inline` verwijderen en overschakelen op nonces of hashes. Grote taak — gefaseerd uitvoeren per pagina.

#### 30c 🟠 — upgrade-insecure-requests ontbreekt
HSTS is aanwezig maar de CSP mist `upgrade-insecure-requests`, wat mixed-content zou blokkeren. **Fix:** directive toevoegen aan de CSP-header.

#### 30d 🟡 — Geen automatische DB-backup
Backups gebeuren enkel handmatig (pycodeflow.sh optie 16). Bij een crash zonder recente backup gaat data verloren. **Fix:** cron-job optie toevoegen in pycodeflow.sh die dagelijks `pg_dump` uitvoert met retentie (bv. 7 dagen), of een interne scheduler in server.js.

---

### Sprint 31 — UX & consistentie *(~2.5 dagen)*

**Aangemeld:** 05/07/2026 · **Status:** 🔄 Gepland

#### 31a 🟠 — Loading states inconsistent
Slechts 5 van de 18 pagina's tonen een laadindicator tijdens API-calls. Op trage verbindingen lijkt de app te bevriezen. **Fix:** uniforme spinner-component (of hergebruik bestaande laadspinner) op alle pagina's met async data-laden.

#### 31b 🟠 — localStorage sleutels inconsistent
Sommige keys hebben `pycodeflow_` prefix (`pycodeflow_free_code`, `pycodeflow_editor_mode`), andere niet (`freeSessionCode`, `teacherSessionCode`, `studentName`). Dit verhoogt kans op botsingen en verwarring. **Fix:** alle keys uniform prefixen met `pycodeflow_`, met migratiecode die oude keys eenmalig overzet.

#### 31c 🟡 — Foutmeldingen niet uniform
Fouten worden op drie manieren getoond: `pyAlert` (modal), inline tekst in het formulier, en tekst in het output-paneel. **Fix:** richtlijn vastleggen — validatie/fouten via pyAlert, achtergrondsucces via pyToast — en bestaande afwijkingen omzetten.

---

### Sprint 32 — Technische schuld *(~5.5 dagen)*

**Aangemeld:** 05/07/2026 · **Status:** 🔄 Gepland

#### 32a 🟡 — Inline scripts te groot
`monitoring.html` (762 rgls inline script), `quiz-bank.html` (551), `quiz-student.html` (504), `quiz-review.html` (436), `quiz-teacher.html` (321). Moeilijk onderhoudbaar, geen herbruik, geen syntax-check bij build. **Fix:** per pagina het inline script naar een apart `.js` bestand verplaatsen (bv. `quiz-bank.js`), geladen met een versie-querystring. Dit verbetert ook de CSP-migratie (30b).

#### 32b 🟡 — console.log in productiecode
15× `console.log` in `server.js`. **Fix:** een eenvoudige logger met niveaus (debug/info/warn/error) die respecteert `LOG_LEVEL` uit .env, zodat debug-output in productie onderdrukt kan worden.

#### 32c 🟢 — Monaco-versie niet centraal gepind
De Monaco-loader wordt in meerdere HTML-bestanden apart geladen. **Fix:** één centrale versievariabele of een gedeeld include-fragment.

---

### Sprint 33 — Nice-to-haves *(~7.5 dagen)*

**Aangemeld:** 05/07/2026 · **Status:** 🔄 Gepland

#### 33a 🟢 — Excel-export van resultaten
Naast de bestaande PDF-export ook `.xlsx` aanbieden in de verbetermodule, met leerlingen in rijen en vragen/scores in kolommen. Handig voor verdere verwerking in een puntenboek.

#### 33b 🟢 — Voortgangsgrafiek per leerling
In de verbetermodule een klein staafdiagram tonen: score per vraag, zodat de leerkracht in één oogopslag ziet waar een leerling struikelde.

#### 33c — ❌ GESCHRAPT
Donker/licht UI-thema voor de hele app: bewust geschrapt (07/07/2026) — wordt niet gedaan. De editor blijft altijd donker (sprint 27j).

#### 33d 🟢 — Vraag-tags in vragenbank
Naast onderwerp en moeilijkheid ook vrije tags/labels toevoegen aan vragen, met filtering. Handig bij grote vragenbanken.

#### 33e 🟢 — Toets dupliceren
Een "Dupliceer"-knop bij bestaande toetsen die een kopie maakt (zelfde vragen en instellingen, nieuwe naam). Bespaart tijd bij herhaalde toetsen over schooljaren heen.

---

### Sprint 34 — Geautomatiseerd testen *(~6 dagen)* — ✅ AFGEROND (v2026.2.34.0)

**Uitgevoerd:** kritieke logica geëxtraheerd naar `web/lib/` (auth, scoring, validation) zodat ze puur en testbaar zijn; `server.js` requiret die modules (één bron van waarheid). Testsuite met **45 unit tests** (`node:test`, geen extra deps) + **12 Python sandbox-tests**. Lokale CI (`run-tests.sh`) draait syntax-checks, inline-HTML-scriptcontrole (via `vm.Script`, browser-equivalent), unit tests, sandbox-tests en `npm audit`. GitHub Actions workflow toegevoegd. `pycodeflow.sh` optie 20 draait de tests; optie 5 (rebuild) draait ze automatisch vóór deploy en blokkeert bij falen.

**Bonusvangst:** de CI ontdekte meteen een echte latente syntaxfout in `quiz-review.html` — een geneste template-literal (editor-blok bij code-vragen) die nooit werd afgesloten. Gecorrigeerd. Precies waarvoor de testbasis dient.

**Aangemeld:** 05/07/2026 · **Status:** 🔄 Gepland
**Aanleiding:** Het project heeft **nul geautomatiseerde tests**. Elke wijziging wordt handmatig getest, wat traag en foutgevoelig is — de sprint 26/27 regressies (window-exports, socketPages) waren met een minimale testsuite meteen gedetecteerd.

#### 34a 🔴 — Testsuite voor kritieke paden
Unit- en integratietests voor de belangrijkste server-logica: login + rate limiting, automatische scoring (single/meerkeuze/gedeeltelijk), sessie-persistentie en -herstel, CSRF-afdwinging, DB viewer whitelist. Aanbevolen: `node:test` (ingebouwd, geen extra deps) + een testdatabase. Streefdoel: de paden die bij falen data of toegang beïnvloeden.

#### 34b 🟠 — CI-pipeline
Een pipeline (GitHub Actions of NAS-lokaal script) die bij elke wijziging draait: `node --check` op alle JS, de testsuite, en `npm audit`. Voorkomt dat syntactisch kapotte of gefaalde code gedeployed wordt — precies wat de 28f structuurfout zou hebben gevangen.

#### 34c 🟠 — Sandbox-escape testautomatisering
De 10 sandbox-tests uit `security-testplan.md` §6.1 (verboden imports, rlimits, `__import__`-omzeiling) automatiseren zodat elke runner-wijziging automatisch tegen escape-pogingen getest wordt.

---

### Sprint 35 — Toegankelijkheid (a11y) *(~5 dagen)*

**Aangemeld:** 05/07/2026 · **Status:** 🔄 Gepland
**Aanleiding:** De hele app bevat **1 aria-attribuut**. Voor een onderwijstool die ook door leerlingen met een beperking gebruikt kan worden, is dit een belangrijke tekortkoming (en in veel onderwijscontexten een wettelijke vereiste — WCAG/EN 301 549).

#### 35a 🟠 — Aria-labels en roles
Betekenisvolle `aria-label` op icon-only knoppen (naast de `title` uit sprint 27h), `role`-attributen op custom componenten (tabs, lijsten, statusindicatoren), en `aria-live` regio's voor dynamische updates (leerlingstatus, output).

#### 35b 🟠 — Status niet enkel via kleur
Leerlingstatus (klaar/hand/tab-weg) en de stresstest-indicatoren zijn nu enkel kleurgecodeerd. Kleurenblinde gebruikers kunnen ze niet onderscheiden. **Fix:** iconen of tekstlabels toevoegen naast de kleur (WCAG 1.4.1).

#### 35c 🟡 — Toetsenbordnavigatie
Volledige app doorloopbaar met Tab/Enter/Escape: logische focus-volgorde, zichtbare focus-indicator, skip-to-content link, en geen toetsenbord-vallen. Belangrijk voor leerlingen die geen muis kunnen gebruiken.

#### 35d 🟡 — Toegankelijke modals
`pyAlert`, `pyConfirm` en de tabel/preview-modals krijgen `role="dialog"`, `aria-modal="true"`, focus-trap binnen de modal, en focus-terugkeer naar het triggerende element bij sluiten.

---

### Sprint 36 — Data-integriteit & robuustheid *(~4.5 dagen)*

**Aangemeld:** 05/07/2026 · **Status:** 🔄 Gepland

#### 36a 🟠 — Transacties bij multi-step schrijfacties
Een toets aanmaken schrijft naar `quiz_meta` én koppelt vragen — als de tweede stap faalt, blijft een halve toets achter. **Fix:** deze operaties in een PostgreSQL-transactie (`BEGIN`/`COMMIT`/`ROLLBACK`) wikkelen. Idem voor het vrijgeven van resultaten en het archiveren van een schooljaar.

#### 36b 🟡 — persistSession debounce
`persistSession` wordt bij elke code-wijziging aangeroepen. Bij snel typende leerlingen geeft dit veel DB-schrijfacties en mogelijke race conditions (last-write-wins zonder versioning). **Fix:** debounce per sessie (bv. max 1 schrijf per 2s) + eventueel een `updated_at`-check.

#### 36c 🟡 — Centrale input-validatielaag
API-input wordt nu ad-hoc per endpoint gevalideerd (of niet). **Fix:** een lichte validatie-helper (types, lengtes, grenzen, enum-waarden) die consistent op alle endpoints wordt toegepast. Vermindert kans op onverwachte data en vergemakkelijkt foutmeldingen.

#### 36d 🟢 — Dependencies pinnen
`package.json` gebruikt `^` (minor auto-update), wat builds niet-reproduceerbaar maakt en een supply-chain-risico vormt. **Fix:** exacte versies pinnen, een `package-lock.json` committen, en `npm audit` opnemen in de CI (34b).

---

### Sprint 28 — Backlog consolidatie + DOMPurify + bugfixes *(~6.5 dagen)*

**Aangemeld:** 04/07/2026
**Status:** ✅ Afgerond (v2026.2.28.0)

---

#### 28a — Vraagtypen automatische scoring *(~4 dagen)* — ✅ AL AANWEZIG

**Status: AL GEÏMPLEMENTEERD** — Aanwezig in `server.js` lijn 4255+. Auto-scoring voor single (0/max punten) en meerkeuze (gedeeltelijk, gewogen). `autoScored` flag in DB. Verwijderd uit actieve sprint 28.

~~**Oorsprong:** sprint 18a + 18b — uitgesteld wegens prioriteiten, nu opgenomen in sprint 28.~~

**Probleem:** Bij single choice en meerkeuze vragen wordt de score momenteel **handmatig** ingegeven door de leerkracht in de verbetermodule. De `selected_choices` worden correct opgeslagen (sprint 23a) en de juiste antwoorden zijn bekend (`correct: true` in `choices_json`), maar de automatische vergelijking ontbreekt.

**Wat er gebouwd moet worden:**

1. **Automatische scoring bij indienen** (`server.js`):
   - Bij `quiz_submit`: voor elke `single`/`multiple` vraag de `selected_choices` vergelijken met de `correct` opties in `choices_json`
   - Single choice: 1 correct antwoord geselecteerd → volle punten, anders 0
   - Meerkeuze: alle juiste geselecteerd en geen foute → volle punten; gedeeltelijk correct → halve punten (configureerbaar per toets); fout → 0
   - Score opslaan in `quiz_answers.score`

2. **"🤖 Auto-gescoord" badge** in verbetermodule:
   - Automatisch gescoorde antwoorden tonen de badge (al deels aanwezig)
   - Leerkracht kan score overschrijven (bestaande functionaliteit)

3. **Open vragen**: blijven altijd handmatig — geen wijziging

**Betrokken bestanden:** `server.js` · `quiz-review.html`

---

#### 28b — check-deployment.sh sprint 12+ update *(~0.5 dag)* — ✅ AL VOLDOENDE

**Status: AL VOLDOENDE** — v2026.2.27.0 controleert pgdata, SQLite-verwijdering en alle kritieke tabellen. Verwijderd uit actieve sprint 28.

~~**Oorsprong:** sprint 19c — uitgesteld, check-deployment.sh is intussen al meerdere keren bijgewerkt (nu v2026.2.27.0), maar de specifieke sprint 12+ controles~~ (PostgreSQL migratie, geen SQLite meer, schema-versie) zijn nog niet volledig.

**Wat er ontbreekt:**
- Controle of `pgdata/` correct is geïnitialiseerd (niet leeg)
- Controle of geen SQLite `.db` bestanden meer aanwezig zijn in `data/`
- Controle op aanwezigheid van `db_settings` tabel (sprint 13-migratie)

**Betrokken bestanden:** `check-deployment.sh`

---

#### 28c — DOMPurify voor Markdown XSS-beveiliging *(~0.5 dag)*

**Oorsprong:** security-testplan.md R-01 — `marked.js` sanitiseert geen HTML in Markdown. Een leerkracht kan via `<script>` of `<img onerror=...>` in een vraagstelling potentieel XSS injecteren.

**Scope:** Enkel de rendering bij **leerlingen** en in de **verbetermodule** is risicovol — de vragenbank-editor is leerkracht-only. DOMPurify toevoegen als post-processing stap:

```js
// Na marked.parse() — in quiz-student.html en quiz-review.html
const dirty = window.marked.parse(preprocessMarkdown(rawText), { breaks: true, gfm: true });
const clean  = window.DOMPurify ? window.DOMPurify.sanitize(dirty, { ADD_ATTR: ['style'] }) : dirty;
qTextEl.innerHTML = clean;
```

**CDN:** `https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.6/purify.min.js` (al in CSP whitelist).

**Betrokken bestanden:** `quiz-student.html` · `quiz-review.html`

---

#### 28d — quiz-review.html subnav actief-markering *(~0.5 dag)*

**Probleem:** De verbetermodule (`quiz-review.html`) toont de subnav maar geen enkele link is als actief gemarkeerd. "Archief" is de meest logische keuze (de verbetermodule is bereikbaar vanuit het archief).

**Fix:** De subnav op `quiz-review.html` uitbreiden zodat "📦 Archief" de actieve klasse krijgt.

**Betrokken bestanden:** `quiz-review.html`

---

#### 28f — free_run_rate_limited auto-clear *(~0.5 dag)*

**Probleem:** De `free_run_rate_limited` handler heeft de `setTimeout` gekregen in sprint 27k (auto-clear werkt), maar er staan **loshangende regels op lijn 1490-1494** in `app.js` die buiten de handler vallen door een merge-fout:

```js
// Lijn 1489: handler sluit correct
    });
// Lijn 1490-1494: BUITEN handler — syntactisch incorrect
        setTab('free', 'output');
        document.querySelectorAll(...).forEach(...);
      }
    });
```

Deze loshangende code breekt de JS-structuur en geeft een parse-fout.

**Fix:** Zelfde `setTimeout` toevoegen als in 27k:

```js
socket.on('free_run_rate_limited', ({ waitMs }) => {
  panel.textContent = `⏳ Even wachten...`;
  setTimeout(() => {
    if (panel.textContent.startsWith('⏳')) panel.textContent = '';
  }, (waitMs || 3000) + 300);
});
```

**Betrokken bestanden:** `app.js`

---

### Sprint 27 — check-deployment.sh bugfixes *(~0.5 dag)*

**Aangemeld:** 02/07/2026
**Status:** ✅ Afgerond (v2026.2.27.0)
**Aanleiding:** Na rebuild en uitvoeren van `check-deployment.sh v2026.2.26.0` op de NAS kwamen 5 FAIL-meldingen die allemaal **vals positief** zijn — de bestanden zijn correct maar de bash-regex-syntax klopt niet.

---

**Rootcause van 27a–27e: backslash-pipe `\|` werkt niet in `grep -qE`**

`grep -E` (extended regex) gebruikt `|` als OR-operator — **zonder** backslash. Maar `check_contains` roept `grep -qE "$pattern"` aan en de patronen bevatten `\|`. In bash-extended-regex wordt `\|` letterlijk geïnterpreteerd als backslash-pipe, niet als OR. Resultaat: het patroon matcht nooit.

**Voorbeeld:**
```bash
# FOUT — \| wordt letterlijk gezocht in -E mode
grep -qE "safeEqual\|timingSafeEqual" server.js   # → matcht NIET

# CORRECT — | zonder backslash in -E mode
grep -qE "safeEqual|timingSafeEqual" server.js    # → matcht WEL

# OOK CORRECT — aparte -e vlaggen
grep -q -e "safeEqual" -e "timingSafeEqual" server.js
```

**Fix 27a: bash syntaxfout lijn 311**

`grep -cE "..." 2>/dev/null || echo 0` geeft `"0\n0"` terug als string bij een lege match (de `|| echo 0` voegt een extra `0` toe aan de grep-uitvoer). De `[[ "$ERRORS" -eq 0 ]]` vergelijking faalt dan met `syntax error in expression`.

Fix: `grep -cE` vervangen door `grep -cE ... | head -1` of aanpak omdraaien naar `if grep -qE ...; then`.

**Fix 27b–27e: alle multi-patroon `check_contains` aanroepen**

Alle aanroepen waarbij het patroon een `\|` bevat moeten herschreven worden. Oplossing: de `check_contains` hulpfunctie uitbreiden zodat ze meerdere `-e` vlaggen ondersteunt, of alle multi-patronen splitsen naar aparte `check_contains` aanroepen.

**Fix 27f: "Geen leerkrachten" warning**

Bij een verse installatie is het normaal dat er geen leerkrachten zijn. De warning moet verduidelijken dat dit verwacht is na eerste installatie, en alleen een echte waarschuwing geven als de server al eerder in gebruik was (bv. tabel bestaat maar is leeg na een reset).

---

#### 27h — Tooltips op alle knoppen zonder duidelijk label *(~1 dag)*

**Probleem:** Knoppen die enkel een emoji of symbool bevatten, of knoppen waarvan de betekenis niet meteen duidelijk is, hebben geen `title` attribuut. Hoveren geeft geen feedback. Dit is zowel een UX- als toegankelijkheidsprobleem (screenreaders).

**Scope — geïnventariseerde knoppen per pagina:**

**`teacher-app.html` (21 knoppen zonder title):**

| Knop | Toe te voegen title |
|---|---|
| "Start individuele werkfase" | "Start examenmodus: elke leerling werkt apart" |
| "Sturen" | "Stuur huidige code naar alle leerlingen" |
| "Wissen" | "Wis de code bij alle leerlingen" |
| "Run" | "Voer de code uit (Ctrl+Enter)" |
| "Run all uit" / "Run all aan" | "Zet run-knop bij alle leerlingen uit/aan" |
| "Code all uit" / "Code all aan" | "Maak code-editor bij alle leerlingen alleen-lezen / bewerkbaar" |
| "✓ Klaar" (filter) | "Toon enkel leerlingen die klaar zijn" |
| "✋ Hand" (filter) | "Toon enkel leerlingen met hand omhoog" |
| "⚠️ Tab weg" (filter) | "Toon leerlingen die de tab hebben verlaten" |
| "Start" / "Stop" | "Start/stop code-uitvoering" |
| "⬇ Export" | "Exporteer sessiegegevens als CSV" |
| "Sessie afsluiten" | "Sluit de sessie — leerlingen kunnen niet meer inloggen" |
| "✕" (leerlingslijst sluiten) | "Leerlingenlijst verbergen" |
| "📌 Verstuur" | "Stuur aankondiging naar alle leerlingen" |
| "✕ Wis alle" | "Verwijder alle aankondigingen" |
| "Sluiten" (aankondiging) | "Sluit aankondigingspaneel" |
| "✓ Klaar resetten" | "Zet de klaar-status van alle leerlingen terug op niet klaar" |
| "⊞ Overzicht" | "Open grid-overzicht van alle leerlingen" |

**`student-app.html` (8 knoppen zonder title):**

| Knop | Toe te voegen title |
|---|---|
| "Klascode" tab | "Toon de gedeelde klascode" |
| "Mijn werkblad" tab | "Toon jouw persoonlijke code" |
| "Output" tab | "Toon de uitvoer van jouw code" |
| "📎 Voorbeeld" | "Laad het startvoorbeeld in de editor" |
| "Run" | "Voer jouw code uit (Ctrl+Enter)" |
| "✋ Hand opsteken" | "Meld aan de leerkracht dat je hulp nodig hebt" |
| "✓ Klaar" | "Meld aan de leerkracht dat je klaar bent" |
| "Stuur input" | "Stuur jouw invoer naar het programma (Enter)" |

**`quiz-student.html` (5 knoppen zonder title):**

| Knop | Toe te voegen title |
|---|---|
| "Run ▶" | "Voer je Python code uit" |
| "← Vorige" | "Ga naar de vorige vraag" |
| "📤 Indienen" | "Dien de toets in" |
| "Volgende →" | "Ga naar de volgende vraag" |
| "← Terug naar toets" | "Annuleer indienen, ga terug" |

**`quiz-teacher.html` (1 knop):**

| Knop | Toe te voegen title |
|---|---|
| "✕" (geselecteerde vraag verwijderen) | "Vraag uit selectie verwijderen" |

**Aanpak:**
- `title` attribuut toevoegen aan alle bovenstaande knoppen
- Voor toegankelijkheid ook `aria-label` toevoegen waar het `title` identiek is aan de knopfunctie
- Knoppen met een volledig label (`"Sessie afsluiten"`, `"Resultaten vrijgeven"`) krijgen een beschrijvendere `title` met extra context
- Tooltip-stijl: browser-native (geen custom CSS nodig) — de `title` attribuut is voldoende

**Betrokken bestanden:** `teacher-app.html` · `student-app.html` · `quiz-student.html` · `quiz-teacher.html`

---

#### 27i 🔴 — teacher-grid.html: leerlingenoverzicht blijft leeg *(~0.5 dag)*

**Probleem (zie screenshot):** De "⊞ Overzicht"-knop in teacher-app.html opent teacher-grid.html in een nieuw tabblad. Dat tabblad toont "Verbinden met sessie..." maar laadt nooit de leerlingen, ook niet als er wel leerlingen aangemeld zijn.

**Bewijs in de URL:** de screenshot toont `teacher-grid.html?code=` — de code-parameter is leeg. Zonder sessiecode kan het grid-venster geen `teacher_grid_observe` event sturen naar de server.

**Rootcause:** De knop-handler gebruikt `window._currentSessionCode`:
```js
qs('teacher-grid-view-btn')?.addEventListener('click', () => {
  const code = window._currentSessionCode || '';  // leeg als nog niet gezet!
  window.open('/teacher-grid.html?code=' + code, '_blank', ...);
});
```

`window._currentSessionCode` wordt pas gezet na het ontvangen van `teacher_session_data` via Socket.IO. Na de sprint 26 refactor (window-exports) kan dit event op een ander moment binnenkomen dan verwacht, of de variabele wordt niet correct bewaard tussen re-renders.

**Alternatieve oorzaak:** `window._currentSessionCode` wordt als `window.` property gezet vanuit de IIFE, maar de IIFE sluit na de exports — als de volgorde van uitvoering verandert, kan de property op het moment van klikken nog `undefined` zijn.

**Fix:**
1. De knop-handler fallback uitbreiden: naast `window._currentSessionCode` ook `getLS('teacherSessionCode')` proberen (dat wordt opgeslagen bij sessie-start in teacher-sessions.html)
2. De `teacher_grid_observe` emit in teacher-grid.html robuster maken: als `sessionCode` leeg is, probeer dan `localStorage.getItem('pycodeflow_teacherSessionCode')` als fallback

```js
// Fix in app.js — knop handler:
qs('teacher-grid-view-btn')?.addEventListener('click', () => {
  const code = window._currentSessionCode
    || getLS('teacherSessionCode')
    || '';
  if (!code) { pyAlert('Geen actieve sessie gevonden.', 'warn'); return; }
  window.open('/teacher-grid.html?code=' + code, '_blank', 'width=1400,height=900,resizable=yes');
});
```

```js
// Fix in teacher-grid.html — observe emit:
const sessionCode = params.get('code')
  || localStorage.getItem('pycodeflow_teacherSessionCode')
  || '';
```

**Betrokken bestanden:** `app.js` · `teacher-grid.html`

---

#### 27j 🟠 — Editor dark/light toggle verwijderen *(~0.5 dag)*

**Beslissing:** Net zoals de UI dark/light toggle in sprint 23q volledig verwijderd werd, wordt nu ook de **editor thema-toggle** verwijderd. De Monaco code-editor gebruikt altijd het donkere thema (`pycodeflow-dark`). De ☀️ knop en `Ctrl+Shift+T` shortcut verdwijnen.

**Wat er weg moet:**

**`app.js`:**
- `_editorTheme` localStorage-variabele (`pycodeflow_editor_theme`) — verwijderen
- `applyEditorTheme(owner, theme)` functie — verwijderen
- `toggleEditorTheme(owner)` functie — verwijderen
- `Ctrl+Shift+T` keydown handler — verwijderen
- "Editor thema wisselen · Ctrl+Shift+T" rij in sneltoetsen overlay — verwijderen
- Monaco initialisatie: altijd `theme: 'pycodeflow-dark'` (niet meer conditioneel op `_editorTheme`)
- `applyEditorTheme` aanroep na Monaco-init — verwijderen
- `window.toggleEditorTheme` en `window.applyEditorTheme` exports — verwijderen

**`teacher-app.html`:**
- `<button id="teacher-editor-theme-btn" ...>☀️</button>` — verwijderen

**`student-app.html`:**
- `<button id="student-editor-theme-btn" ...>☀️</button>` — verwijderen

**`free-editor.html`:**
- `<button id="free-editor-theme-btn" ...>☀️</button>` — verwijderen

**`styles.css`:**
- `.output-dark` / `.output-light` klassen — verwijderen
- `.editor-theme-dark` / `.editor-theme-light` klassen — verwijderen
- `.statusbar-dark` / `.statusbar-light` klassen — verwijderen
- `--gutter-bg` en `--gutter-fg` CSS-varianten voor light thema — verwijderen

**Na verwijdering:**
- Output paneel: altijd `output-dark` stijl (donker, groen tekst) hardcoden of inline zetten
- Statusbalk: altijd `background:#007acc; color:#fff` (blauw)
- Gutter: altijd `--gutter-bg:#1f2f57; --gutter-fg:#9fb3c8`
- Monaco: altijd `theme: 'pycodeflow-dark'`

**Betrokken bestanden:** `app.js` · `teacher-app.html` · `student-app.html` · `free-editor.html` · `styles.css`

---

#### 27k 🔴 — Leerling kan niet meer runnen in individuele modus *(~0.5 dag)*

**Probleem (zie screenshot):** In de individuele werkfase (klasmodus → "Start individuele werkfase") krijgen leerlingen telkens de melding "⏳ Even wachten — je kan opnieuw runnen over 3 seconde(n)." en kunnen ze nooit meer uitvoeren, ook niet na wachten.

**Rootcause 1 — Melding verdwijnt nooit automatisch:**

De `run_rate_limited` handler zet de meldingstekst in het output-paneel maar heeft geen `setTimeout` om hem te wissen na `waitMs` milliseconden:

```js
// Huidig — bericht blijft voor altijd staan
socket.on('run_rate_limited', ({ waitMs }) => {
  panel.textContent = `⏳ Even wachten — je kan opnieuw runnen over ${Math.ceil(waitMs/1000)} seconde(n).`;
});

// Fix — automatisch wissen + visuele countdown
socket.on('run_rate_limited', ({ waitMs }) => {
  panel.textContent = `⏳ Even wachten — je kan opnieuw runnen over ${Math.ceil(waitMs/1000)} seconde(n).`;
  setTimeout(() => {
    if (panel.textContent.startsWith('⏳ Even wachten')) panel.textContent = '';
  }, waitMs + 200);
});
```

**Rootcause 2 — runRateLimit niet gereset bij reconnect in individuele modus:**

`runRateLimit.delete(socket.id)` wordt aangeroepen bij socket-disconnect (`4392`). Maar bij een **reconnect** (socket krijgt een nieuw `socket.id`) wordt de nieuwe socket gekoppeld aan de bestaande student via `student_reconnect`. De `runRateLimit` Map voor het **nieuwe** socket-id is leeg — dat is correct. Maar als de leerkracht snel naar individuele modus switcht terwijl een run bezig is, kan de server-side `canRun` status (`s.personalCanRun`) op `false` staan.

**Rootcause 3 — `canRun` status niet teruggezet na wissel naar individuele modus:**

Bij "Start individuele werkfase" wisselt `classWorkspaceMode` naar `'personal'`. De `studentCanRun` check gebruikt dan `s.personalCanRun !== false`. Als `personalCanRun` ooit op `false` gezet is (bv. door "Run uit" knop bij de leerkracht) en de leerkracht switcht naar individuele modus, blijft die waarde `false` — de leerling kan dan nooit runnen.

**Fix:**
1. `run_rate_limited` handler: `setTimeout` toevoegen om bericht te wissen na `waitMs + 200ms`
2. Bij wissel naar individuele modus (`classWorkspaceMode = 'personal'`): alle `s.personalCanRun` resetten naar `true` tenzij expliciet uitgezet
3. Zelfde fix voor `free_run_rate_limited` handler (vrije editor)

**Betrokken bestanden:** `app.js` · `server.js`

---

#### 27l 🔴 — Database viewer: "Fout: query is not a function" *(~0.5 dag)*

**Probleem (zie screenshot):** Bij klikken op een tabel in de database viewer verschijnt "Fout: query is not a function" in het detailpaneel. De tabelgrid laadt wel correct (namen + rij-aantallen), maar tabelinhoud laden crasht.

**Rootcause:** De DB viewer endpoints (sprint 24g) importeren `query` zo:

```js
// server.js lijn 544 en 576 — FOUT
const { query } = require('./db/database.js');
```

Maar `database.js` exporteert `query` **niet** via `module.exports` — het is een interne functie. `module.exports` bevat enkel de publieke methodes (`getTeacherByUsername`, `createStudent`, etc.). `const { query }` destructureert dus `undefined`, en `query(...)` geeft "query is not a function".

**Waarom laadt het tabelgrid dan wel?**

Het tabelgrid (`GET /api/admin/db/tables`) gebruikt `await Promise.all(DB_VIEWER_TABLES.map(async (tbl) => { const { query } = require(...) }))` — de fout treedt op binnen een `try/catch` per tabel, die `{ error: true }` teruggeeft. De grid rendert dan blokjes met "0 rijen" zonder te crashen. Pas bij het laden van de inhoud (`GET /api/admin/db/tables/:name/rows`) is er geen omliggende try/catch op het juiste niveau en komt de fout door.

**Fix:** Gebruik `dbModule` (dat al als `const dbModule = require('./db/database')` op lijn 8 geïmporteerd is) en voeg een interne `query`-wrapper toe, of exporteer `query` vanuit database.js.

**Optie A — Eenvoudigst: exporteer `query` vanuit database.js:**
```js
// database.js — toevoegen aan module.exports
module.exports = {
  query,  // ← toevoegen
  async init() { ... },
  ...
}
```

**Optie B — Gebruik de pg pool direct in server.js:**
```js
// server.js DB viewer endpoints — vervang const { query } = require(...)
// door de al beschikbare dbModule of een directe pool.query aanroep
const { Pool } = require('pg');
// pool is al aangemaakt in database.js — exporteer die ook
```

**Voorkeur: Optie A** — kleinste wijziging, geen dubbele pool-instantie.

**Betrokken bestanden:** `database.js` · `server.js`

---

#### 27m 🔴 — Kan niet inloggen na verse installatie *(~0.5 dag)*

**Probleem:** Na een verse installatie zonder leerkrachten in de DB én zonder `.env`-credentials is inloggen onmogelijk. De check-deployment waarschuwt "Geen leerkrachten" maar de gebruiker weet niet dat dit de login blokkeert.

**Hoe login nu werkt (twee lagen):**

1. **Primair — PostgreSQL DB:** `credentialsAreValid()` zoekt de gebruiker via `dbModule.getTeacherByUsername()`. Als de tabel leeg is → geen match.
2. **Fallback — `.env`:** Als `POC_BASIC_USER` en `POC_BASIC_PASS_HASH` ingevuld zijn → worden die als backup gebruikt.
3. **Geen van beide** → `return false` → login mislukt.

**Wanneer treedt het op:**
- Verse installatie: geen leerkrachten aangemaakt (check-deployment zegt "⚠️ Geen leerkrachten")
- `.env` heeft `POC_BASIC_USER=` leeg of `POC_BASIC_PASS_HASH=` leeg → fallback werkt niet

**Gewenste situatie:** er zou altijd een noodlogin moeten zijn. Twee opties:

**Optie A — Bootstrap admin bij eerste start:**
Bij serverstart, als de `teachers` tabel leeg is, automatisch een admin-account aanmaken met credentials uit `.env` (`POC_BASIC_USER` + `POC_BASIC_PASS`/`HASH`). Zo is er altijd minstens één account.

**Optie B — Noodinlogknop in pycodeflow.sh (27n):**
Via optie 10 in pycodeflow.sh kan een leerkracht aangemaakt worden. Dit werkt ook als de server niet draait. Na aanmaken → server herstart → inloggen werkt.

**Fix voor 27m:** Bij serverstart controleren of de teachers-tabel leeg is. Zo ja, en als `POC_BASIC_USER` + `POC_BASIC_PASS` ingevuld zijn in `.env`: automatisch een admin-account aanmaken en loggen:

```js
// server.js — na dbModule.init()
const teachers = await dbModule.listTeachers();
if (teachers.length === 0 && BASIC_AUTH_USER && BASIC_AUTH_LEGACY_PASS) {
  const hash = createPasswordHash(BASIC_AUTH_LEGACY_PASS);
  await dbModule.createTeacher(BASIC_AUTH_USER, hash, BASIC_AUTH_USER, 'admin');
  console.log(`[bootstrap] Admin-account '${BASIC_AUTH_USER}' automatisch aangemaakt.`);
}
```

**Betrokken bestanden:** `server.js` · `pycodeflow.sh`

---

#### 27n 🟠 — pycodeflow.sh: volledig DB-beheer menu *(~1.5 dag)*

**Probleem:** Als je niet kunt inloggen op de webinterface, is er geen manier om via de NAS rechtstreeks DB-beheer uit te voeren buiten optie 10 (leerkracht toevoegen). Er is geen overzicht van klassen, leerlingen of andere data, en geen manier om wachtwoorden te resetten zonder de webinterface.

**Nieuw menu-item 19 — DB-beheer:**

```
19) 🗄  Database beheer
```

Sub-menu met volgende opties:

```
a) Leerkrachten tonen
b) Leerkracht toevoegen
c) Leerkracht verwijderen
d) Wachtwoord leerkracht resetten
e) Klassen tonen
f) Klas toevoegen
g) Leerlingen tonen (per klas)
h) Noodtoegang: bootstrap admin-account uit .env
i) Database statistieken (aantal rijen per tabel)
j) Volledige DB backup maken
```

**Implementatie:** Alle acties via `docker exec pycodeflow-web-1 node scripts/manage-teacher.js ...` — het `manage-teacher.js` script uitbreiden met klassen- en leerlingenbeheer, of een apart `manage-db.js` script toevoegen.

**Kritiekste optie — 19h: Bootstrap admin:**
Als de DB leeg is en inloggen onmogelijk:
```bash
# pycodeflow.sh optie 19h
# Haalt POC_BASIC_USER en POC_BASIC_PASS uit .env
# Maakt admin-account aan via manage-teacher.js
# Herstart web container
```

**Betrokken bestanden:** `pycodeflow.sh` · `web/scripts/manage-teacher.js` (uitbreiden)

---

### Sprint 25 — Rijke vraagstelling editor *(~6 dagen)*

**Aangemeld:** 27/06/2026
**Status:** ✅ Afgerond (v2026.2.25.0)
**Aanleiding:** De vraagstelling is momenteel een blinde textarea met Markdown. Er is geen visuele hulp, geen kleurondersteuning, geen duidelijke structuur voor opgaven. Leerlingen zien alle vragen in dezelfde zwart-op-witte layout waardoor niets opvalt of duidelijk afgebakend is.

**Doel:** Een leerkracht moet een vraag kunnen opmaken zoals in een Word-document — met kleur, kaders, tabellen en visuele feedback — zonder Markdown te kennen.

---

#### 25a — Visuele opmaaktoolbar boven de vraagstelling *(~2 dagen)*

**Probleem:** De leerkracht moet nu zelf Markdown-syntax kennen (`**vet**`, `` `code` ``, `##`, etc.). Er is geen visuele toolbar.

**Ontwerp:** Een horizontale toolbar met klikbare knoppen die Markdown-syntax invoegen op de cursorpositie in de textarea:

| Knop | Actie | Markdown |
|---|---|---|
| **B** | Vet | `**tekst**` |
| *I* | Cursief | `*tekst*` |
| `</>` | Inline code | `` `tekst` `` |
| `≡` | Code-blok (Python) | ` ```python\n...\n``` ` |
| H1 | Grote kop | `## Kop` |
| H2 | Kleine kop | `### Kop` |
| `•` | Lijst | `- item` |
| `1.` | Genummerde lijst | `1. item` |
| `—` | Horizontale lijn | `---` |
| 🎨 | Tekstkleur (dropdown) | `<span style="color:#e00">tekst</span>` |

**Technische aanpak:**
- Toolbar boven de `<textarea id="q-text">` in `quiz-bank.html`
- Elke knop roept `insertMarkdown(voor, na)` aan — wikkelt geselecteerde tekst in of voegt in op cursorpositie
- `selectionStart`/`selectionEnd` bewaren en herstellen na insertie
- Kleurkeuze via kleine inline dropdown (6 vaste kleuren: rood, oranje, groen, blauw, paars, grijs)
- Toolbar verborgen in preview-modus

**CSS:** toolbar als flex-rij met kleine knoppen, visueel afgescheiden van de textarea door een dunne border.

**Betrokken bestanden:** `quiz-bank.html`, `styles.css`

---

#### 25b — Gekleurde info-kaders in vraagstelling *(~1 dag)*

**Probleem:** Alle tekst in een vraag ziet er hetzelfde uit. Een leerkracht kan niet benadrukken wat een tip is, wat een waarschuwing is, of wat extra uitleg is.

**Ontwerp:** 4 types info-kaders, invoegbaar via de toolbar (knop 📦):

| Type | Kleur | Icoon | Gebruik |
|---|---|---|---|
| Tip | Groen | 💡 | Extra hulp voor de leerling |
| Opgelet | Oranje | ⚠️ | Veelgemaakte fout of valkuil |
| Kader | Blauw | 📌 | Afgebakende deelvraag of context |
| Hint | Paars | ❓ | Optionele aanwijzing |

**Implementatie:** Via een speciale `:::` syntax (gelijkaardige aan Markdown containers):

```markdown
:::tip
Dit is een tip voor de leerling.
:::

:::opgelet
Let op: vergeet de haakjes niet.
:::

:::kader
**Deelvraag a)** Schrijf een functie die ...
:::

:::hint
Denk aan de `range()` functie.
:::
```

**Rendering in `marked.js`:** Een custom renderer of preprocessing-stap die `:::type` blokken omzet naar `<div class="info-kader info-tip">...</div>` vóór het Markdown parsen.

**CSS:** Elke kader-type heeft eigen kleur, linker border-accent, en icoon via `::before` pseudo-element.

**Toolbar-knop:** Dropdown met 4 kader-types → klik voegt `:::type\n\n:::` in op cursorpositie.

**Betrokken bestanden:** `quiz-bank.html`, `styles.css`

---

#### 25c — Tabel-invoer in vraagstelling *(~1 dag)*

**Probleem:** Een leerkracht die een tabel wil invoegen in een vraag moet Markdown-tabelsyntax kennen:
```markdown
| Kolom 1 | Kolom 2 |
|---|---|
| Waarde | Waarde |
```
Dit is omslachtig en foutgevoelig.

**Ontwerp:** Een "Tabel invoegen" modal via de toolbar (knop `⊞`):
- Kies aantal rijen (1–10) en kolommen (1–8) via +/- knoppen
- Mini-grid van invoervelden verschijnt
- Eerste rij = koptekst (vet)
- Klik "Invoegen" → genereert correcte Markdown-tabel en voegt in op cursorpositie

**Voorbeeld output bij 2 kolommen, 2 rijen:**
```markdown
| Kolom 1 | Kolom 2 |
|---|---|
| Waarde 1 | Waarde 2 |
| Waarde 3 | Waarde 4 |
```

**Betrokken bestanden:** `quiz-bank.html`, `styles.css`

---

#### 25d — Live split-view editor *(~1 dag)*

**Probleem:** De huidige flow is: typ tekst → klik Preview → kijk resultaat → klik Bewerken → typ verder. Dit is traag en verbreekt de schrijfflow.

**Ontwerp:**

Drie modi, schakelbaar via een toggle-knop in de toolbar:

| Modus | Icoon | Gedrag |
|---|---|---|
| Volledig (textarea) | `[ ]` | Standaard — enkel editor, geen live preview. Huidig gedrag. |
| Split-view | `[ ][ ]` | Editor links (50%), live preview rechts (50%). Preview update bij elke toetsaanslag (100ms debounce). |
| Volledig (preview) | `[👁]` | Enkel preview, editor verborgen. Zelfde als huidige Preview-knop. |

**Toggle-knop:** een discrete drieknops-groep rechts in de toolbar (naast de bestaande Preview-knop die verdwijnt):
```
[ □ ] [ □□ ] [ 👁 ]
  ↑      ↑      ↑
Tekst  Split  Preview
```

**Voorkeur opgeslagen in `localStorage`** (`pycodeflow_editor_mode`):
- De modus wordt per browser onthouden
- Standaard: volledig (textarea) — split-view is opt-in, niet standaard
- Instelling geldt enkel voor de vragenbank, niet voor andere editors

**Technische aanpak:**
- CSS grid op de vraagstelling-container: `grid-template-columns: 1fr` (volledig) of `1fr 1fr` (split)
- `oninput` op textarea → debounced `marked.parse()` → rechter preview-paneel bijwerken
- Op scherm < 900px: split-view automatisch uitgeschakeld en vervalt naar volledig; toggle-knop toont waarschuwing bij poging

**Betrokken bestanden:** `quiz-bank.html` · `styles.css`

---

#### 25e — Leerlingscherm + verbetermodule: uitgebreide rendering *(~0.5 dag)*

**Probleem:** De nieuwe opmaak-elementen uit 25a–25c (kleuren, kaders, tabellen) worden wel opgeslagen in de database maar de rendering in `quiz-student.html` en `quiz-review.html` ondersteunt ze nog niet. De custom `:::kader` syntax wordt niet herkend, `<span style="color:...">` wordt mogelijk gestript door de CSP, tabellen hebben geen stijl.

**Aanpak:**
- Zelfde custom `:::type` preprocessor toevoegen aan de `marked.parse()` aanroep in `quiz-student.html` en `quiz-review.html`
- CSS voor `.info-kader`, `.info-tip`, `.info-opgelet`, `.info-hint`, `.info-kader` toevoegen aan `styles.css`
- Markdown-tabel CSS toevoegen: gestreepte rijen, border, koptekst-achtergrond
- Inline kleur via `<span style="color:...">`: expliciet toestaan via `marked`-opties (`sanitize: false`) — veilig omdat content door leerkracht ingevoerd wordt, niet door leerling

**Betrokken bestanden:** `quiz-student.html`, `quiz-review.html`, `styles.css`

---

**Implementatievolgorde:** 25g → 25d → 25a → 25b → 25c → 25e
*(Notificatiesysteem eerst — alles wat daarna gebouwd wordt gebruikt meteen de nieuwe modals)*

---

#### 25g 🔴 — Notificatiesysteem herontwerpen *(~1 dag)*

**Probleem:** De huidige `pyToast()` verschijnt rechtsonder in een klein vakje, verdwijnt na 4 seconden, en blokkeert de pagina niet. Voor een validatiefout ("Voer een naam in") is dit **te onopvallend** — de leerkracht ziet het mogelijk niet eens, zeker niet op een groot scherm of als de aandacht elders is.

**Beslissing:** Drie aparte notificatie-niveaus, elk met eigen gedrag:

---

**Niveau 1 — pyToast() — blijft bestaan, voor achtergrondinfo**

Gebruik voor: niet-kritieke achtergrondinfo die de gebruiker niet hoeft te bevestigen.
- Positie: rechtsonder
- Verdwijnt automatisch na 4 seconden
- Voorbeelden: "Opgeslagen", "Geïmporteerd", "Resultaten vrijgegeven"

---

**Niveau 2 — pyAlert() — NIEUW: blokkerende notificatie-modal**

Gebruik voor: **validatiefouten, foutmeldingen, waarschuwingen** die de gebruiker expliciet moet lezen en bevestigen.
- Centreert op het scherm met overlay (pagina blokkeert)
- Eén "OK" knop (of "Sluiten")
- Kleurcodering per type:
  - 🔴 Fout: rode rand, fout-icoon ✕
  - 🟠 Waarschuwing: oranje rand, waarschuwing-icoon ⚠️
  - 🟢 Succes: groene rand, vinkje ✓
  - 🔵 Info: blauwe rand, info-icoon ℹ️
- Animatie: fade-in + lichte scale-in (0.92 → 1)
- Focus gaat automatisch naar de OK-knop
- Escape sluit de modal
- Geeft `Promise<void>` terug (await mogelijk)

**API:**
```javascript
// Vervang pyToast(msg, 'warn'/'error') door:
await pyAlert('Voer een naam in voor de toets.', 'warn');
await pyAlert('Netwerkfout: kon niet opslaan.', 'error');
await pyAlert('Toets aangemaakt! Code: ABC123', 'success');
await pyAlert('Deadline moet na de startdatum liggen.', 'warn');
```

**Verschil met pyConfirm():** pyAlert heeft slechts één knop (OK/Sluiten), pyConfirm heeft twee knoppen (Bevestigen + Annuleren). Ze gebruiken dezelfde modal-stijl.

---

**Niveau 3 — pyConfirm() — ongewijzigd, voor bevestigingen**

Gebruik voor: destructieve of onomkeerbare acties.
- Twee knoppen: Bevestigen (primary/danger) + Annuleren
- Ongewijzigd t.o.v. v2026.2.23.4

---

**Implementatie:**

1. `pyAlert()` toevoegen in `app.js` (naast `pyToast` en `pyConfirm`)
2. Alle `pyToast(msg, 'warn')` en `pyToast(msg, 'error')` vervangen door `pyAlert(msg, 'warn')` resp. `pyAlert(msg, 'error')` op alle pagina's
3. `pyToast(msg, 'success')` **behouden als toast** (niet blokkerend — succes hoeft niet bevestigd te worden)
4. CSS aanpassen: kleurgecodeerde borders per type in de modal

**Alle plaatsen waar dit van toepassing is (na 25f al pyToast):**

| Pagina | Huidige call | Wijzigen naar |
|---|---|---|
| quiz-teacher.html | `pyToast('Voer een naam...', 'warn')` | `pyAlert(...)` |
| quiz-teacher.html | `pyToast('Selecteer minstens...', 'warn')` | `pyAlert(...)` |
| quiz-teacher.html | `pyToast('Deadline moet...', 'warn')` | `pyAlert(...)` |
| quiz-teacher.html | `pyToast('Fout bij aanmaken...', 'error')` | `pyAlert(...)` |
| quiz-teacher.html | `pyToast('Netwerkfout...', 'error')` | `pyAlert(...)` |
| quiz-bank.html | `pyToast('Vul een vraagstelling...', 'warn')` | `pyAlert(...)` |
| quiz-bank.html | `pyToast('Vul minstens 2 opties...', 'warn')` | `pyAlert(...)` |
| quiz-bank.html | `pyToast('Selecteer minstens 1...', 'warn')` | `pyAlert(...)` |
| quiz-bank.html | `pyToast('Fout bij opslaan...', 'error')` | `pyAlert(...)` |
| quiz-bank.html | `pyToast('Netwerkfout...', 'error')` | `pyAlert(...)` |
| quiz-bank.html | `pyToast('Kan niet verwijderen...', 'error')` | `pyAlert(...)` |
| admin.html | alle `pyToast(..., 'warn'/'error')` | `pyAlert(...)` |
| quiz-archive.html | alle `pyToast(..., 'warn'/'error')` | `pyAlert(...)` |
| quiz-student.html | `pyToast(foutmelding, 'error')` | `pyAlert(...)` |
| monitoring.html | `pyToast(fout, 'error')` | `pyAlert(...)` |

**Succes-toasts behouden als toast (niet blokkerend):**
- "Toets aangemaakt! Code: ..."
- "Opgeslagen"
- "Resultaten vrijgegeven"
- "Toets definitief verwijderd"
- "Klaar! X toetsen gearchiveerd"

**Betrokken bestanden:** `app.js` · `styles.css` · alle pagina's met validatie/foutmeldingen

---

#### 25f — Resterende browser alert()/confirm() *(v2026.2.24.1 — afgerond)*

Alle `alert()` en `confirm()` vervangen door `pyToast()`/`pyConfirm()` op quiz-teacher, quiz-archive, quiz-review, quiz-student en monitoring. Zie changelog v2026.2.24.1.

---

#### 25h — Live leerkracht-preview vóór toets opslaan *(~1.5 dag)*

**Probleem:** De leerkracht stelt stap 1 (instellingen) en stap 2 (vragen) in, gaat naar stap 3 (bevestigen) en ziet enkel een droge samenvatting. Ze weet pas hoe de toets er **echt** uitziet voor een leerling nádat ze hem aangemaakt heeft. Problemen met layout, opmaak of vraagvolgorde worden pas ontdekt als leerlingen al bezig zijn.

**Oplossing:** Een **stap 3b** — een volledig interactieve preview-modus die de exacte leerlingeninterface toont, rechtstreeks in de browser van de leerkracht, vóór de toets definitief aangemaakt wordt.

---

**Positie in de wizard:**

```
① Basisinfo  →  ② Vragen  →  ③ Live preview  →  ④ Bevestigen & opslaan
                                    ↑ NIEUW
```

Stap 3 (huidige "Bevestigen") wordt stap 4. Stap 3 wordt de live preview.

---

**Hoe het werkt:**

1. Leerkracht klikt "→ Preview →" op stap 2
2. Een **volledige schermovername** opent (fixed overlay):
   - Ziet er exact uit als `quiz-student.html` voor de leerling
   - Toetsnaam en timer-indicator bovenaan — timer loopt **niet** (enkel visueel)
   - Vraagnavigator: alle vraagnummers klikbaar
   - Per vraag: exacte rendering van vraagstelling (Markdown, code-blokken, info-kaders)
   - Python code-vragen: Monaco editor actief, **code kan gerund worden** (echte runner)
   - Open vragen: textarea aanwezig, tekst invullen mogelijk
   - Single/meerkeuze: opties klikbaar (zonder persistentie)
3. Gele **"🔍 PREVIEW MODUS"** banner bovenaan: "Dit is een preview — antwoorden worden niet opgeslagen"
4. Knop **"✅ Ziet er goed uit → Opslaan"** → gaat naar stap 4 (bevestigen + opslaan)
5. Knop **"✎ Aanpassen"** → terug naar stap 2

---

**Preview-panel layout:**

```
┌──────────────────────────────────────────────────────────────┐
│  🔍 PREVIEW MODUS — antwoorden worden niet opgeslagen        │ ← gele banner
│  [✎ Aanpassen ← ]                 [ ✅ Ziet er goed uit → ] │
├───────────────┬──────────────────────────────────────────────┤
│  1  2  3  4   │  Vraag 2 van 4                               │
│  ✓  ●         │  ┌─────────────────────────────────────────┐ │
│               │  │ Schrijf een functie die de som berekent │ │
│               │  └─────────────────────────────────────────┘ │
│               │  ┌─── Monaco editor ──────────────────────┐  │
│               │  │  def som(a, b):                        │  │
│               │  └────────────────────────────────────────┘  │
│               │  [▶ Uitvoeren]   Output: 5                   │
└───────────────┴──────────────────────────────────────────────┘
```

---

**Technische aanpak — Optie A: Inline panel (voorkeur)**

- Verborgen `<div id="preview-panel">` in `quiz-teacher.html` die de volledige viewport overneemt (`position:fixed; inset:0; z-index:500`)
- Vragen worden geladen vanuit `_selected` (geselecteerde vragen stap 2) — **geen server-roundtrip**
- Vraagvolgorde "random" → willekeurig geschud + knop "🔀 Andere volgorde" om opnieuw te schudden
- Monaco editor laadt via bestaande `require(['vs/editor/editor.main'],...)`
- Runner werkt via Socket.IO (al verbonden)
- Antwoorden worden **nergens opgeslagen** (enkel lokale preview-state)

**Optie B: Tijdelijke toets (fallback)**
- Maak tijdelijke toets aan met `is_preview: true` + `expires_in: 30min`, open in nieuw tabblad
- Nadeel: server-roundtrip, leerling-URL zichtbaar, complexer
- Optie A heeft sterke voorkeur

---

**Aandachtspunten:**
- Timer: getoond maar bevroren ("45:00" zonder aftelling)
- Info-kaders (sprint 25b) en Markdown correct gerenderd
- Vraagvolgorde "vast": volgorde uit stap 2
- Vraagvolgorde "random": preview toont één willekeurige shuffle + herscudknop
- Op mobiel: preview schaalt correct mee (zelfde responsive CSS als quiz-student)

**Betrokken bestanden:** `quiz-teacher.html` · `app.js` · `styles.css`

---

### Sprint 24 — UI/UX ronde 2 *(~5.5 dagen)*

#### 24a — Vervang confirm() / alert() door in-app modals *(~1.5 dag)*

**Probleem:** Alle bevestigings- en foutdialogen gebruiken browser-native `confirm()` / `alert()`. Die zien er lelijk uit, zijn niet te stylen en inconsistent met de rest van de UI.

**Aanpak:**
- `window.pyConfirm({ title, body, confirmLabel, danger })` → `Promise<boolean>` — vervangt `confirm()`
- `window.pyToast(message, type, duurMs)` — vervangt `alert()` voor foutmeldingen, verschijnt rechtsonder
- CSS in `styles.css`: modal overlay + toast container
- Omschakelen in: `quiz-bank.html`, `admin.html`, `quiz-review.html`
- Keyboard: `Escape` annuleert, `Enter` bevestigt (enkel als confirm-knop focus heeft), focus trap in modal

**Betrokken bestanden:** `app.js` · `styles.css` · `quiz-bank.html` · `admin.html` · `quiz-review.html`

---

#### 24b — Code-snippet in vraagstelling renderen als Python code-blok *(~0.5 dag)*

**Probleem:** Als een vraagstelling een code-fragment bevat (ingevoerd met backticks in Markdown), wordt het in de vragenbank-kaart getoond als gewone inline tekst — niet als opgemaakt code-blok.

**Oorzaak:** De `.q-text` div gebruikt `white-space:pre-wrap` en `esc()` maar geen Markdown rendering. Enkel de Preview-knop rendert Markdown; de kaartweergave niet.

**Aanpak:**
- Gebruik `marked.parse()` ook in `renderQuestions()` voor de `.q-text` div
- Begrens de hoogte van lange code-blokken in de kaart (`max-height: 120px; overflow:auto`)
- Zorg dat `<pre><code>` blokken in de kaart een donkere achtergrond krijgen (Consolas, #1e1e1e)

**Betrokken bestanden:** `quiz-bank.html`

---

#### 24c — Single/meerkeuze keuze-opties layout kapot *(~1 dag)*

**Probleem (zie screenshot):**
1. Radio/checkbox staat gecentreerd in een leeg groot vlak — tekstveld is onzichtbaar of buiten de kaart
2. "Opti" en "</> Code" knoppen staan buiten de kaartrand rechts
3. De hele `.choice-row` layout klopt niet: flex-richting, breedte en zichtbaarheid van inputs zijn verkeerd

**Oorzaak:** De `.choice-body` en `.choice-text-input` CSS mist `width:100%` of `min-width:0` binnen de flex-container, waardoor het tekstveld inkrimpt tot nul breedte. De knoppen rechts staan buiten de padding van de `.form-panel`.

**Aanpak:**
- Fix `.choice-row` flex layout: `display:flex; align-items:flex-start; gap:8px; width:100%; box-sizing:border-box`
- Fix `.choice-body`: `flex:1; min-width:0; display:flex; flex-direction:column; gap:6px`
- Fix `.choice-text-input`: `width:100%; box-sizing:border-box`
- Verplaats "Opti" en "</> Code" knoppen binnen de kaart (niet rechts erbuiten)
- Visueel: optie-rijen als lichte cards binnen het keuze-panel

**Betrokken bestanden:** `quiz-bank.html` (CSS + `renderChoices()`)

---

#### 24d — Wisselen single↔meerkeuze verandert radio/checkbox niet *(~0.5 dag)*

**Probleem:** Als je van "Single choice" naar "Meerkeuze" wisselt (of omgekeerd), blijven de bestaande opties radio-buttons of checkboxes tonen van het vorige type. `onTypeChange()` roept `renderChoices()` aan maar de bestaande `_choices` array wordt niet opnieuw gerenderd met het juiste input-type.

**Oorzaak:** `onTypeChange()` roept `renderChoices()` enkel aan als `_choices.length === 0`. Als er al opties zijn, wordt niet opnieuw gerenderd.

**Fix:**
```js
function onTypeChange(type) {
  const panel = document.getElementById('choices-panel');
  panel.style.display = ['single','multiple'].includes(type) ? 'block' : 'none';
  if (['single','multiple'].includes(type)) {
    if (_choices.length === 0) {
      _choices = [
        { id: crypto.randomUUID(), text:'', isCode:false, correct:false },
        { id: crypto.randomUUID(), text:'', isCode:false, correct:false },
      ];
    }
    renderChoices(); // altijd opnieuw renderen bij type-wissel
  }
}
```

**Betrokken bestanden:** `quiz-bank.html`

---

#### 24e — "Nieuwe toets" pagina layout *(~1 dag)*

**Probleem (zie screenshot):**
- Checkboxes voor "Vraagstelling verbergen", "Min. 1 run" en "Test als leerkracht" staan als losse lege vakjes zonder label naast elkaar — labels staan rechts los in de ruimte
- Timer radio-buttons en vraagvolgorde staan in een onlogische grid
- Tijdsvenster-sectie heeft inconsistente opmaak
- Algemeen: te veel witruimte, inconsistente card-stijlen

**Aanpak:**
- Elke checkbox-optie wordt een `checkbox-row` card (label + checkbox samen, zoals in de rest van de app)
- Timer en volgorde in een duidelijke 2-koloms grid met visuele scheiding
- Tijdsvenster-sectie consistent met de card-stijl uit de rest van de wizard
- Responsief: op smal scherm alles 1 kolom

**Betrokken bestanden:** `quiz-teacher.html` · `styles.css`

---

#### 24f — Sessieoverzicht lopende sessies layout *(~1 dag)*

**Probleem (zie screenshot):**
- Sessiekaarten tonen een nette meta-grid (Type, Leerlingen, Code, Codehulp) — dit ziet er goed uit
- Maar: de kaarten in het overzicht lijken te breed/te groot ten opzichte van de beschikbare ruimte
- De subnav ontbreekt op de sessie-pagina bij lopende sessies weergave
- Sessie-code badge (goud) is correct maar de kaart-layout heeft te veel padding en inconsistente font-groottes

**Aanpak:**
- Sessiekaarten compacter maken: minder padding, kleinere meta-grid items
- Subnav aanwezig op alle leerkrachtpagina's (24f lost dit ook op voor teacher-sessions)
- Code-badge prominenter tonen
- Actieknoppen (Open, Waarnemen, Blokkeren, Verwijderen) op één rij, consistent gestyled

**Betrokken bestanden:** `teacher-sessions.html` · `styles.css`

---

#### 24g — Database-viewer in monitoring.html *(~1.5 dag)*

**Probleem:** De monitoring-pagina toont enkel "● Verbonden · 17 tabellen" als PostgreSQL-status. Er is geen manier om de structuur of inhoud van de database te bekijken zonder SSH/pgAdmin.

**Gewenste werking:**

1. **Tabeloverzicht — grid van blokken** (altijd zichtbaar in de PostgreSQL-sectie)
   - Eén blokje per tabel, in een responsive grid (3–4 kolommen op breed scherm)
   - Per blokje: tabelnaam, aantal rijen, kolommen (als kleine badges), klikbaar
   - Kleurcodering per categorie: kern (blauw), quiz (groen), systeem (grijs)

2. **Tabelinhoud — op klik** (onder het grid, volledige breedte)
   - Klik op een tabelblok → sectie opent onder het volledige grid
   - Toont een scrollbare tabel met kolomhoofd + rijen (max. 100 rijen, pagineerbaar)
   - Zoekbalk om te filteren op waarde in een willekeurige kolom
   - Sluitknop + highlight op het geselecteerde blok
   - Lange waarden (JSON, code) ingekort met "..." en tooltip op hover

**Benodigde API-endpoints (server.js):**

```js
// Alle tabellen met kolominfo en rij-aantallen
GET /api/admin/db/tables
→ [{ name, rowCount, columns: [{ name, type }], category }]

// Inhoud van één tabel (gepagineerd, optioneel gefilterd)
GET /api/admin/db/tables/:name/rows?limit=100&offset=0&search=
→ { columns: [...], rows: [...], total }
```

**Beveiliging:**
- Beide endpoints achter `requireTeacherAuth` + enkel Admin-rol toegestaan
- Whitelist van toegestane tabelnamen (exact de 17 bekende tabellen) — geen vrije SQL-input
- Gevoelige kolommen (`password_hash`, `cookie_secret`) worden server-side gemaskeerd als `••••••`
- Maximaal 100 rijen per request, geen export mogelijk vanuit deze viewer

**Betrokken bestanden:** `monitoring.html` · `server.js` · `database.js`

---

#### 24h — admin.html topbar opruimen *(~0.5 dag)*

**Probleem (zie screenshot):** De topbar van `admin.html` toont nog "← Sessies" en "📊 Monitoring" als losse knoppen in de primaire topbar — dit was de oude structuur van vóór sprint 22j. De subnav staat er wél al correct onder, maar de topbar-knoppen dupliceren en storen.

**Huidig:**
```
[PyCodeFlow] [Beheer]          ← primaire topbar
[← Sessies] [📊 Monitoring]   ← losse knoppen, VERKEERD
[Vragenbank][Nieuwe toets]...  ← subnav (correct)
```

**Gewenst:**
```
[PyCodeFlow] [Beheer]   [Afmelden]  ← primaire topbar, clean
[Vragenbank][Nieuwe toets][Archief][Beheer*][Systeem]  ← subnav met active op Beheer
```

**Fix:** "← Sessies" en "📊 Monitoring" verwijderen uit de primaire topbar van `admin.html`. "Afmelden"-knop toevoegen aan de primaire topbar (ontbreekt ook). De subnav bevat al een link naar Systeem (= monitoring) en de sessies zijn bereikbaar via het logo/breadcrumb.

**Betrokken bestanden:** `admin.html`

---

### Sprint 23 — Senior tester audit *(~9 dagen)*

**Aangemeld:** 27/06/2026 — resultaat van volledige code-review over alle pagina's, server-endpoints en database.
**Status:** ✅ Afgerond (v2026.2.23.0) · Hotfix v2026.2.23.1
**Impact:** Mix van kritieke dataverlies-bugs (23a, 23b), een 500-error route (23c), en een reeks layout/consistentieproblemen.
**Volgorde:** 23a en 23b zijn blokkend voor sprint 18b (automatische scoring). 23c is blokkend voor elke omgeving die /teacher-start.html aanroept.

---

#### 23q 🟠 — Dark/light mode volledig verwijderen *(~1 dag)*

**Beslissing:** de dark/light mode toggle werkt niet zoals gewenst en wordt volledig uit de applicatie verwijderd. De app gebruikt voortaan altijd het lichte thema.

**Wat er weg moet:**

**HTML (alle pagina's):**
- `<button class="dark-toggle" id="dark-mode-toggle">🌙</button>` — verwijderen op elke pagina
- `data-theme="light"` attribuut op `<html>` — verwijderen (of laten staan als neutrale standaard zonder CSS-effect)

**styles.css:**
- Alle `[data-theme="dark"] { ... }` blokken verwijderen — dit zijn 24 blokken verspreid door de stylesheet (zie ook 23n). Dit lost meteen 23n op.
- `.dark-toggle` CSS-definitie verwijderen

**app.js:**
- Dark mode initialisatie (`localStorage.getItem('theme')`, `document.documentElement.setAttribute('data-theme', ...)`) verwijderen
- `dark-mode-toggle` event listener verwijderen
- `toggleEditorTheme()` functie verwijderen (of houden als puur editor-donker/licht, los van de UI-toggle)

**Aandachtspunten:**
- De Monaco editor-toolbar gebruikt `rgba(255,255,255,0.15)` voor zijn knoppen (donkere achtergrond). Die stijl is onafhankelijk van de dark-mode toggle en blijft behouden.
- De statusbalk in de editor (`background:#007acc`) is ook onafhankelijk en blijft.
- `localStorage`-key `theme` na verwijdering negeren (geen migratie nodig).
- Na verwijdering: `[data-theme="dark"]` in `styles.css` volledig weggooien zodat de stylesheet ook meteen compacter wordt.

**Betrokken bestanden:** alle `.html`-pagina's (15 stuks), `styles.css`, `app.js`

---

#### 23a 🔴 — selected_choices niet opgeslagen in DB *(~0.5 dag)*

**Bevinding:** De `quiz_save_answer`-handler in `server.js` stuurt `selected_choices` **niet** mee naar `dbModule.saveQuizAnswer()`. De functiesignatuur in `database.js` accepteert `selectedChoices` en gebruikt het in de INSERT, maar de aanroeper geeft het nooit mee — de parameter valt terug op de default `'[]'`.

Concreet: antwoorden op single choice en meerkeuze vragen worden **nooit** persistent opgeslagen. In-memory klopt het (tijdens de sessie), maar na een server-herstart of bij het openen van de verbetermodule zijn alle keuze-antwoorden leeg.

**Fix:**
```js
// server.js — quiz_save_answer handler (lijn ~4103)
dbModule.saveQuizAnswer({
  sessionCode: ctx.code, studentId: ctx.studentId,
  studentName: student.name, studentClass: student.className || '',
  questionId, personalOrder: student.quizPersonalOrder?.indexOf(questionId) ?? 0,
  code, runCount: runCount || 0,
  firstVisitAt: firstVisitAt || null, firstRunAt: firstRunAt || null,
  selectedChoices: JSON.stringify(data?.selectedChoices || []),  // ← ontbrak
})
```
Hetzelfde ontbreekt in de auto-submit handler (lijn ~4179).

**Betrokken bestanden:** `server.js`

---

#### 23b 🔴 — isCode-opties niet gerenderd bij leerling en verbeteren *(~1 dag)*

**Bevinding:** In sprint 22e is de `isCode`-property per antwoordoptie toegevoegd in de vragenbank (zodat een optie als code-blok weergegeven kan worden). Maar noch `quiz-student.html` (leerling tijdens toets) noch `quiz-review.html` (leerkracht verbetermodule) houdt rekening met `isCode`.

**quiz-student.html — renderChoices():** toont altijd `${escHtml(ch.text)}` als gewone tekst.
**quiz-review.html — choiceRows:** zelfde probleem, `ch.text` altijd als `<span>`.

**Fix:** voeg `isCode`-check toe aan beide renderers:
```js
const textHtml = ch.isCode
  ? `<pre style="background:#1e1e1e;color:#d4d4d4;padding:8px;border-radius:6px;
       font-family:Consolas,monospace;font-size:0.85rem;margin:0;overflow:auto;">${escHtml(ch.text)}</pre>`
  : `<span style="font-size:0.95rem;line-height:1.5;">${escHtml(ch.text)}</span>`;
```

**Betrokken bestanden:** `quiz-student.html`, `quiz-review.html`

---

#### 23c 🔴 — teacher-start.html route zonder bestand → 500 *(~0.5 dag)*

**Bevinding:** `server.js` heeft een GET-route op `/teacher-start.html` (lijn 441) die `sendFile` aanroept op een bestand dat **niet bestaat** in `web/public/`. Elke bezoeker van die URL krijgt een 500-fout.

**Opties:**
1. Route verwijderen als `/teacher-start.html` nergens meer gelinkt is.
2. Redirect naar `/teacher-sessions.html`.

Navraag in de HTML-bestanden toont dat `/teacher-start.html` nergens actief gelinkt wordt → optie 1 is verkieslijk.

**Betrokken bestanden:** `server.js`

---

#### 23d 🟠 — student-app.html: kapotte versie-querystring op app.js *(~0.5 dag)*

**Bevinding:** `student-app.html` laadt app.js als:
```html
<script src="/app.js?v2026.2.8.2"></script>
```
Het vraagteken staat er maar de `=` ontbreekt — de browser stuurt de querystring wél mee maar het is eigenlijk één string zonder key-value. Dit is geen technische breuk (browsers parsen het toch) maar:
1. Het is inconsistent met alle andere pagina's die `?v=v2026.2.x.x` gebruiken.
2. De versie is `v2026.2.8.2` — meer dan 10 sprints achter. Bij een cache-hit op de client kan een leerling verouderde JS draaien.

**Fix:** versie bijwerken naar `?v=v2026.2.18.0` (of actueel) en `=` toevoegen.

**Betrokken bestanden:** `student-app.html`

---

#### 23e 🟠 — quiz-student: open antwoord mist maxlength + Enter-fix *(~0.5 dag)*

**Bevinding:**
1. De open-antwoord-textarea toont "0 / 2000 tekens" als counter maar heeft geen `maxlength="2000"` attribuut — de limiet wordt dus niet afgedwongen. De leerling kan meer dan 2000 tekens invullen die dan toch opgeslagen worden.
2. De textarea mist `onkeydown="event.stopPropagation()"` net als de fix uit sprint 22a — op sommige browsers/wrappers kan Enter nog steeds onderschept worden.

**Fix:**
```html
<textarea id="quiz-open-answer" rows="8" maxlength="2000"
  onkeydown="event.stopPropagation()"
  oninput="updateOpenCount()" ...>
```

**Betrokken bestanden:** `quiz-student.html`

---

#### 23f 🟠 — admin.html logo: /favicon.ico ontbreekt op schijf *(~0.5 dag)*

**Bevinding:** `admin.html` gebruikt `/favicon.ico` als logo-afbeelding in de topbar:
```html
<img src="/favicon.ico" width="28" height="28" alt=""/>
```
Maar `favicon.ico` **bestaat niet** op de webserver (enkel `assets/favicon.png`). Dit geeft een gebroken afbeelding in de topbar van het beheerscherm.

**Fix:** vervang door `/assets/logo.svg` (zoals alle andere pagina's) en voeg een favicon-tag toe aan de `<head>`:
```html
<link rel="icon" href="/assets/favicon.png" type="image/png">
```

**Betrokken bestanden:** `admin.html`

---

#### 23g 🟠 — Engelstalige placeholders in NL applicatie *(~0.5 dag)*

**Bevinding:** Twee inputvelden hebben een Engelstalige placeholder terwijl de rest van de applicatie volledig Nederlands is:
- `student-app.html` lijn 71: `placeholder="Input unavailable"`
- `teacher-app.html` lijn 224: `placeholder="Input unavailable"`

Dit veld is de runtime-input voor leerlingen/leerkrachten bij een `input()`-call in Python. Het veld is standaard disabled en wordt pas actief bij een input-request.

**Fix:** vervang door `placeholder="Invoer niet beschikbaar"`.

**Betrokken bestanden:** `student-app.html`, `teacher-app.html`

---

#### 23h 🟠 — Inconsistente CSS-versiestrings *(~0.5 dag)*

**Bevinding:** De `styles.css`-link gebruikt inconsistente versiestrings:

| Pagina | Versiestring |
|---|---|
| monitoring.html | `?v=monitor1` |
| teacher-login.html | `?v=blockfix2` |
| index.html | *(geen versiestring)* |
| student-start.html | `?v=v2026.2.11.0` |
| student-app.html | `?v=v2026.2.12.0` |
| overige pagina's | `?v=v2026.2.18.0` |

Dit heeft als risico dat leerlingen of leerkrachten op machines met agressieve browser-caching verouderde CSS draaien, wat tot layout-breuken leidt na een update.

**Fix:** alle pagina's bijwerken naar `?v=v2026.2.18.0`.

**Betrokken bestanden:** `monitoring.html`, `teacher-login.html`, `index.html`, `student-start.html`, `student-app.html`, `free-editor.html`

---

#### 23i 🟠 — Subnav ontbreekt op alle leerkrachtpagina's behalve teacher-sessions *(~1 dag)*

**Bevinding:** Sprint 22j voegde een secundaire navigatiebalk (`subnav`) toe aan `teacher-sessions.html`. Maar de subnav is **niet aanwezig** op:
- `quiz-bank.html` — heeft eigen terugknop
- `quiz-teacher.html` — heeft eigen terugknop
- `quiz-archive.html` — heeft eigen terugknop
- `admin.html` — heeft eigen terugknop
- `quiz-review.html` — heeft eigen terugknop
- `monitoring.html` — heeft eigen terugknop

Gevolg: de leerkracht ziet de subnav enkel op de sessiepagina maar verliest die navigatiestructuur zodra ze doorklikken.

**Aanpak:**
- Extraheer subnav HTML + CSS naar een herbruikbaar component/fragment.
- Voeg de subnav toe aan alle leerkrachtpagina's.
- Markeer de actieve pagina met `class="active"` per pagina.
- Zorg dat de subnav correct omgaat met de `position: sticky` offset zonder de page-content te bedekken.

**Betrokken bestanden:** alle leerkrachtpagina's, `styles.css`

---

#### 23j 🟠 — 8 pagina's zonder favicon-tag *(~0.5 dag)*

**Bevinding:** De volgende pagina's missen een `<link rel="icon">` in de `<head>`:
`quiz-bank.html`, `quiz-teacher.html`, `quiz-archive.html`, `quiz-review.html`, `quiz-student.html`, `teacher-sessions.html`, `teacher-login.html`, `teacher-grid.html`

**Fix:** voeg toe aan elke `<head>`:
```html
<link rel="icon" href="/assets/favicon.png" type="image/png">
```

**Betrokken bestanden:** de 8 bovenstaande HTML-bestanden

---

#### 23k 🟠 — Generieke/inconsistente paginatitels *(~0.5 dag)*

**Bevinding:** Meerdere pagina's hebben een generieke of inconsistente `<title>`:

| Pagina | Huidige title | Verwacht |
|---|---|---|
| `student-app.html` | `Leerling` | `PyCodeFlow — Leerling` |
| `teacher-app.html` | `Leerkracht` | `PyCodeFlow — Sessie actief` |
| `teacher-sessions.html` | `PyCodeFlow — Sessies` maar h1 = "Leerkrachtenplatform" | `<h1>` aanpassen naar "Sessies" |
| `monitoring.html` | `Systeembeheer — PyCodeFlow` | `PyCodeFlow — Systeembeheer` (volgorde omgekeerd) |

**Betrokken bestanden:** `student-app.html`, `teacher-app.html`, `teacher-sessions.html`, `monitoring.html`

---

#### 23l 🟠 — monitoring.html: "Gebruikersbeheer"-knop buiten topbar-inner *(~0.5 dag)*

**Bevinding:** In `monitoring.html` staat de "👤 Gebruikersbeheer"-knop **buiten** de `</div>` die de `topbar-inner` sluit:
```html
<button class="dark-toggle" ...>🌙</button>
</div>  ← sluit topbar-inner
<a href="/admin.html" ...>👤 Gebruikersbeheer</a>  ← BUITEN de topbar!
</div>  ← sluit topbar
```
Dit veroorzaakt een layout-breuk: de knop verschijnt buiten de balk, op een onverwachte positie.

**Fix:** `<a href="/admin.html"...>` verplaatsen naar binnen `top-actions`, of verwijderen en vervangen door een link in de subnav (23i).

**Betrokken bestanden:** `monitoring.html`

---

#### 23m 🟠 — teacher-sessions: h1 en title inconsistent *(~0.5 dag)*

**Bevinding:** Na sprint 22j heeft `teacher-sessions.html`:
- `<title>PyCodeFlow — Sessies</title>` ✓
- `<span class="badge">` in topbar ontbreekt (andere pagina's hebben badge)
- `<h1>Leerkrachtenplatform</h1>` — zou `<h1>Sessies</h1>` moeten zijn voor consistentie

**Fix:** `<h1>` aanpassen naar "Sessies", badge toevoegen aan topbar.

**Betrokken bestanden:** `teacher-sessions.html`

---

#### 23n 🟡 — styles.css: duplicate dark-mode CSS-blokken *(~1 dag)*

**Bevinding:** `styles.css` bevat 24 declaraties van `[data-theme="dark"]`. Sommige selectors worden dubbel gedefinieerd (bv. `[data-theme="dark"] input, [data-theme="dark"] textarea` verschijnt twee keer). Dit vergroot de CSS onnodig, kan specificiteitsproblemen veroorzaken en maakt onderhoud moeilijker.

**Aanpak:**
- Alle dark-mode regels samenvoegen in één geconsolideerd blok onderaan de stylesheet.
- Duplicaten verwijderen.
- Volgorde bewaken (specifiekere selectors na algemenere).

**Betrokken bestanden:** `styles.css`

---

#### 23o 🟡 — admin.html en quiz-bank.html: raw fetch() zonder CSRF-token *(~1 dag)*

**Bevinding:** `app.js` definieert een `apiFetch()`-wrapper die automatisch de CSRF-token meestuurt. `admin.html` en `quiz-bank.html` importeren `app.js` maar doen alle muterende requests (`POST`, `PUT`, `DELETE`) met raw `fetch()` — zonder `X-CSRF-Token` header.

De server valideert CSRF via `requireCsrf` middleware op alle muterende endpoints. In de huidige implementatie valideert `validateCsrf()` ook `SameSite=Strict` cookies als fallback, waardoor het in de praktijk werkt — maar dit is een fragiele beveiliging die breekt bij cross-origin embeds of bij aanpassing van de cookieconfiguratie.

**Fix:** vervang alle `fetch(url, { method:'POST'|'PUT'|'DELETE', ... })` in `admin.html` en `quiz-bank.html` door `apiFetch(url, ...)` (de wrapper in app.js).

**Betrokken bestanden:** `admin.html`, `quiz-bank.html`, `quiz-teacher.html`

---

#### 23p 🟡 — 65 logbestanden ouder dan 7 dagen in /logs/ *(~0.5 dag)*

**Bevinding:** De log-rotatie uit sprint 17a draait bij serverstart en daarna nachtelijks. Maar de bestaande 65 logbestanden (sommige van mei 2026) worden **niet retroactief** opgeruimd bij een nieuwe deploy — ze blijven staan tot de volgende nachtelijke cleanup. Op een NAS met weinig schijfruimte kan dit bij een fresh deploy een probleem zijn.

**Fix:**
- Voeg een eenmalige cleanup toe in `pycodeflow.sh` deploy-stap: `find logs/ -name "*.log" -mtime +7 -delete`.
- Documenteer in `install.md` dat logbestanden pas na de eerste nacht opgeruimd worden.

**Betrokken bestanden:** `pycodeflow.sh`, `install.md`

---

### Sprint 22 — Bugfix & UX ronde *(~6.5 dagen)*

**Aangemeld:** 27/06/2026
**Status:** 🔄 Gepland
**Impact:** Kritische bugfixes op de vragenbank, toetsmodule en beheerpagina's. Enkele UX- en technische schuld-items.
**Vereiste voorbereiding:** Sprint 18a (vraagtypen) kan parallel lopen, maar 22e en 22f blokkeren 18b (automatische scoring).
**Risico:** Matig — raakt aan editor-integratie, routinglogica en navigatiestructuur.

---

#### 22a — Python-code editor: Enter-toets werkt niet *(~0.5 dag)*

**Probleem:** In de tekstgebieden die Python-code opnemen (vraagstelling met code-blok, modeloplossing) wordt de Enter-toets onderschept of genegeerd — nieuwe regels invoegen is niet mogelijk.

**Oorzaak (vermoedelijk):** Een `keydown`-handler op het formulier of de parent-container die `Enter` naar een submit-event mapt, of een conflict met de Monaco-instantie die niet correct geïnitialiseerd is in formuliercontext.

**Aanpak:**
- Controleer alle `keydown`/`keypress` listeners op het vraagformulier.
- Zorg dat de code-editor widget de Enter-toets zelf afhandelt en event propagation stopt (`e.stopPropagation()`).
- Voeg expliciete `e.preventDefault()` toe aan form-submit handlers zodat Enter enkel werkt binnen het editor-veld.

**Betrokken bestanden:** `quiz-bank.html`, `app.js`

---

#### 22b — Leerlingenoverzicht blijft laden *(~0.5 dag)*

**Probleem:** Het extra overzichtsscherm met de leerlingenlijst toont oneindig de laadspinner en laadt nooit data.

**Oorzaak (vermoedelijk):** API-call naar `/api/admin/students` faalt stil (netwerkerror, 401, of lege response) waardoor de Promise nooit resolved en de spinner nooit verborgen wordt.

**Aanpak:**
- Voeg `try/catch` toe rond alle fetch-calls voor het leerlingenoverzicht.
- Verberg spinner altijd in een `finally`-blok.
- Toon een duidelijke foutmelding als data niet geladen kan worden.
- Controleer of het API-endpoint bestaat en auth-token correct meegestuurd wordt.

**Betrokken bestanden:** `admin.html`, `server.js` (endpoint `/api/admin/students`)

---

#### 22c — Klasbeheer: leerlingen handmatig toevoegen werkt niet *(~0.5 dag)*

**Probleem:** Via het Klasbeheer-tabblad is er geen werkende manier om individuele leerlingen handmatig toe te voegen aan een klas.

**Aanpak:**
- Controleer of de "Toevoegen"-knop een correcte POST stuurt naar `/api/admin/students` of `/api/classes/:id/students`.
- Voeg client-side validatie toe (naam verplicht, klas geselecteerd).
- Zorg dat na succesvolle toevoeging de lijst automatisch herlaadt.
- Eenvoudig inline formulier: Naam + Klas + [+ Toevoegen]-knop, zonder modaal.

**Betrokken bestanden:** `admin.html`, `server.js`

---

#### 22d — Preview toont plain tekst i.p.v. gerenderde Markdown *(~0.5 dag)*

**Probleem:** De Preview-knop bij het aanmaken van een vraag toont de ruwe Markdown-tekst (bv. `**code**`) in plaats van de gerenderde opmaak.

**Aanpak:**
- Integreer **marked.js** (CDN) als lichtgewicht Markdown-renderer.
- De Preview-knop roept `marked.parse(vraagstellingText)` aan en toont het resultaat als `innerHTML` in een preview-div.
- Voeg basis CSS toe voor Markdown-elementen (`code`, `strong`, `em`, `pre`).
- Saniteer de preview-output met DOMPurify om XSS te vermijden.

**Betrokken bestanden:** `quiz-bank.html`, `styles.css`

---

#### 22e — Single choice / meerkeuze: UI kapot + opties toevoegen werkt niet *(~1 dag)*

**Probleem (meerdere sub-bugs):**
1. De UI voor single choice en meerkeuze ziet er visueel niet verzorgd uit.
2. Het toevoegen van antwoordopties via "+ Optie toevoegen" werkt niet of toont lege opties zonder invoerveld.
3. Er is geen manier om een code-blok toe te voegen als antwoordoptie.

**Aanpak:**
- Herstel de dynamische optie-rendering: elke optie krijgt een tekstveld + radio (single) of checkbox (meerkeuze) + verwijder-knop (×).
- Voeg per optie een toggle toe om te wisselen tussen gewone tekst en code-blok (klein `<>` icoontje dat een monospace `<textarea>` activeert).
- Zorg dat de correcte optie gemarkeerd kan worden.
- Visuele fix: gebruik de card-stijl consistent met de rest van de vragenbank UI.
- Sla opties op als JSON array: `[{ text: "...", isCode: false, isCorrect: true }, ...]`.

**Betrokken bestanden:** `quiz-bank.html`, `server.js`, `database.js`, `styles.css`

---

#### 22f — Vragen verwijderen: archivering vs. definitief verwijderen *(~1 dag)*

**Probleem:** De verwijder-actie op vragen werkt niet, en er is geen onderscheid tussen een vraag die al in een toets gebruikt is (archiveren) en een vraag die nergens aan gekoppeld is (definitief verwijderen).

**Aanpak:**
- Voeg een `archived`-veld toe aan de `quiz_bank` tabel.
- Bij verwijderpoging: controleer server-side of de vraag voorkomt in `quiz_meta` of `quiz_answers`. Zo ja → archiveer. Zo nee → verwijder definitief.
- Toon in de vragenbank een toggle "Toon gearchiveerd" (knop bestaat al visueel maar werkt niet).
- Gearchiveerde vragen zijn herstelbaar via een "Herstellen"-knop.
- Voeg API-endpoint toe: `DELETE /api/quiz/bank/:id` met bovenstaande logica.

**Database-aanpassing:**
```sql
ALTER TABLE quiz_bank ADD COLUMN archived BOOLEAN DEFAULT FALSE;
```

**Betrokken bestanden:** `quiz-bank.html`, `server.js`, `database.js`

---

#### 22g — Layout "Nieuwe toets maken" ziet er niet uit *(~0.5 dag)*

**Probleem:** Het scherm voor het aanmaken van een nieuwe toets heeft een onafgewerkte, inconsistente layout.

**Aanpak:**
- Pas het formulier aan zodat het de card-stijl volgt die ook in de vragenbank en het beheerscherm gebruikt wordt.
- Logische volgorde: naam → klas → vragen → timer → instellingen → aanmaken.
- Consistente margins, padding en font-gebruik.

**Betrokken bestanden:** `quiz-teacher.html`, `styles.css`

---

#### 22h — Toets aanmaken: bevestigen werkt niet *(~0.5 dag)*

**Probleem:** De bevestigingsknop bij het aanmaken van een toets doet niets (geen POST, geen foutmelding, geen redirect).

**Aanpak:**
- Controleer de event listener op de bevestigingsknop.
- Voeg expliciete client-side validatie toe met zichtbare foutmeldingen.
- Zorg dat de POST naar het correcte endpoint verstuurd wordt met de juiste body.
- Voeg een loading-state toe op de knop tijdens het versturen.
- Redirect na succes naar het toetsenoverzicht.

**Betrokken bestanden:** `quiz-teacher.html`, `server.js`

---

#### 22i — Paginaheaders nieuwe schermen zijn leeg/incorrect *(~0.5 dag)*

**Probleem:** Nieuwe schermen (vragenbank, toets aanmaken, archief) tonen geen correcte `<title>` en `<h1>`/breadcrumb-header.

**Aanpak:**
- Herstel de `<title>`-tag in elke HTML-pagina.
- Voeg een consistente paginaheader-component toe (`<h1>` met terugknop en paginanaam) op alle nieuwe schermen.
- Breadcrumb toont de juiste context (bv. "Vragenbank › Nieuwe vraag").

**Betrokken bestanden:** `quiz-bank.html`, `quiz-teacher.html`, `quiz-archive.html`, `quiz-review.html`

---

#### 22j — Leerkrachten-header herstructureren *(~1 dag)*

**Probleem:** De navigatiebalk op het leerkrachtenplatform is te uitgebreid geworden en bevat te veel items op één rij.

**Voorstel:**
- Splits de navigatie op in twee niveaus:
  - **Primaire balk** (altijd zichtbaar): Home, Sessies, Afmelden + thema-toggle.
  - **Secundaire balk / cubegrid** (contextafhankelijk): Beheer, Vragenbank, Archief, Nieuwe toets, Systeem — als icon-grid of dropdown.
- Overweeg een zijbalk of hamburgermenu voor de beheergerichte items.
- Actieve pagina visueel gemarkeerd.

**Betrokken bestanden:** `teacher-app.html`, `teacher-sessions.html`, `quiz-bank.html`, `admin.html`, `styles.css`

---

#### 22k — Opschonen mappenstructuur *(~0.5 dag)*

**Probleem:** De projectmap bevat verouderde bestanden, dubbele scripts en ongebruikte HTML-pagina's.

**Aanpak:**
- Inventariseer alle bestanden in `web/public/` en `web/scripts/`.
- Verwijder bestanden die niet meer gerefereerd worden vanuit `server.js`, andere HTML-pagina's of `package.json`.
- Controleer of `teacher-grid.html` nog actief gebruikt wordt of vervangen is.
- Voeg `runner/__pycache__/` toe aan `.gitignore`.
- Ruim `web/templates.json` op (verouderde templates).
- Documenteer verwijderde bestanden in het commit-bericht.

**Betrokken bestanden:** `web/public/`, `runner/__pycache__/`, `.gitignore`, `web/templates.json`

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

## Versiegeschiedenis (changelog-overzicht)

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

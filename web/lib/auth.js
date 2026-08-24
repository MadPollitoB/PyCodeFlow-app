// ═══════════════════════════════════════════════════════════════════════════════
// PyCodeFlow — Auth & crypto helpers (pure, testbaar)
// Sprint 34a: geëxtraheerd uit server.js zodat de kritieke auth-logica
// geïsoleerd unit-getest kan worden zonder de volledige server te booten.
// server.js requiret deze module — één bron van waarheid.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const crypto = require('crypto');

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// Timing-safe string-vergelijking. Retourneert false bij verschillende lengtes.
function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a), 'utf8');
  const bBuf = Buffer.from(String(b), 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// Maak een scrypt-hash in het formaat scrypt$N$r$p$saltB64$hashB64
function createPasswordHash(password, salt = crypto.randomBytes(16)) {
  const normalizedSalt = Buffer.isBuffer(salt) ? salt : Buffer.from(String(salt), 'base64');
  const derivedKey = crypto.scryptSync(String(password), normalizedSalt, 64, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${normalizedSalt.toString('base64')}$${derivedKey.toString('base64')}`;
}

// Verifieer een wachtwoord tegen een opgeslagen hash. Timing-safe, faalt veilig.
function verifyPasswordWithHash(password, storedHash) {
  try {
    const parts = String(storedHash || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Parse een HTTP Basic Auth header → { username, password } of null.
function parseBasicAuthHeader(headerValue) {
  try {
    if (!headerValue || typeof headerValue !== 'string') return null;
    const [scheme, encoded] = headerValue.split(' ');
    if (scheme !== 'Basic' || !encoded) return null;
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) return null;
    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

// Parse een Cookie-header → object met key/value paren.
function parseCookieHeader(headerValue) {
  const out = {};
  if (!headerValue || typeof headerValue !== 'string') return out;
  headerValue.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

// ── Sprint 50a: sessietokens voor leerkracht-logins ──────────────────────────
// Het token dat de browser krijgt is willekeurig; in de databank bewaren we enkel
// de SHA-256 ervan. Zo geeft een gelekte databank geen bruikbare sessies: uit een
// hash valt het token niet te herleiden. Vergelijken doen we op de hash, dus een
// gewone (snelle) hash volstaat hier — dit is geen wachtwoord dat mensen kiezen,
// maar 256 bit puur toeval.

// ── Sprint 50b: wie is er ingelogd? ──────────────────────────────────────────
// Pure beslisregel, los van Express en de databank — zo is ze rechtstreeks testbaar.
// Geeft null wanneer niemand mag (de aanroeper stuurt dan naar de login).
//
// Sprint 50f: de tak voor het oude gedeelde cookie is weg. Er zijn nog twee bronnen:
//   'session' = een echte sessie: we weten wie
//   'open'    = authenticatie staat uit (POC_BASIC_AUTH_ENABLED=false)
function bepaalTeacherIdentiteit({ sessie = null, authUit = false } = {}) {
  if (authUit) {
    return { id: null, username: 'anoniem', displayName: '', role: 'admin', source: 'open',
             activeSchoolId: null, activeSchoolName: null };
  }
  if (sessie) {
    return {
      id: sessie.teacher_id,
      username: sessie.username,
      displayName: sessie.display_name || '',
      role: sessie.role || 'teacher',
      source: 'session',
      // Sprint 48b1: komt uit de sessie in de databank, niet uit de browser.
      activeSchoolId: sessie.active_school_id || null,
      activeSchoolName: sessie.active_school_name || null,
    };
  }
  return null;
}

// ── Sprint 50d: moet deze sessie verlengd worden? ────────────────────────────
// Pure rekenregel — geen databank, geen klok van buitenaf, dus rechtstreeks testbaar.
//
// Drie regels, elk om een concreet probleem te vermijden:
//  1. HARDE GRENS. Een sessie mag nooit eeuwig blijven leven door dagelijks gebruik.
//     Op een klaslokaal-pc is dat het verschil tussen "vergeten af te melden" en
//     "iedereen kan er maanden bij".
//  2. PAS HALFWEG verlengen. Anders schrijf je bij élk verzoek naar de databank —
//     101 endpoints × elke klik. Halfweg is vaak genoeg en kost bijna niets.
//  3. NOOIT INKORTEN. Vlak vóór de harde grens zou het nieuwe einde vroeger kunnen
//     vallen dan wat er al staat; dan doen we niets.
function berekenSessieVerlenging({ now, createdAt, expiresAt, maxAgeMs, absoluutMaxMs }) {
  const geen = { verlengen: false, nieuwEind: null };
  const absoluutEind = Number(createdAt) + Number(absoluutMaxMs);

  if (now >= absoluutEind) return geen;                       // 1
  if (now < Number(expiresAt) - Number(maxAgeMs) / 2) return geen;  // 2

  const nieuwEind = Math.min(now + Number(maxAgeMs), absoluutEind);
  if (nieuwEind <= Number(expiresAt)) return geen;            // 3
  return { verlengen: true, nieuwEind };
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

// ── Sprint 51a (Fase 2 — eigenaarschap): wie wordt de eigenaar van een NIEUWE
// sessie? Pure regel, los van Express/sockets — zo blijft ze rechtstreeks
// testbaar zonder databank, net als bepaalTeacherIdentiteit hierboven.
//
// De eigenaar is gewoon de leerkracht die de sessie aanmaakt. Bij authUit
// (POC_BASIC_AUTH_ENABLED=false, geen echte accounts) is er niemand om als
// eigenaar te noteren — dat is de bewuste "open" modus, geen bug.
function bepaalSessieEigenaar(teacher) {
  return teacher?.id || null;
}

// ── Sprint 51b (Fase 2 — autorisatie): mag deze leerkracht deze sessie beheren?
// Pure regel (openen/sluiten/verwijderen/inzien van één sessie), los van Express en
// sockets, zodat REST- én socketkant exact dezelfde beslissing volgen en ze
// rechtstreeks testbaar is zonder databank.
//
// De regels, in volgorde:
//  1. Geen (geldige) leerkracht → nooit. Vangnet; endpoints eisen al `requireTeacherAuth`.
//  2. Admin → alles. Binnen model B (Fase 3) wordt dat "alles binnen de eigen school";
//     die school-grens bestaat nog niet, dus voorlopig is admin schooloverstijgend.
//     De open-modus (POC_BASIC_AUTH_ENABLED=false) krijgt via bepaalTeacherIdentiteit
//     rol 'admin' en valt dus hier — één leerkracht, geen isolatie, niets breekt.
//  3. Onbekende eigenaar (`teacher_id IS NULL`) → toegestaan voor elke leerkracht.
//     Dit zijn legacy-sessies van vóór 51a waarvan de aanmaker nooit is vastgelegd en
//     die de backfill niet kon toewijzen (school met >1 account). Ze buitensluiten zou
//     bestaande werking breken; de eigenaarschapsregel geldt vanaf nu voor álle nieuwe
//     sessies (die krijgen wél een eigenaar).
//  4. Anders: enkel de eigenaar zelf.
function magSessieBeheren(teacher, sessionOwnerId) {
  if (!teacher) return false;                       // 1
  // Sprint 51k (bugfix): dit checkte enkel role === 'admin' — een super-admin (role
  // 'superadmin') viel daar NIET onder en kreeg dus 403 op andermans sessies/toetsen,
  // ook al hoort de super-admin overal bij te kunnen. isBeheerder() dekt beide rollen.
  if (isBeheerder(teacher)) return true;             // 2
  if (sessionOwnerId == null) return true;           // 3 (null én undefined)
  return teacher.id === sessionOwnerId;              // 4
}

// ── Sprint 51d — zichtbaarheid van een GEWONE sessie (mode 'class'/'exam') ────
// Toetsen en taken volgen hun eigen systeem (quiz-sessions, 51b); dit gaat enkel over
// gewone (les-/examen)sessies in het sessie-overzicht. Bewust STRENGER dan magSessieBeheren:
//   • géén admin-alziend-oog  → een admin ziet in het overzicht ook enkel eigen sessies
//     (systeemtoezicht loopt via /api/monitoring, niet via deze lijst);
//   • géén null-legacy-uitzondering → een sessie zonder eigenaar is niet langer voor
//     iédereen zichtbaar (dat was net de bron van de overload).
// Elke leerkracht ziet zo enkel zijn eigen gewone sessies. Open modus (geen echte
// accounts → geen teacher.id) ziet alles: er is dan maar één gebruiker.
function magSessieZien(teacher, session) {
  if (!teacher) return false;
  if (!teacher.id) return true;                     // open modus / single-user
  return teacher.id === (session && session.teacherId);
}

// ── Sprint 51e — zichtbaarheid van een KLAS (teacher_classes) ────────────────
// Een admin ziet alle klassen (klasbeheer is een admintaak). Een leerkracht ziet klassen
// waaraan hij gekoppeld is, plus klassen zónder enige koppeling ("legacy" → nog niemands
// eigendom, blijft zichtbaar zodat bestaande installs niet breken). Anders dan bij sessies
// houden we de admin-uitzondering hier bewust: klassen zijn fundamenteel (je hebt ze nodig
// om toetsen/taken aan te koppelen), dus we verbergen ze niet te agressief.
//   heeftEigenaar = bestaat er minstens één teacher_classes-koppeling voor deze klas?
//   isLinked      = is DEZE leerkracht eraan gekoppeld?
function magKlasZien(teacher, { isLinked = false, heeftEigenaar = false } = {}) {
  if (!teacher) return false;
  if (teacher.role === 'admin' || teacher.role === 'superadmin') return true;  // 48c4
  if (!heeftEigenaar) return true;                  // legacy: nog niet toegewezen
  return !!isLinked;
}

// ── Sprint 52b — klas-startcode genereren ────────────────────────────────────
// Board-leesbaar: geen 0/O/1/I/L-verwarring (zelfde alfabet als de sessiecodes).
// Puur + testbaar; de databank bewaakt de uniciteit (de aanroeper hertest bij botsing).
const KLASCODE_ALFABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genereerKlascode(length = 6) {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) code += KLASCODE_ALFABET[bytes[i] % KLASCODE_ALFABET.length];
  return code;
}

// ── Sprint 52e — toegangsregel voor leerlingen (de kern van het ontwerp) ─────
// Een leerling-account heeft een status: 'active' | 'pending' | 'blocked'.
//   • active  → alles (klassessie, vrij oefenen, toets, taak);
//   • pending → WÉL een klassessie en vrij oefenen (de les mag nooit stilvallen),
//               maar GÉÉN toets of taak — die vergen een aanvaard account;
//   • blocked → niets;
//   • onbekend / geen account → niets (veilige default).
// activiteit ∈ 'klassessie' | 'oefenen' | 'toets' | 'taak'.
function magLeerlingActiviteit(student, activiteit) {
  if (!student) return false;
  const status = student.status || 'active';
  if (status === 'blocked') return false;
  if (status === 'active')  return true;
  if (status === 'pending') return activiteit === 'klassessie' || activiteit === 'oefenen';
  return false;
}

// ── Sprint 52f — mag deze leerling zijn wachtwoord herstellen (via klas-startcode)? ──
// Bewust streng: herstel kan ENKEL nadat de leerkracht het heeft aangezet
// (must_change_password = true). Zonder die vlag zou iemand die de klascode kent, het
// wachtwoord van een klasgenoot kunnen resetten. Verder moet het e-mailadres écht bij de
// klas van de code horen (isLidVanKlas), en een geblokkeerd account herstelt nooit.
function magWachtwoordHerstel(student, isLidVanKlas) {
  if (!student) return false;
  if (student.status === 'blocked') return false;
  if (!isLidVanKlas) return false;
  return student.must_change_password === true;
}

// ── Sprint 53d — wie mag een gedeeld item uit de bibliotheek halen (takedown)? ──
// Moderatie is een beheerdersactie: enkel een admin kan een publiek/gedeeld sjabloon of
// vraag verbergen. (Wordt bij Fase 3 / 48c4 verfijnd naar de super-admin voor takedown
// óver scholen heen; nu volstaat de admin-rol.)
function magBibliotheekModereren(teacher) {
  // 48c4: admin (schoolbeheer) én super-admin (hosting; cross-school takedown) mogen dit.
  return !!teacher && (teacher.role === 'admin' || teacher.role === 'superadmin');
}

// ── Sprint 48c2b — leesscoping op de actieve school ──────────────────────────
// Eén regel, overal identiek (de SQL-variant spiegelt dit exact):
//   • rij zonder school (NULL)   → zichtbaar (legacy/school-loos breekt nooit);
//   • géén actieve school        → geen filtering (0 scholen geconfigureerd, of een
//     single-school install zonder keuze; bij >1 school dwingt de login al een keuze af);
//   • anders                     → enkel rijen van de actieve school.
// De super-admin die over scholen heen kijkt komt pas in 48c4; tot dan volgt ook een
// admin de actieve school van zijn sessie.
function magRijVanSchoolZien(actieveSchoolId, rijSchoolId) {
  if (!rijSchoolId) return true;
  if (!actieveSchoolId) return true;
  return rijSchoolId === actieveSchoolId;
}

// ── Sprint 48c4 — super-admin (Fase 3 sluitstuk) ─────────────────────────────
// De super-admin beheert de HOSTING (alle scholen): kijkt over schoolgrenzen heen en
// doet cross-school moderatie. Een gewone admin beheert zijn school.
function isSuperAdmin(teacher) {
  return !!teacher && teacher.role === 'superadmin';
}

// admin óf superadmin — voor alle "beheerder"-checks (klasbeheer, leerlingbeheer, …),
// zodat een super-admin overal minstens kan wat een admin kan.
function isBeheerder(teacher) {
  return !!teacher && (teacher.role === 'admin' || teacher.role === 'superadmin');
}

// De leesscope van deze leerkracht: een super-admin krijgt GEEN schoolfilter (null —
// hetzelfde mechanisme als "geen actieve school", dus magRijVanSchoolZien en alle
// SQL-spiegels werken ongewijzigd); ieder ander volgt zijn actieve school.
function leesScopeVoor(teacher) {
  if (isSuperAdmin(teacher)) return null;
  return (teacher && teacher.activeSchoolId) || null;
}

// ── Sprint 55 — beheer-RBAC ──────────────────────────────────────────────────
// Wie mag welk scherm zien? (open modus — geen id — is single-user en mag alles)
//   Beheer:  admin (van zijn scholen) + super-admin.
//   Systeem: ENKEL super-admin (serverlogs, db-viewer, stresstest = hosting-terrein).
function magBeheerZien(teacher) {
  if (!teacher) return false;
  if (!teacher.id) return true;                       // open modus
  return isBeheerder(teacher);
}
function magSysteemZien(teacher) {
  if (!teacher) return false;
  if (!teacher.id) return true;                       // open modus
  return isSuperAdmin(teacher);
}

// Mag `actor` aan een doel-leerkracht (met huidige rol doelRol) de rol nieuweRol geven?
//   super-admin → alles;
//   admin       → enkel teacher↔admin, enkel binnen een gedeelde school, en nooit
//                 een super-admin raken (deeltSchool = delen actor en doel ≥1 school?).
// De vroegere bootstrap-uitzondering (admin stelt eerste super-admin aan) is hier
// bewust GESCHRAPT: super-admin wordt via de CLI (manage-teacher.js) of door een
// bestaande super-admin toegekend.
function magRolToekennen(actor, doelRol, nieuweRol, deeltSchool) {
  if (!actor) return false;
  if (!actor.id) return true;                         // open modus
  if (isSuperAdmin(actor)) return true;
  if (actor.role !== 'admin') return false;
  if (nieuweRol === 'superadmin' || doelRol === 'superadmin') return false;
  return !!deeltSchool;
}

// ── Sprint 56 — mag deze leerkracht DEZE leerling beheren? ───────────────────
// (aanvaarden/blokkeren/reset/notitie/klas — géén verwijderen of naam/e-mail: dat is Beheer)
// Beheerder (admin/super-admin) → school-breed; leerkracht → enkel leerlingen die in een
// van ZIJN gekoppelde klassen zitten (inEigenKlas); open modus → alles.
function magLeerlingBeheren(teacher, inEigenKlas) {
  if (!teacher) return false;
  if (!teacher.id) return true;                       // open modus
  if (isBeheerder(teacher)) return true;
  return !!inEigenKlas;
}

// ── Sprint 51c (Bibliotheek — delen van vragen & sjablonen) ──────────────────
// Pure regels rond zichtbaarheid (privé/school/publiek) en de integriteit tussen
// een sjabloon en de vragen die eraan hangen. Alles los van Express/databank, zodat
// REST-kant en tests exact dezelfde beslissing volgen — net als magSessieBeheren.
//
// Zichtbaarheidsniveaus, geordend van smal naar breed:
//   private (0) → school (1) → public (2)
// "Breder" = voor méér mensen zichtbaar. Een sjabloon mag nooit breder gedeeld zijn
// dan de vragen die het bevat; daarop steunen alle regels hieronder.
const SCOPE_RANG = { private: 0, school: 1, public: 2 };

function scopeRang(scope) {
  return SCOPE_RANG[scope] ?? 0;   // onbekend → behandel als privé (veiligst)
}

// Mag deze leerkracht dit gedeelde item (vraag óf sjabloon) ZIEN in de bibliotheek?
// item = { ownerId, scope }. `deeltSchool` = deelt de kijker minstens één school met
// de eigenaar (door de aanroeper bepaald, want dat vergt de databank).
//   - admin ziet alles wat gedeeld is (+ eigen privé);
//   - je eigen items zie je altijd;
//   - public → iedereen; school → enkel wie een school deelt; private → enkel eigenaar.
function sjabloonItemZichtbaar(item, viewer, { deeltSchool = false } = {}) {
  if (!viewer) return false;
  const ownerId = item?.ownerId ?? null;
  const scope = item?.scope || 'private';
  if (ownerId != null && viewer.id === ownerId) return true;   // eigen
  if (scope === 'public') return true;
  if (scope === 'school') return !!deeltSchool || viewer.role === 'admin';
  return false;                                                // private van iemand anders
}

// Beheren (bewerken/verwijderen/scope wijzigen) van een vraag of sjabloon: exact
// dezelfde regel als bij sessies — eigenaar, admin, of legacy zonder eigenaar.
const magSjabloonBeheren = magSessieBeheren;

// Mag een vraag met `questionScope` aan een sjabloon met `templateScope` hangen?
// De vraag moet mínstens even breed zichtbaar zijn als het sjabloon:
//   - publiek sjabloon → enkel publieke vragen;
//   - school-sjabloon  → school- én publieke vragen;
//   - privé sjabloon   → alles (de eigenaar koppelt enkel wat hij zelf ziet).
function magVraagKoppelen(templateScope, questionScope) {
  return scopeRang(questionScope) >= scopeRang(templateScope);
}

// Mag een sjabloon deze nieuwe scope krijgen, gegeven de scopes van de reeds
// gekoppelde vragen? Breder maken mag enkel als álle vragen dat toelaten; smaller
// (meer privé) maken mag altijd. Spiegelbeeld van magVraagKoppelen.
function magSjabloonScopeWorden(nieuweScope, gekoppeldeVraagScopes = []) {
  return gekoppeldeVraagScopes.every(qs => magVraagKoppelen(nieuweScope, qs));
}

module.exports = {
  SCRYPT_PARAMS,
  SCOPE_RANG,
  scopeRang,
  sjabloonItemZichtbaar,
  magSjabloonBeheren,
  magVraagKoppelen,
  magSjabloonScopeWorden,
  safeEqual,
  createPasswordHash,
  verifyPasswordWithHash,
  parseBasicAuthHeader,
  parseCookieHeader,
  createSessionToken,
  hashSessionToken,
  bepaalTeacherIdentiteit,
  berekenSessieVerlenging,
  bepaalSessieEigenaar,
  magSessieBeheren,
  magSessieZien,
  magKlasZien,
  genereerKlascode,
  magLeerlingActiviteit,
  magWachtwoordHerstel,
  magBibliotheekModereren,
  magRijVanSchoolZien,
  isSuperAdmin,
  isBeheerder,
  leesScopeVoor,
  magBeheerZien,
  magSysteemZien,
  magRolToekennen,
  magLeerlingBeheren,
};

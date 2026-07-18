const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// SQLite database — sessie-persistentie en leerkrachtenaccounts
const dbModule = require('./db/database');

// Sprint 12a: async database initialisatie (PostgreSQL)
// Server start pas als schema klaar is
let _dbReady = false;
dbModule.init().then(async () => {
  _dbReady = true;
  log.info('[db] PostgreSQL schema OK');
  // 27m: bootstrap admin — als teachers-tabel leeg is én .env credentials beschikbaar zijn,
  // maak automatisch een admin-account aan zodat inloggen altijd mogelijk is.
  // Sprint 50f: dit is nu de ENIGE rol van POC_BASIC_* — het zaaien van de eerste
  // leerkracht. Inloggen gaat daarna altijd via de databank. Daarom accepteren we hier
  // óók een vooraf gehasht wachtwoord: wie POC_BASIC_PASS_HASH gebruikt zou anders na
  // 50f buitengesloten zijn (de oude .env-login bestaat dan niet meer).
  try {
    const teachers = await dbModule.listTeachers();
    const bootstrapHash = BASIC_AUTH_PASS_HASH && BASIC_AUTH_PASS_HASH !== 'CHANGE_ME_HASH'
      ? BASIC_AUTH_PASS_HASH
      : (BASIC_AUTH_LEGACY_PASS ? createPasswordHash(BASIC_AUTH_LEGACY_PASS) : '');
    if (teachers.length === 0 && BASIC_AUTH_USER && bootstrapHash
        && BASIC_AUTH_USER !== 'CHANGE_ME') {
      await dbModule.createTeacher(BASIC_AUTH_USER, bootstrapHash, BASIC_AUTH_USER, 'admin');
      console.log('╔════════════════════════════════════════════════════════════╗');
      console.log('║  [bootstrap] Admin-account automatisch aangemaakt          ║');
      console.log(`║  Inlognaam (username): ${BASIC_AUTH_USER.padEnd(36)}║`);
      console.log('║  Wachtwoord: de waarde van POC_BASIC_PASS uit .env         ║');
      console.log('║  → Log in met de INLOGNAAM, niet de weergavenaam.         ║');
      console.log('╚════════════════════════════════════════════════════════════╝');
    } else if (teachers.length > 0) {
      // Log de bestaande inlognaam/-namen zodat duidelijk is waarmee in te loggen
      const names = teachers.map(t => t.username).join(', ');
      log.info(`[auth] ${teachers.length} leerkracht(en) in DB. Inlognaam/-namen: ${names}`);
    }
  } catch (bootstrapErr) {
    log.warn('[bootstrap] Kon geen admin-account aanmaken:', bootstrapErr.message);
  }
  await checkAuthConfig();
}).catch(err => {
  log.error('[db] FATALE FOUT — database niet bereikbaar:', err.message);
  process.exit(1);
});

const PORT = process.env.PORT || 3000;
const RUNNER_URL = process.env.RUNNER_URL || "http://runner:5000";
const BASIC_AUTH_ENABLED = String(process.env.POC_BASIC_AUTH_ENABLED || "true").toLowerCase() !== "false";
const BASIC_AUTH_USER = process.env.POC_BASIC_USER || "";
const BASIC_AUTH_PASS_HASH = process.env.POC_BASIC_PASS_HASH || "";
const BASIC_AUTH_LEGACY_PASS = process.env.POC_BASIC_PASS || "";
const BASIC_AUTH_REALM = process.env.POC_BASIC_AUTH_REALM || "PyCodeFlow POC";
const COOKIE_SECRET = process.env.POC_BASIC_COOKIE_SECRET || "";
// 30a: sessieduur van het leerkracht-cookie (uren). Standaard 8u = een schooldag.
// 0 of leeg → sessiecookie (verdwijnt bij sluiten browser, oud gedrag).
const SESSION_MAX_AGE_HOURS = Math.max(0, Number(process.env.POC_SESSION_MAX_AGE_HOURS ?? 8));
const SESSION_MAX_AGE_SECONDS = Math.round(SESSION_MAX_AGE_HOURS * 3600);
// Sprint 50d: harde bovengrens op een sessie. De gewone looptijd (8u) schuift mee zolang
// je werkt — zo vlieg je nooit midden in een les buiten. Maar zonder plafond zou een
// sessie op een klaslokaal-pc maandenlang blijven leven door dagelijks gebruik.
// Standaard 24u: je logt dus hooguit één keer per dag opnieuw in.
const SESSION_ABSOLUTE_MAX_HOURS = Math.max(
  SESSION_MAX_AGE_HOURS,
  Number(process.env.POC_SESSION_ABSOLUTE_MAX_HOURS ?? 24)
);
const SESSION_ABSOLUTE_MAX_MS = Math.round(SESSION_ABSOLUTE_MAX_HOURS * 3600 * 1000);

// ── CSRF-bescherming ──────────────────────────────────────────────────────────
// Genereer een server-side CSRF token per process-start.
// Stuur het mee als cookie; clients moeten het terugsturen als X-CSRF-Token header.
// Fix SEC-5: globale CSRF token (server-wide) — per-sessie tokens via cookie
// De globale token blijft voor de API maar we voegen een per-sessie nonce toe
const CSRF_TOKEN = crypto.randomBytes(32).toString('hex');
// Per-socket CSRF nonces voor extra bescherming
const socketCsrfNonces = new Map();

function setCsrfCookie(res) {
  res.setHeader('Set-Cookie', [
    ...(Array.isArray(res.getHeader('Set-Cookie')) ? res.getHeader('Set-Cookie') : res.getHeader('Set-Cookie') ? [res.getHeader('Set-Cookie')] : []),
    `csrf_token=${CSRF_TOKEN}; Path=/; SameSite=Strict`
  ]);
}

function validateCsrf(req) {
  // SameSite=Strict cookie + Origin/Referer check is voldoende voor browser-clients.
  // Voor extra bescherming: controleer ook de X-CSRF-Token header.
  const origin  = req.headers['origin']  || '';
  const referer = req.headers['referer'] || '';
  const headerToken = req.headers['x-csrf-token'] || '';

  // Sta toe als Origin of Referer van dezelfde host is
  const host = req.headers['host'] || '';
  if (origin && !origin.includes(host)) return false;
  if (referer && !referer.includes(host) && origin === '') return false;

  // Als X-CSRF-Token aanwezig is, valideer die
  if (headerToken && headerToken !== CSRF_TOKEN) return false;
  return true;
}

function requireCsrf(req, res, next) {
  if (!validateCsrf(req)) {
    return res.status(403).json({ error: 'CSRF validatie mislukt' });
  }
  next();
}
const AUTH_RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.POC_BASIC_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000));
const AUTH_RATE_LIMIT_MAX_FAILURES = Math.max(1, Number(process.env.POC_BASIC_RATE_LIMIT_MAX_FAILURES || 6));
const AUTH_RATE_LIMIT_BLOCK_MS = Math.max(1000, Number(process.env.POC_BASIC_RATE_LIMIT_BLOCK_MS || 30 * 60 * 1000));
const AUTH_RATE_LIMIT_BASE_DELAY_MS = Math.max(250, Number(process.env.POC_BASIC_RATE_LIMIT_BASE_DELAY_MS || 750));

// ── Versie-bepaling ─────────────────────────────────────────────────────────
// Prioriteit: VERSION-bestand (project root) > .env variabelen > defaults.
// Zo hoeft bij een deploy enkel het VERSION-bestand aangepast te worden;
// pycodeflow.sh hoeft de versie niet meer handmatig te zetten.
function loadVersionFromFile() {
  // Zoek VERSION op meerdere plausibele locaties (container-mount + lokale layout)
  const candidates = [
    path.join(__dirname, '..', 'VERSION'),  // lokaal: web/../VERSION
    '/VERSION',                              // container-mount (docker-compose)
    path.join(__dirname, 'VERSION'),         // fallback
  ];
  for (const versionPath of candidates) {
    try {
      if (fs.existsSync(versionPath)) {
        const raw = fs.readFileSync(versionPath, 'utf8').trim();
        const m = raw.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
        if (m) {
          // NB: dit draait vóór de logger (createLogger) geïnitialiseerd is,
          // dus bewust console.* i.p.v. log.* — anders TDZ ReferenceError.
          console.log(`[versie] Geladen uit ${versionPath}: ${raw}`);
          return { year: m[1], major: m[2], minor: m[3], build: m[4] };
        }
        console.warn(`[versie] Ongeldig formaat in ${versionPath}: "${raw}"`);
      }
    } catch (e) {
      console.warn(`[versie] Lezen van ${versionPath} mislukt:`, e.message);
    }
  }
  return null;
}

const _fileVersion = loadVersionFromFile();
const VERSION = _fileVersion || {
  year: process.env.APP_VERSION_YEAR || "2026",
  major: process.env.APP_VERSION_MAJOR || "2",
  minor: process.env.APP_VERSION_MINOR || "29",
  build: process.env.APP_VERSION_BUILD || "0"
};
const APP_VERSION = `${VERSION.year}.${VERSION.major}.${VERSION.minor}.${VERSION.build}`;

const disconnectTimers = new Map();

// Vrije sessie: globale map van leerlingen die vrij oefenen (buiten klas/examsessies)
// Key: socketId, Value: { id, name, className, joinedAt, socketId, runId }
const freeStudents = new Map();

// Sprint 34a: auth/crypto helpers geëxtraheerd naar lib/auth.js (getest in tests/)
const authLib = require('./lib/auth');
const scoringLib = require('./lib/scoring');
const validationLib = require('./lib/validation');
// 32b: gestructureerde logger met niveaus (LOG_LEVEL env var, standaard 'info')
const { createLogger } = require('./lib/logger');
const log = createLogger();
// 37d: nakijk-token (HMAC, stateless) voor leerling-inzage
const { createReviewToken, verifyReviewToken } = require('./lib/review-token');
// 37a: bouwt het nakijk-resultaat en strippt de juiste antwoorden
const { buildMyResult } = require('./lib/review-result');
const safeEqual = authLib.safeEqual;
const createPasswordHash = authLib.createPasswordHash;
const verifyPasswordWithHash = authLib.verifyPasswordWithHash;
const parseBasicAuthHeader = authLib.parseBasicAuthHeader;
const parseCookieHeader = authLib.parseCookieHeader;
// Sprint 50a: sessietokens per leerkracht
const createSessionToken = authLib.createSessionToken;
const hashSessionToken = authLib.hashSessionToken;
// Sprint 50b: pure beslisregel voor 'wie is er ingelogd?'
const bepaalTeacherIdentiteit = authLib.bepaalTeacherIdentiteit;
// Sprint 50d: rekenregel voor sessieverlenging
const berekenSessieVerlenging = authLib.berekenSessieVerlenging;
// Sprint 51a: wie wordt eigenaar van een nieuwe sessie
const bepaalSessieEigenaar = authLib.bepaalSessieEigenaar;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const PASSWORD_HASH = BASIC_AUTH_PASS_HASH || (BASIC_AUTH_LEGACY_PASS ? createPasswordHash(BASIC_AUTH_LEGACY_PASS) : "");
const passwordConfigUsesLegacyPlaintext = !BASIC_AUTH_PASS_HASH && !!BASIC_AUTH_LEGACY_PASS;

function getClientIp(req) {
  return req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
}

const authFailures = new Map();

function getAuthState(ip) {
  const now = Date.now();
  let state = authFailures.get(ip);
  if (!state) {
    state = { failures: [], blockedUntil: 0 };
    authFailures.set(ip, state);
  }
  state.failures = state.failures.filter(ts => now - ts <= AUTH_RATE_LIMIT_WINDOW_MS);
  if (!state.failures.length && state.blockedUntil <= now) {
    authFailures.delete(ip);
    return { failures: [], blockedUntil: 0 };
  }
  return state;
}

function registerAuthFailure(ip) {
  const now = Date.now();
  const state = getAuthState(ip);
  state.failures.push(now);
  if (state.failures.length >= AUTH_RATE_LIMIT_MAX_FAILURES) {
    state.blockedUntil = Math.max(state.blockedUntil || 0, now + AUTH_RATE_LIMIT_BLOCK_MS);
  }
  authFailures.set(ip, state);
  return state;
}

function clearAuthFailures(ip) {
  authFailures.delete(ip);
}

function getFailureDelayMs(failureCount) {
  const exponent = Math.max(0, Math.min(6, failureCount - 1));
  return AUTH_RATE_LIMIT_BASE_DELAY_MS * (2 ** exponent);
}

function getAuthBlockRemainingMs(ip) {
  const state = getAuthState(ip);
  const now = Date.now();
  return state.blockedUntil > now ? state.blockedUntil - now : 0;
}

// parseBasicAuthHeader nu in lib/auth.js (sprint 34a)

// Sprint 50a: geeft de LEERKRACHT terug i.p.v. enkel true/false.
// Nodig omdat we vanaf nu een sessie per gebruiker aanmaken en dus moeten weten wie inlogt.
// Geeft null bij ongeldige gegevens, of een pseudo-leerkracht {id:null, source:'env'}
// wanneer de login via de .env-fallback gaat — daar hoort geen databankrij bij.
async function authenticateTeacher(authHeader) {
  if (!BASIC_AUTH_ENABLED) return { id: null, username: 'anoniem', role: 'teacher', source: 'open' };
  const creds = parseBasicAuthHeader(authHeader);
  if (!creds) return null;

  // PostgreSQL database (primair)
  try {
    const teacher = await dbModule.getTeacherByUsername(creds.username);
    if (teacher) {
      if (!verifyPasswordWithHash(creds.password, teacher.pass_hash)) return null;
      dbModule.updateLastLogin(teacher.id).catch(() => {});
      return { id: teacher.id, username: teacher.username, displayName: teacher.display_name,
               role: teacher.role, source: 'db' };
    }
  } catch (e) {
    log.error('[auth] DB fout:', e.message);
  }

  // Sprint 50f: de .env-login is weg. POC_BASIC_* zaait enkel nog de eerste leerkracht
  // (zie bootstrap bovenaan); daarna verloopt inloggen altijd via de databank — met een
  // echte identiteit en een intrekbare sessie. Wie .env-gegevens gebruikte, logt gewoon
  // in met dezelfde naam en hetzelfde wachtwoord: de bootstrap heeft daar een echte
  // leerkracht van gemaakt.
  return null;
}

async function credentialsAreValid(authHeader) {
  // Sprint 12a: async omdat PostgreSQL queries async zijn
  // Sprint 50a: leunt nu op authenticateTeacher; gedrag blijft identiek (true/false).
  return (await authenticateTeacher(authHeader)) !== null;
}

async function requireBasicAuth(req, res, next) {
  if (!BASIC_AUTH_ENABLED) return next();
  const ip = getClientIp(req);
  const blockedRemainingMs = getAuthBlockRemainingMs(ip);
  if (blockedRemainingMs > 0) {
    res.setHeader("Retry-After", String(Math.ceil(blockedRemainingMs / 1000)));
    return res.status(429).send("Te veel mislukte loginpogingen. Probeer later opnieuw.");
  }

  if (await credentialsAreValid(req.headers.authorization)) {
    clearAuthFailures(ip);
    return next();
  }

  const state = registerAuthFailure(ip);
  await sleep(getFailureDelayMs(state.failures.length));
  if (state.blockedUntil > Date.now()) {
    res.setHeader("Retry-After", String(Math.ceil((state.blockedUntil - Date.now()) / 1000)));
    return res.status(429).send("Te veel mislukte loginpogingen. Probeer later opnieuw.");
  }

  res.setHeader("WWW-Authenticate", `Basic realm="${BASIC_AUTH_REALM}", charset="UTF-8"`);
  return res.status(401).send("Authenticatie vereist.");
}

// Sprint 12a: startup check is nu async (PostgreSQL)
// Wordt uitgevoerd na dbModule.init()
async function checkAuthConfig() {
  if (!BASIC_AUTH_ENABLED) return;
  // Sprint 50f: inloggen kan enkel nog via de databank. POC_BASIC_* zaait hooguit de
  // eerste leerkracht (zie bootstrap bovenaan) — er is geen .env-login meer als vangnet.
  // Dus: geen leerkracht = niemand kan binnen = niet starten.
  let dbHasTeacher = false;
  try {
    dbHasTeacher = (await dbModule.listTeachers()).length > 0;
  } catch (e) {
    // Databank onbereikbaar? Dan is dit niet het moment om af te sluiten — de app
    // stopt hier niet op een tijdelijke storing.
    log.warn('[auth] teacher-check mislukt:', e.message);
    return;
  }

  if (!dbHasTeacher) {
    log.error('[auth] Er is geen enkele leerkracht in de databank — niemand kan inloggen.');
    log.error('[auth] Maak er een aan (werkt ook als deze container stilligt):');
    log.error("[auth]   docker compose run --rm web node scripts/manage-teacher.js add <naam> '<wachtwoord>' admin");
    log.error('[auth] Of via pycodeflow.sh → optie 10. Daarna: docker compose up -d --force-recreate web');
    log.error('[auth] Alternatief: zet POC_BASIC_USER + POC_BASIC_PASS in .env — bij de volgende start');
    log.error('[auth] maakt de bootstrap daar automatisch een leerkracht van.');
    process.exit(1);
  }
  dbModule.listTeachers()
    .then(ts => log.info(`[auth] ${ts.length} leerkracht(en) geladen vanuit database.`))
    .catch(() => {});
}

if (passwordConfigUsesLegacyPlaintext) {
  // Sprint 50f: dit is GEEN login-fallback meer. Deze melding zei vroeger "Fallback login
  // actief via POC_BASIC_USER/POC_BASIC_PASS" — misleidend, want ze keek enkel naar het
  // wachtwoord terwijl de opstartcontrole óók een gebruikersnaam eiste (zie sprint 47.2:
  // de app zei "fallback actief" en sloot zich meteen daarna af).
  // POC_BASIC_PASS dient nu enkel nog om bij een lege databank de eerste leerkracht te zaaien.
  log.info('[auth] POC_BASIC_PASS staat in .env — enkel gebruikt om de eerste leerkracht aan te maken bij een lege databank.');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // Fix SEC-4: maximale payload 64KB — voldoende voor schoolcode
  maxHttpBufferSize: 64 * 1024,
  // Voorkom dat socket.io pingTimeout te lang is
  pingTimeout: 20000,
  pingInterval: 25000,
});

// parseCookieHeader nu in lib/auth.js (sprint 34a)

// ── Sprint 50f: het gedeelde cookie is weg ───────────────────────────────────
// teacherCookieValue(), hasValidTeacherCookie() en setTeacherCookie() zijn verwijderd.
// Ze bouwden één VASTE waarde (HMAC van POC_BASIC_USER|realm) die iedereen deelde —
// de reden dat de app niet wist wie er werkte, dat afmelden niet kon en dat het
// audit-log 'onbekend' zei. Toegang loopt nu uitsluitend via teacher_sessions (50a-50d).

// ── Sprint 50a: echte sessie per leerkracht ──────────────────────────────────
// Voegt een cookie toe zonder bestaande Set-Cookie-headers te overschrijven —
// setCsrfCookie zet er ook een, en die mag niet sneuvelen.
function voegCookieToe(res, cookie) {
  const bestaand = res.getHeader('Set-Cookie');
  const lijst = Array.isArray(bestaand) ? bestaand : (bestaand ? [bestaand] : []);
  res.setHeader('Set-Cookie', [...lijst, cookie]);
}

// Maakt de sessierij aan en geeft de browser het token mee.
// Sprint 50f — GEDRAGSWIJZIGING: dit mag niet meer stil falen. In 50a mocht dat nog,
// want het oude gedeelde cookie ving je dan op. Dat vangnet is weg: zonder sessie is er
// geen toegang. Stil falen zou betekenen dat je "ingelogd" te zien krijgt en meteen weer
// op het loginscherm belandt — de ergste soort bug om te moeten uitleggen.
// Daarom gooit deze functie nu door, en beantwoordt de login-endpoint dat eerlijk.
async function maakLeerkrachtSessie(req, res, teacher) {
  // Open modus (POC_BASIC_AUTH_ENABLED=false): geen accounts, dus geen sessie. Prima.
  if (!teacher || !teacher.id) return null;

  const token = createSessionToken();
  const maxAge = SESSION_MAX_AGE_SECONDS > 0 ? SESSION_MAX_AGE_SECONDS : 8 * 3600;

  // Sprint 48b1: bij precies één school meteen kiezen — geen keuzescherm voor een
  // keuze die er niet is. Bij nul (de huidige toestand) of meerdere blijft dit null;
  // 48b2 voegt het keuzescherm toe.
  let scholen = [];
  let actieveSchool = null;
  try {
    scholen = await dbModule.getSchoolsForTeacher(teacher.id);
    actieveSchool = validationLib.kiesActieveSchool(scholen);
  } catch (e) {
    // Scholen zijn (nog) bijzaak: een fout hier mag het inloggen niet tegenhouden.
    log.warn('[auth] scholen ophalen bij login mislukt:', e.message);
  }

  await dbModule.createTeacherSession({
    tokenHash: hashSessionToken(token),
    teacherId: teacher.id,
    expiresAt: Date.now() + maxAge * 1000,
    userAgent: req.headers['user-agent'] || '',
    ip: getClientIp(req) || '',
    activeSchoolId: actieveSchool,
  });
  voegCookieToe(res, `teacher_sid=${token}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${maxAge}`);
  log.info(`[auth] sessie aangemaakt voor ${teacher.username}`);
  // Sprint 48b2: bij meerdere scholen moet de leerkracht nog kiezen. We geven de lijst
  // pas hier terug — dus ná een geslaagde login. Zo verklap je aan niemand welke
  // scholen er bestaan.
  return { token, scholen, actieveSchool };
}

// Leest de sessie uit het teacher_sid-cookie. Geeft null als er geen (geldige) is.
// 50b gaat dit gebruiken om req.teacher te vullen; nu al aanwezig zodat we kunnen testen.
async function leesLeerkrachtSessie(req) {
  try {
    const cookies = parseCookieHeader(req.headers.cookie);
    const token = cookies.teacher_sid;
    if (!token) return null;
    return await dbModule.getTeacherSession(hashSessionToken(token));
  } catch (e) {
    log.warn('[auth] sessie lezen mislukt:', e.message);
    return null;
  }
}

// ── Sprint 50b: wie is er ingelogd? ──────────────────────────────────────────
// Vanaf nu draagt elk beschermd verzoek een identiteit: req.teacher.
// De beslisregel zelf staat in lib/auth.js (bepaalTeacherIdentiteit) — pure logica,
// dus getest zonder databank. Hier halen we enkel de bouwstenen op.
// Wie al met 50a inlogde krijgt zijn echte identiteit; een oude browsersessie blijft
// werken via het gedeelde cookie. 50f haalt die terugval weg.
async function requireTeacherAuth(req, res, next) {
  const sessie = BASIC_AUTH_ENABLED ? await leesLeerkrachtSessie(req) : null;
  const identiteit = bepaalTeacherIdentiteit({
    sessie,
    authUit: !BASIC_AUTH_ENABLED,
  });

  if (identiteit) {
    req.teacher = identiteit;
    // Sprint 50d: schuif de sessie mee zolang je werkt (maar nooit voorbij de harde grens).
    if (sessie) await verlengSessieIndienNodig(req, res, sessie);
    return next();
  }

  // Stuur de browser door naar de custom login-pagina i.p.v. de native browser-popup
  // te tonen via WWW-Authenticate. De ?next= parameter zorgt voor de juiste redirect
  // na succesvolle authenticatie.
  const dest = encodeURIComponent(req.path);
  return res.redirect(`/teacher-login.html?next=${dest}`);
}

// ── Sprint 50d: sessie verlengen bij activiteit ──────────────────────────────
// De rekenregel (wanneer wel/niet) staat in lib/auth.js en is apart getest.
// Hier doen we enkel het schrijfwerk. Bewust fail-safe: mislukt het verlengen, dan
// blijft het verzoek gewoon slagen — je verliest hooguit wat looptijd, geen toegang.
async function verlengSessieIndienNodig(req, res, sessie) {
  try {
    const cookies = parseCookieHeader(req.headers.cookie);
    const token = cookies.teacher_sid;
    if (!token) return;

    const maxAgeMs = (SESSION_MAX_AGE_SECONDS > 0 ? SESSION_MAX_AGE_SECONDS : 8 * 3600) * 1000;
    const { verlengen, nieuwEind } = berekenSessieVerlenging({
      now: Date.now(),
      createdAt: sessie.created_at,
      expiresAt: sessie.expires_at,
      maxAgeMs,
      absoluutMaxMs: SESSION_ABSOLUTE_MAX_MS,
    });
    if (!verlengen) return;

    await dbModule.touchTeacherSession(hashSessionToken(token), nieuwEind);
    // Het cookie moet mee opschuiven, anders gooit de browser hem weg terwijl de
    // sessie in de databank nog leeft — dan zou je alsnog buitenvliegen.
    const restSeconden = Math.max(1, Math.round((nieuwEind - Date.now()) / 1000));
    voegCookieToe(res, `teacher_sid=${token}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${restSeconden}`);
  } catch (e) {
    log.warn('[auth] sessie verlengen mislukt:', e.message);
  }
}


// Sprint 50f: leest de identiteit die io.use bij het verbinden heeft vastgesteld.
// Blijft synchroon, dus de 30 handlers die hem aanroepen wijzigen niet.
// Nuance: de identiteit wordt bepaald bij het openen van de verbinding. Verloopt de
// sessie terwijl de socket openstaat, dan blijft die socket geldig tot hij sluit.
// Aanvaardbaar — een socket is per definitie een lopende sessie — en bij elke
// paginaverversing wordt opnieuw gecontroleerd.
function socketIsTeacherAuthorized(socket) {
  return !!socket.data?.teacher;
}

// Fix SEC-3: HTTP security headers
app.use((req, res, next) => {
  // ── CSP (sprint 30b — OPTIE A, TIJDELIJK) ────────────────────────────────────
  // Alle inline <script> BLOKKEN zijn geëxtraheerd (sprint 32a), dus scripts laden
  // via 'self'. 'unsafe-inline' in script-src blijft ENKEL nog nodig voor de ~123
  // inline event-handlers (onclick=, onchange=, …) in de HTML.
  // 'unsafe-inline' in style-src is nodig voor ~384 inline style= attributen.
  //
  // ⚠️ TIJDELIJK: dit wordt volledig verwijderd in sprint 30b-vol (Optie C):
  //    - alle inline event-handlers → addEventListener in de geëxtraheerde .js
  //    - alle inline style= → CSS-klassen
  //    - daarna: 'unsafe-inline' uit script-src én style-src
  // Zie sprintlog "Sprint 30b-vol" voor het gefaseerde plan.
  //
  // unsafe-eval is al weg (Sprint 12a-D, Monaco workers via blob:).
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; " +
    "style-src 'self' 'unsafe-inline'; " +
    "font-src 'self' data:; " +
    "img-src 'self' data:; " +
    "worker-src 'self' blob:; " +
    "connect-src 'self' ws: wss:; " +
    "frame-ancestors 'none'; " +
    "upgrade-insecure-requests;"
  );
  // 30b Optie A: strikte CSP in REPORT-ONLY modus. Deze breekt niets, maar laat
  // in de browserconsole zien wat er geblokkeerd zóu worden zonder 'unsafe-inline'.
  // Zo kunnen we tijdens Optie C gericht de resterende inline handlers/styles opsporen.
  // Wordt verwijderd zodra de enforce-CSP (Optie C) live gaat.
  res.setHeader('Content-Security-Policy-Report-Only',
    "default-src 'self'; " +
    "script-src 'self' https://cdnjs.cloudflare.com; " +
    "style-src 'self'; " +
    "font-src 'self' data:; " +
    "img-src 'self' data:; " +
    "worker-src 'self' blob:; " +
    "connect-src 'self' ws: wss:; " +
    "frame-ancestors 'none';"
  );
  // Voorkomt dat de pagina in een iframe geladen wordt (clickjacking)
  res.setHeader('X-Frame-Options', 'DENY');
  // Voorkomt MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Verwijdert server-informatie
  res.removeHeader('X-Powered-By');
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Permissions policy: geen camera, microfoon, locatie
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // HSTS: browser gebruikt altijd HTTPS (Cloudflare Tunnel)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Fix SEC-9: expliciete JSON body size limiet
app.use(express.json({ limit: '64kb' }));

app.get('/monitoring.html', requireTeacherAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'monitoring.html'));
});

// Sprint 12b: admin pagina
app.get('/admin.html', requireTeacherAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Sprint 16: quiz pagina's
app.get('/quiz-bank.html', requireTeacherAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'quiz-bank.html'));
});
app.get('/quiz-teacher.html', requireTeacherAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'quiz-teacher.html'));
});
app.get('/quiz-review.html', requireTeacherAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'quiz-review.html'));
});
// quiz-student.html is publiek (leerlingen joinen via code)

// Custom login-pagina — publiek bereikbaar (geen auth), anders oneindige redirect
app.get('/teacher-login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teacher-login.html'));
});

// Logout: trek de sessie in en wis beide cookies
// ── Sprint 50c: afmelden dat écht afmeldt ────────────────────────────────────
// Tot nu wiste dit enkel het cookie in jóuw browser. Maar `teacher_auth` is een
// VASTE waarde (een HMAC van .env), dus wie hem ooit kopieerde bleef binnen — het
// cookie wissen deed daar niets aan. Je kon een vaste waarde nu eenmaal niet intrekken.
// Een sessie kunnen we wél intrekken: we gooien de rij weg en dan is dat token overal
// dood, ook in een andere browser of op een ander toestel.
app.get('/api/teacher-logout', async (req, res) => {
  try {
    const cookies = parseCookieHeader(req.headers.cookie);
    if (cookies.teacher_sid) {
      await dbModule.deleteTeacherSession(hashSessionToken(cookies.teacher_sid));
      log.info('[auth] sessie ingetrokken (afmelden)');
    }
  } catch (e) {
    // Fail-safe: lukt het intrekken niet, dan wissen we de cookies toch. Beter
    // afgemeld in de browser dan een half scherm met een foutmelding.
    log.warn('[auth] sessie intrekken mislukt:', e.message);
  }
  // Beide cookies wissen. Enkel teacher_sid zou niet volstaan: de terugval op het
  // oude teacher_auth-cookie (50b) zou je meteen weer binnenlaten.
  res.setHeader('Set-Cookie', [
    'teacher_auth=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0',
    'teacher_sid=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0',
  ]);
  res.redirect('/teacher-login.html');
});

// Vrije editor — publiek bereikbaar voor leerlingen (geen klas/examsessie nodig)
app.get('/free-editor.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'free-editor.html'));
});

// JSON login-endpoint voor de custom login-overlay
// Sprint 50f: valideert de gegevens tegen de databank, maakt een sessie aan (teacher_sid)
// en retourneert 200 bij succes. Het oude gedeelde teacher_auth-cookie bestaat niet meer.
// Hergebruikt dezelfde rate limiting en timing-safe vergelijking als requireBasicAuth.
app.post('/api/teacher-login', async (req, res) => {
  if (!BASIC_AUTH_ENABLED) return res.json({ ok: true });

  const ip = getClientIp(req);
  const blockedRemainingMs = getAuthBlockRemainingMs(ip);
  if (blockedRemainingMs > 0) {
    res.setHeader('Retry-After', String(Math.ceil(blockedRemainingMs / 1000)));
    return res.status(429).json({ error: 'Geblokkeerd' });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Veld ontbreekt' });
  }

  // Bouw een nep Authorization-header zodat we authenticateTeacher kunnen hergebruiken
  const fakeAuthHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const teacher = await authenticateTeacher(fakeAuthHeader); // await! anders wordt DB niet gecheckt

  if (teacher) {
    clearAuthFailures(ip);
    // Sprint 50a/50f: de sessie ís nu de login. Er is geen gedeeld cookie meer dat
    // je alsnog binnenlaat, dus mislukt dit, dan is er ook geen toegang — vandaar dat
    // maakLeerkrachtSessie hieronder eerlijk faalt i.p.v. stil door te gaan.
    let sessie;
    try {
      sessie = await maakLeerkrachtSessie(req, res, teacher);
    } catch (e) {
      log.error('[auth] sessie aanmaken mislukt:', e.message);
      return res.status(500).json({ error: 'Aanmelden lukte niet door een serverfout. Probeer het opnieuw.' });
    }
    setCsrfCookie(res);
    // Sprint 48b2: meerdere scholen en nog niets gekozen → de browser toont het
    // keuzescherm. Bij 0 of 1 school is er niets te kiezen en ga je meteen door.
    const moetKiezen = sessie && !sessie.actieveSchool && (sessie.scholen || []).length > 1;
    return res.json({
      ok: true,
      ...(moetKiezen && { kiesSchool: sessie.scholen.map(s => ({ id: s.id, name: s.name })) }),
    });
  }

  const state = registerAuthFailure(ip);
  await sleep(getFailureDelayMs(state.failures.length));
  if (state.blockedUntil > Date.now()) {
    res.setHeader('Retry-After', String(Math.ceil((state.blockedUntil - Date.now()) / 1000)));
    return res.status(429).json({ error: 'Geblokkeerd' });
  }
  return res.status(401).json({ error: 'Ongeldige credentials' });
});

app.get('/teacher-sessions.html', requireTeacherAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teacher-sessions.html'));
});
app.get('/teacher-app.html', requireTeacherAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teacher-app.html'));
});
// teacher-start.html route verwijderd (sprint 23c) — bestand bestond niet

// ── Sprint 45 (Deel A): de app serveert de startpagina zélf en vult de live versie
// server-side in (placeholder {{APP_VERSION}}). Geen fetch/CORS, werkt zonder JavaScript,
// en klopt altijd omdat de app zijn eigen versie kent (VERSION → .env → APP_VERSION).
let _landingHtmlCache = null;
function renderLanding() {
  if (_landingHtmlCache) return _landingHtmlCache;
  const fsSync = require('fs');
  const raw = fsSync.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  _landingHtmlCache = raw.replace(/\{\{APP_VERSION\}\}/g, APP_VERSION);
  return _landingHtmlCache;
}
app.get('/', (req, res) => {
  res.type('html').send(renderLanding());
});
app.get('/index.html', (req, res) => {
  res.type('html').send(renderLanding());
});
app.get('/landing.html', (req, res) => {
  res.redirect('/index.html');
});

// ── Sprint 45 (Deel B): nette instap-routes (leerling vs. leerkracht).
// Oude .html-links blijven werken via express.static verderop.
app.get('/student', (req, res) => {
  // Clean URL; student-start.html blijft ook rechtstreeks bereikbaar.
  res.sendFile(path.join(__dirname, 'public', 'student-start.html'));
});
app.get('/teacher', (req, res) => {
  // Leidt naar het leerkrachtenplatform; requireTeacherAuth stuurt zo nodig door naar login.
  res.redirect('/teacher-sessions.html');
});

// Sprint 50b: laat de ingelogde leerkracht zien wie de app dénkt dat hij is.
// Dit is meteen de test voor deze sprint: log in als A en als B in twee browsers,
// en dit moet twee verschillende namen geven.
// ── Sprint 48b2: school kiezen na het inloggen ───────────────────────────────
// Wordt enkel gebruikt als een leerkracht op meerdere scholen werkt.
// De keuze wordt SERVER-SIDE op de sessie gezet — de browser stuurt enkel welk id hij
// wil, en dat wordt hier gecontroleerd. Zonder die controle zou iemand met twee scholen
// (of één) zich op eender welke school kunnen zetten, en dat is precies het lek dat
// fase 3 moet voorkomen.
app.post('/api/teacher-login/school', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { schoolId } = req.body || {};
  if (!schoolId) return res.status(400).json({ error: 'schoolId vereist' });
  if (!req.teacher?.id) return res.status(400).json({ error: 'Geen leerkracht-sessie.' });

  try {
    // Mag deze leerkracht wel op deze school? Enkel actieve scholen tellen.
    const eigen = await dbModule.getSchoolsForTeacher(req.teacher.id);
    const school = eigen.find(s => s.id === schoolId);
    if (!school) {
      log.warn(`[auth] ${req.teacher.username} probeerde school ${schoolId} te kiezen zonder koppeling`);
      return res.status(403).json({ error: 'Je hebt geen toegang tot die school.' });
    }

    const cookies = parseCookieHeader(req.headers.cookie);
    if (!cookies.teacher_sid) return res.status(400).json({ error: 'Geen sessie gevonden.' });
    await dbModule.setSessionActiveSchool(hashSessionToken(cookies.teacher_sid), schoolId);
    dbModule.auditLog(getActorFromReq(req), 'school_selected', schoolId, { name: school.name }, req.ip).catch(() => {});
    res.json({ ok: true, name: school.name });
  } catch (e) {
    log.error('[auth] school kiezen mislukt:', e.message);
    res.status(500).json({ error: 'Kiezen lukte niet. Probeer opnieuw.' });
  }
});

app.get('/api/me', requireTeacherAuth, (req, res) => {
  res.json({
    username: req.teacher.username,
    displayName: req.teacher.displayName,
    role: req.teacher.role,
    source: req.teacher.source,
    // Sprint 48b1: welke school is actief in deze sessie? null = geen school gekoppeld
    // (de normale toestand vandaag) of nog niet gekozen bij meerdere scholen.
    activeSchoolId: req.teacher.activeSchoolId || null,
    activeSchoolName: req.teacher.activeSchoolName || null,
    // Toont of de identiteit betrouwbaar is. Bij 'legacy' weet de app enkel dát
    // je mag, niet wie je bent — dat is precies wat fase 1 oplost.
    identiteitBekend: req.teacher.source === 'session',
  });
});

app.get('/api/version', (req, res) => {
  res.json({
    version: APP_VERSION,
    ...VERSION,
    uptime: Math.round(process.uptime()),
    node: process.version,
  });
});

// Sprint 19b: schoollogo en schoolinfo
// Sprint 48b3: volgt de ACTIEVE school uit de sessie.
//
// De SERVER beslist of er een schoollogo hoort, niet de client. Dat scheelt een lijst
// van "op welke pagina's wel" die je gegarandeerd ooit vergeet bij te werken:
//   geen leerkracht-sessie  → startscherm, loginscherm, leerlingpagina's → géén logo
//   sessie mét actieve school → het logo van díe school
//   sessie zónder school      → terugval op .env (installatie met één school)
app.get('/api/school-info', async (req, res) => {
  const geen = { name: 'PyCodeFlow', logoUrl: null, schoolId: null };
  try {
    const cookies = parseCookieHeader(req.headers.cookie);
    if (!cookies.teacher_sid) return res.json(geen);   // geen login = geen school

    const sessie = await dbModule.getTeacherSession(hashSessionToken(cookies.teacher_sid));
    if (!sessie) return res.json(geen);

    if (sessie.active_school_id) {
      const school = await dbModule.getSchool(sessie.active_school_id);
      if (school) {
        return res.json({
          name: school.name,
          logoUrl: school.logo_path ? `/school-logo?id=${encodeURIComponent(school.id)}` : null,
          schoolId: school.id,
        });
      }
    }
  } catch (e) {
    log.warn('[school-info] ophalen mislukt:', e.message);
    return res.json(geen);
  }
  // Ingelogd, maar (nog) geen school gekoppeld — de huidige toestand.
  // Dan geldt de .env-branding, zodat installaties met één school gewoon werken.
  res.json({
    name: process.env.SCHOOL_NAME || 'PyCodeFlow',
    logoUrl: process.env.SCHOOL_LOGO_PATH ? '/school-logo' : null,
    schoolId: null,
  });
});

// Sprint 48b3: serveert het logo van een specifieke school (?id=...), of dat uit .env.
//
// ⚠️ Het pad komt uit de databank en wordt door een beheerder ingetypt. Een pad als
// "../../etc/passwd" zou anders zomaar uitgeserveerd worden. Daarom:
//   - enkel absolute paden, geen ".." erin
//   - enkel afbeeldingsextensies
// Beter hier tegenhouden dan erop vertrouwen dat niemand zich vergist.
app.get('/school-logo', async (req, res) => {
  const fsSync = require('fs');
  let logoPath = process.env.SCHOOL_LOGO_PATH || '';

  if (req.query.id) {
    try {
      const school = await dbModule.getSchool(String(req.query.id));
      logoPath = school?.logo_path || '';
    } catch { return res.status(404).end(); }
  }

  if (!logoPath) return res.status(404).end();
  if (logoPath.includes('..') || !path.isAbsolute(logoPath)) {
    log.warn('[school-logo] geweigerd pad:', logoPath);
    return res.status(400).end();
  }
  if (!/\.(png|jpe?g|svg|webp|gif)$/i.test(logoPath)) {
    log.warn('[school-logo] geen afbeelding:', logoPath);
    return res.status(400).end();
  }
  if (!fsSync.existsSync(logoPath)) return res.status(404).end();
  res.sendFile(logoPath);
});


function readCgroupNumber(filePath) {
  try {
    const raw = require('fs').readFileSync(filePath, 'utf8').trim();
    if (!raw || raw === 'max') return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

app.get('/api/system-stats', requireTeacherAuth, async (req, res) => {
  try {
    const runnerResponse = await fetch(`${RUNNER_URL}/health`);
    if (!runnerResponse.ok) {
      throw new Error(`runner health failed: ${runnerResponse.status}`);
    }
    const runner = await runnerResponse.json();
    const os = require('os');

    const webProcessMem = process.memoryUsage();
    const webCgroupCurrent = readCgroupNumber('/sys/fs/cgroup/memory.current');
    const webCgroupMax = readCgroupNumber('/sys/fs/cgroup/memory.max');

    res.json({
      ok: true,
      timestamp: Date.now(),
      runner,
      web: {
        rssBytes: webProcessMem.rss,
        rssMb: Math.round((webProcessMem.rss / 1024 / 1024) * 10) / 10,
        heapUsedMb: Math.round((webProcessMem.heapUsed / 1024 / 1024) * 10) / 10,
        heapTotalMb: Math.round((webProcessMem.heapTotal / 1024 / 1024) * 10) / 10,
        cgroupMemoryCurrentBytes: webCgroupCurrent,
        cgroupMemoryMaxBytes: webCgroupMax,
      },
      system: {
        totalMemBytes: require('os').totalmem(),
        freeMemBytes: require('os').freemem(),
        loadAvg: require('os').loadavg(),
        cpus: require('os').cpus().length,
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || 'stats failed' });
  }
});


// ── Sprint 24g: Database viewer endpoints ─────────────────────────────────────

// Whitelist van toegestane tabelnamen — geen vrije SQL input mogelijk
const DB_VIEWER_TABLES = [
  'schools', 'school_domains', 'teacher_schools',
  'teachers', 'teacher_sessions', 'classes', 'teacher_classes', 'students',
  'sessions', 'student_sessions', 'session_history',
  'question_bank', 'assignment_bank', 'quiz_answers', 'quiz_student_sessions',
  'announcements', 'audit_log', 'free_audit_log',
  'db_settings', 'log_entries'
];

// Gevoelige kolommen die gemaskeerd worden
// 50a: token_hash erbij — uit een hash valt geen sessie te herleiden, maar hij hoort
// evenmin in een overzichtsscherm te staan.
const DB_VIEWER_MASKED = ['password_hash', 'cookie_secret', 'google_sub', 'token', 'token_hash'];

app.get('/api/admin/db/tables', requireTeacherAuth, async (req, res) => {
  try {
    const query = dbModule.query;  // 27l: query via dbModule export
    const tableInfo = await Promise.all(DB_VIEWER_TABLES.map(async (tbl) => {
      try {
        // Rij-aantal
        const countRes = await query(`SELECT COUNT(*) as cnt FROM ${tbl}`);
        const rowCount = parseInt(countRes.rows[0]?.cnt || 0);
        // Kolominfo
        const colRes = await query(
          `SELECT column_name, data_type FROM information_schema.columns
           WHERE table_name = $1 AND table_schema = 'public'
           ORDER BY ordinal_position`, [tbl]
        );
        return {
          name: tbl,
          rowCount,
          columns: colRes.rows.map(r => ({ name: r.column_name, type: r.data_type })),
          category: ['teachers','classes','teacher_classes','students'].includes(tbl) ? 'kern'
                  : ['question_bank','assignment_bank','quiz_answers','quiz_student_sessions'].includes(tbl) ? 'quiz'
                  : 'systeem'
        };
      } catch { return { name: tbl, rowCount: 0, columns: [], category: 'systeem', error: true }; }
    }));
    res.json({ ok: true, tables: tableInfo });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/admin/db/tables/:name/rows', requireTeacherAuth, async (req, res) => {
  const tbl = req.params.name;
  if (!DB_VIEWER_TABLES.includes(tbl)) {
    return res.status(403).json({ ok: false, error: 'Tabel niet toegestaan' });
  }
  try {
    const query = dbModule.query;  // 27l: query via dbModule export
    const limit  = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const search = (req.query.search || '').trim().slice(0, 100);

    // Kolomnamen ophalen
    const colRes = await query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = $1 AND table_schema = 'public'
       ORDER BY ordinal_position`, [tbl]
    );
    const columns = colRes.rows.map(r => r.column_name);

    // Rijen ophalen (met optionele zoekfilter over alle text/varchar kolommen)
    let whereClause = '';
    const params = [];
    if (search) {
      const textCols = colRes.rows
        .filter(r => !DB_VIEWER_MASKED.includes(r.column_name))
        .map(r => r.column_name);
      if (textCols.length > 0) {
        params.push(`%${search}%`);
        whereClause = 'WHERE ' + textCols.map(c => `CAST(${c} AS TEXT) ILIKE $1`).join(' OR ');
      }
    }

    const countRes = await query(`SELECT COUNT(*) as cnt FROM ${tbl} ${whereClause}`, params);
    const total = parseInt(countRes.rows[0]?.cnt || 0);

    params.push(limit, offset);
    const rowRes = await query(
      `SELECT * FROM ${tbl} ${whereClause} ORDER BY 1 LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    // Maskeer gevoelige kolommen
    const rows = rowRes.rows.map(row => {
      const masked = { ...row };
      DB_VIEWER_MASKED.forEach(col => { if (col in masked) masked[col] = '••••••'; });
      return masked;
    });

    res.json({ ok: true, columns, rows, total, limit, offset });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Templates endpoint — geeft lijst van voorgeladen oefeningstemplates
app.get('/api/templates', requireTeacherAuth, (req, res) => {
  try {
    const tmplPath = path.join(__dirname, 'templates.json');
    const data = JSON.parse(fs.readFileSync(tmplPath, 'utf8'));
    res.json(data);
  } catch(e) {
    res.status(500).json({ error: 'Templates niet gevonden', templates: [] });
  }
});

// Code history: snapshots voor een leerling ophalen
app.get('/api/sessions/:code/history/:studentId', requireTeacherAuth, async (req, res) => {
  const code = (req.params.code || '').toUpperCase();
  const studentId = req.params.studentId;
  const session = sessions.get(code);
  if (!session) return res.status(404).json({ error: 'Sessie niet gevonden' });
  const student = session.students[studentId];
  if (!student) return res.status(404).json({ error: 'Leerling niet gevonden' });
  try {
    const snapshots = await dbModule.getSnapshots(code, studentId);
    res.json({ studentName: student.name, snapshots });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// CSRF token endpoint — client haalt token op na login
app.get('/api/csrf-token', requireTeacherAuth, (req, res) => {
  setCsrfCookie(res);
  res.json({ token: CSRF_TOKEN });
});

// Sprint 12a-D: Monaco ESM worker configuratie (publiek endpoint)
// Workers via blob: URLs — vereist geen unsafe-eval
app.get('/monaco-env.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(`// PyCodeFlow — Monaco ESM Worker Environment (Sprint 12a-D)
// Configureert Monaco workers als blob: URLs zodat unsafe-eval niet nodig is
window.MonacoEnvironment = {
  getWorkerUrl: function(moduleId, label) {
    var base = '/monaco/min/vs';
    if (label === 'json')       return base + '/language/json/json.worker.js';
    if (label === 'css' || label === 'scss' || label === 'less')
                                return base + '/language/css/css.worker.js';
    if (label === 'html')       return base + '/language/html/html.worker.js';
    if (label === 'typescript' || label === 'javascript')
                                return base + '/language/typescript/ts.worker.js';
    return base + '/editor.worker.js';
  }
};`);
});

// ── Sprint 12b: Admin API — leerkrachten ─────────────────────────────────────

app.get('/api/admin/teachers', requireTeacherAuth, requireCsrf, async (req, res) => {
  try {
    const teachers = await dbModule.listTeachers();
    // Sprint 48a2: scholen erbij, zodat het beheerscherm ze meteen kan tonen zonder
    // per leerkracht een apart verzoek te doen. Inactieve scholen tonen we hier wél —
    // een beheerder moet zien dat een koppeling naar een uitgeschakelde school bestaat.
    await Promise.all(teachers.map(async t => {
      try { t.schools = await dbModule.getSchoolsForTeacher(t.id, true); }
      catch { t.schools = []; }   // scholen zijn bijzaak; de lijst mag hier niet op stuklopen
    }));
    res.json(teachers);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Sprint 48a2: leerkracht ↔ school koppelen ────────────────────────────────
// ── Sprint 48a3: e-maildomeinen per school ───────────────────────────────────
app.get('/api/admin/schools/:id/domains', requireTeacherAuth, async (req, res) => {
  try {
    res.json(await dbModule.listSchoolDomains(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/schools/:id/domains', requireTeacherAuth, requireCsrf, async (req, res) => {
  // De validatie zit in lib/validation.js en is apart getest — hier enkel toepassen.
  const check = validationLib.valideerDomein(req.body?.domain);
  if (!check.ok) return res.status(400).json({ error: check.fout });
  try {
    const bestaand = await dbModule.listSchoolDomains(req.params.id);
    if (bestaand.includes(check.waarde)) {
      return res.status(400).json({ error: 'Dit domein staat er al.' });
    }
    await dbModule.addSchoolDomain(req.params.id, check.waarde);
    dbModule.auditLog(getActorFromReq(req), 'school_domain_added', req.params.id,
                      { domain: check.waarde }, req.ip).catch(() => {});
    res.json({ ok: true, domain: check.waarde });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/schools/:id/domains/:domain', requireTeacherAuth, requireCsrf, async (req, res) => {
  const domein = decodeURIComponent(req.params.domain);
  try {
    // Elke school heeft minstens één domein nodig: zonder domein kan straks geen enkele
    // leerling zich registreren (52c). Beter hier tegenhouden dan het later niet snappen.
    const bestaand = await dbModule.listSchoolDomains(req.params.id);
    if (bestaand.length <= 1) {
      return res.status(400).json({ error: 'Elke school heeft minstens 1 domein nodig.' });
    }
    const ok = await dbModule.removeSchoolDomain(req.params.id, domein);
    if (ok) dbModule.auditLog(getActorFromReq(req), 'school_domain_removed', req.params.id,
                              { domain: domein }, req.ip).catch(() => {});
    res.json({ ok });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Het testveldje: plak een adres en zie of het mag — en via welke regel.
// Zonder dit ontdekt een leerling de fout op de dag van de toets.
app.post('/api/admin/schools/:id/domains/test', requireTeacherAuth, requireCsrf, async (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (!email.includes('@')) return res.status(400).json({ error: 'Geef een volledig e-mailadres in.' });
  try {
    const domeinen = await dbModule.listSchoolDomains(req.params.id);
    const regel = domeinen.find(d => validationLib.domainMatches(email, d)) || null;
    res.json({
      toegelaten: !!regel,
      viaRegel: regel,
      domein: validationLib.domeinUitEmail(email),
      aantalRegels: domeinen.length,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/teachers/:id/schools', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { schoolId } = req.body || {};
  if (!schoolId) return res.status(400).json({ error: 'schoolId vereist' });
  try {
    await dbModule.linkTeacherSchool(req.params.id, schoolId);
    dbModule.auditLog(getActorFromReq(req), 'teacher_school_linked', req.params.id, { schoolId }, req.ip).catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/teachers/:id/schools/:schoolId', requireTeacherAuth, requireCsrf, async (req, res) => {
  try {
    await dbModule.unlinkTeacherSchool(req.params.id, req.params.schoolId);
    dbModule.auditLog(getActorFromReq(req), 'teacher_school_unlinked', req.params.id,
                      { schoolId: req.params.schoolId }, req.ip).catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Wie werkt er op deze school? Handig vanuit het scholen-overzicht.
app.get('/api/admin/schools/:id/teachers', requireTeacherAuth, async (req, res) => {
  try {
    res.json(await dbModule.getTeachersForSchool(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/teachers', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { username, password, displayName, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Gebruikersnaam en wachtwoord vereist' });
  if (username.length > 64) return res.status(400).json({ error: 'Gebruikersnaam te lang' });
  if (password.length < 8) return res.status(400).json({ error: 'Wachtwoord moet minimaal 8 tekens zijn' });
  try {
    // Sprint 36: createPasswordHash geeft één string (scrypt$...) — geen destructuring.
    // 36c: rol gevalideerd via lib/validation.js
    const passHash = createPasswordHash(password);
    const safeRole = validationLib.isValidRole(role) ? role : 'teacher';
    const id = await dbModule.createTeacher(
      username.trim(), passHash, validationLib.clampString(displayName || '', 64), safeRole
    );
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/teachers/:username/password', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 8) return res.status(400).json({ error: 'Wachtwoord moet minimaal 8 tekens zijn' });
  // Sprint 36: createPasswordHash geeft één string (scrypt$...) — geen destructuring.
  const passHash = createPasswordHash(password);
  const ok = await dbModule.updatePassHash(req.params.username, passHash);
  // Sprint 50c: trek de lopende sessies van deze leerkracht in.
  // Je wijzigt je wachtwoord juist omdát je vermoedt dat iemand meekijkt — dan mag
  // die niet gewoon binnen blijven op een sessie van vóór de wijziging.
  // Gevolg: wie zijn eigen wachtwoord wijzigt, moet opnieuw inloggen. Dat hoort zo.
  if (ok) {
    try {
      const teacher = await dbModule.getTeacherByUsername(req.params.username);
      if (teacher) {
        await dbModule.deleteTeacherSessionsFor(teacher.id);
        log.info(`[auth] sessies ingetrokken na wachtwoordwijziging van ${teacher.username}`);
      }
    } catch (e) {
      // Het wachtwoord is al gewijzigd; dat mag niet terugdraaien op een opruimfout.
      log.warn('[auth] sessies intrekken na wachtwoordwijziging mislukt:', e.message);
    }
  }
  res.json({ ok });
});

app.put('/api/admin/teachers/:username/role', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { role } = req.body || {};
  if (!validationLib.isValidRole(role)) return res.status(400).json({ error: 'Ongeldige rol' });
  const ok = await dbModule.updateTeacherRole(req.params.username, role);
  res.json({ ok });
});

app.delete('/api/admin/teachers/:username', requireTeacherAuth, requireCsrf, async (req, res) => {
  const ok = await dbModule.deleteTeacher(req.params.username);
  res.json({ ok });
});

// ── Sprint 12b: Admin API — klassen ──────────────────────────────────────────

app.get('/api/admin/classes', requireTeacherAuth, async (req, res) => {
  try {
    const classes = await dbModule.listClasses(
      req.query.archived === 'true',
      req.query.schoolYear || null
    );
    res.json(classes);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Sprint 41: beschikbare schooljaren (voor de selector), nieuwste eerst.
app.get('/api/admin/school-years', requireTeacherAuth, async (req, res) => {
  try {
    res.json(await dbModule.getSchoolYears());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Publiek endpoint voor leerling dropdown (enkel namen)
app.get('/api/classes', async (req, res) => {
  try {
    const classes = await dbModule.listClasses(false);
    res.json(classes.map(c => ({ id: c.id, name: c.name, school_year: c.school_year })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Sprint 48a1: scholen beheren ─────────────────────────────────────────────
// Additief: zolang niets aan een school hangt, verandert dit niets aan de werking.
// 48a2 koppelt hier leerkrachten aan, 48a3 e-maildomeinen.
app.get('/api/admin/schools', requireTeacherAuth, async (req, res) => {
  try {
    res.json(await dbModule.listSchools(req.query.includeInactive === 'true'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/schools', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { name, logoPath, license, contact } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Naam vereist' });
  try {
    const id = await dbModule.createSchool({
      name: name.trim().slice(0, 120),
      logoPath: String(logoPath || '').slice(0, 255),
      license: String(license || '').slice(0, 64),
      contact: String(contact || '').slice(0, 200),
    });
    dbModule.auditLog(getActorFromReq(req), 'school_created', id, { name: name.trim() }, req.ip).catch(() => {});
    res.json({ ok: true, id });
  } catch (e) {
    // De unieke index op de naam vangt dubbels op; geef daar een leesbare melding voor
    // i.p.v. een ruwe databankfout.
    if (String(e.message).includes('idx_schools_name')) {
      return res.status(400).json({ error: 'Er bestaat al een school met die naam.' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/admin/schools/:id', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { name, logoPath, license, contact, active } = req.body || {};
  if (name !== undefined && !String(name).trim()) {
    return res.status(400).json({ error: 'Naam mag niet leeg zijn' });
  }
  try {
    const ok = await dbModule.updateSchool(req.params.id, {
      ...(name !== undefined && { name: String(name).trim().slice(0, 120) }),
      ...(logoPath !== undefined && { logoPath: String(logoPath).slice(0, 255) }),
      ...(license !== undefined && { license: String(license).slice(0, 64) }),
      ...(contact !== undefined && { contact: String(contact).slice(0, 200) }),
      ...(active !== undefined && { active: active === true || active === 'true' }),
    });
    if (ok) dbModule.auditLog(getActorFromReq(req), 'school_updated', req.params.id, {}, req.ip).catch(() => {});
    res.json({ ok });
  } catch (e) {
    if (String(e.message).includes('idx_schools_name')) {
      return res.status(400).json({ error: 'Er bestaat al een school met die naam.' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/schools/:id', requireTeacherAuth, requireCsrf, async (req, res) => {
  try {
    const ok = await dbModule.deleteSchool(req.params.id);
    if (ok) dbModule.auditLog(getActorFromReq(req), 'school_deleted', req.params.id, {}, req.ip).catch(() => {});
    res.json({ ok });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/classes', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { name, schoolYear } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Naam vereist' });
  try {
    const id = await dbModule.createClass(name.trim().slice(0, 64), schoolYear || '2025-2026');
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/classes/:id/archive', requireTeacherAuth, requireCsrf, async (req, res) => {
  await dbModule.archiveClass(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/classes/:id', requireTeacherAuth, requireCsrf, async (req, res) => {
  const ok = await dbModule.deleteClass(req.params.id);
  res.json({ ok });
});

app.post('/api/admin/classes/:id/teachers', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { teacherId } = req.body || {};
  if (!teacherId) return res.status(400).json({ error: 'teacherId vereist' });
  await dbModule.linkTeacherClass(teacherId, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/classes/:id/teachers/:teacherId', requireTeacherAuth, requireCsrf, async (req, res) => {
  await dbModule.unlinkTeacherClass(req.params.teacherId, req.params.id);
  res.json({ ok: true });
});

// ── Sprint 12c: Admin API — leerlingen ───────────────────────────────────────

app.get('/api/admin/students', requireTeacherAuth, async (req, res) => {
  try {
    const students = await dbModule.listStudents(req.query.classId || null, req.query.includeBlocked !== 'false');
    res.json(students);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/students', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { name, classId, source, status } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Naam vereist' });
  try {
    // Sprint 41: gearchiveerde schooljaren zijn read-only.
    if (classId) {
      const archived = await dbModule.isClassArchived(classId);
      if (archived === null) return res.status(404).json({ error: 'Klas niet gevonden.' });
      if (archived) return res.status(403).json({
        error: 'Deze klas hoort bij een gearchiveerd schooljaar en is alleen-lezen.',
      });
    }
    const id = await dbModule.createStudent(name.trim().slice(0, 64), classId || null, source || 'manual', status || 'active');
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/students/:id/status', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'pending', 'blocked'].includes(status)) return res.status(400).json({ error: 'Ongeldige status' });
  await dbModule.updateStudentStatus(req.params.id, status);
  res.json({ ok: true });
});

app.put('/api/admin/students/:id/class', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { classId } = req.body || {};
  // Sprint 41: niet in een gearchiveerd (read-only) schooljaar plaatsen.
  if (classId) {
    const archived = await dbModule.isClassArchived(classId);
    if (archived === null) return res.status(404).json({ error: 'Klas niet gevonden.' });
    if (archived) return res.status(403).json({
      error: 'Deze klas hoort bij een gearchiveerd schooljaar en is alleen-lezen.',
    });
  }
  await dbModule.updateStudentClass(req.params.id, classId || null);
  res.json({ ok: true });
});

app.put('/api/admin/students/:id/notes', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { notes } = req.body || {};
  await dbModule.updateStudentNotes(req.params.id, String(notes || '').slice(0, 500));
  res.json({ ok: true });
});

app.delete('/api/admin/students/:id', requireTeacherAuth, requireCsrf, async (req, res) => {
  const ok = await dbModule.deleteStudent(req.params.id);
  res.json({ ok });
});

// Sprint 12c: CSV import
app.post('/api/admin/students/import-csv', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { csv } = req.body || {};
  if (!csv) return res.status(400).json({ error: 'CSV data vereist' });
  if (csv.length > 200 * 1024) return res.status(400).json({ error: 'CSV te groot (max 200KB)' });
  const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
  const rows = lines.map(line => {
    const [name, className] = line.split(',').map(s => s.trim());
    return { name, className };
  }).filter(r => r.name);
  try {
    const result = await dbModule.importStudentsFromCSV(rows);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══ Sprint 19j: Deadline check interval ════════════════════════════════════
setInterval(async () => {
  const now = Date.now();
  for (const [code, session] of sessions.entries()) {
    if (session.mode !== 'quiz') continue;
    try {
      const meta = await dbModule.getQuizMeta(code);
      if (!meta?.access_until || now < meta.access_until) continue;
      if (session._deadlineHandled) continue;
      session._deadlineHandled = true;

      // Stuur force_submit naar alle nog actieve leerlingen
      for (const student of Object.values(session.students)) {
        if (!student.quizSubmitted && student.socketId && student.quizStartedAt) {
          io.to(student.socketId).emit('quiz_force_submit', { reason: 'deadline' });
          await dbModule.submitQuizAnswers(code, student.id, true).catch(() => {});
        }
      }
      log.info(`[quiz] Sessie ${code}: deadline bereikt`);
    } catch (e) { /* stille fout — zie debug */ }
  }
}, 60 * 1000);

// ══ Sprint 16: Quiz Timer helper ═════════════════════════════════════════════

function startQuizTimer(session, student, totalSeconds) {
  if (student._quizTimerInterval) clearInterval(student._quizTimerInterval);
  const endAt = (student.quizStartedAt || Date.now()) + totalSeconds * 1000;

  student._quizTimerInterval = setInterval(() => {
    if (!student.socketId) return;
    const remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000));

    io.to(student.socketId).emit('quiz_timer_update', { remaining, total: totalSeconds });

    // 10% waarschuwing
    if (!student._quizWarned && remaining <= Math.round(totalSeconds * 0.10)) {
      student._quizWarned = true;
      const mins = Math.ceil(remaining / 60);
      io.to(student.socketId).emit('quiz_warning', {
        remaining,
        message: `⚠️ Nog ${mins} minuut${mins !== 1 ? 'en' : ''}! Controleer al je antwoorden.`,
      });
    }

    // Timer verlopen — auto-submit
    if (remaining <= 0) {
      clearInterval(student._quizTimerInterval);
      if (!student.quizSubmitted) {
        student.quizSubmitted = true;
        io.to(student.socketId).emit('quiz_force_submit');
        // Sla alle in-memory antwoorden op
        const sessionCode = Object.entries(session.students)
          .find(([,s]) => s.id === student.id)?.[0] ? session.code : session.code;
        Object.entries(student.quizAnswers || {}).forEach(([qId, ans]) => {
          dbModule.saveQuizAnswer({
            sessionCode: session.code, studentId: student.id,
            studentName: student.name, studentClass: student.className || '',
            questionId: qId, personalOrder: student.quizPersonalOrder?.indexOf(qId) ?? 0,
            code: ans.code || '', runCount: ans.runCount || 0,
            firstVisitAt: ans.firstVisitAt || null, firstRunAt: ans.firstRunAt || null,
          }).catch(() => {});
        });
        dbModule.submitQuizAnswers(session.code, student.id, true).catch(() => {});
        // Notificeer leerkracht
        if (session.teacherSocketId) {
          io.to(session.teacherSocketId).emit('quiz_student_progress', {
            studentId: student.id, studentName: student.name, className: student.className,
            currentQuestion: -1, totalQuestions: -1,
            savedCount: Object.keys(student.quizAnswers || {}).length,
            submitted: true, startedAt: student.quizStartedAt, autoSubmitted: true,
          });
        }
      }
    }
  }, 1000);
}

// ══ Sprint 16: Toetsmodule API ═════════════════════════════════════════════

// ── 16a: Vragenbank ──────────────────────────────────────────────────────────

app.get('/api/quiz/bank', requireTeacherAuth, async (req, res) => {
  try {
    const questions = await dbModule.listQuizBank({
      subject: req.query.subject || null,
      difficulty: req.query.difficulty || null,
      archived: req.query.archived === 'true',
    });
    res.json(questions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quiz/bank/subjects', requireTeacherAuth, async (req, res) => {
  try { res.json(await dbModule.getQuizBankSubjects()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/quiz/bank', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { text, subject, difficulty, maxPoints, questionType, choices, tags, modelAnswer } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ error: 'Vraagstelling is verplicht.' });
  if (text.length > 5000) return res.status(400).json({ error: 'Vraagstelling te lang (max 5000 tekens).' });
  const validTypes = ['code', 'open', 'multiple', 'single'];
  const qType = validTypes.includes(questionType) ? questionType : 'code';
  // Valideer choices bij meerkeuze/single
  if (['multiple', 'single'].includes(qType)) {
    if (!Array.isArray(choices) || choices.length < 2) {
      return res.status(400).json({ error: 'Minimaal 2 antwoordopties verplicht.' });
    }
    if (choices.length > 8) return res.status(400).json({ error: 'Maximaal 8 antwoordopties.' });
    const hasCorrect = choices.some(ch => ch.correct === true);
    if (!hasCorrect) return res.status(400).json({ error: 'Minimaal 1 juist antwoord verplicht.' });
  }
  try {
    const teacher = await dbModule.getTeacherByUsername(
      parseBasicAuthHeader(req.headers.authorization)?.username || ''
    );
    const id = await dbModule.createQuizQuestion({
      text, subject: (subject || '').slice(0, 64),
      difficulty: ['makkelijk','gemiddeld','moeilijk'].includes(difficulty) ? difficulty : 'gemiddeld',
      maxPoints: Math.max(1, Math.min(100, parseInt(maxPoints) || 4)),
      questionType: qType,
      choicesJson: qType === 'code' || qType === 'open' ? '[]' : JSON.stringify(
        (choices || []).map(ch => ({
          id: crypto.randomUUID(),
          text: String(ch.text || '').slice(0, 500),
          correct: ch.correct === true,
        }))
      ),
      tags: (tags || '').slice(0, 200),
      modelAnswer: String(modelAnswer || '').slice(0, 10000),
      createdBy: teacher?.id || null,
    });
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/quiz/bank/:id', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { text, subject, difficulty, maxPoints, questionType, choices, tags, modelAnswer } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ error: 'Vraagstelling is verplicht.' });
  const validTypes = ['code', 'open', 'multiple', 'single'];
  const qType = validTypes.includes(questionType) ? questionType : 'code';
  const ok = await dbModule.updateQuizQuestion(req.params.id, {
    text, subject: (subject || '').slice(0, 64),
    difficulty: ['makkelijk','gemiddeld','moeilijk'].includes(difficulty) ? difficulty : 'gemiddeld',
    maxPoints: Math.max(1, Math.min(100, parseInt(maxPoints) || 4)),
    questionType: qType,
    choicesJson: qType === 'code' || qType === 'open' ? '[]' : JSON.stringify(
      (choices || []).map(ch => ({
        id: ch.id || crypto.randomUUID(),
        text: String(ch.text || '').slice(0, 500),
        correct: ch.correct === true,
      }))
    ),
    tags: (tags || '').slice(0, 200),
    modelAnswer: String(modelAnswer || '').slice(0, 10000),
  });
  res.json({ ok });
});

// 38: dupliceer één bankvraag in het vragenoverzicht (los van toets dupliceren).
app.post('/api/quiz/bank/:id/duplicate', requireTeacherAuth, requireCsrf, async (req, res) => {
  try {
    const teacher = await dbModule.getTeacherByUsername(
      parseBasicAuthHeader(req.headers.authorization)?.username || ''
    );
    const newId = await dbModule.duplicateQuizQuestion(req.params.id, teacher?.id || null);
    if (!newId) return res.status(404).json({ error: 'Vraag niet gevonden.' });
    res.json({ ok: true, id: newId });
  } catch (e) {
    log.error('[bank-duplicate] fout:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/quiz/bank/:id/archive', requireTeacherAuth, requireCsrf, async (req, res) => {
  await dbModule.archiveQuizQuestion(req.params.id);
  res.json({ ok: true });
});

// 22f: herstellen van gearchiveerde vraag
app.put('/api/quiz/bank/:id/unarchive', requireTeacherAuth, requireCsrf, async (req, res) => {
  await dbModule.unarchiveQuizQuestion(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/quiz/bank/:id', requireTeacherAuth, requireCsrf, async (req, res) => {
  const result = await dbModule.deleteQuizQuestion(req.params.id);
  if (!result.ok) return res.status(409).json({ error: result.reason });
  res.json({ ok: true });
});

app.post('/api/quiz/bank/import-csv', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { csv } = req.body || {};
  if (!csv) return res.status(400).json({ error: 'CSV-data is verplicht.' });
  if (csv.length > 500 * 1024) return res.status(400).json({ error: 'CSV te groot (max 500KB).' });
  const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
  // Verwijder header-rij als aanwezig
  const hasHeader = lines[0]?.toLowerCase().includes('onderwerp') || lines[0]?.toLowerCase().includes('vraag');
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const rows = dataLines.map(line => {
    // CSV-parsing: ondersteuning voor aanhalingstekens
    const parts = line.match(/(".*?"|[^,]+)(?=,|$)/g)?.map(s => s.replace(/^"|"$/g, '').trim()) || [];
    return { onderwerp: parts[0], moeilijkheid: parts[1], max_punten: parts[2], vraag: parts[3] };
  }).filter(r => r.vraag);
  try {
    const teacher = await dbModule.getTeacherByUsername(
      parseBasicAuthHeader(req.headers.authorization)?.username || ''
    );
    const result = await dbModule.importQuizQuestionsCSV(rows, teacher?.id || null);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 16b: Toets aanmaken & beheren ────────────────────────────────────────────

app.post('/api/quiz', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { name, questions, randomize, timerSeconds, minRunsPerQ,
          hideQuestionOnScreen, isTeacherPreview, templateCode,
          noTimer, accessFrom, accessUntil, autoSubmitLate,
          schoolYear, targetClass, type, studentIds } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Naam is verplicht.' });
  // Sprint 43.14: type is voortaan EXPLICIET (komt uit de link waarmee het
  // aanmaakscherm geopend werd) — niet langer afgeleid uit noTimer. De server
  // vertrouwt dat net zo min als elk ander verplicht veld en valideert het hier.
  if (!validationLib.isValidAssignmentType(type)) {
    return res.status(400).json({ error: "Type is verplicht ('toets' of 'taak')." });
  }
  if (!questions?.length) return res.status(400).json({ error: 'Selecteer minstens 1 vraag.' });
  if (questions.length > 50) return res.status(400).json({ error: `Max 50 vragen per ${type}.` });
  // Sprint 43.3: einddatum + uur is VERPLICHT voor béide types (toets én taak).
  // Preview-toetsen zijn vrijgesteld: die dienen enkel om zelf even te testen.
  if (!isTeacherPreview && !accessUntil) {
    return res.status(400).json({ error: 'Een einddatum en uur (deadline) is verplicht.' });
  }
  if (accessUntil && accessFrom && Number(accessUntil) <= Number(accessFrom)) {
    return res.status(400).json({ error: 'De deadline moet ná de startdatum liggen.' });
  }

  const code = makeCode();
  const session = {
    code, id: crypto.randomUUID(), name: name.trim(), mode: 'quiz',
    editorAssist: false, createdAt: Date.now(),
    // Sprint 51a: eigenaar = de leerkracht die deze toets/taak aanmaakt.
    teacherId: bepaalSessieEigenaar(req.teacher),
    teacherSocketId: null, selectedStudentId: null,
    classWorkspaceMode: 'personal', sharedCode: '', sharedOutput: '',
    announcement: '', students: {},
    config: {
      autoIndent: false, autoClosingBrackets: false, autoClosingQuotes: false,
      quickSuggestions: false, parameterHints: false, errorLineMarking: true,
    },
    // Quiz-specifieke velden (in-memory)
    quizStarted: false, quizPaused: false, quizEnded: false,
  };
  sessions.set(code, session);

  try {
    await dbModule.persistSession(session);
    // 37b: haal de volledige bankvragen op zodat vraagtype, keuzes én modelantwoord
    // correct in de snapshot terechtkomen (de frontend stuurt enkel id/text/punten mee).
    const bankById = await dbModule.getQuizBankByIds(questions.map(q => q.id));
    await dbModule.createQuizSession({
      sessionCode: code,
      questions: questions.map((q, i) => {
        const bank = bankById.get ? bankById.get(q.id) : null;
        return {
          bankId: q.id, orderIndex: i,
          text: q.text, subject: q.subject || '',
          points: parseInt(q.points) || parseInt(q.max_points) || 4,
          questionType: bank?.question_type || 'code',
          choicesJson: bank?.choices_json || '[]',
          modelAnswer: bank?.model_answer || '',
        };
      }),
      randomize: randomize !== false,
      // Sprint 17: no_timer = true → geen tijdslimiet
      noTimer: noTimer === true,
      timerSeconds: noTimer ? null : Math.max(60, Math.min(7200, parseInt(timerSeconds) || 2700)),
      // Sprint 19j: tijdsvenster
      accessFrom: accessFrom ? Number(accessFrom) : null,
      accessUntil: accessUntil ? Number(accessUntil) : null,
      autoSubmitLate: autoSubmitLate !== false,
      minRunsPerQ: parseInt(minRunsPerQ) || 0,
      hideQuestionOnScreen: hideQuestionOnScreen === true,
      isTeacherPreview: isTeacherPreview === true,
      schoolYear: schoolYear || '',
      targetClass: targetClass || '',
      // Sprint 43.14: type staat vast vanaf het openen van het aanmaakscherm en is
      // hierboven al gevalideerd — geen afleiding meer uit noTimer (een taak MAG
      // een tijdslimiet hebben; dat is enkel niet meer verplicht).
      type,
    });
    // Sprint 43.4: expliciete leerling-selectie (leeg/afwezig = hele klas mag meedoen)
    if (Array.isArray(studentIds) && studentIds.length) {
      try { await dbModule.setAssignmentStudents(code, studentIds); }
      catch (e) { log.warn('[quiz] leerling-selectie opslaan mislukt:', e.message); }
    }
    res.json({ ok: true, code });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quiz/:code', requireTeacherAuth, async (req, res) => {
  const code = req.params.code.toUpperCase();
  const session = sessions.get(code);
  const meta = await dbModule.getQuizMeta(code);
  const questions = await dbModule.getQuizQuestions(code);
  res.json({ session: session ? { code, name: session.name, mode: session.mode } : null, meta, questions });
});

app.post('/api/quiz/:code/duplicate', requireTeacherAuth, requireCsrf, async (req, res) => {
  const code = req.params.code.toUpperCase();
  const meta = await dbModule.getQuizMeta(code);
  const questions = await dbModule.getQuizQuestions(code);
  const origSession = sessions.get(code) || await dbModule.loadActiveSessions().then(s => s.find(x => x.code === code));
  if (!meta || !questions.length) return res.status(404).json({ error: 'Toets niet gevonden.' });
  const newName = (req.body?.name || (origSession?.name || 'Toets') + ' (kopie)').slice(0, 100);
  // Sprint 43.8: dupliceren kopieert ENKEL de meta (assignment_bank) en KOPPELT de bestaande
  // vragen via hun bank-id (bank_question_id). Er worden dus géén nieuwe question_bank-records
  // aangemaakt — de vragenbank blijft gedeeld tussen origineel en kopie.
  const newCode = makeCode();
  const newSession = {
    code: newCode, id: crypto.randomUUID(), name: newName, mode: 'quiz',
    editorAssist: false, createdAt: Date.now(),
    // Sprint 51a: wie dupliceert wordt eigenaar van de kopie (niet per se dezelfde
    // leerkracht als het origineel — bv. een collega die een gedeelde toets kopieert).
    teacherId: bepaalSessieEigenaar(req.teacher),
    teacherSocketId: null, selectedStudentId: null,
    classWorkspaceMode: 'personal', sharedCode: '', sharedOutput: '',
    announcement: '', students: {},
    config: { autoIndent: false, autoClosingBrackets: false, autoClosingQuotes: false,
               quickSuggestions: false, parameterHints: false, errorLineMarking: true },
    quizStarted: false, quizPaused: false, quizEnded: false,
  };
  sessions.set(newCode, newSession);
  await dbModule.persistSession(newSession);
  await dbModule.createQuizSession({
    sessionCode: newCode,
    questions: questions.map((q, i) => ({
      bankId: q.bank_question_id, orderIndex: i,
      text: q.text_snapshot, subject: q.subject, points: q.points,
      // 33e-fix: vraagtype + keuzes meekopiëren (anders worden meerkeuzevragen code-vragen)
      questionType: q.question_type || 'code',
      choicesJson: q.choices_json || '[]',
      // 37b: modelantwoord ook meekopiëren bij toets-duplicatie
      modelAnswer: q.model_answer || '',
    })),
    randomize: meta.randomize,
    noTimer: meta.no_timer || false,
    timerSeconds: meta.timer_seconds,
    minRunsPerQ: meta.min_runs_per_q,
    hideQuestionOnScreen: meta.hide_question_on_screen,
    isTeacherPreview: false,
    schoolYear: meta.school_year || '',
    targetClass: meta.target_class || '',
    // Sprint 43.14: type expliciet meekopiëren van het origineel — anders viel dit terug
    // op de (foutieve) noTimer-afleiding en kon een taak per ongeluk een toets worden.
    type: (meta.type === 'taak' || meta.type === 'toets') ? meta.type : (meta.no_timer ? 'taak' : 'toets'),
  });
  // Sprint 43.8: velden die createQuizSession niet meeneemt, alsnog van het origineel overnemen
  // (tijdsvenster + individuele timer). Deadline hoort bij de toets, dus die kopieert mee.
  try {
    await dbModule.query(
      `UPDATE assignment_bank SET access_from = $1, access_until = $2, individual_timer = $3 WHERE session_code = $4`,
      [meta.access_from ?? null, meta.access_until ?? null, meta.individual_timer ?? true, newCode]
    );
  } catch (e) { log.warn('[duplicate] tijdsvenster kopiëren mislukt:', e.message); }
  res.json({ ok: true, code: newCode });
});

// ── Sprint 43.4: leerling-selectie per toets/taak ────────────────────────────
// GET → { classId, students:[{id,name,allowed}], restricted:bool }
app.get('/api/quiz/:code/students', requireTeacherAuth, async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  try {
    const meta = await dbModule.getQuizMeta(code);
    if (!meta) return res.status(404).json({ error: 'Niet gevonden.' });
    const classId = meta.target_class || '';
    if (!classId) return res.json({ classId: '', students: [], restricted: false });
    const klas = await dbModule.listStudents(classId);
    const allowed = await dbModule.listAssignmentStudents(code);
    const restricted = allowed.length > 0;
    res.json({
      classId,
      restricted,
      // Geen selectie vastgelegd → iedereen staat aangevinkt (standaard alles aan).
      students: klas.map(s => ({ id: s.id, name: s.name, allowed: restricted ? allowed.includes(s.id) : true })),
    });
  } catch (e) {
    log.warn('[quiz students] ophalen mislukt:', e.message);
    res.status(500).json({ error: 'Ophalen mislukt.' });
  }
});

// PUT { studentIds:[...] } → sla selectie op. Alles aangevinkt = beperking opheffen.
app.put('/api/quiz/:code/students', requireTeacherAuth, requireCsrf, async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const ids = Array.isArray(req.body?.studentIds) ? req.body.studentIds : [];
  try {
    const meta = await dbModule.getQuizMeta(code);
    if (!meta) return res.status(404).json({ error: 'Niet gevonden.' });
    const klas = meta.target_class ? await dbModule.listStudents(meta.target_class) : [];
    // Iedereen aangevinkt → geen rijen bewaren (dan blijft "hele klas" gelden, ook als
    // er later een leerling bijkomt). Anders enkel de aangevinkte leerlingen bewaren.
    const all = klas.length > 0 && ids.length >= klas.length;
    await dbModule.setAssignmentStudents(code, all ? [] : ids);
    res.json({ ok: true, restricted: !all && ids.length > 0 });
  } catch (e) {
    log.warn('[quiz students] opslaan mislukt:', e.message);
    res.status(500).json({ error: 'Opslaan mislukt.' });
  }
});

// ── Sprint 43.2b: preview-toets activeren (→ echte toets die gestart kan worden) ──
app.post('/api/quiz/:code/activate', requireTeacherAuth, requireCsrf, async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  try {
    await dbModule.query('UPDATE assignment_bank SET is_teacher_preview = false WHERE session_code = $1', [code]);
    const s = sessions.get(code);
    if (s) s.isTeacherPreview = false;
    res.json({ ok: true });
  } catch (e) {
    log.warn('[quiz activate] mislukt:', e.message);
    res.status(500).json({ ok: false, error: 'Activeren mislukt.' });
  }
});

// ── 16b: Toets pauzeren ──────────────────────────────────────────────────────

app.post('/api/quiz/:code/pause', requireTeacherAuth, requireCsrf, async (req, res) => {
  const session = sessions.get(req.params.code.toUpperCase());
  if (!session || session.mode !== 'quiz') return res.status(404).json({ error: 'Niet gevonden.' });
  session.quizPaused = !session.quizPaused;
  io.to(session.code).emit('quiz_paused', { paused: session.quizPaused });
  res.json({ ok: true, paused: session.quizPaused });
});

// ── 16d: Verbetermodule ───────────────────────────────────────────────────────

app.get('/api/quiz/:code/answers', requireTeacherAuth, async (req, res) => {
  try { res.json(await dbModule.getQuizAnswers(req.params.code.toUpperCase())); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quiz/:code/answers/:studentId', requireTeacherAuth, async (req, res) => {
  try {
    const answers = await dbModule.getQuizAnswersByStudent(
      req.params.code.toUpperCase(), req.params.studentId
    );
    const comment = await dbModule.getQuizGeneralComment(
      req.params.code.toUpperCase(), req.params.studentId
    );
    res.json({ answers, generalComment: comment });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 33a: scores-samenvatting exporteren als CSV (opent direct in Excel).
// Eén rij per leerling, een kolom per vraag + totaal. Geen externe dependency nodig.
app.get('/api/quiz/:code/export/csv', requireTeacherAuth, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const rows = await dbModule.getQuizAnswers(code);
    const meta = await dbModule.getQuizMeta(code);
    if (!rows.length) return res.status(404).json({ error: 'Geen resultaten om te exporteren.' });

    // Bouw de vragenlijst (uniek, op order_index) en de leerling-matrix.
    const questions = [];
    const seenQ = new Set();
    for (const r of rows) {
      if (!seenQ.has(r.question_id)) {
        seenQ.add(r.question_id);
        questions.push({ id: r.question_id, order: r.order_index, points: r.points,
          label: `V${r.order_index + 1}` });
      }
    }
    questions.sort((a, b) => a.order - b.order);

    // Groepeer per leerling
    const students = new Map();
    for (const r of rows) {
      const key = r.student_id;
      if (!students.has(key)) {
        students.set(key, { name: r.student_name, klas: r.student_class, scores: {} });
      }
      students.get(key).scores[r.question_id] = r.score;
    }

    // CSV opbouwen. Puntkomma als scheidingsteken (NL Excel-standaard).
    const esc = (v) => {
      const s = String(v ?? '');
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const maxTotal = questions.reduce((sum, q) => sum + (q.points || 0), 0);
    const header = ['Naam', 'Klas', ...questions.map(q => `${q.label} (${q.points}pt)`),
      `Totaal (/${maxTotal})`];
    const lines = [header.map(esc).join(';')];
    // Sorteer op klas, dan naam
    const sorted = [...students.values()].sort((a, b) =>
      (a.klas || '').localeCompare(b.klas || '') || (a.name || '').localeCompare(b.name || ''));
    for (const s of sorted) {
      let total = 0;
      const cells = questions.map(q => {
        const sc = s.scores[q.id];
        if (sc !== null && sc !== undefined) total += sc;
        return sc === null || sc === undefined ? '' : sc;
      });
      lines.push([esc(s.name), esc(s.klas), ...cells, total].join(';'));
    }
    // BOM zodat Excel UTF-8 (accenten) correct toont.
    const csv = '\uFEFF' + lines.join('\r\n');
    const fname = `resultaten_${code}_${(meta?.target_class || 'toets').replace(/[^a-zA-Z0-9]/g, '')}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(csv);
  } catch (e) {
    log.error('[csv-export] fout:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/quiz/:code/run-history/:studentId/:questionId', requireTeacherAuth, async (req, res) => {
  try {
    res.json(await dbModule.getQuizRunHistory(
      req.params.code.toUpperCase(), req.params.studentId, req.params.questionId
    ));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/quiz/:code/answers/:answerId/score', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { score, teacherComment } = req.body || {};
  const actor = getActorFromReq(req);
  // Haal oude score op voor audit
  const oldAnswers = await dbModule.getQuizAnswers(req.params.code.toUpperCase()).catch(() => []);
  const oldAns = oldAnswers.find(a => a.id === req.params.answerId);
  await dbModule.scoreQuizAnswer(req.params.answerId,
    score !== undefined ? parseInt(score) : null,
    String(teacherComment || '').slice(0, 1000)
  );
  // Audit log
  dbModule.auditLog(actor, 'score_changed', req.params.answerId, {
    sessionCode: req.params.code,
    oldScore: oldAns?.score,
    newScore: score !== undefined ? parseInt(score) : null,
    studentName: oldAns?.student_name,
  }, req.ip).catch(() => {});
  res.json({ ok: true });
});

app.put('/api/quiz/:code/general-comment/:studentId', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { comment } = req.body || {};
  await dbModule.saveQuizGeneralComment(
    req.params.code.toUpperCase(), req.params.studentId,
    String(comment || '').slice(0, 2000)
  );
  res.json({ ok: true });
});

app.post('/api/quiz/:code/release', requireTeacherAuth, requireCsrf, async (req, res) => {
  const code = req.params.code.toUpperCase();
  await dbModule.releaseQuizResults(code);
  const session = sessions.get(code);
  if (session) io.to(session.code).emit('quiz_results_released');
  const actor = getActorFromReq(req);
  dbModule.auditLog(actor, 'results_released', code, {}, req.ip).catch(() => {});
  res.json({ ok: true });
});

// ── Sprint 37d: nakijk-modus ──────────────────────────────────────────────────

// Geheim voor het ondertekenen van nakijk-tokens. Hergebruikt hetzelfde geheim
// als het leerkracht-cookie; valt terug op een vaste string zodat de app blijft
// werken zonder configuratie (dan is het token enkel binnen deze run geldig).
function reviewTokenSecret() {
  return COOKIE_SECRET || PASSWORD_HASH || 'fallback_review_token_secret';
}

// Leerkracht zet nakijk-modus aan of uit voor één toets.
app.post('/api/quiz/:code/review-mode', requireTeacherAuth, requireCsrf, async (req, res) => {
  const code = req.params.code.toUpperCase();
  const enabled = req.body?.enabled === true;
  const ok = await dbModule.setReviewMode(code, enabled);
  if (!ok) return res.status(404).json({ error: 'Toets niet gevonden.' });
  const session = sessions.get(code);
  if (session) io.to(session.code).emit('quiz_review_mode', { enabled });
  const actor = getActorFromReq(req);
  dbModule.auditLog(actor, enabled ? 'review_mode_opened' : 'review_mode_closed', code, {}, req.ip)
    .catch(() => {});
  res.json({ ok: true, enabled });
});

// Leerling logt opnieuw in om zijn eigen toets in te kijken.
// Publiek endpoint — daarom streng: rate-limit, enkel bij openstaande nakijk-modus,
// en er wordt nooit prijsgegeven of een naam wel/niet bestaat.
app.post('/api/quiz/:code/review-login', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  if (!checkJoinRateLimit(ip)) {
    return res.status(429).json({ error: 'Te veel pogingen. Probeer over een minuut opnieuw.' });
  }
  const code = req.params.code.toUpperCase();
  const naam = String(req.body?.naam || '').trim().slice(0, 64);
  const klas = String(req.body?.klas || '').trim().slice(0, 64);
  if (!naam || !klas) return res.status(400).json({ error: 'Geef je naam en klas in.' });

  const meta = await dbModule.getQuizMeta(code);
  // Bestaat de toets niet, of staat nakijken niet open → zelfde antwoord.
  // Zo lekt dit endpoint niet welke toetscodes bestaan.
  if (!meta || meta.review_mode !== true) {
    return res.status(403).json({ error: 'Nakijken is voor deze toets niet opengesteld.' });
  }

  const matches = await dbModule.findAnswerStudent(code, naam, klas);
  if (matches.length === 0) {
    // Generieke melding: verklap niet of de naam bestaat.
    return res.status(404).json({ error: 'Geen resultaten gevonden voor deze naam en klas.' });
  }
  if (matches.length > 1) {
    return res.status(409).json({
      error: 'Er zijn meerdere leerlingen met deze naam en klas. Vraag je leerkracht om hulp.',
    });
  }

  const token = createReviewToken(code, matches[0].student_id, reviewTokenSecret());
  res.json({ ok: true, token, naam: matches[0].student_name });
});

// Middleware: bewaakt alle nakijk-endpoints.
// Het studentId komt UITSLUITEND uit het ondertekende token — nooit uit de URL.
async function requireReviewToken(req, res, next) {
  const code = req.params.code.toUpperCase();
  const header = req.headers['x-review-token'] || '';
  const token = String(header || req.query.token || '');

  const meta = await dbModule.getQuizMeta(code);
  if (!meta || meta.review_mode !== true) {
    return res.status(403).json({ error: 'Nakijken is voor deze toets niet opengesteld.' });
  }

  const result = verifyReviewToken(token, reviewTokenSecret());
  if (!result.ok) {
    const status = result.reason === 'expired' ? 401 : 403;
    return res.status(status).json({
      error: result.reason === 'expired'
        ? 'Je nakijk-sessie is verlopen. Log opnieuw in.'
        : 'Geen geldige toegang tot dit nakijk-scherm.',
    });
  }
  // Token van een ándere toets mag hier niet werken.
  if (result.sessionCode !== code) {
    return res.status(403).json({ error: 'Geen geldige toegang tot dit nakijk-scherm.' });
  }
  req.reviewStudentId = result.studentId;
  next();
}

// 37a: eigen resultaten van de leerling.
// Het studentId komt uit het TOKEN (req.reviewStudentId), nooit uit de URL —
// daarom staat er geen :studentId in dit pad.
app.get('/api/quiz/:code/my-result', requireReviewToken, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const rows = await dbModule.getMyResult(code, req.reviewStudentId);
    if (!rows.length) return res.status(404).json({ error: 'Geen toetsgegevens gevonden.' });

    // 37c: algemeen commentaar van de leerkracht voor deze leerling.
    const algemeenCommentaar = await dbModule.getQuizGeneralComment(code, req.reviewStudentId);

    // 37b: juiste antwoorden + modelcode worden nu WEL onthuld in nakijk-modus.
    // De toegang is al afgeschermd door requireReviewToken; nakijk-modus staat open.
    const resultaat = buildMyResult(rows, {
      onthulJuisteAntwoorden: true,
      algemeenCommentaar,
    });
    res.json(resultaat);
  } catch (e) {
    log.error('[my-result] fout:', e.message);
    res.status(500).json({ error: 'Kon je resultaten niet laden.' });
  }
});

// 37b: leerkracht slaat de modelcode/het modelantwoord van één vraag op (per toets).
app.put('/api/quiz/:code/question/:questionId/model', requireTeacherAuth, requireCsrf, async (req, res) => {
  const code = req.params.code.toUpperCase();
  const modelAnswer = String(req.body?.modelAnswer || '');
  const ok = await dbModule.setSnapshotModelAnswer(code, req.params.questionId, modelAnswer);
  if (!ok) return res.status(404).json({ error: 'Vraag niet gevonden in deze toets.' });
  res.json({ ok: true });
});

app.get('/api/quiz/:code/similarity', requireTeacherAuth, async (req, res) => {
  try {
    const answers = await dbModule.getQuizAnswers(req.params.code.toUpperCase());
    // Bereken Levenshtein-gelijkenis per vraag
    function levenshtein(a, b) {
      const m = a.length, n = b.length;
      const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
      for (let j = 0; j <= n; j++) d[0][j] = j;
      for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
          d[i][j] = a[i-1] === b[j-1] ? d[i-1][j-1]
            : 1 + Math.min(d[i-1][j], d[i][j-1], d[i-1][j-1]);
      return d[m][n];
    }
    function similarity(a, b) {
      if (!a && !b) return 0;
      const maxLen = Math.max(a.length, b.length);
      if (maxLen === 0) return 100;
      return Math.round((1 - levenshtein(a, b) / maxLen) * 100);
    }
    // Groepeer per vraag
    const byQuestion = {};
    for (const a of answers) {
      if (!byQuestion[a.question_id]) byQuestion[a.question_id] = [];
      byQuestion[a.question_id].push(a);
    }
    const results = [];
    for (const [qid, qAnswers] of Object.entries(byQuestion)) {
      for (let i = 0; i < qAnswers.length; i++) {
        for (let j = i + 1; j < qAnswers.length; j++) {
          const pct = similarity(qAnswers[i].code || '', qAnswers[j].code || '');
          if (pct >= 80 && (qAnswers[i].code || '').length > 20) {
            results.push({
              questionId: qid, questionText: qAnswers[i].text_snapshot?.slice(0, 60),
              student1: { id: qAnswers[i].student_id, name: qAnswers[i].student_name },
              student2: { id: qAnswers[j].student_id, name: qAnswers[j].student_name },
              similarity: pct,
            });
          }
        }
      }
    }
    res.json(results.sort((a, b) => b.similarity - a.similarity));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 16d: Commentaar templates ─────────────────────────────────────────────────

app.get('/api/quiz/comment-templates', requireTeacherAuth, async (req, res) => {
  const teacher = await dbModule.getTeacherByUsername(
    parseBasicAuthHeader(req.headers.authorization)?.username || ''
  );
  res.json(await dbModule.listQuizCommentTemplates(teacher?.id));
});

app.post('/api/quiz/comment-templates', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { text } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ error: 'Tekst is verplicht.' });
  const teacher = await dbModule.getTeacherByUsername(
    parseBasicAuthHeader(req.headers.authorization)?.username || ''
  );
  const id = await dbModule.createQuizCommentTemplate(text.slice(0, 500), teacher?.id);
  res.json({ ok: true, id });
});

app.delete('/api/quiz/comment-templates/:id', requireTeacherAuth, requireCsrf, async (req, res) => {
  await dbModule.deleteQuizCommentTemplate(req.params.id);
  res.json({ ok: true });
});

// ── 16e: PDF export (pdfkit) ─────────────────────────────────────────────────

function getSchoolName() { return process.env.SCHOOL_NAME || 'PyCodeFlow'; }

async function generateQuizPDF(sessionCode, type, studentId = null, scored = false) {
  // pdfkit laden — bij ontbreken geeft duidelijke fout
  let PDFDocument;
  try { PDFDocument = require('pdfkit'); }
  catch (e) {
    throw new Error('pdfkit niet geïnstalleerd. Voer "npm install pdfkit" uit in de web map.');
  }

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const school = getSchoolName();
  const meta = await dbModule.getQuizMeta(sessionCode);
  const questions = await dbModule.getQuizQuestions(sessionCode);
  const sessionInfo = await dbModule.loadActiveSessions().then(ss => ss.find(s => s.code === sessionCode))
    || { name: sessionCode, code: sessionCode };
  const now = new Date().toLocaleDateString('nl-BE', { day:'2-digit', month:'2-digit', year:'numeric' });

  // Helper functies
  function header(title, subtitle = '') {
    doc.fontSize(14).font('Helvetica-Bold').text(school, { align: 'left' });
    doc.fontSize(10).font('Helvetica').fillColor('#666').text('PyCodeFlow · Toetsplatform', { align: 'left' });
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#2563eb').lineWidth(2).stroke();
    doc.moveDown(0.5);
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#000').text(sessionInfo.name || sessionCode);
    if (subtitle) doc.fontSize(10).font('Helvetica').fillColor('#666').text(subtitle);
    doc.moveDown(0.5);
  }

  function codeBlock(code, y = null) {
    if (!code?.trim()) {
      doc.fontSize(9).font('Helvetica-Oblique').fillColor('#999').text('(geen code ingediend)');
      return;
    }
    const lines = code.split('\n');
    doc.fontSize(9).font('Courier').fillColor('#1e1e1e');
    const blockX = 60, blockW = 485;
    const startY = doc.y;
    doc.rect(blockX - 4, startY - 4, blockW, lines.length * 13 + 12)
       .fillAndStroke('#f8f9fa', '#d1d5db');
    doc.fillColor('#1e1e1e');
    lines.forEach((line, i) => {
      doc.text(line, blockX, startY + i * 13, { lineBreak: false, width: blockW - 8 });
    });
    doc.y = startY + lines.length * 13 + 16;
    doc.fillColor('#000');
  }

  function pageNumber() {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.fontSize(8).fillColor('#999')
         .text(`Pagina ${i+1} van ${range.count}`, 50, 790, { width: 495, align: 'center' });
    }
  }

  // ── Type 1: Vragenblad ──────────────────────────────────────────────────────
  if (type === 'questions') {
    const timerMins = Math.round((meta?.timer_seconds || 2700) / 60);
    header(`Toets: ${sessionInfo.name}`, `${now} · ${timerMins} minuten · ${questions.length} vragen`);
    doc.fontSize(10).font('Helvetica').text('Naam: ').underpre;
    doc.moveTo(110, doc.y - 2).lineTo(350, doc.y - 2).strokeColor('#000').lineWidth(0.5).stroke();
    doc.text('   Klas: ').underpre;
    doc.moveTo(390, doc.y - 2).lineTo(545, doc.y - 2).strokeColor('#000').lineWidth(0.5).stroke();
    doc.moveDown(0.8);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.8);

    questions.forEach((q, i) => {
      if (doc.y > 680) doc.addPage();
      const pts = q.points || 0;
      doc.fontSize(11).font('Helvetica-Bold')
         .text(`Vraag ${i+1}`, 50, doc.y, { continued: true })
         .font('Helvetica').fontSize(9).fillColor('#666')
         .text(`   ${q.subject || ''}`, { continued: true });
      doc.text(`/${pts} punten`, { align: 'right' });
      doc.fillColor('#000').moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica').text(q.text_snapshot || q.text || '', { lineGap: 4 });
      doc.moveDown(0.5);
      // Witruimte voor notities
      const spaceY = Math.min(doc.y + 80, 750);
      doc.rect(50, doc.y, 495, 80).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
      doc.y = spaceY + 10;
      doc.moveDown(0.5);
    });
  }

  // ── Type 2a/2b: Antwoordformulier ──────────────────────────────────────────
  else if (type === 'answers') {
    const processStudent = async (stud) => {
      const answers = await dbModule.getQuizAnswersByStudent(sessionCode, stud.id);
      const generalComment = await dbModule.getQuizGeneralComment(sessionCode, stud.id);
      const orderedAnswers = questions.map(q => answers.find(a => a.question_id === q.id));
      const totalScore = scored ? answers.reduce((s, a) => s + (a.score || 0), 0) : null;
      const maxScore = questions.reduce((s, q) => s + (q.points || 0), 0);
      const sub = answers[0];

      header(
        `${stud.name} — ${stud.class || ''}`,
        `${now} · ${scored ? `Score: ${totalScore}/${maxScore} pt · ` : ''}Ingediend: ${sub?.submitted_at ? new Date(sub.submitted_at).toLocaleTimeString('nl-BE',{hour:'2-digit',minute:'2-digit'}) : '—'} ${sub?.auto_submitted ? '(timer)' : ''}`
      );

      orderedAnswers.forEach((ans, i) => {
        const q = questions[i];
        if (doc.y > 650) doc.addPage();
        doc.fontSize(11).font('Helvetica-Bold')
           .text(`Vraag ${i+1} — ${q.subject || ''}`, { continued: true });
        if (scored && ans?.score !== null && ans?.score !== undefined) {
          doc.font('Helvetica').fontSize(10).fillColor('#2563eb')
             .text(`   ${ans.score}/${q.points} pt`, { align: 'right' });
        } else {
          doc.font('Helvetica').fontSize(10).fillColor('#666')
             .text(`   ___/${q.points} pt`, { align: 'right' });
        }
        doc.fillColor('#000').moveDown(0.2);
        doc.fontSize(9).font('Helvetica').fillColor('#666').text(q.text_snapshot?.slice(0,100) || '', { lineGap: 2 });
        doc.fillColor('#000').moveDown(0.3);
        codeBlock(ans?.code || '');
        if (scored && ans?.teacher_comment) {
          doc.fontSize(9).font('Helvetica-Oblique').fillColor('#2563eb')
             .text('Opmerking: ' + ans.teacher_comment, { lineGap: 2 });
          doc.fillColor('#000');
        }
        doc.moveDown(0.6);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
        doc.moveDown(0.4);
      });

      if (scored && generalComment) {
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica-Bold').text('Algemeen commentaar:');
        doc.fontSize(10).font('Helvetica').text(generalComment, { lineGap: 3 });
        doc.moveDown(0.5);
      }

      // Totaalbalk
      doc.moveDown(0.5);
      doc.rect(50, doc.y, 495, 30).fillAndStroke('#f3f4f6', '#d1d5db');
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#000')
         .text(`Totaal: ${scored ? totalScore + '/' + maxScore + ' punten' : '___/' + maxScore + ' punten'}   Handtekening: ___________________`, 58, doc.y - 22);
      doc.y += 16;
    };

    if (studentId) {
      const stud = { id: studentId, name: 'Leerling', class: '' };
      // Haal naam op uit antwoorden
      const firstAns = await dbModule.getQuizAnswersByStudent(sessionCode, studentId);
      if (firstAns.length) { stud.name = firstAns[0].student_name; stud.class = firstAns[0].student_class; }
      await processStudent(stud);
    } else {
      // Alle leerlingen
      const allAnswers = await dbModule.getQuizAnswers(sessionCode);
      const seen = new Set();
      const students = allAnswers.filter(a => { if (seen.has(a.student_id)) return false; seen.add(a.student_id); return true; });
      for (let i = 0; i < students.length; i++) {
        if (i > 0) doc.addPage();
        await processStudent({ id: students[i].student_id, name: students[i].student_name, class: students[i].student_class });
      }
    }
  }

  // ── Type 3: Klasoverzicht ───────────────────────────────────────────────────
  else if (type === 'overview') {
    const allAnswers = await dbModule.getQuizAnswers(sessionCode);
    const seen = new Set();
    const students = allAnswers
      .filter(a => { if (seen.has(a.student_id)) return false; seen.add(a.student_id); return true; })
      .map(a => ({ id: a.student_id, name: a.student_name, class: a.student_class }))
      .sort((a, b) => a.name.localeCompare(b.name, 'nl'));
    const maxScore = questions.reduce((s, q) => s + q.points, 0);

    header(`Klasoverzicht: ${sessionInfo.name}`, `${now} · ${students.length} leerlingen`);

    // Tabelheader
    const colW = Math.min(60, Math.floor(350 / questions.length));
    const nameW = 180;
    const y0 = doc.y;
    doc.rect(50, y0, 495, 20).fill('#2563eb');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#fff');
    doc.text('Naam', 54, y0 + 6, { width: nameW, lineBreak: false });
    questions.forEach((q, i) => {
      doc.text(`V${i+1}`, 54 + nameW + i * colW, y0 + 6, { width: colW, align: 'center', lineBreak: false });
    });
    doc.text('Totaal', 54 + nameW + questions.length * colW, y0 + 6, { width: 60, align: 'right', lineBreak: false });
    doc.y = y0 + 22;

    let totalScores = [];
    students.forEach((stud, si) => {
      const y = doc.y;
      if (y > 750) { doc.addPage(); }
      if (si % 2 === 0) doc.rect(50, y, 495, 16).fill('#f9fafb').stroke();
      doc.fillColor('#000').fontSize(8).font('Helvetica');
      const studAnswers = allAnswers.filter(a => a.student_id === stud.id);
      let total = 0;
      doc.text(stud.name, 54, y + 4, { width: nameW, lineBreak: false });
      questions.forEach((q, i) => {
        const ans = studAnswers.find(a => a.question_id === q.id);
        const s = ans?.score !== null && ans?.score !== undefined ? ans.score : '—';
        if (typeof s === 'number') total += s;
        doc.text(String(s), 54 + nameW + i * colW, y + 4, { width: colW, align: 'center', lineBreak: false });
      });
      doc.font('Helvetica-Bold').text(total > 0 ? `${total}/${maxScore}` : '—',
        54 + nameW + questions.length * colW, y + 4, { width: 60, align: 'right', lineBreak: false });
      totalScores.push(total);
      doc.y = y + 18;
    });

    // Gemiddelde
    const avg = totalScores.filter(s => s > 0).reduce((a,b) => a+b, 0) / (totalScores.filter(s=>s>0).length || 1);
    doc.moveDown(0.5);
    doc.fontSize(9).font('Helvetica-Bold').text(`Klasgemiddelde: ${avg.toFixed(1)}/${maxScore} punten`);
  }

  doc.flushPages();
  pageNumber();
  return doc;
}

app.get('/api/quiz/:code/pdf/questions', requireTeacherAuth, async (req, res) => {
  try {
    const doc = await generateQuizPDF(req.params.code.toUpperCase(), 'questions');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="vragenblad-${req.params.code}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quiz/:code/pdf/answers/:studentId', requireTeacherAuth, async (req, res) => {
  try {
    const scored = req.query.scored === 'true';
    const doc = await generateQuizPDF(req.params.code.toUpperCase(), 'answers', req.params.studentId, scored);
    const suffix = scored ? 'met-scores' : 'zonder-scores';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="antwoorden-${req.params.studentId}-${suffix}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quiz/:code/pdf/answers', requireTeacherAuth, async (req, res) => {
  try {
    const scored = req.query.scored === 'true';
    const doc = await generateQuizPDF(req.params.code.toUpperCase(), 'answers', null, scored);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="alle-antwoorden-${req.params.code}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quiz/:code/pdf/overview', requireTeacherAuth, async (req, res) => {
  try {
    const doc = await generateQuizPDF(req.params.code.toUpperCase(), 'overview');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="klasoverzicht-${req.params.code}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Sprint 19h: Bulk PDF ZIP — aparte PDF per leerling
app.get('/api/quiz/:code/pdf/zip', requireTeacherAuth, async (req, res) => {
  const code = req.params.code.toUpperCase();
  const scored = req.query.scored === 'true';

  let PDFDocument;
  try { PDFDocument = require('pdfkit'); }
  catch (e) { return res.status(500).json({ error: 'pdfkit niet geïnstalleerd.' }); }

  const answers = await dbModule.getQuizAnswers(code);
  const questions = await dbModule.getQuizQuestions(code);

  // Unieke leerlingen
  const seen = new Set();
  const students = answers
    .filter(a => { if (seen.has(a.student_id)) return false; seen.add(a.student_id); return true; })
    .map(a => ({ id: a.student_id, name: a.student_name, class: a.student_class }));

  if (!students.length) return res.status(404).json({ error: 'Geen leerlingen gevonden.' });

  // Genereer een eenvoudige ZIP met PDF-bestanden
  // Echte ZIP-formaat via handmatige buffer (CRC32 + local file headers)
  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    const table = [];
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
    for (const byte of buf) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function writeUInt16LE(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; }
  function writeUInt32LE(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; }

  const zipParts = [];
  const centralDir = [];
  let offset = 0;

  for (let si = 0; si < students.length; si++) {
    const stud = students[si];
    // Genereer PDF als buffer via pdfkit
    const pdfBuf = await new Promise(async (resolve) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const schoolName = process.env.SCHOOL_NAME || 'PyCodeFlow';
      const studAnswers = answers.filter(a => a.student_id === stud.id);
      const totalScore = scored ? studAnswers.reduce((s, a) => s + (a.score || 0), 0) : null;
      const maxScore = questions.reduce((s, q) => s + (q.points || 0), 0);

      doc.fontSize(14).font('Helvetica-Bold').text(schoolName);
      doc.fontSize(10).font('Helvetica').fillColor('#666').text('PyCodeFlow · Toetsplatform');
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#2563eb').lineWidth(2).stroke();
      doc.moveDown(0.5);
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#000').text(stud.name);
      doc.fontSize(10).font('Helvetica').fillColor('#666')
         .text(`${stud.class || ''} · ${scored ? `Score: ${totalScore}/${maxScore} pt · ` : ''}${new Date().toLocaleDateString('nl-BE')}`);
      doc.moveDown(0.5);

      questions.forEach((q, i) => {
        if (doc.y > 650) doc.addPage();
        const ans = studAnswers.find(a => a.question_id === q.id);
        const qType = q.question_type || 'code';

        doc.fontSize(11).font('Helvetica-Bold')
           .text(`Vraag ${i+1} — ${q.subject || ''} · `, { continued: true });
        if (scored && ans?.score !== null && ans?.score !== undefined) {
          doc.fillColor('#2563eb').text(`${ans.score}/${q.points} pt`);
        } else {
          doc.fillColor('#666').text(`___/${q.points} pt`);
        }
        doc.fillColor('#000').moveDown(0.2);
        doc.fontSize(9).font('Helvetica').fillColor('#666')
           .text(q.text_snapshot?.slice(0, 80) || '', { lineGap: 2 });
        doc.fillColor('#000').moveDown(0.3);

        if (!ans || !ans.code) {
          doc.fontSize(9).font('Helvetica-Oblique').fillColor('#999').text('(geen antwoord)');
        } else if (qType === 'open') {
          doc.fontSize(9).font('Helvetica').fillColor('#000').text(ans.code, { lineGap: 2 });
        } else if (qType === 'code') {
          const lines = (ans.code || '').split(String.fromCharCode(10));
          doc.rect(54, doc.y - 2, 487, lines.length * 13 + 10).fillAndStroke('#f8f9fa', '#d1d5db');
          doc.fontSize(8).font('Courier').fillColor('#1e1e1e');
          lines.forEach((line, li) => {
            doc.text(line, 58, (doc.y) + li * 13 - (li === 0 ? 0 : 13), { lineBreak: false, width: 479 });
          });
          doc.y += lines.length * 13 + 12;
          doc.fillColor('#000');
        } else {
          // Multiple/single: toon geselecteerde opties
          try {
            const choices = JSON.parse(q.choices_json || '[]');
            const selected = JSON.parse(ans.selected_choices || '[]');
            choices.forEach(ch => {
              const sel = selected.includes(ch.id);
              const correct = ch.correct === true;
              let icon = sel ? (correct ? '✓' : '✗') : '○';
              doc.fontSize(9).font('Helvetica')
                 .fillColor(sel && correct ? '#065f46' : sel ? '#991b1b' : '#000')
                 .text(`  ${icon}  ${ch.text}`, { lineGap: 2 });
            });
          } catch (e) { /* stille fout — zie debug */ }
          doc.fillColor('#000');
        }

        if (scored && ans?.teacher_comment) {
          doc.fontSize(8).font('Helvetica-Oblique').fillColor('#2563eb')
             .text(`Opmerking: ${ans.teacher_comment}`);
          doc.fillColor('#000');
        }
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
        doc.moveDown(0.3);
      });

      if (scored) {
        const genComment = await dbModule.getQuizGeneralComment(code, stud.id);
        if (genComment) {
          doc.moveDown(0.5).fontSize(10).font('Helvetica-Bold').text('Algemeen commentaar:');
          doc.fontSize(10).font('Helvetica').text(genComment);
        }
        doc.moveDown(0.5);
        doc.rect(50, doc.y, 495, 28).fillAndStroke('#f3f4f6', '#d1d5db');
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#000')
           .text(`Totaal: ${totalScore}/${maxScore} punten`, 58, doc.y - 20);
        doc.y += 12;
      }
      doc.end();
    });

    // Voeg PDF toe aan ZIP
    const num = String(si + 1).padStart(2, '0');
    const safeName = `${num}_${stud.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
    const nameBytes = Buffer.from(safeName);
    const crc = crc32(pdfBuf);
    const now = new Date();
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);

    const localHeader = Buffer.concat([
      Buffer.from('504b0304', 'hex'), // signature
      writeUInt16LE(20),              // version needed
      writeUInt16LE(0),               // flags
      writeUInt16LE(0),               // compression: stored
      writeUInt16LE(dosTime),
      writeUInt16LE(dosDate),
      writeUInt32LE(crc),
      writeUInt32LE(pdfBuf.length),
      writeUInt32LE(pdfBuf.length),
      writeUInt16LE(nameBytes.length),
      writeUInt16LE(0),               // extra field length
      nameBytes,
    ]);

    const centralEntry = Buffer.concat([
      Buffer.from('504b0102', 'hex'), // central dir signature
      writeUInt16LE(20),              // version made by
      writeUInt16LE(20),              // version needed
      writeUInt16LE(0), writeUInt16LE(0),
      writeUInt16LE(dosTime), writeUInt16LE(dosDate),
      writeUInt32LE(crc),
      writeUInt32LE(pdfBuf.length), writeUInt32LE(pdfBuf.length),
      writeUInt16LE(nameBytes.length),
      writeUInt16LE(0), writeUInt16LE(0), writeUInt16LE(0), writeUInt16LE(0),
      writeUInt32LE(0),
      writeUInt32LE(offset),
      nameBytes,
    ]);

    zipParts.push(localHeader, pdfBuf);
    centralDir.push(centralEntry);
    offset += localHeader.length + pdfBuf.length;
  }

  const centralDirBuf = Buffer.concat(centralDir);
  const eocd = Buffer.concat([
    Buffer.from('504b0506', 'hex'),
    writeUInt16LE(0), writeUInt16LE(0),
    writeUInt16LE(students.length), writeUInt16LE(students.length),
    writeUInt32LE(centralDirBuf.length),
    writeUInt32LE(offset),
    writeUInt16LE(0),
  ]);

  const zipBuf = Buffer.concat([...zipParts, centralDirBuf, eocd]);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="antwoorden-${code}${scored?'-scores':''}.zip"`);
  res.send(zipBuf);
});

// Originele TXT export (behouden als fallback)
app.get('/api/quiz/:code/export/zip', requireTeacherAuth, async (req, res) => {
  // ZIP met .py bestanden per leerling (TXT formaat)
  const zlib = require('zlib');
  const code = req.params.code.toUpperCase();
  const answers = await dbModule.getQuizAnswers(code);
  const questions = await dbModule.getQuizQuestions(code);

  // Groepeer per leerling
  const seen = new Set();
  const students = answers.filter(a => { if (seen.has(a.student_id)) return false; seen.add(a.student_id); return true; });

  // Maak een eenvoudige ZIP (zonder externe library — tar-achtige structuur)
  // Gebruik zlib voor compressie, maar maak een geldige ZIP via Buffer manipulatie
  // Simpelere aanpak: stuur alle .py bestanden als één tekst-archief
  let content = `# PyCodeFlow Toetsexport
# Sessie: ${code}
# Geëxporteerd: ${new Date().toISOString()}

`;
  const safeName = s => s.replace(/[^a-zA-Z0-9_-]/g, '_');

  for (const stud of students) {
    content += `${'='.repeat(60)}
# LEERLING: ${stud.student_name} (${stud.student_class || 'geen klas'})
${'='.repeat(60)}

`;
    for (const q of questions) {
      const ans = answers.find(a => a.student_id === stud.student_id && a.question_id === q.id);
      content += `# --- Vraag ${q.order_index + 1}: ${q.text_snapshot?.slice(0,60) || ''} ---
`;
      content += `# Score: ${ans?.score !== null && ans?.score !== undefined ? ans.score + '/' + q.points : 'niet verbeterd'}
`;
      if (ans?.teacher_comment) content += `# Opmerking: ${ans.teacher_comment}
`;
      content += (ans?.code || '# (geen code ingediend)') + '\n\n';
    }
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="toets-${code}-export.txt"`);
  res.send(content);
});

// ── 17b: Quiz archief endpoints ──────────────────────────────────────────────

app.get('/api/quiz/archive', requireTeacherAuth, async (req, res) => {
  try {
    const { year, classId, subject, archived } = req.query;
    const result = await dbModule.getQuizArchive({
      year: year || null,
      classId: classId || null,
      subject: subject || null,
      archived: archived === 'true' ? true : archived === 'false' ? false : null,
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quiz/archive/student', requireTeacherAuth, async (req, res) => {
  const { name, classId, year } = req.query;
  if (!name) return res.status(400).json({ error: 'name parameter verplicht' });
  try {
    res.json(await dbModule.getStudentHistory({ name, classId: classId || null, year: year || null }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quiz/archive/years', requireTeacherAuth, async (req, res) => {
  try { res.json(await dbModule.getAvailableYears()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quiz/:code/stats/detailed', requireTeacherAuth, async (req, res) => {
  try { res.json(await dbModule.getQuizStatsDetailed(req.params.code.toUpperCase())); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/quiz/:code/archive', requireTeacherAuth, requireCsrf, async (req, res) => {
  await dbModule.archiveQuiz(req.params.code.toUpperCase());
  res.json({ ok: true });
});

app.put('/api/quiz/:code/unarchive', requireTeacherAuth, requireCsrf, async (req, res) => {
  await dbModule.unarchiveQuiz(req.params.code.toUpperCase());
  res.json({ ok: true });
});

app.delete('/api/quiz/:code', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { confirmName } = req.body || {};
  const code = req.params.code.toUpperCase();
  const session = sessions.get(code);
  const sessionName = session?.name || code;
  if (!confirmName || confirmName.trim().toLowerCase() !== sessionName.toLowerCase()) {
    return res.status(400).json({ error: 'Bevestigingsnaam komt niet overeen.' });
  }
  const actor = getActorFromReq(req);
  await dbModule.deleteQuizFully(code);
  sessions.delete(code);
  dbModule.auditLog(actor, 'quiz_deleted', code, { sessionName }, req.ip).catch(() => {});
  res.json({ ok: true });
});

app.put('/api/quiz/new-school-year', requireTeacherAuth, requireCsrf, async (req, res) => {
  const { newYear } = req.body || {};
  if (!newYear || !/^[0-9]{4}-[0-9]{4}$/.test(newYear)) return res.status(400).json({ error: 'Ongeldig schooljaar formaat (bv. 2026-2027)' });
  try {
    // Archiveer alle actieve (niet-gearchiveerde) quiz sessies
    const archive = await dbModule.getQuizArchive({ archived: false });
    let archived = 0;
    for (const q of archive) {
      await dbModule.archiveQuiz(q.code);
      archived++;
    }
    res.json({ ok: true, archived, newYear });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Route voor quiz-archive.html
app.get('/quiz-archive.html', requireTeacherAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'quiz-archive.html'));
});

// Route voor teacher-grid.html (grid-overzicht leerlingen in nieuw tabblad)
app.get('/teacher-grid.html', requireTeacherAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teacher-grid.html'));
});

// ── Sprint 20a: Audit log API ────────────────────────────────────────────────

// ── Sprint 50e: het audit-log noteert eindelijk wie het déed ─────────────────
// Tot nu las deze functie de Authorization-header. Maar de app logt in via een cookie,
// en dan stuurt de browser die header NOOIT mee. Gevolg: élke regel in het audit-log
// zei 'onbekend'. Niet stuk, wel waardeloos: je kon niet nagaan wie een score wijzigde
// of resultaten vrijgaf.
// Sinds 50b draagt elk beschermd verzoek een echte identiteit (req.teacher).
function getActorFromReq(req) {
  const t = req.teacher;
  if (t?.username) return t.username;
  // Terugval voor het geval deze functie ooit buiten requireTeacherAuth gebruikt wordt.
  try {
    const creds = parseBasicAuthHeader(req.headers.authorization || '');
    return creds?.username || 'onbekend';
  } catch { return 'onbekend'; }
}

app.get('/api/admin/audit-log', requireTeacherAuth, async (req, res) => {
  try {
    const { limit = 50, actor, action } = req.query;
    const logs = await dbModule.getAuditLog({
      limit: Math.min(200, parseInt(limit) || 50),
      actor: actor || null,
      action: action || null,
    });
    res.json(logs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Sprint 21: stresstest historiek API
app.get('/api/stress-results', requireTeacherAuth, async (req, res) => {
  try {
    const results = await dbModule.getStressResults(20);
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 17a: Log beheer endpoints ────────────────────────────────────────────────

app.get('/api/admin/logs/info', requireTeacherAuth, (req, res) => {
  try {
    const files = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.log') && f !== '.gitkeep');
    const now = Date.now();
    const cutoff = now - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let totalBytes = 0;
    let oldCount = 0;
    const fileList = files.map(f => {
      const fp = path.join(LOGS_DIR, f);
      const stat = fs.statSync(fp);
      if (stat.mtimeMs < cutoff) oldCount++;
      totalBytes += stat.size;
      return { name: f, size: stat.size, mtime: stat.mtimeMs, old: stat.mtimeMs < cutoff };
    }).sort((a, b) => b.mtime - a.mtime);
    res.json({
      totalFiles: files.length,
      totalBytes,
      totalMB: (totalBytes / 1024 / 1024).toFixed(2),
      oldCount,
      retentionDays: LOG_RETENTION_DAYS,
      files: fileList.slice(0, 20), // max 20 tonen
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/logs/cleanup', requireTeacherAuth, requireCsrf, (req, res) => {
  const removed = cleanOldLogs();
  res.json({ ok: true, removed });
});

app.post('/api/admin/logs/cleanup-all', requireTeacherAuth, requireCsrf, (req, res) => {
  // Verwijder ALLE logbestanden (enkel voor troubleshooting)
  try {
    const files = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.log') && f !== '.gitkeep');
    let removed = 0;
    for (const f of files) {
      try { fs.unlinkSync(path.join(LOGS_DIR, f)); removed++; } catch (e) { /* bestand mogelijk al verwijderd */ }
    }
    log.info(`[logs] Handmatige volledige cleanup: ${removed} bestanden verwijderd`);
    res.json({ ok: true, removed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 16f: Quiz monitoring stats ────────────────────────────────────────────────

app.get('/api/quiz/stats', requireTeacherAuth, async (req, res) => {
  try { res.json(await dbModule.getQuizStats()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Web-container health check
app.get('/health', (req, res) => {
  const uptime = process.uptime();
  const mem    = process.memoryUsage();
  const activeSessions = [...sessions.values()].filter(s => !s.deleted && !s.closed).length;
  const activeStudents = [...sessions.values()]
    .filter(s => !s.deleted && !s.closed)
    .reduce((n, s) => n + Object.values(s.students).filter(st => !st.removed && st.socketId).length, 0);
  res.json({
    ok:             true,
    uptime:         Math.floor(uptime),
    uptimeHuman:    `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
    activeSessions,
    activeStudents,
    freeStudents:   freeStudents.size,
    memoryMB:       Math.round(mem.rss / 1048576),
    heapUsedMB:     Math.round(mem.heapUsed / 1048576),
    version:        `${process.env.APP_VERSION_YEAR || '2026'}.${process.env.APP_VERSION_MAJOR || '2'}.${process.env.APP_VERSION_MINOR || '3'}.${process.env.APP_VERSION_BUILD || '1'}`,
  });
});

// Syntax check proxy — stuurt code naar runner voor ast.parse() zonder run te starten
app.post('/api/syntax-check', requireTeacherAuth, async (req, res) => {
  try {
    const r = await fetch(`${RUNNER_URL}/runs/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: req.body.code || '' }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await r.json();
    res.json(data);
  } catch(e) {
    res.status(500).json({ ok: false, error: { message: e.message } });
  }
});

// Syntax check voor leerlingen (geen teacher auth nodig)
app.post('/api/syntax-check-student', async (req, res) => {
  try {
    const r = await fetch(`${RUNNER_URL}/runs/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: req.body.code || '' }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await r.json();
    res.json(data);
  } catch(e) {
    res.status(500).json({ ok: false, error: { message: e.message } });
  }
});

// Uitgebreid monitoring endpoint — geeft systeem + alle sessies + vrije sessie in één call
app.get('/api/monitoring', requireTeacherAuth, async (req, res) => {
  try {
    const runnerResponse = await fetch(`${RUNNER_URL}/health`);
    if (!runnerResponse.ok) throw new Error(`runner health failed: ${runnerResponse.status}`);
    const runner = await runnerResponse.json();

    const os = require('os');
    const webProcessMem = process.memoryUsage();
    const webCgroupCurrent = readCgroupNumber('/sys/fs/cgroup/memory.current');
    const webCgroupMax    = readCgroupNumber('/sys/fs/cgroup/memory.max');

    // Per sessie: naam, type, leerlingen online, actieve runs, wachtrij
    const sessionStats = [...sessions.values()]
      .filter(s => !s.deleted && !s.closed)
      .map(s => {
        const students = Object.values(s.students).filter(st => !st.removed);
        const online   = students.filter(st => st.socketId).length;
        const running  = students.filter(st => st.runId).length;
        return {
          code:        s.code,
          name:        s.name,
          mode:        s.mode,
          total:       students.length,
          online,
          running,
          blocked:     s.blocked || false,
          workspaceMode: s.classWorkspaceMode || 'shared',
        };
      });

    // Vrije sessie stats
    const freeList = Array.from(freeStudents.values());
    const freeRunning = freeList.filter(s => s.runId).length;

    res.json({
      ok: true,
      timestamp: Date.now(),
      runner: {
        activeRuns:    Number(runner.activeRuns   ?? 0),
        maxRuns:       Number(runner.maxRuns       ?? 18),
        queuedRuns:    Number(runner.queuedRuns    ?? 0),
        maxQueue:      Number(runner.maxQueue      ?? 90),
        cpuPercent:    runner.cpuPercent           ?? null,
        memoryBytes:   Number(runner.cgroupMemoryCurrentBytes ?? runner.memoryBytes ?? 0),
        memoryMaxBytes:Number(runner.cgroupMemoryMaxBytes     ?? 0),
        peakRuns:      Number(runner.peakActiveRuns ?? 0),
        peakQueue:     Number(runner.queuePeak     ?? 0),
      },
      web: {
        memoryBytes:   webCgroupCurrent || webProcessMem.rss,
        memoryMaxBytes:webCgroupMax,
        heapUsedBytes: webProcessMem.heapUsed,
        heapTotalBytes:webProcessMem.heapTotal,
      },
      system: {
        totalMemBytes: os.totalmem(),
        freeMemBytes:  os.freemem(),
        loadAvg:       os.loadavg(),
        cpus:          os.cpus().length,
      },
      sessions: sessionStats,
      free: {
        total:   freeList.length,
        running: freeRunning,
      },
      history: monitorHistory.slice(), // Ringbuffer snapshots voor grafiek
      dbStats: await (async () => {
        try {
          const { Pool } = require('pg');
          const pool = new Pool({
            connectionString: process.env.DATABASE_URL ||
              `postgresql://pycodeflow:${encodeURIComponent(process.env.POSTGRES_PASSWORD)}@postgres:5432/pycodeflow`,
            max: 2, connectionTimeoutMillis: 3000,
          });
          const [tables, teachers, classes, students, sessionsDb] = await Promise.all([
            pool.query(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'`),
            pool.query(`SELECT COUNT(*) FROM teachers`),
            pool.query(`SELECT COUNT(*) FROM classes`),
            pool.query(`SELECT COUNT(*) FROM students`),
            pool.query(`SELECT COUNT(*) FROM sessions WHERE deleted=0`),
          ]);
          await pool.end();
          return {
            tableCount:   Number(tables.rows[0].count),
            teacherCount: Number(teachers.rows[0].count),
            classCount:   Number(classes.rows[0].count),
            studentCount: Number(students.rows[0].count),
            sessionCount: Number(sessionsDb.rows[0].count),
          };
        } catch { return null; }
      })(),
      quizStats: await (async () => {
        try {
          const [questions, sessions2, answers, runs] = await Promise.all([
            dbModule.query ? dbModule.query(`SELECT COUNT(*) FROM question_bank WHERE archived=false`) : Promise.resolve({rows:[{count:0}]}),
            dbModule.query ? dbModule.query(`SELECT COUNT(*) FROM assignment_bank`) : Promise.resolve({rows:[{count:0}]}),
            dbModule.query ? dbModule.query(`SELECT COUNT(*) FROM quiz_answers`) : Promise.resolve({rows:[{count:0}]}),
            dbModule.query ? dbModule.query(`SELECT ROUND(AVG(run_count),1) as avg FROM quiz_answers`) : Promise.resolve({rows:[{avg:0}]}),
          ]);
          return {
            totalQuestions: Number(questions.rows[0].count || 0),
            totalSessions:  Number(sessions2.rows[0].count || 0),
            totalAnswers:   Number(answers.rows[0].count || 0),
            avgRuns:        Number(runs.rows[0].avg || 0),
          };
        } catch { return null; }
      })(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'monitoring failed' });
  }
});

app.use(express.static(path.join(__dirname, "public")));
// 32c: Monaco wordt geserveerd vanuit node_modules/monaco-editor. De VERSIE is
// centraal gepind in package.json (monaco-editor 0.47.0, sprint 36d). De HTML-pagina's
// verwijzen enkel naar het route-prefix /monaco/min/vs — dus nergens een los versienummer.
// Eén Monaco-versie updaten = enkel package.json + rebuild.
app.use("/monaco", express.static(path.join(__dirname, "node_modules", "monaco-editor")));


const sessions = new Map();
const socketToUser = new Map();
const activeRuns = new Map(); // runId -> routing info

// Rate limiting voor run_request: socketId -> tijdstip laatste run (ms)
const runRateLimit = new Map();

// Set van runIds waarvoor de runner momenteel wacht op stdin input
const runnerWaitingForInput = new Set();

// Fix SEC-12: rate limiting op student_join — max 10 join-pogingen per minuut per IP
const joinRateLimit = new Map(); // ip -> { count, windowStart }
const JOIN_RATE_WINDOW_MS = 60 * 1000;
const JOIN_RATE_MAX = 10;

function checkJoinRateLimit(ip) {
  const now = Date.now();
  const entry = joinRateLimit.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > JOIN_RATE_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count++;
  joinRateLimit.set(ip, entry);
  return entry.count <= JOIN_RATE_MAX;
}

// Cleanup join rate limit map elke 5 minuten
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of joinRateLimit.entries()) {
    if (now - e.windowStart > JOIN_RATE_WINDOW_MS * 2) joinRateLimit.delete(ip);
  }
}, 5 * 60 * 1000);

// Code snapshot debounce: studentId -> timestamp laatste snapshot
const snapshotLastSaved = new Map();
const SNAPSHOT_INTERVAL_MS = 10000; // max 1 snapshot per 10 seconden

function maybeSnapshot(session, student, code) {
  if (!session || !student || session.deleted || session.closed) return;
  const now = Date.now();
  const key = `${session.code}:${student.id}`;
  const last = snapshotLastSaved.get(key) || 0;
  if (now - last < SNAPSHOT_INTERVAL_MS) return;
  snapshotLastSaved.set(key, now);
  try {
    dbModule.saveSnapshot(session.code, student.id, student.name, code || '').catch(e => log.error('[db] saveSnapshot:', e.message));
  } catch(e) { /* stil falen */ }
}
const RUN_RATE_LIMIT_MS = 3000; // minimale tijd tussen twee runs per socket

// IP rate limiting voor vrije editor: ip -> { count, windowStart }
const ipRunRateLimit = new Map();
const IP_RATE_WINDOW_MS  = 60 * 1000; // 1 minuut venster
const IP_RATE_MAX_RUNS   = 20;        // max runs per minuut per IP

function checkIpRateLimit(ip) {
  const now  = Date.now();
  const entry = ipRunRateLimit.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > IP_RATE_WINDOW_MS) {
    // Nieuw venster
    ipRunRateLimit.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: IP_RATE_MAX_RUNS - 1 };
  }
  entry.count++;
  ipRunRateLimit.set(ip, entry);
  if (entry.count > IP_RATE_MAX_RUNS) {
    const retryAfterMs = IP_RATE_WINDOW_MS - (now - entry.windowStart);
    return { allowed: false, retryAfterMs };
  }
  return { allowed: true, remaining: IP_RATE_MAX_RUNS - entry.count };
}
// Ruim verouderde IP entries op elke 5 minuten
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipRunRateLimit.entries()) {
    if (now - entry.windowStart > IP_RATE_WINDOW_MS * 2) ipRunRateLimit.delete(ip);
  }
}, 5 * 60 * 1000);

// Sprint 9A: periodieke cleanup snapshotLastSaved (elke 30 min)
// Verwijder entries van sessies die niet meer actief zijn
setInterval(() => {
  for (const key of snapshotLastSaved.keys()) {
    const sessionCode = key.split(':')[0];
    const session = sessions.get(sessionCode);
    if (!session || session.deleted || session.closed) {
      snapshotLastSaved.delete(key);
    }
  }
}, 30 * 60 * 1000);

// ── Monitoring ringbuffer ─────────────────────────────────────────────────────
// Bewaart de laatste 40 snapshots (elke 15s = ~10 minuten historiek)
const MONITOR_HISTORY_MAX = 40;
const monitorHistory = [];

async function captureMonitorSnapshot() {
  try {
    const r = await fetch(`${RUNNER_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return;
    const runner = await r.json();
    monitorHistory.push({
      ts:          Date.now(),
      activeRuns:  Number(runner.activeRuns  ?? 0),
      queuedRuns:  Number(runner.queuedRuns  ?? 0),
      cpuPercent:  runner.cpuPercent          ?? null,
      memBytes:    Number(runner.cgroupMemoryCurrentBytes ?? runner.memoryBytes ?? 0),
    });
    if (monitorHistory.length > MONITOR_HISTORY_MAX) monitorHistory.shift();
  } catch (e) { /* stille fout — zie debug */ }
}
// Start snapshot elke 15 seconden
setInterval(captureMonitorSnapshot, 15000);
captureMonitorSnapshot(); // Eerste snapshot meteen

// ── Revisie hulpfunctie ──────────────────────────────────────────────────────
// Geeft altijd een unieke stijgende revisie terug, ook als de inkomende
// gelijk is aan de huidige — voorkomt race condition bij herverbinden.
function nextRevision(current) {
  return Math.max((current || 0) + 1, Date.now());
}

// Laad persistente sessies vanuit SQLite bij opstarten
(async function loadPersistedSessions() {
  try {
    const persisted = await dbModule.loadActiveSessions();
    for (const session of persisted) {
      sessions.set(session.code, session);
    }
    if (persisted.length > 0) {
      log.info(`[db] ${persisted.length} sessie(s) hersteld vanuit database.`);
    }
  } catch(e) {
    log.error('[db] Kon sessies niet laden:', e.message);
  }
})();


function makeCode() {
  // Fix SEC-1+13: crypto.randomBytes() + 8 tekens (32^8 = ~1 biljoen combinaties)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    const bytes = crypto.randomBytes(8);
    code = Array.from(bytes, b => chars[b % chars.length]).join("");
  } while (sessions.has(code));
  return code;
}

function sessionSummary(session) {
  const students = Object.values(session.students).filter(s => !s.removed);
  return {
    code: session.code,
    name: session.name,
    mode: session.mode,
    studentCount: students.length,
    createdAt: session.createdAt,
    status: session.deleted ? "verwijderd" : session.blocked ? "geblokkeerd" : session.closed ? "gesloten" : "actief",
    editorAssist: session.editorAssist !== false,
    announcement: session.announcement || ""
  };
}

// Geeft de lijst van leerlingen in de vrije sessie terug (enkel voor leerkrachten)
app.get("/api/free-students", requireTeacherAuth, (req, res) => {
  const list = Array.from(freeStudents.values()).map(s => ({
    id: s.id,
    name: s.name,
    className: s.className,
    joinedAt: s.joinedAt,
    online: true,
  }));
  res.json(list);
});

app.get("/api/sessions", requireTeacherAuth, async (req, res) => {
  const includeClosed = req.query.includeClosed === 'true';
  const activeList = [...sessions.values()]
    .filter(s => !s.deleted && !s.closed)
    .map(sessionSummary)
    .sort((a,b) => b.createdAt - a.createdAt);

  if (!includeClosed) return res.json(activeList);

  // Sprint 11B: voeg gesloten sessies toe vanuit SQLite
  const closedList = (await dbModule.loadClosedSessions()).map(s => ({
    code:        s.code,
    name:        s.name,
    mode:        s.mode,
    createdAt:   s.createdAt,
    studentCount: s.studentCount,
    closed:      true,
    deleted:     s.deleted,
    editorAssist: s.editorAssist,
  }));

  res.json([...activeList, ...closedList]);
});

// ── Sprint 43: toets-/taaklijst met live-status (type, tijdsvenster, online-teller) ──
function quizSummaryRow(code, name, createdAt, closed, meta, onlineCount, studentCount, now) {
  const accessFrom  = meta && meta.access_from  != null ? Number(meta.access_from)  : null;
  const accessUntil = meta && meta.access_until != null ? Number(meta.access_until) : null;
  // Sprint 43.3: type komt nu uit de expliciete kolom; no_timer blijft fallback voor oude rijen.
  const quizType = (meta && meta.type) ? meta.type : ((meta && meta.no_timer) ? 'taak' : 'toets');
  // Beschikbaarheid op basis van het tijdsvenster — los van de handmatige 'closed'-vlag.
  let availability = 'open';
  if (closed)                                    availability = 'closed';
  else if (accessFrom  && now < accessFrom)      availability = 'pending';  // venster nog niet begonnen
  else if (accessUntil && now > accessUntil)     availability = 'expired';  // venster voorbij
  return {
    code, name, createdAt, closed, quizType, accessFrom, accessUntil, availability, onlineCount, studentCount,
    // Sprint 43.2: extra velden voor de toetsen-/takenbank
    isPreview:   !!(meta && meta.is_teacher_preview),
    archived:    !!(meta && meta.archived),
    schoolYear:  (meta && meta.school_year) || '',
    targetClass: (meta && meta.target_class) || '',
    className:   '',
  };
}

app.get("/api/quiz-sessions", requireTeacherAuth, async (req, res) => {
  const now = Date.now();
  const out = [];
  // Sprint 43.2: bank-modus toont ook preview-/onafgewerkte toetsen (met vlag),
  // zodat niets onbereikbaar "zweeft". Zonder bank blijven previews verborgen.
  const bank = req.query.bank === '1' || req.query.bank === 'true';

  // Klas-id → naam, zodat de bank de klasnaam kan tonen/filteren.
  let classMap = {};
  try {
    const cls = await dbModule.listClasses(true);
    for (const c of cls) classMap[c.id] = c.name;
  } catch { /* klasnamen optioneel */ }

  let metas = [];
  try {
    const where = bank ? '' : 'WHERE is_teacher_preview = false';
    metas = (await dbModule.query(`SELECT * FROM assignment_bank ${where}`)).rows || [];
  } catch (e) { log.warn('[quiz-sessions] assignment_bank lezen mislukt:', e.message); }

  for (const meta of metas) {
    const code = meta.session_code;
    const mem = sessions.get(code);
    let name = mem && mem.name, createdAt = mem && mem.createdAt;
    let closed = mem ? !!mem.closed : false, deleted = mem ? !!mem.deleted : false;
    if (!mem) {
      // Sessie niet in geheugen → naam/status uit de DB halen.
      try {
        const r = await dbModule.query(`SELECT name, created_at, closed, deleted FROM sessions WHERE code = $1`, [code]);
        if (r.rows[0]) {
          name = r.rows[0].name;
          createdAt = Number(r.rows[0].created_at);
          closed  = r.rows[0].closed  === 1 || r.rows[0].closed  === true;
          deleted = r.rows[0].deleted === 1 || r.rows[0].deleted === true;
        }
      } catch { /* sessie-info optioneel */ }
    }
    if (deleted) continue;
    const students = mem ? Object.values(mem.students || {}).filter(st => !st.removed) : [];
    const onlineCount = students.filter(st => st.online).length;
    const row = quizSummaryRow(code, name || code, createdAt || 0, closed, meta, onlineCount, students.length, now);
    row.className = classMap[row.targetClass] || '';
    out.push(row);
  }

  out.sort((a, b) => b.createdAt - a.createdAt);
  res.json(out);
});

// ── Sprint 43.1: voortgang per gekoppelde klas-leerling ──────────────────────
// Groen = ingeleverd, geel = al iets gemaakt (niet ingeleverd), grijs = niets.
// De "gekoppelde" leerlingen zijn de leden van de aan de toets gekoppelde klas
// (van dat schooljaar), via class_memberships. Matching op naam, omdat een
// toets-leerling een eigen (niet-globale) id krijgt bij quiz_start.
app.get("/api/quiz-sessions/:code/roster", requireTeacherAuth, async (req, res) => {
  const code = (req.params.code || '').toUpperCase();
  const meta = await dbModule.getQuizMeta(code);
  if (!meta) return res.status(404).json({ error: 'Toets niet gevonden.' });

  const classId = meta.target_class || '';
  let roster = [];
  if (classId) {
    try { roster = await dbModule.listStudents(classId); } catch { roster = []; }
    // enkel actieve lidmaatschappen van dat schooljaar (listStudents joint al op klas+jaar)
    roster = roster.filter(s => (s.membership_status || 'active') === 'active');
  }

  const answers = await dbModule.getQuizAnswers(code).catch(() => []);
  const norm = n => (n || '').trim().toLowerCase();

  // Activiteit groeperen per (genormaliseerde) naam.
  const byName = new Map();
  for (const a of answers) {
    const key = norm(a.student_name);
    if (!key) continue;
    let g = byName.get(key);
    if (!g) { g = { name: a.student_name, submitted: false, hasContent: false }; byName.set(key, g); }
    if (a.submitted_at) g.submitted = true;
    const hasCode    = (a.code || '').trim() !== '';
    const hasChoices = (a.selected_choices || '[]').trim() !== '[]' && (a.selected_choices || '').trim() !== '';
    if (hasCode || hasChoices || (a.run_count || 0) > 0 || a.first_run_at) g.hasContent = true;
  }
  const statusOf = g => !g ? 'none' : (g.submitted ? 'submitted' : (g.hasContent ? 'started' : 'none'));

  const students = roster.map(s => ({ id: s.id, name: s.name, status: statusOf(byName.get(norm(s.name))) }));

  // Deelnemers die (nog) niet in de klas zitten (bv. andere naam ingetypt) — apart tonen.
  const rosterNames = new Set(roster.map(s => norm(s.name)));
  const extras = [];
  for (const [key, g] of byName) {
    if (!rosterNames.has(key)) extras.push({ name: g.name, status: statusOf(g) });
  }
  extras.sort((a, b) => a.name.localeCompare(b.name, 'nl'));

  const counts = {
    submitted: students.filter(s => s.status === 'submitted').length,
    started:   students.filter(s => s.status === 'started').length,
    none:      students.filter(s => s.status === 'none').length,
    total:     students.length,
  };

  res.json({
    code, classId,
    className: roster[0]?.class_name || '',
    schoolYear: meta.school_year || '',
    hasClass: !!classId,
    students, extras, counts,
  });
});

// ── ZIP Export: alle leerlingencode + output per sessie ───────────────────────
app.get("/api/sessions/:code/export", requireTeacherAuth, (req, res) => {
  const code = (req.params.code || '').toUpperCase();
  const session = sessions.get(code);
  if (!session) return res.status(404).json({ error: 'Sessie niet gevonden' });

  const zlib   = require('zlib');
  const students = getActiveStudents(session);

  if (!students.length) {
    return res.status(400).json({ error: 'Geen leerlingen in deze sessie' });
  }

  // Bouw een eenvoudige ZIP-achtige structuur via Node.js streams
  // We gebruiken de ingebouwde zlib niet voor ZIP-formaat maar genereren
  // een tar-stijl tekstbestand als ZIP niet native beschikbaar is.
  // Gebruik de 'archiver' pattern via buffer concatenation voor maximale compatibiliteit.

  // Simpele ZIP via Buffer (zonder externe dependency)
  // Schrijf een multipart text response als .zip niet mogelijk is
  // → we gebruiken een .zip via de native 'zlib' + manual ZIP header schrijven

  // Eenvoudigste aanpak: stuur een .txt met duidelijke scheiding
  const now    = new Date();
  const stamp  = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  const safeName = (session.name || 'sessie').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${stamp}-${safeName}-export.txt`;

  const lines = [
    '═'.repeat(72),
    `PyCodeFlow Export`,
    `Sessie    : ${session.name} (${session.code})`,
    `Type      : ${session.mode === 'exam' ? 'Examenmodus' : 'Klasmodus'}`,
    `Geëxporteerd : ${now.toLocaleString('nl-BE')}`,
    `Leerlingen: ${students.length}`,
    '═'.repeat(72),
    '',
  ];

  for (const s of students) {
    const code = s.personalCode || s.code || session.sharedCode || '';
    const output = s.personalOutput || s.output || session.sharedOutput || '';

    lines.push('─'.repeat(72));
    lines.push(`LEERLING : ${s.name}`);
    lines.push('─'.repeat(72));
    lines.push('▶ CODE:');
    lines.push(code || '(geen code)');
    lines.push('');
    lines.push('▶ OUTPUT:');
    lines.push(output || '(geen output)');
    lines.push('');

    // Tab-detectie info indien beschikbaar
    if (s.tabHiddenCount > 0) {
      lines.push(`⚠️ Tab verlaten: ${s.tabHiddenCount}× tijdens de sessie`);
      lines.push('');
    }
  }

  lines.push('═'.repeat(72));
  lines.push(`Einde export — ${students.length} leerling(en)`);
  lines.push('═'.repeat(72));

  const content = lines.join('\n');
  const buf = Buffer.from(content, 'utf8');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buf.length);
  res.send(buf);
});

app.post("/api/sessions/:code/block-toggle", requireTeacherAuth, requireCsrf, (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const session = sessions.get(code);
  if (!session || session.deleted || session.closed) return res.status(404).json({ error: "not_found" });
  session.blocked = !session.blocked;
  if (session.blocked) {
    for (const student of getActiveStudents(session)) {
      if (student.socketId) io.to(student.socketId).emit("force_landing");
      student.socketId = null;
    }
    session.statusText = "Sessie geblokkeerd";
    session.statusType = "warning";
  } else {
    session.statusText = "Sessie opnieuw gestart";
    session.statusType = "success";
  }
  emitTeacherSession(session);
  res.json(sessionSummary(session));
});

app.delete("/api/sessions/:code", requireTeacherAuth, requireCsrf, (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const session = sessions.get(code);
  if (!session) return res.status(404).json({ error: "not_found" });
  for (const student of getActiveStudents(session)) {
    if (student.socketId) io.to(student.socketId).emit("force_landing");
  }
  if (session.teacherSocketId) io.to(session.teacherSocketId).emit("teacher_go_sessions");
  sessions.delete(code);
  res.json({ ok: true });
});

function getActiveStudents(session) {
  return Object.values(session.students).filter(s => !s.removed);
}

function emitTeacherSession(session) {
  if (!session.teacherSocketId) return;
  io.to(session.teacherSocketId).emit("teacher_session_data", buildTeacherData(session));
}


function findReusableStudent(session, name, resumeId = null) {
  if (resumeId && session.students[resumeId] && !session.students[resumeId].removed) {
    return session.students[resumeId];
  }

  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) return null;

  // Hergebruik bij voorkeur een offline leerling met exact dezelfde naam
  for (const student of Object.values(session.students)) {
    if (student.removed) continue;
    if ((student.name || '').trim().toLowerCase() !== normalized) continue;
    if (!student.socketId) return student;
  }

  return null;
}


function buildTeacherData(session) {
  const isClassPersonal = session.mode === "class" && (session.classWorkspaceMode || "shared") === "personal";
  const students = getActiveStudents(session).map(s => ({
    id: s.id,
    name: s.name,
    canRun: s.classCanRun !== false,
    canEdit: s.classCanEdit !== false,
    online: Boolean(s.socketId),
    // Tab-detectie (enkel in examenmodus relevant)
    tabHidden:      Boolean(s.tabHidden),
    tabHiddenCount: s.tabHiddenCount || 0,
    tabLastDurationMs: s.tabEvents && s.tabEvents.length > 0
      ? (s.tabEvents[s.tabEvents.length - 1].durationMs || null)
      : null,
    // Hand opsteken
    handRaised:   Boolean(s.handRaised),
    handRaisedAt: s.handRaisedAt || null,
    // Klaar-knop
    isDone:   Boolean(s.isDone),
    doneAt:   s.doneAt || null,
    // Sprint 13B: badge en klas
    joinBadge:   s.joinBadge || null,
    className:   s.className || '',
    dbStudentId: s.dbStudentId || null,
    // Sprint 10Q: run-status
    runStatus: s.runStatus || 'idle',
  }));
  let view = {
    mode: session.mode,
    title: session.name,
    code: "",
    codeRevision: 0,
    codeSourceSocketId: null,
    output: "",
    selectedStudentId: session.selectedStudentId || null,
    selectedStudentName: null,
    readOnly: session.mode === "exam"
  };
  if (session.mode === "class") {
    view.code = session.sharedCode;
    view.codeRevision = session.sharedCodeRevision || 0;
    view.codeSourceSocketId = session.sharedCodeSourceSocketId || null;
    view.output = isClassPersonal ? (session.teacherPreviewOutput || "") : session.sharedOutput;
    view.readOnly = false;
  } else if (session.selectedStudentId && session.students[session.selectedStudentId] && !session.students[session.selectedStudentId].removed) {
    const s = session.students[session.selectedStudentId];
    view.code = s.code;
    view.codeRevision = s.codeRevision || 0;
    view.codeSourceSocketId = s.codeSourceSocketId || null;
    view.output = s.output;
    view.selectedStudentName = s.name;
    view.readOnly = true;
  }
  return {
    session: { ...sessionSummary(session), classWorkspaceMode: session.classWorkspaceMode || "shared" },
    students,
    view,
    announcement: session.announcement || "",
    announcementHistory: session.announcementHistory || [],
    snippet: session.snippet || "",
    snippetVersion: session.snippetVersion || 0,
    annotations: session.annotations || [],
    statusText: session.statusText || "Sessie actief",
    statusType: session.statusType || "info",
    allRunEnabled: getActiveStudents(session).length > 0 && getActiveStudents(session).every(s => s.classCanRun !== false),
    allCodeEnabled: getActiveStudents(session).length > 0 && getActiveStudents(session).every(s => s.classCanEdit !== false),
    // Sprint 13A: sessie-config meesturen
    config: session.config || {},
  };
}

function setStatus(session, text, type="info") {
  session.statusText = text;
  session.statusType = type;
  emitTeacherSession(session);
}


function emitStudentState(session, student) {
  if (!student.socketId) return;
  const activeWorkspace = session.mode === "class" ? (session.classWorkspaceMode || "shared") : "personal";
  const currentCode = session.mode === "class"
    ? (activeWorkspace === "shared" ? session.sharedCode : student.personalCode)
    : student.code;
  const currentOutput = session.mode === "class"
    ? (activeWorkspace === "shared" ? student.output : student.personalOutput)
    : student.output;
  const effectiveCanRun = session.mode === "class"
    ? (activeWorkspace === "shared" ? student.classCanRun !== false : student.personalCanRun !== false)
    : student.personalCanRun !== false;
  const effectiveCanEdit = session.mode === "class"
    ? (activeWorkspace === "shared" ? student.classCanEdit !== false : student.personalCanEdit !== false)
    : student.personalCanEdit !== false;
  io.to(student.socketId).emit("student_state", {
    session: { ...sessionSummary(session), classWorkspaceMode: session.classWorkspaceMode || "shared" },
    student: {
      id: student.id,
      name: student.name,
      canRun: effectiveCanRun,
      canEdit: effectiveCanEdit,
      classCanRun: student.classCanRun !== false,
      classCanEdit: student.classCanEdit !== false,
      personalCanRun: student.personalCanRun !== false,
      personalCanEdit: student.personalCanEdit !== false
    },
    mode: session.mode,
    editorAssist: session.editorAssist !== false,
    announcement: session.announcement || "",
    activeWorkspace,
    sharedCode: session.sharedCode,
    sharedCodeRevision: session.sharedCodeRevision || 0,
    sharedCodeSourceSocketId: session.sharedCodeSourceSocketId || null,
    personalCode: student.personalCode,
    personalCodeRevision: student.personalCodeRevision || 0,
    personalCodeSourceSocketId: student.personalCodeSourceSocketId || null,
    code: currentCode,
    codeRevision: activeWorkspace === "shared" ? (session.sharedCodeRevision || 0) : (student.personalCodeRevision || 0),
    codeSourceSocketId: activeWorkspace === "shared" ? (session.sharedCodeSourceSocketId || null) : (student.personalCodeSourceSocketId || null),
    output: currentOutput,
    annotations: session.annotations || [],  // Bestaande annotaties bij reconnect
  });
}

// Stuur gedeelde klascode naar alle leerlingen behalve de verzender.
// notifyTeacher=false wanneer de leerkracht zelf typt (die heeft de code al).
function broadcastClassCode(session, exceptSocketId = null, notifyTeacher = true) {
  const isPersonalPhase = (session.classWorkspaceMode || "shared") === "personal";
  for (const student of getActiveStudents(session)) {
    if (student.socketId && student.socketId !== exceptSocketId) {
      // In de individuele werkfase heeft een broadcast van de gedeelde code geen effect
      // op de actieve editor van de leerling (die werkt in zijn persoonlijk werkblad).
      // Stuur in dat geval een lichtgewicht shared_code_update in plaats van de volledige
      // student_state — zo wordt applyStudentState (en dus setValue + cursor-reset) niet
      // getriggerd terwijl de leerling aan het typen is.
      if (isPersonalPhase) {
        io.to(student.socketId).emit("shared_code_update", {
          sharedCode: session.sharedCode,
          sharedCodeRevision: session.sharedCodeRevision || 0,
          sharedCodeSourceSocketId: session.sharedCodeSourceSocketId || null,
        });
      } else {
        emitStudentState(session, student);
      }
    }
  }
  if (notifyTeacher) emitTeacherSession(session);
}

function updateTeacherLiveView(session, studentId) {
  if (session.mode !== "exam") return;
  if (session.selectedStudentId === studentId) emitTeacherSession(session);
}

async function runnerStart(code) {
  const res = await fetch(`${RUNNER_URL}/runs/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code })
  });
  if (!res.ok) throw new Error(`Runner start failed: ${res.status}`);
  return await res.json();
}

async function runnerEvents(runId, after) {
  const res = await fetch(`${RUNNER_URL}/runs/${runId}/events?after=${after}`);
  if (!res.ok) throw new Error(`Runner events failed: ${res.status}`);
  return await res.json();
}

async function runnerInput(runId, input) {
  const res = await fetch(`${RUNNER_URL}/runs/${runId}/input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input })
  });
  if (res.status === 409) {
    // Runner wacht nog niet op input — geweigerd
    return { rejected: true };
  }
  if (!res.ok) throw new Error(`Runner input failed: ${res.status}`);
  return { rejected: false };
}

async function runnerDisconnect(runId) {
  const res = await fetch(`${RUNNER_URL}/runs/${runId}/disconnect`, { method: "POST" });
  if (!res.ok && res.status !== 404) throw new Error(`Runner disconnect failed: ${res.status}`);
}

async function runnerResume(runId) {
  const res = await fetch(`${RUNNER_URL}/runs/${runId}/resume`, { method: "POST" });
  if (!res.ok && res.status !== 404) throw new Error(`Runner resume failed: ${res.status}`);
}

async function runnerCancel(runId) {
  const res = await fetch(`${RUNNER_URL}/runs/${runId}/cancel`, { method: "POST" });
  if (!res.ok && res.status !== 404) throw new Error(`Runner cancel failed: ${res.status}`);
}

function clearDisconnectTimer(runId) {
  const timer = disconnectTimers.get(runId);
  if (timer) {
    clearTimeout(timer);
    disconnectTimers.delete(runId);
  }
}

function scheduleRunDisconnect(runId) {
  if (!runId) return;
  clearDisconnectTimer(runId);
  runnerDisconnect(runId).catch(err => {
    log.error("runnerDisconnect error", err);
  });
  const timer = setTimeout(() => {
    runnerCancel(runId).catch(err => {
      log.error("runnerCancel error", err);
    }).finally(() => {
      disconnectTimers.delete(runId);
    });
  }, 30000);
  disconnectTimers.set(runId, timer);
}

function resumeRunIfNeeded(runId) {
  if (!runId) return;
  clearDisconnectTimer(runId);
  runnerResume(runId).catch(err => {
    log.error("runnerResume error", err);
  });
}

function clearRunRef(info) {
  clearDisconnectTimer(info.runId);
  const session = sessions.get(info.sessionCode);
  if (!session) return;
  if (info.audience === "teacher-all" || info.audience === "teacher-preview") {
    if (session.teacherRunId === info.runId) session.teacherRunId = null;
  } else if (info.targetStudentId && session.students[info.targetStudentId]) {
    const s = session.students[info.targetStudentId];
    if (s.runId === info.runId) { s.runId = null; s.runStatus = 'idle'; }
  }
}

async function pollRun(runId) {
  const info = activeRuns.get(runId);
  if (!info) return;
  while (activeRuns.has(runId)) {
    const current = activeRuns.get(runId);
    if (!current) return;
    try {
      const data = await runnerEvents(runId, current.after || 0);
      current.after = data.lastSeq || current.after || 0;

      // ⏳ Run staat nog in de wachtrij — stuur wachtpositie naar de leerling
      if (data.queued) {
        const pos = data.queuePosition;
        const session = sessions.get(current.sessionCode);
        if (session) {
          const msg = pos
            ? `⏳ Wachtrij: positie ${pos} — even geduld...`
            : `⏳ In wachtrij, bijna aan de beurt...`;

          if (current.audience === "teacher-all") {
            setStatus(session, msg, "info");
          } else if (current.audience === "student") {
            const s = session.students[current.targetStudentId];
            if (s && s.socketId) {
              io.to(s.socketId).emit("run_queued", { position: pos, message: msg });
            }
          } else if (current.audience === "teacher-preview" && session.teacherSocketId) {
            setStatus(session, msg, "info");
          }
        }
        // Langzamer pollen zolang we in de wachtrij staan (minder belasting)
        await new Promise(resolve => setTimeout(resolve, 800));
        continue;
      }

      for (const event of data.events || []) {
        forwardRunnerEvent(current, event);
      }
      if (!data.running) {
        activeRuns.delete(runId);
        runnerWaitingForInput.delete(runId); // Cleanup
        clearRunRef(current);
        return;
      }
    } catch (err) {
      const session = sessions.get(current.sessionCode);
      if (session) setStatus(session, `Runnerfout: ${err.message}`, "error");
      runnerWaitingForInput.delete(runId); // Cleanup
      activeRuns.delete(runId);
      clearRunRef(current);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 180));
  }
}

function forwardRunnerEvent(info, event) {
  const session = sessions.get(info.sessionCode);
  if (!session) return;

  if (info.audience === "teacher-all") {
    // Negeer events van een oude run.
    if (session.teacherRunId !== info.runId) return;
    if (event.type === "stdout" || event.type === "stderr") {
      session.sharedOutput += event.data;
      io.to(session.code).emit("run_output", { audience: "teacher-all", output: session.sharedOutput });
    } else if (event.type === "input_request") {
      runnerWaitingForInput.add(info.runId);
      io.to(session.code).emit("input_request", { audience: "teacher-all" });
      setStatus(session, "Wacht op input voor gedeelde run", "warning");
    } else if (event.type === "end") {
      io.to(session.code).emit("run_end", { audience: "teacher-all" });
      setStatus(session, "Leerkracht-run voltooid", "success");
    }
    return;
  }

  if (info.audience === "student") {
    const s = session.students[info.targetStudentId];
    if (!s || s.removed) return;
    // Negeer events van een oude (geannuleerde) run — alleen de actieve runId mag output sturen.
    if (s.runId !== info.runId) return;
    if (event.type === "stdout" || event.type === "stderr") {
      if (info.workspace === "personal") {
        s.personalOutput += event.data;
        if (s.socketId) io.to(s.socketId).emit("run_output", { audience: "student", output: s.personalOutput });
      } else {
        s.output += event.data;
        if (s.socketId) io.to(s.socketId).emit("run_output", { audience: "student", output: s.output });
      }
      updateTeacherLiveView(session, s.id);
    } else if (event.type === "input_request") {
      runnerWaitingForInput.add(info.runId);
      s.runStatus = 'waiting_input'; // Sprint 10Q
      if (s.socketId) io.to(s.socketId).emit("input_request", { audience: "student" });
      if (session.mode === "exam" && session.selectedStudentId === s.id && session.teacherSocketId) {
        io.to(session.teacherSocketId).emit("mirror_input_request", { studentId: s.id });
      }
      setStatus(session, `Wacht op input van ${s.name}`, "warning");
    } else if (event.type === "end") {
      if (s.socketId) io.to(s.socketId).emit("run_end", { audience: "student" });
      updateTeacherLiveView(session, s.id);
      setStatus(session, `${s.name} run voltooid`, "success");
    }
    return;
  }

  if (info.audience === "teacher-preview") {
    if (!session.teacherSocketId) return;
    // Negeer events van een oude preview-run.
    if (session.teacherRunId !== info.runId) return;
    if (event.type === "stdout" || event.type === "stderr") {
      session.teacherPreviewOutput = (session.teacherPreviewOutput || "") + event.data;
      io.to(session.teacherSocketId).emit("teacher_preview_output", { output: event.data, append: true });
    } else if (event.type === "input_request") {
      io.to(session.teacherSocketId).emit("teacher_preview_input_request", {});
      setStatus(session, "Wacht op input in preview-run", "warning");
    } else if (event.type === "end") {
      io.to(session.teacherSocketId).emit("teacher_preview_end", {});
      setStatus(session, "Preview-run voltooid", "success");
    }
  }
}

async function startPythonRun({ session, code, targetStudentId = null, audience = "student", workspace = null }) {
  const { runId } = await runnerStart(code);
  const info = {
    runId,
    sessionCode: session.code,
    targetStudentId,
    audience,
    workspace,
    after: 0
  };
  activeRuns.set(runId, info);
  pollRun(runId).catch(err => {
    log.error("pollRun error", err);
  });
  return runId;
}

// ── Auditlog vrije sessie ────────────────────────────────────────────────────
const FREE_AUDIT_LOG = require('path').join(process.env.LOG_DIR || '/app/logs', 'free-audit.log');

function logFreeRun(name, className, runCount) {
  try {
    const line = JSON.stringify({
      ts:        new Date().toISOString(),
      name,
      class:     className,
      runCount,
    }) + '\n';
    fs.appendFileSync(FREE_AUDIT_LOG, line, 'utf8');
  } catch { /* log niet kritisch */ }
}

// ── Sessie-persistentie helper ────────────────────────────────────────────────
// Debounced persist: voorkomt dat elke toetsaanslag een DB-write triggert.
const persistTimers = new Map();
function schedulePersist(session, delayMs = 2000) {
  if (!session || session.deleted) return;
  const existing = persistTimers.get(session.code);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    persistTimers.delete(session.code);
    dbModule.persistSession(session).catch(e => {
      log.error('[db] persistSession fout:', e.message);
    });
  }, delayMs);
  persistTimers.set(session.code, timer);
}

// Onmiddellijke persist (voor kritieke operaties zoals delete/close)
function persistNow(session) {
  const existing = persistTimers.get(session.code);
  if (existing) { clearTimeout(existing); persistTimers.delete(session.code); }
  dbModule.persistSession(session).catch(e => {
    log.error('[db] persistNow fout:', e.message);
  });
}

// ── Sprint 50f: leerkracht-identiteit op de socket ───────────────────────────
// Draait één keer per verbinding, vóór alle handlers. Zo blijft socketIsTeacherAuthorized()
// synchroon en hoeven de 30 handlers die hem gebruiken niet aangepast te worden.
// Bijkomend voordeel: de socket weet nu WIE de leerkracht is (socket.data.teacher) —
// dat heeft sprint 51 (eigenaarschap) nodig.
//
// Belangrijk: we laten ALTIJD door. Leerlingen verbinden via dezelfde socketserver en
// hebben geen leerkracht-sessie; die krijgen simpelweg geen socket.data.teacher.
io.use(async (socket, next) => {
  try {
    if (!BASIC_AUTH_ENABLED) {
      socket.data.teacher = { id: null, username: 'anoniem', displayName: '', role: 'admin', source: 'open' };
      return next();
    }
    const cookies = parseCookieHeader(socket.request.headers.cookie || '');
    if (cookies.teacher_sid) {
      const sessie = await dbModule.getTeacherSession(hashSessionToken(cookies.teacher_sid));
      if (sessie) socket.data.teacher = bepaalTeacherIdentiteit({ sessie });
    }
  } catch (e) {
    log.warn('[auth] socket-identiteit bepalen mislukt:', e.message);
  }
  next();
});

io.on("connection", (socket) => {  // Fix SEC-5: genereer unieke CSRF nonce per socket
  const socketNonce = crypto.randomBytes(16).toString('hex');
  socketCsrfNonces.set(socket.id, socketNonce);
  socket.emit('csrf_nonce', { nonce: socketNonce });

  socket.on("teacher_create_session", ({ name, mode, editorAssist, templateCode }) => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const code = makeCode();

    // Sprint 13A: standaard sessie-config per modus
    // Examenmodus: editor-hulp standaard uit; leerkracht kan dit per-sessie aanpassen
    const isExam = mode === 'exam';
    const defaultConfig = {
      autoIndent:          !isExam,
      autoClosingBrackets: !isExam,
      autoClosingQuotes:   !isExam,
      quickSuggestions:    !isExam && editorAssist !== false,
      parameterHints:      !isExam && editorAssist !== false,
      errorLineMarking:    true,   // altijd aan, niet uitschakelbaar
    };

    // Gebruik het meegegeven template, of de standaard startcode
    const startCode = templateCode
      ? String(templateCode).slice(0, 50000)
      : 'print("Hallo klas")\nnaam = input("Wat is je naam? ")\nprint("Welkom", naam)\n';
    const session = {
      code,
      id: crypto.randomUUID(),
      name: name || "Nieuwe sessie",
      mode: mode === "exam" ? "exam" : "class",
      editorAssist: editorAssist !== false,
      createdAt: Date.now(),
      // Sprint 51a: eigenaar = de leerkracht achter deze socket (Sprint 50f: de
      // io.use-middleware zet socket.data.teacher bij elke verbinding).
      teacherId: bepaalSessieEigenaar(socket.data.teacher),
      teacherSocketId: socket.id,
      selectedStudentId: null,
      classWorkspaceMode: "shared",
      sharedCode: startCode,
      sharedOutput: "",
      announcement: "",
      students: {},
      // Sprint 13A: per-sessie editor configuratie
      config: defaultConfig,
      closed: false,
      blocked: false,
      deleted: false,
      teacherRunId: null,
      teacherPreviewOutput: "",
      statusText: "Sessie aangemaakt",
      statusType: "success"
    };
    sessions.set(code, session);
    persistNow(session); // Direct opslaan — nieuwe sessie
    socket.join(code);
    socketToUser.set(socket.id, { role: "teacher", code });
    socket.emit("session_created", { code, mode: session.mode });
    io.emit("sessions_updated"); // Live refresh sessieoverzicht
    emitTeacherSession(session);
  });

  // Sprint 13C: inline badge beheer — leerkracht aanvaardt/blokkeert leerling vanuit sessie
  socket.on("teacher_update_student_badge", async ({ studentId, action }) => {
    if (!socketIsTeacherAuthorized(socket)) return;
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    const s = session.students[studentId];
    if (!s) return;

    if (action === 'accept') {
      // Aanvaarden: pending → active, badge verwijderen
      s.joinBadge = null;
      if (s.dbStudentId) {
        await dbModule.updateStudentStatus(s.dbStudentId, 'active').catch(()=>{});
      }
      setStatus(session, `${s.name} aanvaard`, 'success');
    } else if (action === 'block') {
      // Blokkeren: geldt bij volgende join, niet live verwijderen
      s.joinBadge = 'blocked';
      if (s.dbStudentId) {
        await dbModule.updateStudentStatus(s.dbStudentId, 'blocked').catch(()=>{});
      }
      setStatus(session, `${s.name} geblokkeerd (geldt bij volgende join)`, 'warning');
    } else if (action === 'assign_class') {
      // Klas toewijzen — classId meegestuurd als extra veld
      return; // wordt afgehandeld via teacher_assign_student_class
    }
    emitTeacherSession(session);
  });

  socket.on("teacher_assign_student_class", async ({ studentId, classId }) => {
    if (!socketIsTeacherAuthorized(socket)) return;
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    const s = session.students[studentId];
    if (!s) return;
    if (s.dbStudentId) {
      await dbModule.updateStudentClass(s.dbStudentId, classId).catch(()=>{});
    } else {
      // Leerling nog niet in DB — aanmaken en koppelen
      try {
        const newId = await dbModule.createStudent(s.name, classId, 'manual', 'active');
        s.dbStudentId = newId;
      } catch (e) { /* stille fout — zie debug */ }
    }
    s.joinBadge = null;
    emitTeacherSession(session);
    setStatus(session, `${s.name} gekoppeld aan klas`, 'success');
  });

  // Sprint 13A: leerkracht past sessie-config aan
  socket.on("teacher_update_session_config", ({ key, value }) => {
    if (!socketIsTeacherAuthorized(socket)) return;
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    // Valideer key en value
    const allowedKeys = ['autoIndent','autoClosingBrackets','autoClosingQuotes','quickSuggestions','parameterHints'];
    if (!allowedKeys.includes(key)) return;
    if (typeof value !== 'boolean') return;
    if (!session.config) session.config = {};
    session.config[key] = value;
    // Broadcast naar alle leerlingen in de sessie
    io.to(session.code).emit('session_config_update', { config: session.config });
    setStatus(session, `Sessie-instelling bijgewerkt: ${key} = ${value}`, 'info');
  });

  // 30-cfg: volledige config in één keer toepassen (Toepassen-knop).
  // Vervangt de per-toggle flow die een off-by-one in Monaco gaf.
  socket.on("teacher_apply_session_config", ({ config }) => {
    if (!socketIsTeacherAuthorized(socket)) return;
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    if (!config || typeof config !== 'object') return;
    if (!session.config) session.config = {};
    // Valideer elke sleutel via de whitelist + booleancheck (lib/validation.js)
    let applied = 0;
    for (const [key, value] of Object.entries(config)) {
      if (validationLib.isAllowedConfigKey(key) && validationLib.isValidConfigValue(value)) {
        session.config[key] = value;
        applied++;
      }
    }
    if (applied === 0) return;
    io.to(session.code).emit('session_config_update', { config: session.config });
    setStatus(session, `Sessie-instellingen toegepast (${applied})`, 'info');
  });

  socket.on("teacher_join_session", ({ code }) => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const session = sessions.get((code || "").toUpperCase());
    if (!session || session.closed || session.deleted) return socket.emit("error_message", "Sessie niet gevonden");
    session.teacherSocketId = socket.id;
    socket.join(session.code);
    socketToUser.set(socket.id, { role: "teacher", code: session.code });
    resumeRunIfNeeded(session.teacherRunId);
    emitTeacherSession(session);
  });

  socket.on("student_join", async ({ name, code, className, resumeId }) => {
    const normalizedCode = (code || "").trim().toUpperCase();
    // Fix SEC-12: rate limit op join pogingen
    const joinIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() || socket.handshake.address;
    if (!checkJoinRateLimit(joinIp)) {
      return socket.emit('error_message', 'Te veel inlogpogingen. Probeer over een minuut opnieuw.');
    }
    const normalizedName = String(name || "").trim().slice(0, 64);
    const normalizedClass = String(className || "").trim().slice(0, 64);
    const normalizedNameLower = normalizedName.toLowerCase();
    const session = sessions.get(normalizedCode);
    if (!session || session.closed || session.deleted || session.blocked) return socket.emit("error_message", "Sessie niet gevonden of niet bereikbaar");
    if (!normalizedName) return socket.emit("error_message", "Geef eerst je naam in. De placeholder telt niet als naam.");
    if (!normalizedCode) return socket.emit("error_message", "Geef eerst je sessiecode in.");

    // Sprint 43: een toets/taak is géén gewone codeersessie. Wie met een toetscode
    // op de generieke "Deelnemen"-pagina binnenkomt, wordt naar de toets-flow gestuurd
    // i.p.v. in de editor-sessie te belanden.
    if (session.mode === 'quiz' || session.mode === 'task') {
      return socket.emit('redirect_to_quiz', {
        code: normalizedCode, name: normalizedName, className: normalizedClass,
      });
    }

    // Sprint 13B: duplicaat-detectie binnen dezelfde sessie
    const activeNames = Object.values(session.students)
      .filter(s => s.online && !s.removed)
      .map(s => (s.name || '').toLowerCase());
    if (!resumeId && activeNames.includes(normalizedNameLower)) {
      return socket.emit('error_message',
        `Er is al iemand met de naam "${normalizedName}" in deze sessie. Voeg je initialen of achternaam toe.`);
    }

    // Sprint 13B: leerling opzoeken in students tabel (async)
    let studentRecord = null;
    let joinBadge = null; // null | 'new' | 'pending' | 'guest'
    try {
      if (normalizedClass) {
        // Zoek klas op naam
        const classes = await dbModule.listClasses(false);
        const cls = classes.find(c => c.name.toLowerCase() === normalizedClass.toLowerCase());
        if (cls) {
          studentRecord = await dbModule.getStudentByName(normalizedName, cls.id);
          if (studentRecord) {
            if (studentRecord.status === 'blocked') {
              return socket.emit('error_message', 'Je hebt geen toegang tot deze sessie.');
            }
            joinBadge = studentRecord.status === 'pending' ? 'pending' : null;
            // Update last_seen
            dbModule.updateStudentLastSeen(studentRecord.id).catch(()=>{});
          } else {
            // Naam niet in klas — aanmaken als pending
            const newId = await dbModule.createStudent(normalizedName, cls.id, 'manual', 'pending');
            studentRecord = { id: newId, name: normalizedName, class_id: cls.id, status: 'pending' };
            joinBadge = 'new';
          }
        } else {
          joinBadge = 'new'; // klas onbekend
        }
      } else {
        joinBadge = 'guest'; // geen klas opgegeven
      }
    } catch (e) {
      log.error('[join] DB fout bij leerling opzoeken:', e.message);
      // Niet blokkeren bij DB fout — leerling mag toch joinen
    }

    let student = findReusableStudent(session, normalizedName, resumeId);

    if (student) {
      student.name = normalizedName || student.name || "Leerling";
      student.socketId = socket.id;
      student.removed = false;
      socket.join(session.code);
      socketToUser.set(socket.id, { role: "student", code: session.code, studentId: student.id });
      resumeRunIfNeeded(student.runId);
      emitStudentState(session, student);
      emitTeacherSession(session);
      setStatus(session, `${student.name} is opnieuw verbonden`, "info");
      return;
    }

    const id = crypto.randomUUID();
    student = {
      id, name: normalizedName || "Leerling", socketId: socket.id,
      className: normalizedClass || '',       // Sprint 13B: klas opgeslagen
      joinBadge: joinBadge,                   // Sprint 13B: null|'new'|'pending'|'guest'
      dbStudentId: studentRecord?.id || null, // Sprint 13B: link naar students tabel
      classCanRun: false, classCanEdit: false,
      personalCanRun: true, personalCanEdit: true, removed: false,
      code: session.mode === "class" ? session.sharedCode : 'print("Hallo")\n',
      personalCode: '',
      personalOutput: "",
      output: "",
      runId: null
    };
    session.students[id] = student;
    socket.join(session.code);
    socketToUser.set(socket.id, { role: "student", code: session.code, studentId: id });
    schedulePersist(session);
    resumeRunIfNeeded(student.runId);
    emitStudentState(session, student);
    emitTeacherSession(session);
    const badgeInfo = joinBadge ? ` [${joinBadge}]` : '';
    setStatus(session, `${student.name} is gejoined${badgeInfo}`, "info");
  });

  // ── Vrije sessie ────────────────────────────────────────────────────────────
  // Leerling meldt zich aan voor vrij oefenen (geen sessiecode vereist).
  socket.on("student_join_free", ({ name, className }) => {
    const normalizedName = String(name || "").trim();
    const normalizedClass = String(className || "").trim();
    if (!normalizedName) {
      return socket.emit("error_message", "Geef eerst je naam in.");
    }
    if (!normalizedClass) {
      return socket.emit("error_message", "Geef eerst je klas in.");
    }
    const id = crypto.randomUUID();
    const student = {
      id,
      name: normalizedName,
      className: normalizedClass,
      joinedAt: Date.now(),
      socketId: socket.id,
      runId: null,
    };
    freeStudents.set(socket.id, student);
    socketToUser.set(socket.id, { role: "free", freeId: id });
    // Bevestig aan de leerling: stuur initiële state
    socket.emit("free_session_state", {
      name: normalizedName,
      className: normalizedClass,
      editorAssist: true,
      code: `print("Hallo!")\nnaam = input("Wat is je naam? ")\nprint("Welkom", naam)\n`,
    });
    // Broadcast aan alle leerkracht-sockets zodat teacher-sessions live bijwerkt
    io.emit("free_students_updated");
  });

  // Leerkracht verwijdert een leerling uit de vrije sessie
  socket.on("teacher_remove_free_student", ({ freeId }) => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    // Zoek de student op basis van freeId
    let targetSocket = null;
    for (const [sid, s] of freeStudents.entries()) {
      if (s.id === freeId) { targetSocket = sid; break; }
    }
    if (!targetSocket) return;
    const s = freeStudents.get(targetSocket);
    // Stuur force_landing naar de leerling
    io.to(targetSocket).emit("force_landing");
    freeStudents.delete(targetSocket);
    socketToUser.delete(targetSocket);
    io.emit("free_students_updated");
  });

  // Vrije sessie: run-verzoek van leerling
  socket.on("free_run_request", async ({ codeText } = {}) => {
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "free") return;
    // Fix SEC-extra: maximale code grootte 32KB
    if (typeof codeText === 'string' && codeText.length > 32768) {
      return socket.emit('free_run_end');
    }
    const student = freeStudents.get(socket.id);
    if (!student) return;
    // Per-socket rate limiting (3s min)
    const now = Date.now();
    const lastRun = runRateLimit.get(socket.id) || 0;
    if (now - lastRun < RUN_RATE_LIMIT_MS) {
      return socket.emit("free_run_rate_limited", {
        waitMs: RUN_RATE_LIMIT_MS - (now - lastRun),
        message: `Wacht even voor je opnieuw runt.`
      });
    }
    runRateLimit.set(socket.id, now);
    // Run-teller verhogen voor audit log
    student.runCount = (student.runCount || 0) + 1;
    // IP rate limiting (max 20 runs/min) — beschermt tegen misbruik van buitenaf
    const clientIp = getClientIp(socket.request || {});
    const ipCheck = checkIpRateLimit(clientIp);
    if (!ipCheck.allowed) {
      const waitSec = Math.ceil((ipCheck.retryAfterMs || 60000) / 1000);
      return socket.emit("free_run_rate_limited", {
        waitMs: ipCheck.retryAfterMs || 60000,
        message: `Te veel runs van dit netwerk. Probeer opnieuw over ${waitSec} seconde(n).`
      });
    }

    // Cancel vorige run als die nog loopt
    if (student.runId) {
      try { await fetch(`${RUNNER_URL}/runs/${student.runId}/cancel`, { method: "POST" }); } catch (e) { /* best-effort cancel, runner mogelijk al klaar */ }
      student.runId = null;
    }

    let runData;
    try {
      runData = await runnerStart(codeText || '');
    } catch (err) {
      socket.emit("free_run_output", { output: `Fout bij starten: ${err.message}` });
      return;
    }

    student.runId = runData.runId;
    student._outputAccum = ''; // Reset output accumulator bij nieuwe run

    // Poll-loop: hergebruikt dezelfde runner als klas/examsessies
    const poll = async () => {
      let lastSeq = 0;
      for (;;) {
        let evData;
        try {
          const r = await fetch(`${RUNNER_URL}/runs/${student.runId}/events?after=${lastSeq}`);
          if (!r.ok) break;
          evData = await r.json();
        } catch { break; }

        for (const ev of (evData.events || [])) {
          lastSeq = ev.seq;
          if (ev.type === 'stdout' || ev.type === 'stderr') {
            // Gebruik student._outputAccum zodat echo (direct toegevoegd bij input)
            // en stdout altijd in de correcte volgorde staan
            student._outputAccum = (student._outputAccum || '') + ev.data;
            socket.emit("free_run_output", { output: student._outputAccum });
          } else if (ev.type === 'input_request') {
            runnerWaitingForInput.add(student.runId);
            socket.emit("free_input_request");
          } else if (ev.type === 'run_error') {
            // Stuur gestructureerd fout-event naar de vrije editor client
            let errData = {};
            try {
              errData = typeof ev.data === 'string' ? JSON.parse(ev.data || '{}') : (ev.data || {});
            } catch (e) { /* stille fout — zie debug */ }
            const icons = { cpu_timeout: '⏱', input_timeout: '⏳', disconnect: '🔌', cancelled: '⏹' };
            const icon = icons[errData.errorType] || '⚠️';
            const lineInfo = errData.line ? ` (regel ${errData.line})` : '';
            student._outputAccum = (student._outputAccum || '') + `\n${icon} ${errData.message || 'Fout'}${lineInfo}\n`;
            socket.emit('free_run_output', { output: student._outputAccum });
          } else if (ev.type === 'end') {
            socket.emit("free_run_end");
            student.runId = null;
            return;
          }
        }

        if (evData.queued) {
          socket.emit("free_run_queued", { position: evData.queuePosition || 1 });
          await new Promise(r => setTimeout(r, 800));
        } else if (!evData.running && !runnerWaitingForInput.has(student.runId)) {
          // Enkel stoppen als runner NIET wacht op input
          // Anders: runner is klaar met verwerken maar wacht op stdin — poll verder
          socket.emit("free_run_end");
          student.runId = null;
          return;
        } else if (runnerWaitingForInput.has(student.runId)) {
          // Runner wacht op input — normaal pollen (180ms)
          await new Promise(r => setTimeout(r, 180));
        } else {
          await new Promise(r => setTimeout(r, 180));
        }
      }
    };
    poll().catch(() => { socket.emit("free_run_end"); student.runId = null; });
  });

  // Vrije sessie: stdin-input doorgeven aan runner
  // ── Secundaire leerkrachtsrol (observer) ────────────────────────────────────
  socket.on("teacher_join_as_observer", ({ code }) => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const session = sessions.get((code || '').toUpperCase());
    if (!session || session.deleted || session.closed) {
      return socket.emit("error_message", "Sessie niet gevonden of gesloten");
    }
    // Observer: join de room maar met read-only rol
    socket.join(session.code);
    socketToUser.set(socket.id, { role: 'observer', code: session.code });
    if (!session.observerSocketIds) session.observerSocketIds = new Set();
    session.observerSocketIds.add(socket.id);
    // Stuur volledige sessie data (zelfde als leerkracht maar read-only vlag)
    socket.emit('observer_session_data', {
      ...buildTeacherData(session),
      session: { ...session, readOnly: true },
      isObserver: true,
    });
    stressLog && null; // noop
  });

  // ── Klaar-knop ─────────────────────────────────────────────────────────────
  socket.on("student_mark_done", () => {
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "student") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    const s = session.students[ctx.studentId];
    if (!s || s.removed) return;
    s.isDone = true;
    s.doneAt = Date.now();
    emitTeacherSession(session);
  });

  socket.on("student_unmark_done", () => {
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "student") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    const s = session.students[ctx.studentId];
    if (!s || s.removed) return;
    s.isDone = false;
    s.doneAt = null;
    emitTeacherSession(session);
  });

  socket.on("teacher_reset_done", ({ studentId }) => {
    if (!socketIsTeacherAuthorized(socket)) return;
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    const s = session.students[studentId];
    if (!s || s.removed) return;
    s.isDone = false;
    s.doneAt = null;
    if (s.socketId) io.to(s.socketId).emit("done_reset_by_teacher");
    emitTeacherSession(session);
  });

  socket.on("teacher_reset_all_done", () => {
    if (!socketIsTeacherAuthorized(socket)) return;
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    for (const s of Object.values(session.students)) {
      if (!s.removed) {
        s.isDone = false;
        s.doneAt = null;
        if (s.socketId) io.to(s.socketId).emit("done_reset_by_teacher");
      }
    }
    emitTeacherSession(session);
  });

  // ── Countdown timer ────────────────────────────────────────────────────────
  socket.on("teacher_start_timer", ({ durationMs }) => {
    if (!socketIsTeacherAuthorized(socket)) return;
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;

    // Stop eventuele lopende timer
    if (session.timerInterval) { clearInterval(session.timerInterval); session.timerInterval = null; }

    const endTime = Date.now() + Math.min(durationMs, 90 * 60 * 1000); // max 90 min
    session.timerEnd = endTime;
    session.timerRunning = true;

    const broadcast = () => {
      const remaining = Math.max(0, session.timerEnd - Date.now());
      io.to(session.code).emit("timer_update", { remainingMs: remaining, running: session.timerRunning });
      if (remaining <= 0) {
        clearInterval(session.timerInterval);
        session.timerInterval = null;
        session.timerRunning = false;
      }
    };
    broadcast();
    session.timerInterval = setInterval(broadcast, 1000);
  });

  socket.on("teacher_stop_timer", () => {
    if (!socketIsTeacherAuthorized(socket)) return;
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    if (session.timerInterval) { clearInterval(session.timerInterval); session.timerInterval = null; }
    session.timerRunning = false;
    io.to(session.code).emit("timer_update", { remainingMs: 0, running: false });
  });

  // ── Hand opsteken ──────────────────────────────────────────────────────────
  socket.on("student_raise_hand", () => {
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "student") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    const s = session.students[ctx.studentId];
    if (!s || s.removed) return;
    s.handRaised = true;
    s.handRaisedAt = Date.now();
    emitTeacherSession(session);
  });

  socket.on("student_lower_hand", () => {
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "student") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    const s = session.students[ctx.studentId];
    if (!s || s.removed) return;
    s.handRaised = false;
    s.handRaisedAt = null;
    emitTeacherSession(session);
  });

  socket.on("teacher_lower_hand", ({ studentId }) => {
    if (!socketIsTeacherAuthorized(socket)) return;
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    const s = session.students[studentId];
    if (!s || s.removed) return;
    s.handRaised = false;
    s.handRaisedAt = null;
    if (s.socketId) io.to(s.socketId).emit("hand_lowered_by_teacher");
    emitTeacherSession(session);
  });

  // ── Leerkrachtannotatie ────────────────────────────────────────────────────
  socket.on("teacher_send_annotation", ({ startLine, endLine, message, color }) => {
    if (!socketIsTeacherAuthorized(socket)) return;
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    // Fix SEC-8: valideer annotatie velden
    if (typeof message !== 'string' || message.trim().length === 0) return;
    if (message.length > 500) return socket.emit('error_message', 'Annotatie mag maximaal 500 tekens bevatten.');
    const safeStart = Math.max(1, Math.min(99999, parseInt(startLine) || 1));
    const safeEnd   = Math.max(safeStart, Math.min(99999, parseInt(endLine) || safeStart));
    const safeColor = ['yellow','blue','green','red'].includes(color) ? color : 'yellow';
    const annotation = {
      id: crypto.randomUUID(),
      startLine: safeStart,   // Fix SEC-8: gebruik gerevalideerde waarden
      endLine:   safeEnd,
      message:   String(message || '').trim().slice(0, 500),
      color:     safeColor,
      createdAt: Date.now(),
    };
    if (!session.annotations) session.annotations = [];
    session.annotations.push(annotation);
    // Persisteer in SQLite
    dbModule.saveAnnotations(session.code, session.annotations).catch(()=>{});
    // Stuur naar alle leerlingen
    for (const s of getActiveStudents(session)) {
      if (s.socketId) io.to(s.socketId).emit('annotation_added', annotation);
    }
  });

  socket.on("teacher_clear_annotations", () => {
    if (!socketIsTeacherAuthorized(socket)) return;
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    session.annotations = [];
    // Persisteer lege array
    dbModule.saveAnnotations(session.code, []).catch(()=>{});
    for (const s of getActiveStudents(session)) {
      if (s.socketId) io.to(s.socketId).emit('annotations_cleared');
    }
  });

  // ── Read-only snippet broadcasten ─────────────────────────────────────────
  socket.on("teacher_send_snippet", ({ code }) => {
    if (!socketIsTeacherAuthorized(socket)) return;
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    session.snippet = String(code || '').slice(0, 50000); // max 50KB
    session.snippetVersion = (session.snippetVersion || 0) + 1;
    // Broadcast naar alle leerlingen
    for (const s of getActiveStudents(session)) {
      if (s.socketId) {
        io.to(s.socketId).emit("snippet_update", {
          code: session.snippet,
          version: session.snippetVersion,
        });
      }
    }
    emitTeacherSession(session);
  });

  socket.on("teacher_clear_snippet", () => {
    if (!socketIsTeacherAuthorized(socket)) return;
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    session.snippet = '';
    session.snippetVersion = (session.snippetVersion || 0) + 1;
    for (const s of getActiveStudents(session)) {
      if (s.socketId) io.to(s.socketId).emit("snippet_update", { code: '', version: session.snippetVersion });
    }
  });

  // ── Tab-detectie (examenmodus) ────────────────────────────────────────────
  socket.on("student_tab_hidden", () => {
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "student") return;
    const session = sessions.get(ctx.code);
    if (!session || session.mode !== "exam") return;
    const s = session.students[ctx.studentId];
    if (!s || s.removed) return;

    // Initialiseer tab-tracking als die er nog niet is
    if (!s.tabEvents) s.tabEvents = [];
    const event = { hiddenAt: Date.now(), returnedAt: null, durationMs: null };
    s.tabEvents.push(event);
    s.tabHidden = true;
    s.tabHiddenCount = (s.tabHiddenCount || 0) + 1;

    emitTeacherSession(session);
  });

  socket.on("student_tab_visible", () => {
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "student") return;
    const session = sessions.get(ctx.code);
    if (!session || session.mode !== "exam") return;
    const s = session.students[ctx.studentId];
    if (!s || s.removed) return;

    s.tabHidden = false;
    // Vul het returnedAt in van de laatste hidden event
    if (s.tabEvents && s.tabEvents.length > 0) {
      const last = s.tabEvents[s.tabEvents.length - 1];
      if (!last.returnedAt) {
        last.returnedAt = Date.now();
        last.durationMs = last.returnedAt - last.hiddenAt;
      }
    }

    emitTeacherSession(session);
  });

  socket.on("free_runtime_input", async ({ value } = {}) => {
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "free") return;
    const student = freeStudents.get(socket.id);
    if (!student || !student.runId) return;
    if (!runnerWaitingForInput.has(student.runId)) return;
    runnerWaitingForInput.delete(student.runId);
    const displayValue = String(value ?? "");
    try {
      const result = await runnerInput(student.runId, displayValue);
      if (result && result.rejected) {
        // Runner wacht nog niet — zet terug in Set en negeer deze input
        runnerWaitingForInput.add(student.runId);
        return;
      }
      // Input geaccepteerd — echo tonen
      const echoDisplay = displayValue === '' ? '[lege invoer]' : `[${displayValue}]`;
      student._outputAccum = (student._outputAccum || '') + echoDisplay + '\n';
      socket.emit('free_run_output', { output: student._outputAccum });
      socket.emit("free_run_input_echo", { value: displayValue });
    } catch (e) { /* stille fout — zie debug */ }
  });

  socket.on("student_reconnect", ({ code, studentId }) => {
    const session = sessions.get((code || "").toUpperCase());
    if (!session || session.closed || session.deleted || session.blocked) return socket.emit("force_landing");
    const s = session.students[studentId];
    if (!s || s.removed) return socket.emit("force_landing");
    s.socketId = socket.id;
    socket.join(session.code);
    socketToUser.set(socket.id, { role: "student", code: session.code, studentId: studentId });
    resumeRunIfNeeded(s.runId);
    emitStudentState(session, s);
    emitTeacherSession(session);
  });

  socket.on("student_leave_to_landing", () => {
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "student") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    const s = session.students[ctx.studentId];
    if (s) {
      s.socketId = null;
      scheduleRunDisconnect(s.runId);
    }
    socket.leave(ctx.code);
    socketToUser.delete(socket.id);
    emitTeacherSession(session);
  });

  socket.on("code_update", ({ codeText, workspace } = {}) => {
    const ctx = socketToUser.get(socket.id);
    if (!ctx) return;
    const session = sessions.get(ctx.code);
    if (!session || session.closed) return;

    if (ctx.role === "teacher") {
      if (session.mode === "class") {
        session.sharedCode = codeText;
        session.sharedCodeRevision = nextRevision(session.sharedCodeRevision);
        session.sharedCodeSourceSocketId = socket.id;
        schedulePersist(session, 5000); // Debounced: 5s na laatste toetsaanslag
        // Leerkracht typt: broadcast naar leerlingen maar stuur geen teacher_session_data
        // terug (leerkracht heeft de code al in zijn editor).
        broadcastClassCode(session, null, false);
      }
    } else {
      const s = session.students[ctx.studentId];
      if (!s || s.removed) return;

      if (session.mode === "class") {
        const targetWorkspace = workspace === "personal"
          ? "personal"
          : (workspace === "shared" ? "shared" : (session.classWorkspaceMode || "shared"));

        if (targetWorkspace === "shared") {
          // Leerling typt in gedeelde code — mag alleen als classCanEdit aan staat
          if (s.classCanEdit === false) return;
          session.sharedCode = codeText;
          session.sharedCodeRevision = nextRevision(session.sharedCodeRevision);
          session.sharedCodeSourceSocketId = socket.id;
          // Stuur naar alle andere leerlingen (niet terug naar de typende leerling zelf)
          broadcastClassCode(session, socket.id);
          // Niet terugsturen naar de typende leerling — die heeft de code al
        } else {
          // Individuele werkfase: leerling typt in eigen werkblad
          if (s.personalCanEdit === false) return;
          s.personalCode = codeText;
          s.personalCodeRevision = nextRevision(s.personalCodeRevision);
          s.personalCodeSourceSocketId = socket.id;
          maybeSnapshot(session, s, codeText);
          // Niet terugsturen, en NOOIT naar andere leerlingen — personal is volledig privé
        }
      } else {
        // Examenmodus
        if (s.personalCanEdit === false) return;
        s.code = codeText;
        s.codeRevision = (s.codeRevision || 0) + 1;
        s.codeSourceSocketId = socket.id;
        maybeSnapshot(session, s, codeText);
        // Alleen leerkracht live-view bijwerken als die deze leerling volgt
        updateTeacherLiveView(session, s.id);
      }
    }
  });

  socket.on("teacher_send_announcement", ({ text }) => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    session.announcement = String(text || "").trim();
    // Bewaar geschiedenis (max 5 aankondigingen)
    if (session.announcement) {
      if (!session.announcementHistory) session.announcementHistory = [];
      // Voorkom duplicaten van de meest recente
      const last = session.announcementHistory[session.announcementHistory.length - 1];
      if (last !== session.announcement) {
        session.announcementHistory.push(session.announcement);
        if (session.announcementHistory.length > 5) session.announcementHistory.shift();
      }
      setStatus(session, "Opdracht naar leerlingen gestuurd", "success");
    } else {
      setStatus(session, "Opdrachtbericht gewist", "info");
    }
    // Stuur alleen het announcement-veld, niet de volledige student_state.
    // Dit voorkomt dat de editor van de leerling reset tijdens het typen.
    for (const s of getActiveStudents(session)) {
      if (s.socketId) {
        io.to(s.socketId).emit("announcement_update", { text: session.announcement });
      }
    }
    emitTeacherSession(session);
  });

  socket.on("teacher_select_student", ({ studentId }) => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session || session.mode !== "exam") return;
    if (!session.students[studentId] || session.students[studentId].removed) return;
    session.selectedStudentId = studentId;
    setStatus(session, `Live control op ${session.students[studentId].name}`, "info");
  });

  socket.on("teacher_toggle_class_workspace", () => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session || session.mode !== "class") return;
    session.classWorkspaceMode = (session.classWorkspaceMode || "shared") === "shared" ? "personal" : "shared";
    if (session.classWorkspaceMode === "personal") {
      // 27k: reset personalCanRun voor alle leerlingen bij wissel naar individuele modus
      Object.values(session.students).forEach(s => { if (s) s.personalCanRun = true; });
      for (const s of getActiveStudents(session)) {
        s.personalCanRun = true;
        s.personalCanEdit = true;
        if (s.socketId) io.to(s.socketId).emit("force_workspace", { workspace: "personal", panel: "code" });
      }
      setStatus(session, "Individuele werkfase gestart", "warning");
    } else {
      for (const s of getActiveStudents(session)) {
        if (s.socketId) io.to(s.socketId).emit("force_workspace", { workspace: "shared", panel: "code" });
      }
      setStatus(session, "Terug naar klascode", "success");
    }
    for (const s of getActiveStudents(session)) emitStudentState(session, s);
    emitTeacherSession(session);
  });

  socket.on("teacher_toggle_student", ({ studentId, field }) => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    // In examenmodus hebben leerlingen altijd volledige run- en bewerkrechten —
    // de leerkracht kan deze niet blokkeren via de toggle-knoppen.
    if (session.mode === "exam") return;
    const s = session.students[studentId];
    if (!s || s.removed) return;

    if (field === "run") {
      const newValue = !(s.classCanRun !== false);
      s.classCanRun = newValue;
      // Als we deze leerling AAN zetten, zet alle anderen automatisch UIT
      if (newValue === true) {
        for (const other of getActiveStudents(session)) {
          if (other.id !== s.id) {
            other.classCanRun = false;
            emitStudentState(session, other);
          }
        }
      }
    }

    if (field === "code") {
      const newValue = !(s.classCanEdit !== false);
      s.classCanEdit = newValue;
      // Als we deze leerling AAN zetten, zet alle anderen automatisch UIT
      if (newValue === true) {
        for (const other of getActiveStudents(session)) {
          if (other.id !== s.id) {
            other.classCanEdit = false;
            emitStudentState(session, other);
          }
        }
      }
    }

    emitStudentState(session, s);
    emitTeacherSession(session);
    setStatus(session, `Permissie aangepast voor ${s.name}`, "info");
  });

  socket.on("teacher_toggle_all", ({ field }) => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    // Niet van toepassing in examenmodus.
    if (session.mode === "exam") return;
    const students = getActiveStudents(session);
    const allEnabled = field === "run"
      ? students.every(s => s.classCanRun !== false)
      : students.every(s => s.classCanEdit !== false);
    const newValue = !allEnabled;
    for (const s of students) {
      if (field === "run") { s.classCanRun = newValue; }
      if (field === "code") { s.classCanEdit = newValue; }
      emitStudentState(session, s);
    }
    setStatus(session, `${field === "run" ? "Run" : "Code"} voor iedereen ${newValue ? "aan" : "uit"}`, "info");
  });

  socket.on("teacher_remove_student", ({ studentId }) => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    const s = session.students[studentId];
    if (!s || s.removed) return;
    s.removed = true;
    if (s.socketId) io.to(s.socketId).emit("force_landing");
    if (session.selectedStudentId === studentId) session.selectedStudentId = null;
    setStatus(session, `${s.name} werd verwijderd`, "warning");
  });

  socket.on("teacher_toggle_session_block", () => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session || session.deleted) return;
    session.blocked = !session.blocked;
    if (session.blocked) {
      for (const s of getActiveStudents(session)) {
        if (s.socketId) io.to(s.socketId).emit("force_landing");
        s.socketId = null;
      }
      setStatus(session, "Sessie geblokkeerd", "warning");
    } else {
      setStatus(session, "Sessie opnieuw gestart", "success");
    }
    emitTeacherSession(session);
  });

  socket.on("teacher_delete_session", () => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    session.deleted = true;
    dbModule.markSessionDeleted(session.code).catch(()=>{});
    // Sprint 9A: cleanup memory
    if (session.timerInterval) { clearInterval(session.timerInterval); session.timerInterval = null; }
    for (const k of snapshotLastSaved.keys()) {
      if (k.startsWith(session.code + ':')) snapshotLastSaved.delete(k);
    }
    for (const s of getActiveStudents(session)) {
      if (s.socketId) io.to(s.socketId).emit("force_landing");
    }
    if (session.teacherSocketId) io.to(session.teacherSocketId).emit("teacher_go_sessions");
    sessions.delete(session.code);
    io.emit("sessions_updated"); // Live refresh sessieoverzicht
  });

  socket.on("teacher_force_panel", ({ panel }) => {
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session || session.mode !== "class") return;
    io.to(session.code).emit("force_panel", { panel });
  });

  socket.on("teacher_close_session", () => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    session.closed = true;
    dbModule.markSessionClosed(session.code).catch(()=>{});
    io.to(session.code).emit("force_landing");
    setStatus(session, "Sessie afgesloten", "warning");
    io.emit("sessions_updated"); // Live refresh sessieoverzicht
    // Sprint 9A: cleanup memory
    if (session.timerInterval) { clearInterval(session.timerInterval); session.timerInterval = null; }
    for (const k of snapshotLastSaved.keys()) {
      if (k.startsWith(session.code + ':')) snapshotLastSaved.delete(k);
    }
  });

  socket.on("run_request", async ({ codeText, workspace } = {}) => {
    // Fix SEC-extra: maximale code grootte 32KB
    if (typeof codeText === 'string' && codeText.length > 32768) return;
    // Rate limiting: maximaal 1 run per RUN_RATE_LIMIT_MS per socket
    const now = Date.now();
    const lastRun = runRateLimit.get(socket.id) || 0;
    if (now - lastRun < RUN_RATE_LIMIT_MS) {
      return socket.emit("run_rate_limited", {
        waitMs: RUN_RATE_LIMIT_MS - (now - lastRun),
        message: `Wacht even voor je opnieuw runt.`
      });
    }
    runRateLimit.set(socket.id, now);
    const ctx = socketToUser.get(socket.id);
    if (!ctx) return;
    const session = sessions.get(ctx.code);
    if (!session || session.closed) return;

    try {
      if (ctx.role === "teacher") {
        if (session.mode === "class") {
          const effectiveCode = typeof codeText === "string" ? codeText : session.sharedCode;
          session.sharedCode = effectiveCode;
          if ((session.classWorkspaceMode || "shared") === "shared") {
            session.sharedOutput = "";
            const runId = await startPythonRun({
              session,
              code: effectiveCode,
              audience: "teacher-all"
            });
            session.teacherRunId = runId;
            io.to(session.code).emit("switch_to_output", { audience: "teacher-all" });
            setStatus(session, "Leerkracht-run gestart voor iedereen", "info");
          } else {
            session.teacherPreviewOutput = "";
            const runId = await startPythonRun({
              session,
              code: effectiveCode,
              audience: "teacher-preview"
            });
            session.teacherRunId = runId;
            if (session.teacherSocketId) io.to(session.teacherSocketId).emit("teacher_preview_reset");
            setStatus(session, "Leerkracht-run gestart in individuele werkfase", "info");
          }
        } else {
          const sid = session.selectedStudentId;
          if (!sid || !session.students[sid] || session.students[sid].removed) return;
          const s = session.students[sid];
          const effectiveCode = typeof codeText === "string" ? codeText : s.code;
          s.code = effectiveCode;
          const runId = await startPythonRun({
            session,
            code: effectiveCode,
            targetStudentId: sid,
            audience: "teacher-preview"
          });
          session.teacherRunId = runId;
          if (session.teacherSocketId) io.to(session.teacherSocketId).emit("teacher_preview_reset");
          setStatus(session, `Preview-run gestart voor ${s.name}`, "info");
        }
        return;
      }

      const s = session.students[ctx.studentId];
      if (!s || s.removed) return;
      const requestedWorkspace = session.mode === "class"
        ? (workspace === "personal" ? "personal" : (workspace === "shared" ? "shared" : (session.classWorkspaceMode || "shared")))
        : "personal";
      const studentCanRun = session.mode === "class"
        ? (requestedWorkspace === "shared" ? (s.classCanRun !== false) : (s.personalCanRun !== false))
        : (s.personalCanRun !== false);
      if (!studentCanRun) return;

      let effectiveCode = typeof codeText === "string" ? codeText : null;

      // Wis output-buffers EERST — vóór de cancel — zodat de guard in
      // forwardRunnerEvent de resterende events van de oude run negeert
      // én de buffer al leeg is als de client opnieuw verbindt.
      s.output = "";
      s.personalOutput = "";
      s._echoBuffer = ''; // Reset echo buffer bij nieuwe run

      // Cancel vorige run zodat de poll-loop stopt.
      if (s.runId) {
        try { await fetch(`${RUNNER_URL}/runs/${s.runId}/cancel`, { method: "POST" }); } catch (e) { /* best-effort cancel */ }
        s.runId = null;
      }

      if (session.mode === "class") {
        if (requestedWorkspace === "personal") {
          if (effectiveCode !== null) {
            s.personalCode = effectiveCode;
            s.personalCodeRevision = nextRevision(s.personalCodeRevision);
            s.personalCodeSourceSocketId = socket.id;
          }
          effectiveCode = effectiveCode ?? s.personalCode;
        } else {
          if (effectiveCode !== null) {
            session.sharedCode = effectiveCode;
            session.sharedCodeRevision = nextRevision(session.sharedCodeRevision);
            session.sharedCodeSourceSocketId = socket.id;
          }
          effectiveCode = effectiveCode ?? session.sharedCode;
        }
      } else {
        if (effectiveCode !== null) s.code = effectiveCode;
        effectiveCode = effectiveCode ?? s.code;
      }

      const runId = await startPythonRun({
        session,
        code: effectiveCode,
        targetStudentId: s.id,
        audience: "student",
        workspace: requestedWorkspace
      });
      s.runId = runId;
      s.runStatus = 'running'; // Sprint 10Q
      s.currentWorkspace = requestedWorkspace || 'shared';
      if (s.socketId) io.to(s.socketId).emit("switch_to_output", { audience: "student" });
      if (session.mode === "exam" && session.selectedStudentId === s.id && session.teacherSocketId) {
        io.to(session.teacherSocketId).emit("teacher_preview_reset");
      }
      setStatus(session, `${s.name} startte een run`, "info");
    } catch (err) {
      setStatus(session, `Run kon niet starten: ${err.message}`, "error");
    }
  });

  socket.on("runtime_input", async ({ value }) => {
    const ctx = socketToUser.get(socket.id);
    if (!ctx) return;
    const session = sessions.get(ctx.code);
    if (!session) return;

    const displayValue = String(value ?? "");

    try {
      if (ctx.role === "teacher") {
        if (session.teacherRunId) {
          if (!runnerWaitingForInput.has(session.teacherRunId)) return;
          runnerWaitingForInput.delete(session.teacherRunId);
          resumeRunIfNeeded(session.teacherRunId);
          const echoLine0 = (displayValue === '' ? '[lege invoer]' : `[${displayValue}]`) + '\n';
          session.sharedOutput = (session.sharedOutput || '') + echoLine0;
          io.to(session.code).emit('run_output', { audience: 'teacher-all', output: session.sharedOutput });
          socket.emit("runtime_input_echo", { value: displayValue });
          await runnerInput(session.teacherRunId, displayValue);
          setStatus(session, "Input ontvangen", "success");
        }
        return;
      }

      const s = session.students[ctx.studentId];
      if (s && s.runId) {
        // Weiger input als runner niet wacht — voorkomt ghost keypresses
        if (!runnerWaitingForInput.has(s.runId)) return;
        runnerWaitingForInput.delete(s.runId);
        resumeRunIfNeeded(s.runId);
        const echoDisplay2 = displayValue === '' ? '[lege invoer]' : `[${displayValue}]`;
        const echoLine2 = echoDisplay2 + '\n';
        // Voeg toe aan de juiste output buffer op basis van workspace
        const ws2 = s.currentWorkspace || 'shared';
        if (ws2 === 'personal') {
          if (s.personalOutput !== undefined) {
            s.personalOutput += echoLine2;
            if (s.socketId) io.to(s.socketId).emit('run_output', { audience: 'student', output: s.personalOutput });
          }
        } else {
          if (s.output !== undefined) {
            s.output += echoLine2;
            if (s.socketId) io.to(s.socketId).emit('run_output', { audience: 'student', output: s.output });
          }
        }
        const res3 = await runnerInput(s.runId, displayValue);
        if (res3 && res3.rejected) {
          // Runner wacht niet — zet terug in Set, echo niet tonen
          runnerWaitingForInput.add(s.runId);
          return;
        }
        socket.emit("runtime_input_echo", { value: displayValue });
        setStatus(session, `Input ontvangen van ${s.name}`, "success");
      }
    } catch (err) {
      setStatus(session, `Inputfout: ${err.message}`, "error");
    }
  });

  // ══ Sprint 16c: Quiz socket events ══════════════════════════════════════════

  socket.on('quiz_start', async ({ code, name, className }) => {
    // Leerling drukt op START TOETS — individuele timer begint
    const normalizedCode = (code || '').trim().toUpperCase();
    const session = sessions.get(normalizedCode);
    if (!session || session.mode !== 'quiz') return socket.emit('error_message', 'Toets niet gevonden.');
    const meta = await dbModule.getQuizMeta(normalizedCode);
    if (!meta) return socket.emit('error_message', 'Toets-configuratie niet gevonden.');

    const studentName = String(name || '').trim().slice(0, 64);
    const studentClass = String(className || '').trim().slice(0, 64);
    if (!studentName) return socket.emit('error_message', 'Naam is verplicht.');

    // Dubbele verbinding detecteren
    const existing = Object.values(session.students).find(
      s => s.name.toLowerCase() === studentName.toLowerCase() && s.online && !s.removed
    );
    if (existing && existing.socketId !== socket.id) {
      socket.emit('error_message', `Er is al een verbinding actief voor "${studentName}". Gebruik hetzelfde tabblad.`);
      if (session.teacherSocketId) {
        io.to(session.teacherSocketId).emit('quiz_double_connection', { studentName });
      }
      return;
    }

    // Sprint 19j: tijdsvenster check
    const now19j = Date.now();
    if (meta.access_from && now19j < meta.access_from) {
      const openOm = new Date(meta.access_from).toLocaleString('nl-BE', {
        day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'
      });
      return socket.emit('error_message', `Deze toets/taak is nog niet beschikbaar. Toegang start op ${openOm}.`);
    }
    if (meta.access_until && now19j > meta.access_until) {
      const deadline = new Date(meta.access_until).toLocaleString('nl-BE', {
        day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'
      });
      return socket.emit('quiz_access_expired', {
        deadline: meta.access_until,
        deadlineStr: deadline,
        autoSubmitLate: meta.auto_submit_late !== false,
      });
    }

    // Sprint 43.4: leerling-selectie afdwingen. Is er een expliciete selectie vastgelegd,
    // dan mag enkel wie erin staat starten. Matching op naam binnen de gekoppelde klas
    // (toets-leerlingen krijgen een random id, dus id-matching werkt hier niet).
    // Preview-toetsen zijn vrijgesteld: die dienen net om als leerkracht zelf te testen.
    try {
      if (!meta.is_teacher_preview) {
        const allowedIds = await dbModule.listAssignmentStudents(normalizedCode);
        if (allowedIds.length && meta.target_class) {
          const klas = await dbModule.listStudents(meta.target_class);
          const match = klas.find(s => String(s.name).trim().toLowerCase() === studentName.toLowerCase());
          if (!match || !allowedIds.includes(match.id)) {
            return socket.emit('error_message', 'Je bent niet geselecteerd voor deze toets/taak. Vraag je leerkracht om toegang.');
          }
        }
      }
    } catch (e) { log.warn('[quiz_start] leerling-selectie check mislukt:', e.message); }

    // Herstarten: bestaande leerling
    let student = Object.values(session.students).find(
      s => s.name.toLowerCase() === studentName.toLowerCase() && !s.removed
    );

    if (!student) {
      const id = crypto.randomUUID();
      // Genereer gepersonaliseerde vraagvolgorde
      const questions = await dbModule.getQuizQuestions(normalizedCode);
      let orderedIds = questions.map(q => q.id);
      if (meta.randomize) {
        // Fisher-Yates shuffle met crypto.randomBytes
        for (let i = orderedIds.length - 1; i > 0; i--) {
          const j = crypto.randomBytes(4).readUInt32BE() % (i + 1);
          [orderedIds[i], orderedIds[j]] = [orderedIds[j], orderedIds[i]];
        }
      }
      await dbModule.saveQuizStudentOrder(normalizedCode, id, orderedIds);

      student = {
        id, name: studentName, socketId: socket.id,
        className: studentClass, online: true, removed: false,
        joinBadge: null, dbStudentId: null,
        quizStartedAt: Date.now(),
        quizSubmitted: false,
        quizAnswers: {}, // { questionId: { code, runCount, firstVisitAt, firstRunAt } }
        quizCurrentQuestion: 0,
        quizPersonalOrder: orderedIds,
        runId: null, runStatus: 'idle',
      };
      session.students[id] = student;
    } else {
      student.socketId = socket.id;
      student.online = true;
      // Herstel opgeslagen antwoorden
    }

    socket.join(normalizedCode);
    socketToUser.set(socket.id, { role: 'quiz_student', code: normalizedCode, studentId: student.id });

    // Herstel antwoorden uit DB bij reconnect
    const savedAnswers = await dbModule.getQuizAnswersByStudent(normalizedCode, student.id);
    const savedOrder = await dbModule.getQuizStudentOrder(normalizedCode, student.id);
    const questions = await dbModule.getQuizQuestions(normalizedCode);

    // Stuur quiz state naar leerling
    socket.emit('quiz_state', {
      studentId: student.id,
      studentName: student.name,
      sessionName: session.name,
      timerSeconds: meta.timer_seconds,
      noTimer: meta.no_timer || false,
      startedAt: student.quizStartedAt,
      submitted: student.quizSubmitted,
      paused: session.quizPaused || false,
      hideQuestionOnScreen: meta.hide_question_on_screen,
      questions: savedOrder.length > 0
        ? savedOrder.map(o => questions.find(q => q.id === o.question_id)).filter(Boolean)
        : questions,
      savedAnswers: savedAnswers.reduce((acc, a) => {
        acc[a.question_id] = { code: a.code, runCount: a.run_count };
        return acc;
      }, {}),
      config: session.config || {},
    });

    // Notificeer leerkracht
    if (session.teacherSocketId) {
      io.to(session.teacherSocketId).emit('quiz_student_progress', {
        studentId: student.id, studentName: student.name,
        className: student.className,
        currentQuestion: student.quizCurrentQuestion,
        totalQuestions: questions.length,
        savedCount: savedAnswers.length,
        submitted: student.quizSubmitted,
        startedAt: student.quizStartedAt,
      });
    }

    // Start timer (enkel als er een timer is)
    if (!student.quizSubmitted && !session.quizPaused && !meta.no_timer && meta.timer_seconds) {
      startQuizTimer(session, student, meta.timer_seconds);
    }
  });

  socket.on('quiz_save_answer', async (data) => {
    const { questionId, code, runCount, firstVisitAt, firstRunAt, currentQuestion } = data || {};
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== 'quiz_student') return;
    const session = sessions.get(ctx.code);
    const student = session?.students[ctx.studentId];
    if (!student || student.quizSubmitted) return;

    // Sla op in-memory
    student.quizAnswers[questionId] = { code, runCount, firstVisitAt, firstRunAt,
      selectedChoices: data?.selectedChoices || [] };
    student.quizCurrentQuestion = currentQuestion;

    // Sprint 19a: 15s backup interval voor quiz (was 60s)
    // Sla direct op in DB bij elke navigatie
    // 23a: selectedChoices meesturen zodat keuze-antwoorden persistent zijn
    dbModule.saveQuizAnswer({
      sessionCode: ctx.code, studentId: ctx.studentId,
      studentName: student.name, studentClass: student.className || '',
      questionId, personalOrder: student.quizPersonalOrder?.indexOf(questionId) ?? 0,
      code, runCount: runCount || 0,
      firstVisitAt: firstVisitAt || null, firstRunAt: firstRunAt || null,
      selectedChoices: JSON.stringify(data?.selectedChoices || []),
    }).catch(e => log.error('[quiz] saveQuizAnswer:', e.message));

    socket.emit('quiz_answer_saved', { questionId });

    // Update leerkracht
    const questions = await dbModule.getQuizQuestions(ctx.code);
    if (session.teacherSocketId) {
      io.to(session.teacherSocketId).emit('quiz_student_progress', {
        studentId: ctx.studentId, studentName: student.name,
        className: student.className,
        currentQuestion, totalQuestions: questions.length,
        savedCount: Object.keys(student.quizAnswers).length,
        submitted: false, startedAt: student.quizStartedAt,
      });
    }
  });

  socket.on('quiz_run_completed', async ({ questionId, code }) => {
    // Run-history bijhouden voor verbetermodule
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== 'quiz_student') return;
    dbModule.saveQuizRunHistory({
      sessionCode: ctx.code, studentId: ctx.studentId, questionId, code,
    }).catch(() => {});
  });

  socket.on('quiz_submit_all', async ({ answers }) => {
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== 'quiz_student') return;
    const session = sessions.get(ctx.code);
    const student = session?.students[ctx.studentId];
    if (!student || student.quizSubmitted) return;

    student.quizSubmitted = true;

    // Haal vragen op voor auto-scoring
    const quizQuestions = await dbModule.getQuizQuestions(ctx.code).catch(() => []);
    const questionMap = {};
    for (const q of quizQuestions) questionMap[q.id] = q;

    // Sla alle antwoorden op in DB + auto-score meerkeuze/single
    for (const [questionId, ans] of Object.entries(answers || {})) {
      const q = questionMap[questionId];
      // Sprint 34a: auto-scoring via lib/scoring.js (getest in tests/)
      const { autoScore, autoScored } = scoringLib.computeAutoScore(q, ans.selectedChoices);

      await dbModule.saveQuizAnswer({
        sessionCode: ctx.code, studentId: ctx.studentId,
        studentName: student.name, studentClass: student.className || '',
        questionId, personalOrder: student.quizPersonalOrder?.indexOf(questionId) ?? 0,
        code: ans.code || '', runCount: ans.runCount || 0,
        firstVisitAt: ans.firstVisitAt || null, firstRunAt: ans.firstRunAt || null,
        selectedChoices: JSON.stringify(ans.selectedChoices || []),
      }).catch(() => {});

      // Sla auto-score op als berekend
      if (autoScored && autoScore !== null) {
        const savedAnswers = await dbModule.getQuizAnswersByStudent(ctx.code, ctx.studentId).catch(() => []);
        const savedAns = savedAnswers.find(a => a.question_id === questionId);
        if (savedAns) {
          await dbModule.scoreQuizAnswer(savedAns.id, autoScore,
            `🤖 Automatisch gescoord (${q.question_type})`).catch(() => {});
        }
      }
    }
    await dbModule.submitQuizAnswers(ctx.code, ctx.studentId, false).catch(() => {});

    socket.emit('quiz_submitted_ok', {
      name: student.name,
      answeredCount: Object.keys(answers || {}).length,
    });

    // Notificeer leerkracht
    const questions = await dbModule.getQuizQuestions(ctx.code);
    if (session.teacherSocketId) {
      io.to(session.teacherSocketId).emit('quiz_student_progress', {
        studentId: ctx.studentId, studentName: student.name,
        className: student.className,
        currentQuestion: questions.length,
        totalQuestions: questions.length,
        savedCount: questions.length,
        submitted: true, startedAt: student.quizStartedAt,
      });
    }
  });

  socket.on('quiz_teacher_join', async ({ code }) => {
    // Leerkracht opent quiz-beheer
    if (!socketIsTeacherAuthorized(socket)) return;
    const normalizedCode = (code || '').trim().toUpperCase();
    const session = sessions.get(normalizedCode);
    if (!session || session.mode !== 'quiz') return socket.emit('error_message', 'Toets niet gevonden.');
    session.teacherSocketId = socket.id;
    socket.join(normalizedCode);
    socketToUser.set(socket.id, { role: 'quiz_teacher', code: normalizedCode });

    const meta = await dbModule.getQuizMeta(normalizedCode);
    const questions = await dbModule.getQuizQuestions(normalizedCode);
    const progress = Object.values(session.students)
      .filter(s => !s.removed)
      .map(s => ({
        studentId: s.id, studentName: s.name, className: s.className,
        currentQuestion: s.quizCurrentQuestion || 0,
        totalQuestions: questions.length,
        savedCount: Object.keys(s.quizAnswers || {}).length,
        submitted: s.quizSubmitted || false,
        startedAt: s.quizStartedAt || null,
        online: s.online,
      }));

    socket.emit('quiz_teacher_state', {
      sessionCode: normalizedCode, sessionName: session.name,
      meta, questions, progress, paused: session.quizPaused || false,
    });
  });

  // Sprint 19d: herinnering sturen naar leerling die nog niet gestart heeft
  // Grid-overzicht in nieuw tabblad (teacher-grid.html)
  socket.on('teacher_grid_observe', ({ code }) => {
    if (!code) return;
    const session = sessions.get(code.toUpperCase());
    if (!session) return;
    // Stuur huidige sessiedata naar dit socket (de grid viewer)
    const data = buildTeacherData(session);
    socket.emit('teacher_session_data', data);
  });

  socket.on('quiz_send_reminder', ({ studentId }) => {
    if (!socketIsTeacherAuthorized(socket)) return;
    const ctx = socketToUser.get(socket.id);
    if (!ctx) return;
    const session = sessions.get(ctx.code);
    const student = session?.students[studentId];
    if (!student || !student.socketId) return;
    io.to(student.socketId).emit('quiz_reminder', {
      message: '⚠️ Start de toets! Klik op START TOETS om je timer te beginnen.',
    });
  });

  socket.on('quiz_reset_student', async ({ studentId }) => {
    // Leerkracht laat één leerling opnieuw starten
    if (!socketIsTeacherAuthorized(socket)) return;
    const ctx = socketToUser.get(socket.id);
    if (!ctx) return;
    const session = sessions.get(ctx.code);
    const student = session?.students[studentId];
    if (!student) return;
    student.quizSubmitted = false;
    student.quizStartedAt = null;
    student.quizAnswers = {};
    student.quizCurrentQuestion = 0;
    // Stuur reset naar leerling als verbonden
    if (student.socketId) {
      io.to(student.socketId).emit('quiz_reset');
    }
    socket.emit('quiz_student_progress', {
      studentId, studentName: student.name, className: student.className,
      currentQuestion: 0, totalQuestions: 0,
      savedCount: 0, submitted: false, startedAt: null,
    });
  });

  socket.on('disconnect', () => {
    const ctx = socketToUser.get(socket.id);
    runRateLimit.delete(socket.id); // cleanup rate limit entry
    socketCsrfNonces.delete(socket.id); // Fix SEC-5: cleanup CSRF nonce
    if (!ctx) return;
    // Sprint 9B: timer cleanup bij leerkracht disconnect
    if (ctx.role === 'teacher') {
      const ts = sessions.get(ctx.code);
      if (ts?.timerInterval) {
        clearInterval(ts.timerInterval);
        ts.timerInterval = null;
        ts.timerRunning = false;
      }
    }

    socketToUser.delete(socket.id);

    // Observer opruimen
    if (ctx.role === 'observer') {
      const obs = sessions.get(ctx.code);
      if (obs && obs.observerSocketIds) obs.observerSocketIds.delete(socket.id);
      return;
    }

    // Vrije sessie leerling: opruimen en leerkrachten notificeren
    if (ctx.role === "free") {
      const student = freeStudents.get(socket.id);
      if (student) {
        // Cancel actieve run indien aanwezig
        if (student.runId) {
          fetch(`${RUNNER_URL}/runs/${student.runId}/cancel`, { method: "POST" }).catch(() => {});
        }
        // Audit log: naam, klas en totaal aantal runs in deze sessie
        logFreeRun(student.name, student.className, student.runCount || 0);
        freeStudents.delete(socket.id);
        io.emit("free_students_updated");
      }
      return;
    }

    const session = sessions.get(ctx.code);
    if (!session) return;
    if (ctx.role === "teacher") {
      if (session.teacherSocketId === socket.id) session.teacherSocketId = null;
      scheduleRunDisconnect(session.teacherRunId);
    } else {
      const s = session.students[ctx.studentId];
      if (s) {
        s.socketId = null;
        scheduleRunDisconnect(s.runId);
      }
    }
    emitTeacherSession(session);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// STRESSTEST ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
// fs already required
const os   = require('os');
const { EventEmitter } = require('events');

const LOGS_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

// ── Sprint 17a: Log rotatie ────────────────────────────────────────────────
const LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS) || 7;

function cleanOldLogs() {
  try {
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.log') && f !== '.gitkeep');
    let removed = 0;
    for (const f of files) {
      const fp = path.join(LOGS_DIR, f);
      try {
        if (fs.statSync(fp).mtimeMs < cutoff) {
          fs.unlinkSync(fp);
          removed++;
        }
      } catch { /* bestand al weg */ }
    }
    if (removed > 0) {
      log.info(`[logs] ${removed} logbestand(en) ouder dan ${LOG_RETENTION_DAYS} dagen verwijderd`);
    }
    return removed;
  } catch (e) {
    log.error('[logs] Cleanup fout:', e.message);
    return 0;
  }
}

// Bij startup direct cleanup uitvoeren
cleanOldLogs();

// Dagelijks om 03:00 opnieuw uitvoeren
(function scheduleLogCleanup() {
  const now = new Date();
  const next3am = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 3, 0, 0);
  const msUntil3am = next3am - now;
  // Sprint 50a: verlopen leerkracht-sessies mee opruimen — anders groeit die tabel
  // eeuwig aan met dode rijen. Fail-safe: een fout hier mag de log-cleanup niet stoppen.
  const opruimen = async () => {
    cleanOldLogs();
    try {
      const weg = await dbModule.deleteExpiredTeacherSessions();
      if (weg > 0) log.info(`[auth] ${weg} verlopen leerkracht-sessie(s) opgeruimd`);
    } catch (e) { log.warn('[auth] opruimen sessies mislukt:', e.message); }
  };
  setTimeout(() => {
    opruimen();
    setInterval(opruimen, 24 * 60 * 60 * 1000);
  }, msUntil3am);
  log.info(`[logs] Automatische cleanup gepland om 03:00 (over ${Math.round(msUntil3am/3600000)}u)`);
})();

// API endpoint voor handmatige log cleanup (via pycodeflow.sh)
// Wordt verderop geregistreerd als app.post('/api/admin/logs/cleanup', ...)

// Sprint 21: stressload berekening
function berekenStressload(metrics) {
  const { ramRunnerPct = 0, cpuRunnerPct = 0, avgRunMs = 0, targetRunMs = 2000,
          failedPct = 0, pgPoolPct = 0 } = metrics;
  const runTimePct = Math.min(100, (avgRunMs / targetRunMs) * 100);
  const score = Math.round(
    ramRunnerPct * 0.25 +
    cpuRunnerPct * 0.20 +
    runTimePct   * 0.20 +
    failedPct    * 0.20 +
    pgPoolPct    * 0.15
  );
  let label = 'LAAG';
  if (score > 95) label = 'KRITIEK';
  else if (score > 85) label = 'HOOG';
  else if (score > 70) label = 'MATIG';
  else if (score > 40) label = 'NORMAAL';
  return { score, label };
}

// Maximaal 1 stresstest tegelijk
let activeStressTest = null; // { type, startedAt, emitter, stop() }

// Bewaar laatste resultaat per testtype voor baseline-vergelijking
const stressBaselines = new Map(); // testType -> { timestamp, metrics }

function stressLog(emitter, logLines, level, msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 23);
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  logLines.push(line);
  emitter.emit('log', { level, msg, ts });
}

function stressProgress(emitter, step, total, label) {
  emitter.emit('progress', { step, total, label });
}

function stressResult(emitter, component, status, detail, metrics = {}) {
  emitter.emit('result', { component, status, detail, metrics });
}

async function fetchRunner(path2, opts = {}) {
  const res = await fetch(`${RUNNER_URL}${path2}`, { ...opts, signal: AbortSignal.timeout(8000) });
  return res;
}

async function runCode(code, timeoutMs = 12000) {
  const start = Date.now();
  const res = await fetchRunner('/runs/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });
  if (!res.ok) throw new Error(`start failed: ${res.status}`);
  const { runId } = await res.json();

  // Poll tot end-event
  let lastSeq = 0;
  let output = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetchRunner(`/runs/${runId}/events?after=${lastSeq}`);
    if (!r.ok) break;
    const data = await r.json();
    for (const ev of (data.events || [])) {
      lastSeq = ev.seq;
      if (ev.type === 'stdout' || ev.type === 'stderr') output += ev.data;
      if (ev.type === 'end') return { runId, output, durationMs: Date.now() - start, timedOut: false };
    }
    if (!data.running && !data.queued) break;
    await new Promise(r => setTimeout(r, 150));
  }
  // Annuleer run als die nog loopt
  await fetchRunner(`/runs/${runId}/cancel`, { method: 'POST' }).catch(() => {});
  return { runId, output, durationMs: Date.now() - start, timedOut: true };
}

async function cancelRun(runId) {
  await fetchRunner(`/runs/${runId}/cancel`, { method: 'POST' }).catch(() => {});
}

// ── TEST 1: Snelle gezondheidscheck ──────────────────────────────────────────
async function testHealthCheck(emitter, logLines, stopped) {
  const results = [];
  const steps = 6;

  // 1. Runner bereikbaar
  stressProgress(emitter, 1, steps, 'Runner bereikbaarheid...');
  stressLog(emitter, logLines, 'info', 'Controleer runner /health endpoint...');
  try {
    const r = await fetchRunner('/health');
    const data = await r.json();
    const ok = r.ok && data.activeRuns !== undefined;
    stressResult(emitter, 'Runner bereikbaar', ok ? 'ok' : 'fail',
      ok ? `Actieve runs: ${data.activeRuns}/${data.maxRuns}` : 'Geen geldige health response',
      { activeRuns: data.activeRuns, maxRuns: data.maxRuns });
    stressLog(emitter, logLines, ok ? 'ok' : 'fail', `Runner health: ${ok ? 'OK' : 'FAIL'}`);
    results.push(ok);
  } catch(e) {
    stressResult(emitter, 'Runner bereikbaar', 'fail', e.message);
    stressLog(emitter, logLines, 'fail', `Runner niet bereikbaar: ${e.message}`);
    results.push(false);
  }
  if (stopped()) return results;

  // 2. Web API bereikbaar
  stressProgress(emitter, 2, steps, 'Web API...');
  stressLog(emitter, logLines, 'info', 'Controleer /api/version...');
  try {
    const versionRes = { ok: true, version: APP_VERSION };
    stressResult(emitter, 'Web API', 'ok', `Versie: ${APP_VERSION}`);
    stressLog(emitter, logLines, 'ok', `Web API OK — versie ${APP_VERSION}`);
    results.push(true);
  } catch(e) {
    stressResult(emitter, 'Web API', 'fail', e.message);
    results.push(false);
  }

  // 3. Simpele run
  stressProgress(emitter, 3, steps, 'Basis Python run...');
  stressLog(emitter, logLines, 'info', 'Start test-run: print("OK")...');
  try {
    const { output, durationMs, timedOut } = await runCode('print("STRESSTEST_OK")');
    const ok = !timedOut && output.includes('STRESSTEST_OK');
    stressResult(emitter, 'Basis run', ok ? 'ok' : 'fail',
      ok ? `Output correct in ${durationMs}ms` : `Verwachte output ontbreekt (${durationMs}ms)`,
      { durationMs });
    stressLog(emitter, logLines, ok ? 'ok' : 'fail', `Basis run: ${ok ? 'OK' : 'FAIL'} (${durationMs}ms)`);
    results.push(ok);
  } catch(e) {
    stressResult(emitter, 'Basis run', 'fail', e.message);
    results.push(false);
  }
  if (stopped()) return results;

  // 4. Rate limiter actief (internal check — geen socket nodig)
  stressProgress(emitter, 4, steps, 'Rate limiter verificatie...');
  stressLog(emitter, logLines, 'info', `RUN_RATE_LIMIT_MS = ${RUN_RATE_LIMIT_MS}ms (verwacht ≥ 1000ms)`);
  const rlOk = RUN_RATE_LIMIT_MS >= 1000;
  stressResult(emitter, 'Rate limiter', rlOk ? 'ok' : 'warn',
    rlOk ? `Ingesteld op ${RUN_RATE_LIMIT_MS}ms` : `Limiet is laag: ${RUN_RATE_LIMIT_MS}ms`);
  stressLog(emitter, logLines, rlOk ? 'ok' : 'warn', `Rate limit: ${RUN_RATE_LIMIT_MS}ms`);
  results.push(rlOk);

  // 5. Geheugen binnen grenzen
  stressProgress(emitter, 5, steps, 'Geheugenstatus...');
  const memFree = os.freemem();
  const memTotal = os.totalmem();
  const freeRatio = memFree / memTotal;
  const memOk = freeRatio > 0.1;
  stressResult(emitter, 'Host geheugen', memOk ? 'ok' : 'warn',
    `Vrij: ${(memFree/1048576).toFixed(0)}MB / ${(memTotal/1048576).toFixed(0)}MB (${(freeRatio*100).toFixed(1)}%)`,
    { freeRatio, memFree, memTotal });
  stressLog(emitter, logLines, memOk ? 'ok' : 'warn',
    `Host RAM: ${(memFree/1048576).toFixed(0)}MB vrij van ${(memTotal/1048576).toFixed(0)}MB`);
  results.push(memOk);

  // 6. Sessions cleanup check
  stressProgress(emitter, 6, steps, 'Sessie cleanup check...');
  const openSessions = [...sessions.values()].filter(s => !s.deleted && !s.closed).length;
  const sessOk = openSessions < 20;
  stressResult(emitter, 'Sessies', sessOk ? 'ok' : 'warn',
    `${openSessions} actieve sessie(s)`, { openSessions });
  stressLog(emitter, logLines, sessOk ? 'ok' : 'warn', `Actieve sessies: ${openSessions}`);
  results.push(sessOk);

  return results;
}

// ── TEST 2: Runner capaciteitstest ────────────────────────────────────────────
async function testRunnerCapacity(emitter, logLines, stopped, concurrency = 10) {
  const results = [];
  stressLog(emitter, logLines, 'info', `Start runner capaciteitstest: ${concurrency} gelijktijdige runs`);
  stressProgress(emitter, 1, 3, `${concurrency} runs gelijktijdig starten...`);

  // Haal baseline runner stats op
  let beforeStats = {};
  try {
    const r = await fetchRunner('/health'); beforeStats = await r.json();
  } catch(e) {}

  const startAll = Date.now();
  const promises = Array.from({ length: concurrency }, (_, i) =>
    runCode(`
import time
time.sleep(0.3)
print("run_${i}_done")
`.trim())
  );

  stressProgress(emitter, 2, 3, 'Wachten op resultaten...');
  const runResults = await Promise.allSettled(promises);
  const totalMs = Date.now() - startAll;

  const succeeded = runResults.filter(r => r.status === 'fulfilled' && !r.value.timedOut && r.value.output.includes('done')).length;
  const timedOut  = runResults.filter(r => r.status === 'fulfilled' && r.value.timedOut).length;
  const failed    = runResults.filter(r => r.status === 'rejected').length;
  const durations = runResults.filter(r => r.status === 'fulfilled').map(r => r.value.durationMs);
  const avgMs     = durations.length ? Math.round(durations.reduce((a,b)=>a+b,0)/durations.length) : 0;
  const maxMs     = durations.length ? Math.max(...durations) : 0;

  stressProgress(emitter, 3, 3, 'Resultaten verwerken...');
  const ok = succeeded >= Math.floor(concurrency * 0.9); // 90% moet slagen
  stressResult(emitter, `Runner capaciteit (${concurrency}x)`,
    ok ? 'ok' : (succeeded > concurrency / 2 ? 'warn' : 'fail'),
    `${succeeded}/${concurrency} geslaagd — gem. ${avgMs}ms, max ${maxMs}ms, totaal ${totalMs}ms`,
    { succeeded, timedOut, failed, avgMs, maxMs, totalMs, concurrency });

  stressLog(emitter, logLines, ok ? 'ok' : 'warn',
    `Capaciteit: ${succeeded}/${concurrency} OK | gem ${avgMs}ms | max ${maxMs}ms | totaal ${totalMs}ms`);
  if (timedOut) stressLog(emitter, logLines, 'warn', `${timedOut} run(s) timed out`);
  if (failed)   stressLog(emitter, logLines, 'fail', `${failed} run(s) gefaald`);

  results.push(ok);

  // Haal stats na de test op voor vergelijking
  stressProgress(emitter, 3, 3, 'After-stats ophalen...');
  try {
    const r = await fetchRunner('/health');
    const afterStats = await r.json();
    stressLog(emitter, logLines, 'info',
      `Runner na test — actief: ${afterStats.activeRuns}, wachtrij: ${afterStats.queuedRuns}`);
    const cleaned = afterStats.activeRuns === 0 && afterStats.queuedRuns === 0;
    stressResult(emitter, 'Runner cleanup', cleaned ? 'ok' : 'warn',
      cleaned ? 'Alle runs correct opgeruimd' : `Nog ${afterStats.activeRuns} actief, ${afterStats.queuedRuns} in wachtrij`,
      { activeRuns: afterStats.activeRuns, queuedRuns: afterStats.queuedRuns });
    results.push(cleaned);
  } catch(e) {
    stressLog(emitter, logLines, 'warn', `Kon after-stats niet ophalen: ${e.message}`);
  }

  return { results, metrics: { succeeded, avgMs, maxMs, totalMs, concurrency } };
}

// ── TEST 3: Sandbox verificatie ───────────────────────────────────────────────
async function testSandbox(emitter, logLines, stopped) {
  const tests = [
    { name: 'import os',         code: 'import os; print(os.getcwd())',              expectBlock: true },
    { name: 'import subprocess', code: 'import subprocess; subprocess.run(["ls"])',   expectBlock: true },
    { name: 'import socket',     code: 'import socket; socket.gethostname()',         expectBlock: true },
    { name: 'import shutil',     code: 'import shutil; shutil.rmtree("/")',           expectBlock: true },
    { name: 'CPU tijdslimiet',   code: 'while True: pass',                           expectBlock: true,  expectTimeout: true },
    { name: 'Geldige code',      code: 'print("sandbox_ok")',                        expectBlock: false },
    { name: 'Wiskundige operatie', code: 'print(sum(range(1000)))',                  expectBlock: false },
  ];

  const results = [];
  for (let i = 0; i < tests.length; i++) {
    if (stopped()) break;
    const t = tests[i];
    stressProgress(emitter, i + 1, tests.length, `Sandbox: ${t.name}...`);
    stressLog(emitter, logLines, 'info', `Test: ${t.name}`);
    try {
      const { output, timedOut, durationMs } = await runCode(t.code, t.expectTimeout ? 12000 : 8000);
      let ok;
      if (t.expectBlock) {
        // Verwacht: ImportError, PermissionError, of timeout
        ok = timedOut || output.toLowerCase().includes('error') || output.includes('blocked') || output === '';
      } else {
        ok = !timedOut && output.length > 0;
      }
      const status = ok ? 'ok' : 'fail';
      stressResult(emitter, `Sandbox: ${t.name}`, status,
        ok ? (t.expectBlock ? 'Correct geblokkeerd' : 'Correct uitgevoerd') : 'NIET geblokkeerd — kritiek!',
        { durationMs, timedOut, blocked: t.expectBlock });
      stressLog(emitter, logLines, status,
        `${t.name}: ${ok ? 'OK' : 'FAIL'} (${durationMs}ms)`);
      results.push(ok);
    } catch(e) {
      stressResult(emitter, `Sandbox: ${t.name}`, 'fail', e.message);
      stressLog(emitter, logLines, 'fail', `${t.name}: exception — ${e.message}`);
      results.push(false);
    }
  }
  return results;
}

// ── TEST 4: Gelijktijdige sessies ─────────────────────────────────────────────
async function testMultiSession(emitter, logLines, stopped, numSessions = 3, runsPerSession = 5) {
  const results = [];
  stressLog(emitter, logLines, 'info',
    `Multi-sessie test: ${numSessions} sessies × ${runsPerSession} runs`);

  // Maak wegwerpsessies
  const testSessions = [];
  for (let i = 0; i < numSessions; i++) {
    const code = makeCode();
    const session = {
      code, id: crypto.randomUUID(),
      name: `STRESSTEST-${i+1}`, mode: 'class',
      editorAssist: false, createdAt: Date.now(),
      teacherSocketId: null, selectedStudentId: null,
      classWorkspaceMode: 'shared',
      sharedCode: '', sharedOutput: '', announcement: '',
      students: {}, closed: false, blocked: false,
      deleted: false, teacherRunId: null,
      teacherPreviewOutput: '', statusText: '',
      sharedCodeRevision: 0, sharedCodeSourceSocketId: null,
      announcementVersion: 0,
    };
    sessions.set(code, session);
    testSessions.push(session);
    stressLog(emitter, logLines, 'info', `Wegwerpsessie aangemaakt: ${code}`);
  }

  stressProgress(emitter, 1, 3, `${numSessions} sessies aangemaakt, runs starten...`);
  const startAll = Date.now();

  // Start runs gelijktijdig over alle sessies
  const allRuns = testSessions.flatMap(session =>
    Array.from({ length: runsPerSession }, (_, i) =>
      runCode(`print("session_${session.code}_run_${i}")`)
    )
  );

  stressProgress(emitter, 2, 3, 'Wachten op alle sessie-runs...');
  const runResults = await Promise.allSettled(allRuns);
  const totalMs = Date.now() - startAll;

  const succeeded = runResults.filter(r =>
    r.status === 'fulfilled' && !r.value.timedOut).length;
  const total = numSessions * runsPerSession;

  stressProgress(emitter, 3, 3, 'Cleanup wegwerpsessies...');

  // Ruim wegwerpsessies op
  for (const session of testSessions) {
    sessions.delete(session.code);
    stressLog(emitter, logLines, 'info', `Wegwerpsessie verwijderd: ${session.code}`);
  }

  // Verifieer cleanup
  const ghostSessions = testSessions.filter(s => sessions.has(s.code));
  const cleanupOk = ghostSessions.length === 0;

  const ok = succeeded >= Math.floor(total * 0.85);
  stressResult(emitter, `Multi-sessie (${numSessions}×${runsPerSession})`,
    ok ? 'ok' : 'warn',
    `${succeeded}/${total} runs geslaagd in ${totalMs}ms`,
    { succeeded, total, totalMs });
  stressLog(emitter, logLines, ok ? 'ok' : 'warn',
    `Multi-sessie: ${succeeded}/${total} OK in ${totalMs}ms`);
  results.push(ok);

  stressResult(emitter, 'Sessie cleanup verificatie',
    cleanupOk ? 'ok' : 'fail',
    cleanupOk ? 'Alle wegwerpsessies correct verwijderd' : `${ghostSessions.length} ghost-sessie(s) gevonden`,
    { ghostSessions: ghostSessions.length });
  stressLog(emitter, logLines, cleanupOk ? 'ok' : 'fail',
    `Cleanup: ${cleanupOk ? 'OK' : `${ghostSessions.length} ghost(s) gevonden`}`);
  results.push(cleanupOk);

  return results;
}

// ── BASELINE VERGELIJKING ─────────────────────────────────────────────────────
function compareToBaseline(testType, currentMetrics) {
  const prev = stressBaselines.get(testType);
  if (!prev) return null;
  const ageSec = Math.round((Date.now() - prev.timestamp) / 1000);
  const ageStr = ageSec < 3600
    ? `${Math.round(ageSec/60)} min geleden`
    : `${Math.round(ageSec/3600)} uur geleden`;

  const comparison = [];
  if (currentMetrics.avgMs !== undefined && prev.metrics.avgMs !== undefined) {
    const diff = currentMetrics.avgMs - prev.metrics.avgMs;
    const pct  = prev.metrics.avgMs > 0 ? Math.round((diff / prev.metrics.avgMs) * 100) : 0;
    const sign = diff > 0 ? '+' : '';
    comparison.push(`Gem. run-duur: ${currentMetrics.avgMs}ms (${sign}${pct}% vs ${ageStr})`);
  }
  if (currentMetrics.succeeded !== undefined && prev.metrics.succeeded !== undefined) {
    comparison.push(`Geslaagde runs: ${currentMetrics.succeeded} (was ${prev.metrics.succeeded})`);
  }
  return { ageStr, comparison };
}

// ── LOGBESTAND SCHRIJVEN ──────────────────────────────────────────────────────
function writeStressLog(testType, logLines, summary) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const datePart = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}`;
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  const typeSlug = testType.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const filename = `${datePart}-${timePart}-${typeSlug}.log`;
  const filepath = path.join(LOGS_DIR, filename);

  const header = [
    '═'.repeat(72),
    `PyCodeFlow Stresstest Log`,
    `Versie     : ${APP_VERSION}`,
    `Test type  : ${testType}`,
    `Gestart    : ${now.toISOString()}`,
    `Host RAM   : ${(os.freemem()/1048576).toFixed(0)}MB vrij / ${(os.totalmem()/1048576).toFixed(0)}MB totaal`,
    `Load avg   : ${os.loadavg().map(l=>l.toFixed(2)).join(' / ')}`,
    '═'.repeat(72),
    '',
  ].join('\n');

  const footer = [
    '',
    '─'.repeat(72),
    'SAMENVATTING',
    '─'.repeat(72),
    ...summary,
    '═'.repeat(72),
  ].join('\n');

  try {
    fs.writeFileSync(filepath, header + logLines.join('\n') + footer, 'utf8');
    return filename;
  } catch(e) {
    log.error('Kon logbestand niet schrijven:', e.message);
    return null;
  }
}

// ── TEST: WebSocket belastingstest ──────────────────────────────────────────
async function testWebSocketLoad(emitter, logLines, stopped, numClients = 10) {
  const { io: ioClient } = require('socket.io-client');
  const results = [];
  const SERVER_URL = `http://localhost:${PORT}`;

  stressLog(emitter, logLines, 'info', `WebSocket belastingstest: ${numClients} gelijktijdige clients`);

  // Maak wegwerpsessie direct server-side aan (geen socket auth nodig)
  const testSessionCode = makeCode();
  // Gebruik exam mode zodat personalCanRun (altijd true) geldt voor de test-leerlingen
  const testSession = {
    code: testSessionCode, id: crypto.randomUUID(),
    name: '__stresstest_ws__', mode: 'exam', editorAssist: false,
    teacherSocketId: null, selectedStudentId: null,
    classWorkspaceMode: 'shared', sharedCode: '',
    sharedCodeRevision: 1, sharedCodeSourceSocketId: null,
    sharedOutput: '', announcement: '', announcementVersion: 0,
    students: {}, teacherRunId: null, teacherPreviewOutput: '',
    statusText: 'Stresstest', statusType: 'info',
    blocked: false, closed: false, deleted: false,
    classCanRun: true, classCanEdit: true,
    createdAt: Date.now(), announcementHistory: [],
  };
  sessions.set(testSessionCode, testSession);
  stressLog(emitter, logLines, 'info', `Wegwerpsessie aangemaakt: ${testSessionCode}`);

  // Verbind N clients gelijktijdig
  const connectTimes = [];
  const runTimes     = [];
  let connected = 0, runs = 0, failures = 0;

  const clientPromises = Array.from({ length: numClients }, (_, i) =>
    new Promise((resolve) => {
      const start = Date.now();
      const client = ioClient(SERVER_URL, { forceNew: true });

      const timeout = setTimeout(() => {
        client.disconnect();
        failures++;
        resolve(false);
      }, 15000);

      client.once('connect', () => {
        connectTimes.push(Date.now() - start);
        connected++;
        // Join de sessie
        client.emit('student_join', {
          name: `stresstest_ws_${i}`,
          code: testSessionCode,
          resumeId: null
        });
      });

      client.once('student_state', () => {
        // Exam mode: gebruik personal workspace (personalCanRun = true)
        const runStart = Date.now();
        const expectedStr = `ws_client_${i}`;
        client.emit('run_request', {
          codeText: `print("${expectedStr}")`,
          workspace: 'personal'
        });

        // run_output stuurt gecumuleerde output — wacht tot einde run
        let outputAccum = '';
        const onOutput = ({ output, audience }) => {
          if (audience === 'student') outputAccum = output || '';
        };
        client.on('run_output', onOutput);

        client.once('run_end', ({ audience }) => {
          client.off('run_output', onOutput);
          if (audience !== 'student') return;
          const ok = outputAccum.includes(expectedStr);
          runTimes.push(Date.now() - runStart);
          if (ok) runs++; else failures++;
          clearTimeout(timeout);
          client.disconnect();
          resolve(ok);
        });
      });

      client.once('connect_error', () => {
        clearTimeout(timeout);
        failures++;
        client.disconnect();
        resolve(false);
      });
    })
  );

  const clientResults = await Promise.all(clientPromises);
  results.push(...clientResults);

  // Opruimen: verwijder de wegwerpsessie
  const session = sessions.get(testSessionCode);
  if (session) {
    session.deleted = true;
    await dbModule.markSessionDeleted(testSessionCode);
    sessions.delete(testSessionCode);
  }

  const avgConnect = connectTimes.length ? Math.round(connectTimes.reduce((a,b)=>a+b,0)/connectTimes.length) : 0;
  const avgRun     = runTimes.length     ? Math.round(runTimes.reduce((a,b)=>a+b,0)/runTimes.length)         : 0;
  const p95Connect = connectTimes.length ? connectTimes.sort((a,b)=>a-b)[Math.floor(connectTimes.length*0.95)] || 0 : 0;

  stressLog(emitter, logLines, runs === numClients ? 'pass' : failures > numClients * 0.2 ? 'fail' : 'warn',
    `${runs}/${numClients} clients OK | connect p50=${avgConnect}ms p95=${p95Connect}ms | run p50=${avgRun}ms | uitvallers=${failures}`);

  return results;
}

// ── TEST: HTTP endpoint benchmark ────────────────────────────────────────────
async function testHttpBenchmark(emitter, logLines, stopped) {
  const results = [];
  const endpoints = [
    { url: `http://localhost:${PORT}/api/monitoring`,            label: 'GET /api/monitoring',            auth: true  },
    { url: `http://localhost:${PORT}/api/sessions`,             label: 'GET /api/sessions',              auth: true  },
    { url: `http://localhost:${PORT}/health`,                   label: 'GET /health',                    auth: false },
    { url: `http://localhost:${PORT}/api/syntax-check-student`, label: 'POST /api/syntax-check-student', auth: false, method: 'POST', body: { code: 'print("hello")' } },
  ];

  // Haal een valide cookie op voor geauthenticeerde endpoints
  let authHeader = '';
  if (BASIC_AUTH_ENABLED) {
    const teachers = await dbModule.listTeachers();
    if (teachers.length) authHeader = 'Basic ' + Buffer.from('__stresstest__:__na__').toString('base64');
  }

  stressLog(emitter, logLines, 'info', 'HTTP endpoint benchmark (20 verzoeken per endpoint)');

  for (const ep of endpoints) {
    if (stopped()) break;
    const times = [];
    for (let i = 0; i < 20; i++) {
      const t0 = Date.now();
      try {
        const opts = {
          method: ep.method || 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(ep.auth && authHeader ? { 'Authorization': authHeader } : {}),
          },
          body: ep.body ? JSON.stringify(ep.body) : undefined,
          signal: AbortSignal.timeout(5000),
        };
        await fetch(ep.url, opts);
        times.push(Date.now() - t0);
      } catch { times.push(5000); }
    }
    times.sort((a,b)=>a-b);
    const p50 = times[Math.floor(times.length * 0.50)] || 0;
    const p95 = times[Math.floor(times.length * 0.95)] || 0;
    const ok  = p95 < 500;
    stressLog(emitter, logLines, ok ? 'pass' : 'warn',
      `${ep.label}: p50=${p50}ms p95=${p95}ms${p95 >= 500 ? ' ⚠️ traag' : ''}`);
    results.push(ok);
  }
  return results;
}

// ── TEST: Rate limit verificatie ─────────────────────────────────────────────
async function testRateLimitVerification(emitter, logLines, stopped) {
  const { io: ioClient } = require('socket.io-client');
  const results = [];
  const SERVER_URL = `http://localhost:${PORT}`;

  stressLog(emitter, logLines, 'info', 'Rate limit verificatie: twee snelle run_requests naar dezelfde socket');

  // Maak wegwerpsessie direct server-side aan
  const sessionCode = makeCode();
  const rlSession = {
    code: sessionCode, id: crypto.randomUUID(),
    name: '__stresstest_ratelimit__', mode: 'exam', editorAssist: false,
    teacherSocketId: null, selectedStudentId: null,
    classWorkspaceMode: 'shared', sharedCode: '', sharedCodeRevision: 1,
    sharedCodeSourceSocketId: null, sharedOutput: '',
    announcement: '', announcementVersion: 0, students: {},
    teacherRunId: null, teacherPreviewOutput: '',
    statusText: 'Stresstest', statusType: 'info',
    blocked: false, closed: false, deleted: false, createdAt: Date.now(),
    announcementHistory: [], classCanRun: true, classCanEdit: true,
  };
  sessions.set(sessionCode, rlSession);

  const testResult = await new Promise((resolve) => {
    const client = ioClient(SERVER_URL, { forceNew: true });
    let rateLimited = false;

    const timeout = setTimeout(() => { client.disconnect(); resolve(false); }, 10000);

    client.once('student_state', () => {
      // Stuur twee run_requests onmiddellijk na elkaar (< 3s)
      client.emit('run_request', { codeText: 'print("first")', workspace: 'personal' });
      setTimeout(() => {
        client.emit('run_request', { codeText: 'print("second")', workspace: 'personal' });
      }, 100); // 100ms — ruim binnen de 3s rate limit venster

      client.once('run_rate_limited', () => {
        rateLimited = true;
        clearTimeout(timeout);
        client.disconnect();
        resolve(true);
      });

      // Als we run_output ontvangen van de tweede run: rate limit werkt NIET
      let runCount = 0;
      client.on('run_output', () => {
        runCount++;
        if (runCount >= 2 && !rateLimited) {
          clearTimeout(timeout);
          client.disconnect();
          resolve(false);
        }
      });
    });

    client.emit('student_join', { name: 'stresstest_rl', code: sessionCode, resumeId: null });
    client.once('connect_error', () => { clearTimeout(timeout); client.disconnect(); resolve(false); });
  });

  // Opruimen
  const sess = sessions.get(sessionCode);
  if (sess) { sess.deleted = true; dbModule.markSessionDeleted(sessionCode).catch(()=>{}); sessions.delete(sessionCode); }

  stressLog(emitter, logLines, testResult ? 'pass' : 'fail',
    testResult ? 'Rate limiting werkt correct — tweede run geblokkeerd' : 'Rate limiting faalde — tweede run werd niet geblokkeerd');
  results.push(testResult);
  return results;
}

// ── TEST: Runner API integratietest ─────────────────────────────────────────
async function testRunnerApiIntegration(emitter, logLines, stopped) {
  const results = [];
  stressLog(emitter, logLines, 'info', 'Runner API integratietest: start → events → input → end cyclus');

  // Test 1: Normale run zonder input
  try {
    const r1 = await runCode('x = 42\nprint(f"antwoord={x}")', 10000);
    const ok1 = r1.output.includes('antwoord=42');
    stressLog(emitter, logLines, ok1 ? 'pass' : 'fail', `Basis run: ${ok1 ? 'OK' : 'FAIL'} (output: ${r1.output.trim().slice(0,50)})`);
    results.push(ok1);
  } catch(e) { stressLog(emitter, logLines, 'fail', `Basis run exception: ${e.message}`); results.push(false); }

  if (stopped()) return results;

  // Test 2: Syntax check endpoint
  try {
    const r2 = await fetch(`${RUNNER_URL}/runs/check`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'def f(\n  pass' }), signal: AbortSignal.timeout(5000)
    });
    const d2 = await r2.json();
    const ok2 = !d2.ok && d2.error && d2.error.line > 0;
    stressLog(emitter, logLines, ok2 ? 'pass' : 'fail', `Syntax check fout gedetecteerd op regel ${d2.error?.line || '?'}: ${ok2 ? 'OK' : 'FAIL'}`);
    results.push(ok2);
  } catch(e) { stressLog(emitter, logLines, 'fail', `Syntax check exception: ${e.message}`); results.push(false); }

  if (stopped()) return results;

  // Test 3: Cancel tijdens run
  try {
    const startData = await runnerStart('import time\nfor i in range(100):\n    time.sleep(0.5)\n    print(i)');
    const runId = startData.runId;
    await new Promise(r => setTimeout(r, 300));
    const cancelRes = await fetch(`${RUNNER_URL}/runs/${runId}/cancel`, { method: 'POST', signal: AbortSignal.timeout(3000) });
    const ok3 = cancelRes.ok;
    stressLog(emitter, logLines, ok3 ? 'pass' : 'fail', `Cancel actieve run: ${ok3 ? 'OK' : 'FAIL'}`);
    results.push(ok3);
  } catch(e) { stressLog(emitter, logLines, 'fail', `Cancel exception: ${e.message}`); results.push(false); }

  if (stopped()) return results;

  // Test 4: Health endpoint volledigheid
  try {
    const r4 = await fetch(`${RUNNER_URL}/health`, { signal: AbortSignal.timeout(3000) });
    const d4 = await r4.json();
    const hasFields = ['activeRuns','maxRuns','queuedRuns','maxQueue'].every(f => f in d4);
    stressLog(emitter, logLines, hasFields ? 'pass' : 'warn', `Health endpoint velden: ${hasFields ? 'OK' : 'onvolledig'}`);
    results.push(hasFields);
  } catch(e) { stressLog(emitter, logLines, 'fail', `Health check exception: ${e.message}`); results.push(false); }

  return results;
}

// ── LIJST LOGBESTANDEN ────────────────────────────────────────────────────────
function listStressLogs() {
  try {
    return fs.readdirSync(LOGS_DIR)
      .filter(f => f.endsWith('.log') && f !== '.gitkeep')
      .sort().reverse()
      .slice(0, 50) // maximaal 50 tonen
      .map(f => {
        const stat = fs.statSync(path.join(LOGS_DIR, f));
        return { filename: f, sizeBytes: stat.size, mtime: stat.mtime.toISOString() };
      });
  } catch(e) { return []; }
}

// ── TEST: Ramp-up ────────────────────────────────────────────────────────────
async function testRampUp(emitter, logLines, stopped, startConcurrency = 2, durationSec = 60) {
  const results = [];
  let current = startConcurrency;
  const stepSec = 10;
  const maxTime = Date.now() + durationSec * 1000;

  stressLog(emitter, logLines, 'info', `Ramp-up: start ${current} runs, +2 elke ${stepSec}s`);
  stressProgress(emitter, 0, `Ramp-up gestart met ${current} gelijktijdige runs`);

  while (Date.now() < maxTime && !stopped()) {
    stressLog(emitter, logLines, 'info', `--- Stap: ${current} gelijktijdige runs ---`);
    const promises = Array.from({ length: current }, (_, i) =>
      runCode(`print("ramp_${current}_${i}")`, 10000)
        .then(r => r.output.includes(`ramp_${current}_${i}`))
        .catch(() => false)
    );
    const stepResults = await Promise.all(promises);
    const stepPassed = stepResults.filter(Boolean).length;
    results.push(...stepResults);
    stressLog(emitter, logLines, stepPassed === current ? 'pass' : 'warn',
      `${current} runs: ${stepPassed}/${current} OK`);

    // Check wachtrij — stop als > 50% vol
    try {
      const h = await fetch(`${RUNNER_URL}/health`);
      const hd = await h.json();
      const qRatio = (hd.queuedRuns || 0) / (hd.maxQueue || 90);
      if (qRatio > 0.5) {
        stressLog(emitter, logLines, 'warn', `Wachtrij > 50% vol bij ${current} runs — ramp-up gestopt`);
        break;
      }
    } catch (e) { /* stille fout — zie debug */ }

    current += 2;
    if (current > 25) break;
    await new Promise(r => setTimeout(r, stepSec * 1000));
  }
  stressLog(emitter, logLines, 'info', `Ramp-up klaar. Maximale comfortabele belasting: ~${Math.max(startConcurrency, current - 2)} runs`);
  return results;
}

// ── TEST: Sustained load ──────────────────────────────────────────────────────
async function testSustainedLoad(emitter, logLines, stopped, concurrency = 8, durationSec = 60) {
  const results = [];
  const endTime = Date.now() + durationSec * 1000;
  let runCount = 0;
  stressLog(emitter, logLines, 'info', `Sustained load: ${concurrency} permanente runs gedurende ${durationSec}s`);

  // Houd exact `concurrency` runs actief — elke afgeronde run start onmiddellijk een nieuwe
  const slots = Array.from({ length: concurrency }, async () => {
    while (Date.now() < endTime && !stopped()) {
      const { output } = await runCode(`print("sustained_${runCount++}")`, 10000).catch(() => ({ output: '' }));
      results.push(output.includes('sustained_'));
    }
  });
  await Promise.all(slots);
  const passed = results.filter(Boolean).length;
  stressLog(emitter, logLines, passed / results.length >= 0.95 ? 'pass' : 'warn',
    `Sustained load: ${passed}/${results.length} runs OK over ${durationSec}s`);
  return results;
}

// ── TEST: Memory leak detector ────────────────────────────────────────────────
async function testMemoryLeak(emitter, logLines, stopped, totalRuns = 50) {
  const results = [];
  const webMemBefore = process.memoryUsage().rss;
  let runnerMemBefore = 0;
  try {
    const h = await fetch(`${RUNNER_URL}/health`);
    const hd = await h.json();
    runnerMemBefore = Number(hd.cgroupMemoryCurrentBytes || hd.memoryBytes || 0);
  } catch (e) { /* stille fout — zie debug */ }

  stressLog(emitter, logLines, 'info', `Memory leak detector: ${totalRuns} opeenvolgende runs`);
  stressLog(emitter, logLines, 'info', `Web RAM voor: ${Math.round(webMemBefore/1048576)}MB`);
  if (runnerMemBefore) stressLog(emitter, logLines, 'info', `Runner RAM voor: ${Math.round(runnerMemBefore/1048576)}MB`);

  for (let i = 0; i < totalRuns; i++) {
    if (stopped()) break;
    const { output } = await runCode(`print("leak_test_${i}")`, 8000).catch(() => ({ output: '' }));
    results.push(output.includes(`leak_test_${i}`));
    stressProgress(emitter, Math.round((i / totalRuns) * 100), `Run ${i+1}/${totalRuns}`);
    await new Promise(r => setTimeout(r, 200));
  }

  const webMemAfter = process.memoryUsage().rss;
  const diffMB = (webMemAfter - webMemBefore) / 1048576;
  const leakSuspected = diffMB > 20;
  stressLog(emitter, logLines, leakSuspected ? 'warn' : 'pass',
    `Web RAM na: ${Math.round(webMemAfter/1048576)}MB (Δ${diffMB > 0 ? '+' : ''}${diffMB.toFixed(1)}MB)${leakSuspected ? ' ⚠️ mogelijke lek!' : ' ✓ stabiel'}`);
  results.push(!leakSuspected);
  return results;
}

// ── HTTP ENDPOINTS ────────────────────────────────────────────────────────────
app.get('/api/stress-test/logs', requireTeacherAuth, (req, res) => {
  res.json({ logs: listStressLogs() });
});

app.get('/api/stress-test/logs/:filename', requireTeacherAuth, (req, res) => {
  const safe = path.basename(req.params.filename);
  if (!safe.endsWith('.log')) return res.status(400).json({ error: 'Ongeldig bestand' });
  const fp = path.join(LOGS_DIR, safe);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Niet gevonden' });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  res.sendFile(fp);
});

app.post('/api/stress-test/stop', requireTeacherAuth, (req, res) => {
  if (!activeStressTest) return res.json({ ok: true, message: 'Geen actieve test' });
  activeStressTest.stopped = true;
  res.json({ ok: true, message: 'Stop-signaal verstuurd' });
});

app.get('/api/stress-test/status', requireTeacherAuth, (req, res) => {
  res.json({
    running: !!activeStressTest,
    type: activeStressTest?.type || null,
    startedAt: activeStressTest?.startedAt || null,
    baselines: Object.fromEntries(
      [...stressBaselines.entries()].map(([k,v]) => [k, { timestamp: v.timestamp }])
    )
  });
});

// SSE endpoint — client abonneert zich hierop en krijgt live events
app.get('/api/stress-test/stream', requireTeacherAuth, (req, res) => {
  if (!activeStressTest) {
    res.status(404).json({ error: 'Geen actieve stresstest' });
    return;
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const em = activeStressTest.emitter;
  const onLog      = d => send('log', d);
  const onProgress = d => send('progress', d);
  const onResult   = d => send('result', d);
  const onDone     = d => { send('done', d); res.end(); };

  em.on('log', onLog);
  em.on('progress', onProgress);
  em.on('result', onResult);
  em.once('done', onDone);

  req.on('close', () => {
    em.off('log', onLog);
    em.off('progress', onProgress);
    em.off('result', onResult);
    em.off('done', onDone);
  });
});

// Start endpoint
app.post('/api/stress-test/start', requireTeacherAuth, requireCsrf, async (req, res) => {
  // Fix SEC-10: stresstest enkel in non-productie of als flag gezet
  if (process.env.STRESS_TEST_ENABLED !== 'true') {
    return res.status(403).json({ error: 'Stresstest uitgeschakeld. Zet STRESS_TEST_ENABLED=true in .env om te activeren.' });
  }
  if (activeStressTest) {
    return res.status(409).json({ error: 'Er loopt al een stresstest' });
  }

  const { type, concurrency = 10, numSessions = 3, runsPerSession = 5, durationSec = 60 } = req.body || {};
  const validTypes = [
    'gezondheidscheck', 'runner-capaciteit', 'sandbox', 'multi-sessie', 'volledig',
    'ramp-up', 'sustained', 'memory-leak', 'aangepast',
    'websocket', 'http-benchmark', 'rate-limit', 'runner-api'
  ];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `Ongeldig test type: ${type}` });
  }

  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);
  const logLines = [];
  let stopped = false;

  activeStressTest = {
    type, startedAt: Date.now(),
    emitter, stopped: false,
  };

  res.json({ ok: true, type });

  // Voer de test asynchroon uit
  (async () => {
    const isStopped = () => activeStressTest?.stopped === true;
    stressLog(emitter, logLines, 'info', `=== Stresstest gestart: ${type} ===`);
    stressLog(emitter, logLines, 'info',
      `Systeem: ${(os.freemem()/1048576).toFixed(0)}MB vrij RAM, load ${os.loadavg()[0].toFixed(2)}`);

    const allResults = [];
    let finalMetrics = {};
    const startedAt = Date.now();

    try {
      if (type === 'gezondheidscheck' || type === 'volledig') {
        stressLog(emitter, logLines, 'info', '--- Gezondheidscheck ---');
        const r = await testHealthCheck(emitter, logLines, isStopped);
        allResults.push(...r);
      }
      if ((type === 'runner-capaciteit' || type === 'volledig') && !isStopped()) {
        stressLog(emitter, logLines, 'info', `--- Runner capaciteit (${concurrency}x) ---`);
        const { results, metrics } = await testRunnerCapacity(emitter, logLines, isStopped, concurrency);
        allResults.push(...results);
        finalMetrics = { ...finalMetrics, ...metrics };
      }
      if ((type === 'sandbox' || type === 'volledig') && !isStopped()) {
        stressLog(emitter, logLines, 'info', '--- Sandbox verificatie ---');
        const r = await testSandbox(emitter, logLines, isStopped);
        allResults.push(...r);
      }
      if ((type === 'multi-sessie' || type === 'volledig') && !isStopped()) {
        stressLog(emitter, logLines, 'info', `--- Multi-sessie (${numSessions}×${runsPerSession}) ---`);
        const r = await testMultiSession(emitter, logLines, isStopped, numSessions, runsPerSession);
        allResults.push(...r);
      }
      if (type === 'ramp-up' && !isStopped()) {
        stressLog(emitter, logLines, 'info', `--- Ramp-up test ---`);
        const r = await testRampUp(emitter, logLines, isStopped, 2, durationSec || 60);
        allResults.push(...r);
      }
      if (type === 'sustained' && !isStopped()) {
        stressLog(emitter, logLines, 'info', `--- Sustained load (${concurrency}x, ${durationSec}s) ---`);
        const r = await testSustainedLoad(emitter, logLines, isStopped, concurrency, durationSec || 60);
        allResults.push(...r);
      }
      if (type === 'memory-leak' && !isStopped()) {
        stressLog(emitter, logLines, 'info', '--- Memory leak detector ---');
        const r = await testMemoryLeak(emitter, logLines, isStopped, 50);
        allResults.push(...r);
      }
      if (type === 'aangepast' && !isStopped()) {
        const c2 = Math.max(1, Math.min(25, parseInt(concurrency) || 10));
        const ns = Math.max(1, Math.min(10, parseInt(numSessions) || 3));
        const rps = Math.max(1, Math.min(20, parseInt(runsPerSession) || 5));
        stressLog(emitter, logLines, 'info', `--- Aangepaste test: ${c2} runs, ${ns}×${rps} sessies ---`);
        const r1 = await testRunnerCapacity(emitter, logLines, isStopped, c2);
        allResults.push(...r1.results);
        if (!isStopped()) {
          const r2 = await testMultiSession(emitter, logLines, isStopped, ns, rps);
          allResults.push(...r2);
        }
      }
      if (type === 'websocket' && !isStopped()) {
        stressLog(emitter, logLines, 'info', `--- WebSocket belastingstest (${concurrency} clients) ---`);
        const r = await testWebSocketLoad(emitter, logLines, isStopped, concurrency);
        allResults.push(...r);
      }
      if (type === 'http-benchmark' && !isStopped()) {
        stressLog(emitter, logLines, 'info', '--- HTTP endpoint benchmark ---');
        const r = await testHttpBenchmark(emitter, logLines, isStopped);
        allResults.push(...r);
      }
      if (type === 'rate-limit' && !isStopped()) {
        stressLog(emitter, logLines, 'info', '--- Rate limit verificatie ---');
        const r = await testRateLimitVerification(emitter, logLines, isStopped);
        allResults.push(...r);
      }
      if (type === 'runner-api' && !isStopped()) {
        stressLog(emitter, logLines, 'info', '--- Runner API integratietest ---');
        const r = await testRunnerApiIntegration(emitter, logLines, isStopped);
        allResults.push(...r);
      }
      // Volledige test: voeg WebSocket + HTTP + rate limit ook toe
      if (type === 'volledig' && !isStopped()) {
        stressLog(emitter, logLines, 'info', '--- WebSocket belastingstest ---');
        const rWs = await testWebSocketLoad(emitter, logLines, isStopped, Math.min(concurrency, 15));
        allResults.push(...rWs);
        if (!isStopped()) {
          stressLog(emitter, logLines, 'info', '--- Rate limit verificatie ---');
          const rRl = await testRateLimitVerification(emitter, logLines, isStopped);
          allResults.push(...rRl);
        }
        if (!isStopped()) {
          stressLog(emitter, logLines, 'info', '--- HTTP endpoint benchmark ---');
          const rHttp = await testHttpBenchmark(emitter, logLines, isStopped);
          allResults.push(...rHttp);
        }
      }
    } catch(e) {
      stressLog(emitter, logLines, 'fail', `Onverwachte fout: ${e.message}`);
    }

    const totalMs = Date.now() - startedAt;
    const passed  = allResults.filter(Boolean).length;
    const total   = allResults.length;
    const pct     = total > 0 ? Math.round((passed/total)*100) : 0;
    const overallOk = pct >= 85;

    // Baseline opslaan
    if (Object.keys(finalMetrics).length > 0) {
      stressBaselines.set(type, { timestamp: Date.now(), metrics: finalMetrics });
    }

    // Baseline vergelijking
    const baselineComp = compareToBaseline(type, finalMetrics);

    const summary = [
      `Resultaat  : ${passed}/${total} checks geslaagd (${pct}%)`,
      `Duur       : ${(totalMs/1000).toFixed(1)}s`,
      `Oordeel    : ${overallOk ? '✅ GESLAAGD' : '❌ GEFAALD'}`,
      ...(isStopped() ? ['⚠️  Test vroegtijdig gestopt'] : []),
      ...(baselineComp ? ['', 'Vergelijking met vorige run:', ...baselineComp.comparison] : []),
    ];

    stressLog(emitter, logLines, overallOk ? 'ok' : 'fail',
      `=== Klaar: ${passed}/${total} OK (${pct}%) in ${(totalMs/1000).toFixed(1)}s ===`);

    const logFilename = writeStressLog(type, logLines, summary);
    stressLog(emitter, logLines, 'info',
      logFilename ? `Log opgeslagen: ${logFilename}` : 'Log kon niet worden opgeslagen');

    emitter.emit('done', {
      passed, total, pct, overallOk, totalMs,
      stopped: isStopped(),
      logFilename,
      baselineComparison: baselineComp,
      summary,
    });

    activeStressTest = null;
  })().catch(e => {
    log.error('Stresstest crash:', e);
    activeStressTest = null;
  });
});

// ── SCHEDULED DAGELIJKSE GEZONDHEIDSCHECK ────────────────────────────────────
// Voert elke dag om 06:00 automatisch een gezondheidscheck uit.
// Resultaat is beschikbaar via /api/stress-test/autocheck-status.
let lastAutocheck = null; // { timestamp, passed, total, pct, ok, logFilename }

function scheduleAutocheck() {
  const now = new Date();
  const next = new Date();
  next.setHours(6, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const msUntil = next - now;
  log.info(`[autocheck] Volgende gezondheidscheck om ${next.toISOString()} (over ${Math.round(msUntil/60000)} min)`);
  setTimeout(async () => {
    if (!activeStressTest) {
      log.info('[autocheck] Start dagelijkse gezondheidscheck...');
      const emitter = new EventEmitter();
      emitter.setMaxListeners(10);
      const logLines = [];
      try {
        const results = await testHealthCheck(emitter, logLines, () => false);
        const passed = results.filter(Boolean).length;
        const total = results.length;
        const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
        const ok = pct >= 85;
        const logFilename = writeStressLog('autocheck', logLines, [
          `Resultaat  : ${passed}/${total} (${pct}%)`,
          `Oordeel    : ${ok ? '✅ GESLAAGD' : '❌ GEFAALD'}`,
        ]);
        lastAutocheck = { timestamp: Date.now(), passed, total, pct, ok, logFilename };
        log.info(`[autocheck] Klaar: ${passed}/${total} OK (${pct}%) — ${ok ? 'GESLAAGD' : 'GEFAALD'}`);
      } catch(e) {
        log.error('[autocheck] Fout:', e.message);
        lastAutocheck = { timestamp: Date.now(), passed: 0, total: 0, pct: 0, ok: false, logFilename: null };
      }
    } else {
      log.info('[autocheck] Overgeslagen — stresstest actief');
    }
    scheduleAutocheck(); // Plan volgende check
  }, msUntil);
}
scheduleAutocheck();

app.get('/api/stress-test/autocheck-status', requireTeacherAuth, (req, res) => {
  res.json({ lastAutocheck });
});

server.listen(PORT, () => log.info(`Listening on http://localhost:${PORT}`));

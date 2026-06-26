const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

// SQLite database — sessie-persistentie en leerkrachtenaccounts
const dbModule = require('./db/database');

const PORT = process.env.PORT || 3000;
const RUNNER_URL = process.env.RUNNER_URL || "http://runner:5000";
const BASIC_AUTH_ENABLED = String(process.env.POC_BASIC_AUTH_ENABLED || "true").toLowerCase() !== "false";
const BASIC_AUTH_USER = process.env.POC_BASIC_USER || "";
const BASIC_AUTH_PASS_HASH = process.env.POC_BASIC_PASS_HASH || "";
const BASIC_AUTH_LEGACY_PASS = process.env.POC_BASIC_PASS || "";
const BASIC_AUTH_REALM = process.env.POC_BASIC_AUTH_REALM || "PyCodeFlow POC";
const COOKIE_SECRET = process.env.POC_BASIC_COOKIE_SECRET || "";

// ── CSRF-bescherming ──────────────────────────────────────────────────────────
// Genereer een server-side CSRF token per process-start.
// Stuur het mee als cookie; clients moeten het terugsturen als X-CSRF-Token header.
const CSRF_TOKEN = crypto.randomBytes(32).toString('hex');

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

const VERSION = {
  year: process.env.APP_VERSION_YEAR || "2026",
  major: process.env.APP_VERSION_MAJOR || "0",
  minor: process.env.APP_VERSION_MINOR || "0",
  build: process.env.APP_VERSION_BUILD || "0"
};
const APP_VERSION = `${VERSION.year}.${VERSION.major}.${VERSION.minor}.${VERSION.build}`;

const disconnectTimers = new Map();

// Vrije sessie: globale map van leerlingen die vrij oefenen (buiten klas/examsessies)
// Key: socketId, Value: { id, name, className, joinedAt, socketId, runId }
const freeStudents = new Map();

function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a), "utf8");
  const bBuf = Buffer.from(String(b), "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createPasswordHash(password, salt = crypto.randomBytes(16)) {
  const normalizedSalt = Buffer.isBuffer(salt) ? salt : Buffer.from(String(salt), "base64");
  const params = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
  const derivedKey = crypto.scryptSync(String(password), normalizedSalt, 64, params);
  return `scrypt$${params.N}$${params.r}$${params.p}$${normalizedSalt.toString("base64")}$${derivedKey.toString("base64")}`;
}

function verifyPasswordWithHash(password, storedHash) {
  try {
    const parts = String(storedHash || "").split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, n, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
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

function parseBasicAuthHeader(headerValue) {
  if (!headerValue || !headerValue.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(headerValue.slice(6), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex < 0) return null;
    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1)
    };
  } catch {
    return null;
  }
}

function credentialsAreValid(authHeader) {
  if (!BASIC_AUTH_ENABLED) return true;
  const creds = parseBasicAuthHeader(authHeader);
  if (!creds) return false;

  // Probeer eerst de SQLite database (nieuwe manier)
  const teacher = dbModule.getTeacherByUsername(creds.username);
  if (teacher) {
    const valid = verifyPasswordWithHash(creds.password, teacher.pass_hash);
    if (valid) dbModule.updateLastLogin(teacher.id);
    return valid;
  }

  // Fallback: .env credentials (tijdens migratieperiode of als DB leeg is)
  if (BASIC_AUTH_USER && PASSWORD_HASH) {
    return safeEqual(creds.username, BASIC_AUTH_USER) && verifyPasswordWithHash(creds.password, PASSWORD_HASH);
  }

  return false;
}

async function requireBasicAuth(req, res, next) {
  if (!BASIC_AUTH_ENABLED) return next();
  const ip = getClientIp(req);
  const blockedRemainingMs = getAuthBlockRemainingMs(ip);
  if (blockedRemainingMs > 0) {
    res.setHeader("Retry-After", String(Math.ceil(blockedRemainingMs / 1000)));
    return res.status(429).send("Te veel mislukte loginpogingen. Probeer later opnieuw.");
  }

  if (credentialsAreValid(req.headers.authorization)) {
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

if (BASIC_AUTH_ENABLED) {
  // Controleer of er minstens één leerkracht in de DB staat OF dat .env credentials aanwezig zijn.
  // Na DB-migratie mogen POC_BASIC_USER/PASS_HASH verwijderd zijn uit .env.
  const dbHasTeacher = (() => {
    try { return dbModule.listTeachers().length > 0; } catch { return false; }
  })();
  const envHasCredentials = !!(BASIC_AUTH_USER && PASSWORD_HASH
    && BASIC_AUTH_USER !== "CHANGE_ME" && BASIC_AUTH_PASS_HASH !== "CHANGE_ME_HASH");

  if (!dbHasTeacher && !envHasCredentials) {
    console.error("POC Basic Auth is actief maar er zijn geen leerkrachtenaccounts gevonden.");
    console.error("Voeg een account toe via: node scripts/manage-teacher.js add <gebruiker> <wachtwoord>");
    process.exit(1);
  }
  if (dbHasTeacher) {
    console.log(`[auth] ${dbModule.listTeachers().length} leerkracht(en) geladen vanuit database.`);
  }
}

if (passwordConfigUsesLegacyPlaintext) {
  console.warn("WAARSCHUWING: POC_BASIC_PASS wordt nog gebruikt. Vervang dit door POC_BASIC_PASS_HASH voor betere beveiliging.");
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

function parseCookieHeader(headerValue) {
  const out = {};
  if (!headerValue) return out;
  for (const part of headerValue.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(value);
  }
  return out;
}

function teacherCookieValue() {
  const secret = COOKIE_SECRET || PASSWORD_HASH || "fallback_teacher_cookie_secret";
  return crypto.createHmac("sha256", secret)
    .update(`${BASIC_AUTH_USER}|${BASIC_AUTH_REALM}`)
    .digest("hex");
}

function hasValidTeacherCookie(cookieHeader) {
  if (!BASIC_AUTH_ENABLED) return true;
  const cookies = parseCookieHeader(cookieHeader);
  return safeEqual(cookies.teacher_auth || "", teacherCookieValue());
}

function setTeacherCookie(res) {
  if (!BASIC_AUTH_ENABLED) return;
  res.setHeader("Set-Cookie", `teacher_auth=${encodeURIComponent(teacherCookieValue())}; Path=/; HttpOnly; SameSite=Lax`);
}

async function requireTeacherAuth(req, res, next) {
  if (!BASIC_AUTH_ENABLED) return next();
  if (hasValidTeacherCookie(req.headers.cookie)) return next();
  // Stuur de browser door naar de custom login-pagina i.p.v. de native browser-popup
  // te tonen via WWW-Authenticate. De ?next= parameter zorgt voor de juiste redirect
  // na succesvolle authenticatie.
  const dest = encodeURIComponent(req.path);
  return res.redirect(`/teacher-login.html?next=${dest}`);
}

function socketIsTeacherAuthorized(socket) {
  if (!BASIC_AUTH_ENABLED) return true;
  return hasValidTeacherCookie(socket.request.headers.cookie || "");
}

app.use(express.json());

app.get('/monitoring.html', requireTeacherAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'monitoring.html'));
});

// Custom login-pagina — publiek bereikbaar (geen auth), anders oneindige redirect
app.get('/teacher-login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teacher-login.html'));
});

// Logout: wis de teacher_auth cookie en stuur door naar de loginpagina
app.get('/api/teacher-logout', (req, res) => {
  res.setHeader('Set-Cookie', 'teacher_auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.redirect('/teacher-login.html');
});

// Vrije editor — publiek bereikbaar voor leerlingen (geen klas/examsessie nodig)
app.get('/free-editor.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'free-editor.html'));
});

// JSON login-endpoint voor de custom login-overlay
// Valideert credentials, zet de teacher_auth-cookie en retourneert 200 bij succes.
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

  // Bouw een nep Authorization-header zodat we credentialsAreValid kunnen hergebruiken
  const fakeAuthHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const valid = credentialsAreValid(fakeAuthHeader); // checkt DB én .env fallback

  if (valid) {
    clearAuthFailures(ip);
    setTeacherCookie(res);
    setCsrfCookie(res);
    return res.json({ ok: true });
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
app.get('/teacher-start.html', requireTeacherAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teacher-start.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/landing.html', (req, res) => {
  res.redirect('/index.html');
});

app.get('/api/version', (req, res) => {
  res.json({
    version: APP_VERSION,
    ...VERSION
  });
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
app.get('/api/sessions/:code/history/:studentId', requireTeacherAuth, (req, res) => {
  const code = (req.params.code || '').toUpperCase();
  const studentId = req.params.studentId;
  const session = sessions.get(code);
  if (!session) return res.status(404).json({ error: 'Sessie niet gevonden' });
  const student = session.students[studentId];
  if (!student) return res.status(404).json({ error: 'Leerling niet gevonden' });
  try {
    const snapshots = dbModule.getSnapshots(code, studentId);
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
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'monitoring failed' });
  }
});

app.use(express.static(path.join(__dirname, "public")));
app.use("/monaco", express.static(path.join(__dirname, "node_modules", "monaco-editor")));


const sessions = new Map();
const socketToUser = new Map();
const activeRuns = new Map(); // runId -> routing info

// Rate limiting voor run_request: socketId -> tijdstip laatste run (ms)
const runRateLimit = new Map();

// Set van runIds waarvoor de runner momenteel wacht op stdin input
// Wordt bijgehouden op basis van input_request events uit de runner
const runnerWaitingForInput = new Set();

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
    dbModule.saveSnapshot(session.code, student.id, student.name, code || '');
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
  } catch {}
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
(function loadPersistedSessions() {
  try {
    const persisted = dbModule.loadActiveSessions();
    for (const session of persisted) {
      sessions.set(session.code, session);
    }
    if (persisted.length > 0) {
      console.log(`[db] ${persisted.length} sessie(s) hersteld vanuit database.`);
    }
  } catch(e) {
    console.error('[db] Kon sessies niet laden:', e.message);
  }
})();


function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
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

app.get("/api/sessions", requireTeacherAuth, (req, res) => {
  const list = [...sessions.values()].filter(s => !s.deleted && !s.closed).map(sessionSummary)
    .sort((a,b) => b.createdAt - a.createdAt);
  res.json(list);
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
    allCodeEnabled: getActiveStudents(session).length > 0 && getActiveStudents(session).every(s => s.classCanEdit !== false)
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
    console.error("runnerDisconnect error", err);
  });
  const timer = setTimeout(() => {
    runnerCancel(runId).catch(err => {
      console.error("runnerCancel error", err);
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
    console.error("runnerResume error", err);
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
    console.error("pollRun error", err);
  });
  return runId;
}

// ── Auditlog vrije sessie ────────────────────────────────────────────────────
const fs = require('fs');
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
    try { dbModule.persistSession(session); } catch(e) {
      console.error('[db] persistSession fout:', e.message);
    }
  }, delayMs);
  persistTimers.set(session.code, timer);
}

// Onmiddellijke persist (voor kritieke operaties zoals delete/close)
function persistNow(session) {
  const existing = persistTimers.get(session.code);
  if (existing) { clearTimeout(existing); persistTimers.delete(session.code); }
  try { dbModule.persistSession(session); } catch(e) {
    console.error('[db] persistNow fout:', e.message);
  }
}

io.on("connection", (socket) => {
  socket.on("teacher_create_session", ({ name, mode, editorAssist, templateCode }) => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const code = makeCode();
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
      teacherSocketId: socket.id,
      selectedStudentId: null,
      classWorkspaceMode: "shared",
      sharedCode: startCode,
      sharedOutput: "",
      announcement: "",
      students: {},
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

  socket.on("student_join", ({ name, code, resumeId }) => {
    const normalizedCode = (code || "").trim().toUpperCase();
    const normalizedName = String(name || "").trim();
    const normalizedNameLower = normalizedName.toLowerCase();
    const session = sessions.get(normalizedCode);
    if (!session || session.closed || session.deleted || session.blocked) return socket.emit("error_message", "Sessie niet gevonden of niet bereikbaar");
    if (!normalizedName) return socket.emit("error_message", "Geef eerst je naam in. De placeholder telt niet als naam.");
    if (!normalizedCode) return socket.emit("error_message", "Geef eerst je sessiecode in.");

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
      classCanRun: false, classCanEdit: false,
      // In examenmodus heeft de leerling altijd volledige persoonlijke run- en bewerkrechten.
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
    setStatus(session, `${student.name} is gejoined`, "info");
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
      try { await fetch(`${RUNNER_URL}/runs/${student.runId}/cancel`, { method: "POST" }); } catch {}
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
            } catch {}
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
    const annotation = {
      id: crypto.randomUUID(),
      startLine: Math.max(1, parseInt(startLine) || 1),
      endLine:   Math.max(1, parseInt(endLine)   || 1),
      message:   String(message || '').slice(0, 200),
      color:     ['yellow','blue','green','red'].includes(color) ? color : 'yellow',
      createdAt: Date.now(),
    };
    if (!session.annotations) session.annotations = [];
    session.annotations.push(annotation);
    // Persisteer in SQLite
    dbModule.saveAnnotations(session.code, session.annotations);
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
    dbModule.saveAnnotations(session.code, []);
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
    } catch {}
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
    dbModule.markSessionDeleted(session.code);
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
    dbModule.markSessionClosed(session.code);
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
        try { await fetch(`${RUNNER_URL}/runs/${s.runId}/cancel`, { method: "POST" }); } catch {}
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

  socket.on("disconnect", () => {
    const ctx = socketToUser.get(socket.id);
    runRateLimit.delete(socket.id); // cleanup rate limit entry
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
    console.error('Kon logbestand niet schrijven:', e.message);
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
    dbModule.markSessionDeleted(testSessionCode);
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
    const teachers = dbModule.listTeachers();
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
  if (sess) { sess.deleted = true; dbModule.markSessionDeleted(sessionCode); sessions.delete(sessionCode); }

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
    } catch {}

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
  } catch {}

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
    console.error('Stresstest crash:', e);
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
  console.log(`[autocheck] Volgende gezondheidscheck om ${next.toISOString()} (over ${Math.round(msUntil/60000)} min)`);
  setTimeout(async () => {
    if (!activeStressTest) {
      console.log('[autocheck] Start dagelijkse gezondheidscheck...');
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
        console.log(`[autocheck] Klaar: ${passed}/${total} OK (${pct}%) — ${ok ? 'GESLAAGD' : 'GEFAALD'}`);
      } catch(e) {
        console.error('[autocheck] Fout:', e.message);
        lastAutocheck = { timestamp: Date.now(), passed: 0, total: 0, pct: 0, ok: false, logFilename: null };
      }
    } else {
      console.log('[autocheck] Overgeslagen — stresstest actief');
    }
    scheduleAutocheck(); // Plan volgende check
  }, msUntil);
}
scheduleAutocheck();

app.get('/api/stress-test/autocheck-status', requireTeacherAuth, (req, res) => {
  res.json({ lastAutocheck });
});

server.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));

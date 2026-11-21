'use strict';
// ════════════════════════════════════════════════════════════════════════════
// v151 — PyBlitz: routes (bibliotheek, import, afbeeldingen, gasten) en sockets (spel).
// Alleen in klasmodus (gedeelde werkruimte) van een gewone sessie; nooit tijdens toets of taak.
// De spelmotor zelf staat in lib/pyblitz-spel.js (pure logica, getest).
// ════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const P = require('./pyblitz');
const { maakSpel } = require('./pyblitz-spel');

const AFBEELDING_MAX_BYTES = 600 * 1024;
const GASTEN_MAX = 150;
const INACTIEF_MS = 45 * 60 * 1000;      // een spel zonder enige activiteit wordt vanzelf gestopt
const JOIN_VENSTER_MS = 10 * 60 * 1000;
const JOIN_MAX_PER_IP = 60;               // royaal: een school zit achter één IP

function eigenaarVan(teacher) { return (teacher && (teacher.id || teacher.username)) || 'anoniem'; }

function registerPyblitzRoutes(app, deps) {
  const { dbModule, express, io, requireTeacherAuth, requireCsrf, herkenAfbeelding, log,
          sessions, socketToUser, socketIsTeacherAuthorized, socketMagSessie, schedulePersist, emitTeacherSession,
          now = Date.now } = deps;

  const spellen = new Map();      // gameId → { spel, sessie, host:Set<socketId>, sockets:Map<playerId,Set>, tokens:Map, laatste, key }
  const perPin = new Map();       // pin → gameId
  const perSessie = new Map();    // sessiecode → gameId
  const tokens = new Map();       // token → { gameId, playerId }
  const joinTeller = new Map();   // ip → { n, sinds }

  const spelVan = (id) => spellen.get(id) || null;

  // ── uitzenden ──────────────────────────────────────────────────────────────
  function zendNaarSpeler(g, pid) {
    const set = g.sockets.get(pid); if (!set) return;
    const st = g.spel.toestand(pid);
    for (const sid of set) io.to(sid).emit('pyblitz_state', st);
  }
  function zendNaarHost(g) {
    const st = g.spel.toestand(null);
    for (const sid of g.host) io.to(sid).emit('pyblitz_state', st);
  }
  function zendAlles(g) {
    zendNaarHost(g);
    for (const pid of g.sockets.keys()) zendNaarSpeler(g, pid);
  }
  function opgeruimdeSpeler(g, pid, sid) {
    const set = g.sockets.get(pid); if (!set) return;
    set.delete(sid);
    if (!set.size) { g.sockets.delete(pid); g.spel.verbonden(pid, false); }
  }
  function koppelSocket(g, pid, socket) {
    let set = g.sockets.get(pid); if (!set) { set = new Set(); g.sockets.set(pid, set); }
    set.add(socket.id);
    socket.join('pb:' + g.spel.id);
    socket.data.pyblitz = socket.data.pyblitz || new Map();
    socket.data.pyblitz.set(g.spel.id, pid);
  }

  function maakNieuwSpel(session, set, ownerId) {
    const id = crypto.randomUUID();
    const pin = P.nieuwePin(new Set(perPin.keys()));
    const g = {
      spel: null, sessie: session.code, ownerId, host: new Set(), sockets: new Map(), laatste: now(), key: '', klasNamen: new Set(),
    };
    g.spel = maakSpel({
      id, pin, set, sessionCode: session.code, ownerId,
      onChange: (s) => {
        g.laatste = now();
        const key = `${s.fase}:${s.index}:${s.gepauzeerd}`;
        const lobby = s.fase === 'lobby';
        if (key !== g.key || lobby) { g.key = key; zendAlles(g); }
        else zendNaarHost(g);           // enkel de teller van de leerkracht verandert
      },
      onEinde: (res) => {
        const sp = g.spel.toestandNu;
        dbModule.pyblitzSaveGame({
          id, setId: set.id, setName: set.name, ownerId, sessionCode: session.code,
          startedAt: sp.begonnen || sp.gemaakt, endedAt: sp.geeindigd || now(), reason: res.reden,
          playerCount: res.spelers.length, questionCount: set.questions.length, results: res,
        }).catch(e => log.error('[pyblitz] resultaat opslaan mislukt:', e.message));
      },
    });
    spellen.set(id, g); perPin.set(pin, id); perSessie.set(session.code, id);
    return g;
  }
  function ruimOp(g, reden = 'gesloten') {
    const id = g.spel.id;
    g.spel.stop();
    io.to('pb:' + id).emit('pyblitz_closed', { gameId: id, reden });
    for (const sid of [...g.host]) io.sockets.sockets.get(sid)?.leave('pb:' + id);
    for (const set of g.sockets.values()) for (const sid of set) io.sockets.sockets.get(sid)?.leave('pb:' + id);
    for (const [t, v] of tokens) if (v.gameId === id) tokens.delete(t);
    spellen.delete(id); perPin.delete(g.spel.pin);
    if (perSessie.get(g.sessie) === id) perSessie.delete(g.sessie);
  }

  // Opruimen van vergeten spellen.
  const sweep = setInterval(() => {
    for (const g of [...spellen.values()]) if (now() - g.laatste > INACTIEF_MS) ruimOp(g, 'inactief');
    for (const [ip, v] of joinTeller) if (now() - v.sinds > JOIN_VENSTER_MS) joinTeller.delete(ip);
  }, 60 * 1000);
  if (sweep.unref) sweep.unref();

  // ════════════════════════════════════════════════════════════════════════
  // REST — leerkracht
  // ════════════════════════════════════════════════════════════════════════
  const grootJson = express.json({ limit: '1200kb' });
  const importJson = express.json({ limit: '3mb' });

  const fout = (res, status, msg) => res.status(status).json({ error: msg });
  const eigenaar = (req) => eigenaarVan(req.teacher);

  app.get('/api/pyblitz/sets', requireTeacherAuth, async (req, res) => {
    try { res.json({ sets: await dbModule.pyblitzListSets(eigenaar(req)) }); }
    catch (e) { log.error('[pyblitz] lijst:', e.message); fout(res, 500, 'Kon de PyBlitzes niet laden.'); }
  });
  app.get('/api/pyblitz/sets/:id', requireTeacherAuth, async (req, res) => {
    try {
      const s = await dbModule.pyblitzGetSet(req.params.id, eigenaar(req));
      if (!s) return fout(res, 404, 'PyBlitz niet gevonden.');
      res.json({ set: s });
    } catch (e) { fout(res, 500, 'Kon de PyBlitz niet laden.'); }
  });
  app.put('/api/pyblitz/sets/:id', requireTeacherAuth, requireCsrf, async (req, res) => {
    try {
      const raw = req.body || {};
      const norm = P.normaliseerSet({ name: raw.name, description: raw.description, questions: raw.questions });
      if (!norm.ok) return fout(res, 400, (norm.fouten && norm.fouten[0]) || 'Ongeldige PyBlitz.');
      let id = req.params.id;
      if (id === 'nieuw') id = P.nieuwId('pb');
      else if (!P.geldigId(id)) return fout(res, 400, 'Ongeldig id.');
      else if (!(await dbModule.pyblitzGetSet(id, eigenaar(req)))) return fout(res, 404, 'PyBlitz niet gevonden.');
      await dbModule.pyblitzSaveSet({ id, ownerId: eigenaar(req), schoolId: req.teacher?.activeSchoolId || null,
        name: norm.naam, description: norm.omschrijving, questions: norm.vragen });
      res.json({ ok: true, id, set: { id, name: norm.naam, description: norm.omschrijving, questions: norm.vragen } });
    } catch (e) { log.error('[pyblitz] opslaan:', e.message); fout(res, 500, 'Opslaan mislukt.'); }
  });
  app.delete('/api/pyblitz/sets/:id', requireTeacherAuth, requireCsrf, async (req, res) => {
    try {
      // niet verwijderen terwijl een spel ervan bezig is
      for (const g of spellen.values()) if (g.spel.toestandNu.setId === req.params.id && g.ownerId === eigenaar(req)) {
        return fout(res, 409, 'Deze PyBlitz wordt nu gespeeld.');
      }
      const ok = await dbModule.pyblitzDeleteSet(req.params.id, eigenaar(req));
      if (!ok) return fout(res, 404, 'PyBlitz niet gevonden.');
      res.json({ ok: true });
    } catch (e) { fout(res, 500, 'Verwijderen mislukt.'); }
  });
  app.get('/api/pyblitz/sets/:id/export', requireTeacherAuth, async (req, res) => {
    try {
      const s = await dbModule.pyblitzGetSet(req.params.id, eigenaar(req));
      if (!s) return fout(res, 404, 'PyBlitz niet gevonden.');
      const naam = String(s.name).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'pyblitz';
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${naam}.json"`);
      res.send(JSON.stringify(P.exporteerJson(s), null, 2));
    } catch (e) { fout(res, 500, 'Exporteren mislukt.'); }
  });

  // Import: JSON-tekst of Excel (base64). Resultaat is een voorbeeld; de leerkracht bewaart daarna zelf.
  app.post('/api/pyblitz/import', requireTeacherAuth, requireCsrf, importJson, async (req, res) => {
    try {
      const { soort, tekst, base64 } = req.body || {};
      if (soort === 'xlsx') {
        const buf = Buffer.from(String(base64 || '').replace(/^data:[^,]*,/, ''), 'base64');
        if (!buf.length || buf.length > 2 * 1024 * 1024) return fout(res, 400, 'Excelbestand ontbreekt of is te groot (max 2 MB).');
        const ExcelJS = require('exceljs');
        const wb = new ExcelJS.Workbook();
        try { await wb.xlsx.load(buf); } catch { return fout(res, 400, 'Dit is geen geldig .xlsx-bestand.'); }
        const ws = wb.worksheets[0];
        if (!ws) return fout(res, 400, 'Het Excelbestand bevat geen blad.');
        const rijen = [];
        ws.eachRow({ includeEmpty: false }, (row) => {
          const cellen = [];
          for (let c = 1; c <= 12; c++) {
            const v = row.getCell(c).value;
            cellen.push(v == null ? '' : (typeof v === 'object' ? (v.text || v.result || (v.richText ? v.richText.map(r => r.text).join('') : '')) : v));
          }
          rijen.push(cellen);
        });
        return res.json(P.importeerRijen(rijen));
      }
      return res.json(P.importeerJson(tekst));
    } catch (e) { log.error('[pyblitz] import:', e.message); fout(res, 500, 'Importeren mislukt.'); }
  });
  app.get('/api/pyblitz/sjabloon.xlsx', requireTeacherAuth, async (req, res) => {
    try {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('PyBlitz');
      ws.addRow(['Vraag', 'Code', 'Foutmelding', 'A', 'B', 'C', 'D', 'Juist', 'Tijd', 'Punten', 'Uitleg']);
      ws.addRow(['Wat print dit programma?', 'x = 2\nprint(x * 3)', '', '5', '6', '23', '2 * 3', 'B', 20, 'standaard', 'x * 3 = 6.']);
      ws.addRow(['Welke fout krijg je hier?', '', "NameError: name 'naam' is not defined", 'Syntaxfout', 'Naamfout', 'Typefout', 'Inspringfout', 'B', 25, 'dubbel', 'De variabele bestaat nog niet.']);
      ws.addRow(['Python is hoofdlettergevoelig.', '', '', 'Waar', 'Onwaar', '', '', 'A', 10, 'standaard', '']);
      ws.getRow(1).font = { bold: true };
      ws.columns.forEach((c, i) => { c.width = [38, 28, 34, 16, 16, 16, 16, 8, 8, 10, 30][i]; });
      ws.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
      const info = wb.addWorksheet('Uitleg');
      [
        'Eén vraag per rij. Kopteksten in rij 1 niet wijzigen.',
        'Vraag = tekst; Code = Python-code (optioneel); Foutmelding = foutmelding (optioneel). Minstens één van de drie.',
        'A–D = antwoordopties (2 tot 4). Alleen A en B ingevuld, met "Waar"/"Onwaar" → Waar/onwaar-vraag.',
        'Juist = letter (A–D) of het nummer (1–4).',
        'Tijd = seconden (5–120, standaard 20). Punten = standaard, dubbel of geen.',
        'Afbeeldingen voeg je na het importeren toe in de editor.',
      ].forEach(t => info.addRow([t]));
      info.getColumn(1).width = 110;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="pyblitz-sjabloon.xlsx"');
      await wb.xlsx.write(res); res.end();
    } catch (e) { log.error('[pyblitz] sjabloon:', e.message); if (!res.headersSent) fout(res, 500, 'Sjabloon maken mislukt.'); }
  });

  // Afbeeldingen: client verkleint; hier controleren we de echte bytes.
  app.post('/api/pyblitz/image', requireTeacherAuth, requireCsrf, grootJson, async (req, res) => {
    try {
      let b64 = String((req.body && req.body.base64) || '');
      const komma = b64.indexOf(',');
      if (b64.startsWith('data:') && komma > -1) b64 = b64.slice(komma + 1);
      const buf = Buffer.from(b64, 'base64');
      if (!buf.length) return fout(res, 400, 'Geen afbeelding ontvangen.');
      if (buf.length > AFBEELDING_MAX_BYTES) return fout(res, 413, 'De afbeelding is te groot (max 600 kB).');
      const mime = herkenAfbeelding(buf);
      if (!mime) return fout(res, 400, 'Alleen PNG, JPEG of WebP. (SVG wordt om veiligheidsredenen geweigerd.)');
      const id = crypto.randomUUID();
      await dbModule.pyblitzSaveImage({ id, ownerId: eigenaar(req), mime, data: buf });
      res.json({ ok: true, id });
    } catch (e) { log.error('[pyblitz] afbeelding:', e.message); fout(res, 500, 'Uploaden mislukt.'); }
  });
  // Onraadbaar id; ook zichtbaar voor deelnemers en gasten (die hebben geen leerkrachtsessie).
  app.get('/api/pyblitz/image/:id', async (req, res) => {
    try {
      if (!P.geldigAfbeeldingId(req.params.id)) return fout(res, 404, 'Niet gevonden.');
      const r = await dbModule.pyblitzGetImage(req.params.id);
      if (!r) return fout(res, 404, 'Niet gevonden.');
      res.setHeader('Content-Type', r.mime);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.send(r.data);
    } catch (e) { fout(res, 500, 'Fout.'); }
  });

  app.get('/api/pyblitz/games', requireTeacherAuth, async (req, res) => {
    try { res.json({ games: await dbModule.pyblitzListGames(eigenaar(req), req.query.setId ? String(req.query.setId) : null) }); }
    catch (e) { fout(res, 500, 'Kon de geschiedenis niet laden.'); }
  });
  app.get('/api/pyblitz/games/:id', requireTeacherAuth, async (req, res) => {
    try {
      const g = await dbModule.pyblitzGetGame(req.params.id, eigenaar(req));
      if (!g) return fout(res, 404, 'Niet gevonden.');
      res.json({ game: g });
    } catch (e) { fout(res, 500, 'Kon het resultaat niet laden.'); }
  });

  // ════════════════════════════════════════════════════════════════════════
  // REST — gast (publiek): pincode + naam → token
  // ════════════════════════════════════════════════════════════════════════
  app.post('/api/pyblitz/join', async (req, res) => {
    try {
      const ip = req.ip || 'onbekend';
      const t = joinTeller.get(ip) || { n: 0, sinds: now() };
      if (now() - t.sinds > JOIN_VENSTER_MS) { t.n = 0; t.sinds = now(); }
      t.n++; joinTeller.set(ip, t);
      if (t.n > JOIN_MAX_PER_IP) return fout(res, 429, 'Te veel pogingen. Probeer het over enkele minuten opnieuw.');

      const pin = String((req.body && req.body.pin) || '').replace(/\D/g, '').slice(0, 8);
      const g = spelVan(perPin.get(pin));
      if (!g || g.spel.fase() === 'closed' || g.spel.fase() === 'final') return fout(res, 404, 'Deze code klopt niet of het spel is afgelopen.');
      const n = P.normaliseerGastNaam(req.body && req.body.naam);
      if (!n.ok) return fout(res, 400, n.error);
      if (g.spel.spelers().filter(p => p.guest).length >= GASTEN_MAX) return fout(res, 409, 'Dit spel zit vol.');

      // Een gast mag nooit de naam van een klaslid dragen (ook niet van wie nog niet is ingelogd).
      const session = sessions.get(g.sessie);
      const klas = new Set(g.klasNamen);
      if (session) for (const s of Object.values(session.students || {})) if (s && !s.removed) klas.add(P.naamSleutel(s.name));
      try {
        const ids = session ? Object.values(session.students || {}).map(s => s && s.dbStudentId).filter(Boolean) : [];
        (await dbModule.pyblitzKlasNamen(g.sessie, ids)).forEach(x => klas.add(P.naamSleutel(x)));
      } catch (e) { log.warn('[pyblitz] klasnamen ophalen mislukt:', e.message); }
      g.klasNamen = klas;
      if (klas.has(P.naamSleutel(n.naam))) return fout(res, 409, 'Deze naam is van een leerling uit de klas. Kies een andere naam (bv. met een extra letter of je familienaam).');

      // Een naam die al in gebruik is krijgt een nummer erachter.
      const bezet = new Set(g.spel.spelers().map(p => P.naamSleutel(p.name)));
      const naam = P.uniekeNaam(n.naam, bezet);
      const pid = 'g:' + crypto.randomBytes(6).toString('hex');
      const token = crypto.randomBytes(24).toString('hex');
      g.spel.voegSpelerToe({ id: pid, naam, gast: true });
      g.spel.verbonden(pid, false);       // pas verbonden zodra de socket zich met het token meldt
      tokens.set(token, { gameId: g.spel.id, playerId: pid });
      res.json({ ok: true, token, naam, gameId: g.spel.id });
    } catch (e) { log.error('[pyblitz] join:', e.message); fout(res, 500, 'Meedoen mislukt.'); }
  });

  // ════════════════════════════════════════════════════════════════════════
  // Sockets
  // ════════════════════════════════════════════════════════════════════════
  function attach(socket) {
    const antw = (cb) => (o) => { if (typeof cb === 'function') cb(o); };

    function teacherContext() {
      if (!socketIsTeacherAuthorized(socket)) return { fout: 'Leerkracht-authenticatie vereist' };
      const ctx = socketToUser.get(socket.id);
      if (!ctx || ctx.role !== 'teacher') return { fout: 'Geen sessie geopend' };
      const session = sessions.get(ctx.code);
      if (!session) return { fout: 'Sessie niet gevonden' };
      if (!socketMagSessie(socket, session)) return { fout: 'Deze sessie is van een andere leerkracht.' };
      return { session };
    }
    function hostSpel(c) {
      const g = spelVan(perSessie.get(c.session.code));
      return g || null;
    }
    const eigenaarSocket = () => eigenaarVan(socket.data && socket.data.teacher);

    function koppeling(session) {
      const k = session.pyblitz || (session.config && session.config._pyblitz) || null;
      return k && k.setId ? k : null;
    }

    // Toestand voor de knop in het leerkrachtenscherm.
    socket.on('teacher_pyblitz_status', (_p, cb) => {
      const a = antw(cb); const c = teacherContext(); if (c.fout) return a({ ok: false, error: c.fout });
      const g = hostSpel(c);
      const kandidaat = c.session.mode === 'class' && (c.session.classWorkspaceMode || 'shared') === 'shared';
      a({ ok: true, mogelijk: kandidaat, koppeling: koppeling(c.session), spel: g ? { id: g.spel.id, pin: g.spel.pin, fase: g.spel.fase() } : null });
    });
    // Koppelen (of ontkoppelen met setId=null).
    socket.on('teacher_pyblitz_koppel', async ({ setId } = {}, cb) => {
      const a = antw(cb); const c = teacherContext(); if (c.fout) return a({ ok: false, error: c.fout });
      try {
        if (!setId) { c.session.pyblitz = null; schedulePersist(c.session); return a({ ok: true, koppeling: null }); }
        const set = await dbModule.pyblitzGetSet(String(setId), eigenaarSocket());
        if (!set) return a({ ok: false, error: 'PyBlitz niet gevonden.' });
        c.session.pyblitz = { setId: set.id, setName: set.name };
        schedulePersist(c.session);
        a({ ok: true, koppeling: c.session.pyblitz });
      } catch (e) { a({ ok: false, error: 'Koppelen mislukt.' }); }
    });
    // Starten: opent de lobby bij leerkracht en leerlingen. Kan enkel in klasmodus, nooit in een toets/examensessie.
    socket.on('teacher_pyblitz_open', async ({ setId } = {}, cb) => {
      const a = antw(cb); const c = teacherContext(); if (c.fout) return a({ ok: false, error: c.fout });
      const session = c.session;
      if (session.mode !== 'class' || (session.classWorkspaceMode || 'shared') !== 'shared') {
        return a({ ok: false, error: 'PyBlitz kan enkel in klasmodus (gedeelde werkruimte), niet tijdens een toets, taak of individuele werkfase.' });
      }
      try {
        let g = hostSpel(c);
        if (g) { g.host.add(socket.id); socket.join('pb:' + g.spel.id); zendNaarHost(g); return a({ ok: true, hervat: true, gameId: g.spel.id }); }
        const kies = String(setId || (koppeling(session) || {}).setId || '');
        if (!kies) return a({ ok: false, error: 'Kies eerst een PyBlitz.' });
        const set = await dbModule.pyblitzGetSet(kies, eigenaarSocket());
        if (!set) return a({ ok: false, error: 'PyBlitz niet gevonden.' });
        if (!set.questions.length) return a({ ok: false, error: 'Deze PyBlitz heeft nog geen vragen.' });
        session.pyblitz = { setId: set.id, setName: set.name };
        schedulePersist(session);
        g = maakNieuwSpel(session, set, eigenaarSocket());
        g.host.add(socket.id); socket.join('pb:' + g.spel.id);
        // klasleden die nu online zijn doen meteen mee
        for (const s of Object.values(session.students || {})) {
          if (!s || s.removed || !s.socketId) continue;      // `online` wordt na een herverbinding niet altijd bijgewerkt: de socket zelf is de waarheid
          const sock = io.sockets.sockets.get(s.socketId); if (!sock || !sock.connected) continue;
          g.spel.voegSpelerToe({ id: 's:' + s.id, naam: s.name || 'Leerling' });
          koppelSocket(g, 's:' + s.id, sock);
        }
        zendAlles(g);
        a({ ok: true, gameId: g.spel.id, pin: g.spel.pin });
      } catch (e) { log.error('[pyblitz] openen:', e.message); a({ ok: false, error: 'Starten mislukt.' }); }
    });
    // Een herlaadde leerkrachtpagina pakt het lopende spel weer op.
    socket.on('teacher_pyblitz_sync', (_p, cb) => {
      const a = antw(cb); const c = teacherContext(); if (c.fout) return a({ ok: false, error: c.fout });
      const g = hostSpel(c); if (!g) return a({ ok: true, spel: null });
      g.host.add(socket.id); socket.join('pb:' + g.spel.id);
      zendNaarHost(g); a({ ok: true, spel: { id: g.spel.id } });
    });
    const hostActie = (naam, fn) => socket.on(naam, (_p, cb) => {
      const a = antw(cb); const c = teacherContext(); if (c.fout) return a({ ok: false, error: c.fout });
      const g = hostSpel(c); if (!g) return a({ ok: false, error: 'Geen PyBlitz actief.' });
      g.laatste = now();
      a(fn(g) || { ok: true });
    });
    hostActie('teacher_pyblitz_begin', (g) => g.spel.begin());
    hostActie('teacher_pyblitz_volgende', (g) => g.spel.volgende());
    hostActie('teacher_pyblitz_sluitvraag', (g) => g.spel.sluitVraag());
    hostActie('teacher_pyblitz_pauze', (g) => g.spel.pauzeer());
    hostActie('teacher_pyblitz_hervat', (g) => g.spel.hervat());
    // Stoppen of het eindresultaat afsluiten: ook alle popups bij de leerlingen en gasten gaan dicht.
    hostActie('teacher_pyblitz_sluit', (g) => { const reden = g.spel.fase() === 'final' ? 'klaar' : 'gestopt'; ruimOp(g, reden); return { ok: true }; });

    // Deelnemer: klasleerling (sessiesocket) of gast (token).
    socket.on('pyblitz_sync', (_p, cb) => {
      const a = antw(cb);
      const ctx = socketToUser.get(socket.id);
      if (!ctx || ctx.role !== 'student') return a({ ok: true, spel: null });
      const g = spelVan(perSessie.get(ctx.code)); if (!g) return a({ ok: true, spel: null });
      const session = sessions.get(ctx.code);
      const st = session && session.students && session.students[ctx.studentId];
      if (!st || st.removed) return a({ ok: true, spel: null });
      const pid = 's:' + ctx.studentId;
      g.spel.voegSpelerToe({ id: pid, naam: st.name || 'Leerling' });
      koppelSocket(g, pid, socket);
      zendNaarSpeler(g, pid);
      a({ ok: true, spel: { id: g.spel.id } });
    });
    socket.on('pyblitz_guest_connect', ({ token } = {}, cb) => {
      const a = antw(cb);
      const t = tokens.get(String(token || ''));
      const g = t && spelVan(t.gameId);
      if (!g || !g.spel.heeftSpeler(t.playerId)) return a({ ok: false, error: 'Je deelname is afgelopen.' });
      koppelSocket(g, t.playerId, socket);
      g.spel.verbonden(t.playerId, true);
      zendNaarSpeler(g, t.playerId);
      a({ ok: true });
    });
    socket.on('pyblitz_answer', ({ gameId, keuze } = {}, cb) => {
      const a = antw(cb);
      const pid = socket.data.pyblitz && socket.data.pyblitz.get(String(gameId));
      const g = spelVan(String(gameId));
      if (!g || !pid) return a({ ok: false, error: 'Je doet niet mee.' });
      g.laatste = now();
      a(g.spel.antwoord(pid, Number(keuze)));
    });
    socket.on('pyblitz_guest_leave', ({ token } = {}, cb) => {
      const t = tokens.get(String(token || '')); const g = t && spelVan(t.gameId);
      if (g && g.spel.fase() === 'lobby') { g.spel.verwijderSpeler(t.playerId); g.sockets.delete(t.playerId); tokens.delete(String(token)); }
      antw(cb)({ ok: true });
    });

    socket.on('disconnect', () => {
      for (const g of spellen.values()) {
        g.host.delete(socket.id);
        for (const pid of [...g.sockets.keys()]) {
          if (g.sockets.get(pid).has(socket.id)) opgeruimdeSpeler(g, pid, socket.id);
        }
      }
    });
  }

  return { attach, _spellen: spellen, _tokens: tokens, _ruimOp: ruimOp, stop: () => clearInterval(sweep) };
}

module.exports = { registerPyblitzRoutes, eigenaarVan };

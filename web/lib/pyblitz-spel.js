'use strict';
// ════════════════════════════════════════════════════════════════════════════
// v151 — PyBlitz: de spelmotor (server-autoritatief, zonder sockets).
//   lobby → vraag → resultaat → … → eindstand → gesloten
// De server beheert de tijd; clients tonen enkel. Het juiste antwoord zit pas in de payload
// zodra de vraag gesloten is. Klok en timers zijn injecteerbaar zodat alles testbaar is.
// ════════════════════════════════════════════════════════════════════════════

const P = require('./pyblitz');

const GENADE_MS = 400;      // netwerkvertraging die we nog toelaten na het einde van de timer
const TOP_N = 5;

function maakSpel(opt) {
  const {
    id, pin, set, sessionCode = null, ownerId = null,
    now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
    onChange = () => {}, onEinde = () => {},
  } = opt;
  const vragen = set.questions;
  const spelers = new Map();     // id → speler
  const s = {
    id, pin, setId: set.id, naam: set.name, sessionCode, ownerId,
    fase: 'lobby', index: -1, gemaakt: now(), begonnen: null, geeindigd: null,
    vraagStart: 0, deadline: 0, gepauzeerd: false, restMs: 0, pauzeStart: 0,
    antwoorden: new Map(),       // spelerId → { keuze, ms }
    vraagUitslag: [],            // per afgewerkte vraag: statistiek
    laatsteTelling: null,        // tellingen van de laatste afgesloten vraag
    reden: null,
  };
  let timer = null;
  const wis = () => { if (timer) { clearTimer(timer); timer = null; } };
  const meld = () => { try { onChange(s); } catch { /* de motor mag nooit stuk door een luisteraar */ } };

  // ── spelers ──────────────────────────────────────────────────────────────
  function voegSpelerToe({ id: sid, naam, gast = false }) {
    let p = spelers.get(sid);
    if (!p) {
      p = { id: sid, name: naam, guest: !!gast, points: 0, streak: 0, bestStreak: 0, correct: 0, answered: 0,
            totalMs: 0, fastestMs: null, connected: true, joinedAt: now(), prevRank: null, rank: null, last: null };
      spelers.set(sid, p);
    } else { p.name = naam || p.name; p.connected = true; }
    meld();
    return p;
  }
  function verbonden(sid, ja) {
    const p = spelers.get(sid); if (!p) return;
    p.connected = !!ja;
    if (s.fase === 'question' && !s.gepauzeerd) controleerIedereenKlaar();
    meld();
  }
  function verwijderSpeler(sid) { spelers.delete(sid); s.antwoorden.delete(sid); meld(); }
  const verbondenSpelers = () => [...spelers.values()].filter(p => p.connected);

  // ── verloop ──────────────────────────────────────────────────────────────
  function begin() {
    if (s.fase !== 'lobby') return { ok: false, error: 'Het spel is al gestart.' };
    if (!vragen.length) return { ok: false, error: 'Deze PyBlitz heeft geen vragen.' };
    if (spelers.size < 1) return { ok: false, error: 'Wacht tot er minstens één deelnemer is.' };
    s.begonnen = now();
    startVraag(0);
    return { ok: true };
  }
  function startVraag(i) {
    wis();
    const q = vragen[i];
    s.fase = 'question'; s.index = i; s.antwoorden = new Map(); s.gepauzeerd = false;
    s.vraagStart = now(); s.deadline = s.vraagStart + q.seconds * 1000;
    for (const p of spelers.values()) { p.prevRank = p.rank; p.last = null; }
    timer = setTimer(() => sluitVraag(), q.seconds * 1000 + GENADE_MS);
    meld();
  }
  function controleerIedereenKlaar() {
    const v = verbondenSpelers();
    if (v.length > 0 && v.every(p => s.antwoorden.has(p.id))) sluitVraag();
  }
  function antwoord(sid, keuze) {
    if (s.fase !== 'question' || s.gepauzeerd) return { ok: false, error: 'Geen open vraag.' };
    const p = spelers.get(sid);
    if (!p) return { ok: false, error: 'Onbekende speler.' };
    if (s.antwoorden.has(sid)) return { ok: false, error: 'Je hebt al geantwoord.' };
    const q = vragen[s.index];
    if (!Number.isInteger(keuze) || keuze < 0 || keuze >= q.options.length) return { ok: false, error: 'Ongeldig antwoord.' };
    const t = now();
    if (t > s.deadline + GENADE_MS) return { ok: false, error: 'Te laat.' };
    s.antwoorden.set(sid, { keuze, ms: Math.min(Math.max(0, t - s.vraagStart), q.seconds * 1000) });
    p.connected = true;
    meld();
    controleerIedereenKlaar();
    return { ok: true };
  }
  function sluitVraag() {
    if (s.fase !== 'question') return { ok: false };
    wis();
    const q = vragen[s.index];
    const tellingen = q.options.map(() => 0);
    let juistTotaal = 0, antwoordTotaal = 0;
    for (const p of spelers.values()) {
      const a = s.antwoorden.get(p.id);
      if (!a) { p.streak = 0; p.last = { answered: false, correct: false, delta: 0, picked: null }; continue; }
      const juist = a.keuze === q.correct;
      tellingen[a.keuze]++; antwoordTotaal++;
      p.answered++; p.totalMs += a.ms;
      if (juist) { p.correct++; p.streak++; juistTotaal++; if (p.streak > p.bestStreak) p.bestStreak = p.streak; if (p.fastestMs == null || a.ms < p.fastestMs) p.fastestMs = a.ms; }
      else p.streak = 0;
      const pt = P.berekenPunten({ juist, verstrekenMs: a.ms, limietMs: q.seconds * 1000, punten: q.points, reeks: p.streak });
      p.points += pt.totaal;
      p.last = { answered: true, correct: juist, delta: pt.totaal, bonus: pt.bonus, picked: a.keuze, ms: a.ms };
    }
    P.rangschik([...spelers.values()]);
    s.laatsteTelling = tellingen;
    s.vraagUitslag.push({ index: s.index, id: q.id, text: q.text || (q.code ? 'Codevraag' : 'Vraag'), counts: tellingen, correctIndex: q.correct,
                          answered: antwoordTotaal, correctCount: juistTotaal, players: spelers.size });
    s.fase = 'reveal';
    meld();
    return { ok: true };
  }
  function volgende() {
    if (s.fase === 'question') return sluitVraag();
    if (s.fase !== 'reveal') return { ok: false, error: 'Er is niets om naar door te gaan.' };
    if (s.index + 1 < vragen.length) { startVraag(s.index + 1); return { ok: true }; }
    return naarEind();
  }
  function naarEind() {
    wis();
    s.fase = 'final'; s.geeindigd = now(); s.reden = 'klaar';
    P.rangschik([...spelers.values()]);
    meld();
    try { onEinde(resultaat()); } catch { /* opslaan mag het spel niet blokkeren */ }
    return { ok: true };
  }
  function pauzeer() {
    if (s.fase !== 'question' || s.gepauzeerd) return { ok: false };
    wis(); s.gepauzeerd = true; s.pauzeStart = now(); s.restMs = Math.max(0, s.deadline - s.pauzeStart);
    meld(); return { ok: true };
  }
  function hervat() {
    if (s.fase !== 'question' || !s.gepauzeerd) return { ok: false };
    const pauze = now() - s.pauzeStart;
    s.vraagStart += pauze; s.deadline += pauze; s.gepauzeerd = false;
    timer = setTimer(() => sluitVraag(), Math.max(0, s.deadline - now()) + GENADE_MS);
    meld(); return { ok: true };
  }
  function stop() {
    if (s.fase === 'closed') return { ok: true };
    const volledig = s.fase === 'final';
    wis();
    if (!volledig) { s.geeindigd = now(); s.reden = 'gestopt'; P.rangschik([...spelers.values()]); try { onEinde(resultaat()); } catch { /* idem */ } }
    s.fase = 'closed';
    meld();
    return { ok: true };
  }
  const sluit = stop;

  // ── resultaat (wordt bewaard) ────────────────────────────────────────────
  function resultaat() {
    const lijst = P.rangschik([...spelers.values()]);
    const totaalAntw = lijst.reduce((t, p) => t + p.answered, 0);
    const totaalJuist = lijst.reduce((t, p) => t + p.correct, 0);
    const moeilijkste = s.vraagUitslag.filter(u => u.answered > 0).sort((a, b) => (a.correctCount / a.answered) - (b.correctCount / b.answered))[0] || null;
    return {
      reden: s.reden, vragenGespeeld: s.vraagUitslag.length, vragenTotaal: vragen.length,
      gemiddeldJuistPct: totaalAntw ? Math.round(100 * totaalJuist / totaalAntw) : 0,
      moeilijkste: moeilijkste ? { nr: moeilijkste.index + 1, text: moeilijkste.text, juistPct: Math.round(100 * moeilijkste.correctCount / moeilijkste.answered) } : null,
      spelers: lijst.map(p => ({ id: p.id, naam: p.name, gast: p.guest, plaats: p.rank, punten: p.points, juist: p.correct, beantwoord: p.answered,
                                 besteReeks: p.bestStreak, snelsteMs: p.fastestMs })),
      vragen: s.vraagUitslag,
    };
  }

  // ── payloads ─────────────────────────────────────────────────────────────
  const publiekeVraag = (q) => ({
    type: q.type, text: q.text, code: q.code || '', error: q.error || '', imageId: q.imageId || null,
    options: q.options.map(o => ({ text: o.text, code: !!o.code })), seconds: q.seconds, points: q.points,
  });
  const top = (n) => P.rangschik([...spelers.values()]).slice(0, n).map(p => ({
    id: p.id, name: p.name, guest: p.guest, points: p.points, rank: p.rank, prevRank: p.prevRank, streak: p.streak,
    delta: p.last ? p.last.delta : 0,
  }));
  // sid = spelerId voor een deelnemer, null voor de host
  function toestand(sid) {
    const host = sid == null;
    const p = host ? null : spelers.get(sid);
    const basis = {
      gameId: s.id, fase: s.fase, naam: s.naam, pin: s.pin, index: s.index, totaal: vragen.length,
      spelers: spelers.size, verbonden: verbondenSpelers().length, nu: now(),
    };
    if (p) {
      basis.jij = { naam: p.name, punten: p.points, plaats: p.rank, reeks: p.streak, gast: p.guest };
    }
    if (s.fase === 'lobby') {
      basis.namen = [...spelers.values()].map(x => ({ name: x.name, guest: x.guest })).slice(0, 200);
    } else if (s.fase === 'question') {
      basis.vraag = publiekeVraag(vragen[s.index]);
      basis.deadline = s.deadline; basis.start = s.vraagStart; basis.gepauzeerd = s.gepauzeerd; basis.restMs = s.restMs;
      basis.beantwoord = s.antwoorden.size;
      if (p) basis.jijAntwoordde = s.antwoorden.has(p.id) ? s.antwoorden.get(p.id).keuze : null;
    } else if (s.fase === 'reveal') {
      const q = vragen[s.index];
      basis.vraag = publiekeVraag(q);
      basis.juist = q.correct; basis.uitleg = q.explanation || ''; basis.tellingen = s.laatsteTelling;
      basis.top = top(TOP_N); basis.laatste = s.index + 1 >= vragen.length; basis.beantwoord = s.antwoorden.size;
      if (p) basis.jij = { ...basis.jij, resultaat: p.last || { answered: false, correct: false, delta: 0, picked: null } };
    } else if (s.fase === 'final') {
      const r = resultaat();
      basis.podium = top(3);
      basis.lijst = r.spelers.slice(0, 50);
      basis.gemiddeldJuistPct = r.gemiddeldJuistPct; basis.moeilijkste = r.moeilijkste;
      if (p) basis.jij = { ...basis.jij, juist: p.correct, beantwoord: p.answered, besteReeks: p.bestStreak, snelsteMs: p.fastestMs, vragen: vragen.length };
    }
    return basis;
  }

  return {
    get toestandNu() { return s; },
    id, pin, voegSpelerToe, verbonden, verwijderSpeler, spelers: () => [...spelers.values()],
    heeftSpeler: (sid) => spelers.has(sid),
    begin, antwoord, sluitVraag, volgende, pauzeer, hervat, stop, sluit, toestand, resultaat,
    fase: () => s.fase,
  };
}

module.exports = { maakSpel, GENADE_MS, TOP_N };

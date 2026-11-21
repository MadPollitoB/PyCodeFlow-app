// v143 — Toegang herstellen tijdens een toets, en waar een heropende leerling verder gaat.
// Pure functies (geen server, geen databank): zo zijn ze volledig te testen.

const MS_MIN = 60 * 1000;
const MAX_EXTRA_MIN = 600;

function normaliseerExtraMinuten(v) {
  const n = Number(String(v == null ? 0 : v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_EXTRA_MIN, Math.round(n));
}

/**
 * v146 — de ene rekenregel voor tijd (leerling, live-overzicht, herstel-popup en nakijken gebruiken ze allemaal).
 *
 *   geen duur, geen deadline → modus 'geen':     geen teller, geen automatisch indienen
 *   alleen een deadline      → modus 'deadline': geen teller; automatisch indienen op de deadline (+ extra)
 *   alleen een duur          → modus 'duur':     teller = start + duur (+ extra)
 *   duur én deadline         → modus 'beide':    teller = de KORTSTE van start + duur en de deadline (+ extra)
 *
 * Extra tijd (een bewuste gunst van de leerkracht, per leerling) schuift het einde op en mag de deadline
 * overschrijden: voor die leerling schuift de deadline mee. Onderbrekingen of een herstel geven nooit tijd terug.
 */
function berekenTimer({ start = null, timerSeconds = null, noTimer = false, deadline = null, extraSeconds = 0 } = {}) {
  const heeftDuur = !noTimer && Number(timerSeconds) > 0;
  const dl = deadline != null && deadline !== '' && Number(deadline) > 0 ? Number(deadline) : null;
  const extraMs = Math.max(0, Number(extraSeconds) || 0) * 1000;
  const modus = heeftDuur ? (dl != null ? 'beide' : 'duur') : (dl != null ? 'deadline' : 'geen');
  let eindAt = null;
  if (modus === 'deadline') eindAt = dl + extraMs;
  else if (heeftDuur && Number(start) > 0) {
    const duurEind = Number(start) + Number(timerSeconds) * 1000;
    eindAt = (dl != null ? Math.min(duurEind, dl) : duurEind) + extraMs;
  }
  return {
    modus,
    heeftTeller: heeftDuur,
    eindAt,                       // moment van afsluiten (null = geen)
    totaalSec: heeftDuur && eindAt != null && Number(start) > 0 ? Math.max(0, Math.round((eindAt - Number(start)) / 1000)) : null,
    deadline: dl,
  };
}

/**
 * Herstel van een leerling. De eigen eindtijd is ALTIJD de timerregel hierboven (start + duur, begrensd door de
 * deadline, + eventuele extra tijd) en schuift door een herstel nooit op: wie 5 minuten weg was, heeft 5 minuten minder.
 *
 * @param {object} o
 * @param {number|null} o.start        moment waarop de leerling startte (null = onbekend)
 * @param {number|null} o.timerSeconds duur van de toets (null/0 = geen timer)
 * @param {boolean} o.noTimer
 * @param {number|null} o.accessUntil  deadline van de toets
 * @param {number|null} o.stoppedAt
 * @param {number} o.extraMinuten
 * @param {'eind'|'vanafNu'} o.extraModus  'eind': extra minuten bovenop zijn eigen einde (standaard);
 *                                         'vanafNu': hij krijgt nog zoveel minuten vanaf dit moment
 * @param {number} o.now
 */
function berekenHerstel({ start = null, timerSeconds = null, noTimer = false, accessUntil = null,
                          stoppedAt = null, extraMinuten = 0, extraModus = 'eind', now = Date.now() } = {}) {
  const minuten = normaliseerExtraMinuten(extraMinuten);
  const deadline = accessUntil != null && accessUntil !== '' ? Number(accessUntil) : null;
  const toestand = {
    gestopt: !!stoppedAt,
    deadlineVoorbij: deadline != null && now > deadline,
  };
  const basis = berekenTimer({ start, timerSeconds, noTimer, deadline, extraSeconds: 0 });

  // Extra seconden: bovenop het einde, of zoveel dat hij nog 'minuten' vanaf nu heeft.
  let extraSec = minuten * 60;
  if (extraModus === 'vanafNu' && minuten > 0 && basis.eindAt != null) {
    extraSec = Math.max(0, Math.round((now + minuten * MS_MIN - basis.eindAt) / 1000));
  }
  const t = berekenTimer({ start, timerSeconds, noTimer, deadline, extraSeconds: extraSec });
  const heeftTimer = t.heeftTeller && Number(start) > 0;
  const extraMs = extraSec * 1000;

  let eigenEind = null;
  let individueelTot;
  let terugval = false;
  if (heeftTimer) {
    eigenEind = t.eindAt;
    // De leerling moet er altijd in kunnen (ook als zijn tijd al op is: dan sluit de timer meteen
    // weer af en kan de leerkracht extra minuten geven). Daarom minstens 1 minuut toegangsvenster.
    individueelTot = Math.max(eigenEind, now + MS_MIN);
  } else if (deadline != null && deadline + extraMs > now && !toestand.gestopt) {
    individueelTot = deadline + extraMs;
  } else {
    // Geen timer en de toets is gestopt of de deadline voorbij: een kort, expliciet venster.
    terugval = true;
    // v149: 'vanaf nu' met een bewust gekozen aantal minuten is EXACT dat aantal (de leerkracht zegt
    // "hij heeft nog 10 minuten"); enkel zonder keuze blijft het veiligheidsvenster van minstens 15 min.
    individueelTot = now + ((extraModus === 'vanafNu' && minuten > 0) ? minuten : Math.max(extraSec / 60, 15)) * MS_MIN;
  }

  return {
    eigenEind,
    resterendSec: eigenEind != null ? Math.max(0, Math.round((eigenEind - now) / 1000)) : null,
    tijdOp: eigenEind != null && eigenEind <= now,
    individueelTot,
    extraSeconden: extraSec,
    startBekend: Number(start) > 0,
    heeftTimer,
    modus: t.modus,
    terugval,
    toestand,
  };
}

/**
 * Op welke vraag komt een heropende leerling terecht?
 *  - "1 kans per vraag" (noBack): op de eerste vraag die nog niet bewust bevestigd is. Zijn alle vragen
 *    bevestigd, dan op de laatste.
 *  - terugbladeren toegestaan: op de eerste vraag zonder antwoord; is alles beantwoord, dan op de plek
 *    waar hij gebleven was.
 * @param {object[]} vragen ordered: [{ id, question_type }]
 * @param {Object<string,object>} opgeslagen per vraag-id de databankrij (confirmed_at, code, ...)
 * @param {(type:string,row:object)=>boolean} heeftAntwoord
 */
function bepaalHervatIndex({ vragen = [], opgeslagen = {}, noBack = false, huidige = 0, heeftAntwoord = () => false } = {}) {
  if (!vragen.length) return 0;
  if (noBack) {
    const i = vragen.findIndex(q => !(opgeslagen[q.id] && opgeslagen[q.id].confirmed_at != null));
    return i === -1 ? vragen.length - 1 : i;
  }
  const i = vragen.findIndex(q => !heeftAntwoord(q.question_type, opgeslagen[q.id] || {}));
  if (i !== -1) return i;
  const h = Number.isInteger(huidige) ? huidige : 0;
  return Math.max(0, Math.min(h, vragen.length - 1));
}

module.exports = { berekenTimer, berekenHerstel, bepaalHervatIndex, normaliseerExtraMinuten, MAX_EXTRA_MIN };

'use strict';
// v146: echte status van een sessie voor de monitoringpagina (voorheen stond alles op "actief").
// Zuivere functie; dezelfde regels als het overzicht van toetsen en taken.

const LABELS = {
  lopend: 'lopend', gepland: 'gepland', deadline_voorbij: 'deadline voorbij', gestopt: 'gestopt',
  gearchiveerd: 'gearchiveerd', geblokkeerd: 'geblokkeerd', actief: 'actief', rustig: 'rustig',
};

function sessieStatus({ mode, blocked = false, meta = null, online = 0, running = 0, now = Date.now() } = {}) {
  if (blocked) return { status: 'geblokkeerd', label: LABELS.geblokkeerd, lopend: true };
  if (mode === 'quiz' || mode === 'task' || mode === 'exam') {
    if (!meta) return { status: 'lopend', label: LABELS.lopend, lopend: online > 0 };
    if (meta.archived) return { status: 'gearchiveerd', label: LABELS.gearchiveerd, lopend: online > 0 };
    if (meta.stopped_at) return { status: 'gestopt', label: LABELS.gestopt, lopend: online > 0 };
    const tot = meta.access_until != null ? Number(meta.access_until) : null;
    if (tot != null && now > tot) return { status: 'deadline_voorbij', label: LABELS.deadline_voorbij, lopend: online > 0 };
    const vanaf = meta.access_from != null ? Number(meta.access_from) : null;
    if (vanaf != null && now < vanaf) return { status: 'gepland', label: LABELS.gepland, lopend: online > 0 };
    return { status: 'lopend', label: LABELS.lopend, lopend: true };
  }
  // klassessie: "actief" zodra er iemand verbonden is of iets draait, anders rustig
  const bezig = online > 0 || running > 0;
  return { status: bezig ? 'actief' : 'rustig', label: bezig ? LABELS.actief : LABELS.rustig, lopend: bezig };
}

module.exports = { sessieStatus, LABELS };

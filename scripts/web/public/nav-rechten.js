// Sprint 55 — nav-rechten: verberg Beheer/Systeem-links naargelang de rol.
// Wordt op alle leerkrachtpagina's geladen; faalt stil (bij twijfel niets verbergen —
// de server dwingt de echte toegang toch af via requireBeheer/requireSysteem).
(async function () {
  try {
    const r = await fetch('/api/me');
    if (!r.ok) return;
    const me = await r.json();
    document.querySelectorAll('a[href="/admin.html"], a[href="admin.html"]').forEach(a => {
      if (me.magBeheer === false) a.remove();
    });
    document.querySelectorAll('a[href="/monitoring.html"], a[href="monitoring.html"]').forEach(a => {
      if (me.magSysteem === false) a.remove();
    });
    // Autocheck-badge opent monitoring — ook weg zonder Systeem-recht.
    if (me.magSysteem === false) {
      const b = document.getElementById('autocheck-badge');
      if (b) b.remove();
    }
  } catch (e) { /* stil */ }
})();

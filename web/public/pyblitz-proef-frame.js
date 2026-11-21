'use strict';
// v152 — één helft van de proef-splitscreen: toont de toestand die de ouderpagina stuurt en geeft acties terug.
(function () {
  const host = new URLSearchParams(location.search).get('rol') === 'host';
  const stuur = (naam, arg) => parent.postMessage({ pbProef: 'actie', rol: host ? 'host' : 'speler', naam, arg }, location.origin);
  const ui = window.PyBlitzUI.maak(document.getElementById('pb-root'), {
    host,
    acties: host
      ? { begin: () => stuur('begin'), volgende: () => stuur('volgende'), sluitvraag: () => stuur('sluitvraag'), pauze: () => stuur('pauze'), hervat: () => stuur('hervat'), sluit: () => stuur('sluit') }
      : { antwoord: (i) => { stuur('antwoord', i); return Promise.resolve({ ok: true }); } },
  });
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || e.data.pbProef !== 'state') return;
    if (e.data.state) ui.toon(e.data.state); else ui.stop();
  });
  parent.postMessage({ pbProef: 'klaar', rol: host ? 'host' : 'speler' }, location.origin);
})();

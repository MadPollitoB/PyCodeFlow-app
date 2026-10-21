// v124 — waarschuwing op het sessieoverzicht als het netwerk of accounts geblokkeerd zijn.
(function () {
  'use strict';
  var f = window.apiFetch || fetch;
  function toon(n) {
    var el = document.getElementById('toegang-banner');
    var blok = n.geblokkeerdMs > 0 || n.geblokkeerdeAccounts > 0;
    if (!blok) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'toegang-banner';
      el.style.cssText = 'background:#fee2e2;border:1.5px solid #ef4444;color:#7f1d1d;border-radius:10px;padding:10px 14px;margin:0 0 14px;font-weight:600;';
      var page = document.querySelector('.page') || document.body;
      page.insertBefore(el, page.firstChild);
    }
    el.innerHTML = '🔒 ' + (n.geblokkeerdMs > 0 ? 'Je netwerk is geblokkeerd door te veel mislukte inlogpogingen.' : n.geblokkeerdeAccounts + ' leerlingaccount(s) zijn geblokkeerd.') +
      ' <a href="/teacher-toegang.html" style="color:inherit;text-decoration:underline;">Ontgrendelen →</a>';
  }
  function check() {
    f('/api/teacher/toegang').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && d.netwerk) toon(d.netwerk); }).catch(function () {});
  }
  check(); setInterval(check, 20000);
})();

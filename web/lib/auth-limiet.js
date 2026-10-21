'use strict';
// PyCodeFlow v124 — inlogbeveiliging die een school niet platlegt.
// Vroeger: één gedeelde teller per IP-adres. Op school delen alle leerlingen (en de leerkracht)
// hetzelfde IP, dus 6 foute wachtwoorden van wie dan ook blokkeerde het hele netwerk 30 minuten.
// Nu:
//  - de teller hangt aan (IP + account): een leerling die zijn eigen wachtwoord verkeerd typt
//    blokkeert enkel zichzelf, en maar 10 minuten;
//  - per account over alle IP's heen een ruimer plafond (tegen gespreid raden);
//  - per IP een hoog plafond (tegen overspoelen), ruim boven wat een klas kan veroorzaken;
//  - leerkrachten en beheerders ("zacht") worden NOOIT geblokkeerd: enkel een oplopende
//    vertraging, los van de leerlingen. Elke poging blijft gelogd door de aanroeper.
// Pure logica met injecteerbare klok, zodat alles zonder server te testen is.

function maakLimiet(opt = {}) {
  const nu = opt.now || Date.now;
  const VENSTER = opt.venster ?? 15 * 60 * 1000;
  const MAX_PAAR = opt.maxPaar ?? 6;                 // fouten per (ip + account)
  const BLOK_PAAR = opt.blokPaar ?? 10 * 60 * 1000;
  const MAX_ACCOUNT = opt.maxAccount ?? 40;          // fouten per account, alle IP's samen
  const BLOK_ACCOUNT = opt.blokAccount ?? 15 * 60 * 1000;
  const MAX_IP = opt.maxIp ?? 100;                   // fouten per IP, alle accounts samen
  const BLOK_IP = opt.blokIp ?? 15 * 60 * 1000;
  const BASIS_VERTRAGING = opt.basisVertraging ?? 750;
  const MAX_VERTRAGING = opt.maxVertraging ?? 5000;

  const emmers = new Map();   // sleutel -> { soort, ip, account, fouten: [ts], blokTot }

  const norm = (a) => String(a || '').trim().toLowerCase();
  const sleutelPaar = (ip, a) => `p|${ip}|${a}`;
  const sleutelIp = (ip) => `i|${ip}`;
  const sleutelAccount = (a) => `a|${a}`;

  function emmer(sleutel, soort, ip, account) {
    let e = emmers.get(sleutel);
    if (!e) { e = { soort, ip, account, fouten: [], blokTot: 0 }; emmers.set(sleutel, e); }
    const t = nu();
    e.fouten = e.fouten.filter(ts => t - ts <= VENSTER);
    return e;
  }
  function opruimen(sleutel) {
    const e = emmers.get(sleutel);
    if (e && !e.fouten.length && e.blokTot <= nu()) emmers.delete(sleutel);
  }
  function bestaat(sleutel) { return emmers.get(sleutel); }

  // Resterende blokkade (ms) voor dit IP + account, met de reden.
  function controleer(ip, account) {
    const a = norm(account), t = nu();
    let rest = 0, reden = null;
    const kandidaten = [bestaat(sleutelIp(ip))];
    if (a) kandidaten.push(bestaat(sleutelPaar(ip, a)), bestaat(sleutelAccount(a)));
    for (const e of kandidaten) {
      if (e && e.blokTot > t && e.blokTot - t > rest) { rest = e.blokTot - t; reden = e.soort; }
    }
    return { geblokkeerdMs: rest, reden };
  }

  // Registreert een mislukte poging. zacht = leerkracht/beheerder: nooit een blokkade.
  function mislukt(ip, account, { zacht = false } = {}) {
    const a = norm(account), t = nu();
    const paar = emmer(sleutelPaar(ip, a || '-'), 'paar', ip, a);
    paar.fouten.push(t);
    const vertragingTeller = paar.fouten.length;
    if (!zacht) {
      if (a && paar.fouten.length >= MAX_PAAR) paar.blokTot = Math.max(paar.blokTot, t + BLOK_PAAR);
      const ipE = emmer(sleutelIp(ip), 'ip', ip, '');
      ipE.fouten.push(t);
      if (ipE.fouten.length >= MAX_IP) ipE.blokTot = Math.max(ipE.blokTot, t + BLOK_IP);
      if (a) {
        const acc = emmer(sleutelAccount(a), 'account', '', a);
        acc.fouten.push(t);
        if (acc.fouten.length >= MAX_ACCOUNT) acc.blokTot = Math.max(acc.blokTot, t + BLOK_ACCOUNT);
      }
    }
    const vertraging = Math.min(MAX_VERTRAGING, BASIS_VERTRAGING * (2 ** Math.max(0, Math.min(6, vertragingTeller - 1))));
    const stand = controleer(ip, a);
    return { vertragingMs: vertraging, geblokkeerdMs: zacht ? 0 : stand.geblokkeerdMs, reden: zacht ? null : stand.reden, fouten: vertragingTeller };
  }

  // Geslaagde login: enkel de eigen (ip + account)-teller en de account-teller wissen,
  // nooit de IP-teller (anders reset één geslaagde leerling de bescherming van het netwerk).
  function gelukt(ip, account) {
    const a = norm(account);
    emmers.delete(sleutelPaar(ip, a || '-'));
    if (a) emmers.delete(sleutelAccount(a));
  }

  function ontgrendelIp(ip) {
    let n = 0;
    for (const [k, e] of [...emmers.entries()]) {
      if (e.ip === ip) { emmers.delete(k); n++; }
    }
    return n;
  }
  function ontgrendelAccount(account) {
    const a = norm(account);
    let n = 0;
    for (const [k, e] of [...emmers.entries()]) {
      if (e.account === a && a) { emmers.delete(k); n++; }
    }
    return n;
  }
  function ontgrendelAlles() { const n = emmers.size; emmers.clear(); return n; }

  function lijst() {
    const t = nu(), uit = [];
    for (const [k, e] of [...emmers.entries()]) {
      e.fouten = e.fouten.filter(ts => t - ts <= VENSTER);
      const rest = e.blokTot > t ? e.blokTot - t : 0;
      if (!e.fouten.length && !rest) { emmers.delete(k); continue; }
      uit.push({ soort: e.soort, ip: e.ip, account: e.account, fouten: e.fouten.length, blokTot: e.blokTot || 0, resterendMs: rest });
    }
    return uit.sort((x, y) => y.resterendMs - x.resterendMs);
  }

  return { controleer, mislukt, gelukt, ontgrendelIp, ontgrendelAccount, ontgrendelAlles, lijst,
           _opruimen: opruimen, config: { VENSTER, MAX_PAAR, BLOK_PAAR, MAX_ACCOUNT, BLOK_ACCOUNT, MAX_IP, BLOK_IP } };
}

// Leesbare melding met de resterende tijd.
function blokkadeTekst(ms) {
  const min = Math.max(1, Math.ceil(ms / 60000));
  return `Te veel mislukte pogingen voor dit account. Probeer over ${min} ${min === 1 ? 'minuut' : 'minuten'} opnieuw, of vraag je leerkracht om je account te ontgrendelen.`;
}

module.exports = { maakLimiet, blokkadeTekst };

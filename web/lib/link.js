'use strict';
// v147: links die de leerkracht naar de leerlingen stuurt (klasmodus). Zuivere functies.
const MAX_URL = 2000, MAX_TITEL = 80, MAX_LINKS = 50;

function domeinVan(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Zonder schema → https:// ervoor. Enkel http/https; titel standaard = domein.
function normaliseerLink(titel, url) {
  let u = String(url == null ? '' : url).trim();
  if (!u) return { ok: false, error: 'Vul een link in.' };
  if (u.length > MAX_URL) return { ok: false, error: 'De link is te lang.' };
  if (/\s/.test(u)) return { ok: false, error: 'Een link mag geen spaties bevatten.' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^https?:\/\//i.test(u)) return { ok: false, error: 'Enkel http- of https-links zijn toegelaten.' };
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
  let parsed;
  try { parsed = new URL(u); } catch { return { ok: false, error: 'Dit is geen geldige link.' }; }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname || !parsed.hostname.includes('.') && parsed.hostname !== 'localhost') {
    return { ok: false, error: 'Dit is geen geldige link.' };
  }
  const t = String(titel == null ? '' : titel).replace(/\s+/g, ' ').trim().slice(0, MAX_TITEL) || domeinVan(u);
  return { ok: true, titel: t, url: parsed.href, domein: domeinVan(u) };
}

// Voor het bewaren bij de sessie: ongeldige (of lege) items vallen weg, de rest wordt opgeschoond.
function normaliseerLinks(lijst) {
  const uit = [];
  for (const x of (Array.isArray(lijst) ? lijst : []).slice(0, MAX_LINKS)) {
    const titel = x && x.titel, url = x && x.url;
    if (!String(url || '').trim() && !String(titel || '').trim()) { uit.push({ titel: '', url: '' }); continue; }
    const r = normaliseerLink(titel, url);
    uit.push(r.ok ? { titel: r.titel, url: r.url } : { titel: String(titel || '').slice(0, MAX_TITEL), url: String(url || '').slice(0, MAX_URL) });
  }
  return uit.length ? uit : [{ titel: '', url: '' }];
}

module.exports = { MAX_URL, MAX_TITEL, MAX_LINKS, domeinVan, normaliseerLink, normaliseerLinks };

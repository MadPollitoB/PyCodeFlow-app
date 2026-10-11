/* PyCodeFlow – gedeelde popups (toast, bevestigen, invoer, melding).
 * Dit zijn de ENIGE dialogen van het programma: gebruik nooit alert(), confirm() of prompt() van de browser.
 *   await pyConfirm({ title, body, confirmLabel, cancelLabel, danger })  → true/false
 *   await pyPrompt({ title, body, defaultValue, confirmLabel })          → tekst of null
 *   await pyAlert(tekst, 'error'|'warn'|'success'|'info')
 *   pyToast(tekst, type, duurMs)
 * Wordt geladen vóór app.js (en op pagina's zonder app.js zoals training.html). */
// CSS eenmalig injecteren
(function injectModalCSS() {
  if (document.getElementById('py-modal-css')) return;
  const style = document.createElement('style');
  style.id = 'py-modal-css';
  style.textContent = `
    /* Toast */
    #py-toast-container {
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      display: flex; flex-direction: column; gap: 10px; pointer-events: none;
    }
    .py-toast {
      min-width: 260px; max-width: 400px; padding: 12px 16px;
      border-radius: 12px; font-size: 0.9rem; font-weight: 600;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      display: flex; align-items: flex-start; gap: 10px;
      pointer-events: auto; cursor: pointer;
      animation: py-toast-in 0.2s ease;
    }
    @keyframes py-toast-in {
      from { opacity: 0; transform: translateX(24px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    .py-toast-success { background: #d1fae5; color: #065f46; border-left: 4px solid #10b981; }
    .py-toast-error   { background: #fee2e2; color: #991b1b; border-left: 4px solid #ef4444; }
    .py-toast-warn    { background: #fef3c7; color: #92400e; border-left: 4px solid #f59e0b; }
    .py-toast-info    { background: #eff6ff; color: #1e40af; border-left: 4px solid #3b82f6; }

    /* Confirm modal */
    #py-modal-overlay {
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(0,0,0,0.45);
      display: flex; align-items: center; justify-content: center;
      animation: py-overlay-in 0.15s ease;
    }
    @keyframes py-overlay-in {
      from { opacity: 0; } to { opacity: 1; }
    }
    #py-modal-box {
      background: #fff; border-radius: 16px;
      padding: 28px 28px 22px; max-width: 440px; width: calc(100% - 40px);
      box-shadow: 0 20px 60px rgba(0,0,0,0.2);
      animation: py-modal-in 0.18s ease;
    }
    @keyframes py-modal-in {
      from { opacity: 0; transform: scale(0.95) translateY(-8px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }
    #py-modal-title {
      font-size: 1.1rem; font-weight: 800; color: #233a63; margin: 0 0 10px;
    }
    #py-modal-body {
      font-size: 0.92rem; color: #5f7392; line-height: 1.6; margin: 0 0 22px;
      white-space: pre-wrap;
    }
    #py-modal-actions {
      display: flex; gap: 10px; justify-content: flex-end;
    }
  `;
  document.head.appendChild(style);
})();

// Toast — type: 'success' | 'error' | 'warn' | 'info'
window.pyToast = function(message, type, duurMs) {
  type   = type   || 'info';
  duurMs = duurMs || 4000;
  var icons = { success: '✅', error: '❌', warn: '⚠️', info: 'ℹ️' };
  var container = document.getElementById('py-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'py-toast-container';
    document.body.appendChild(container);
  }
  var toast = document.createElement('div');
  toast.className = 'py-toast py-toast-' + type;
  toast.innerHTML = '<span>' + icons[type] + '</span><span>' + message + '</span>';
  toast.onclick = function() { if (toast.parentNode) toast.parentNode.removeChild(toast); };
  container.appendChild(toast);
  setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, duurMs);
};

// Confirm modal — geeft Promise<boolean>
window.pyConfirm = function(opties) {
  var title        = opties.title        || 'Bevestigen';
  var body         = opties.body         || '';
  var confirmLabel = opties.confirmLabel || 'Bevestigen';
  var cancelLabel  = opties.cancelLabel  || 'Annuleren';   // Sprint 69
  var danger       = opties.danger       || false;

  return new Promise(function(resolve) {
    // Verwijder eerder open modal
    var existing = document.getElementById('py-modal-overlay');
    if (existing) existing.parentNode.removeChild(existing);

    var overlay = document.createElement('div');
    overlay.id  = 'py-modal-overlay';
    overlay.innerHTML =
      '<div id="py-modal-box">' +
        '<div id="py-modal-title">' + title + '</div>' +
        '<div id="py-modal-body">'  + body  + '</div>' +
        '<div id="py-modal-actions">' +
          '<button id="py-modal-cancel" class="btn btn-muted small">' + cancelLabel + '</button>' +
          '<button id="py-modal-confirm" class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + ' small">' + confirmLabel + '</button>' +
        '</div>' +
      '</div>';

    function close(result) {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }

    function onKey(e) {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter' && document.activeElement === document.getElementById('py-modal-confirm')) close(true);
    }

    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(false); });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);

    var cancelBtn  = document.getElementById('py-modal-cancel');
    var confirmBtn = document.getElementById('py-modal-confirm');
    cancelBtn.addEventListener('click',  function() { close(false); });
    confirmBtn.addEventListener('click', function() { close(true);  });
    cancelBtn.focus();
  });
};

// Sprint 43.2b: invoer-modal (scherm-popup i.p.v. browser prompt()). Resolve = tekst, of null bij annuleren.
window.pyPrompt = function(opties) {
  opties = opties || {};
  var title = opties.title || 'Invoer', body = opties.body || '';
  var confirmLabel = opties.confirmLabel || 'OK';
  // Sprint 51v (bugfix): cancelLabel werd hieronder gebruikt maar nergens gedeclareerd —
  // elke aanroep van pyPrompt() crashte met "cancelLabel is not defined" (bevestigd met een
  // browsertest), wat ELKE plek die pyPrompt gebruikt liet falen zonder duidelijke oorzaak.
  var cancelLabel = opties.cancelLabel || 'Annuleren';
  return new Promise(function(resolve) {
    var existing = document.getElementById('py-modal-overlay');
    if (existing) existing.parentNode.removeChild(existing);
    var overlay = document.createElement('div');
    overlay.id = 'py-modal-overlay';
    overlay.innerHTML =
      '<div id="py-modal-box">' +
        '<div id="py-modal-title">' + title + '</div>' +
        '<div id="py-modal-body">' + body +
          '<input id="py-modal-input" type="text" style="width:100%;box-sizing:border-box;margin-top:10px;padding:10px 12px;border:1.5px solid var(--border);border-radius:10px;font-size:1rem;background:var(--surface);color:var(--text);"/>' +
        '</div>' +
        '<div id="py-modal-actions">' +
          '<button id="py-modal-cancel" class="btn btn-muted small">' + cancelLabel + '</button>' +
          '<button id="py-modal-confirm" class="btn btn-primary small">' + confirmLabel + '</button>' +
        '</div>' +
      '</div>';
    function close(result) {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function submit() { var v = document.getElementById('py-modal-input'); close(v ? v.value : ''); }
    function onKey(e) { if (e.key === 'Escape') close(null); if (e.key === 'Enter') submit(); }
    overlay.addEventListener('click', function(e){ if (e.target === overlay) close(null); });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    var inp = document.getElementById('py-modal-input');
    inp.value = opties.defaultValue || '';
    document.getElementById('py-modal-cancel').addEventListener('click', function(){ close(null); });
    document.getElementById('py-modal-confirm').addEventListener('click', submit);
    inp.focus(); inp.select();
  });
};

// ── Sprint 25g: pyAlert — blokkerende notificatie-modal ─────────────────────
window.pyAlert = function(message, type) {
  type = type || 'info';
  var icons  = { error:'✕', warn:'⚠', success:'✓', info:'ℹ' };
  var colors = {
    error:   { bg:'#fee2e2', border:'#ef4444', text:'#991b1b' },
    warn:    { bg:'#fef3c7', border:'#f59e0b', text:'#92400e' },
    success: { bg:'#d1fae5', border:'#10b981', text:'#065f46' },
    info:    { bg:'#eff6ff', border:'#3b82f6', text:'#1e40af' },
  };
  var labels = { error:'Fout', warn:'Opgelet', success:'Gelukt', info:'Info' };
  var col = colors[type] || colors.info;
  return new Promise(function(resolve) {
    var existing = document.getElementById('py-alert-overlay');
    if (existing) existing.parentNode.removeChild(existing);
    var overlay = document.createElement('div');
    overlay.id = 'py-alert-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML =
      '<div style="background:#fff;border-radius:16px;max-width:420px;width:calc(100% - 40px);box-shadow:0 20px 60px rgba(0,0,0,0.25);overflow:hidden;">' +
        '<div style="background:' + col.bg + ';border-left:5px solid ' + col.border + ';padding:20px 24px;display:flex;align-items:flex-start;gap:14px;">' +
          '<div style="width:32px;height:32px;border-radius:50%;background:' + col.border + ';color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:1rem;flex-shrink:0;">' + (icons[type]||'i') + '</div>' +
          '<div style="flex:1;">' +
            '<div style="font-weight:800;font-size:0.95rem;color:' + col.text + ';margin-bottom:6px;">' + (labels[type]||'Info') + '</div>' +
            '<div style="font-size:0.9rem;color:#374151;line-height:1.6;white-space:pre-wrap;">' + message + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="padding:14px 24px;display:flex;justify-content:flex-end;">' +
          '<button id="py-alert-ok" style="background:' + col.border + ';color:#fff;border:none;border-radius:10px;padding:10px 24px;font-weight:800;font-size:0.9rem;cursor:pointer;">OK</button>' +
        '</div>' +
      '</div>';
    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.removeEventListener('keydown', onKey);
      resolve();
    }
    function onKey(e) { if (e.key === 'Escape' || e.key === 'Enter') close(); }
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    var okBtn = document.getElementById('py-alert-ok');
    if (okBtn) { okBtn.addEventListener('click', close); okBtn.focus(); }
  });
};


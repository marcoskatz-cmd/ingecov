// Tema: dark por defecto (cockpit aesthetic). Light queda como toggle.
(function(){
  try{
    const saved = localStorage.getItem('ingecov-theme');
    // Default: dark (no respeta prefers-color-scheme — la estética se diseñó para dark)
    const t = saved || 'dark';
    document.documentElement.setAttribute('data-theme', t);
  }catch(_){ document.documentElement.setAttribute('data-theme','dark'); }
})();
function toggleTheme(){
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const nxt = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', nxt);
  try{ localStorage.setItem('ingecov-theme', nxt); }catch(_){}
}

// PWA: registrar el service worker habilita "instalar app" en PC y celular y
// cachea el app-shell para uso offline. sw.js está en la raíz del scope
// /ingecov/, así controla toda la app. Se registra en 'load' para no competir
// con la carga inicial; si falla (p.ej. servido por http local) la app anda igual.
// La CSP tiene require-trusted-types-for 'script' → register() exige una
// TrustedScriptURL. Creamos la policy 'ingecov-sw' (declarada en la meta CSP,
// junto a 'ingecov-html' de app.js) sólo para envolver la URL del sw.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function(){
    var swUrl = './sw.js';
    try{
      if (window.trustedTypes && window.trustedTypes.createPolicy) {
        var swPolicy = window.trustedTypes.createPolicy('ingecov-sw', {
          createScriptURL: function(u){ return u; }
        });
        swUrl = swPolicy.createScriptURL('./sw.js');
      }
    }catch(_){ /* si TT no está o la policy ya existe, cae al string plano */ }
    navigator.serviceWorker.register(swUrl).catch(function(err){
      console.warn('[INGECO] service worker no se registró:', err);
    });
  });
}
// Reloj running en status bar
function _tickClock(){
  const el = document.getElementById('hsClock');
  if(!el) return;
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  el.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
setInterval(_tickClock, 1000);
document.addEventListener('DOMContentLoaded', _tickClock);

/* ═══════════════════════════════════════════════════════
   PIN GATE
   ──────────────────────────────────────────────────────
   PIN compartido entre usuarios autorizados. Si lo querés cambiar:
   editás la constante PANEL_PIN abajo, commit + push, GitHub Pages
   redeploya en ~1 min. Avisás a los usuarios el nuevo PIN.

   Cuando se ingresa el PIN correcto, queda guardado en sessionStorage
   (no localStorage), así que dura mientras el usuario tenga la pestaña
   abierta. Al cerrar el browser / pestaña vuelve a pedir.
═══════════════════════════════════════════════════════ */
const PANEL_PIN = '5289';
const PIN_KEY = 'ingeco-pin-ok';

(function pinGate(){
  function hideGate(){
    const gate = document.getElementById('pinGate');
    if (gate) gate.classList.add('hidden');
  }
  function showError(msg){
    const el = document.getElementById('pinError');
    if (el) el.textContent = msg || '';
  }
  function init(){
    if (sessionStorage.getItem(PIN_KEY) === '1') {
      hideGate();
      // app.js detecta el flag y arranca loadAll() solo.
      return;
    }
    const form = document.getElementById('pinForm');
    const input = document.getElementById('pinInput');
    if (!form || !input) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = (input.value || '').trim();
      if (val === PANEL_PIN) {
        sessionStorage.setItem(PIN_KEY, '1');
        showError('');
        hideGate();
        // app.js expone __startPanel para arrancar loadAll desde acá.
        if (typeof window.__startPanel === 'function') {
          window.__startPanel();
        }
      } else {
        showError('PIN incorrecto');
        input.value = '';
        input.focus();
      }
    });
    setTimeout(() => input.focus(), 100);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

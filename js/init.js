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

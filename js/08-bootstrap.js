/* ══════════════════════════════════════════════════════════════════
   08-bootstrap.js — parte 8/8 de la app del panel INGECO.
   Los 8 archivos son SCRIPTS CLÁSICOS que comparten el mismo scope
   global y se cargan EN ORDEN (defer) desde index.html: mover uno de
   lugar rompe las dependencias. No convertir a type=module sin
   revisar ACTIONS y el bootstrap del PIN.
══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════
   ACTIONS — capa de adaptación entre data-action y funciones
   Mantiene compatibilidad de firmas con los onclick/onchange viejos:
   - el segundo arg pasado a la función real era 'this' del elemento.
   - inputs/selects con data-event="input"/"change" reciben el value
     desde t.value (no desde data-arg).
═══════════════════════════════════════════════════════ */
const ACTIONS = {
  setAutoRefresh:                () => setAutoRefresh(),
  toggleTheme:                   () => toggleTheme(),
  loadAll:                       () => loadAll(),
  syncNow:                       () => syncNow(),
  toggleSection:                 (id) => toggleSection(id),
  setTab:                        (id, t) => setTab(id, t),
  scrollTabs:                    (dir) => scrollTabs(+dir),
  repSelectEquipo:               (arg, t) => repSelectEquipo(t.value),
  repRecalc:                     () => repRecalc(),
  repAddFalla:                   () => repAddFalla(),
  repDelFalla:                   (arg) => repDelFalla(+arg),
  repToggleEntrega:              (arg) => repToggleEntrega(arg),
  repReset:                      () => repReset(),
  toggleRepGuide:                () => toggleRepGuide(),
  repDescargarPDF:               () => repDescargarPDF(),
  onSearch:                      (_, t) => onSearch(t.value),
  clearSearch:                   () => clearSearch(),
  setViewMode:                   (mode) => setViewMode(mode),
  setFiltroCategoria:            (key, t) => setFiltroCategoria(key, t),
  setFiltroEstado:               (key, t) => setFiltroEstado(key, t),
  setFiltroTenencia:             (key, t) => setFiltroTenencia(key, t),
  setFiltroInactivo:             (key, t) => setFiltroInactivo(key, t),
  setFiltroUbicacion:            (key, t) => setFiltroUbicacion(key, t),
  closeEquipoDetail:             () => closeEquipoDetail(),
  closeServiceCriticoModal:      () => closeServiceCriticoModal(),
  openServiceCriticoModal:       () => openServiceCriticoModal(),
  closeVtvCriticaModal:          () => closeVtvCriticaModal(),
  openVtvCriticaModal:           () => openVtvCriticaModal(),
  closeVtvCriticaModalIfBg:      (_, t, e) => { if (e.target === t) closeVtvCriticaModal(); },
  setKpiMeses:                   (arg)   => setKpiMeses(arg),
  toggleKpiMes:                  (arg)   => toggleKpiMes(arg),
  toggleEqSec:                   (uid) => toggleEqSec(uid),
  toggleEquipoDetail:            (codigo, t) => toggleEquipoDetail(codigo, t),
  scrollToEquipo:                (codigo) => scrollToEquipo(codigo),
  cargarCostosDowntime:          () => cargarCostosDowntime(),
  toggleCostoEquipo:             (codN) => toggleCostoEquipo(codN),
  _irAEquipoDesdeKpi:            (codigo) => _irAEquipoDesdeKpi(codigo),
  closeServiceCriticoModalIfBg:  (_, t, e) => { if (e.target === t) closeServiceCriticoModal(); },
  abrirDetalleKpi:               (tipo) => abrirDetalleKpi(tipo),
  cerrarDetalleKpi:              () => cerrarDetalleKpi(),
  cerrarDetalleKpiIfBg:          (_, t, e) => { if (e.target === t) cerrarDetalleKpi(); },
  _irAEquipoDesdeKpiDetail:      (codigo) => _irAEquipoDesdeKpiDetail(codigo),
  abrirAuditoria:                () => abrirAuditoria(),
  cerrarAuditoria:               () => cerrarAuditoria(),
  cerrarAuditoriaIfBg:           (_, t, e) => { if (e.target === t) cerrarAuditoria(); },
  audSubmitPin:                  () => audSubmitPin(),
  abrirConfigPanel:               () => abrirConfigPanel(),
  audGuardarConfig:               () => audGuardarConfig(),
  audVolverAuditoria:             () => audVolverAuditoria(),
  toggleInactivosSec:            () => toggleInactivosSec(),
  onConsultaBuscar:               (_, t) => onConsultaBuscar(t.value),
  limpiarConsulta:                () => limpiarConsulta(),
  seleccionarConsultaEquipo:      (codigo) => seleccionarConsultaEquipo(codigo),
  consultaTimelineVerMas:         () => consultaTimelineVerMas(),
  // tab combustible (10-combustible.js)
  setCombGrupo:                   (g) => setCombGrupo(g),
  setCombMeses:                   (yms) => setCombMeses(yms),
  toggleCombMes:                  (ym) => toggleCombMes(ym),
  onCombFiltroEquipo:             (_, t) => onCombFiltroEquipo(t.value),
  onCombBuscar:                   (_, t) => onCombBuscar(t.value),
  combVerMas:                     () => combVerMas(),
};

function _dispatchAction(e) {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const expected = t.dataset.event || 'click';
  if (e.type !== expected) return;
  const fn = ACTIONS[t.dataset.action];
  if (!fn) {
    console.warn('[INGECO] data-action sin handler:', t.dataset.action);
    return;
  }
  try {
    fn(t.dataset.arg, t, e);
  } catch (err) {
    console.error('[INGECO] error en action', t.dataset.action, err);
    showErrorToast(err?.message || String(err));
  }
}


// Tema v2: las etiquetas estáticas (tabs, títulos de sección) estaban en
// minúscula porque el CSS viejo las ponía en mayúsculas; ahora van en
// "Mayúscula inicial". Solo toca el primer nodo de texto de cada una.
(function capitalizarEtiquetas(){
  document.querySelectorAll('#tabBar .tab-btn, .section-label').forEach(el=>{
    const tn=[...el.childNodes].find(n=>n.nodeType===3&&n.textContent.trim());
    if(tn)tn.textContent=tn.textContent.replace(/^(\s*)(\p{L})/u,(m,a,b)=>a+b.toUpperCase());
  });
})();


// Flechas de la barra de tabs: se muestran solo del lado con tabs ocultas.
function _syncTabArrows(){
  const nav=document.getElementById('tabNav'), bar=document.getElementById('tabBar');
  if(!nav||!bar)return;
  const max=bar.scrollWidth-bar.clientWidth;
  nav.classList.toggle('can-left', bar.scrollLeft>4);
  nav.classList.toggle('can-right', bar.scrollLeft<max-4);
}
function scrollTabs(dir){
  const bar=document.getElementById('tabBar'); if(!bar)return;
  bar.scrollBy({left:dir*Math.max(200,bar.clientWidth*0.7),behavior:'smooth'});
}
(function initTabArrows(){
  const bar=document.getElementById('tabBar'); if(!bar)return;
  bar.addEventListener('scroll',_syncTabArrows,{passive:true});
  window.addEventListener('resize',_syncTabArrows);
  // Rueda del mouse vertical → desplazamiento horizontal sobre la barra.
  bar.addEventListener('wheel',e=>{ if(Math.abs(e.deltaY)>Math.abs(e.deltaX)&&bar.scrollWidth>bar.clientWidth){ bar.scrollLeft+=e.deltaY; e.preventDefault(); } },{passive:false});
  // La tab activa siempre a la vista.
  bar.addEventListener('click',e=>{ const b=e.target.closest('.tab-btn'); if(b)b.scrollIntoView({behavior:'smooth',block:'nearest',inline:'nearest'}); });
  if(window.ResizeObserver)new ResizeObserver(_syncTabArrows).observe(bar);
  _syncTabArrows();
})();

document.addEventListener('click',  _dispatchAction);
document.addEventListener('change', _dispatchAction);
document.addEventListener('input',  _dispatchAction);

/* ═══════════════════════════════════════════════════════
   PIN GATE — bootstrap
═══════════════════════════════════════════════════════ */
// El PIN protege contra accesos casuales (no es seguridad criptográfica).
// El overlay de PIN vive en index.html y se hace cargo de mostrar el form.
// Cuando el usuario ingresa el PIN correcto, se dispara este loadAll().
// sessionStorage guarda el flag para que no pida PIN otra vez en la sesión.
if (sessionStorage.getItem('ingeco-pin-ok') === '1') {
  // Sesión ya validada — arrancar directo
  loadAll();
}
// Si NO está validado, el overlay queda visible (lo maneja el script
// inline de index.html que verifica el PIN). Cuando valida, llama a
// window.__startPanel() que dispara loadAll().
window.__startPanel = () => {
  sessionStorage.setItem('ingeco-pin-ok', '1');
  loadAll();
};

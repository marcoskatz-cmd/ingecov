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
  toggleInactivosSec:            () => toggleInactivosSec(),
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

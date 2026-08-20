/* ══════════════════════════════════════════════════════════════════
   01-core.js — parte 1/8 de la app del panel INGECO.
   Los 8 archivos son SCRIPTS CLÁSICOS que comparten el mismo scope
   global y se cargan EN ORDEN (defer) desde index.html: mover uno de
   lugar rompe las dependencias. No convertir a type=module sin
   revisar ACTIONS y el bootstrap del PIN.
══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════
   FRAME-BUSTER (compensa frame-ancestors no soportado por CSP meta)
═══════════════════════════════════════════════════════ */
if (window.top !== window.self) {
  try { window.top.location = window.self.location; }
  catch { document.body && (document.body.textContent = ''); }
}

/* ═══════════════════════════════════════════════════════
   TEMPLATING SEGURO + TRUSTED TYPES
   - html`...` devuelve un RawHTML con valores interpolados escapados.
   - setHTML(el, content) hace innerHTML pasando por la policy Trusted Types
     cuando el browser la soporta. Si content NO es RawHTML (es decir,
     viene como string sin envolver), se escapa entero como texto plano.
   - esc(v) escapa un valor para HTML; es la primitiva en la que se basa todo.
═══════════════════════════════════════════════════════ */
const TT = window.trustedTypes
  ? window.trustedTypes.createPolicy('ingecov-html', { createHTML: s => s })
  : null;

class RawHTML { constructor(value){ this.value = value; } }

function esc(v) {
  if (v == null) return '';
  if (v instanceof RawHTML) return v.value;
  if (Array.isArray(v)) return v.map(esc).join('');
  return String(v).replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));
}

function html(strings, ...values) {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) out += esc(values[i]);
  }
  return new RawHTML(out);
}

function setHTML(el, content) {
  if (!el) return;
  const s = content instanceof RawHTML ? content.value : esc(content);
  el.innerHTML = TT ? TT.createHTML(s) : s;
}

/* ═══════════════════════════════════════════════════════
   ERROR BOUNDARY GLOBAL
   Loguea + muestra un toast minimal sin interrumpir la app.
═══════════════════════════════════════════════════════ */
function showErrorToast(msg) {
  try {
    let stack = document.getElementById('__errStack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = '__errStack';
      stack.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99999;display:flex;flex-direction:column;gap:6px;max-width:360px;pointer-events:none';
      document.body.appendChild(stack);
    }
    const toast = document.createElement('div');
    toast.style.cssText = 'background:#2a1414;border:1px solid #6b1a1a;color:#ffb4b4;padding:10px 12px;border-radius:6px;font:12px/1.4 IBM Plex Sans,system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.4);cursor:pointer;pointer-events:auto;word-break:break-word';
    toast.textContent = String(msg || 'Error');
    toast.title = 'Click para copiar';
    toast.addEventListener('click', () => {
      navigator.clipboard?.writeText(String(msg || ''));
      toast.style.opacity = '.5';
    });
    stack.appendChild(toast);
    setTimeout(() => toast.remove(), 8000);
  } catch (_) { /* ignore */ }
}
window.addEventListener('error', (e) => {
  console.error('[INGECO] error:', e.error || e.message, (e.filename || '') + ':' + (e.lineno || ''));
  showErrorToast(e.error?.message || e.message || 'Error');
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[INGECO] promise rechazada:', e.reason);
  showErrorToast(String(e.reason?.message || e.reason || 'Promise rechazada'));
});

/* ═══════════════════════════════════════════════════════
   CONFIGURACIÓN — SHEET IDs
═══════════════════════════════════════════════════════ */
const SHEET_IDS = {
  pedidos:        '1VFJwFLLEaOE9tTuwah7QkaDTrYkeYtOH8brUgSyHeFY',
  indicadores:    '1GpP2ejMVXncr2OLmKK_IP-zqr5AARi1Q3YdQIPlsUUE',
  // CÓDIGOS y COMBUSTIBLE LIVIANOS son .xlsx mantenidos por terceros.
  // El proyecto Apps Script standalone (INGECO Panel API) tiene triggers
  // cada 30 min que los copian a pestañas nativas dentro del Sheet
  // "INGECO Panel Mirror" (id abajo). Cero intervención manual.
  codigos:        '1Z8kg4aC6KUNeWyxpPiD3xKntRYB4oghxsbnxqWQdVio', // INGECO Panel Mirror
  // Repuestos: el sheet LIVE (1TUE) tiene PANEL_REPUESTOS al día (se actualiza
  // diariamente, 2026 completo). El sheet HIST (1WCtB) tiene años anteriores
  // 2024-2025 en pestañas individuales pero no consolidado a PANEL_REPUESTOS.
  repuestos_hist: '1TUEoOul4SI5O323LcMq2VkaxdcTMfTmZce7NToGESfc', // LIVE
  repuestos_hist_old: '1WCtB-8C1VP4-axoQ_ugk_ersCfPJFjMC1fEDXRHOKFE', // HIST pre-2026
  // Trabajos: el sheet LIVE (1ItkY) tiene PANEL_TRABAJOS al día (2026 completo
  // hasta mayo). El sheet HIST (1cNWQ) tiene años anteriores en pestañas
  // individuales por equipo.
  trabajos_reg:   '1ItkY8miYOwQEsbbjZlNslb86f7HY3TEzywpQx6pD5tU', // LIVE
  trabajos_hist:  '1cNWQ44UEDiotHyB65BfTMcFuOCfQXYQoSNNAdAKTsy8', // HIST: PANEL_TRABAJOS solo 2026, hay que leer pestañas por equipo para 2025
  service:        '1zB9q0e9kxRKe52-I0u5Dqg7PUSE_nlxi3IYn7pxF0Iw',
  combustible:    '19dqJ-tcdmXiOns99mJgMMmZNDT3kKS7EQXwHd7VDILc',
  // PROGRAMA DE TRABAJOS DE SERVICE 2026 — fuente nueva de service / operatividad.
  programaService:'1y6pqbXscej3139lkImWJsJHeJvFa0B5sneICEyyNPmI',
  // Combustible livianos: sheet operativo que se actualiza al día. Contiene
  // solo 2026 (no hay histórico pre-2026 disponible en este sheet).
  combustibleLivianos:'1bZkxrdVEcN4v5Aztf4RBxncJKWE20Jti8wjNdCmAl-E',
  // COSTOS DOWNTIME: parámetros editables por Marcos (pestañas PARAMETROS y
  // ALQUILERES). NO pasa por el snapshot a propósito: al editar un precio y
  // recargar el panel, el cambio impacta al instante (sin esperar el rebuild
  // de 30 min). Es un sheet chico (2 pestañas) → no aporta al rate limiting.
  costos:         '1tV59d02aVjs5NRAzdorVzeW2JdPxeJIpFR2Bm10o_LM',
  // VTV: Marcos la carga a mano y la va completando de a poco (incompleta a
  // propósito). Pestaña única 'VTV'.
  vtv:            '1-DSUu1HlBG2kXClsMkHiDwiKmtZdkGI853aS9Qyp6Gg',
};

// FUENTES_REALES — a dónde apuntan de VERDAD los "abrir planilla" del modal de
// equipo (sección "fuentes de información"). Los IDs de arriba (SHEET_IDS)
// son en su mayoría claves de redirección legacy: quedaron pisadas por
// reestructuras de terceros y el builder del snapshot (apps-scripts/
// snapshot-builder.gs, const SNAP_SRC) hace rato lee de otros archivos, pero
// SHEET_IDS sigue funcionando como llave opaca para SNAP_REDIRECT (nunca se
// fetchea esa URL real). Estos SÍ son los archivos vigentes — deben coincidir
// 1:1 con SNAP_SRC del builder; si el builder cambia de fuente, actualizar acá.
const FUENTES_REALES = {
  equipos:        '1EwbNlmBMx3OIviplvHSJM3N4CZ3vVXgVxH208VugG3M', // LISTA DE EQUIPOS (maestro de códigos)
  trabajos:       '1muXaJvsdAH0q3bXZj3yiDanxT3aCfUL5EhY_ORgvx7o', // TRABAJOS REALIZADOS EN EQUIPOS (pestañas TRABAJOS REALIZADOS + TRABAJOS PENDIENTES)
  repuestos:      '1JpXjGTJwlvMuEI-rFTd4KeKvzd708-yuSLAhIRuCFC0', // PEDIDOS Y ENTREGAS DE REPUESTOS (pestañas PEDIDOS + ENTREGAS)
  service:        '14XiIAnYeobj5_3JQlR-ejH6HzCqGJ6QFuGmmwauaRJc', // SERVICES DE EQUIPOS (pestañas REGISTROS + RESUMEN)
  combPesados:    '19eyY8MImPM_-Gyzj8QcqA_yR5KDrkuu-1faJUU48N1A', // ENTREGA DE COMBUSTIBLE — Leandro Casares (pesados, horómetro)
  combLivianos:   '1DD8BVoF6jX-CcakbbVO6fNJKYF82qBIK1YwyVLQcDJ8', // ENTREGA DE COMBUSTIBLE — Tiburcio Sanz (livianos, con costo)
  combCamionetas: '1GB_oiL40fEXHXzhmor3ztnnriiikX1xp3fG-F5Uuw5E', // ENTREGA DE COMBUSTIBLE camionetas (código directo, sin costo ni horómetro)
  vtv:            '1-DSUu1HlBG2kXClsMkHiDwiKmtZdkGI853aS9Qyp6Gg', // VTV — igual a SHEET_IDS.vtv, esta fuente nunca cambió
};

// Pestaña tabular plana (una fila = una carga). No requiere Apps Script consolidador.
const COMBUSTIBLE_SHEET='ENTREGA DE COMBUSTIBLE';

// Combustible de livianos: el operario sube su .xlsx, un Apps Script lo
// sincroniza cada 30 min a la pestaña COMBUSTIBLE_LIVIANOS_MIRROR del Mirror.
// El panel lee esa pestaña; el flujo del operario no cambia.
const COMBUSTIBLE_LIVIANOS_SHEET='Hoja 1';
const COMBUSTIBLE_LIVIANOS_DESDE=new Date(2025,0,1); // 1 enero 2025

// Pestañas del sheet PROGRAMA DE TRABAJOS DE SERVICE.
const SERVICE_FREC_SHEET='FRECUENCIA - OPERATIVIDAD';
// Trimestre vigente según el mes actual (1°: ene-mar, 2°: abr en adelante).
// Cuando se agreguen 3°/4° trimestre, extender este map.
const SERVICE_TRIM_SHEET=(new Date().getMonth()<3)?'1° TRIMESTRE':'2° TRIMESTRE';

// Prefijos de código de equipo que usan ODÓMETRO (kilometraje) en lugar de horómetro.
// El resto se asume horómetro (lo más común en obras viales). Si un equipo nuevo
// usa km y su prefijo no está acá, va a aparecer como L/hr en vez de L/100km.
const PREFIJOS_KM=new Set(['CMT','CMN']);

/* ═══════════════════════════════════════════════════════
   MESES DE ENTREGAS
   Para agregar Mayo: pegá el ID del sheet en la línea correspondiente.
   El último elemento es el "mes actual" del panel.
═══════════════════════════════════════════════════════ */
const MESES_ENTREGAS = [
  { id:'1Qp0Lzt5h0UtMceYk-kxe4xEYqy0K_oOgL4G_TokDtVE', label:'Ene 2026', ym:'2026-01' },
  { id:'1bG4TK5t_Vj9hs3aKPSKtqbx8ig6uh6dRAi4WG_f_Bok', label:'Feb 2026', ym:'2026-02' },
  { id:'15drskwdnwCcM0EBeT6lIUmEj0MnWiJN9Clv6VL4vQ-M', label:'Mar 2026', ym:'2026-03' },
  { id:'1fBQseXfhxPgZ5Bm7dLQHucGFwLH4SWRZ3Us5jtWtCh0', label:'Abr 2026', ym:'2026-04' },
  { id:'1qyTQ3hmtQ3qwAwNVcOLBWwnywGbOmWAUiIrlGRDB4qU', label:'May 2026', ym:'2026-05' },
].filter(m => !m.id.startsWith('PEGAR'));

const MES_ACTUAL = MESES_ENTREGAS[MESES_ENTREGAS.length - 1];

// SERVICE_MESES (planillas mensuales de service enero-abril 2026) se eliminó
// 2026-08-19: quedó huérfano al sacar los links legacy de "fuentes de
// información" (el service hoy sale de FUENTES_REALES.service, un único
// archivo vivo con pestañas REGISTROS+RESUMEN, no de archivos mensuales).

/* ═══════════════════════════════════════════════════════
   EQUIPOS QUE APARECER COMBINADOS EN LOS SHEETS
   Si dos equipos están mezclados en una sola fila del sheet,
   configurarlos acá. Ajustar los códigos según lo que aparezca
   en la planilla de CÓDIGOS DE EQUIPOS.
═══════════════════════════════════════════════════════ */
const SEPARAR_EQUIPOS = {
  // nombre normalizado → array de equipos separados
  'CARGADOR FRONTAL VOLVO L110F/RETROPALA JOHN DEERE 310L': [
    { nombre:'Cargador Frontal Volvo L110F', codigoPrefijo:'CF' },
    { nombre:'Retropala John Deere 310L',    codigoPrefijo:'RTP' },
  ],
  // Agregar más casos acá si surgen:
  // 'NOMBRE COMBINADO': [{ nombre:'Equipo 1', codigoPrefijo:'XX' }, ...],
};

/* ═══════════════════════════════════════════════════════
   FETCH — gviz sin autenticación
═══════════════════════════════════════════════════════ */
// range opcional (ej: 'A11:H') fuerza a gviz a usar esa fila como headers.
// Útil cuando la hoja tiene títulos/contadores antes de los headers reales.
// ── REDIRECCIÓN AL SNAPSHOT ──────────────────────────────────────────────
// Todas las lecturas pasan por UN spreadsheet congelado que arma el builder
// server-side (apps-scripts/snapshot-builder.gs) cada 30 min. Antes el browser
// disparaba ~120 requests gviz por carga (17 primarios + 58 pestañas del HIST
// + ~31 horómetros + indicadores); gviz hace rate limiting muy por debajo de
// eso y cada fetch fallido (catch→[]) cambiaba los totales entre reloads. Con
// el snapshot, cada reload lee exactamente las mismas filas → determinismo.
const SNAPSHOT_ID='1E883xvPP_Oyt1mjQ2FjZLiY-Jmvyzgi0_UhEq2dFbGY';
// Web App de refresh on-demand (apps-scripts/refresh-webapp.gs). El boton "sync"
// la llama para correr consolidadores + construirSnapshot server-side y recien
// ahi releer el snapshot. El key es disuasor (como el PIN), no seguridad cripto.
const REFRESH_URL='https://script.google.com/macros/s/AKfycbxoatRBgyPah9WFS4Iuw-oVpdKA_nbUvFAFyPXgMGTFQK9EDHgms5bD1ueztuy4X120Kw/exec';
const REFRESH_KEY='alsdkjgn45lfsk93mkl';
// (idFuente|pestaña) → pestaña del snapshot. El range se descarta al redirigir:
// la pestaña del snapshot ya es el slice exacto (ej. PED_ENTR ya arranca en la
// fila 11 que pedía el range 'A11:H').
const SNAP_REDIRECT={
  [`${SHEET_IDS.pedidos}|PENDIENTES`]:'PED_PEND',
  [`${SHEET_IDS.pedidos}|ENTREGADOS`]:'PED_ENTR',
  [`${SHEET_IDS.codigos}|VIALES, ASFALTO Y TRITURACIÓN`]:'COD_V',
  [`${SHEET_IDS.codigos}|TRANSPORTE LIVIANO`]:'COD_L',
  [`${SHEET_IDS.codigos}|TRANSPORTE PESADO`]:'COD_P',
  [`${SHEET_IDS.codigos}|SOPORTE`]:'COD_S',
  [`${SHEET_IDS.repuestos_hist}|PANEL_REPUESTOS`]:'REP_LIVE',
  [`${SHEET_IDS.repuestos_hist_old}|PANEL_REPUESTOS`]:'REP_HIST',
  [`${SHEET_IDS.trabajos_reg}|PANEL_TRABAJOS`]:'TRAB_LIVE',
  [`${SHEET_IDS.trabajos_hist}|PANEL_TRABAJOS`]:'TRAB_HIST',
  [`${SHEET_IDS.programaService}|${SERVICE_FREC_SHEET}`]:'SVC_FREC',
  [`${SHEET_IDS.programaService}|1° TRIMESTRE`]:'SVC_TRIM1',
  [`${SHEET_IDS.programaService}|2° TRIMESTRE`]:'SVC_TRIM2',
  [`${SHEET_IDS.service}|PANEL_PROGRAMA`]:'SVC_PANELPROG',
  [`${SHEET_IDS.combustible}|${COMBUSTIBLE_SHEET}`]:'COMBUSTIBLE',
  [`${SHEET_IDS.combustibleLivianos}|${COMBUSTIBLE_LIVIANOS_SHEET}`]:'COMB_LIVIANOS',
  [`${SHEET_IDS.indicadores}|INDICADORES OPERACIONALES`]:'INDICADORES',
  [`${SHEET_IDS.vtv}|VTV`]:'VTV',
};
// Devuelve el target redirigido al snapshot, o el original si no está mapeado.
// Una lectura directa de una pestaña del snapshot (TRAB_HIST58, SERVICE_EQ — que
// no pasan por SNAP_REDIRECT) también es "snap": el builder deja TODAS las celdas
// como texto (setNumberFormat('@')), así que gviz NO logra autodetectar la fila de
// encabezado y devuelve columnas 'A','B',… con el header colado como primera fila
// de datos → r['FECHA TRABAJO'] queda undefined y se pierde TODO el histórico en
// silencio. Marcándolo snap forzamos headers=1 (obj) / headers=0 (raw) y el header
// vuelve a leerse bien. Robusto y coherente con el diseño verbatim del snapshot.
function _snapTarget(id,sheet){
  const tab=SNAP_REDIRECT[`${id}|${sheet}`];
  if(tab)return{id:SNAPSHOT_ID,sheet:tab,snap:true};
  if(id===SNAPSHOT_ID)return{id:SNAPSHOT_ID,sheet,snap:true};
  return{id,sheet,snap:false};
}
const gvizUrl=(id,sheet,range,headers)=>{
  let url=`https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheet)}`;
  if(range)url+=`&range=${encodeURIComponent(range)}`;
  if(headers!=null)url+=`&headers=${headers}`;
  return url;
};

// Si la columna está tipada (e.g. como DATE) y la celda contiene texto que no parsea
// (e.g. un rango "3/12/2024 - 31/12/2024"), gviz devuelve v=null pero conserva el literal
// en f. Hay que usar f en ese caso, no descartar.
const _cellStr=cell=>{
  if(!cell)return'';
  if(cell.v==null)return cell.f!=null?String(cell.f):'';
  return cell.f!=null?String(cell.f):String(cell.v);
};

async function _fetchGvizJson(id,sheet,range,headers){
  const r=await fetch(gvizUrl(id,sheet,range,headers));
  if(!r.ok)throw new Error(`HTTP ${r.status} · ${sheet}`);
  const txt=await r.text();
  return JSON.parse(txt.substring(txt.indexOf('{'),txt.lastIndexOf('}')+1));
}

// Implementaciones originales — gviz directo. El shim de la API las llama
// como fallback cuando USE_API está activo pero el (id,sheet) no está mapeado.
async function _gvizRawImpl(id,sheet,range){
  const t=_snapTarget(id,sheet);
  // RAW del snapshot → headers=0 fuerza a gviz a devolver la matriz COMPLETA
  // (sin consumir la fila 1 como header); los parsers raw se ubican solos.
  const json=await _fetchGvizJson(t.id,t.sheet,t.snap?null:range,t.snap?0:null);
  return(json.table.rows||[]).map(row=>(row.c||[]).map(_cellStr));
}

async function _gvizObjImpl(id,sheet,range){
  const t=_snapTarget(id,sheet);
  // OBJ del snapshot → headers=1 fuerza la fila 1 como header (keys estables,
  // sin la heurística de tipos de gviz que a veces no detectaba el header).
  const json=await _fetchGvizJson(t.id,t.sheet,t.snap?null:range,t.snap?1:null);
  const cols=json.table.cols.map(c=>(c.label||c.id||'').trim());
  return(json.table.rows||[]).map(row=>Object.fromEntries(
    cols.map((col,i)=>[col,_cellStr(row.c?row.c[i]:null)])
  ));
}

// fetchGvizRaw/Obj son alias de las implementaciones gviz directas, envueltas
// en retry con backoff exponencial para resistir el rate limiting intermitente
// de gviz cuando se piden muchas pestañas en paralelo. Antes el panel perdía
// silenciosamente fetches (catch → []) y eso producía variaciones grandes
// entre reloads (ej. _entregaCostos a veces tenía 335 entries y a veces 807).
// Privacidad: hay un PIN gate en index.html que filtra usuarios casuales.
// Si alguien con F12 mira los SHEET_IDS y los abre directo, igual los ve —
// es disuasor, no seguridad criptográfica. Decisión documentada y aceptada.
const _withRetry = (fn, maxRetries=3) => async (...args) => {
  let lastErr;
  for(let i=0;i<maxRetries;i++){
    try{ return await fn(...args); }
    catch(e){
      lastErr=e;
      // Backoff exponencial: 400ms, 800ms, 1600ms
      await new Promise(r=>setTimeout(r, 400*Math.pow(2,i)));
    }
  }
  throw lastErr;
};
const fetchGvizRaw = _withRetry(_gvizRawImpl);
const fetchGvizObj = _withRetry(_gvizObjImpl);
async function apiRefreshAll(){ /* no-op: el rebuild server lo dispara syncNow() solo en click manual, no en auto-refresh */ }

// Refresh REAL on-demand: dispara la Web App (consolidadores + construirSnapshot
// server-side) y, al terminar, recarga para leer el snapshot ya reconstruido.
// Solo lo usa el boton "sync"; el auto-refresh sigue re-leyendo el snapshot sin
// reconstruirlo (no tiene sentido gatillar un rebuild pesado cada N minutos).
let _syncing=false;
async function syncNow(){
  if(_syncing)return;
  if(!REFRESH_URL)return loadAll(); // sin endpoint configurado, comportamiento viejo
  _syncing=true;
  const btn=document.getElementById('refreshBtn');
  let secs=0;
  if(btn){btn.classList.add('loading');btn.textContent='↻ actualizando…';}
  const tick=setInterval(()=>{secs++;if(btn)btn.textContent='↻ actualizando '+secs+'s…';},1000);
  const ctrl=new AbortController();
  const killer=setTimeout(()=>ctrl.abort(),360000); // tope 6 min = techo de Apps Script (run real ~3.5 min)
  try{
    const url=REFRESH_URL+'?ep=refresh&key='+encodeURIComponent(REFRESH_KEY);
    const r=await fetch(url,{method:'GET',signal:ctrl.signal});
    const j=await r.json().catch(()=>null);
    if(!j||!j.ok){
      showErrorToast('Refresh server: '+((j&&(j.message||j.error))||('HTTP '+r.status))+' — recargo de todos modos');
    }else if(j.errors&&j.errors.length){
      showErrorToast('Refresh parcial — fallaron: '+j.errors.map(x=>x.step).join(', '));
    }
  }catch(e){
    showErrorToast('No se pudo actualizar en el server'+(e&&e.name==='AbortError'?' (timeout 6 min)':': '+((e&&e.message)||e))+' — recargo de todos modos');
  }finally{
    clearInterval(tick);clearTimeout(killer);
    _syncing=false;
    await loadAll(); // re-lee el snapshot fresco; loadAll restaura el texto del boton al final
  }
}

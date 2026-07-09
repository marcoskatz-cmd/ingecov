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

/* ═══════════════════════════════════════════════════════
   SHEETS DE SERVICE
═══════════════════════════════════════════════════════ */
const SERVICE_MESES = [
  { id:'1AK902grpUm6l0VflNsJy0Y7_4X770SL0tMfO7aBLNiw', mes:'Abril 2026',
    equipos:new Set(['CMT-01','CMT-03','CMT-21','CMT-22','CMT-23','CMT-25','MNV-02','MNV-03','RTP-05','RTP-07','RTP-08','RTP-09','EXC-01'])},
  { id:'1mzt3Fhvwr8J4Mhrz-uIfX4OPBG5-zqweQ7pn0B_s-Vc', mes:'Marzo 2026',
    equipos:new Set(['CF-03','CF-04','CMT-03','EXC-01','RDL-02','RN-02','RTP-05','RTP-09'])},
  { id:'1N062h_xp9TOWsuZuIX_QNMvXRfB2Tpyf7EwtBmqGImw', mes:'Febrero 2026',
    equipos:new Set(['CF-05','CMT-21','EXC-07','TPD-01'])},
  { id:'1chZDHgtkjb-Jcs18lgoHrH-KOInzbVgLu5Ew6ThdcE4', mes:'Enero 2026',
    equipos:new Set(['CF-02','CMN-03','CMN-22','CMT-20','MNV-02','RTP-08'])},
];

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

/* ═══════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════ */
// Normaliza CÓDIGO: quita tildes, mayúsculas, trim
// normCod: quita tildes, espacios, guiones, cualquier caracter no alfanumérico.
// "RN - 03" = "RN-03" = "RN 03" = "RN03" → todos dan "RN03"
const normCod = s => String(s||'')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9]/g, '')
  .toUpperCase();

// Normaliza PATENTE/dominio para matchear sin importar espacios ni guiones:
// "AB 262 XX", "AB-262-XX", "ab262xx" \u2192 todos "AB262XX".
const normPat = s => String(s||'')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9]/g, '')
  .toUpperCase();

// Normaliza HEADERS de columna: tildes fuera, espacios y guiones-bajo colapsados a un solo
// espacio, mayúsculas, trim. Para matchear nombres de columna sin importar si vienen
// 'EST_FECHA', 'Est Fecha' o 'est  fecha'.
const normHead = s => String(s||'')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[_\s]+/g, ' ')
  .toUpperCase()
  .trim();

function parseMoney(s){
  if(!s||s==='-')return 0;
  let c=String(s).replace(/[^0-9.,]/g,'');
  if(!c)return 0;
  // Formato argentino con decimales: 1.234,56 → 1234.56
  if(c.includes(',')){
    c=c.replace(/\./g,'').replace(',','.');
  }
  // Formato argentino con separador de miles (sin decimales): 158.000 o 1.234.567 → 158000 / 1234567
  else if(/^\d{1,3}(\.\d{3})+$/.test(c)){
    c=c.replace(/\./g,'');
  }
  // Else: número entero (158) o decimal estilo US (158.50) → parseFloat directo
  return parseFloat(c)||0;
}
function formatMoney(n){
  if(n>=1e6)return'$'+(n/1e6).toFixed(1)+'M';
  if(n>=1e3)return'$'+(n/1e3).toFixed(0)+'K';
  return'$'+Math.round(n);
}

// Separadores de miles estilo es-AR (punto). Para enteros >=1000.
// Números chicos quedan sin formato. Decimales no se tocan: pasar entero.
function fmtInt(n){
  const v=Math.round(Number(n)||0);
  return v.toLocaleString('es-AR');
}

// Etiqueta corta de un ym "2026-05" → "May 2026".
function ymLabel(ym){
  const M=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const p=String(ym||'').split('-');
  if(p.length<2)return String(ym||'');
  return (M[+p[1]-1]||'?')+' '+p[0];
}

// Hora corta 24h consistente (es-AR a veces devuelve 12h con "p. m." que rompe layout).
function fmtHora(d){
  return (d||new Date()).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hour12:false});
}

// Arma "Tipo Marca Modelo" — ej. "Camioneta Ford Ranger", "Rodillo liso Volvo SD105".
// Cada parte se suma si no está vacía. Si no hay nada, devuelve fallback.
// Evita duplicados case-insensitive (si el modelo ya contiene la marca, etc.).
function buildEquipoNombre(clasif,marca,modelo,fallback){
  const norm=s=>String(s||'').trim().toLowerCase();
  const partes=[];
  const vista=new Set();
  for(const raw of [clasif,marca,modelo]){
    const v=String(raw||'').trim();
    if(!v)continue;
    const k=norm(v);
    // Saltar si esta parte ya está contenida en alguna anterior (ej. modelo "Ford Ranger" cuando marca ya es "Ford")
    let dup=false;
    for(const prev of vista){if(prev.includes(k)||k.includes(prev)){dup=true;break;}}
    if(dup)continue;
    partes.push(v);
    vista.add(k);
  }
  return partes.length?partes.join(' '):(fallback||'');
}

const HOY=(()=>{const d=new Date();d.setHours(23,59,59,999);return d;})();

// Helper interno: parsea UNA fecha simple (sin rangos). Devuelve Date o null.
function _parseDateSingle(str){
  if(!str)return null;
  const mg=str.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})\)$/);
  if(mg){const d=new Date(+mg[1],+mg[2],+mg[3]);return isNaN(d)?null:d;}
  const mi=str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(mi){const d=new Date(+mi[1],+mi[2]-1,+mi[3]);return isNaN(d)?null:d;}
  // dd/mm/yyyy o mm/dd/yyyy (con separador / o -). Heurística: si segundo número > 12,
  // entonces el primero es día. Si el primero > 12, el primero es día. Si ambos ≤ 12,
  // se asume dd/mm (formato argentino). Sirve para los forms de Google ("05-15-2026" →
  // mes 5 día 15 detectado vía swap, ya que el "15" se descubre > 12).
  const m4=str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if(m4){let[,a,b,y]=m4.map(Number);if(b>12&&a<=12)[a,b]=[b,a];if(b>=1&&b<=12&&a>=1&&a<=31)return new Date(y,b-1,a);}
  const m2=str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if(m2){let[,a,b,y]=m2.map(Number);if(b>12&&a<=12)[a,b]=[b,a];if(b>=1&&b<=12&&a>=1&&a<=31)return new Date(2000+y,b-1,a);}
  return null;
}

// Detecta rangos del tipo "3/12/2024 - 31/12/2024" con separadores -, –, —, "a".
function _parseDateRange(s){
  if(!s)return null;
  const str=String(s).trim();
  const m=str.match(/^(.+?)\s*(?:[-–—]|\ba\b)\s*(.+)$/);
  if(!m)return null;
  const d1=_parseDateSingle(m[1].trim());
  const d2=_parseDateSingle(m[2].trim());
  if(d1&&d2)return[d1,d2];
  return null;
}

// _parseDate: si es rango devuelve la fecha FIN (relevante para agrupar por mes);
// si es fecha simple, devuelve esa.
function _parseDate(s){
  if(!s)return null;
  const str=String(s).trim();
  if(!str||str==='—'||str==='-')return null;
  const single=_parseDateSingle(str);
  if(single)return single;
  const range=_parseDateRange(str);
  if(range)return range[1];
  return null;
}
function toSortDate(s){return _parseDate(s)||new Date(0);}
function formatFechaCorta(s){
  if(!s||['—','-'].includes(String(s).trim()))return'—';
  const str=String(s).trim();
  const range=_parseDateRange(str);
  if(range){
    const fmt=d=>`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`;
    return`${fmt(range[0])} – ${fmt(range[1])}`;
  }
  const d=_parseDateSingle(str);
  if(!d)return str;
  return`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`;
}

// ESTADO_COLOR: clasifica el texto de estado del equipo en red/amber/green/gray
// Acepta variaciones de escritura del personal de campo
const ESTADO_COLOR=st=>{
  // Vacío o placeholder ("-", "—", "s/d", "n/a") → sin estado (gris)
  if(!st||!st.trim()||['-','—','s/d','n/a'].includes(st.trim().toLowerCase()))return'gray';
  const l=st.toLowerCase();
  // Reparación / taller (ámbar)
  if(l.includes('reparaci')||l.includes('taller')||l.includes('en servicio de')||l.includes('service'))return'amber';
  // No operativo / fuera de servicio / parado / en desuso (rojo = inactivo)
  if(l.includes('no oper')||l.includes('inoper')||l.includes('fuera de')||
     l.includes('parad')||l.includes('baja')||l.includes('detenid')||
     l.includes('inutiliz')||l.includes('desuso'))return'red';
  // Cualquier texto que tenga contenido = operativo por defecto (verde)
  return'green';
};

// Inactivo = equipo en desuso, no operativo (estado rojo) o sin estado cargado
// (estado gris). Estos no van a la grilla principal sino a la sección
// "equipos inactivos".
function esEquipoInactivo(codigo){
  const info=(window._estadoEquipos||{})[normCod(codigo)];
  if(!info)return false;
  const c=ESTADO_COLOR(info.estado);
  return c==='red'||c==='gray';
}
// Subtipo de inactivo: 'desuso' | 'no-operativo' | 'sin-estado'.
function subtipoInactivo(estado){
  if(ESTADO_COLOR(estado)==='gray')return'sin-estado';
  const l=String(estado||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  return l.includes('desuso')?'desuso':'no-operativo';
}
const ESTADO_CSS={green:'var(--green)',amber:'var(--amber)',red:'var(--red)',gray:'var(--text3)'};

// Tipo de equipo por prefijo de código → etiqueta corta (spec verificada INGECO)
const TIPO_EQUIPO=cod=>{
  const p=(cod||'').split('-')[0].toUpperCase();
  const tipos={
    AUT:'Autoelevador',
    BAT:'Batea',
    BRD:'Barredora',
    CF :'Cargador frontal',
    CMN:'Camión',
    CMP:'Compresor',
    CMT:'Camioneta',
    CRT:'Carretón',
    EXC:'Retroexcavadora',
    GEN:'Generador',
    MNV:'Motoniveladora',
    PLN:'Planta de asfalto',
    RDL:'Rodillo doble liso',
    RL :'Rodillo liso',
    RN :'Rodillo neumático',
    RTP:'Retropala',
    TPD:'Topadora',
    TRM:'Terminadora de asfalto',
    TRT:'Trituradora',
    ZRN:'Zaranda',
  };
  return tipos[p]||null;
};

/* ═══════════════════════════════════════════════════════
   PARSERS
═══════════════════════════════════════════════════════ */
function parseCodigos(rows,categoria){
  const result={};
  const hIdx=rows.findIndex(r=>r.some(c=>normCod(c)==='CODIGO'));
  if(hIdx<0)return result;

  // Leer fecha de actualización del encabezado de la tab (aplica a todos los equipos)
  // La fecha está en alguna celda de las primeras filas antes de los headers
  let sheetFecha=null;
  for(let i=0;i<hIdx&&i<8;i++){
    for(const cell of rows[i]){
      const s=String(cell||'').trim();
      if(!s)continue;
      const d=_parseDate(s);
      if(d&&d<=HOY&&d.getFullYear()>=2020){sheetFecha=formatFechaCorta(s);break;}
    }
    if(sheetFecha)break;
  }

  const hdr=rows[hIdx].map(c=>normCod(c));
  const iCod=hdr.findIndex(h=>h==='CODIGO');
  const iEqu=hdr.findIndex(h=>h==='EQUIPO'||h.includes('NOMBRE')||h.includes('DESCRIPCION'));
  const iEst=hdr.findIndex(h=>h==='ESTADO');
  const iUbi=hdr.findIndex(h=>h.includes('LUGAR'));
  const iOpe=hdr.findIndex(h=>h.includes('OPERARIO')||h.includes('RESPONSABLE'));
  const iFec=hdr.findIndex(h=>h.includes('FECHA')||h.includes('ACTUALIZACION'));
  const iPat=hdr.findIndex(h=>h.includes('PATENTE')||h.includes('DOMINIO'));
  const iMar=hdr.findIndex(h=>h==='MARCA');
  const iMod=hdr.findIndex(h=>h==='MODELO');
  const iCla=hdr.findIndex(h=>h.includes('CLASIF')||h.includes('TIPO')||h.includes('CATEGORIA'));
  // Columna OBSERVACIÓN: indica propiedad del equipo. Valores observados en la hoja:
  //   "Propio" (mayoría), "Alquiler"/"Alquilado", "Externo" (transporte pesado tercerizado),
  //   "-" o vacío (sin datos). También se acepta "TENENCIA" o "PROPIEDAD" como nombre alternativo.
  const iObs=hdr.findIndex(h=>h.includes('OBSERV')||h==='TENENCIA'||h==='PROPIEDAD');
  for(let i=hIdx+1;i<rows.length;i++){
    const r=rows[i];const cod=normCod(r[iCod]);
    if(!cod||cod==='CODIGO')continue;
    // Datos de la fila
    const equipo      =iEqu>=0?String(r[iEqu]||'').trim():'';
    const estado      =iEst>=0?String(r[iEst]||'').trim():'';
    const ubicacion   =iUbi>=0?String(r[iUbi]||'').trim():'';
    const operario    =iOpe>=0?String(r[iOpe]||'').trim():'';
    const patente     =iPat>=0?String(r[iPat]||'').trim():'';
    const marca       =iMar>=0?String(r[iMar]||'').trim():'';
    const modelo      =iMod>=0?String(r[iMod]||'').trim():'';
    const clasificacion=iCla>=0?String(r[iCla]||'').trim():'';
    const observacion =iObs>=0?String(r[iObs]||'').trim():'';
    // Filtrar filas-ruido: código presente pero sin ningún dato real
    if(!equipo&&!estado&&!ubicacion&&!operario&&!patente&&!marca&&!modelo)continue;
    const fechaCelda=iFec>=0?formatFechaCorta(String(r[iFec]||'').trim()):null;
    // Normalizar tenencia: 'propio' | 'alquilado' | 'desconocido'
    // PROP* → propio · ALQUIL*/EXTERN*/RENT*/LEASING → alquilado · resto/vacío/"-" → desconocido
    const obsN=observacion.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
    let tenencia='desconocido';
    if(obsN.startsWith('prop'))tenencia='propio';
    else if(obsN.includes('alquil')||obsN.startsWith('extern')||obsN.includes('rent')||obsN.includes('leasing'))tenencia='alquilado';
    result[cod]={
      rawCod:String(r[iCod]||'').trim(),
      equipo:equipo||null,
      estado,
      ubicacion,
      operario,
      fecha:fechaCelda||sheetFecha,
      patente,
      marca,
      modelo,
      clasificacion,
      categoria:categoria||'',
      observacion,
      tenencia,
    };
  }
  return result;
}

/* ═══════════════════════════════════════════════════════
   PANEL_REPUESTOS — Procesamiento consolidado
   Toma las filas del panel maestro (output del Apps Script
   "actualizarPanelRepuestos") y produce todos los derivados
   que antes se calculaban combinando MESES_ENTREGAS + PANEL.
═══════════════════════════════════════════════════════ */
const MES_NOMBRE_TO_NUM = {
  ENERO:1,FEBRERO:2,MARZO:3,ABRIL:4,MAYO:5,JUNIO:6,
  JULIO:7,AGOSTO:8,SEPTIEMBRE:9,OCTUBRE:10,NOVIEMBRE:11,DICIEMBRE:12,
};
const MES_NOMBRE_TO_LABEL = {
  ENERO:'Ene',FEBRERO:'Feb',MARZO:'Mar',ABRIL:'Abr',MAYO:'May',JUNIO:'Jun',
  JULIO:'Jul',AGOSTO:'Ago',SEPTIEMBRE:'Sep',OCTUBRE:'Oct',NOVIEMBRE:'Nov',DICIEMBRE:'Dic',
};

function mesAnioToYm(mes,anio){
  const m=MES_NOMBRE_TO_NUM[String(mes||'').toUpperCase().trim()];
  const y=String(anio||'').trim();
  if(!m||!/^\d{4}$/.test(y))return null;
  return `${y}-${String(m).padStart(2,'0')}`;
}
function mesAnioToLabel(mes,anio){
  const ab=MES_NOMBRE_TO_LABEL[String(mes||'').toUpperCase().trim()];
  const y=String(anio||'').trim();
  if(!ab||!/^\d{4}$/.test(y))return '';
  return `${ab} ${y}`;
}

// Parsea el campo ITEMS DETALLE (string concatenado) de vuelta a array de items.
// Formato producido por el Apps Script:
//   "3x Filtro de aceite (cód ABC, prov XYZ, obs: ...) | 2x Aceite 15W40"
function parseItemsDetalle(str){
  const s=String(str||'').trim();
  if(!s||s==='—'||s==='-')return [];
  return s.split(' | ').map(chunk=>{
    const trozo=chunk.trim();
    if(!trozo)return null;
    const item={};
    // Detectar paréntesis con extras
    const mParen=trozo.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    const main=mParen?mParen[1].trim():trozo;
    const extras=mParen?mParen[2]:'';
    // Cantidad: "<N>x descripcion"  o  "<N unidad>x descripcion"
    // Ej: "1x Filtro", "20 litrosx Aceite", "0,4 metrosx Goma", "-x Service"
    const mCant=main.match(/^(\S+(?:\s+\S+)?)x\s+(.+)$/);
    if(mCant){item.cantidad=mCant[1];item.descripcion=mCant[2].trim();}
    else{item.descripcion=main;}
    // Extras separados por coma
    if(extras){
      extras.split(',').forEach(e=>{
        const t=e.trim();
        if(/^c[óo]d\s+/i.test(t))item.codigo=t.replace(/^c[óo]d\s+/i,'').trim();
        else if(/^prov\s+/i.test(t))item.proveedor=t.replace(/^prov\s+/i,'').trim();
        else if(/^obs:/i.test(t))item.observacion=t.replace(/^obs:/i,'').trim();
      });
    }
    return item;
  }).filter(Boolean);
}

// Lookup tolerante de columna (acentos/espacios/símbolos)
function _pickCol(obj,candidatos){
  // normCod ya hace exactamente lo que necesitamos: tildes fuera, solo alfanum, may\u00fasculas.
  // "N\u00b0 ENTREGA", "n entrega", "NENTREGA" \u2192 todos "NENTREGA".
  const cand=candidatos.map(normCod);
  for(const k of Object.keys(obj)){
    if(cand.includes(normCod(k)))return obj[k];
  }
  return '';
}

// Procesa las filas (formato fetchGvizObj) del PANEL_REPUESTOS consolidado.
// Devuelve todo el contexto derivado: costos, items, entregas por equipo, etc.
function procesarPanelRepuestos(panelObj){
  const ctx={
    entregaCostos:{},      // { nro: {costo, mes} }
    itemsPorEntrega:{},    // { nro: [items...] }
    costosPorMes:{},       // { ym: { codN: costo } }
    costosCorrPorMes:{},   // { ym: { codN: costo } } — solo entregas correctivas (tab costos downtime)
    entregasPorEquipo:{},  // { codN: [{nro,fecha,items,costo}] }
    repuestosHistorial:{}, // { codN: { ym: costoTotal } }
    entregasMesActual:[],  // entregas del mes actual: {nro,fecha,equipo,codigo,costo,costoNum,razon,responsable,nroPedido,items}
  };
  if(!panelObj||!panelObj.length)return ctx;

  const MES_ACTUAL_YM=MES_ACTUAL?MES_ACTUAL.ym:null;

  for(const r of panelObj){
    const mes=_pickCol(r,['MES']);
    const anio=_pickCol(r,['AÑO ARCHIVO','ANO ARCHIVO','ANIO ARCHIVO','AÑO','ANO','ANIO']);
    const nro=String(_pickCol(r,['N° ENTREGA','N ENTREGA','NRO ENTREGA','NUMERO ENTREGA'])||'').trim();
    const nroPedido=String(_pickCol(r,['N° PEDIDO ENTREGADO','N PEDIDO ENTREGADO','N° PEDIDO','NRO PEDIDO'])||'').trim();
    const fechaRaw=_pickCol(r,['FECHA']);
    const fecha=String(fechaRaw||'').trim();
    const equipo=String(_pickCol(r,['EQUIPO'])||'').trim();
    const codigoRaw=String(_pickCol(r,['CÓDIGO','CODIGO'])||'').trim();
    const codN=normCod(codigoRaw);
    const costoStr=String(_pickCol(r,['COSTO ENTREGA','COSTO'])||'').trim();
    const costo=parseMoney(costoStr);
    const razon=String(_pickCol(r,['RAZÓN ENTREGA','RAZON ENTREGA','RAZON','MOTIVO'])||'').trim();
    const resp=String(_pickCol(r,['RESPONSABLE ENTREGA','RESPONSABLE'])||'').trim();
    const itemsStr=String(_pickCol(r,['ITEMS DETALLE','ITEMS','REPUESTOS ENTREGADOS','REPUESTOS'])||'').trim();
    const items=parseItemsDetalle(itemsStr);

    // Fallback: si MES/AÑO ARCHIVO no están (sheet sin esa metadata), derivamos
    // ym y label de la FECHA. Necesario para el sheet histórico nuevo (1WCtB...)
    // que solo trae N° ENTREGA, FECHA, EQUIPO, CÓDIGO, REPUESTOS, COSTO.
    let ym=mesAnioToYm(mes,anio);
    let label=mesAnioToLabel(mes,anio);
    if(!ym){
      const d=_parseDate(fechaRaw);
      if(d){
        ym=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        const _ab=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
        label=`${_ab[d.getMonth()]} ${d.getFullYear()}`;
      }
    }

    // 1) _entregaCostos[nro]
    if(nro){
      ctx.entregaCostos[nro]={costo:costo,mes:label||''};
    }
    // 2) _itemsPorEntrega[nro]
    if(nro&&items.length){
      ctx.itemsPorEntrega[nro]=items;
    }
    // 3) _costosPorMes[ym][codN]
    if(ym&&codN&&costo>0){
      (ctx.costosPorMes[ym]=ctx.costosPorMes[ym]||{});
      ctx.costosPorMes[ym][codN]=(ctx.costosPorMes[ym][codN]||0)+costo;
      // 4) _repuestosHistorial[codN][ym]
      (ctx.repuestosHistorial[codN]=ctx.repuestosHistorial[codN]||{});
      ctx.repuestosHistorial[codN][ym]=(ctx.repuestosHistorial[codN][ym]||0)+costo;
      // 4b) Solo correctivo SIN neumáticos (criterio del tab de costos:
      // RAZÓN manda, fallback por texto de items). Alimenta costos downtime.
      if(esCorrectivoCosto(razon,itemsStr)){
        (ctx.costosCorrPorMes[ym]=ctx.costosCorrPorMes[ym]||{});
        ctx.costosCorrPorMes[ym][codN]=(ctx.costosCorrPorMes[ym][codN]||0)+costo;
      }
    }
    // 5) _entregasPorEquipo[codN]
    if(codN&&codN!=='-'){
      (ctx.entregasPorEquipo[codN]=ctx.entregasPorEquipo[codN]||[]).push({
        nro:nro||'—', fecha:fecha||'—',
        items:itemsStr||'—', costo:costo,
      });
    }
    // 6) Entregas del mes actual (para el dashboard inicial)
    if(MES_ACTUAL_YM&&ym===MES_ACTUAL_YM){
      ctx.entregasMesActual.push({
        nro,fecha,equipo,codigo:codigoRaw,
        costo:costoStr,costoNum:costo,
        razon,responsable:resp,nroPedido,
        items,
      });
    }
  }
  return ctx;
}

/* ═══════════════════════════════════════════════════════
   CARGA LAZY
═══════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════
   PROCESAMIENTO PANEL_TRABAJOS · agregados a nivel flota
═══════════════════════════════════════════════════════ */
// Clasifica un trabajo de PANEL_TRABAJOS como 'preventivo' (mantenimiento programado:
// service, mantenimiento básico) o 'correctivo' (reparación, neumáticos, rotura).
// Prioridad: columna RAZÓN TRABAJO cuando está cargada > heurística por palabras clave
// en la descripción. Criterio definido por Marcos (may-2026):
//   - neumáticos = correctivo
//   - si RAZÓN tiene rasgos de reparación Y de mantenimiento, gana correctivo
//   - filas sin RAZÓN se adivinan por descripción; si nada matchea → correctivo
function clasificarTrabajo(razon,descripcion){
  const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  const r=norm(razon);
  if(r){
    if(r.includes('reparacion')||r.includes('neumatico'))return'correctivo';
    if(r.includes('service')||r.includes('mantenimiento'))return'preventivo';
  }
  // RAZÓN vacía o no reconocida → heurística por descripción
  const d=norm(descripcion);
  const KW_PREV=['service','mantenimiento','cambio de aceite','cambio de filtro',
    'cambio de filtros','filtro de aceite','engrase','lubricacion','lubricado'];
  for(const kw of KW_PREV)if(d.includes(kw))return'preventivo';
  return'correctivo';
}

// Criterio del TAB DE COSTOS (pedido de Marcos jul-2026): correctivo SIN
// neumáticos. Las gomas infladan el costo de downtime (son consumo de desgaste
// más que falla mecánica), así que se separan. OJO: clasificarTrabajo (KPI de
// horas del panel) NO cambia — neumáticos siguen siendo correctivo ahí.
function esCorrectivoCosto(razon,descripcion){
  const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  const r=norm(razon), d=norm(descripcion);
  if(r.includes('neumatic'))return false;
  // filas sin razón: si la descripción/items delatan gomería, también afuera
  if(!r&&(d.includes('neumatic')||d.includes('cubierta')||d.includes('pinchad')))return false;
  return clasificarTrabajo(razon,descripcion)==='correctivo';
}

// Toma las filas de PANEL_TRABAJOS (formato fetchGvizObj) y produce:
//   _horasPorEquipo  : { codN: totalHoras }
//   _horasPorMesFlota: { ym: totalHorasFlota }
//   _horasFlota      : { prev, corr, total }   ← split preventivo/correctivo de la flota
//   _horasPrev/CorrPorMes    : { ym: horas }
//   _horasPrev/CorrPorEquipo : { codN: horas }
// Tolera nombres de columna variantes (igual que loadTrabajosRegistro).
function procesarPanelTrabajos(rawRows){
  const out={
    horasPorEquipo:{},horasPorMesFlota:{},totalFilas:0,
    horasFlota:{prev:0,corr:0,total:0},
    horasPrevPorMes:{},horasCorrPorMes:{},
    horasPrevPorEquipo:{},horasCorrPorEquipo:{},
    horasPorMesYEquipo:{}, // {ym: {codN: horas}} — para listado de horas filtrado por rango
    horasCorrPorMesYEquipo:{},  // {ym: {codN: hr correctivas}} — tab costos downtime (MO + oportunidad)
  };
  if(!rawRows||!rawRows.length)return out;
  const SINONIMOS={
    codigo:['CODIGO','COD','CODIGO EQUIPO'],
    equipo:['EQUIPO','NOMBRE EQUIPO','DESCRIPCION EQUIPO'],
    fecha :['FECHA TRABAJO','FECHA DE TRABAJO','FECHA'],
    tiempo:['TIEMPO TRABAJO','TIEMPO (HR)','TIEMPO TRABAJO (HR)','TIEMPO TRABAJO HR','TIEMPO HR','TIEMPO','HORAS','HS'],
    razon :['RAZON TRABAJO','RAZON DE TRABAJO','RAZON','MOTIVO TRABAJO','MOTIVO'],
    desc  :['DESCRIPCION TRABAJOS','TRABAJOS REALIZADOS','TRABAJO REALIZADO','DESCRIPCION TRABAJO','DESCRIPCION'],
  };
  // Mapa nombre-normalizado → codN para fallback cuando CÓDIGO viene vacío
  const nombreToCod={};
  for(const eq of(window._equiposOrdenados||[])){
    const n=normCod(eq.nombre||'');
    if(n)nombreToCod[n]=normCod(eq.codigo);
  }
  let totalFilas=0;
  for(const r of rawRows){
    const idx={};
    for(const k of Object.keys(r))idx[normHead(k)]=r[k];
    const get=keys=>{
      for(const k of keys){const v=idx[k];if(v!=null&&String(v).trim()!=='')return String(v).trim();}
      return'';
    };
    const codRaw=get(SINONIMOS.codigo);
    let codN=normCod(codRaw);
    if(!codN){
      const nomN=normCod(get(SINONIMOS.equipo));
      if(nomN&&nombreToCod[nomN])codN=nombreToCod[nomN];
    }
    const tiempo=get(SINONIMOS.tiempo);
    const fecha=get(SINONIMOS.fecha);
    if(!codN&&!tiempo&&!fecha)continue;
    totalFilas++;
    const tNum=parseFloat(String(tiempo||'').replace(',','.'));
    if(!isFinite(tNum)||tNum<=0)continue;
    // Clasificar preventivo / correctivo
    const tipo=clasificarTrabajo(get(SINONIMOS.razon),get(SINONIMOS.desc));
    const esPrev=tipo==='preventivo';
    // total flota + split
    out.horasFlota.total+=tNum;
    if(esPrev)out.horasFlota.prev+=tNum; else out.horasFlota.corr+=tNum;
    // horas por equipo (cualquier fecha cuenta para el ranking 2026)
    if(codN){
      out.horasPorEquipo[codN]=(out.horasPorEquipo[codN]||0)+tNum;
      if(esPrev)out.horasPrevPorEquipo[codN]=(out.horasPrevPorEquipo[codN]||0)+tNum;
      else      out.horasCorrPorEquipo[codN]=(out.horasCorrPorEquipo[codN]||0)+tNum;
    }
    // horas por mes a nivel flota + por mes y equipo (para listado filtrado)
    const d=_parseDate(fecha);
    if(d){
      const ym=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      out.horasPorMesFlota[ym]=(out.horasPorMesFlota[ym]||0)+tNum;
      if(esPrev)out.horasPrevPorMes[ym]=(out.horasPrevPorMes[ym]||0)+tNum;
      else      out.horasCorrPorMes[ym]=(out.horasCorrPorMes[ym]||0)+tNum;
      if(codN){
        out.horasPorMesYEquipo[ym]=out.horasPorMesYEquipo[ym]||{};
        out.horasPorMesYEquipo[ym][codN]=(out.horasPorMesYEquipo[ym][codN]||0)+tNum;
        // Correctivos SIN neumáticos (criterio del tab de costos): las horas
        // de mantenimiento correctivo (TIEMPO TRABAJO) alimentan MO y también
        // el costo de oportunidad. TIEMPO PARADA se descartó: el taller lo
        // carga en 0 en casi todos los registros 2026 (definición jul-2026).
        if(esCorrectivoCosto(get(SINONIMOS.razon),get(SINONIMOS.desc))){
          out.horasCorrPorMesYEquipo[ym]=out.horasCorrPorMesYEquipo[ym]||{};
          out.horasCorrPorMesYEquipo[ym][codN]=(out.horasCorrPorMesYEquipo[ym][codN]||0)+tNum;
        }
      }
    }
  }
  out.totalFilas=totalFilas;
  return out;
}

/* ═══════════════════════════════════════════════════════
   SERVICES PLANIFICADOS — fuentes externas a TRABAJOS REALIZADOS
   Regla operativa: cuando el service es PURO (sin reparaciones asociadas) se
   carga SOLO en los sheets de service ("PROGRAMA DE TRABAJOS DE SERVICE 2026"
   + PANEL_PROGRAMA del "TRABAJO DE SERVICE 2026"). Cuando hay reparación o
   parada conjunta service+reparación, se carga en las planillas mensuales
   TRABAJOS REALIZADOS. Por eso este cruce NO es para detectar fallas de carga
   sino para clasificar y completar la métrica:
     - cargadosService:    el operario también cargó como service en planilla
                           (puede haber reparación pequeña en la misma parada)
     - cargadosOtraRazon:  parada conjunta service+reparación cargada como
                           "Reparación" (la razón del operario manda)
     - sinCarga:           service PURO — solo está en el planning porque no
                           hubo reparación. Estimamos horas con la mediana de
                           services registrados del prefijo del equipo y las
                           sumamos al preventivo (las planillas TRABAJOS DE
                           SERVICE no registran tiempo trabajado).
═══════════════════════════════════════════════════════ */
// Pestañas POR EQUIPO del sheet HIST de trabajos (1cNWQ). El consolidador del
// Drive periódicamente trunca PANEL_TRABAJOS dejando solo el año en curso, pero
// estas pestañas operativas se mantienen con datos de años anteriores. Las
// leemos en paralelo para reconstruir el histórico 2025. Si se agrega un equipo
// nuevo al sheet, hay que sumarlo acá (o se pierde su histórico 2025).
const TRABAJOS_HIST_PESTANAS_EQUIPOS=[
  'Automóvil Chevrolet Prisma','Barredora Guillermo Fracchia','Batea Patronelli',
  'Camión Ford Cargo 1831','Camión Ford Cargo 1832E','Camión Mercedes Benz 1720',
  'Camión Mercedes Benz 1725','Camión Mercedes Benz L1114','Camión Mercedes Benz L1514',
  'Camión Mercedes Benz L1620','Camión Scania LT111','Camión Volvo FM380',
  'Camioneta Chevrolet S10','Camioneta Fiat Fiorino','Camioneta Fiat Strada',
  'Camioneta Fiat Toro','Camioneta Ford Ranger','Camioneta Nissan Frontier',
  'Camioneta Renault Kangoo','Camioneta Toyota Hilux','Camioneta Volkswagen Amarok',
  'Cargador John Deere 544K','Cargador John Deere 624K','Cargador Volvo L110F',
  'Cargador Volvo L90F','Carretón Marcelini SRC12NA','Carretón LEO-COR Agro 21',
  'Compresor Atlas Copco','Compresor Ingersoll Rand','Compresor Schulz',
  'Generador CETEC CD-530','Generador CRAM','Generador MWM MS3.9A',
  'Motoniveladora CAT 140K','Motoniveladora CAT 140M','Motoniveladora CAT 14G',
  'Planta Ammann Prime 140','Retroexcavadora John Deere 210G',
  'Retroexcavadora Komatsu PC200','Retroexcavadora Komatsu PC210',
  'Retropala CAT 416E','Retropala Hidromek 102B','Retropala John Deere 310J',
  'Retropala John Deere 310K','Retropala John Deere 310L','Rodillo Bomag BW24RH',
  'Rodillo CAT CB534D','Rodillo CAT CS-533C','Rodillo CAT CS-533E',
  'Rodillo Dynapac CC424HF','Rodillo Dynapac CP221','Rodillo Dynapac CP224',
  'Rodillo Volvo SD105','Terminadora Dynapac F121C','Terminadora Dynapac F2500C',
  'Topadora CAT D6E','Trituradora Metso HP300','Zaranda ASTEC GT145S',
];

// HIST de trabajos por equipo: el aplanado de las 58 pestañas (con la
// heurística de fechas-rango que gviz devolvía null) ahora lo hace el builder
// server-side y queda en la pestaña TRAB_HIST58 del snapshot. El browser solo
// la lee y filtra por año (ver fetchTrabajosHistPorEquipo más abajo). La lógica
// de las 3 pasadas vive en _construirHist58_ de apps-scripts/snapshot-builder.gs.
async function fetchTrabajosHistPorEquipo(predicateAnio){
  // El builder ya aplanó las 58 pestañas por equipo en la pestaña TRAB_HIST58
  // del snapshot, con la heurística de fechas-rango aplicada server-side (que
  // además recupera fechas que gviz devolvía null en columnas Date). Acá solo
  // leemos esa pestaña y filtramos por año: 1 request en vez de 58.
  let rows=[];
  try{ rows=await fetchGvizObj(SNAPSHOT_ID,'TRAB_HIST58'); }
  catch(e){ window._fetchTrabajosHistErrores=[{pest:'TRAB_HIST58',error:e.message}]; return []; }
  window._fetchTrabajosHistErrores=[];
  // Lookup de FECHA tolerante al nombre exacto de columna (defensa en profundidad):
  // si el builder renombra el header o gviz no lo detecta, igual encontramos la fecha.
  const _SIN_FECHA=['FECHA TRABAJO','FECHA DE TRABAJO','FECHA'];
  const out=[];
  let conFecha=0;
  for(const r of rows){
    const idx={};
    for(const k of Object.keys(r))idx[normHead(k)]=r[k];
    let fechaStr='';
    for(const k of _SIN_FECHA){const v=idx[k];if(v!=null&&String(v).trim()!==''){fechaStr=String(v).trim();break;}}
    if(!fechaStr)continue;
    conFecha++;
    const d=_parseDate(fechaStr);
    if(!d||!predicateAnio(d.getFullYear()))continue;
    out.push(r);
  }
  // Guard de regresión: si llegaron filas pero NINGUNA tenía columna de fecha
  // reconocible, es el síntoma del header no detectado → lo dejamos visible en
  // lugar de perder el histórico en silencio (como pasó con el bug del format '@').
  if(rows.length && conFecha===0){
    window._fetchTrabajosHistErrores=[{pest:'TRAB_HIST58',error:`header no detectado: ${rows.length} filas sin columna FECHA reconocible (cols: ${Object.keys(rows[0]||{}).join(',')})`}];
    console.warn('[TRAB_HIST58]',window._fetchTrabajosHistErrores[0].error);
  }
  return out;
}

const SERVICE_VENTANA_DIAS=7;
function _prefijoCod(codN){const m=String(codN||'').match(/^([A-Z]+)/);return m?m[1]:'';}
function _ymd(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function _ym(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
function _mediana(arr){const s=[...arr].sort((a,b)=>a-b);const n=s.length;if(!n)return null;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;}
// Parsea fecha simple o rango ("3/3/2026 - 12/3/2026", "3/3/2026 – 12/3/2026").
// Devuelve {inicio, fin} (Date) o null. Para fecha simple, inicio === fin.
// _parseDate por sí solo devuelve solo la primera fecha que matchea — para rangos
// con guion/em-dash, perdería un extremo. Acá detectamos el separador y partimos.
function _parseFechaRango(s){
  if(s==null)return null;
  const str=String(s).trim();
  if(!str)return null;
  const partes=str.split(/\s*[-–—]\s*/);
  if(partes.length>=2){
    const ini=_parseDate(partes[0]);
    const fin=_parseDate(partes[partes.length-1]);
    if(ini&&fin)return{inicio:ini<=fin?ini:fin,fin:ini<=fin?fin:ini};
    if(ini)return{inicio:ini,fin:ini};
    if(fin)return{inicio:fin,fin:fin};
  }
  const d=_parseDate(str);
  return d?{inicio:d,fin:d}:null;
}
// Distancia mínima en ms entre un punto y un rango [inicio, fin]. 0 si está dentro.
function _distAlRango(punto,rango){
  if(!rango)return Infinity;
  if(punto<rango.inicio)return rango.inicio-punto;
  if(punto>rango.fin)return punto-rango.fin;
  return 0;
}

// Lee los 3 sheets de planning y devuelve eventos únicos {cod, fecha, ym}.
// trim1Rows/trim2Rows vienen como arrays de arrays (gvizRaw); cols [1]=codigo,
// [6]=ULT_FECHA, [11]/[13]/[15]=fechas mensuales del trimestre.
// panelProgramaRows viene como array de objetos (gvizObj); CODIGO, ULT_FECHA.
function procesarServicesPlanning(trim1Rows,trim2Rows,panelProgramaRows){
  const eventos=[];
  const COLS_TRIM_FECHA=[6,11,13,15];
  for(const rows of [trim1Rows||[],trim2Rows||[]]){
    for(const r of rows){
      const cod=normCod(r&&r[1]);
      if(!cod)continue;
      for(const idx of COLS_TRIM_FECHA){
        const d=_parseDate(r[idx]);
        if(d)eventos.push({cod,fecha:d});
      }
    }
  }
  for(const r of (panelProgramaRows||[])){
    const idx={};
    for(const k of Object.keys(r||{}))idx[normHead(k)]=r[k];
    const cod=normCod(idx['CODIGO']||idx['COD']||'');
    if(!cod)continue;
    const d=_parseDate(idx['ULT FECHA']||idx['ULTIMA FECHA']||'');
    if(d)eventos.push({cod,fecha:d});
  }
  // Deduplicar por (cod, ymd)
  const seen=new Set();
  const unicos=[];
  const fechasPorCod={};
  for(const e of eventos){
    const ymd=_ymd(e.fecha);
    const k=`${e.cod}|${ymd}`;
    if(seen.has(k))continue;
    seen.add(k);
    unicos.push({cod:e.cod,fecha:e.fecha,ym:_ym(e.fecha),ymd});
    if(!fechasPorCod[e.cod])fechasPorCod[e.cod]=new Set();
    fechasPorCod[e.cod].add(ymd);
  }
  return{eventos:unicos,fechasPorCod,total:unicos.length};
}

// Cruza services del planning con PANEL_TRABAJOS. Suma horas estimadas (mediana
// de horas de service registradas por prefijo) al preventivo SOLO para los que
// no tienen ninguna fila en ±7d (services puros sin reparación, no se cargaron
// en la planilla porque fueron rápidos).
function cruzarServicesEnTrabajos(rawTrabajos,servicesPlanning){
  const out={
    horasAgregadasFlota:0,
    horasAgregadasPorEquipo:{},
    horasAgregadasPorMes:{},
    horasAgregadasPorMesYEquipo:{}, // {ym: {codN: horas}} para listado filtrado
    serviceFechasMatch:{}, // codN -> Set<ymd> con TODAS las fechas con service planificado del equipo
    cumplimiento:{total:0,cargadosService:0,cargadosOtraRazon:0,sinCarga:0},
    medianas:{global:null,porPrefijo:{}},
  };
  if(!servicesPlanning||!servicesPlanning.eventos.length)return out;

  // 1) Calcular mediana de horas por prefijo a partir de PANEL_TRABAJOS, mirando
  //    solo filas con RAZÓN service/mantenimiento y tiempo > 0.
  const SIN_TIEMPO=['TIEMPO TRABAJO','TIEMPO (HR)','TIEMPO TRABAJO (HR)','TIEMPO TRABAJO HR','TIEMPO HR','TIEMPO','HORAS','HS'];
  const SIN_FECHA=['FECHA TRABAJO','FECHA DE TRABAJO','FECHA'];
  const SIN_RAZON=['RAZON TRABAJO','RAZON DE TRABAJO','RAZON','MOTIVO TRABAJO','MOTIVO'];
  const SIN_COD=['CODIGO','COD','CODIGO EQUIPO'];
  const horasPorPref={};const horasGlobal=[];
  const filasTrab=[]; // {codN, rango:{inicio,fin}|null, razon, tNum}
  for(const r of (rawTrabajos||[])){
    const idx={};
    for(const k of Object.keys(r))idx[normHead(k)]=r[k];
    const get=keys=>{for(const k of keys){const v=idx[k];if(v!=null&&String(v).trim()!=='')return String(v).trim();}return'';};
    const codN=normCod(get(SIN_COD));
    if(!codN)continue;
    const tNum=parseFloat(String(get(SIN_TIEMPO)).replace(',','.'));
    const razon=get(SIN_RAZON);
    // Soporta rangos "3/3/2026 - 12/3/2026": el cruce contra services planificados
    // matchea si el service cae adentro del rango (o dentro de ±7d del rango).
    const rango=_parseFechaRango(get(SIN_FECHA));
    filasTrab.push({codN,rango,razon,tNum:isFinite(tNum)&&tNum>0?tNum:0});
    if(isFinite(tNum)&&tNum>0&&/service|mantenimiento/i.test(razon)){
      const pref=_prefijoCod(codN);
      if(!horasPorPref[pref])horasPorPref[pref]=[];
      horasPorPref[pref].push(tNum);
      horasGlobal.push(tNum);
    }
  }
  const medianaGlobal=_mediana(horasGlobal);
  out.medianas.global=medianaGlobal;
  for(const k of Object.keys(horasPorPref))out.medianas.porPrefijo[k]=_mediana(horasPorPref[k]);

  // 2) Indexar filas de TRABAJOS por codN + calcular cobertura por año.
  // Sólo sumamos horas estimadas de services en AÑOS donde PANEL_TRABAJOS
  // tiene >=100 hr reales. Si un año tiene apenas una o dos filas perdidas
  // (ej. una fila con rango "2/1/2025 - 7/1/2025" en un panel que es
  // mayoritariamente 2026), no tiene sentido sumar todos los services
  // planificados de ese año porque no hay con qué contrastar.
  const trabajosPorCod={};
  const horasPorAnio={};
  for(const f of filasTrab){
    if(!trabajosPorCod[f.codN])trabajosPorCod[f.codN]=[];
    trabajosPorCod[f.codN].push(f);
    if(f.rango && f.tNum>0){
      const y=f.rango.inicio.getFullYear();
      horasPorAnio[y]=(horasPorAnio[y]||0)+f.tNum;
    }
  }
  const MIN_HORAS_ANIO=100;
  const aniosConCobertura=new Set(
    Object.keys(horasPorAnio).filter(y=>horasPorAnio[y]>=MIN_HORAS_ANIO).map(y=>+y)
  );

  // 3) Cruce: service "en ventana" si su fecha cae dentro del rango del trabajo o
  // a ≤SERVICE_VENTANA_DIAS de cualquiera de los extremos.
  const ventanaMs=SERVICE_VENTANA_DIAS*86400000;
  for(const ev of servicesPlanning.eventos){
    // Filtro por año: ignorar services en años sin cobertura sustancial de trabajos.
    if(aniosConCobertura.size>0 && !aniosConCobertura.has(ev.fecha.getFullYear())) continue;
    out.cumplimiento.total++;
    if(!out.serviceFechasMatch[ev.cod])out.serviceFechasMatch[ev.cod]=new Set();
    out.serviceFechasMatch[ev.cod].add(ev.ymd);
    const filas=trabajosPorCod[ev.cod]||[];
    const enVentana=filas.filter(f=>f.rango&&_distAlRango(ev.fecha,f.rango)<=ventanaMs);
    if(enVentana.length===0){
      out.cumplimiento.sinCarga++;
      const pref=_prefijoCod(ev.cod);
      const h=(out.medianas.porPrefijo[pref]!=null?out.medianas.porPrefijo[pref]:medianaGlobal)||0;
      if(h>0){
        out.horasAgregadasFlota+=h;
        out.horasAgregadasPorEquipo[ev.cod]=(out.horasAgregadasPorEquipo[ev.cod]||0)+h;
        out.horasAgregadasPorMes[ev.ym]=(out.horasAgregadasPorMes[ev.ym]||0)+h;
        out.horasAgregadasPorMesYEquipo[ev.ym]=out.horasAgregadasPorMesYEquipo[ev.ym]||{};
        out.horasAgregadasPorMesYEquipo[ev.ym][ev.cod]=(out.horasAgregadasPorMesYEquipo[ev.ym][ev.cod]||0)+h;
      }
      continue;
    }
    if(enVentana.some(f=>/service|mantenimiento/i.test(f.razon)))out.cumplimiento.cargadosService++;
    else out.cumplimiento.cargadosOtraRazon++;
  }
  return out;
}

/* ═══════════════════════════════════════════════════════
   PANEL_PROGRAMA — Estado de service por equipo
   Lee la consolidación del Sheet de service (TRABAJOS DE SERVICE 2026)
   y produce un índice por código normalizado.
   Columnas esperadas:
     CODIGO, DESCRIPCION, PATENTE, EST_FECHA, EST_HRKM,
     ULT_FECHA, ULT_HRKM, PROX_INFO, OPERATIVIDAD, FRECUENCIA,
     RANGO_HOLGADA, RANGO_INTERMEDIA, RANGO_CRITICA
═══════════════════════════════════════════════════════ */
function procesarPanelPrograma(rawRows){
  const out={};
  if(!rawRows||!rawRows.length)return out;
  const SIN={
    codigo:        ['CODIGO','COD'],
    descripcion:   ['DESCRIPCION','DESCRIPCIÓN','EQUIPO'],
    patente:       ['PATENTE','N SERIE N PATENTE','N° SERIE N° PATENTE'],
    estFecha:      ['EST FECHA','FECHA ESTIMADA','PROXIMO FECHA'],
    estHrKm:       ['EST HRKM','EST HR KM','HRKM ESTIMADO','PROXIMO HRKM'],
    ultFecha:      ['ULT FECHA','ULTIMA FECHA','FECHA ULTIMO'],
    ultHrKm:       ['ULT HRKM','ULT HR KM','HRKM ULTIMO','HRKM ACTUAL'],
    proxInfo:      ['PROX INFO','PROXIMO','PROX'],
    operatividad:  ['OPERATIVIDAD','OPERATIVO'],
    frecuencia:    ['FRECUENCIA','FREC'],
    rangoHolgada:  ['RANGO HOLGADA','HOLGADA','RANGO VERDE'],
    rangoIntermedia:['RANGO INTERMEDIA','INTERMEDIA','RANGO AMARILLO'],
    rangoCritica:  ['RANGO CRITICA','CRITICA','CRÍTICA','RANGO ROJO'],
    estado:        ['ESTADO'],                              // label pre-calculado (VENCIDO/CRÍTICO/…)
    hrActual:      ['HRKM ACTUAL','HR/KM ACTUAL','ACTUAL'],  // hr/km actual del equipo
  };
  for(const r of rawRows){
    const idx={};
    for(const k of Object.keys(r))idx[normHead(k)]=r[k];
    const get=keys=>{
      for(const k of keys){const v=idx[k];if(v!=null&&String(v).trim()!=='')return String(v).trim();}
      return'';
    };
    const codN=normCod(get(SIN.codigo));
    if(!codN)continue;
    out[codN]={
      codigo:get(SIN.codigo),
      descripcion:get(SIN.descripcion),
      patente:get(SIN.patente),
      estFecha:get(SIN.estFecha),
      estHrKm:get(SIN.estHrKm),
      ultFecha:get(SIN.ultFecha),
      ultHrKm:get(SIN.ultHrKm),
      proxInfo:get(SIN.proxInfo),
      operatividad:get(SIN.operatividad),
      frecuencia:get(SIN.frecuencia),
      rangoHolgada:get(SIN.rangoHolgada),
      rangoIntermedia:get(SIN.rangoIntermedia),
      rangoCritica:get(SIN.rangoCritica),
      estado:get(SIN.estado),
      hrActual:get(SIN.hrActual),
    };
  }
  return out;
}

/* ═══════════════════════════════════════════════════════
   PROGRAMA DE TRABAJOS DE SERVICE 2026 — fuente nueva.
   Combina FRECUENCIA-OPERATIVIDAD (rangos por equipo) con el trimestre
   vigente (estado actual, último y próximo service). Produce _servicePanel
   con shape compatible con el resto del panel.
   - frecRows: [descripcion, codigo, serie, frecuencia, holgada, intermedia, critica]
   - trimRows: [desc, cod, serie, _, fechaActual, hrActual, fechaUltService,
                hrUltService, hrProximoService, operatividad, ...]
═══════════════════════════════════════════════════════ */
function procesarProgramaService(frecRows,trimRows){
  const out={};
  for(const r of(frecRows||[])){
    const codN=normCod(r[1]);
    if(!codN)continue;
    out[codN]={
      codigo:String(r[1]||'').trim(),
      descripcion:String(r[0]||'').trim(),
      patente:String(r[2]||'').trim(),
      frecuencia:String(r[3]||'').trim(),
      rangoHolgada:String(r[4]||'').trim(),
      rangoIntermedia:String(r[5]||'').trim(),
      rangoCritica:String(r[6]||'').trim(),
      ultFecha:'',ultHrKm:'',estFecha:'',estHrKm:'',
      ultServiceFecha:'',ultServiceHrKm:'',operatividad:'',
    };
  }
  for(const r of(trimRows||[])){
    const codN=normCod(r[1]);
    if(!codN)continue;
    const e=out[codN]||(out[codN]={
      codigo:String(r[1]||'').trim(),descripcion:String(r[0]||'').trim(),
      patente:String(r[2]||'').trim(),frecuencia:'',
      rangoHolgada:'',rangoIntermedia:'',rangoCritica:'',
    });
    e.ultFecha       =String(r[4]||'').trim();
    e.ultHrKm        =String(r[5]||'').trim();
    e.ultServiceFecha=String(r[6]||'').trim();
    e.ultServiceHrKm =String(r[7]||'').trim();
    e.estHrKm        =String(r[8]||'').trim();
    e.operatividad   =String(r[9]||'').trim();
  }
  return out;
}

// Operatividad de service: clasifica un equipo en holgado / intermedio / critico
// según los hr/km restantes hasta el próximo service. La hr/km "actual" sale del
// combustible (lectura más fresca); si el equipo no tiene cargas, se usa la del
// PROGRAMA DE SERVICE. Rangos por equipo desde FRECUENCIA - OPERATIVIDAD.
function operatividadEquipo(codN){
  const SD={nivel:'sin-datos',color:'var(--text3)',label:'Sin datos',
            restantes:null,hrActual:null,hrProximo:null,fuente:'',frecuencia:''};
  const sp=(window._servicePanel||{})[codN];
  if(!sp)return SD;
  // El nivel sale del ESTADO ya calculado en la hoja OPERATIVIDAD (vía SVC_PANELPROG).
  const est=String(sp.estado||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase();
  let nivel,color,label;
  if(/VENCIDO|CRITICO/.test(est)){ nivel='critico'; color='var(--red)'; label='Crítico'; }
  else if(/INTERMEDIO/.test(est)){ nivel='intermedio'; color='var(--amber)'; label='Intermedio'; }
  else if(/HOLGADO/.test(est)){ nivel='holgado'; color='var(--blue)'; label='Holgado'; }
  else return SD;
  // Números para el detalle/modal (descarta vacíos, "-", "S/H" y fechas).
  const numHr=v=>{
    const s=String(v||'').trim();
    if(!s||s==='-'||/\//.test(s)||/s\/?h/i.test(s))return null;
    const n=parseFloat(s.replace(/\./g,'').replace(',','.').replace(/[^\d.-]/g,''));
    return isFinite(n)?n:null;
  };
  const hrProximo=numHr(sp.estHrKm);
  const restantes=numHr(sp.operatividad);  // columna OPERATIVIDAD = hr/km restantes (ya calculado)
  const comb=(window._combustiblePorEquipo||{})[codN];
  let hrActual,fuente;
  if(comb&&comb.ultimaHr!=null){ hrActual=comb.ultimaHr; fuente='combustible'; }
  else { hrActual=numHr(sp.hrActual); if(hrActual==null)hrActual=numHr(sp.ultHrKm); fuente='programa de service'; }
  return{nivel,color,label,restantes,hrActual,hrProximo,fuente,frecuencia:sp.frecuencia};
}

/* ═══════════════════════════════════════════════════════
   COMBUSTIBLE — Procesamiento de la pestaña ENTREGA DE COMBUSTIBLE
   Una fila = una carga. Acumulamos por código de equipo y derivamos:
     - últimas hr/km registradas (y su fecha)
     - litros totales 2026
     - consumo promedio (L/hr o L/100km según prefijo del código)
     - historial ordenado de cargas
═══════════════════════════════════════════════════════ */
// Devuelve 'km' para prefijos en PREFIJOS_KM; 'hr' para todo lo demás.
function unidadDeEquipo(codigo){
  const p=(codigo||'').toUpperCase().match(/^[A-Z]+/)?.[0]||'';
  return PREFIJOS_KM.has(p)?'km':'hr';
}

// Procesa filas (objetos fetchGvizObj) de la pestaña de combustible.
// Salida:
//   _porEquipo[codN] = { unidad, cargas:[{fecha,fechaSort,hr,litros,tipo,lugar,operario,obs,estado}],
//                        ultimaHr, ultimaFecha, totalLitros, promedio }
// "promedio" se calcula como totalLitros / (hr_max - hr_min) usando solo cargas con hr funcional.
function procesarCombustible(rows){
  const porEquipo={};
  // Litros por mes (alimenta el KPI de combustible pesados con selector de rango).
  const _litrosPorMes={}, _cargasPorMes={};
  window._litrosCombPesadosPorMes=_litrosPorMes;
  window._cargasCombPesadosPorMes=_cargasPorMes;
  if(!rows||!rows.length)return porEquipo;

  // Lookup tolerante de columnas (estos headers vienen de un Form, no van a cambiar fácil,
  // pero usamos _pickCol por las dudas).
  for(const r of rows){
    const codRaw=String(_pickCol(r,['CODIGO INTERNO DE EQUIPO NUMERO DE PATENTE DE EQUIPO',
      'CODIGO INTERNO DE EQUIPO','CODIGO INTERNO','CODIGO EQUIPO','CODIGO'])||'').trim();
    if(!codRaw)continue;
    const codN=normCod(codRaw);
    if(!codN)continue;
    const fechaStr=String(_pickCol(r,['FECHA'])||'').trim();
    const fechaD=_parseDate(fechaStr);
    const estadoHr=String(_pickCol(r,['ESTADO DE HOROMETRO U ODOMETRO DE EQUIPO','ESTADO HOROMETRO','ESTADO ODOMETRO','ESTADO'])||'').trim();
    const hrRaw=_pickCol(r,['HOROMETRO U ODOMETRO ACTUAL DE EQUIPO HORAS MAQUINA O KILOMETROS',
      'HOROMETRO U ODOMETRO ACTUAL DE EQUIPO','HOROMETRO U ODOMETRO ACTUAL','HOROMETRO ACTUAL','ODOMETRO ACTUAL']);
    const hrNum=parseFloat(String(hrRaw||'').replace(/[^\d.,-]/g,'').replace(',','.'));
    const litrosRaw=_pickCol(r,['CANTIDAD DE ENTREGA DE COMBUSTIBLE LITROS','CANTIDAD DE ENTREGA DE COMBUSTIBLE','LITROS','CANTIDAD']);
    const litros=parseFloat(String(litrosRaw||'').replace(/[^\d.,-]/g,'').replace(',','.'))||0;
    if(fechaD){
      const _ym=fechaD.getFullYear()+'-'+String(fechaD.getMonth()+1).padStart(2,'0');
      _litrosPorMes[_ym]=(_litrosPorMes[_ym]||0)+litros;
      _cargasPorMes[_ym]=(_cargasPorMes[_ym]||0)+1;
    }
    const tipo=String(_pickCol(r,['TIPO DE COMBUSTIBLE ENTREGADO DIESEL 500 O DIESEL INFINIA','TIPO DE COMBUSTIBLE ENTREGADO','TIPO DE COMBUSTIBLE','TIPO'])||'').trim();
    const lugar=String(_pickCol(r,['LUGAR DE ENTREGA DE COMBUSTIBLE','LUGAR ENTREGA','LUGAR'])||'').trim();
    const operario=String(_pickCol(r,['OPERARIO DE EQUIPO NOMBRE Y APELLIDO','OPERARIO DE EQUIPO','OPERARIO'])||'').trim();
    const obs=String(_pickCol(r,['OBSERVACIONES GENERALES','OBSERVACIONES','OBS'])||'').trim();
    // El form a veces graba 0 cuando "No funciona" el horómetro. Esos no aportan al consumo
    // pero los conservamos en el historial con hr=null para no perder la carga.
    const hrFunc = estadoHr.toLowerCase().startsWith('sí') || estadoHr.toLowerCase().startsWith('si');
    const hrUsable = hrFunc && isFinite(hrNum) && hrNum>0 ? hrNum : null;

    if(!porEquipo[codN]){
      porEquipo[codN]={
        unidad:unidadDeEquipo(codRaw),
        cargas:[],
        ultimaHr:null, ultimaFecha:null, ultimaFechaSort:null,
        totalLitros:0, promedio:null,
      };
    }
    porEquipo[codN].cargas.push({
      fecha:fechaStr, fechaSort:fechaD?fechaD.getTime():0,
      hr:hrUsable, litros, tipo, lugar, operario, obs,
      estado:hrFunc?'ok':'sin lectura',
    });
    porEquipo[codN].totalLitros+=litros;
  }

  // Postproceso por equipo: ordenar, calcular última y promedio
  for(const codN of Object.keys(porEquipo)){
    const eq=porEquipo[codN];
    eq.cargas.sort((a,b)=>a.fechaSort-b.fechaSort);
    // última lectura válida (la más reciente con hr funcional)
    for(let i=eq.cargas.length-1;i>=0;i--){
      const c=eq.cargas[i];
      if(c.hr!=null){
        eq.ultimaHr=c.hr; eq.ultimaFecha=c.fecha; eq.ultimaFechaSort=c.fechaSort;
        break;
      }
    }
    // consumo: usamos litros entre primera y última lectura con hr funcional.
    // Excluimos los litros de la PRIMERA carga (no sabemos qué hr tenía al empezar
    // el período de medición), que es la práctica estándar.
    const conHr=eq.cargas.filter(c=>c.hr!=null);
    if(conHr.length>=2){
      const hrPrimera=conHr[0].hr, hrUltima=conHr[conHr.length-1].hr;
      const delta=hrUltima-hrPrimera;
      const litrosPeriodo=conHr.slice(1).reduce((s,c)=>s+c.litros,0);
      if(delta>0 && litrosPeriodo>0){
        // L/hr para horómetro; L/100km para odómetro
        eq.promedio = eq.unidad==='km' ? (litrosPeriodo/delta*100) : (litrosPeriodo/delta);
      }
    }
  }
  return porEquipo;
}

/* ═══════════════════════════════════════════════════════
   COMBUSTIBLE LIVIANOS — Excel "Control General"
   Una fila = una carga. Columnas (0-indexadas):
     0 fecha · 1 factura · 2 remito · 3 tipo · 4 litros ·
     5 dominio(patente) · 6 odómetro(km) · 7 obra · 8 chofer ·
     10 precio unitario · 11 total $
   Solo se toman los registros desde COMBUSTIBLE_LIVIANOS_DESDE (lo anterior
   es histórico viejo). Se matchea por patente al código de equipo.
═══════════════════════════════════════════════════════ */
function procesarCombustibleLivianos(rawRows,patenteToCarN){
  const out={porEquipo:{},gastoTotal:0,cargasTotal:0,sinMatch:0,gastoPorMes:{},cargasPorMes:{}};
  if(!rawRows||!rawRows.length)return out;
  const numLitros=v=>{const n=parseFloat(String(v||'').trim().replace(',','.'));return isFinite(n)&&n>0?n:null;};
  const numKm=v=>{const s=String(v||'').replace(/[^\d]/g,'');return s?parseInt(s,10):null;};
  for(let i=0;i<rawRows.length;i++){
    const r=rawRows[i];
    if(!r)continue;
    const fecha=String(r[0]||'').trim();
    const patRaw=String(r[5]||'').trim();
    if(!fecha&&!patRaw)continue;            // fila vacía / basura
    const d=_parseDate(fecha);
    if(!d||d<COMBUSTIBLE_LIVIANOS_DESDE)continue;  // solo enero 2025 en adelante
    const litros=numLitros(r[4]);
    const costo=parseMoney(r[11]);
    const ym=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    // gasto total + por mes: cuenta TODAS las cargas (incluye "Bidones" y no matcheadas)
    if(costo>0){
      out.gastoTotal+=costo;
      if(ym)out.gastoPorMes[ym]=(out.gastoPorMes[ym]||0)+costo;
    }
    out.cargasTotal++;
    if(ym)out.cargasPorMes[ym]=(out.cargasPorMes[ym]||0)+1;
    const codN=patenteToCarN[normPat(patRaw)];
    if(!codN){ out.sinMatch++; continue; }  // "Bidones", patentes no mapeadas
    const km=numKm(r[6]);
    const e=out.porEquipo[codN]||(out.porEquipo[codN]={
      unidad:'km',cargas:[],ultimaHr:null,ultimaFecha:null,ultimaFechaSort:null,
      totalLitros:0,totalCosto:0,promedio:null,
    });
    e.cargas.push({
      fecha,fechaSort:d?d.getTime():0,
      hr:(km!=null&&km>0)?km:null,litros:litros||0,costo:costo||0,
      tipo:String(r[3]||'').trim(),lugar:String(r[7]||'').trim(),
      operario:String(r[8]||'').trim(),obs:'',estado:(km!=null&&km>0)?'ok':'sin lectura',
    });
    e.totalLitros+=litros||0;
    e.totalCosto+=costo||0;
  }
  // Postproceso por equipo: ordenar, última lectura, consumo L/100km.
  for(const codN of Object.keys(out.porEquipo)){
    const e=out.porEquipo[codN];
    e.cargas.sort((a,b)=>a.fechaSort-b.fechaSort);
    for(let i=e.cargas.length-1;i>=0;i--){
      if(e.cargas[i].hr!=null){e.ultimaHr=e.cargas[i].hr;e.ultimaFecha=e.cargas[i].fecha;e.ultimaFechaSort=e.cargas[i].fechaSort;break;}
    }
    const conHr=e.cargas.filter(c=>c.hr!=null);
    if(conHr.length>=2){
      const delta=conHr[conHr.length-1].hr-conHr[0].hr;
      const litrosPeriodo=conHr.slice(1).reduce((s,c)=>s+c.litros,0);
      if(delta>0&&litrosPeriodo>0)e.promedio=litrosPeriodo/delta*100; // L/100km
    }
  }
  return out;
}

// Clasifica el estado de service de un equipo: 'red' | 'amber' | 'green' | 'gray'
// Compara hr/km actual del equipo contra estimación del próximo service y rangos
// (umbrales en hr/km restantes). Si no hay datos suficientes devuelve 'gray'.
function clasificarServicio(sp, hrActualEquipo){
  if(!sp)return'gray';
  const num=v=>{const n=parseFloat(String(v||'').replace(/[^\d.,-]/g,'').replace(',','.'));return isFinite(n)?n:null;};
  const est=num(sp.estHrKm);
  const hr=num(hrActualEquipo)??num(sp.ultHrKm);
  if(est==null||hr==null)return'gray';
  const restantes=est-hr;
  // Si ya pasó el estimado → crítico
  if(restantes<=0)return'red';
  // Umbrales por equipo (si están cargados); si no, defaults razonables.
  const rCrit=num(sp.rangoCritica)??50;   // hr restantes para considerarse crítico
  const rInt =num(sp.rangoIntermedia)??150;// hr restantes para amarillo
  if(restantes<=rCrit)return'red';
  if(restantes<=rInt)return'amber';
  return'green';
}

async function loadTrabajosRegistro(codigo){
  // Cache: PANEL_TRABAJOS ya se descarga en loadAll. Reusar si está.
  let rawRows = window._panelTrabajosRaw;
  if (!rawRows) {
    try{ rawRows = await fetchGvizObj(SHEET_IDS.trabajos_reg,'PANEL_TRABAJOS'); }
    catch(_){ rawRows = []; }
    window._panelTrabajosRaw = rawRows;
  }

  const SINONIMOS={
    codigo:['CODIGO','COD','CODIGO EQUIPO'],
    equipo:['EQUIPO','NOMBRE EQUIPO','DESCRIPCION EQUIPO'],
    fecha :['FECHA TRABAJO','FECHA DE TRABAJO','FECHA'],
    lugar :['LUGAR TRABAJO','LUGAR DE TRABAJO','LUGAR','UBICACION'],
    desc  :['DESCRIPCION TRABAJOS','TRABAJOS REALIZADOS','TRABAJO REALIZADO','DESCRIPCION TRABAJO','DESCRIPCION'],
    tiempo:['TIEMPO TRABAJO','TIEMPO (HR)','TIEMPO TRABAJO (HR)','TIEMPO TRABAJO HR','TIEMPO HR','TIEMPO','HORAS','HS'],
    razon :['RAZON TRABAJO','RAZON DE TRABAJO','RAZON','MOTIVO TRABAJO','MOTIVO'],
  };
  // Remapear cada fila a claves canónicas tolerando variaciones de header
  const rows=rawRows.map(r=>{
    const idx={};
    for(const k of Object.keys(r))idx[normHead(k)]=r[k];
    const get=keys=>{
      for(const k of keys){const v=idx[k];if(v!=null&&String(v).trim()!=='')return String(v).trim();}
      return'';
    };
    return{
      codigo:get(SINONIMOS.codigo),
      equipo:get(SINONIMOS.equipo),
      fecha :get(SINONIMOS.fecha),
      lugar :get(SINONIMOS.lugar),
      desc  :get(SINONIMOS.desc),
      tiempo:get(SINONIMOS.tiempo),
      razon :get(SINONIMOS.razon),
    };
  });

  // Validador endurecido: exige identificador + descripción/fecha en alguna fila
  const tieneSenales=rows.some(r=>(r.codigo||r.equipo)&&(r.desc||r.fecha));
  if(!tieneSenales){window._panelTrabajosTotal=0;return[];}

  window._panelTrabajosTotal=rows.length;
  const codN=normCod(codigo);
  const eqEntry=(window._equiposOrdenados||[]).find(e=>normCod(e.codigo)===codN);
  const nombreN=eqEntry?normCod(eqEntry.nombre):'';

  return rows.filter(r=>{
    const codR=normCod(r.codigo);
    if(codR&&codR===codN)return true;
    // Fallback por nombre cuando CÓDIGO está vacío en la planilla
    if(!codR&&nombreN&&normCod(r.equipo)===nombreN)return true;
    return false;
  });
}

async function precargarHorometros(){
  // El builder aplano los horometros de todas las pestanas de service por mes
  // en SERVICE_EQ (una fila por equipo-mes, en orden Abril->Enero = first-wins,
  // igual que el SERVICE_MESES viejo). Lo cacheamos para que el modal de equipo
  // no tenga que re-leer.
  window._horometros={};
  let rows=[];
  try{ rows=await fetchGvizObj(SNAPSHOT_ID,'SERVICE_EQ'); }catch(_){ rows=[]; }
  window._serviceEqRows=rows;
  for(const r of rows){
    const codN=String(r['CODN']||'').trim();
    if(!codN||window._horometros[codN])continue;   // first-wins por orden de filas
    if(normCod(r['KVCOD']||'')!==codN)continue;      // misma validacion que el fetch viejo
    window._horometros[codN]={
      actual:r['ACTUAL']||null,
      proximo:r['PROXIMO']||null,
      patente:r['SERIE']||null,
      mes:r['MES']||'',rawCod:r['RAWCOD']||codN,
    };
  }
  // Espejo zaranda → trituradora en _horometros. La trituradora (TRT-01) no tiene
  // horómetro propio: corre las mismas horas que la zaranda (ZRN-01).
  if(window._horometros['ZRN01']&&!window._horometros['TRT01']){
    const zrn=window._horometros['ZRN01'];
    window._horometros['TRT01']={actual:zrn.actual,proximo:null,patente:null,mes:zrn.mes,rawCod:'TRT01'};
  }
  renderEquipoIndex();
}

/* ═══════════════════════════════════════════════════════
   GRÁFICO
═══════════════════════════════════════════════════════ */
// Lee una CSS var del :root al momento del llamado (devuelve fallback si no existe).
// Permite que los charts se vean correctos al tema actual sin tener que redibujarlos al cambiar.
const _cssVar=(name,fallback='#888')=>{
  const v=getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v||fallback;
};
let _eqComboChart=null;
// Mantenemos los nombres antiguos por compatibilidad pero apuntan al combo
let _eqChart=null;let _horasChart=null;

// Combo chart por equipo: barras de costo $ (eje izq) + línea de horas (eje der).
// Mismo diseño que el chart de flota para coherencia visual.
function renderEquipoCombo(chartId, codigo, horasPorMes){
  if(typeof Chart==='undefined')return;
  const el=document.getElementById(chartId);if(!el)return;
  if(_eqComboChart){_eqComboChart.destroy();_eqComboChart=null;}

  const AMBER =_cssVar('--amber','#ffa030');
  const ACCENT=_cssVar('--accent','#3a5fc8');
  const CORP  =_cssVar('--corp','#5d80e8');
  const TEXT2 =_cssVar('--text2','#aab3c8');
  const GRID  =_cssVar('--chart-grid','#1a2030');
  const TOOLTIP_BG=_cssVar('--chart-tooltip-bg','#0d1019');
  const TOOLTIP_FG=_cssVar('--chart-tooltip-fg','#f1f4fb');
  const nomMes=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  // Costos: usar _repuestosHistorial (preferido) o caer a _costosPorMes con meses fijos
  const codN=normCod(codigo);
  const hist=(window._repuestosHistorial||{})[codN];
  let costosByYm={};
  if(hist&&Object.keys(hist).length>0){
    costosByYm=hist;
  }else{
    const pm=window._costosPorMes||{};
    for(const m of MESES_ENTREGAS){
      const v=(pm[m.ym]||{})[codN]||0;
      if(v>0)costosByYm[m.ym]=v;
    }
  }
  // Horas: el caller pasa horasPorMes ya construido
  const horasByYm=horasPorMes||{};

  // Union de meses presentes en cualquier serie, ordenados (filtrando YMs inválidos)
  const _anioAct=new Date().getFullYear();
  const ymsAll=[...new Set([...Object.keys(costosByYm),...Object.keys(horasByYm)])]
    .filter(ym=>/^\d{4}-\d{2}$/.test(ym)&&+ym.slice(0,4)>=2020&&+ym.slice(0,4)<=_anioAct+1)
    .sort();
  if(!ymsAll.length)return;

  const labels=ymsAll.map(ym=>{const[y,mm]=ym.split('-');return`${nomMes[+mm-1]}'${y.slice(2)}`;});
  const dataCosto=ymsAll.map(ym=>Math.round(costosByYm[ym]||0));
  const dataHoras=ymsAll.map(ym=>Math.round((horasByYm[ym]||0)*10)/10);

  _eqComboChart=new Chart(el,{
    type:'bar',
    data:{
      labels,
      datasets:[
        {
          type:'bar',
          label:'Costo en repuestos',
          data:dataCosto,
          backgroundColor:AMBER+'cc',
          borderColor:AMBER,
          borderWidth:1,
          maxBarThickness:36,
          yAxisID:'yCosto',
          order:2,
        },
        {
          type:'line',
          label:'Horas en taller',
          data:dataHoras,
          borderColor:CORP,
          backgroundColor:CORP+'20',
          borderWidth:2.5,
          pointBackgroundColor:CORP,
          pointBorderColor:'#fff',
          pointBorderWidth:1.5,
          pointRadius:4,
          pointHoverRadius:6,
          fill:false,
          tension:0.35,
          yAxisID:'yHoras',
          order:1,
        }
      ]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:TOOLTIP_BG,titleColor:TOOLTIP_FG,bodyColor:TOOLTIP_FG,
          padding:10,borderColor:GRID,borderWidth:1,
          titleFont:{family:'JetBrains Mono',size:10,weight:'600'},
          bodyFont:{family:'Inter',size:11},
          bodySpacing:5,
          callbacks:{
            label:c=>{
              if(c.dataset.label==='Costo en repuestos')
                return c.raw>0?'  ▣ '+formatMoney(c.raw)+' en repuestos':'  ▣ sin gasto';
              if(c.dataset.label==='Horas en taller')
                return c.raw>0?'  ─ '+c.raw.toFixed(1)+' hr en taller':'  ─ sin horas';
              return c.raw;
            }
          }
        }
      },
      scales:{
        x:{
          ticks:{color:TEXT2,font:{size:10,family:'JetBrains Mono',weight:'500'},maxRotation:30},
          grid:{display:false},border:{color:GRID}
        },
        yCosto:{
          type:'linear',position:'left',beginAtZero:true,
          title:{display:true,text:'$',color:AMBER,font:{size:9,family:'JetBrains Mono',weight:'600'},padding:{bottom:6}},
          ticks:{color:AMBER,font:{size:9,family:'JetBrains Mono'},maxTicksLimit:5,
            callback:v=>v>=1e6?'$'+(v/1e6).toFixed(1)+'M':v>=1e3?'$'+(v/1e3).toFixed(0)+'K':'$'+v},
          grid:{color:GRID,drawTicks:false},border:{display:false}
        },
        yHoras:{
          type:'linear',position:'right',beginAtZero:true,
          title:{display:true,text:'hr',color:ACCENT,font:{size:9,family:'JetBrains Mono',weight:'600'},padding:{bottom:6}},
          ticks:{color:ACCENT,font:{size:9,family:'JetBrains Mono'},maxTicksLimit:5,callback:v=>v+' h'},
          grid:{display:false},border:{display:false}
        }
      }
    }
  });
}

/* ═══════════════════════════════════════════════════════
   UI — SECCIONES, FILTROS, VISTAS
═══════════════════════════════════════════════════════ */
function toggleSection(id){
  const content=document.getElementById(id);const label=content.previousElementSibling;
  const chev=label.querySelector('.section-chevron');const now=content.classList.toggle('collapsed');
  label.classList.toggle('collapsed',now);chev.textContent=now?'▸':'▾';
}

// Navegación por tabs (reemplaza los desplegables). Los KPIs quedan siempre fijos.
function setTab(id,t){
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id===id));
  document.querySelectorAll('#tabBar .tab-btn').forEach(b=>
    b.classList.toggle('active', b===t || b.dataset.arg===id));
  // Chart.js renderizado mientras el panel está oculto (display:none) colapsa a
  // 0px; al mostrar telemetría hay que reajustarlo.
  if(id==='tabTelemetria'&&_chartComboFlota){try{_chartComboFlota.resize();}catch(_){}}
  if(id==='tabReemplazo'){ renderReemplazo(); }
}

function toggleEqSec(uid){
  const body=document.getElementById('eqsec_'+uid);const chev=document.getElementById('echev_'+uid);
  if(!body||!chev)return;const hidden=body.style.display==='none';
  body.style.display=hidden?'':'none';chev.textContent=hidden?'▾':'▸';
}

let _secCounter=0;
function eqSection(title,content,open=true){
  const uid='sec'+(++_secCounter);
  // content y title pueden venir como RawHTML (de html``) o como string ya armado.
  // Los envolvemos en RawHTML si son strings que la app construyó, para no doble-escapar.
  const titleH = title instanceof RawHTML ? title : new RawHTML(String(title));
  const contH  = content instanceof RawHTML ? content : new RawHTML(String(content));
  return html`<div><div class="eq-sub-label" data-action="toggleEqSec" data-arg="${uid}"><span class="eq-chev" id="echev_${uid}">${open?'▾':'▸'}</span>${titleH}</div>
  <div id="eqsec_${uid}" class="eq-sec-body" ${open?new RawHTML(''):new RawHTML('style="display:none"')}>${contH}</div></div>`;
}

// FILTRO DE ESTADO
let _filtroEstado='todos';
let _filtroBtn=null;
function setFiltroEstado(est,btn){
  _filtroEstado=est;
  // Scope: limpiar .active solo en el bar de estado, no afectar al bar de categoría
  document.querySelectorAll('#filterBar .filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');_filtroBtn=btn;
  aplicarFiltros();
}

// FILTRO DE CATEGORÍA (tab de origen en la hoja de CÓDIGOS)
let _filtroCategoria='todas';
function setFiltroCategoria(cat,btn){
  _filtroCategoria=cat;
  document.querySelectorAll('#filterBarCat .filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  aplicarFiltros();
}

// FILTRO DE UBICACIÓN (lugar de trabajo / obra, viene de CÓDIGOS)
let _filtroUbicacion='todas';
// Normalización: trim + uppercase + sin tildes para deduplicar variantes
// ("Obra Tafí", "OBRA TAFI", "obra tafí") manteniendo la primera forma vista para mostrar
const normUbi=s=>String(s||'').trim().toUpperCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/\s+/g,' ');
function setFiltroUbicacion(ubi,btn){
  _filtroUbicacion=ubi;
  document.querySelectorAll('#filterBarUbi .filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  aplicarFiltros();
}

// FILTRO DE TENENCIA (propio / alquilado, viene de CÓDIGOS columna OBSERVACIÓN)
let _filtroTenencia='todas';
function setFiltroTenencia(ten,btn){
  _filtroTenencia=ten;
  document.querySelectorAll('#filterBarTen .filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  aplicarFiltros();
}

// BÚSQUEDA
let _searchQuery='';
function onSearch(val){
  _searchQuery=val.toLowerCase().trim();
  document.getElementById('searchClear').classList.toggle('visible',!!val);
  aplicarFiltros();
}
function clearSearch(){
  document.getElementById('equipoBuscador').value='';
  document.getElementById('searchClear').classList.remove('visible');
  _searchQuery='';aplicarFiltros();
}

function aplicarFiltros(){
  // Solo equipos activos: los inactivos no están en #equipoGrid ni cuentan acá.
  const eq=(window._equiposOrdenados||[]).filter(e=>!esEquipoInactivo(e.codigo));

  // ─── Pre-paso: validar selecciones de filtro contra el dataset absoluto.
  // Si la opción seleccionada no existe en los datos (recarga, dataset cambió),
  // resetear a 'todas' para evitar estados huérfanos. ───
  let sinUbiAbs=0;
  const ubiKeysAbs=new Set();
  let totalDescAbs=0;
  for(const e of eq){
    const info=(window._estadoEquipos||{})[normCod(e.codigo)]||{};
    const k=normUbi(info.ubicacion);
    if(!k)sinUbiAbs++; else ubiKeysAbs.add(k);
    if((info.tenencia||'desconocido')==='desconocido')totalDescAbs++;
  }
  if(_filtroUbicacion!=='todas'&&_filtroUbicacion!=='__sin__'&&!ubiKeysAbs.has(_filtroUbicacion)){
    _filtroUbicacion='todas';
  }
  if(_filtroUbicacion==='__sin__'&&sinUbiAbs===0){_filtroUbicacion='todas';}
  if(_filtroTenencia==='desconocido'&&totalDescAbs===0)_filtroTenencia='todas';

  // ─── Calcular flags de match por equipo (una sola pasada) ───
  const matches=eq.map(e=>{
    const info=(window._estadoEquipos||{})[normCod(e.codigo)]||{};
    const estKey=ESTADO_COLOR(info.estado);
    const estVal=estKey==='green'?'operativo':estKey==='amber'?'reparacion':estKey==='red'?'parado':'sin-estado';
    const catVal=info.categoria||'';
    const rawUbi=info.ubicacion||'';
    const ubiKey=normUbi(rawUbi);
    const tenVal=info.tenencia||'desconocido';
    const nom=(e.nombre||'').toLowerCase();
    const codStr=(e.codigo||'').toLowerCase();
    return{
      codigo:e.codigo, estVal, catVal, ubiKey, rawUbi, tenVal,
      mQ:!_searchQuery||codStr.includes(_searchQuery)||nom.includes(_searchQuery),
      mE:_filtroEstado==='todos'||estVal===_filtroEstado,
      mC:_filtroCategoria==='todas'||catVal===_filtroCategoria,
      mU:_filtroUbicacion==='todas'||(_filtroUbicacion==='__sin__'&&!ubiKey)||ubiKey===_filtroUbicacion,
      mT:_filtroTenencia==='todas'||tenVal===_filtroTenencia,
    };
  });
  const byCod={};for(const m of matches)byCod[m.codigo]=m;

  // ─── Aplicar visibilidad al DOM ───
  let totalVisible=0;
  document.querySelectorAll('#equipoGrid .equipo-card, #equipoGrid .equipo-list-row').forEach(el=>{
    const m=byCod[el.dataset.cod||''];
    const show=m&&m.mQ&&m.mE&&m.mC&&m.mU&&m.mT;
    el.classList.toggle('hidden',!show);
    if(show)totalVisible++;
  });

  // ─── Conteos faceteados: para cada barra X, contar los que cumplen TODOS
  // los filtros menos el de X. Así el número junto al botón muestra cuántos
  // equipos pasarían al seleccionarlo (manteniendo el resto de filtros). ───
  const cE={_total:0,operativo:0,reparacion:0,parado:0,'sin-estado':0};
  const cC={_total:0,viales:0,liviano:0,pesado:0,soporte:0};
  const cT={_total:0,propio:0,alquilado:0,desconocido:0};
  const ubiGrupos={};
  let sinUbiFacet=0;
  for(const m of matches){
    if(m.mQ&&m.mC&&m.mU&&m.mT){cE._total++;cE[m.estVal]=(cE[m.estVal]||0)+1;}
    if(m.mQ&&m.mE&&m.mU&&m.mT){cC._total++;if(cC.hasOwnProperty(m.catVal))cC[m.catVal]++;}
    if(m.mQ&&m.mE&&m.mC&&m.mT){
      if(!m.ubiKey)sinUbiFacet++;
      else{
        if(!ubiGrupos[m.ubiKey])ubiGrupos[m.ubiKey]={label:m.rawUbi.trim(),count:0};
        ubiGrupos[m.ubiKey].count++;
      }
    }
    if(m.mQ&&m.mE&&m.mC&&m.mU){cT._total++;cT[m.tenVal]=(cT[m.tenVal]||0)+1;}
  }
  // Asegurar que todas las ubicaciones del dataset aparezcan como botón,
  // aunque su conteo facetado sea 0 (para que el usuario pueda re-seleccionarlas).
  for(const k of ubiKeysAbs){
    if(!ubiGrupos[k]){
      const m=matches.find(x=>x.ubiKey===k);
      ubiGrupos[k]={label:(m?.rawUbi||k).trim(),count:0};
    }
  }
  const totalUbiFacet=Object.values(ubiGrupos).reduce((s,v)=>s+v.count,0)+sinUbiFacet;

  // ─── Actualizar contadores en el DOM ───
  const setN=(id,n)=>{const el=document.getElementById(id);if(el)el.textContent=n;};
  setN('fcTodos',cE._total);
  setN('fcOper',cE.operativo);
  setN('fcRep',cE.reparacion);
  setN('fcPar',cE.parado);
  setN('fcSin',cE['sin-estado']);
  setN('fcCatTodas',cC._total);
  setN('fcCatViales',cC.viales);
  setN('fcCatLiviano',cC.liviano);
  setN('fcCatPesado',cC.pesado);
  setN('fcCatSoporte',cC.soporte);
  setN('fcTenTodas',cT._total);
  setN('fcTenProp',cT.propio);
  setN('fcTenAlq',cT.alquilado);
  setN('fcTenDesc',cT.desconocido);
  const btnDesc=document.getElementById('btnTenDesc');
  if(btnDesc)btnDesc.style.display=totalDescAbs>0?'':'none';

  // ─── Barra de ubicación: regenerar para reflejar conteos faceteados.
  // Ordenar por conteo desc (las obras con más equipos primero). ───
  (function renderFiltroUbi(){
    const bar=document.getElementById('filterBarUbi');if(!bar)return;
    const ordenados=Object.entries(ubiGrupos).sort((a,b)=>b[1].count-a[1].count);
    // esc() ahora es global (helper de templating seguro definido al inicio del script).
    const btns=[
      html`<button class="filter-btn${_filtroUbicacion==='todas'?' active':''}" data-action="setFiltroUbicacion" data-arg="todas">Todas ubicaciones <span class="f-count">${totalUbiFacet}</span></button>`,
      ...ordenados.map(([k,v])=>
        html`<button class="filter-btn${_filtroUbicacion===k?' active':''}" data-action="setFiltroUbicacion" data-arg="${k}" title="${v.label}">${v.label} <span class="f-count">${v.count}</span></button>`
      ),
    ];
    if(sinUbiAbs>0){
      btns.push(html`<button class="filter-btn${_filtroUbicacion==='__sin__'?' active':''}" data-action="setFiltroUbicacion" data-arg="__sin__">Sin ubicación <span class="f-count">${sinUbiFacet}</span></button>`);
    }
    setHTML(bar, btns);
  })();

  // Total visible (todos los filtros aplicados)
  const cEq=document.getElementById('equipoCount');if(cEq)cEq.textContent=totalVisible+' equipos';

  // Si hay un detalle abierto: si la tarjeta activa quedó oculta por el filtro,
  // cerramos; si sigue visible, reubicamos el panel porque las filas cambiaron.
  if(_activeEqCard&&document.getElementById('equipoDetailPanel')?.classList.contains('open')){
    if(_activeEqCard.classList.contains('hidden'))closeEquipoDetail();
    else placeDetailPanelNearCard(_activeEqCard);
  }
}

/* ═══════════════════════════════════════════════════════
   SECCIÓN EQUIPOS INACTIVOS — desuso / no operativos
   Tabla read-only aparte de la grilla principal. Filtro propio
   que distingue "en desuso" de "no operativo".
═══════════════════════════════════════════════════════ */
let _filtroInactivo='todos';
function setFiltroInactivo(f,btn){
  _filtroInactivo=f;
  document.querySelectorAll('#filterBarInact .filter-btn').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  renderInactivos();
}
function renderInactivos(){
  const body=document.getElementById('inactivosBody');
  if(!body)return;
  // Si hay un detalle abierto dentro de esta sección, cerrarlo antes de re-render
  // (de lo contrario _activeEqCard quedaría apuntando a un nodo huérfano).
  if(_activeEqCard&&_activeEqCard.closest('#inactivosBody'))closeEquipoDetail();
  const CAT_LABEL={viales:'Viales/asfalto',liviano:'T. liviano',pesado:'T. pesado',soporte:'Soporte'};
  const inactivos=(window._equiposOrdenados||[])
    .filter(e=>esEquipoInactivo(e.codigo))
    .map(e=>{
      const info=(window._estadoEquipos||{})[normCod(e.codigo)]||{};
      const hor=(window._horometros||{})[normCod(e.codigo)];
      return{
        codigo:e.codigo,
        nombre:buildEquipoNombre(e.clasificacion||info.clasificacion,e.marca,e.modelo,e.nombre),
        categoria:e.categoria||info.categoria||'',
        estado:info.estado||'',
        subtipo:subtipoInactivo(info.estado),
        ubicacion:info.ubicacion||'',
        patente:hor?.patente||info.patente||'',
        costoTotal:e.costoTotal||0,
      };
    })
    .sort((a,b)=>a.codigo.localeCompare(b.codigo));

  const nDesuso=inactivos.filter(x=>x.subtipo==='desuso').length;
  const nNoOp  =inactivos.filter(x=>x.subtipo==='no-operativo').length;
  const nSinEst=inactivos.filter(x=>x.subtipo==='sin-estado').length;
  const setN=(id,n)=>{const el=document.getElementById(id);if(el)el.textContent=n;};
  setN('fcInactTodos',inactivos.length);
  setN('fcInactDesuso',nDesuso);
  setN('fcInactNoOp',nNoOp);
  setN('fcInactSinEst',nSinEst);
  const badge=document.getElementById('inactivosBadge');
  if(badge)badge.textContent=inactivos.length;

  const vis=inactivos.filter(x=>_filtroInactivo==='todos'||x.subtipo===_filtroInactivo);
  if(!vis.length){
    setHTML(body, html`<div class="no-data">Sin equipos inactivos${_filtroInactivo!=='todos'?' en este filtro':''}.</div>`);
    return;
  }
  // esc() es global (helper de templating seguro definido al inicio del script).
  // Recuadros con el mismo formato que la grilla principal de equipos.
  setHTML(body, html`<div class="equipo-grid">${vis.map(x=>{
    const est=ESTADO_COLOR(x.estado);
    const estLabel=x.subtipo==='sin-estado'?'Sin estado':(x.estado||'—');
    return html`<div class="equipo-card" id="eqcard_${x.codigo.replace(/[^a-z0-9]/gi,'_')}"
      data-cod="${x.codigo}" data-nom="${x.nombre}"
      data-action="toggleEquipoDetail" data-arg="${x.codigo}">
      <div class="eq-status-strip ${est}"></div>
      <div class="eq-code">${x.codigo}</div>
      <div class="eq-name">${x.nombre||'—'}</div>
      <div class="eq-meta">
        <span style="color:${ESTADO_CSS[est]}">${estLabel}</span>
        ${x.categoria?html`<span>${CAT_LABEL[x.categoria]||x.categoria}</span>`:''}
        ${x.patente?html`<span class="eq-patente" title="Patente">${x.patente}</span>`:''}
        ${x.ubicacion?html`<span>${x.ubicacion}</span>`:''}
        ${x.costoTotal>0?html`<span style="color:var(--amber)" title="Costo acumulado en repuestos">${formatMoney(x.costoTotal)}</span>`:''}
      </div>
    </div>`;
  })}</div>`);
}

// VISTA
let _viewMode='grid';
function setViewMode(mode){
  _viewMode=mode;
  document.getElementById('btnGrid').classList.toggle('active',mode==='grid');
  document.getElementById('btnList').classList.toggle('active',mode==='list');
  renderEquipoIndex();
}

// RENDER DEL ÍNDICE — incluye estado, patente, horómetro.
// Solo renderiza cards/lista; los contadores y la barra de ubicación los maneja
// aplicarFiltros() para que se recalculen facetados en cada cambio de filtro.
function renderEquipoIndex(equipos){
  if(equipos)window._equiposOrdenados=equipos;
  // La grilla principal muestra solo equipos activos. Los inactivos (desuso /
  // no operativos) se renderizan aparte en renderInactivos().
  const eq=(window._equiposOrdenados||[]).filter(e=>!esEquipoInactivo(e.codigo));
  const grid=document.getElementById('equipoGrid');if(!grid)return;

  // Si hay un detalle abierto, cerrarlo antes de reemplazar innerHTML.
  // De lo contrario _activeEqCard apuntaría a un nodo huérfano.
  if(_activeEqCard)closeEquipoDetail();

  const getPatente=cod=>{
    const hor=(window._horometros||{})[normCod(cod)];
    if(hor?.patente)return hor.patente;
    const info=(window._estadoEquipos||{})[normCod(cod)];
    return info?.patente||null;
  };

  if(_viewMode==='list'){
    grid.className='';
    setHTML(grid, eq.length?html`<div class="equipo-list-wrap">${eq.map(e=>{
      const info=(window._estadoEquipos||{})[normCod(e.codigo)];
      const hor=(window._horometros||{})[normCod(e.codigo)];
      const est=ESTADO_COLOR(info?.estado);const estCss=ESTADO_CSS[est];
      const patente=getPatente(e.codigo);
      const titulo=buildEquipoNombre(e.clasificacion,e.marca,e.modelo,e.nombre);
      const tienePend=(window._equiposConPendientes||new Set()).has(normCod(e.codigo));
      const ten=info?.tenencia;
      const tenLabel=info?.observacion||(ten==='propio'?'Propio':ten==='alquilado'?'Alquilado':'');
      const tenBadge=(ten==='propio'||ten==='alquilado')?html`<span class="eq-tenencia ${ten}" title="Tenencia: ${tenLabel}">${tenLabel}</span>`:'';
      const _dim = !(e.costoTotal>0) && !tienePend;
      const op=operatividadEquipo(normCod(e.codigo));
      return html`<div class="equipo-list-row${tienePend?' has-pending':''}${_dim?' dim':''}" id="eqcard_${e.codigo.replace(/[^a-z0-9]/gi,'_')}"
        data-cod="${e.codigo}" data-nom="${e.nombre}" data-est="${est==='green'?'operativo':est==='amber'?'reparacion':est==='red'?'parado':'sin-estado'}"
        title="${tienePend?'Tiene pedidos pendientes':''}"
        data-action="toggleEquipoDetail" data-arg="${e.codigo}">
        <span class="eq-list-dot" style="background:${estCss}" title="${info?.estado||'Sin estado'}"></span>
        <span class="eq-list-code">${e.codigo}</span>
        <span class="eq-list-name">${titulo}</span>
        <div class="eq-list-meta">
          ${tienePend?html`<span class="pending-dot" title="Pedidos pendientes"></span>`:''}
          ${op.nivel!=='sin-datos'?html`<span style="color:${op.color};font-weight:600" title="Operatividad de service · ${op.label}">● ${op.label}</span>`:''}
          ${tenBadge}
          ${patente?html`<span class="eq-patente">${patente}</span>`:''}
          ${info?.ubicacion?html`<span>${info.ubicacion}</span>`:''}
          ${e.costoTotal>0?html`<span style="color:var(--amber)">${formatMoney(e.costoTotal)}</span>`:''}
          ${hor?.actual?html`<span style="color:var(--blue)">${hor.actual}</span>`:''}
        </div>
      </div>`;
    })}</div>`:html`<div class="no-data">Sin equipos</div>`);
  }else{
    grid.className='equipo-grid';
    setHTML(grid, eq.length?eq.map(e=>{
      const info=(window._estadoEquipos||{})[normCod(e.codigo)];
      const hor=(window._horometros||{})[normCod(e.codigo)];
      const est=ESTADO_COLOR(info?.estado);
      const patente=getPatente(e.codigo);
      const titulo=buildEquipoNombre(e.clasificacion||info?.clasificacion||TIPO_EQUIPO(e.codigo),e.marca,e.modelo,e.nombre);
      const tienePend=(window._equiposConPendientes||new Set()).has(normCod(e.codigo));
      const ten=info?.tenencia;
      const tenLabel=info?.observacion||(ten==='propio'?'Propio':ten==='alquilado'?'Alquilado':'');
      const tenBadge=(ten==='propio'||ten==='alquilado')?html`<span class="eq-tenencia ${ten}" title="Tenencia: ${tenLabel}">${tenLabel}</span>`:'';
      const _dim = !(e.costoTotal>0) && !tienePend;
      const op=operatividadEquipo(normCod(e.codigo));
      return html`<div class="equipo-card${tienePend?' has-pending':''}${_dim?' dim':''}" id="eqcard_${e.codigo.replace(/[^a-z0-9]/gi,'_')}"
        data-cod="${e.codigo}" data-nom="${e.nombre}" data-est="${est==='green'?'operativo':est==='amber'?'reparacion':est==='red'?'parado':'sin-estado'}"
        title="${tienePend?'Tiene pedidos pendientes':''}"
        data-action="toggleEquipoDetail" data-arg="${e.codigo}">
        <div class="eq-status-strip ${est}"></div>
        <div class="eq-code">${e.codigo}</div>
        <div class="eq-name">${titulo}</div>
        <div class="eq-meta">
          ${op.nivel!=='sin-datos'?html`<span style="color:${op.color};font-weight:600" title="Operatividad de service · ${op.label}">● ${op.label}</span>`:''}
          ${tenBadge}
          ${patente?html`<span class="eq-patente" title="Patente">${patente}</span>`:''}
          ${info?.estado?html`<span style="color:${ESTADO_CSS[est]}">${info.estado}</span>`:''}
          ${e.costoTotal>0?html`<span style="color:var(--amber)">${formatMoney(e.costoTotal)}</span>`:''}
          ${hor?.actual?html`<span style="color:var(--blue)" title="Horómetro actual">${hor.actual}</span>`:''}
        </div>
      </div>`;
    }):html`<div class="no-data">Sin equipos</div>`);
  }
  aplicarFiltros();
}

/* ═══════════════════════════════════════════════════════
   CARGA PRINCIPAL
═══════════════════════════════════════════════════════ */
function setLoadProgress(pct){
  const bar=document.getElementById('loadBar');const fill=document.getElementById('loadBarFill');
  if(pct===0){bar.style.display='block';fill.style.width='0';}
  else if(pct>=100){setTimeout(()=>{bar.style.display='none';fill.style.width='0';},400);}
  fill.style.width=pct+'%';
}

async function loadAll(){
  // Si ya hay datos cargados, este es un refresh manual (click en "sync") y
  // no el initial load. Cuando USE_API está activo, eso fuerza un refresh
  // server-side (corre los consolidadores e invalida cache server) antes
  // de re-fetchear los endpoints.
  const esManualRefresh = !!window._estadoEquipos;
  const btn=document.getElementById('refreshBtn');
  btn.classList.add('loading');btn.textContent='↻ cargando...';
  document.getElementById('loadingState').style.display='block';
  document.getElementById('dashboard').style.display='none';
  document.getElementById('errorState').style.display='none';
  setLoadProgress(0);

  try{
    if (esManualRefresh) await apiRefreshAll();
    setLoadProgress(15);
    // Carga primaria: TODO lo necesario para el primer render.
    // PANEL_REPUESTOS pasa a ser fuente única de entregas (reemplaza MESES_ENTREGAS).
    // PANEL_TRABAJOS se carga acá también para alimentar telemetría de flota (rankings + chart de horas).
    const[pendientesRaw,entregadosRaw,codV,codL,codP,codS,panelRepuestosLiveObj,panelRepuestosHistObj,panelTrabajosLiveObj,panelTrabajosHistObj,serviceFrecRows,serviceTrimRows,trim1Rows,trim2Rows,panelProgramaObj,combustibleObj,combLivianosRows]=await Promise.all([
      fetchGvizRaw(SHEET_IDS.pedidos,'PENDIENTES'),
      // ENTREGADOS tiene título y contadores en filas 1-10; headers reales en fila 11.
      // El range fuerza a gviz a usar la fila 11 como header (sin esto, los nombres se pierden).
      fetchGvizObj(SHEET_IDS.pedidos,'ENTREGADOS','A11:H').catch(()=>[]),
      fetchGvizRaw(SHEET_IDS.codigos,'VIALES, ASFALTO Y TRITURACIÓN').catch(()=>[]),
      fetchGvizRaw(SHEET_IDS.codigos,'TRANSPORTE LIVIANO').catch(()=>[]),
      fetchGvizRaw(SHEET_IDS.codigos,'TRANSPORTE PESADO').catch(()=>[]),
      fetchGvizRaw(SHEET_IDS.codigos,'SOPORTE').catch(()=>[]),
      // Repuestos LIVE (2026 diario) + HIST (2024-2025 + 2026 parcial, cambia cada tanto).
      // Filtramos abajo: live → fecha>=2026, hist → fecha en 2025.
      fetchGvizObj(SHEET_IDS.repuestos_hist,'PANEL_REPUESTOS').catch(()=>[]),
      fetchGvizObj(SHEET_IDS.repuestos_hist_old,'PANEL_REPUESTOS').catch(()=>[]),
      // Trabajos LIVE (2026 diario) + HIST (2024-2026, cambia cada tanto).
      // Mismo filtrado por año.
      fetchGvizObj(SHEET_IDS.trabajos_reg,'PANEL_TRABAJOS').catch(()=>[]),
      fetchGvizObj(SHEET_IDS.trabajos_hist,'PANEL_TRABAJOS').catch(()=>[]),
      // PROGRAMA DE TRABAJOS DE SERVICE 2026: rangos de operatividad + trimestre vigente.
      fetchGvizRaw(SHEET_IDS.programaService,SERVICE_FREC_SHEET).catch(()=>[]),
      fetchGvizRaw(SHEET_IDS.programaService,SERVICE_TRIM_SHEET).catch(()=>[]),
      // Ambos trimestres del PROGRAMA + PANEL_PROGRAMA del sheet de service:
      // services planificados/realizados que cruzamos con TRABAJOS REALIZADOS.
      fetchGvizRaw(SHEET_IDS.programaService,'1° TRIMESTRE').catch(()=>[]),
      fetchGvizRaw(SHEET_IDS.programaService,'2° TRIMESTRE').catch(()=>[]),
      fetchGvizObj(SHEET_IDS.service,'PANEL_PROGRAMA').catch(()=>[]),
      fetchGvizObj(SHEET_IDS.combustible,COMBUSTIBLE_SHEET).catch(()=>[]),
      // Combustible de livianos (Excel "Control General"); se procesa abajo.
      fetchGvizRaw(SHEET_IDS.combustibleLivianos,COMBUSTIBLE_LIVIANOS_SHEET).catch(()=>[]),
    ]);
    setLoadProgress(55);

    // Combinar LIVE + HIST con filtro por año: del live tomamos >=2026, del hist
    // tomamos solo 2025. Así evitamos duplicación (el hist también tiene 2026
    // parcial) y cubrimos "desde 2025 en adelante" como pidió Marcos.
    const _SIN_FECHA_TRAB=['FECHA TRABAJO','FECHA DE TRABAJO','FECHA'];
    const _SIN_FECHA_REP =['FECHA','FECHA ENTREGA','FECHA DE ENTREGA'];
    const _filtrarAnio=(rows,predicate,sinFecha)=>{
      const out=[];
      for(const r of (rows||[])){
        const idx={};
        for(const k of Object.keys(r))idx[normHead(k)]=r[k];
        const get=keys=>{for(const k of keys){const v=idx[k];if(v!=null&&String(v).trim()!=='')return String(v).trim();}return'';};
        const d=_parseDate(get(sinFecha));
        if(d&&predicate(d.getFullYear()))out.push(r);
      }
      return out;
    };
    // PANEL_TRABAJOS del HIST suele estar truncado a 2026 (lo trunca el script
    // consolidador del Drive). Para reconstruir el 2025 (y completar 2026 con
    // trabajos que están en las pestañas pero no en el archivo mensual del
    // Drive), leemos las pestañas POR EQUIPO del HIST y deduplicamos contra
    // el LIVE por (cod, fecha-normalizada, tiempo). El LIVE 2026 gana — solo
    // sumamos del HIST las filas que no aparecen ya en LIVE.
    // Filtro simple por año: LIVE para 2026 (al día), HIST pestañas por equipo
    // solo para 2025 (el LIVE no tiene histórico). Sin dedup compleja porque
    // las descripciones entre LIVE (consolidador) y pestañas (carga manual por
    // equipo) difieren con frecuencia → cualquier dedup por texto generaría
    // falsos positivos o falsos negativos. Trade-off aceptado: las ~700 hr de
    // 2026 que están solo en pestañas por equipo (cargas manuales sin pasar por
    // la planilla mensual del Drive) no aparecen en el panel.
    const panelTrabajosHist2025 = await fetchTrabajosHistPorEquipo(y=>y===2025);
    const panelTrabajosObj=[
      ..._filtrarAnio(panelTrabajosLiveObj,y=>y>=2026,_SIN_FECHA_TRAB),
      ..._filtrarAnio(panelTrabajosHistObj,y=>y===2025,_SIN_FECHA_TRAB),
      ...panelTrabajosHist2025,
    ];
    // El sheet HIST repuestos (1WCtB) tiene un header roto en col 0: aparece
    // como "#ERROR!" en lugar de "N° ENTREGA". Renombramos la key antes del
    // procesamiento para que _pickCol(['N° ENTREGA']) la encuentre y las
    // entregas se cuenten en entregaCostos.
    const _renormHistRep = rows => rows.map(r => {
      const o = {};
      for (const k of Object.keys(r)) {
        const nk = (k === '#ERROR!' || k === '#VALUE!' || k === '') ? 'N° ENTREGA' : k;
        o[nk] = r[k];
      }
      return o;
    });
    const panelRepuestosObj=[
      ..._filtrarAnio(panelRepuestosLiveObj,y=>y>=2026,_SIN_FECHA_REP),
      ..._filtrarAnio(_renormHistRep(panelRepuestosHistObj),y=>y===2025,_SIN_FECHA_REP),
    ];

    // Procesar PANEL_REPUESTOS: produce todos los derivados de una sola pasada
    const ctx=procesarPanelRepuestos(panelRepuestosObj);
    window._entregaCostos     = ctx.entregaCostos;
    window._itemsPorEntrega   = ctx.itemsPorEntrega;
    window._costosPorMes      = ctx.costosPorMes;
    window._costosCorrPorMes  = ctx.costosCorrPorMes;
    window._repuestosHistorial= ctx.repuestosHistorial;
    window._entregasPorEquipo = ctx.entregasPorEquipo;

    // Procesar PANEL_TRABAJOS para telemetría de flota (horas por equipo, por mes).
    // Cacheamos el raw para que loadTrabajosRegistro (modal de equipo) no re-descargue.
    window._panelTrabajosRaw = panelTrabajosObj;
    const tctx=procesarPanelTrabajos(panelTrabajosObj);
    window._horasPorEquipo  = tctx.horasPorEquipo;
    window._horasPorMesFlota= tctx.horasPorMesFlota;
    window._panelTrabajosTotal = tctx.totalFilas;
    window._horasFlota         = tctx.horasFlota;
    window._horasPrevPorMes    = tctx.horasPrevPorMes;
    window._horasCorrPorMes    = tctx.horasCorrPorMes;
    window._horasPrevPorEquipo = tctx.horasPrevPorEquipo;
    window._horasCorrPorEquipo = tctx.horasCorrPorEquipo;
    window._horasPorMesYEquipo = tctx.horasPorMesYEquipo;
    window._horasCorrPorMesYEquipo  = tctx.horasCorrPorMesYEquipo;

    // Procesar SERVICES PLANIFICADOS y cruzar con PANEL_TRABAJOS.
    // Suma al preventivo horas estimadas de los services que el planning dice
    // que se hicieron pero no quedaron cargados en TRABAJOS REALIZADOS.
    window._servicesPlanning = procesarServicesPlanning(trim1Rows,trim2Rows,panelProgramaObj);
    const sctx = cruzarServicesEnTrabajos(panelTrabajosObj,window._servicesPlanning);
    window._serviceCumplimiento = sctx.cumplimiento;
    window._serviceFechasMatch  = sctx.serviceFechasMatch;
    window._serviceMedianas     = sctx.medianas;
    if(sctx.horasAgregadasFlota>0){
      window._horasFlota.prev += sctx.horasAgregadasFlota;
      window._horasFlota.total+= sctx.horasAgregadasFlota;
      for(const k of Object.keys(sctx.horasAgregadasPorEquipo)){
        window._horasPorEquipo[k]=(window._horasPorEquipo[k]||0)+sctx.horasAgregadasPorEquipo[k];
        window._horasPrevPorEquipo[k]=(window._horasPrevPorEquipo[k]||0)+sctx.horasAgregadasPorEquipo[k];
      }
      for(const ym of Object.keys(sctx.horasAgregadasPorMes)){
        window._horasPorMesFlota[ym]=(window._horasPorMesFlota[ym]||0)+sctx.horasAgregadasPorMes[ym];
        window._horasPrevPorMes[ym]=(window._horasPrevPorMes[ym]||0)+sctx.horasAgregadasPorMes[ym];
      }
      for(const ym of Object.keys(sctx.horasAgregadasPorMesYEquipo||{})){
        window._horasPorMesYEquipo[ym]=window._horasPorMesYEquipo[ym]||{};
        for(const k of Object.keys(sctx.horasAgregadasPorMesYEquipo[ym])){
          window._horasPorMesYEquipo[ym][k]=(window._horasPorMesYEquipo[ym][k]||0)+sctx.horasAgregadasPorMesYEquipo[ym][k];
        }
      }
    }

    // Estado de service por equipo (alimenta KPI y modal). Fuente: hoja
    // OPERATIVIDAD de SERVICES DE EQUIPOS (ya trae ESTADO pre-calculado:
    // VENCIDO/CRÍTICO/INTERMEDIO/HOLGADO), volcada a SVC_PANELPROG por el builder.
    window._servicePanel = procesarPanelPrograma(panelProgramaObj);

    // Procesar ENTREGA DE COMBUSTIBLE: por equipo, última hr/km + consumo promedio + historial.
    // No requiere Apps Script — la pestaña ya es plana (una fila = una carga).
    window._combustiblePorEquipo = procesarCombustible(combustibleObj);

    window._pedidosEntregados=entregadosRaw.filter(p=>(p['N° PEDIDO']||p['N° ENTREGA']||'').trim()!=='');
    // Catálogo maestro: única fuente de equipos = 4 tabs de la hoja de CÓDIGOS
    window._estadoEquipos={
      ...parseCodigos(codV,'viales'),
      ...parseCodigos(codL,'liviano'),
      ...parseCodigos(codP,'pesado'),
      ...parseCodigos(codS,'soporte'),
    };

    // Combustible de livianos: matchea por patente al código de equipo y fusiona
    // en _combustiblePorEquipo (así detalle, consumo y operatividad lo toman igual).
    {
      const patenteToCarN={};
      for(const [codN,info] of Object.entries(window._estadoEquipos)){
        const p=normPat(info.patente);
        if(p)patenteToCarN[p]=codN;
      }
      const liv=procesarCombustibleLivianos(combLivianosRows,patenteToCarN);
      window._gastoCombLivianos=liv.gastoTotal;
      window._gastoCombLivianosPorMes=liv.gastoPorMes;
      window._cargasCombLivianosPorMes=liv.cargasPorMes;
      for(const codN of Object.keys(liv.porEquipo)){
        const e=liv.porEquipo[codN];
        const ex=window._combustiblePorEquipo[codN];
        if(!ex){ window._combustiblePorEquipo[codN]=e; continue; }
        // Colisión (raro): fusionar cargas y recomputar última lectura.
        ex.cargas=(ex.cargas||[]).concat(e.cargas).sort((a,b)=>a.fechaSort-b.fechaSort);
        ex.totalLitros=(ex.totalLitros||0)+e.totalLitros;
        ex.totalCosto=(ex.totalCosto||0)+e.totalCosto;
        for(let i=ex.cargas.length-1;i>=0;i--){
          if(ex.cargas[i].hr!=null){ex.ultimaHr=ex.cargas[i].hr;ex.ultimaFecha=ex.cargas[i].fecha;ex.ultimaFechaSort=ex.cargas[i].fechaSort;break;}
        }
      }
    }

    // Espejo de horas zaranda → trituradora. La trituradora (TRT-01) no tiene
    // horómetro propio: comparte tren de chancado con la zaranda (ZRN-01) y corre
    // las mismas horas. Copiamos la última lectura de la zaranda a la trituradora,
    // así se actualiza sola en cada carga de combustible de la zaranda. No tocamos
    // litros/costo de la trituradora (consume su propio gasoil) ni el promedio
    // (su L/hr no es medible con un horómetro muerto).
    {
      const zrn=window._combustiblePorEquipo['ZRN01'];
      if(zrn&&zrn.ultimaHr!=null){
        let trt=window._combustiblePorEquipo['TRT01'];
        if(!trt){ trt={unidad:'hr',cargas:[],ultimaHr:null,ultimaFecha:null,ultimaFechaSort:null,totalLitros:0,promedio:null}; window._combustiblePorEquipo['TRT01']=trt; }
        trt.ultimaHr=zrn.ultimaHr;
        trt.ultimaFecha=zrn.ultimaFecha;
        trt.ultimaFechaSort=zrn.ultimaFechaSort;
        trt.horasEspejoDe='ZRN-01';
      }
    }

    // Render dashboard con entregas del mes actual (calculadas desde PANEL_REPUESTOS)
    renderDashboard(pendientesRaw,ctx.entregasMesActual);

    // Adjuntar costoTotal acumulado a cada equipo del catálogo (todos los meses)
    for(const eq of(window._equiposOrdenados||[])){
      const codN=normCod(eq.codigo);
      let total=0;
      for(const ym of Object.keys(ctx.costosPorMes||{})){
        total+=(ctx.costosPorMes[ym]||{})[codN]||0;
      }
      eq.costoTotal=total;
    }
    renderEquipoIndex();
    renderInactivos();

    // Barra de selección de rango de meses para los KPIs sensibles a tiempo
    // (costo, horas, combustible). Default = mes actual. Si el usuario ya había
    // cambiado el rango antes (refresh manual), respetar la selección.
    if(!Array.isArray(window._kpiMesesSel))window._kpiMesesSel=_ymsEnRango('mesActual');
    renderKpiRangeBar();
    _actualizarKpisDeRango();

    // Telemetría de flota y pedidos pendientes global — agregados que cruzan todo
    renderTelemetriaFlota();
    renderPedidosPendientesGlobal();

    const _hsl=document.getElementById('hsLast');
    if(_hsl)_hsl.textContent=fmtHora();
    document.getElementById('loadingState').style.display='none';
    document.getElementById('dashboard').style.display='block';
    setLoadProgress(80);

    setLoadProgress(100);

    // Tab costos downtime: lee el sheet COSTOS DOWNTIME (parámetros editables)
    // y renderiza. Fuera del flujo principal a propósito — si el sheet no está
    // accesible, el resto del panel no se entera.
    cargarCostosDowntime();

    precargarHorometros();
  }catch(e){
    document.getElementById('loadingState').style.display='none';
    document.getElementById('errorState').style.display='block';
    setHTML(document.getElementById('errorState'), html`<div style="color:var(--red);margin-bottom:8px">⚠ Error al cargar datos</div><div style="font-size:12px;color:var(--text3)">${e.message}</div><div style="margin-top:12px"><button data-action="loadAll" class="refresh-btn">Reintentar</button></div>`);
    setLoadProgress(100);
  }
  btn.classList.remove('loading');btn.textContent='↻ actualizar';
}

/* ═══════════════════════════════════════════════════════
   RANGO DE MESES PARA LOS KPIs (costo, horas, combustible)
═══════════════════════════════════════════════════════ */
// Devuelve la lista de años (4 dígitos) presentes en los datos con dato>0.
function _yearsDisponibles(){
  const yms=new Set([
    ...Object.keys(window._costosPorMes||{}),
    ...Object.keys(window._horasPorMesFlota||{}),
    ...Object.keys(window._gastoCombLivianosPorMes||{}),
  ]);
  // Filtrar años válidos (4 dígitos, entre 2020 y año actual + 1). Si una fila
  // de datos vino con fecha mal formateada (ej. "01/02/205"), el ym derivado
  // sería "205-02" y se filtra acá para no mostrar un botón inválido.
  const anioAct=new Date().getFullYear();
  return [...new Set([...yms].map(ym=>ym.slice(0,4)))]
    .filter(y=>/^\d{4}$/.test(y)&&+y>=2020&&+y<=anioAct+1)
    .sort();
}
// Devuelve los YMs (formato "YYYY-MM") correspondientes al rango pedido.
function _ymsEnRango(key){
  const todos=[...new Set([
    ...Object.keys(window._costosPorMes||{}),
    ...Object.keys(window._horasPorMesFlota||{}),
    ...Object.keys(window._gastoCombLivianosPorMes||{}),
  ])].sort();
  const now=new Date();
  const fmtYm=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  if(key==='mesActual'){
    // "mes" = mes actual SI ya tiene datos; si no (típico a principio de mes, o
    // meses todavía sin carga), caemos al mes MÁS RECIENTE con datos. Antes
    // devolvíamos el mes actual a secas → al arrancar junio los 3 KPIs sensibles
    // a tiempo quedaban en "—" (junio sin datos aún) y el panel parecía roto. El
    // label se deriva del ym devuelto, así que el subtítulo refleja el mes real.
    const cur=fmtYm(now);
    const validos=todos.filter(ym=>/^\d{4}-\d{2}$/.test(ym)&&+ym.slice(0,4)>=2020&&+ym.slice(0,4)<=now.getFullYear()+1);
    if(validos.includes(cur))return [cur];
    const previos=validos.filter(ym=>ym<=cur);
    if(previos.length)return [previos[previos.length-1]];
    return [validos.length?validos[validos.length-1]:cur];
  }
  if(key==='ult3'){
    const out=[];
    for(let i=0;i<3;i++)out.push(fmtYm(new Date(now.getFullYear(),now.getMonth()-i,1)));
    return out;
  }
  if(key==='ult6'){
    const out=[];
    for(let i=0;i<6;i++)out.push(fmtYm(new Date(now.getFullYear(),now.getMonth()-i,1)));
    return out;
  }
  if(/^\d{4}$/.test(key))return todos.filter(ym=>ym.startsWith(key+'-'));
  if(key==='todo')return todos;
  return [fmtYm(now)];
}
// Meses (YYYY-MM) con datos en algún KPI sensible a tiempo, ordenados.
function _mesesDisponibles(){
  return [...new Set([
    ...Object.keys(window._costosPorMes||{}),
    ...Object.keys(window._horasPorMesFlota||{}),
    ...Object.keys(window._gastoCombLivianosPorMes||{}),
    ...Object.keys(window._litrosCombPesadosPorMes||{}),
  ])].filter(ym=>/^\d{4}-\d{2}$/.test(ym)).sort();
}
// Meses seleccionados para los KPIs. Default = mes actual (o el más reciente con datos).
function _kpiYms(){
  const s=window._kpiMesesSel;
  if(Array.isArray(s)&&s.length)return s;
  return _ymsEnRango('mesActual');
}
// "2026-06" → "Jun'26"
function _ymCorto(ym){
  const M=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const p=String(ym||'').split('-');
  if(p.length<2)return String(ym||'');
  return (M[+p[1]-1]||'?')+"'"+p[0].slice(2);
}
// Label legible de la selección activa (1 mes, rango contiguo, o "N meses").
function _kpiLabel(){
  const yms=[..._kpiYms()].sort();
  if(!yms.length)return 'sin meses';
  if(yms.length===1)return ymLabel(yms[0]);
  const idx=ym=>{const[a,m]=ym.split('-');return +a*12+(+m-1);};
  const contiguo=yms.every((ym,i)=>i===0||idx(ym)-idx(yms[i-1])===1);
  return contiguo?`${ymLabel(yms[0])} – ${ymLabel(yms[yms.length-1])}`:`${yms.length} meses`;
}
// Suma valores por YM (acepta map ym→número o ym→objeto).
function _sumarPorMes(map,yms){
  let s=0;
  for(const ym of yms){
    const v=(map||{})[ym];
    if(v==null)continue;
    if(typeof v==='number')s+=v;
    else if(typeof v==='object')s+=Object.values(v).reduce((a,b)=>a+(b||0),0);
  }
  return s;
}
function renderKpiRangeBar(){
  const bar=document.getElementById('kpiRangeBar');
  if(!bar)return;
  const sel=new Set(_kpiYms());
  const meses=_mesesDisponibles();
  const now=new Date();
  const fmtYm=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const ult=n=>{const o=[];for(let i=0;i<n;i++)o.push(fmtYm(new Date(now.getFullYear(),now.getMonth()-i,1)));return o.filter(ym=>meses.includes(ym));};
  // Atajos: fijan la selección. Chips: togglean un mes (multi-selección).
  const fill=(label,yms)=>html`<button class="kpi-range-btn" data-action="setKpiMeses" data-arg="${yms.join(',')}">${label}</button>`;
  const chip=ym=>html`<button class="kpi-range-btn kpi-mes-chip${sel.has(ym)?' active':''}" data-action="toggleKpiMes" data-arg="${ym}">${_ymCorto(ym)}</button>`;
  const atajos=[fill('mes',_ymsEnRango('mesActual')),fill('últ 3m',ult(3)),fill('últ 6m',ult(6)),fill('todo',meses)];
  setHTML(bar, html`<span class="lbl">meses ›</span>${atajos}<span class="kpi-range-sep"></span>${meses.map(chip)}`);
}
// Fija la selección de meses (reemplaza la actual). Acepta array o string "ym,ym".
function setKpiMeses(yms){
  const arr=Array.isArray(yms)?yms:String(yms||'').split(',');
  window._kpiMesesSel=[...new Set(arr.filter(Boolean))].sort();
  renderKpiRangeBar();
  _actualizarKpisDeRango();
}
// Agrega/quita un mes de la selección.
function toggleKpiMes(ym){
  const sel=new Set(_kpiYms());
  if(sel.has(ym))sel.delete(ym); else sel.add(ym);
  setKpiMeses([...sel]);
}
// Recalcula y re-renderea los 3 KPIs sensibles a tiempo (costo, horas, combustible).
function _actualizarKpisDeRango(){
  const yms=_kpiYms();
  const labelRango=_kpiLabel();
  // --- Costo en repuestos ---
  const costo=_sumarPorMes(window._costosPorMes||{},yms);
  const entregaCostos=window._entregaCostos||{};
  const ymsSet=new Set(yms);
  // entregaCostos[nro].mes viene como "Ene 2026" (label), no YM. Convertimos.
  const _MES_MAP={ene:'01',feb:'02',mar:'03',abr:'04',may:'05',jun:'06',jul:'07',ago:'08',sep:'09',oct:'10',nov:'11',dic:'12'};
  const _mesLabelToYm=label=>{
    const m=String(label||'').toLowerCase().match(/([a-z]{3})\s*(\d{4})/);
    if(!m)return'';
    const mm=_MES_MAP[m[1]];
    return mm?`${m[2]}-${mm}`:'';
  };
  let entConCosto=0;
  for(const nro of Object.keys(entregaCostos)){
    const e=entregaCostos[nro];
    if(e&&e.costo>0&&ymsSet.has(_mesLabelToYm(e.mes)))entConCosto++;
  }
  const cardC=document.getElementById('kpiCostoCard');
  const valC=document.getElementById('kpiCostoVal');
  const subC=document.getElementById('kpiCostoSub');
  if(valC)valC.textContent=costo>0?formatMoney(costo):'—';
  if(subC)subC.textContent=`${labelRango} · ${fmtInt(entConCosto)} entregas con costo`;
  if(cardC){cardC.classList.toggle('kpi-empty',!(costo>0));cardC.classList.toggle('kpi-clickable',costo>0);}
  // --- Horas en taller ---
  const horasTotal=_sumarPorMes(window._horasPorMesFlota||{},yms);
  const horasCorr=_sumarPorMes(window._horasCorrPorMes||{},yms);
  const horasPrev=_sumarPorMes(window._horasPrevPorMes||{},yms);
  const corrPct=horasTotal>0?Math.round(horasCorr/horasTotal*100):0;
  const prevPct=horasTotal>0?100-corrPct:0;
  const cardH=document.getElementById('kpiHorasCard');
  const valH=document.getElementById('kpiHorasVal');
  const subH=document.getElementById('kpiHorasSub');
  if(valH)valH.textContent=horasTotal>0?fmtInt(Math.round(horasTotal))+' hr':'—';
  if(subH){
    if(horasTotal>0){
      subH.classList.add('hr-split');
      setHTML(subH, new RawHTML(`<div class="hr-split-bar"><span class="corr" style="width:${corrPct}%"></span><span class="prev" style="width:${prevPct}%"></span></div><span class="hr-split-leg"><i class="corr"></i>${fmtInt(Math.round(horasCorr))} hr correctivo · ${corrPct}%</span><span class="hr-split-leg"><i class="prev"></i>${fmtInt(Math.round(horasPrev))} hr preventivo · ${prevPct}%</span>`));
    }else{
      subH.classList.remove('hr-split');
      subH.textContent=`${labelRango} · sin horas registradas`;
    }
  }
  if(cardH){cardH.classList.toggle('kpi-empty',!(horasTotal>0));cardH.classList.toggle('kpi-clickable',horasTotal>0);}
  // --- Combustible livianos ---
  const gastoComb=_sumarPorMes(window._gastoCombLivianosPorMes||{},yms);
  const cargasComb=_sumarPorMes(window._cargasCombLivianosPorMes||{},yms);
  const cardG=document.getElementById('kpiCombCard');
  const valG=document.getElementById('kpiCombVal');
  const subG=document.getElementById('kpiCombSub');
  if(valG)valG.textContent=gastoComb>0?formatMoney(gastoComb):'—';
  if(subG)subG.textContent=gastoComb>0?`${fmtInt(cargasComb)} cargas · ${labelRango}`:'sin cargas en el rango';
  if(cardG){cardG.classList.toggle('kpi-empty',!(gastoComb>0));cardG.classList.toggle('kpi-clickable',gastoComb>0);}
  // --- Combustible pesados (litros; la fuente Casares no trae costo) ---
  const litrosPes=_sumarPorMes(window._litrosCombPesadosPorMes||{},yms);
  const cargasPes=_sumarPorMes(window._cargasCombPesadosPorMes||{},yms);
  const cardP=document.getElementById('kpiCombPesCard');
  const valP=document.getElementById('kpiCombPesVal');
  const subP=document.getElementById('kpiCombPesSub');
  if(valP)valP.textContent=litrosPes>0?fmtInt(Math.round(litrosPes))+' L':'—';
  if(subP)subP.textContent=litrosPes>0?`${fmtInt(cargasPes)} cargas · ${labelRango}`:'sin cargas en el rango';
  if(cardP)cardP.classList.toggle('kpi-empty',!(litrosPes>0));
}

/* ═══════════════════════════════════════════════════════
   RENDER PRINCIPAL
═══════════════════════════════════════════════════════ */
function renderDashboard(pendientesRaw,entregasMesParsed){
  // Pedidos
  const todosLosPedidos=pendientesRaw
    .filter(r=>r[0]&&!isNaN(parseFloat(r[0]))&&r[2]&&r[5])
    .map(r=>({nro:r[0],fecha:r[1],equipo:r[2],codigo:normCod(r[3]),codigoRaw:r[3]||'—',desc:r[4],estado:r[5]}));
  const pendActivos=todosLosPedidos.filter(p=>{const l=p.estado.toLowerCase();return l.includes('pendiente')||l.includes('parcial')||l.includes('comprado');}).length;
  window._pedidosAll=todosLosPedidos;

  // Set de códigos (normalizados) con AL MENOS un pedido activo — para marcar visualmente las cards
  window._equiposConPendientes=new Set(
    todosLosPedidos
      .filter(p=>{const l=p.estado.toLowerCase();return l.includes('pendiente')||l.includes('parcial')||l.includes('comprado');})
      .map(p=>p.codigo)
      .filter(Boolean)
  );

  // Lookup {N° PEDIDO → fecha de creación} desde PENDIENTES.
  // La hoja ENTREGADOS no carga FECHA PEDIDO; para calcular demora hay que cruzar por N°.
  // Si un N° aparece duplicado, conservamos la fecha más antigua (primer ingreso).
  window._fechaPedidoByNro={};
  for(const p of todosLosPedidos){
    const nro=String(p.nro||'').trim();
    if(!nro||!p.fecha)continue;
    const prev=window._fechaPedidoByNro[nro];
    if(!prev||toSortDate(p.fecha)<toSortDate(prev)){
      window._fechaPedidoByNro[nro]=p.fecha;
    }
  }

  // Entregas del mes actual (parser de formulario)
  const entregas=(entregasMesParsed||[]).filter(e=>e.equipo&&e.equipo.trim());
  entregas.sort((a,b)=>parseInt(b.nro||0)-parseInt(a.nro||0));
  // Adaptar al shape esperado por el modal (que lee e['EQUIPO']/e['CÓDIGO']/e['COSTO']/e['N° ENTREGA'])
  window._entregasAll=entregas.map(e=>({
    'EQUIPO':e.equipo||'',
    'CÓDIGO':e.codigo||'',
    'CODIGO':e.codigo||'',
    'COSTO':e.costo||'',
    'N° ENTREGA':e.nro||'',
    'FECHA':e.fecha||'',
  }));
  const totalCostoMes=entregas.reduce((s,e)=>s+(e.costoNum||0),0);
  const entConCosto=entregas.filter(e=>(e.costoNum||0)>0).length;

  // Equipos en reparación (estado amber según _estadoEquipos)
  const enReparacion=Object.values(window._estadoEquipos||{}).filter(info=>ESTADO_COLOR(info.estado)==='amber').length;

  // Horas totales en taller 2026 (sumadas de PANEL_TRABAJOS), con split correctivo/preventivo.
  const _hf=window._horasFlota||{prev:0,corr:0,total:0};
  const horasTotalFlota=_hf.total||0;
  const _horasCorr=_hf.corr||0, _horasPrev=_hf.prev||0;
  const _corrPct=horasTotalFlota>0?Math.round(_horasCorr/horasTotalFlota*100):0;
  const _prevPct=horasTotalFlota>0?100-_corrPct:0;

  // Operativos absolutos (estado green en _estadoEquipos)
  const operativosAbs=Object.values(window._estadoEquipos||{}).filter(info=>ESTADO_COLOR(info.estado)==='green').length;
  const totalEquipos=Object.keys(window._estadoEquipos||{}).length;

  // Service: operatividad de cada equipo del PROGRAMA DE TRABAJOS DE SERVICE.
  // operatividadEquipo() ya resuelve la hr/km actual (combustible > programa de service)
  // y clasifica en holgado / intermedio / critico. Armamos la lista de críticos para el modal.
  let serviceCritico=0, serviceAmber=0, serviceGreen=0, serviceConDatos=0;
  const sp=window._servicePanel||{};
  const _criticosList=[];
  for(const codN of Object.keys(sp)){
    const op=operatividadEquipo(codN);
    if(op.nivel==='sin-datos')continue;
    serviceConDatos++;
    if(op.nivel==='critico'){
      serviceCritico++;
      const info=(window._estadoEquipos||{})[codN]||{};
      _criticosList.push({
        codN,
        codigo: info.rawCod || sp[codN].codigo || codN,
        nombre: info.equipo || sp[codN].descripcion || '',
        hrActual: op.hrActual,
        hrActualFmt: op.hrActual!=null ? fmtInt(op.hrActual) : '—',
        estimado: op.hrProximo,
        estimadoFmt: op.hrProximo!=null ? fmtInt(op.hrProximo) : '—',
        restantes: op.restantes,
        fuente: op.fuente,
        ultFecha: (window._combustiblePorEquipo||{})[codN]?.ultimaFecha || sp[codN].ultFecha || '',
      });
    }
    else if(op.nivel==='intermedio')serviceAmber++;
    else serviceGreen++;
  }
  // Más pasado (restantes más negativo) primero.
  _criticosList.sort((a,b)=>{
    const ra=a.restantes==null?Infinity:a.restantes;
    const rb=b.restantes==null?Infinity:b.restantes;
    return ra-rb;
  });
  window._serviceCriticosList=_criticosList;
  try{ renderServiceTab(); }catch(e){ console.warn('[INGECO] service tab:',e); }

  const serviceClass=serviceCritico>0?'red':(serviceAmber>0?'amber':'green');
  const serviceSub=serviceConDatos>0
    ? `${serviceAmber} intermedio · ${serviceGreen} holgado · ${Object.keys(sp).length-serviceConDatos} sin datos`
    : (Object.keys(sp).length>0 ? 'falta cargar rangos/frecuencia' : 'sin datos en PROGRAMA DE SERVICE');

  // KPIs (8: operativos, pedidos activos, reparación, service crítico, costo mes,
  // horas taller, combustible livianos, combustible pesados)
  // Cualquier KPI cuyo valor numérico real sea 0 o no haya dato se renderiza con clase
  // .kpi-empty para atenuar visualmente; los KPIs con valor compiten por la atención.
  const _kpiCostoEmpty = !(totalCostoMes>0);
  const _kpiHorasEmpty = !(horasTotalFlota>0);
  const _kpiServiceEmpty = !(serviceConDatos>0);
  // Combustible livianos: gasto por mes, con selector. Default = mes más reciente.
  const _gcMes=window._gastoCombLivianosPorMes||{};
  const _gcCargas=window._cargasCombLivianosPorMes||{};
  const _gcMeses=Object.keys(_gcMes).sort().reverse();
  const _gcDefault=_gcMeses[0]||'';
  const _gcVal=_gcDefault?(_gcMes[_gcDefault]||0):(window._gastoCombLivianos||0);
  const _gcOpts=['<option value="all">Acumulado</option>']
    .concat(_gcMeses.map(ym=>`<option value="${ym}"${ym===_gcDefault?' selected':''}>${ymLabel(ym)}</option>`))
    .join('');
  const _gcSub=_gcDefault?`${fmtInt(_gcCargas[_gcDefault]||0)} cargas · ${ymLabel(_gcDefault)}`:'gasto · vehículos livianos';
  const _gcEmpty=!(_gcVal>0)&&!(window._gastoCombLivianos>0);
  const svKpiAttrs = serviceCritico>0
    ? html` data-action="openServiceCriticoModal" title="Ver lista de equipos críticos"`
    : '';
  setHTML(document.getElementById('kpiGrid'), html`
    <div class="kpi${totalEquipos?'':' kpi-empty'}"><div class="kpi-label">operativos</div><div class="kpi-val green">${fmtInt(operativosAbs)}<span style="font-size:18px;color:var(--text3);font-weight:400"> / ${totalEquipos?fmtInt(totalEquipos):'—'}</span></div><div class="kpi-sub">estado verde en CÓDIGOS</div><div class="kpi-accent-bar green"></div></div>
    <div class="kpi${pendActivos?'':' kpi-empty'}"><div class="kpi-label">pedidos activos</div><div class="kpi-val ${pendActivos>10?'red':'amber'}">${fmtInt(pendActivos)}</div><div class="kpi-sub">pendiente · parcial · comprado</div><div class="kpi-accent-bar ${pendActivos>10?'red':'amber'}"></div></div>
    <div class="kpi${enReparacion?'':' kpi-empty'}"><div class="kpi-label">equipos en reparación</div><div class="kpi-val amber">${fmtInt(enReparacion)}</div><div class="kpi-sub">estado naranja en CÓDIGOS</div><div class="kpi-accent-bar amber"></div></div>
    <div class="kpi${_kpiServiceEmpty?' kpi-empty':''}${serviceCritico>0?' kpi-clickable':''}"${svKpiAttrs}><div class="kpi-label">service crítico</div><div class="kpi-val ${serviceClass}">${fmtInt(serviceCritico)}</div><div class="kpi-sub">${serviceSub}</div><div class="kpi-accent-bar ${serviceClass}"></div></div>
    <div class="kpi${_kpiCostoEmpty?' kpi-empty':' kpi-clickable'}" id="kpiCostoCard" data-action="abrirDetalleKpi" data-arg="costo" title="Ver desglose por equipo"><div class="kpi-label">costo en repuestos</div><div class="kpi-val amber" id="kpiCostoVal">${totalCostoMes>0?formatMoney(totalCostoMes):'—'}</div><div class="kpi-sub" id="kpiCostoSub">${MES_ACTUAL.label} · ${fmtInt(entConCosto)} entregas con costo</div><div class="kpi-accent-bar amber"></div></div>
    <div class="kpi${_kpiHorasEmpty?' kpi-empty':' kpi-clickable'}" id="kpiHorasCard" data-action="abrirDetalleKpi" data-arg="horas" title="Ver desglose por equipo"><div class="kpi-label">horas en taller</div><div class="kpi-val" id="kpiHorasVal">${horasTotalFlota>0?fmtInt(Math.round(horasTotalFlota))+' hr':'—'}</div><div class="kpi-sub${horasTotalFlota>0?' hr-split':''}" id="kpiHorasSub">${horasTotalFlota>0?new RawHTML(`<div class="hr-split-bar"><span class="corr" style="width:${_corrPct}%"></span><span class="prev" style="width:${_prevPct}%"></span></div><span class="hr-split-leg"><i class="corr"></i>${fmtInt(Math.round(_horasCorr))} hr correctivo · ${_corrPct}%</span><span class="hr-split-leg"><i class="prev"></i>${fmtInt(Math.round(_horasPrev))} hr preventivo · ${_prevPct}%</span>`):'acumuladas · flota'}</div><div class="kpi-accent-bar blue"></div></div>
    <div class="kpi${_gcEmpty?' kpi-empty':' kpi-clickable'}" id="kpiCombCard" data-action="abrirDetalleKpi" data-arg="combustible" title="Ver desglose por equipo"><div class="kpi-label">combustible livianos</div><div class="kpi-val amber" id="kpiCombVal">${_gcVal>0?formatMoney(_gcVal):'—'}</div><div class="kpi-sub" id="kpiCombSub">${_gcSub}</div><div class="kpi-accent-bar amber"></div></div>
    <div class="kpi kpi-empty" id="kpiCombPesCard"><div class="kpi-label">combustible pesados</div><div class="kpi-val" id="kpiCombPesVal">—</div><div class="kpi-sub" id="kpiCombPesSub">litros · equipos pesados</div><div class="kpi-accent-bar blue"></div></div>
  `);

  // Cablear status bar superior — telemetría en vivo del estado de la flota
  (function updateStatusBar(){
    const states=Object.values(window._estadoEquipos||{});
    const total=states.length;
    const oper=states.filter(i=>ESTADO_COLOR(i.estado)==='green').length;
    const rep=states.filter(i=>ESTADO_COLOR(i.estado)==='amber').length;
    const down=states.filter(i=>ESTADO_COLOR(i.estado)==='red').length;
    const set=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=val;};
    set('hsEq', total?fmtInt(total):'—');
    set('hsOp', total?`${fmtInt(oper)}/${fmtInt(total)}`:'—');
    set('hsRep', fmtInt(rep));
    set('hsDown', fmtInt(down));
    set('hsPend', fmtInt(pendActivos));
  })();

  // Catálogo de equipos — única fuente: hoja de CÓDIGOS (ya parseada en _estadoEquipos)
  // Los datos de entregas/pedidos NO inyectan equipos nuevos; solo se adjuntan a los existentes.
  const equiposOrdenados=Object.entries(window._estadoEquipos||{}).map(([codN,info])=>({
    codigo:info.rawCod||codN,
    nombre:info.equipo||info.rawCod||codN,
    marca:info.marca||'',
    modelo:info.modelo||'',
    clasificacion:info.clasificacion||'',
    categoria:info.categoria||'',
    ingresos:0,
    costoTotal:0,
  })).sort((a,b)=>a.codigo.localeCompare(b.codigo));
  window._equiposOrdenados=equiposOrdenados;
  renderEquipoIndex(equiposOrdenados);
}

/* ═══════════════════════════════════════════════════════
   DETALLE DE EQUIPO
═══════════════════════════════════════════════════════ */
let _activeEqCard=null;

/**
 * Reubica el panel detalle en el DOM para que aparezca inmediatamente debajo de la
 * tarjeta clickeada (modo grid: al final de la fila visual; modo lista: justo después
 * de la fila). Evita el scroll de "subir-y-bajar" cuando hay muchos equipos.
 */
function placeDetailPanelNearCard(cardEl){
  const panel=document.getElementById('equipoDetailPanel');
  if(!panel||!cardEl)return;
  // El grid puede ser el principal (#equipoGrid) o el de la sección de inactivos.
  const grid=cardEl.closest('#equipoGrid, .equipo-grid')||document.getElementById('equipoGrid');
  if(!grid)return;

  // Modo lista: el wrap es el contenedor; insertamos después de la fila clickeada.
  const wrap=grid.querySelector('.equipo-list-wrap');
  if(wrap&&wrap.contains(cardEl)){
    if(cardEl.nextElementSibling!==panel)cardEl.insertAdjacentElement('afterend',panel);
    return;
  }

  // Modo grid: detectamos qué tarjetas comparten fila visual (mismo offsetTop)
  // y colgamos el panel después de la última de esa fila.
  // Filtramos las ocultas (display:none → offsetTop=0) para no contaminar el match.
  const cards=Array.from(grid.querySelectorAll(':scope > .equipo-card'))
    .filter(c=>!c.classList.contains('hidden'));
  if(!cards.length)return;
  const top=cardEl.offsetTop;
  let lastInRow=cardEl;
  for(const c of cards){
    if(c.offsetTop===top)lastInRow=c;
  }
  if(lastInRow.nextElementSibling!==panel)lastInRow.insertAdjacentElement('afterend',panel);
}

// Reubicar el panel si cambia el ancho de ventana (las filas del grid cambian).
window.addEventListener('resize',()=>{
  if(_activeEqCard&&document.getElementById('equipoDetailPanel')?.classList.contains('open')){
    placeDetailPanelNearCard(_activeEqCard);
  }
});

async function toggleEquipoDetail(codigo,cardEl){
  const panel=document.getElementById('equipoDetailPanel');
  if(_activeEqCard===cardEl&&panel.classList.contains('open')){closeEquipoDetail();return;}
  if(_activeEqCard)_activeEqCard.classList.remove('active');
  _activeEqCard=cardEl;cardEl.classList.add('active');
  placeDetailPanelNearCard(cardEl);
  const codN=normCod(codigo);
  const info0=(window._estadoEquipos||{})[codN];
  const entMes=(window._entregasAll||[]).filter(e=>normCod(e['CÓDIGO']||e['CODIGO']||'')===codN);
  const marca=info0?.marca||'';
  const modelo=info0?.modelo||'';
  const descripcion=info0?.equipo||entMes[0]?.['EQUIPO']||(window._pedidosAll||[]).find(p=>p.codigo===codN)?.equipo||'';
  const clasif=info0?.clasificacion||TIPO_EQUIPO(codigo);
  const nombre=buildEquipoNombre(clasif,marca,modelo,descripcion||codigo);
  const patente=(window._horometros||{})[normCod(codigo)]?.patente||info0?.patente||null;

  const costosPorMes=window._costosPorMes||{};
  const costoMeses=MESES_ENTREGAS.map(m=>({label:m.label,ym:m.ym,val:(costosPorMes[m.ym]||{})[codN]||0,id:m.id}));
  const costoTotal2026=costoMeses.reduce((s,m)=>s+m.val,0);

  // Subtítulo: la clasif ya está en el título principal, así que solo mostramos
  // tags complementarios (patente y descripción del catálogo cuando agrega info).
  const mostrarDesc=descripcion&&normCod(descripcion)!==normCod(nombre);
  const subTags=[
    patente?html`<span class="eq-detail-tag">📋 ${patente}</span>`:'',
    mostrarDesc?html`<span class="eq-detail-tag" style="opacity:.85">${descripcion}</span>`:'',
  ].filter(Boolean);

  document.getElementById('eqDetailTitle').textContent=nombre;
  setHTML(document.getElementById('eqDetailSub'), html`<span>${codigo}</span>${subTags}`);
  setHTML(document.getElementById('eqDetailBody'),
    html`<div style="padding:2rem;text-align:center;font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--text3)">cargando historial...</div>`);
  panel.classList.add('open');
  setTimeout(()=>panel.scrollIntoView({behavior:'smooth',block:'nearest'}),60);
  _secCounter=0;

  const[serviceRows,trabajosRows]=await Promise.all([
    (async()=>{
      // Service por equipo: leido del snapshot (SERVICE_EQ, una fila por planilla-equipo-mes).
      // Cacheado por precargarHorometros() en window._serviceEqRows; fallback al snapshot directo.
      let rows=window._serviceEqRows;
      if(!rows){ try{ rows=await fetchGvizObj(SNAPSHOT_ID,'SERVICE_EQ'); window._serviceEqRows=rows; }catch(_){ rows=[]; } }
      const _sp=s=>String(s||'').toUpperCase().replace(/\s+/g,'');
      const out=[];
      for(const r of rows){
        if(String(r['CODN']||'').trim()!==normCod(codigo))continue;
        if(_sp(r['KVCOD'])!==_sp(codigo))continue;
        out.push({
          planilla:String(r['PLANILLA']||'').trim()||'\u2014',
          fecha:String(r['FECHA']||'').trim()||'\u2014',
          personal:String(r['PERSONAL']||'').trim()||'\u2014',
          horActual:r['ACTUAL']||null,
          horProximo:r['PROXIMO']||null,
          serie:r['SERIE']||null,
          mes:r['MES']||'',sheetId:r['SHEET_ID']||'',
        });
      }
      return out.sort((a,b)=>toSortDate(b.fecha)-toSortDate(a.fecha));
    })(),
    loadTrabajosRegistro(codigo),
  ]);

  // El más reciente alimenta la caja de horómetro y el link a planilla
  const serviceRow=serviceRows[0]||null;

  // Helper: lookup tolerante de columnas en un objeto-fila (tolera tildes, espacios, mayúsculas, °/º/N°/Nº)
  const normH=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase().replace(/º/g,'').replace(/°/g,'').replace(/[#]/g,'').replace(/\s+/g,'').trim();
  const pickCol=(obj,candidates)=>{
    if(!obj)return'';
    const idx={};
    for(const k of Object.keys(obj))idx[normH(k)]=obj[k];
    for(const c of candidates){
      const v=idx[normH(c)];
      if(v!=null&&String(v).trim()!==''&&String(v).trim()!=='-')return String(v).trim();
    }
    return'';
  };
  const COLS_PED={
    codigo:    ['CODIGO','COD','CODIGO EQUIPO','COD EQUIPO'],
    nroPedido: ['N° PEDIDO','Nº PEDIDO','N PEDIDO','NRO PEDIDO','NUMERO PEDIDO','PEDIDO','N° DE PEDIDO'],
    fechaPed:  ['FECHA PEDIDO','FECHA DEL PEDIDO','FECHA DE PEDIDO','F PEDIDO','F. PEDIDO','FECHA INGRESO','FECHA DE INGRESO','FECHA DEL INGRESO','F INGRESO','F. INGRESO','INGRESO','FECHA CREACION','FECHA DE CREACION','FECHA'],
    desc:      ['DESCRIPCIÓN DE REPUESTOS ENTREGADOS','DESCRIPCION DE REPUESTOS ENTREGADOS','DESCRIPCIÓN DE REPUESTOS','DESCRIPCION DE REPUESTOS','DESCRIPCION REPUESTOS','DESCRIPCION','DESCRIPCIÓN','DETALLE DE REPUESTOS','DETALLE','REPUESTOS','REPUESTOS PEDIDOS'],
    nroEntrega:['N° ENTREGA','Nº ENTREGA','N ENTREGA','NRO ENTREGA','NUMERO ENTREGA','ENTREGA','N° DE ENTREGA'],
    fechaEnt:  ['FECHA ENTREGA','FECHA DE ENTREGA','F ENTREGA','F. ENTREGA'],
  };

  const mesConService=SERVICE_MESES.find(m=>[...m.equipos].some(c=>normCod(c)===normCod(codigo)));
  const pedidosHist=(window._pedidosEntregados||[]).filter(p=>normCod(pickCol(p,COLS_PED.codigo))===codN);
  const pedidosActivos=(window._pedidosAll||[]).filter(p=>p.codigo===codN);
  const totalPedidos=pedidosHist.length+pedidosActivos.length;

  // Info de estado
  const info=(window._estadoEquipos||{})[codN];
  const est=ESTADO_COLOR(info?.estado);

  // Combustible: resumen del equipo (puede ser undefined si nunca cargó combustible)
  const comb=(window._combustiblePorEquipo||{})[codN];
  const _unidad=comb?.unidad||unidadDeEquipo(codigo);
  const _consumoLabel=_unidad==='km'?'L/100km':'L/hr';
  const _consumoTxt=comb?.promedio!=null
    ? `${comb.promedio.toFixed(_unidad==='km'?1:2)} <span style="font-size:13px;color:var(--text3);font-weight:400">${_consumoLabel}</span>`
    : '—';
  const _consumoSub=comb?.cargas?.length
    ? `${fmtInt(comb.totalLitros)} L en ${comb.cargas.length} cargas`
    : 'sin cargas registradas';

  // KPIs
  const kpisHTML=`
    <div class="eq-kpis">
      <div class="eq-kpi"><div class="eq-kpi-val amber">${costoTotal2026>0?formatMoney(costoTotal2026):'—'}</div><div class="eq-kpi-label">costo repuestos 2026</div></div>
      <div class="eq-kpi"><div class="eq-kpi-val">${entMes.length}</div><div class="eq-kpi-label">entregas ${MES_ACTUAL.label}</div></div>
      <div class="eq-kpi"><div class="eq-kpi-val">${totalPedidos}</div><div class="eq-kpi-label">pedidos 2026</div></div>
      <div class="eq-kpi" title="${_consumoSub}"><div class="eq-kpi-val">${_consumoTxt}</div><div class="eq-kpi-label">consumo promedio</div></div>
      <div class="eq-kpi" title="${_consumoSub}"><div class="eq-kpi-val amber">${comb?.totalCosto>0?formatMoney(comb.totalCosto):'—'}</div><div class="eq-kpi-label">gasto combustible</div></div>
    </div>`;

  // Estado operativo
  const tenInfo=(info?.tenencia==='propio'||info?.tenencia==='alquilado')?info:null;
  const tenColor=tenInfo?.tenencia==='propio'?'var(--green)':'var(--amber)';
  const tenLabelDet=tenInfo?(tenInfo.observacion||(tenInfo.tenencia==='propio'?'Propio':'Alquilado')):'';
  const tenTag=tenInfo?`<span style="color:${tenColor};font-weight:600;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase">◆ ${tenLabelDet}</span>`:'';
  const infoBar=info?.estado?`
    <div style="display:flex;gap:14px;background:var(--bg3);border:1px solid var(--border);padding:9px 14px;margin-bottom:12px;font-size:12px;flex-wrap:wrap;align-items:center;border-left:3px solid ${ESTADO_CSS[est]}">
      <span style="font-weight:600;color:${ESTADO_CSS[est]}">${info.estado}</span>
      ${tenTag}
      ${info.ubicacion?`<span style="color:var(--text2)">📍 ${info.ubicacion}</span>`:''}
      ${info.operario?`<span style="color:var(--text2)">👤 ${info.operario}</span>`:''}
      ${info.fecha?`<span style="color:var(--text3);font-size:11px;font-family:'IBM Plex Mono',monospace">act. ${info.fecha}</span>`:''}
    </div>`:
    (tenInfo?`
    <div style="display:flex;gap:14px;background:var(--bg3);border:1px solid var(--border);padding:9px 14px;margin-bottom:12px;font-size:12px;flex-wrap:wrap;align-items:center">
      ${tenTag}
      <span style="color:var(--text3)">Sin datos de estado operativo</span>
    </div>`:
    `<div style="background:var(--bg3);border:1px solid var(--border);padding:9px 14px;margin-bottom:12px;font-size:12px;color:var(--text3)">Sin datos de estado operativo</div>`);

  // Service / Horómetro — preferimos PANEL_PROGRAMA, fallback a planilla del mes (serviceRow)
  const sp=(window._servicePanel||{})[codN]||null;
  let horHTML='';
  if(sp){
    // Operatividad del PROGRAMA DE TRABAJOS DE SERVICE. operatividadEquipo() resuelve
    // la hr/km actual: combustible (lo más fresco) o, si no hay cargas, el programa de service.
    const op=operatividadEquipo(codN);
    const usarComb = op.fuente==='combustible';
    const ultHr = op.hrActual!=null ? op.hrActual : (sp.ultHrKm||serviceRow?.horActual||'—');
    const ultFecha = usarComb ? (comb?.ultimaFecha||'—')
                              : (sp.ultFecha||serviceRow?.fecha||serviceRow?.mes||'—');
    const ultFuente = usarComb ? `vía combustible (${formatFechaCorta(comb?.ultimaFecha)})`
                               : (op.fuente?`vía ${op.fuente}`:'');
    const estHr=sp.estHrKm||serviceRow?.horProximo||'—';
    const frec=sp.frecuencia||'—';
    const estadoColor=op.color;
    const estadoLabel=op.label.toUpperCase();
    const restantes=op.restantes;
    const restantesTxt=restantes!=null?(restantes>=0?`faltan ${restantes.toLocaleString('es-AR')}`:`vencido ${Math.abs(restantes).toLocaleString('es-AR')}`):'';

    horHTML=`
    <div style="background:var(--bg3);border:1px solid var(--border);border-left:3px solid ${estadoColor};margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-bottom:1px solid var(--border);background:var(--bg2)">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;color:${estadoColor};letter-spacing:.1em">● OPERATIVIDAD ${estadoLabel}</span>
          ${restantesTxt?`<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--text2)">${restantesTxt}</span>`:''}
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap">
        <div style="flex:1;min-width:140px;padding:10px 14px;border-right:1px solid var(--border)">
          <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:3px">Última lectura hr/km</div>
          <div style="font-size:15px;color:var(--blue);font-family:'IBM Plex Mono',monospace;font-weight:500">${typeof ultHr==='number'?fmtInt(ultHr):ultHr}</div>
          <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text3);margin-top:2px">${ultFecha}${ultFuente?` <span style="color:var(--amber)">· ${ultFuente}</span>`:''}</div>
        </div>
        <div style="flex:1;min-width:140px;padding:10px 14px;border-right:1px solid var(--border)">
          <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:3px">Próximo service</div>
          <div style="font-size:15px;color:${estadoColor};font-family:'IBM Plex Mono',monospace;font-weight:500">${typeof estHr==='number'?fmtInt(estHr):estHr}</div>
        </div>
        <div style="flex:1;min-width:120px;padding:10px 14px">
          <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:3px">Frecuencia</div>
          <div style="font-size:15px;color:var(--text2);font-family:'IBM Plex Mono',monospace;font-weight:500">${frec}</div>
          ${sp.patente?`<div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text3);margin-top:2px">${sp.patente}</div>`:''}
        </div>
      </div>
    </div>`;
  } else if(serviceRow?.horActual){
    // Fallback al sistema viejo (SERVICE_MESES) cuando PANEL_PROGRAMA no tiene al equipo
    horHTML=`
    <div style="display:flex;background:var(--bg3);border:1px solid var(--border);margin-bottom:12px;overflow:hidden">
      <div style="flex:1;padding:10px 14px;border-right:1px solid var(--border)">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:3px">Horóm./Odóm. actual</div>
        <div style="font-size:15px;color:var(--blue);font-family:'IBM Plex Mono',monospace;font-weight:500">${serviceRow.horActual}</div>
      </div>
      <div style="flex:1;padding:10px 14px;border-right:1px solid var(--border)">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:3px">Próximo service</div>
        <div style="font-size:15px;color:var(--amber);font-family:'IBM Plex Mono',monospace;font-weight:500">${serviceRow.horProximo||'—'}</div>
      </div>
      <div style="padding:10px 14px;min-width:120px">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:3px">Último service</div>
        <div style="font-size:12px;color:var(--text2)">${serviceRow.mes}</div>
        ${serviceRow.serie?`<div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text3);margin-top:2px">${serviceRow.serie}</div>`:''}
      </div>
    </div>`;
  } else if(comb?.ultimaHr!=null){
    // Equipo sin planilla de service pero con lectura de horómetro/odómetro vía
    // combustible. Cubre el caso espejo: la trituradora (sin horómetro propio)
    // hereda la última lectura de la zaranda con la que comparte tren de chancado.
    const _hu=_unidad==='km'?'km':'hr';
    const _fc=comb.ultimaFecha?formatFechaCorta(comb.ultimaFecha):'';
    const _src=comb.horasEspejoDe?`vía zaranda ${comb.horasEspejoDe}`:'vía combustible';
    horHTML=`
    <div style="display:flex;background:var(--bg3);border:1px solid var(--border);border-left:3px solid var(--blue);margin-bottom:12px;overflow:hidden">
      <div style="flex:1;padding:10px 14px">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:3px">Última lectura ${_hu}</div>
        <div style="font-size:15px;color:var(--blue);font-family:'IBM Plex Mono',monospace;font-weight:500">${fmtInt(comb.ultimaHr)} ${_hu}</div>
        <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text3);margin-top:2px">${_fc}${_fc?' ':''}<span style="color:var(--amber)">· ${_src}</span></div>
      </div>
    </div>`;
  }

  // Sección 1: Servicios y reparaciones
  const filasServicio=[];
  for(const sr of serviceRows){
    filasServicio.push({ref:`Nº ${sr.planilla}`,fecha:sr.fecha,tipo:'service',
      desc:`Service — Personal: ${sr.personal}`,lugar:sr.mes,tiempo:'—',_ts:toSortDate(sr.fecha)});
  }
  // Acumulador de horas totales y por mes (para el gráfico) + split correctivo/preventivo
  let totalHoras=0, horasPrevEq=0, horasCorrEq=0;
  const horasPorMes={};
  for(const r of trabajosRows){
    const desc=r.desc;
    if(!desc)continue;
    const fecha=r.fecha;
    // Parsear horas: acepta "3", "3 horas", "0,5 horas", "1 hora", etc.
    // parseFloat ya ignora el sufijo de texto. La coma decimal se cambia a punto.
    const tNum=parseFloat(String(r.tiempo||'').replace(',','.'));
    const tiempoFmt=isFinite(tNum)&&tNum>0
      ?(Number.isInteger(tNum)?tNum:tNum.toFixed(1))+' hr'
      :'—';
    // Clasificar este trabajo: preventivo (service/mantenimiento) o correctivo (reparación/neumáticos)
    const tipoTrabajo=clasificarTrabajo(r.razon,desc);
    if(isFinite(tNum)&&tNum>0){
      totalHoras+=tNum;
      if(tipoTrabajo==='preventivo')horasPrevEq+=tNum; else horasCorrEq+=tNum;
      const d=_parseDate(fecha);
      if(d){const ym=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;horasPorMes[ym]=(horasPorMes[ym]||0)+tNum;}
    }
    filasServicio.push({ref:'—',fecha,tipo:tipoTrabajo,
      desc:desc.length>200?desc.slice(0,197)+'…':desc,
      lugar:r.lugar||'—',
      tiempo:tiempoFmt,_ts:toSortDate(fecha)});
  }
  filasServicio.sort((a,b)=>b._ts-a._ts);

  // Tag "service planificado": si la fecha de la fila coincide (±SERVICE_VENTANA_DIAS)
  // con un service del planning para este equipo, mostramos un chip. Útil para
  // distinguir las paradas conjuntas service+reparación que el operario cargó como
  // RAZÓN="Reparación" porque la mayor parte del tiempo fue reparación.
  const _svcFechas = (window._serviceFechasMatch||{})[codN];
  const _ventanaMs = (typeof SERVICE_VENTANA_DIAS!=='undefined'?SERVICE_VENTANA_DIAS:7)*86400000;
  const _svcFechasArr = _svcFechas ? [..._svcFechas].map(ymd=>{const [y,m,d]=ymd.split('-');return new Date(+y,+m-1,+d);}) : [];
  const _matchSvcPlan = (fechaStr)=>{
    if(!_svcFechasArr.length)return false;
    const rango = _parseFechaRango(fechaStr);
    if(!rango)return false;
    for(const fp of _svcFechasArr) if(_distAlRango(fp,rango)<=_ventanaMs) return true;
    return false;
  };

  const contServicio=filasServicio.length
    ?`<div class="table-wrap"><table class="eq-inner-table">
        <thead><tr><th>Planilla</th><th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Lugar</th><th style="text-align:right">Tiempo</th></tr></thead>
        <tbody>${filasServicio.map(f=>`<tr>
          <td class="mono" style="font-size:10px;color:var(--text3)">${f.ref}</td>
          <td class="mono" style="font-size:10px;color:var(--text3);white-space:nowrap">${formatFechaCorta(f.fecha)}${_matchSvcPlan(f.fecha)?' <span class="badge badge-blue" style="font-size:8px;padding:1px 4px;margin-left:3px" title="Coincide con un service planificado para este equipo">🔧 svc</span>':''}</td>
          <td>${(f.tipo==='service'||f.tipo==='preventivo')?'<span class="badge badge-blue" style="font-size:9px">Preventivo</span>':'<span class="badge badge-green" style="font-size:9px">Correctivo</span>'}</td>
          <td style="font-size:12px;color:var(--text2)">${f.desc}</td>
          <td style="font-size:11px;color:var(--text3);white-space:nowrap">${f.lugar}</td>
          <td style="text-align:right;font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--text3)">${f.tiempo}</td>
        </tr>`).join('')}</tbody>
        <tfoot>
          ${(horasPrevEq>0||horasCorrEq>0)?`<tr style="border-top:2px solid var(--border);background:var(--bg3)">
            <td colspan="5" style="text-align:right;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;padding:6px 12px">Correctivo · Preventivo</td>
            <td style="text-align:right;font-family:'IBM Plex Mono',monospace;font-size:11px;padding:6px 12px;white-space:nowrap"><span style="color:var(--green)">${horasCorrEq.toFixed(1)}</span> · <span style="color:var(--blue)">${horasPrevEq.toFixed(1)}</span></td>
          </tr>`:''}
          <tr style="border-top:1px solid var(--border);background:var(--bg3)">
          <td colspan="5" style="text-align:right;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;padding:8px 12px">Total horas trabajadas</td>
          <td style="text-align:right;font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--amber);font-weight:500;padding:8px 12px">${totalHoras>0?totalHoras.toFixed(1)+' hr':'—'}</td>
        </tr></tfoot>
      </table></div>`
    :`<div class="no-data">Sin trabajos registrados para este equipo.${
      window._panelTrabajosTotal===0
        ? '<br><span style=\"font-size:11px;color:var(--amber)\">PANEL_TRABAJOS no encontrado — actualizá PANEL_TRABAJOS desde el menú del Sheet maestro.</span>'
        : window._panelTrabajosTotal>0&&trabajosRows.length===0
          ? '<br><span style=\"font-size:11px\">Script B corrió pero este equipo no tiene trabajos registrados, o la columna CÓDIGO está vacía en la planilla.</span>'
          : ''
    }</div>`;

  // Sección 2: Pedidos
  const PBADGE={entregado:'<span class="badge badge-green" style="font-size:9px">Completado</span>',pendiente:'<span class="badge badge-red" style="font-size:9px">Pendiente</span>',parcial:'<span class="badge badge-amber" style="font-size:9px">Parcial</span>',comprado:'<span class="badge badge-blue" style="font-size:9px">Comprado</span>',anulado:'<span class="badge badge-gray" style="font-size:9px">Anulado</span>'};
  const getBP=est=>PBADGE[est.toLowerCase()]||`<span class="badge badge-gray" style="font-size:9px">${est}</span>`;
  const getCE=nroEnt=>{
    if(!nroEnt||nroEnt==='—')return null;
    const e=(window._entregaCostos||{})[String(nroEnt).split(/[-,]/)[0].trim()];
    return e?.costo>0?formatMoney(e.costo):null;
  };

  // N° ENTREGA ya vinculadas a un pedido entregado (evitar duplicar la fila en el listado)
  const entregasUsadas=new Set(
    pedidosHist
      .map(p=>String(pickCol(p,COLS_PED.nroEntrega)).split(/[-,]/)[0].trim())
      .filter(Boolean)
  );
  const entregasSinPedido=((window._entregasPorEquipo||{})[codN]||[])
    .filter(e=>e.nro==='—'||!entregasUsadas.has(String(e.nro).split(/[-,]/)[0].trim()));

  // Resolver fechaPed con cascada de estrategias:
  //   1) Candidatos explícitos en COLS_PED.fechaPed (FECHA PEDIDO, F. PEDIDO, etc.)
  //   2) Heurística: cualquier columna que contenga "FECHA" en el nombre y NO contenga
  //      "ENTREGA" — cubre variantes que no anticipamos (FECHA INGRESO, F.CREACIÓN, etc.)
  //   3) Cruce por N° pedido con la hoja PENDIENTES (red de seguridad).
  const resolverFechaPed=p=>{
    const v1=pickCol(p,COLS_PED.fechaPed);
    if(v1)return v1;
    if(p){
      for(const k of Object.keys(p)){
        const kn=normH(k);
        if(!kn.includes('FECHA'))continue;
        if(kn.includes('ENTREGA'))continue;
        const val=p[k];
        if(val!=null&&String(val).trim()!==''&&String(val).trim()!=='-')return String(val).trim();
      }
    }
    const nro=pickCol(p,COLS_PED.nroPedido);
    if(nro){
      const fp=(window._fechaPedidoByNro||{})[String(nro).trim()];
      if(fp)return fp;
    }
    return'';
  };

  // Para inspeccionar headers detectados de ENTREGADOS, usar window.diag('<CODIGO>')
  // en consola. Los auto-logs viejos ensuciaban la consola sin pedido.

  const todosPedidos=[
    ...pedidosHist.map(p=>{
      const nroP=pickCol(p,COLS_PED.nroPedido);
      const fechaP=resolverFechaPed(p);
      return{
        nro:        nroP                           ||'—',
        fechaPed:   fechaP                          ||'—',
        desc:       pickCol(p,COLS_PED.desc)        ||'—',
        nroEntrega: pickCol(p,COLS_PED.nroEntrega)  ||'—',
        fechaEnt:   pickCol(p,COLS_PED.fechaEnt)    ||'—',
        estado:'entregado',
        _ts:toSortDate(fechaP),
      };
    }),
    ...pedidosActivos.map(p=>({nro:p.nro||'—',fechaPed:p.fecha||'—',desc:p.desc||'—',nroEntrega:'—',fechaEnt:'—',estado:p.estado||'—',_ts:toSortDate(p.fecha)})),
    ...entregasSinPedido.map(e=>({nro:'—',fechaPed:'—',desc:e.items,nroEntrega:e.nro,fechaEnt:e.fecha,estado:'entregado',_ts:toSortDate(e.fecha)})),
  ].sort((a,b)=>b._ts-a._ts);

  // Helper para renderizar la columna "Descripción": si hay items detallados por N° ENTREGA,
  // los muestra como lista (cantidad × descripción · proveedor); si no, cae al texto plano de p.desc.
  const escapeHTML=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const renderDesc=p=>{
    const map=window._itemsPorEntrega||{};
    const key=String(p.nroEntrega||'').split(/[-,]/)[0].trim();
    const items=key?map[key]:null;
    if(items&&items.length){
      return items.map(it=>{
        const cant=it.cantidad&&it.cantidad!=='-'&&it.cantidad!=='—'
          ?`<span style="color:var(--text3);font-family:'IBM Plex Mono',monospace;font-size:10px">${escapeHTML(it.cantidad)}×</span> `:'';
        const desc=escapeHTML(it.descripcion||'');
        const prov=it.proveedor&&it.proveedor!=='-'&&it.proveedor!=='—'
          ?` <span style="color:var(--text3);font-size:10px">· ${escapeHTML(it.proveedor)}</span>`:'';
        return `<div style="margin-bottom:2px">${cant}${desc}${prov}</div>`;
      }).join('');
    }
    return escapeHTML(p.desc||'—');
  };

  // Helper: demora (días entre F. Pedido y F. Entrega) para pedidos entregados.
  // Coloreado por umbrales pensados para compra de repuestos de equipos viales.
  const renderDemora=p=>{
    if(p.estado!=='entregado')return'<span style="color:var(--text3)">—</span>';
    const d1=_parseDate(p.fechaPed),d2=_parseDate(p.fechaEnt);
    if(!d1||!d2)return'<span style="color:var(--text3)">—</span>';
    const dias=Math.round((d2-d1)/86400000);
    if(dias<0)return'<span style="color:var(--text3)">—</span>';
    let color='var(--text2)';
    if(dias<=7)color='var(--green)';
    else if(dias<=21)color='var(--text2)';
    else if(dias<=45)color='var(--amber)';
    else color='var(--red)';
    return`<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:${color};font-weight:500">${dias}d</span>`;
  };

  const contPedidos=todosPedidos.length
    ?`<div class="table-wrap"><table class="eq-inner-table">
        <thead><tr><th>N° Pedido</th><th>F. Pedido</th><th>Descripción</th><th>N° Entrega</th><th>F. Entrega</th><th style="text-align:center">Demora</th><th style="text-align:right">Costo</th><th>Estado</th></tr></thead>
        <tbody>${todosPedidos.map(p=>{const costo=getCE(p.nroEntrega);return`<tr>
          <td class="mono" style="font-size:10px">${p.nro}</td>
          <td class="mono" style="font-size:10px;color:var(--text3);white-space:nowrap">${formatFechaCorta(p.fechaPed)}</td>
          <td style="font-size:12px;color:var(--text2)">${renderDesc(p)}</td>
          <td class="mono" style="font-size:10px;color:var(--text3)">${p.nroEntrega}</td>
          <td class="mono" style="font-size:10px;color:var(--text3);white-space:nowrap">${formatFechaCorta(p.fechaEnt)}</td>
          <td style="text-align:center;white-space:nowrap">${renderDemora(p)}</td>
          <td style="text-align:right;font-family:'IBM Plex Mono',monospace;font-size:11px;color:${costo?'var(--amber)':'var(--text3)'}">${costo||'—'}</td>
          <td>${getBP(p.estado)}</td>
        </tr>`;}).join('')}</tbody>
      </table></div>`
    :`<div class="no-data">Sin pedidos de repuestos registrados.</div>`;

  // Sección 3: Gráfico combinado (costo en repuestos + horas en taller, mes a mes)
  const hasChart=costoTotal2026>0||!!(window._repuestosHistorial||{})[codN];
  const hasHoras=Object.keys(horasPorMes).length>0;
  const chartUid=`eqchart_${codigo.replace(/[^a-z0-9]/gi,'_')}`;
  const hayCualquiera=hasChart||hasHoras;
  const contGrafico=hayCualquiera
    ?`<div class="table-wrap" style="padding:14px 18px 18px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px">
          <div style="font-size:11px;color:var(--text2)">Costo en repuestos vs horas en taller por mes</div>
          <div style="display:flex;gap:14px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text2);letter-spacing:.04em">
            <span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;background:var(--amber);display:inline-block;box-shadow:0 0 5px rgba(255,160,48,.5)"></span>costo $</span>
            <span style="display:inline-flex;align-items:center;gap:6px"><span style="width:16px;height:2.5px;background:var(--accent);display:inline-block;box-shadow:0 0 5px var(--accent)"></span>horas hr</span>
          </div>
        </div>
        <div style="position:relative;height:200px"><canvas id="${chartUid}">—</canvas></div>
      </div>`
    :`<div class="no-data">Sin datos suficientes para graficar.</div>`;

  // Sección 4: Fuentes
  // rel="noopener noreferrer": evita que la pestaña destino acceda a window.opener
  // (tabnabbing) y omite el header Referer hacia docs.google.com.
  const _lnk=(id,txt,title)=>`<a href="https://docs.google.com/spreadsheets/d/${id}/edit" target="_blank" rel="noopener noreferrer"${title?` title="${title}"`:''} style="color:var(--blue);text-decoration:none">${txt} ↗</a>`;

  // Pestaña de CÓDIGOS según la categoría del equipo (4 tabs: viales, liviano, pesado, soporte)
  const _catTab={
    viales:'VIALES, ASFALTO Y TRITURACIÓN',
    liviano:'TRANSPORTE LIVIANO',
    pesado:'TRANSPORTE PESADO',
    soporte:'SOPORTE',
  }[info?.categoria]||'';

  // Entregas: TODOS los meses, con indicación de cuáles tienen movimiento del equipo (•)
  const _ymsConCosto=new Set(costoMeses.filter(m=>m.val>0).map(m=>m.ym));
  const linksEntTodos=MESES_ENTREGAS.map(m=>{
    const tieneMov=_ymsConCosto.has(m.ym);
    const marker=tieneMov?'<span style="color:var(--amber)" title="Este equipo tiene entregas registradas en este mes">●</span> ':'';
    return marker+_lnk(m.id,m.label,tieneMov?`Entregas ${m.label} (con movimiento de este equipo)`:`Entregas ${m.label}`);
  }).join(' · ');

  // Planillas de service: todas las que existen (4 meses), destacando la que aplica a este equipo
  const _idServiceEq=mesConService?.id;
  const linksService=SERVICE_MESES.map(m=>{
    const aplica=m.id===_idServiceEq;
    const marker=aplica?'<span style="color:var(--amber)" title="Service registrado para este equipo en este mes">●</span> ':'';
    return marker+_lnk(m.id,m.mes,aplica?`Service de ${m.mes} (este equipo)`:`Planilla mensual de service — ${m.mes}`);
  }).join(' · ');

  const contFuentes=`
    <div style="display:grid;gap:1px;background:var(--border);border:1px solid var(--border)">
      <div style="background:var(--bg3);padding:11px 14px;font-size:11px;color:var(--text2);line-height:1.7">
        <span style="display:inline-block;min-width:140px;color:var(--text-mute);text-transform:uppercase;letter-spacing:.12em;font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace">Catálogo</span>
        ${_lnk(SHEET_IDS.codigos,_catTab?`Códigos de equipos — ${_catTab}`:'Códigos de equipos','Hoja maestra de equipos: estado, ubicación, marca/modelo, tenencia, operario')}
      </div>
      <div style="background:var(--bg3);padding:11px 14px;font-size:11px;color:var(--text2);line-height:1.7">
        <span style="display:inline-block;min-width:140px;color:var(--text-mute);text-transform:uppercase;letter-spacing:.12em;font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace">Trabajos en taller</span>
        ${_lnk(SHEET_IDS.trabajos_reg,'PANEL_TRABAJOS (consolidado)','Apps Script consolida todas las planillas mensuales de TRABAJOS REALIZADOS en esta pestaña')}
      </div>
      <div style="background:var(--bg3);padding:11px 14px;font-size:11px;color:var(--text2);line-height:1.7">
        <span style="display:inline-block;min-width:140px;color:var(--text-mute);text-transform:uppercase;letter-spacing:.12em;font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace">Service · programa</span>
        ${_lnk(SHEET_IDS.service,'PANEL_PROGRAMA (consolidado)','Estado de service por equipo: último, próximo estimado, rangos crítico/intermedio/holgado')}
      </div>
      <div style="background:var(--bg3);padding:11px 14px;font-size:11px;color:var(--text2);line-height:1.7">
        <span style="display:inline-block;min-width:140px;color:var(--text-mute);text-transform:uppercase;letter-spacing:.12em;font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace">Service · planillas</span>
        ${linksService||'—'}
      </div>
      <div style="background:var(--bg3);padding:11px 14px;font-size:11px;color:var(--text2);line-height:1.7">
        <span style="display:inline-block;min-width:140px;color:var(--text-mute);text-transform:uppercase;letter-spacing:.12em;font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace">Repuestos · histórico</span>
        ${_lnk(SHEET_IDS.repuestos_hist,'PANEL_REPUESTOS (consolidado)','Apps Script consolida todas las planillas mensuales de ENTREGAS DE REPUESTOS en esta pestaña')}
      </div>
      <div style="background:var(--bg3);padding:11px 14px;font-size:11px;color:var(--text2);line-height:1.7">
        <span style="display:inline-block;min-width:140px;color:var(--text-mute);text-transform:uppercase;letter-spacing:.12em;font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace">Entregas · por mes</span>
        ${linksEntTodos||'—'}
      </div>
      <div style="background:var(--bg3);padding:11px 14px;font-size:11px;color:var(--text2);line-height:1.7">
        <span style="display:inline-block;min-width:140px;color:var(--text-mute);text-transform:uppercase;letter-spacing:.12em;font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace">Pedidos</span>
        ${_lnk(SHEET_IDS.pedidos,'Pedidos de Repuestos 2026','Planilla con pestañas PENDIENTES y ENTREGADOS')}
      </div>
      <div style="background:var(--bg3);padding:11px 14px;font-size:11px;color:var(--text2);line-height:1.7">
        <span style="display:inline-block;min-width:140px;color:var(--text-mute);text-transform:uppercase;letter-spacing:.12em;font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace">Indicadores</span>
        ${_lnk(SHEET_IDS.indicadores,'Indicadores operacionales','Disponibilidad global, MTBF y otros KPIs operativos por período')}
      </div>
      <div style="background:var(--bg3);padding:11px 14px;font-size:11px;color:var(--text2);line-height:1.7">
        <span style="display:inline-block;min-width:140px;color:var(--text-mute);text-transform:uppercase;letter-spacing:.12em;font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace">Combustible</span>
        ${_lnk(SHEET_IDS.combustible,'Entrega de combustible (planilla)','Pestaña ENTREGA DE COMBUSTIBLE — una fila por carga, con horómetro/odómetro, litros y tipo')}
      </div>
      <div style="background:var(--bg2);padding:9px 14px;font-size:10px;color:var(--text3);font-family:'JetBrains Mono',monospace;letter-spacing:.04em">
        <span style="color:var(--amber)">●</span> = movimiento de este equipo en esa fuente
      </div>
    </div>`;

  // Sección: historial de cargas de combustible (más reciente arriba)
  const _hrUnit = _unidad==='km'?'km':'hr';
  const cargasOrdenadas = comb?.cargas ? [...comb.cargas].reverse() : [];
  const contCombustible = cargasOrdenadas.length
    ? `<div class="table-wrap"><table class="eq-inner-table">
        <thead><tr>
          <th>Fecha</th>
          <th style="text-align:right">${_hrUnit==='km'?'Odómetro':'Horóm.'}</th>
          <th style="text-align:right">Litros</th>
          <th style="text-align:right">Costo</th>
          <th>Tipo</th>
          <th>Lugar</th>
          <th>Operario</th>
          <th>Obs.</th>
        </tr></thead>
        <tbody>${cargasOrdenadas.map(c=>`<tr>
          <td class="mono" style="font-size:10.5px;color:var(--text2);white-space:nowrap">${formatFechaCorta(c.fecha)}</td>
          <td class="mono" style="font-size:11px;text-align:right;color:${c.hr!=null?'var(--blue)':'var(--text3)'}">${c.hr!=null?fmtInt(c.hr)+' '+_hrUnit:'<span title="Horómetro/odómetro sin lectura">—</span>'}</td>
          <td class="mono" style="font-size:11px;text-align:right;color:var(--amber);font-weight:500">${fmtInt(c.litros)} L</td>
          <td class="mono" style="font-size:11px;text-align:right;color:${c.costo>0?'var(--amber)':'var(--text3)'}">${c.costo>0?formatMoney(c.costo):'—'}</td>
          <td style="font-size:11px;color:var(--text2)">${c.tipo||'—'}</td>
          <td style="font-size:11px;color:var(--text3)">${c.lugar||'—'}</td>
          <td style="font-size:11px;color:var(--text3)">${c.operario||'—'}</td>
          <td style="font-size:11px;color:var(--text3)">${c.obs||''}</td>
        </tr>`).join('')}</tbody>
        ${(comb?.promedio!=null||comb?.totalCosto>0)?`<tfoot><tr style="background:var(--bg3);font-weight:500">
          <td colspan="2" style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em">Acumulado</td>
          <td colspan="6" style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--text)">${comb?.promedio!=null?`${comb.promedio.toFixed(_unidad==='km'?1:2)} ${_consumoLabel} · `:''}${fmtInt(comb.totalLitros)} L${comb?.totalCosto>0?` · ${formatMoney(comb.totalCosto)} en combustible`:''}</td>
        </tr></tfoot>`:''}
      </table></div>`
    : `<div class="no-data">Sin cargas de combustible registradas para este equipo.</div>`;

  setHTML(document.getElementById('eqDetailBody'),
    new RawHTML(
      (kpisHTML instanceof RawHTML ? kpisHTML.value : String(kpisHTML))+
      (infoBar instanceof RawHTML ? infoBar.value : String(infoBar))+
      (horHTML instanceof RawHTML ? horHTML.value : String(horHTML))+
      eqSection('servicios y reparaciones en taller',contServicio,true).value+
      eqSection(`pedidos y entregas de repuestos 2026 (${todosPedidos.length})`,contPedidos,true).value+
      (hayCualquiera?eqSection('costos y horas de mantenimiento mes a mes',contGrafico,true).value:'')+
      eqSection(`cargas de combustible${comb?.cargas?.length?` (${comb.cargas.length})`:''}`,contCombustible,false).value+
      eqSection('fuentes de información',contFuentes,false).value
    ));

  if(hayCualquiera&&typeof Chart!=='undefined')setTimeout(()=>renderEquipoCombo(chartUid,codigo,horasPorMes),100);
}

function closeEquipoDetail(){
  if(_eqComboChart){_eqComboChart.destroy();_eqComboChart=null;}
  if(_eqChart){_eqChart.destroy();_eqChart=null;}
  if(_horasChart){_horasChart.destroy();_horasChart=null;}
  const panel=document.getElementById('equipoDetailPanel');
  panel.classList.remove('open');
  // Devolver el panel a su home estable: si quedó dentro del grid, al próximo
  // re-render (filtro / cambio de vista) se destruiría junto con las tarjetas.
  const home=document.getElementById('equipoDetailHome');
  if(home&&panel.parentElement!==home)home.appendChild(panel);
  if(_activeEqCard){_activeEqCard.classList.remove('active');_activeEqCard=null;}
}

document.addEventListener('keydown',e=>{if(e.key==='Escape')closeEquipoDetail();});

/* ═══════════════════════════════════════════════════════════════════
   TELEMETRÍA DE FLOTA · 2 gráficos + 2 rankings
═══════════════════════════════════════════════════════════════════ */
let _chartComboFlota=null;

function renderTelemetriaFlota(){
  if(typeof Chart==='undefined')return;
  const AMBER=_cssVar('--amber','#ffa030');
  const ACCENT=_cssVar('--accent','#3a5fc8');
  const CORP =_cssVar('--corp','#5d80e8');
  const RED  =_cssVar('--red','#e5484d');
  const TICK =_cssVar('--chart-tick','#6a7287');
  const GRID =_cssVar('--chart-grid','#1a2030');
  const TEXT2=_cssVar('--text2','#aab3c8');
  const TOOLTIP_BG=_cssVar('--chart-tooltip-bg','#0d1019');
  const TOOLTIP_FG=_cssVar('--chart-tooltip-fg','#f1f4fb');
  const nomMes=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  // ─── Combo chart: costo (barras, eje izq) + horas (línea, eje der) ──
  // Mismos labels de mes; los meses con dato 0 quedan vacíos en su serie.
  const costosPorMes=window._costosPorMes||{};
  const horasPorMesFlota=window._horasPorMesFlota||{};
  const horasCorrPorMes=window._horasCorrPorMes||{};
  const horasPrevPorMes=window._horasPrevPorMes||{};

  // Union de meses presentes en cualquiera de las series (ordenados).
  // Filtramos YMs inválidos (año fuera del rango razonable): alguna fila de datos
  // puede venir con fecha mal formateada (ej. "01/02/205" → ym "205-02") y no
  // queremos que genere un punto "Feb'5" en el chart.
  const _anioAct=new Date().getFullYear();
  const ymsAll=[...new Set([...Object.keys(costosPorMes),...Object.keys(horasPorMesFlota)])]
    .filter(ym=>/^\d{4}-\d{2}$/.test(ym)&&+ym.slice(0,4)>=2020&&+ym.slice(0,4)<=_anioAct+1)
    .sort();
  const labels=ymsAll.map(ym=>{const[y,mm]=ym.split('-');return`${nomMes[+mm-1]}'${y.slice(2)}`;});
  const dataCosto=ymsAll.map(ym=>{
    const m=costosPorMes[ym]||{};
    return Object.values(m).reduce((s,v)=>s+(v||0),0);
  });
  const dataHorasCorr=ymsAll.map(ym=>Math.round((horasCorrPorMes[ym]||0)*10)/10);
  const dataHorasPrev=ymsAll.map(ym=>Math.round((horasPrevPorMes[ym]||0)*10)/10);

  // Resumen numérico arriba del chart
  const totC=dataCosto.reduce((s,v)=>s+v,0);
  const totHc=dataHorasCorr.reduce((s,v)=>s+v,0);
  const totHp=dataHorasPrev.reduce((s,v)=>s+v,0);
  const totalsEl=document.getElementById('comboTotals');
  if(totalsEl){
    // El resumen suma TODOS los meses graficados (no solo 2026), así que el label
    // refleja el período real mostrado en vez de un "2026" fijo que mentía cuando
    // el chart incluye histórico 2025.
    const periodo=ymsAll.length?(labels[0]===labels[labels.length-1]?labels[0]:`${labels[0]}–${labels[labels.length-1]}`):'';
    setHTML(totalsEl, ymsAll.length
      ?html`acumulado ${periodo} · <span class="v-costo">${formatMoney(totC)}</span> en repuestos<span class="sep">·</span><span class="v-corr">${totHc.toFixed(0)} hr</span> correctivo<span class="sep">·</span><span class="v-prev">${totHp.toFixed(0)} hr</span> preventivo`
      :'sin datos para graficar');
  }

  if(_chartComboFlota){_chartComboFlota.destroy();_chartComboFlota=null;}
  const elCombo=document.getElementById('chartComboFlota');
  if(elCombo&&ymsAll.length){
    _chartComboFlota=new Chart(elCombo.getContext('2d'),{
      type:'bar',
      data:{
        labels,
        datasets:[
          {
            type:'bar',
            label:'Costo en repuestos',
            data:dataCosto,
            backgroundColor:AMBER+'cc',
            borderColor:AMBER,
            borderWidth:1,
            maxBarThickness:48,
            yAxisID:'yCosto',
            order:2,  // las barras detrás de la línea
          },
          {
            type:'line',
            label:'Horas correctivo',
            data:dataHorasCorr,
            borderColor:RED,
            backgroundColor:RED+'20',
            borderWidth:2.5,
            pointBackgroundColor:RED,
            pointBorderColor:'#fff',
            pointBorderWidth:1.5,
            pointRadius:4.5,
            pointHoverRadius:6.5,
            fill:false,
            tension:0.35,
            yAxisID:'yHoras',
            order:1,  // líneas delante de las barras
          },
          {
            type:'line',
            label:'Horas preventivo',
            data:dataHorasPrev,
            borderColor:CORP,
            backgroundColor:CORP+'20',
            borderWidth:2.5,
            pointBackgroundColor:CORP,
            pointBorderColor:'#fff',
            pointBorderWidth:1.5,
            pointRadius:4.5,
            pointHoverRadius:6.5,
            fill:false,
            tension:0.35,
            yAxisID:'yHoras',
            order:0,
          }
        ]
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        interaction:{mode:'index',intersect:false}, // hover sobre el mes muestra ambos
        plugins:{
          legend:{display:false}, // la leyenda la pinto a mano arriba (más linda)
          tooltip:{
            backgroundColor:TOOLTIP_BG,
            titleColor:TOOLTIP_FG,
            bodyColor:TOOLTIP_FG,
            padding:12,
            borderColor:GRID,
            borderWidth:1,
            titleFont:{family:'JetBrains Mono',size:11,weight:'600'},
            bodyFont:{family:'Inter',size:12},
            bodySpacing:6,
            callbacks:{
              label:c=>{
                if(c.dataset.label==='Costo en repuestos')return '  ▣ '+formatMoney(c.raw)+' en repuestos';
                if(c.dataset.label==='Horas correctivo')   return '  ─ '+c.raw.toFixed(1)+' hr correctivo';
                if(c.dataset.label==='Horas preventivo')   return '  ─ '+c.raw.toFixed(1)+' hr preventivo';
                return c.raw;
              }
            }
          }
        },
        scales:{
          x:{
            ticks:{color:TEXT2,font:{size:11,family:'JetBrains Mono',weight:'500'}},
            grid:{display:false},
            border:{color:GRID}
          },
          yCosto:{
            type:'linear',
            position:'left',
            beginAtZero:true,
            title:{display:true,text:'$ repuestos',color:AMBER,font:{size:10,family:'JetBrains Mono',weight:'600'},padding:{bottom:8}},
            ticks:{color:AMBER,font:{size:10,family:'JetBrains Mono'},callback:v=>v>=1e6?'$'+(v/1e6).toFixed(1)+'M':v>=1e3?'$'+(v/1e3).toFixed(0)+'K':'$'+v},
            grid:{color:GRID,drawTicks:false},
            border:{display:false}
          },
          yHoras:{
            type:'linear',
            position:'right',
            beginAtZero:true,
            title:{display:true,text:'horas',color:CORP,font:{size:10,family:'JetBrains Mono',weight:'600'},padding:{bottom:8}},
            ticks:{color:CORP,font:{size:10,family:'JetBrains Mono'},callback:v=>v+' h'},
            grid:{display:false}, // sin grid del eje derecho para no saturar
            border:{display:false}
          }
        }
      }
    });
  }

  // ─── Ranking 1: top 10 más costosos ───────────────────────────────
  // Suma costo total por equipo desde _costosPorMes
  const costoPorEquipo={};
  for(const ym of Object.keys(costosPorMes)){
    for(const[codN,v]of Object.entries(costosPorMes[ym]||{})){
      costoPorEquipo[codN]=(costoPorEquipo[codN]||0)+(v||0);
    }
  }
  const topCosto=Object.entries(costoPorEquipo)
    .filter(([,v])=>v>0)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,10);
  const maxCosto=topCosto[0]?.[1]||1;
  const _eqByCodN=codN=>(window._equiposOrdenados||[]).find(e=>normCod(e.codigo)===codN);
  setHTML(document.getElementById('rankCosto'), topCosto.length
    ?topCosto.map(([codN,v],i)=>{
      const eq=_eqByCodN(codN);const codDisplay=eq?eq.codigo:codN;
      return html`<div class="rank-row" data-action="scrollToEquipo" data-arg="${codDisplay}" title="Ver detalle">
        <span class="rank-pos${i<3?' top':''}">${String(i+1).padStart(2,'0')}</span>
        <span class="rank-cod">${codDisplay}</span>
        <div class="rank-bar-wrap"><div class="rank-bar-fill" style="width:${Math.round(v/maxCosto*100)}%;background:${AMBER};box-shadow:0 0 8px ${AMBER}80"></div></div>
        <span class="rank-val">${formatMoney(v)}</span>
      </div>`;
    })
    :html`<div class="no-data">Sin datos de costos.</div>`);

  // ─── Ranking 2: top 10 más horas en taller ───────────────────────
  const horasPorEq=window._horasPorEquipo||{};
  const topHoras=Object.entries(horasPorEq)
    .filter(([,v])=>v>0)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,10);
  const maxHoras=topHoras[0]?.[1]||1;
  setHTML(document.getElementById('rankHoras'), topHoras.length
    ?topHoras.map(([codN,v],i)=>{
      const eq=_eqByCodN(codN);const codDisplay=eq?eq.codigo:codN;
      return html`<div class="rank-row" data-action="scrollToEquipo" data-arg="${codDisplay}" title="Ver detalle">
        <span class="rank-pos${i<3?' top':''}">${String(i+1).padStart(2,'0')}</span>
        <span class="rank-cod">${codDisplay}</span>
        <div class="rank-bar-wrap"><div class="rank-bar-fill" style="width:${Math.round(v/maxHoras*100)}%;background:${ACCENT};box-shadow:0 0 8px ${ACCENT}80"></div></div>
        <span class="rank-val">${v.toFixed(1)} hr</span>
      </div>`;
    })
    :html`<div class="no-data">Sin datos de horas trabajadas.<br><span style="font-size:10px;color:var(--amber)">Si PANEL_TRABAJOS está vacío, actualizalo desde el menú del Sheet maestro.</span></div>`);

  // Badge resumen en el header de la sección
  const badge=document.getElementById('telemetriaBadge');
  if(badge){
    const totalCosto=Object.values(costoPorEquipo).reduce((s,v)=>s+v,0);
    const totalHoras=Object.values(horasPorEq).reduce((s,v)=>s+v,0);
    badge.textContent=`${formatMoney(totalCosto)} · ${totalHoras.toFixed(0)} hr`;
  }
}

// Click en una fila del ranking → scroll al equipo y abrir su detalle
function scrollToEquipo(codigo){
  setTab('tabEquipos'); // los rankings viven en telemetría; la tarjeta está en el tab de equipos
  const id='eqcard_'+codigo.replace(/[^a-z0-9]/gi,'_');
  const el=document.getElementById(id);
  if(!el)return;
  el.scrollIntoView({behavior:'smooth',block:'center'});
  // breve highlight visual
  el.style.transition='box-shadow .3s ease';
  el.style.boxShadow='0 0 0 2px var(--accent), 0 0 20px var(--accent-tint)';
  setTimeout(()=>{el.style.boxShadow='';setTimeout(()=>{el.style.transition='';},300);},900);
}

/* ═══════════════════════════════════════════════════════════════════
   COSTOS DOWNTIME · tab con costo mensual correctivo en USD
   Tres componentes por mes y por equipo (solo trabajos/entregas CORRECTIVOS,
   mismo clasificador que el resto del panel: Reparación + Neumáticos):
     · repuestos:   COSTO ENTREGA (ARS) / tipo de cambio
     · mano de obra: hr TIEMPO TRABAJO × tarifa MO (ARS/h) / tipo de cambio
     · oportunidad: hr TIEMPO PARADA / hs disponibles mes × alquiler USD/mes
   Parámetros y alquileres viven en el sheet COSTOS DOWNTIME (SHEET_IDS.costos),
   editable por Marcos. Se lee DIRECTO por gviz (sin snapshot) para que un
   cambio de precio impacte con solo recargar el panel.
═══════════════════════════════════════════════════════════════════ */
async function cargarCostosDowntime(){
  const cont=document.getElementById('costosParams');
  try{
    const[paramRows,alqRows]=await Promise.all([
      fetchGvizObj(SHEET_IDS.costos,'PARAMETROS'),
      fetchGvizObj(SHEET_IDS.costos,'ALQUILERES'),
    ]);
    // Defaults acordados jul-2026; el sheet los pisa si están cargados.
    const cfg={tc:1400,moArsH:6800,horasMes:176,alq:{}};
    for(const r of paramRows){
      const k=String(_pickCol(r,['PARAMETRO','PARÁMETRO'])||'').toUpperCase();
      const v=parseMoney(String(_pickCol(r,['VALOR'])||''));
      if(!v)continue;
      if(k.includes('CAMBIO'))cfg.tc=v;
      else if(k.includes('TARIFA'))cfg.moArsH=v;
      else if(k.includes('HORAS'))cfg.horasMes=v;
    }
    for(const r of alqRows){
      const codN=normCod(String(_pickCol(r,['CODIGO','CÓDIGO'])||''));
      const usd=parseMoney(String(_pickCol(r,['ALQUILER_USD_MES','ALQUILER USD MES','ALQUILER'])||''));
      if(codN&&usd>0)cfg.alq[codN]=usd;
    }
    window._costosCfg=cfg;
    renderCostosDowntime();
  }catch(e){
    console.warn('[INGECO] costos downtime:',e);
    if(cont)setHTML(cont,html`<span style="color:var(--red)">No se pudo leer el sheet COSTOS DOWNTIME (${e.message||e}).</span><br>Verificá que esté compartido como «cualquiera con el enlace puede ver» y recargá con el botón de abajo.<br><br><button class="refresh-btn" data-action="cargarCostosDowntime">↻ reintentar</button>`);
  }
}

// Montos del tab de costos en ARS. formatMoney abrevia ($2.4M / $850K);
// para celdas de tabla queremos el número completo con miles es-AR.
const _fmtARS=n=>'$ '+Math.round(n).toLocaleString('es-AR');

function renderCostosDowntime(){
  const cfg=window._costosCfg;
  if(!cfg)return;
  const nomMes=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  const repCorr=window._costosCorrPorMes||{};        // {ym:{codN: ARS}}
  // Horas de mantenimiento correctivo (TIEMPO TRABAJO): alimentan MO y también
  // el costo de oportunidad. Definición de Marcos (jul-2026) — TIEMPO PARADA
  // se descartó porque el taller lo carga en 0 en casi todos los registros.
  const hCorr  =window._horasCorrPorMesYEquipo||{};  // {ym:{codN: hr correctivas}}

  const _anioAct=new Date().getFullYear();
  const yms=[...new Set([...Object.keys(repCorr),...Object.keys(hCorr)])]
    .filter(ym=>/^\d{4}-\d{2}$/.test(ym)&&+ym.slice(0,4)>=2020&&+ym.slice(0,4)<=_anioAct+1)
    .sort();
  const labels=yms.map(ym=>{const[y,mm]=ym.split('-');return`${nomMes[+mm-1]}'${y.slice(2)}`;});

  // Series por mes (ARS) + acumulado por equipo para el ranking.
  // Repuestos y MO son ARS nativos; la oportunidad convierte el alquiler
  // (USD/mes del sheet) a ARS con el tipo de cambio.
  const serRep=[],serMo=[],serOp=[];
  const porEquipo={};       // codN → {rep,mo,op,total}
  const sinAlq=new Set();   // equipos con horas de parada pero sin alquiler cargado
  const acc=(codN,campo,ars)=>{
    porEquipo[codN]=porEquipo[codN]||{rep:0,mo:0,op:0,total:0};
    porEquipo[codN][campo]+=ars;porEquipo[codN].total+=ars;
  };
  for(const ym of yms){
    let rep=0,mo=0,op=0;
    for(const[codN,ars]of Object.entries(repCorr[ym]||{})){rep+=ars;acc(codN,'rep',ars);}
    for(const[codN,hr]of Object.entries(hCorr[ym]||{})){
      const u=hr*cfg.moArsH;mo+=u;acc(codN,'mo',u);
      // Oportunidad con las MISMAS horas correctivas: hs / hs-mes × alquiler × TC
      const alq=cfg.alq[codN];
      if(!alq){if(hr>0)sinAlq.add(codN);continue;}
      const o=hr/cfg.horasMes*alq*cfg.tc;op+=o;acc(codN,'op',o);
    }
    serRep.push(Math.round(rep));serMo.push(Math.round(mo));serOp.push(Math.round(op));
  }
  const totRep=serRep.reduce((s,v)=>s+v,0);
  const totMo =serMo.reduce((s,v)=>s+v,0);
  const totOp =serOp.reduce((s,v)=>s+v,0);
  const totAll=totRep+totMo+totOp;
  const nMeses=yms.length||1;

  // Resumen arriba del chart + badge del tab
  const totalsEl=document.getElementById('costosTotals');
  if(totalsEl){
    const periodo=yms.length?(labels[0]===labels[labels.length-1]?labels[0]:`${labels[0]}–${labels[labels.length-1]}`):'';
    setHTML(totalsEl,yms.length
      ?html`promedio mensual <span class="v-costo">${_fmtARS(totAll/nMeses)}</span><span class="sep">·</span>acumulado ${periodo} <span class="v-costo">${_fmtARS(totAll)}</span><span class="sep">·</span>repuestos ${Math.round(totRep/totAll*100)||0}% · MO ${Math.round(totMo/totAll*100)||0}% · oportunidad ${Math.round(totOp/totAll*100)||0}%`
      :'sin datos correctivos para graficar');
  }
  const badge=document.getElementById('costosBadge');
  if(badge)badge.textContent=yms.length?formatMoney(totAll/nMeses)+'/mes':'—';

  // Tabla: costo mensual operativo por equipo, ordenada de mayor a menor.
  // Click en una fila → despliega debajo el gráfico mes a mes de ese equipo.
  // (El chart mensual de flota se sacó a pedido de Marcos — jul-2026; las
  // series serRep/serMo/serOp siguen calculadas por si se reincorpora.)
  const _eqByCodN=codN=>(window._equiposOrdenados||[]).find(e=>normCod(e.codigo)===codN);
  const filas=Object.entries(porEquipo)
    .filter(([,v])=>v.total>0)
    .sort((a,b)=>b[1].total-a[1].total);
  // Contexto para el gráfico desplegable (toggleCostoEquipo)
  window._costosYms=yms;
  window._costosYmLabels=labels;
  _cerrarCostoChart(); // si la tabla se re-renderiza, el chart abierto muere con ella
  const tablaEl=document.getElementById('costosTablaWrap');
  if(tablaEl){
    if(!filas.length){
      setHTML(tablaEl,'Sin datos correctivos.');
    }else{
      const cuerpo=filas.map(([codN,v],i)=>{
        const eq=_eqByCodN(codN);
        const codDisplay=eq?eq.codigo:codN;
        const nombre=eq?(eq.nombre||''):'';
        const conAlq=cfg.alq[codN]!=null;
        const opCell=conAlq
          ?html`<td style="text-align:right">${_fmtARS(v.op/nMeses)}</td>`
          :html`<td style="text-align:right;color:var(--text3)" title="Sin alquiler cargado en el sheet — costo de oportunidad no computable">N/A</td>`;
        return html`<tr id="costoRow_${codN}" data-action="toggleCostoEquipo" data-arg="${codN}" style="cursor:pointer" title="Ver gasto mensual del equipo">
          <td style="color:var(--text3)">${String(i+1).padStart(2,'0')}</td>
          <td class="mono" style="white-space:nowrap"><b>${codDisplay}</b> <span class="eq-chev" id="costoChev_${codN}">▸</span></td>
          <td>${nombre}</td>
          <td style="text-align:right">${_fmtARS(v.rep/nMeses)}</td>
          <td style="text-align:right">${_fmtARS(v.mo/nMeses)}</td>
          ${opCell}
          <td style="text-align:right;color:var(--amber)"><b>${_fmtARS(v.total/nMeses)}</b></td>
          <td style="text-align:right;color:var(--text3)">${_fmtARS(v.total)}</td>
        </tr>`.value;
      }).join('');
      setHTML(tablaEl,new RawHTML(`<div class="table-wrap"><table class="eq-inner-table">
        <thead><tr>
          <th>#</th><th>Código</th><th>Equipo</th>
          <th style="text-align:right">Repuestos /mes</th>
          <th style="text-align:right">Mano obra /mes</th>
          <th style="text-align:right">Oportunidad /mes</th>
          <th style="text-align:right">TOTAL ARS/mes</th>
          <th style="text-align:right">Acum. período</th>
        </tr></thead>
        <tbody>${cuerpo}</tbody>
      </table></div>`));
    }
  }

  // Card de parámetros: valores vigentes + advertencias + link para editar
  const paramsEl=document.getElementById('costosParams');
  if(paramsEl){
    const nAlq=Object.keys(cfg.alq).length;
    const sinAlqArr=[...sinAlq].sort();
    const sinAlqTxt=sinAlqArr.length
      ?html`<br><span style="color:var(--amber)">⚠ ${String(sinAlqArr.length)} equipos con horas correctivas pero SIN alquiler cargado (oportunidad no computada): ${sinAlqArr.slice(0,12).map(c=>{const eq=_eqByCodN(c);return eq?eq.codigo:c;}).join(', ')}${sinAlqArr.length>12?'…':''}. Cargalos en la pestaña ALQUILERES.</span>`
      :new RawHTML('');
    setHTML(paramsEl,html`
      <b>Tipo de cambio:</b> ${cfg.tc.toLocaleString('es-AR')} ARS/USD ·
      <b>Mano de obra:</b> ${cfg.moArsH.toLocaleString('es-AR')} ARS/h ·
      <b>Hs disp./mes:</b> ${String(cfg.horasMes)} ·
      <b>Alquileres cargados:</b> ${String(nAlq)} equipos<br>
      <b>Criterio correctivo:</b> RAZÓN = Reparación. Neumáticos EXCLUIDOS de este cálculo (en el KPI de horas del panel siguen contando como correctivo).<br>
      <b>Moneda:</b> todos los montos en ARS. Repuestos y mano de obra son ARS nativos; el tipo de cambio se usa solo para pasar el alquiler (USD/mes del sheet) a ARS en el costo de oportunidad.<br>
      <b>Oportunidad:</b> hs de mantenimiento correctivo (las mismas de MO) / ${String(cfg.horasMes)} hs × alquiler mensual × TC. No incluye esperas de repuestos ni traslados → es un piso, no el tiempo total fuera de servicio.${sinAlqTxt}<br><br>
      <a href="https://docs.google.com/spreadsheets/d/${SHEET_IDS.costos}/edit" target="_blank" rel="noopener noreferrer" style="color:var(--blue);text-decoration:none">Editar parámetros y alquileres ↗</a> ·
      <a style="color:var(--blue);cursor:pointer" data-action="cargarCostosDowntime">↻ releer sheet</a>`);
  }
}

/* ── Gráfico desplegable: gasto mensual de UN equipo ──────────────────
   Click en una fila de la tabla → se inserta una fila debajo con un chart
   de barras apiladas (repuestos + MO + oportunidad, USD) mes a mes.
   Un solo chart abierto a la vez. Segundo click en la misma fila: colapsa. */
let _costoChartEq=null;   // instancia Chart abierta
let _costoChartCod=null;  // codN de la fila expandida

function _cerrarCostoChart(){
  if(_costoChartEq){try{_costoChartEq.destroy();}catch(_){}_costoChartEq=null;}
  const row=document.getElementById('costoChartRow');
  if(row)row.remove();
  if(_costoChartCod){
    const chev=document.getElementById('costoChev_'+_costoChartCod);
    if(chev)chev.textContent='▸';
  }
  _costoChartCod=null;
}

function toggleCostoEquipo(codN){
  if(typeof Chart==='undefined')return;
  const mismo=(_costoChartCod===codN);
  _cerrarCostoChart();
  if(mismo)return; // era un colapso
  const filaEq=document.getElementById('costoRow_'+codN);
  const cfg=window._costosCfg;
  const yms=window._costosYms||[];
  if(!filaEq||!cfg||!yms.length)return;

  // Series mensuales del equipo desde los mapas correctivos globales.
  // ARS: repuestos y MO nativos; oportunidad usa las MISMAS horas correctivas
  // que la MO y convierte el alquiler USD→ARS con el TC.
  const repCorr=window._costosCorrPorMes||{};
  const hCorr=window._horasCorrPorMesYEquipo||{};
  const alq=cfg.alq[codN];
  const dRep=yms.map(ym=>Math.round((repCorr[ym]||{})[codN]||0));
  const dMo =yms.map(ym=>Math.round(((hCorr[ym]||{})[codN]||0)*cfg.moArsH));
  const dOp =yms.map(ym=>alq?Math.round(((hCorr[ym]||{})[codN]||0)/cfg.horasMes*alq*cfg.tc):0);

  // Fila nueva debajo de la del equipo, con canvas creado por DOM API (CSP-safe)
  const tr=document.createElement('tr');
  tr.id='costoChartRow';
  const td=document.createElement('td');
  td.colSpan=filaEq.children.length;
  td.style.cssText='padding:14px 12px;background:var(--bg2)';
  const wrap=document.createElement('div');
  wrap.style.cssText='position:relative;height:240px';
  const canvas=document.createElement('canvas');
  wrap.appendChild(canvas);td.appendChild(wrap);tr.appendChild(td);
  filaEq.after(tr);
  const chev=document.getElementById('costoChev_'+codN);
  if(chev)chev.textContent='▾';
  _costoChartCod=codN;

  const AMBER=_cssVar('--amber','#ffa030');
  const CORP =_cssVar('--corp','#5d80e8');
  const RED  =_cssVar('--red','#e5484d');
  const GRID =_cssVar('--chart-grid','#1a2030');
  const TEXT2=_cssVar('--text2','#aab3c8');
  const TOOLTIP_BG=_cssVar('--chart-tooltip-bg','#0d1019');
  const TOOLTIP_FG=_cssVar('--chart-tooltip-fg','#f1f4fb');
  const mkDs=(label,data,color)=>({type:'bar',label,data,backgroundColor:color+'cc',borderColor:color,borderWidth:1,maxBarThickness:44,stack:'usd'});
  _costoChartEq=new Chart(canvas.getContext('2d'),{
    type:'bar',
    data:{labels:window._costosYmLabels||yms,datasets:[
      mkDs('Repuestos',dRep,AMBER),
      mkDs('Mano de obra',dMo,CORP),
      mkDs('Oportunidad',dOp,RED),
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:true,position:'top',labels:{color:TEXT2,font:{size:10,family:'JetBrains Mono'},boxWidth:10}},
        tooltip:{
          backgroundColor:TOOLTIP_BG,titleColor:TOOLTIP_FG,bodyColor:TOOLTIP_FG,
          padding:12,borderColor:GRID,borderWidth:1,
          titleFont:{family:'JetBrains Mono',size:11,weight:'600'},
          bodyFont:{family:'Inter',size:12},bodySpacing:6,
          callbacks:{
            label:c=>`  ${c.dataset.label}: ${_fmtARS(c.raw)}`,
            footer:items=>'Total: '+_fmtARS(items.reduce((s,i)=>s+i.raw,0)),
          }
        }
      },
      scales:{
        x:{stacked:true,ticks:{color:TEXT2,font:{size:11,family:'JetBrains Mono',weight:'500'}},grid:{display:false},border:{color:GRID}},
        y:{stacked:true,beginAtZero:true,
          ticks:{color:TEXT2,font:{size:10,family:'JetBrains Mono'},callback:v=>formatMoney(v)},
          grid:{color:GRID,drawTicks:false},border:{display:false}},
      }
    }
  });
}

function renderPedidosPendientesGlobal(){
  const todos=window._pedidosAll||[];
  const activos=todos.filter(p=>{const l=(p.estado||'').toLowerCase();
    return l.includes('pendiente')||l.includes('parcial')||l.includes('comprado');
  });
  // Ordenar: más nuevos primero
  activos.sort((a,b)=>toSortDate(b.fecha)-toSortDate(a.fecha));

  // Llenar dropdown de equipos solo la primera vez
  const selEq=document.getElementById('pendFiltroEq');
  if(selEq&&selEq.options.length<=1){
    const codigos=[...new Set(activos.map(p=>p.codigoRaw).filter(c=>c&&c!=='—'))].sort();
    for(const c of codigos){
      const opt=document.createElement('option');opt.value=c;opt.textContent=c;
      selEq.appendChild(opt);
    }
  }

  // Aplicar filtros
  const filEq=document.getElementById('pendFiltroEq')?.value||'';
  const filEst=(document.getElementById('pendFiltroEst')?.value||'').toLowerCase();
  const filBus=(document.getElementById('pendBuscador')?.value||'').toLowerCase().trim();
  const filtrados=activos.filter(p=>{
    if(filEq&&p.codigoRaw!==filEq)return false;
    if(filEst&&!(p.estado||'').toLowerCase().includes(filEst))return false;
    if(filBus){
      const blob=`${p.desc||''} ${p.equipo||''} ${p.codigoRaw||''} ${p.nro||''}`.toLowerCase();
      if(!blob.includes(filBus))return false;
    }
    return true;
  });

  // Badge y summary
  const badge=document.getElementById('pedidosPendBadge');
  if(badge)badge.textContent=`${activos.length} activos`;
  const summary=document.getElementById('pendSummary');
  if(summary){
    const totMostrados=filtrados.length;
    setHTML(summary, html`Mostrando <span class="count">${totMostrados}</span> de ${activos.length} pedidos activos`);
  }

  // Render tabla
  const body=document.getElementById('pedidosPendBody');
  if(!filtrados.length){
    setHTML(body, html`<div class="no-data" style="padding:24px">${activos.length?'Sin resultados con los filtros aplicados.':'No hay pedidos pendientes.'}</div>`);
    return;
  }
  const estadoBadge=est=>{
    const e=(est||'').toLowerCase();
    if(e.includes('pendiente'))return html`<span class="badge badge-amber">Pendiente</span>`;
    if(e.includes('parcial'))  return html`<span class="badge badge-blue">Parcial</span>`;
    if(e.includes('comprado')) return html`<span class="badge badge-green">Comprado</span>`;
    return html`<span class="badge badge-gray">${est||'—'}</span>`;
  };
  const hoy=new Date();
  const diasDesde=fecha=>{
    const d=_parseDate(fecha);if(!d)return null;
    return Math.round((hoy-d)/86400000);
  };
  const renderDias=dias=>{
    if(dias==null)return html`<span style="color:var(--text3)">—</span>`;
    let color='var(--text2)';
    if(dias<=7)color='var(--text2)';
    else if(dias<=21)color='var(--amber)';
    else color='var(--red)';
    return html`<span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:${color};font-weight:500">${dias}d</span>`;
  };

  setHTML(body, html`<div class="table-wrap"><table>
    <thead><tr>
      <th style="width:70px">N°</th>
      <th style="width:90px">Fecha</th>
      <th style="width:90px">Código</th>
      <th>Equipo</th>
      <th>Descripción</th>
      <th style="width:90px;text-align:center">Antigüedad</th>
      <th style="width:90px">Estado</th>
    </tr></thead>
    <tbody>${filtrados.map(p=>{
      const codClickable=p.codigoRaw&&p.codigoRaw!=='—'
        ?html`<a class="mono" style="color:var(--accent);cursor:pointer;text-decoration:none" data-action="scrollToEquipo" data-arg="${p.codigoRaw}">${p.codigoRaw}</a>`
        :html`<span class="mono" style="color:var(--text3)">—</span>`;
      return html`<tr>
        <td class="mono" style="font-size:11px">#${p.nro}</td>
        <td class="mono" style="font-size:10.5px;color:var(--text3);white-space:nowrap">${formatFechaCorta(p.fecha)}</td>
        <td>${codClickable}</td>
        <td style="font-size:11.5px">${p.equipo||'—'}</td>
        <td style="font-size:12px;color:var(--text2)">${p.desc||'—'}</td>
        <td style="text-align:center">${renderDias(diasDesde(p.fecha))}</td>
        <td>${estadoBadge(p.estado)}</td>
      </tr>`;
    })}</tbody>
  </table></div>`);
}

/* ═══════════════════════════════════════════════════════════════════
   AUTO-REFRESH · dropdown con countdown
═══════════════════════════════════════════════════════════════════ */
let _autoTimer=null, _autoSecs=0, _autoInterval=0;
function setAutoRefresh(){
  const sel=document.getElementById('autoSelect');
  const secs=parseInt(sel?.value||'0',10);
  _autoInterval=secs;
  if(_autoTimer){clearInterval(_autoTimer);_autoTimer=null;}
  const cd=document.getElementById('autoCountdown');
  if(!secs){cd.classList.remove('visible');cd.textContent='—';return;}
  _autoSecs=secs;
  cd.classList.add('visible');
  _renderAutoCD();
  _autoTimer=setInterval(()=>{
    _autoSecs--;
    if(_autoSecs<=0){
      _autoSecs=_autoInterval;
      loadAll();
    }
    _renderAutoCD();
  },1000);
}
function _renderAutoCD(){
  const cd=document.getElementById('autoCountdown');if(!cd)return;
  const m=Math.floor(_autoSecs/60),s=_autoSecs%60;
  cd.textContent=m>0?`${m}m ${String(s).padStart(2,'0')}s`:`${s}s`;
}

// ═══════════════════════════════════════════════════════════════════
// DIAGNÓSTICO TEMPORAL — Ejecutar desde la consola: diag('RTP-01')
// Remover esta función cuando se resuelva el problema.
// ═══════════════════════════════════════════════════════════════════
window.diag=function(codigo){
  const cn=normCod(codigo||'');
  console.log('%c═══ diag("'+codigo+'") · normalizado: '+cn+' ═══','color:#3b82f6;font-weight:bold');

  // 1) Hoja ENTREGADOS
  const pedEnt=window._pedidosEntregados||[];
  console.log('%c[1] _pedidosEntregados — '+pedEnt.length+' filas totales','color:#10b981;font-weight:bold');
  if(pedEnt.length){
    console.log('    Keys (nombres de columna reales):',Object.keys(pedEnt[0]));
    console.log('    Primer objeto completo:',pedEnt[0]);
    const mias=pedEnt.filter(p=>normCod((window.pickCol||((o,c)=>''))(p,(window.COLS_PED||{codigo:['CODIGO']}).codigo))===cn);
    console.log('    Filas que matchean "'+cn+'":',mias.length);
    if(mias.length)console.log('    Primer match:',mias[0]);
  }

  // 2) Hoja PENDIENTES
  const pedAll=window._pedidosAll||[];
  console.log('%c[2] _pedidosAll (pendientes) — '+pedAll.length+' filas','color:#10b981;font-weight:bold');
  if(pedAll.length){
    console.log('    Keys del primer objeto:',Object.keys(pedAll[0]));
    console.log('    Primer objeto:',pedAll[0]);
    const mp=pedAll.filter(p=>p.codigo===cn);
    console.log('    Filas que matchean:',mp.length);
    if(mp.length)console.log('    Primer match:',mp[0]);
  }

  // 3) Costos por mes (de hojas MESES_ENTREGAS)
  const cpm=window._costosPorMes||{};
  console.log('%c[3] _costosPorMes para "'+cn+'"','color:#f59e0b;font-weight:bold');
  let total=0;
  for(const ym of Object.keys(cpm).sort()){
    const v=(cpm[ym]||{})[cn]||0;
    console.log('    '+ym+': $'+v);
    total+=v;
  }
  console.log('    %cTOTAL 2026: $'+total,'font-weight:bold');

  // 4) Items detallados (de hojas mensuales)
  const ipe=window._itemsPorEntrega||{};
  console.log('%c[4] _itemsPorEntrega — '+Object.keys(ipe).length+' N° entrega con items detallados','color:#f59e0b;font-weight:bold');
  const sample=Object.keys(ipe).slice(0,3);
  for(const k of sample){console.log('    Entrega "'+k+'":',ipe[k]);}

  // 5) Costos por entrega
  const ec=window._entregaCostos||{};
  console.log('%c[5] _entregaCostos — '+Object.keys(ec).length+' entregas con costo registrado','color:#f59e0b;font-weight:bold');
  const sampleEc=Object.keys(ec).slice(0,3);
  for(const k of sampleEc){console.log('    Entrega "'+k+'":',ec[k]);}

  // 6) Entregas por equipo (PANEL_REPUESTOS)
  const epe=(window._entregasPorEquipo||{})[cn]||[];
  console.log('%c[6] _entregasPorEquipo["'+cn+'"] — '+epe.length+' filas (de PANEL_REPUESTOS)','color:#8b5cf6;font-weight:bold');
  epe.slice(0,5).forEach((e,i)=>console.log('    ['+i+']:',e));

  // 7) Lookup N° PEDIDO → fecha (para calcular demora cruzando ENTREGADOS con PENDIENTES)
  const fpn=window._fechaPedidoByNro||{};
  const totalLookup=Object.keys(fpn).length;
  console.log('%c[7] _fechaPedidoByNro — '+totalLookup+' N° pedido con fecha en PENDIENTES','color:#06b6d4;font-weight:bold');
  // Para cada pedido entregado del equipo, ver si tiene match en el lookup
  if(pedEnt.length){
    const pickC=(o,c)=>{for(const k of c){if(o[k]!=null&&String(o[k]).trim()!=='')return String(o[k]).trim();}return'';};
    const candNro=['N° PEDIDO','Nº PEDIDO','N PEDIDO','NRO PEDIDO','NUMERO PEDIDO','PEDIDO','N° DE PEDIDO'];
    const candFecP=['FECHA PEDIDO','FECHA DEL PEDIDO','F PEDIDO','F. PEDIDO','FECHA DE PEDIDO'];
    const candFecE=['FECHA ENTREGA','FECHA DE ENTREGA','F ENTREGA','F. ENTREGA'];
    const candCod=['CODIGO','CÓDIGO','COD','CODIGO EQUIPO'];
    const mias=pedEnt.filter(p=>normCod(pickC(p,candCod))===cn);
    console.log('    Pedidos entregados de "'+cn+'": '+mias.length);
    mias.slice(0,8).forEach((p,i)=>{
      const nro=pickC(p,candNro);
      const fechaPedHoja=pickC(p,candFecP);
      const fechaPedLookup=nro?fpn[nro]:null;
      const fechaEnt=pickC(p,candFecE);
      const fuente=fechaPedHoja?'hoja ENTREGADOS':(fechaPedLookup?'cruce PENDIENTES':'NO RESUELTA');
      console.log('    ['+i+'] N°='+nro+' | F.Ped='+(fechaPedHoja||fechaPedLookup||'∅')+' ('+fuente+') | F.Ent='+fechaEnt);
    });
  }

  return '✓ diag completo — revisá los bloques [1]–[7] arriba';
};
// Exponer también pickCol y COLS_PED para que diag los use (están dentro de openEquipoDetail por ahora)
// Si están definidos en otro scope, diag igual funciona con la guarda inline.

/* ═══════════════════════════════════════════════════════════════════
   MODAL: Service crítico — lista clickeable de equipos pasados/al borde
═══════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════
   MODAL DE DETALLE DE KPI · listado de equipos clickeable
═══════════════════════════════════════════════════════ */
// Devuelve nombre legible del equipo a partir del cód normalizado.
function _equipoLabel(codN){
  const info=(window._estadoEquipos||{})[codN]||{};
  const eq=(window._equiposOrdenados||[]).find(e=>normCod(e.codigo)===codN);
  const rawCod=info.rawCod||eq?.codigo||codN;
  const nombre=buildEquipoNombre(eq?.clasificacion||info.clasificacion,eq?.marca||info.marca,eq?.modelo||info.modelo,eq?.nombre||info.equipo);
  return{rawCod,nombre:nombre||codN};
}
// Listado de equipos por costo en repuestos para un rango de YMs.
function _listadoEquiposCosto(yms){
  const cpm=window._costosPorMes||{};
  const acc={};
  for(const ym of yms){
    const m=cpm[ym]||{};
    for(const codN of Object.keys(m))acc[codN]=(acc[codN]||0)+(m[codN]||0);
  }
  const arr=Object.entries(acc).filter(([_,v])=>v>0).map(([codN,v])=>{
    const{rawCod,nombre}=_equipoLabel(codN);
    return{codN,rawCod,nombre,valor:v};
  });
  arr.sort((a,b)=>b.valor-a.valor);
  return arr;
}
// Listado de equipos por horas en taller para un rango de YMs.
function _listadoEquiposHoras(yms){
  const hpme=window._horasPorMesYEquipo||{};
  const acc={};
  for(const ym of yms){
    const m=hpme[ym]||{};
    for(const codN of Object.keys(m))acc[codN]=(acc[codN]||0)+(m[codN]||0);
  }
  const arr=Object.entries(acc).filter(([_,v])=>v>0).map(([codN,v])=>{
    const{rawCod,nombre}=_equipoLabel(codN);
    return{codN,rawCod,nombre,valor:v};
  });
  arr.sort((a,b)=>b.valor-a.valor);
  return arr;
}
// Listado de equipos por gasto en combustible livianos para un rango de YMs.
function _listadoEquiposCombustible(yms){
  const cpe=window._combustiblePorEquipo||{};
  const ymsSet=new Set(yms);
  const acc={};
  for(const codN of Object.keys(cpe)){
    const e=cpe[codN];
    if(!e||!e.cargas)continue;
    let total=0;
    for(const c of e.cargas){
      const d=_parseDate(c.fecha);
      if(!d)continue;
      const ym=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      if(ymsSet.has(ym))total+=(c.costo||0);
    }
    if(total>0)acc[codN]=total;
  }
  const arr=Object.entries(acc).map(([codN,v])=>{
    const{rawCod,nombre}=_equipoLabel(codN);
    return{codN,rawCod,nombre,valor:v};
  });
  arr.sort((a,b)=>b.valor-a.valor);
  return arr;
}
const _KPI_DETAIL_CFG={
  costo:{label:'Costo en repuestos',getList:_listadoEquiposCosto,formatVal:v=>formatMoney(v),unitLabel:'$'},
  horas:{label:'Horas en taller',  getList:_listadoEquiposHoras,formatVal:v=>fmtInt(Math.round(v))+' hr',unitLabel:'hr'},
  combustible:{label:'Combustible livianos',getList:_listadoEquiposCombustible,formatVal:v=>formatMoney(v),unitLabel:'$'},
};
function abrirDetalleKpi(tipo){
  const cfg=_KPI_DETAIL_CFG[tipo];
  if(!cfg)return;
  const yms=_kpiYms();
  const labelRango=_kpiLabel();
  const lista=cfg.getList(yms);
  const total=lista.reduce((s,x)=>s+x.valor,0);
  const overlay=document.getElementById('kpiDetailOverlay');
  const titleEl=document.getElementById('kpiDetailTitle');
  const subEl=document.getElementById('kpiDetailSub');
  const listEl=document.getElementById('kpiDetailList');
  if(!overlay||!listEl)return;
  titleEl.textContent=`${cfg.label} · ${labelRango}`;
  setHTML(subEl, html`<span class="v-total">${cfg.formatVal(total)}</span> · ${fmtInt(lista.length)} ${lista.length===1?'equipo':'equipos'}`);
  if(!lista.length){
    setHTML(listEl, html`<div style="padding:36px;text-align:center;color:var(--text3);font-size:13px">Sin datos en el rango seleccionado.</div>`);
  }else{
    const maxVal=lista[0].valor||1;
    setHTML(listEl, lista.map(x=>{
      const pct=Math.round(x.valor/maxVal*100);
      const pctTotal=total>0?Math.round(x.valor/total*100):0;
      return html`<div class="kd-row" data-action="_irAEquipoDesdeKpiDetail" data-arg="${x.rawCod}" title="Abrir detalle del equipo">
        <div class="kd-cod">${x.rawCod}</div>
        <div class="kd-nom">${x.nombre}</div>
        <div class="kd-val">${cfg.formatVal(x.valor)}<small>${pctTotal}% del total</small></div>
        <div class="kd-bar"><div class="kd-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
    }));
  }
  overlay.classList.add('open');
  document.body.style.overflow='hidden';
}
function cerrarDetalleKpi(){
  const overlay=document.getElementById('kpiDetailOverlay');
  if(!overlay)return;
  overlay.classList.remove('open');
  document.body.style.overflow='';
}
function _irAEquipoDesdeKpiDetail(codigo){
  cerrarDetalleKpi();
  setTab('tabEquipos');
  const id='eqcard_'+String(codigo).replace(/[^a-z0-9]/gi,'_');
  const open=()=>{
    const card=document.getElementById(id);
    if(!card)return false;
    card.classList.remove('hidden');
    toggleEquipoDetail(codigo,card);
    card.scrollIntoView({behavior:'smooth',block:'center'});
    return true;
  };
  if(!open())setTimeout(open,80);
}

function openServiceCriticoModal(){
  const list=window._serviceCriticosList||[];
  const wrap=document.getElementById('svModalList');
  const count=document.getElementById('svModalCount');
  const overlay=document.getElementById('svModalOverlay');
  if(!wrap||!overlay)return;
  count.textContent=fmtInt(list.length);
  if(!list.length){
    setHTML(wrap, html`<div style="padding:36px;text-align:center;color:var(--text3);font-size:13px">Sin equipos en estado crítico.</div>`);
  }else{
    setHTML(wrap, list.map(c=>{
      const restCls = (c.restantes!=null && c.restantes>0) ? ' amber' : '';
      const restStr = c.restantes==null ? '—'
        : c.restantes<=0 ? `−${fmtInt(Math.abs(c.restantes))}`
        : fmtInt(c.restantes);
      const restLbl = c.restantes==null ? 'sin estimado'
        : c.restantes<=0 ? 'pasado'
        : 'restantes';
      return html`<div class="sv-row" data-action="_irAEquipoDesdeKpi" data-arg="${c.codigo}" title="Abrir detalle del equipo">
        <div class="sv-cod">${c.codigo}</div>
        <div class="sv-nom">${c.nombre||'—'}</div>
        <div class="sv-hr"><small>actual</small>${c.hrActualFmt||'—'}</div>
        <div class="sv-hr"><small>próximo</small>${c.estimadoFmt||'—'}</div>
        <div class="sv-rest${restCls}"><small>${restLbl}</small>${restStr}</div>
      </div>`;
    }));
  }
  overlay.classList.add('open');
  document.body.style.overflow='hidden';
}
function closeServiceCriticoModal(){
  const overlay=document.getElementById('svModalOverlay');
  if(!overlay)return;
  overlay.classList.remove('open');
  document.body.style.overflow='';
}
/* Tab "service": TODOS los equipos con datos de service, ordenados por prioridad
   (tier de estado VENCIDO/CRÍTICO → INTERMEDIO → HOLGADO → sin-datos; dentro de
   cada tier, restantes ascendente = más pasado primero). Reusa operatividadEquipo
   (misma lógica del modal crítico). Solo lee del snapshot ya procesado — sin builder. */
function renderServiceTab(){
  const wrap=document.getElementById('svcTablaWrap');
  const badge=document.getElementById('serviceBadge');
  const sp=window._servicePanel||{};
  const est=window._estadoEquipos||{};
  const comb=window._combustiblePorEquipo||{};
  const TIER={critico:0,intermedio:1,holgado:2,'sin-datos':3};
  // Parser numérico tolerante (miles con punto, decimal coma; descarta '-', fechas, S/H).
  const num=v=>{const s=String(v==null?'':v).trim();if(!s||s==='-'||/\//.test(s)||/s\/?h/i.test(s))return null;const n=parseFloat(s.replace(/\./g,'').replace(',','.').replace(/[^\d.-]/g,''));return isFinite(n)?n:null;};
  const rows=Object.keys(sp).map(codN=>{
    const op=operatividadEquipo(codN);
    const info=est[codN]||{};
    const codigo=info.rawCod||sp[codN].codigo||codN;
    // Texto del badge: ESTADO real de la fuente (VENCIDO/CRÍTICO/INTERMEDIO/
    // HOLGADO) sin el símbolo ⚠, para distinguir vencido de crítico. Color = tier.
    const estadoTxt=String(sp[codN].estado||'').replace(/[^\p{L} ]/gu,'').trim();
    // Dato inconsistente (imposible): el último service quedó registrado POR ENCIMA
    // del hr/km actual del equipo. No podés hacer un service a más horas de las que
    // marca el horómetro hoy → o la fecha/lectura del service está mal, o el horómetro
    // de combustible está mal cargado. Lo marcamos "⚠ REVISAR" para que se examine y
    // corrija. No cambia ningún número: surface del dato sucio, no lo esconde.
    // (Antes también flageábamos "restantes > frecuencia", pero eso NO es error: solo
    //  dice que falta mucho para el próximo service. Se sacó.)
    const frecN=num(op.frecuencia||sp[codN].frecuencia), ultN=num(sp[codN].ultHrKm);
    const excesoUlt=(ultN!=null&&op.hrActual!=null&&ultN>op.hrActual+0.5)?(ultN-op.hrActual)/(frecN>0?frecN:1):0;
    const revisar=excesoUlt>0;
    // ¿DÓNDE está la discrepancia? Clasificamos la causa para dejarla escrita en el
    // tablero, en vez de solo decir "revisar". Tres orígenes posibles:
    //   • 'combustible' → typo en la carga: el equipo YA había superado ese horómetro
    //     en una carga anterior; solo la ÚLTIMA lectura bajó (dígito comido). Se
    //     corrige esa fila del sheet de combustible.
    //   • 'service' → la planilla de service tiene el último service por encima del
    //     hr/km real (sea el máximo de combustible, o el HR/KM ACTUAL del propio sheet
    //     cuando el equipo no carga combustible). Se corrige la hr/fecha del service.
    //   • 'codigo' → no hay combustible bajo este código pero SÍ bajo otros del mismo
    //     prefijo → el consumo puede estar cargándose con un código distinto.
    let causa='', causaTxt='', causaShort='';
    if(revisar){
      const cc=comb[codN];
      const hrsC=(cc&&cc.cargas)?cc.cargas.map(x=>x.hr).filter(h=>h!=null):[];
      const maxComb=hrsC.length?Math.max(...hrsC):null;
      if(op.fuente==='combustible'&&maxComb!=null&&maxComb+0.5>=ultN){
        causa='combustible';
        causaShort='typo en carga de combustible';
        causaTxt=`Typo en combustible: la última carga marcó ${fmtInt(op.hrActual)} pero una carga anterior ya llegó a ${fmtInt(maxComb)} (por encima del último service ${fmtInt(ultN)}). Corregir esa fila en la planilla de combustible.`;
      }else if(!cc){
        const pref=_prefijoCod(codN);
        const hayHermanos=Object.keys(comb).some(k=>k!==codN&&_prefijoCod(k)===pref);
        if(hayHermanos){
          causa='codigo';
          causaShort='posible código mal cargado';
          causaTxt=`Posible problema de código: no hay combustible bajo "${codigo}" pero sí bajo otros del prefijo ${pref}. El consumo puede estar cargándose con un código distinto. Verificar; si no, el último service (${fmtInt(ultN)}) quedó por encima del HR/KM actual del sheet de service (${fmtInt(op.hrActual)}).`;
        }else{
          causa='service';
          causaShort='planilla de service';
          causaTxt=`Planilla de service: el último service (${fmtInt(ultN)}) quedó por encima del HR/KM actual (${fmtInt(op.hrActual)}) en el propio sheet. Revisar la carga del service.`;
        }
      }else{
        causa='service';
        causaShort='planilla de service';
        causaTxt=`Planilla de service: el último service (${fmtInt(ultN)}) está por encima de la última lectura de combustible (${fmtInt(op.hrActual)}). Revisar la hr/fecha del último service.`;
      }
    }
    return {
      codigo,
      nombre: info.equipo||sp[codN].descripcion||'',
      nivel: op.nivel, label: estadoTxt||op.label,
      hrActual: op.hrActual, hrProximo: op.hrProximo, restantes: op.restantes,
      frecuencia: op.frecuencia||sp[codN].frecuencia||'',
      unidad: unidadDeEquipo(codigo),
      ultFecha: (comb[codN]&&comb[codN].ultimaFecha)||sp[codN].ultFecha||'',
      revisar, sev: excesoUlt, causa, causaShort, causaTxt,
    };
  });
  rows.sort((a,b)=>{
    if(a.revisar!==b.revisar)return a.revisar?-1:1;           // inconsistentes primero
    if(a.revisar&&b.revisar)return b.sev-a.sev;               // más grave arriba
    const ta=TIER[a.nivel]==null?9:TIER[a.nivel], tb=TIER[b.nivel]==null?9:TIER[b.nivel];
    if(ta!==tb)return ta-tb;
    const ra=a.restantes==null?Infinity:a.restantes, rb=b.restantes==null?Infinity:b.restantes;
    return ra-rb;
  });
  if(badge)badge.textContent=fmtInt(rows.filter(r=>r.nivel==='critico'&&!r.revisar).length);
  if(!wrap)return;
  if(!rows.length){ setHTML(wrap, html`<div class="svc-empty">Sin datos de service en el snapshot.</div>`); return; }
  const badgeCls=n=>n==='critico'?'red':n==='intermedio'?'amber':n==='holgado'?'blue':'gray';
  const fmtU=(v,u)=> v==null?'—':fmtInt(v)+' '+u;
  const head=html`<div class="svc-row svc-head">
    <div>código</div><div>equipo</div><div>estado</div>
    <div class="svc-num">actual</div><div class="svc-num">próximo</div>
    <div class="svc-num">restantes</div><div class="svc-num">frec.</div><div class="svc-num">últ. service</div>
  </div>`;
  const body=rows.map(r=>{
    const rest=r.restantes==null?'—':r.restantes<=0?'−'+fmtInt(Math.abs(r.restantes)):'+'+fmtInt(r.restantes);
    const restCls=r.restantes==null?'':r.restantes<=0?' red':' amber';
    const rowCls=r.revisar?' svc-revisar':(r.nivel==='sin-datos'?' svc-dim':'');
    const badgeC=r.revisar?'revisar':badgeCls(r.nivel);
    // El badge nombra el ORIGEN de la inconsistencia (combustible / service / código),
    // no solo "revisar". El detalle completo va en el tooltip de la fila.
    const badgeT=r.revisar
      ?(r.causa==='combustible'?'⚠ COMBUSTIBLE':r.causa==='codigo'?'⚠ CÓDIGO':'⚠ SERVICE')
      :(r.label||'sin datos');
    const tit=r.revisar?r.causaTxt:'Abrir detalle del equipo';
    return html`<div class="svc-row${new RawHTML(rowCls)}" data-action="_irAEquipoDesdeKpi" data-arg="${r.codigo}" title="${tit}">
      <div class="svc-cod">${r.codigo}</div>
      <div class="svc-nom" title="${r.nombre}">${r.nombre||'—'}${r.revisar?html`<span class="svc-causa">↳ ${r.causaShort}</span>`:''}</div>
      <div><span class="svc-badge ${new RawHTML(badgeC)}">${badgeT}</span></div>
      <div class="svc-num">${fmtU(r.hrActual,r.unidad)}</div>
      <div class="svc-num">${fmtU(r.hrProximo,r.unidad)}</div>
      <div class="svc-num svc-rest2${new RawHTML(restCls)}">${rest}</div>
      <div class="svc-num">${r.frecuencia||'—'}</div>
      <div class="svc-num">${r.ultFecha||'—'}</div>
    </div>`;
  });
  setHTML(wrap, html`${head}${body}`);
}
function _irAEquipoDesdeKpi(codigo){
  closeServiceCriticoModal();
  setTab('tabEquipos');
  const id='eqcard_'+String(codigo).replace(/[^a-z0-9]/gi,'_');
  const open=()=>{
    const card=document.getElementById(id);
    if(!card)return false;
    // Si los filtros lo dejaron oculto, lo des-ocultamos puntualmente para que aparezca.
    card.classList.remove('hidden');
    toggleEquipoDetail(codigo,card);
    card.scrollIntoView({behavior:'smooth',block:'center'});
    return true;
  };
  if(!open())setTimeout(open,80);
}
// Esc cierra el modal de service crítico o el modal de detalle de KPI.
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  const ovSv=document.getElementById('svModalOverlay');
  if(ovSv&&ovSv.classList.contains('open'))closeServiceCriticoModal();
  const ovKd=document.getElementById('kpiDetailOverlay');
  if(ovKd&&ovKd.classList.contains('open'))cerrarDetalleKpi();
});

// ═══════════════════════════════════════════════════════════════════
// ─── TAB CONSERVAR vs REEMPLAZAR ───
// Modelo de decisión de recambio de equipo. Motor = funciones puras
// (matemática de Marcos, jul-2026). Todo en ARS; `dolar` convierte USD.
// ═══════════════════════════════════════════════════════════════════

function _repValorHora(c){ return c.alquilerMensual / c.horasProductivasMes; }

function _repCostoViejo(c){
  const m = c.mesesHorizonte || 1;
  const service        = c.costos.serviceOficial * c.factorServiceNoOficial / m;
  const fallaCorriente = (c.costos.fallaTotal - c.costos.itemsUnicos) / m;
  const neumaticos     = c.costos.neumaticos / m;
  const oportunidad    = c.horas.improductivasViejo * _repValorHora(c) / m;
  return { service, fallaCorriente, neumaticos, oportunidad,
           total: service + fallaCorriente + neumaticos + oportunidad };
}

function _repCostoNuevo(c){
  const m           = c.mesesHorizonte || 1;
  const residualUSD = c.nuevo.precioUSD * c.nuevo.residualPct;
  const vidaMeses   = c.nuevo.vidaUtilAnios * 12;
  const capFinanciado = c.nuevo.precioUSD * (1 - c.nuevo.tradeInPct);
  const interesMensual = c.nuevo.tasaAnual > 0
    ? capFinanciado * (1 + c.nuevo.residualPct) / 2 * c.nuevo.tasaAnual / 12 * c.dolar
    : 0;
  const depreciacion = (c.nuevo.precioUSD - residualUSD) / vidaMeses * c.dolar;
  const service      = c.costos.serviceOficial / m;
  const reparaciones = c.nuevo.reparacionesMensual;
  const neumaticos   = c.costos.neumaticos / m;
  const oportunidad  = c.horas.serviceYGomas * _repValorHora(c) / m;
  return { depreciacion, interesMensual, service, reparaciones, neumaticos, oportunidad,
           total: depreciacion + interesMensual + service + reparaciones + neumaticos + oportunidad };
}

function _repRiesgoCola(c){
  const anual = c.modosFalla.reduce((s,f)=> s + (f.p||0) * (f.costo||0), 0);
  return { anual, mensual: anual / 12 };
}

function _repVidaBreakEven(c){
  const viejo  = _repCostoViejo(c);
  const riesgo = _repRiesgoCola(c);
  const viejoTotal = viejo.total + riesgo.mensual;
  const residualUSD = c.nuevo.precioUSD * c.nuevo.residualPct;
  const m = c.mesesHorizonte || 1;
  const nuevoSinDep = c.costos.serviceOficial / m + c.nuevo.reparacionesMensual
                    + c.costos.neumaticos / m + c.horas.serviceYGomas * _repValorHora(c) / m;
  const depNecesaria = viejoTotal - nuevoSinDep;
  if (depNecesaria <= 0) return Infinity;
  return (c.nuevo.precioUSD - residualUSD) * c.dolar / (depNecesaria * 12);
}

function _repEvaluar(c){
  const viejo  = _repCostoViejo(c);
  const nuevo  = _repCostoNuevo(c);
  const riesgo = _repRiesgoCola(c);
  const viejoTotal  = viejo.total + riesgo.mensual;
  const nuevoTotal  = nuevo.total;
  const netoMensual = nuevoTotal - viejoTotal;
  const umbralRiesgoMensual = nuevo.total - viejo.total;
  const cuotaMensual = c.nuevo.precioUSD * (1 - c.nuevo.tradeInPct)
                     / c.nuevo.plazoFinancMeses * c.dolar;
  return {
    viejo, nuevo, riesgo, viejoTotal, nuevoTotal, netoMensual,
    decision: netoMensual > 0 ? 'CONSERVAR' : 'REEMPLAZAR',
    umbralRiesgoMensual,
    umbralRiesgoAnual: umbralRiesgoMensual * 12,
    factorEscalaRiesgo: riesgo.anual > 0 ? (umbralRiesgoMensual * 12) / riesgo.anual : Infinity,
    cuotaMensual,
    vidaBreakEvenAnios: _repVidaBreakEven(c),
  };
}

const REP_LS_KEY = 'ingecov_reemplazo_v1';
const REP_MANUAL = '__manual__';

function _repDefaults(){
  return {
    codN: null,
    mesesHorizonte: 6,
    costos: { neumaticos: 0, serviceOficial: 0, fallaTotal: 0, itemsUnicos: 0 },
    horas:  { improductivasViejo: 0, serviceYGomas: 0 },
    alquilerMensual: 0, horasProductivasMes: 176, factorServiceNoOficial: 1/3, dolar: 1400,
    nuevo: { precioUSD: 180000, residualPct: 0.5, vidaUtilAnios: 10, tasaAnual: 0,
             tradeInPct: 0.5, plazoFinancMeses: 24, reparacionesMensual: 0 },
    modosFalla: [
      { nombre:'Caja', p:0.08, costo:15000000 },
      { nombre:'Motor', p:0.04, costo:25000000 },
      { nombre:'Diferencial', p:0.05, costo:9000000 },
      { nombre:'Turbo/inyección', p:0.08, costo:5000000 },
      { nombre:'Embrague pesado', p:0.06, costo:4000000 },
    ],
  };
}
let _repState = _repDefaults();

function _repLoadLS(){ try{ return JSON.parse(localStorage.getItem(REP_LS_KEY)||'{}'); }catch(_){ return {}; } }
function _repSaveLS(){
  try{
    const all = _repLoadLS();
    all[_repState.codN || REP_MANUAL] = _repState;
    localStorage.setItem(REP_LS_KEY, JSON.stringify(all));
  }catch(_){}
}

async function renderReemplazo(){
  const root = document.getElementById('repRoot');
  if(!root) return;
  if(!window._costosCfg){ try{ await cargarCostosDowntime(); }catch(_){}}

  const equipos = (window._equiposOrdenados||[])
    .filter(e=>e.codigo)
    .sort((a,b)=>String(a.codigo).localeCompare(String(b.codigo),'es'));
  const opciones = [`<option value="${REP_MANUAL}">— manual / sin equipo —</option>`]
    .concat(equipos.map(e=>{
      const codN = normCod(e.codigo);
      const sel = _repState.codN===codN ? ' selected' : '';
      const nom = e.nombre ? ' · '+esc(e.nombre) : '';
      return `<option value="${codN}"${sel}>${esc(e.codigo)}${nom}</option>`;
    })).join('');

  setHTML(root, new RawHTML(`
    <div class="rep-head">
      <div class="rep-head-title">conservar vs reemplazar · modelo de decisión</div>
      <select class="rep-select" id="repEquipoSel" data-action="repSelectEquipo" data-event="change">${opciones}</select>
    </div>
    <div id="repForm"></div>
    <div id="repResult"></div>
  `));
  _repRenderForm();
  repRecalc();
}

function _repInput(id, val, unit, step){
  const s = step!=null ? ` step="${step}"` : '';
  return `<div class="rep-row"><label>${unit||''}</label>`
       + `<input class="rep-input" id="${id}" type="number"${s} value="${val}" `
       + `data-action="repRecalc" data-event="input"></div>`;
}
function _repInputDerived(id, val, unit){
  return `<div class="rep-row"><label>${unit} <span class="rep-unit">(del panel)</span></label>`
       + `<input class="rep-input rep-derived" id="${id}" type="number" value="${val}" `
       + `data-action="repRecalc" data-event="input"></div>`;
}

function _repRenderForm(){
  const c = _repState;
  const cont = document.getElementById('repForm');
  if(!cont) return;
  const sinAlq = c.codN && window._costosCfg && window._costosCfg.alq[c.codN]==null;
  const warn = sinAlq
    ? `<div class="rep-warn">⚠ Este equipo no tiene alquiler cargado en el sheet (pestaña ALQUILERES). El costo de oportunidad no se computa; cargalo o completá "alquiler mensual" a mano.</div>`
    : '';
  const fallas = c.modosFalla.map((f,i)=>`
    <tr>
      <td><input class="rep-input" style="text-align:left" id="rep_falla_nombre_${i}" type="text" value="${esc(f.nombre)}" data-action="repRecalc" data-event="input"></td>
      <td><input class="rep-input" id="rep_falla_p_${i}" type="number" step="0.01" value="${f.p}" data-action="repRecalc" data-event="input"></td>
      <td><input class="rep-input" id="rep_falla_costo_${i}" type="number" value="${f.costo}" data-action="repRecalc" data-event="input"></td>
      <td><button class="rep-falla-del" data-action="repDelFalla" data-arg="${i}" title="Quitar">×</button></td>
    </tr>`).join('');

  setHTML(cont, new RawHTML(`
    <div class="rep-fieldset">
      <div class="rep-legend">Equipo actual · período con datos</div>
      <div class="rep-grid">
        ${_repInput('rep_mesesHorizonte', c.mesesHorizonte, 'Meses de horizonte')}
        ${_repInputDerived('rep_fallaTotal', c.costos.fallaTotal, 'Falla total (repuestos correctivos ARS)')}
        ${_repInput('rep_itemsUnicos', c.costos.itemsUnicos, 'Ítems únicos a excluir (ARS)')}
        ${_repInput('rep_serviceOficial', c.costos.serviceOficial, 'Service oficial (ARS)')}
        ${_repInput('rep_neumaticos', c.costos.neumaticos, 'Neumáticos (ARS)')}
        ${_repInputDerived('rep_improductivasViejo', c.horas.improductivasViejo, 'Horas improductivas (correctivo)')}
        ${_repInput('rep_serviceYGomas', c.horas.serviceYGomas, 'Horas service+gomas')}
        ${_repInputDerived('rep_alquilerMensual', c.alquilerMensual, 'Alquiler mensual (ARS)')}
        ${_repInput('rep_horasProductivasMes', c.horasProductivasMes, 'Horas productivas/mes')}
        ${_repInput('rep_factorServiceNoOficial', c.factorServiceNoOficial, 'Factor service no oficial', 0.01)}
        ${_repInputDerived('rep_dolar', c.dolar, 'Dólar (ARS/USD)')}
      </div>
      ${warn}
    </div>
    <div class="rep-fieldset">
      <div class="rep-legend">0km + financiación</div>
      <div class="rep-grid">
        ${_repInput('rep_precioUSD', c.nuevo.precioUSD, 'Precio 0km (USD)')}
        ${_repInput('rep_residualPct', c.nuevo.residualPct, 'Valor residual (0–1)', 0.05)}
        ${_repInput('rep_vidaUtilAnios', c.nuevo.vidaUtilAnios, 'Vida útil (años)')}
        ${_repInput('rep_tasaAnual', c.nuevo.tasaAnual, 'Tasa anual financ. (0–1)', 0.01)}
        ${_repInput('rep_tradeInPct', c.nuevo.tradeInPct, 'Trade-in (0–1)', 0.05)}
        ${_repInput('rep_plazoFinancMeses', c.nuevo.plazoFinancMeses, 'Plazo financ. (meses)')}
        ${_repInput('rep_reparacionesMensual', c.nuevo.reparacionesMensual, 'Reparaciones/mes (ARS)')}
      </div>
    </div>
    <div class="rep-fieldset">
      <div class="rep-legend">Riesgo de cola · modos de falla mayores</div>
      <table class="rep-falla-table">
        <thead><tr><th>Modo</th><th>Prob. anual</th><th>Costo (ARS)</th><th></th></tr></thead>
        <tbody>${fallas}</tbody>
      </table>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="rep-btn" data-action="repAddFalla">+ modo de falla</button>
        <button class="rep-btn" data-action="repReset">↻ restaurar defaults del equipo</button>
      </div>
    </div>
  `));
}

function _repDerivarEquipo(codN){
  const d = _repDefaults();
  d.codN = codN;
  const cfg = window._costosCfg;
  const corr = window._costosCorrPorMes || {};        // {ym:{codN:ARS}}
  const hCorr = window._horasCorrPorMesYEquipo || {};  // {ym:{codN:hr}}
  let fallaTotal = 0, horas = 0;
  const meses = new Set();
  for(const ym of Object.keys(corr)){
    const v = corr[ym][codN]; if(v){ fallaTotal += v; meses.add(ym); }
  }
  for(const ym of Object.keys(hCorr)){
    const v = hCorr[ym][codN]; if(v){ horas += v; meses.add(ym); }
  }
  d.costos.fallaTotal = Math.round(fallaTotal);
  d.horas.improductivasViejo = Math.round(horas*10)/10;
  d.mesesHorizonte = meses.size || 1;
  if(cfg){
    d.dolar = cfg.tc;
    d.horasProductivasMes = cfg.horasMes;
    const alqUSD = cfg.alq[codN];
    d.alquilerMensual = alqUSD!=null ? Math.round(alqUSD*cfg.tc) : 0;
  }
  return d;
}

function repSelectEquipo(val){
  if(val===REP_MANUAL){
    const saved = _repLoadLS()[REP_MANUAL];
    _repState = saved || _repDefaults();
    _repState.codN = null;
  }else{
    const codN = val;
    const derived = _repDerivarEquipo(codN);
    const saved = _repLoadLS()[codN];
    _repState = saved ? Object.assign(derived, saved, {codN}) : derived;
  }
  _repRenderForm();
  repRecalc();
}

function _repNum(id){ const el=document.getElementById(id); const v=el?parseFloat(el.value):NaN; return isFinite(v)?v:0; }
function _repStr(id){ const el=document.getElementById(id); return el?el.value:''; }

function repReadForm(){
  const c = _repState;
  c.mesesHorizonte        = _repNum('rep_mesesHorizonte') || 1;
  c.costos.fallaTotal     = _repNum('rep_fallaTotal');
  c.costos.itemsUnicos    = _repNum('rep_itemsUnicos');
  c.costos.serviceOficial = _repNum('rep_serviceOficial');
  c.costos.neumaticos     = _repNum('rep_neumaticos');
  c.horas.improductivasViejo = _repNum('rep_improductivasViejo');
  c.horas.serviceYGomas   = _repNum('rep_serviceYGomas');
  c.alquilerMensual       = _repNum('rep_alquilerMensual');
  c.horasProductivasMes   = _repNum('rep_horasProductivasMes') || 1;
  c.factorServiceNoOficial = _repNum('rep_factorServiceNoOficial');
  c.dolar                 = _repNum('rep_dolar');
  c.nuevo.precioUSD          = _repNum('rep_precioUSD');
  c.nuevo.residualPct        = _repNum('rep_residualPct');
  c.nuevo.vidaUtilAnios      = _repNum('rep_vidaUtilAnios') || 1;
  c.nuevo.tasaAnual          = _repNum('rep_tasaAnual');
  c.nuevo.tradeInPct         = _repNum('rep_tradeInPct');
  c.nuevo.plazoFinancMeses   = _repNum('rep_plazoFinancMeses') || 1;
  c.nuevo.reparacionesMensual = _repNum('rep_reparacionesMensual');
  c.modosFalla = c.modosFalla.map((_,i)=>({
    nombre: _repStr('rep_falla_nombre_'+i),
    p:      _repNum('rep_falla_p_'+i),
    costo:  _repNum('rep_falla_costo_'+i),
  }));
}

function repRecalc(){
  if(!document.getElementById('repResult')) return;
  repReadForm();
  const r = _repEvaluar(_repState);
  _repSaveLS();

  const f = _fmtARS;
  const cls = r.decision==='CONSERVAR' ? 'conservar' : 'reemplazar';
  const factor = isFinite(r.factorEscalaRiesgo) ? '×'+r.factorEscalaRiesgo.toFixed(2) : 'n/a';
  const vida = isFinite(r.vidaBreakEvenAnios) ? r.vidaBreakEvenAnios.toFixed(1)+' años' : 'a cualquier vida';
  const netoAbs = f(Math.abs(r.netoMensual));
  const sub = r.decision==='CONSERVAR'
    ? `Seguir cuesta ${netoAbs}/mes menos que comprar 0km.`
    : `Comprar 0km cuesta ${netoAbs}/mes menos que seguir.`;

  setHTML(document.getElementById('repResult'), new RawHTML(`
    <div class="rep-verdict ${cls}">
      <div class="rep-verdict-word">${r.decision}</div>
      <div class="rep-verdict-sub">${sub}</div>
    </div>
    <div class="rep-ledger">
      <div class="rep-ledger-col">
        <h4>Seguir con el actual · ARS/mes</h4>
        <div class="rep-line"><span>Service (no oficial)</span><span>${f(r.viejo.service)}</span></div>
        <div class="rep-line"><span>Falla corriente</span><span>${f(r.viejo.fallaCorriente)}</span></div>
        <div class="rep-line"><span>Neumáticos</span><span>${f(r.viejo.neumaticos)}</span></div>
        <div class="rep-line"><span>Oportunidad</span><span>${f(r.viejo.oportunidad)}</span></div>
        <div class="rep-line"><span>Riesgo esperado</span><span>${f(r.riesgo.mensual)}</span></div>
        <div class="rep-line rep-sub"><span>Total seguir</span><span>${f(r.viejoTotal)}</span></div>
      </div>
      <div class="rep-ledger-col">
        <h4>Comprar 0km · ARS/mes</h4>
        <div class="rep-line"><span>Depreciación</span><span>${f(r.nuevo.depreciacion)}</span></div>
        <div class="rep-line"><span>Interés financ.</span><span>${f(r.nuevo.interesMensual)}</span></div>
        <div class="rep-line"><span>Service oficial</span><span>${f(r.nuevo.service)}</span></div>
        <div class="rep-line"><span>Reparaciones</span><span>${f(r.nuevo.reparaciones)}</span></div>
        <div class="rep-line"><span>Neumáticos</span><span>${f(r.nuevo.neumaticos)}</span></div>
        <div class="rep-line"><span>Oportunidad</span><span>${f(r.nuevo.oportunidad)}</span></div>
        <div class="rep-line rep-sub"><span>Total comprar</span><span>${f(r.nuevoTotal)}</span></div>
      </div>
    </div>
    <div class="rep-metrics">
      <div class="rep-line"><span>Neto mensual</span><span>${f(r.netoMensual)}</span></div>
      <div class="rep-line"><span>Cuota 24m (flujo caja)</span><span>${f(r.cuotaMensual)}</span></div>
      <div class="rep-line"><span>Umbral de riesgo</span><span>${f(r.umbralRiesgoMensual)}/mes · ${f(r.umbralRiesgoAnual)}/año</span></div>
      <div class="rep-line"><span>El riesgo debe escalar</span><span>${factor}</span></div>
      <div class="rep-line"><span>Vida de indiferencia</span><span>${vida}</span></div>
    </div>
  `));

  const badge = document.getElementById('reemplazoBadge');
  if(badge) badge.textContent = r.decision==='CONSERVAR' ? 'conservar' : 'reemplazar';
}

function repAddFalla(){}
function repDelFalla(){}
function repReset(){}

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
  repReset:                      () => repReset(),
  onSearch:                      (_, t) => onSearch(t.value),
  clearSearch:                   () => clearSearch(),
  setViewMode:                   (mode) => setViewMode(mode),
  setFiltroCategoria:            (key, t) => setFiltroCategoria(key, t),
  setFiltroEstado:               (key, t) => setFiltroEstado(key, t),
  setFiltroTenencia:             (key, t) => setFiltroTenencia(key, t),
  setFiltroInactivo:             (key, t) => setFiltroInactivo(key, t),
  setFiltroUbicacion:            (key, t) => setFiltroUbicacion(key, t),
  closeEquipoDetail:             () => closeEquipoDetail(),
  renderPedidosPendientesGlobal: () => renderPedidosPendientesGlobal(),
  closeServiceCriticoModal:      () => closeServiceCriticoModal(),
  openServiceCriticoModal:       () => openServiceCriticoModal(),
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

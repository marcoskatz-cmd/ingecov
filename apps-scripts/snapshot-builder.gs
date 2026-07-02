/**
 * INGECO Panel — CONSTRUCTOR DE SNAPSHOT (fuente: carpeta "INGECO")
 * ──────────────────────────────────────────────────────────────────────────
 * Va en el proyecto Apps Script STANDALONE "INGECO Panel API"
 * (cuenta marcoskatz@grupoingeco.com.ar). NO va en ningún Sheet.
 *
 * MIGRACIÓN 2026-06: las fuentes de datos pasaron a la carpeta Drive privada
 * "INGECO" (dueño: Nicolás Dall'Agata, compartida a marcoskatz como editor),
 * con TABLAS PLANAS (una por concepto) en vez del modelo viejo (archivos
 * mensuales + una pestaña por equipo). Este builder lee esas tablas privadas
 * con la cuenta de Marcos (que tiene acceso) y las vuelca, RESHAPEADAS al
 * esquema que ya espera el browser, en el snapshot PÚBLICO. Así:
 *   · las fuentes nuevas quedan PRIVADAS (solo el snapshot es público, igual
 *     que antes; el panel tiene PIN en la UI),
 *   · el frontend (js/app.js) casi no se toca: lee las MISMAS pestañas del
 *     snapshot con los MISMOS nombres y esquemas.
 *
 * QUÉ NO TRAE (hasta que Marcos cargue el histórico viejo en las tablas nuevas)
 *   2025 no existe en ninguna fuente. Las pestañas HIST (REP_HIST, TRAB_HIST,
 *   TRAB_HIST58) quedan VACÍAS → el panel muestra solo 2026. Cuando se backfillee
 *   el histórico en los archivos nuevos, aparece solo (sin tocar este builder).
 *
 * USO
 *   1) Pegar este archivo en el editor de Apps Script de "INGECO Panel API"
 *      (reemplaza el builder viejo). El ID del snapshot se conserva en las
 *      Script Properties, así que app.js NO cambia su SNAPSHOT_ID.
 *   2) Ejecutar construirSnapshot() una vez (autoriza acceso a la carpeta INGECO).
 *   3) Revisar el log / pestaña META: cada pestaña con su row count y status.
 *   4) El trigger de 30 min ya existente sigue llamando a construirSnapshot().
 *      Si no estaba, correr instalarTriggerSnapshot().
 *
 * DESACOPLE DE LO VIEJO: este builder NO lee ninguna de las fuentes viejas.
 * Los consolidadores viejos (actualizarPanelTrabajos/Repuestos) y sus triggers
 * pueden apagarse — ya no alimentan el panel.
 */

/* ═══════════════════════════════════════════════════════════════════════
   CONFIG — IDs de las tablas planas dentro de la carpeta "INGECO"
═══════════════════════════════════════════════════════════════════════ */
const SNAP_SRC = {
  trabajos:     '1muXaJvsdAH0q3bXZj3yiDanxT3aCfUL5EhY_ORgvx7o', // TRABAJOS REALIZADOS EN EQUIPOS
  repuestos:    '1JpXjGTJwlvMuEI-rFTd4KeKvzd708-yuSLAhIRuCFC0', // PEDIDOS Y ENTREGAS DE REPUESTOS (hojas PEDIDOS + ENTREGAS)
  services:     '14XiIAnYeobj5_3JQlR-ejH6HzCqGJ6QFuGmmwauaRJc', // SERVICES DE EQUIPOS (hojas REGISTROS + OPERATIVIDAD)
  combLivianos: '1DD8BVoF6jX-CcakbbVO6fNJKYF82qBIK1YwyVLQcDJ8', // ENTREGAS DE COMBUSTIBLE - TIBURCIO SANZ (livianos, con costo)
  combPesados:  '19eyY8MImPM_-Gyzj8QcqA_yR5KDrkuu-1faJUU48N1A', // ENTREGAS DE COMBUSTIBLE - LEANDRO CASARES (pesados, horómetro)
  equipos:      '1EwbNlmBMx3OIviplvHSJM3N4CZ3vVXgVxH208VugG3M', // LISTA DE EQUIPOS (maestro de códigos)
};

const SNAP_NAME     = 'INGECO Panel Snapshot';
const SNAP_PROP_KEY = 'INGECO_SNAPSHOT_ID';

// Headers de las pestañas aplanadas que el browser lee con keys fijas.
const SNAP_HIST58_HEADER = ['FECHA TRABAJO','LUGAR TRABAJO','CÓDIGO','DESCRIPCIÓN TRABAJOS','TIEMPO TRABAJO','EQUIPO'];
const SNAP_SVCEQ_HEADER  = ['CODN','RAWCOD','KVCOD','MES','SHEET_ID','PLANILLA','FECHA','PERSONAL','ACTUAL','PROXIMO','SERIE'];

/* ═══════════════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════════════ */
// normCod: quita tildes, espacios, guiones, cualquier no alfanumérico, mayúsculas.
function _snapNormCod(s){
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[^A-Za-z0-9]/g,'').toUpperCase();
}
// nk: normaliza encabezado (NFD sin combinantes, trim, upper). Conserva ° y /.
function _snapNk(s){
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toUpperCase();
}

// Busca, dentro de un spreadsheet, la primera pestaña cuyo header contiene una
// columna que matchea alguno de los sinónimos. Robusto a nombres de pestaña
// desconocidos (la 2ª hoja de SERVICES, etc.). Devuelve {header,rows,name} o null.
function _readTabByHeader_(srcId, sinonimos){
  const ss = SpreadsheetApp.openById(srcId);
  for(const sh of ss.getSheets()){
    const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    if(lastRow < 1 || lastCol < 1) continue;
    const data = sh.getRange(1, 1, lastRow, lastCol).getDisplayValues();
    if(_idx_(data[0], sinonimos) >= 0) return { header:data[0], rows:data.slice(1), name:sh.getName() };
  }
  return null;
}

// Lee una pestaña como matriz de strings (getDisplayValues). Devuelve
// { header:[...], rows:[[...]] } o null si no existe / está vacía.
function _readTab_(srcId, tabName){
  const ss = SpreadsheetApp.openById(srcId);
  const sh = ss.getSheetByName(tabName);
  if(!sh) return null;
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if(lastRow < 1 || lastCol < 1) return null;
  const data = sh.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  return { header: data[0], rows: data.slice(1) };
}

// Resuelve el índice de columna cuyo header normalizado (igual que normCod del
// browser) coincide EXACTO con alguno de los sinónimos. -1 si no está.
function _idx_(header, sinonimos){
  const cand = sinonimos.map(_snapNormCod);
  for(let i = 0; i < header.length; i++){
    if(cand.indexOf(_snapNormCod(header[i])) >= 0) return i;
  }
  return -1;
}
function _at_(row, i){ return i >= 0 ? String(row[i] == null ? '' : row[i]).trim() : ''; }

// Escribe una pestaña del snapshot con formato texto plano (evita el re-tipado
// de fechas que rompía gviz; ver builder viejo). obj=true → frozen 1.
function _write_(snap, tab, matrix, obj){
  const dst = _resetTab_(snap, tab);
  if(!matrix.length) matrix = [['']];
  const nCols = matrix.reduce((m,r)=>Math.max(m, r.length), 1);
  const norm = matrix.map(r => { const c = r.slice(); while(c.length < nCols) c.push(''); return c; });
  const rng = dst.getRange(1, 1, norm.length, nCols);
  rng.setNumberFormat('@');
  rng.setValues(norm);
  dst.setFrozenRows(obj ? 1 : 0);
}

/* ═══════════════════════════════════════════════════════════════════════
   ENTRADA PRINCIPAL — también es el handler del trigger de 30 min
═══════════════════════════════════════════════════════════════════════ */
function construirSnapshot(){
  const t0 = Date.now();
  const snap = _getOrCreateSnapshotSS_();
  const meta = [];
  const errores = [];
  const rec = r => { meta.push(r); if(r.status !== 'OK') errores.push(r); };

  rec(_buildCodigos_(snap));        // COD_V / COD_L / COD_P / COD_S
  rec(_buildTrabajos_(snap));       // TRAB_LIVE
  rec(_buildRepuestos_(snap));      // REP_LIVE
  rec(_buildPedidos_(snap));        // PED_PEND (+ PED_ENTR vacío)
  rec(_buildCombustible_(snap));    // COMBUSTIBLE (pesados / Casares)
  rec(_buildCombLivianos_(snap));   // COMB_LIVIANOS (Sanz)
  rec(_buildService_(snap));        // SVC_PANELPROG + SERVICE_EQ (+ SVC_FREC/TRIM vacíos)
  _buildHistVacios_(snap, rec);     // REP_HIST / TRAB_HIST / TRAB_HIST58 (header solo)

  _escribirMeta_(snap, meta, errores);
  _limpiarTabsSobrantes_(snap);

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const msg = 'Snapshot OK en ' + dt + 's · ' + meta.length + ' pestañas · '
            + errores.length + ' con problema'
            + (errores.length ? ' (' + errores.map(e=>e.tab).join(', ') + ')' : '')
            + ' · id=' + snap.getId();
  Logger.log(msg);
  return msg;
}

/* ═══════════════════════════════════════════════════════════════════════
   COD_V/L/P/S ← LISTA DE EQUIPOS
   parseCodigos (browser) busca la fila header por una celda == 'CODIGO' y
   mapea por nombre: EQUIPO/NOMBRE/DESCRIPCION, ESTADO, LUGAR, OPERARIO, FECHA,
   PATENTE/DOMINIO, MARCA, MODELO, CLASIF/TIPO/CATEGORIA, OBSERV/TENENCIA.
   La LISTA nueva no tiene "EQUIPO" (lo sintetizamos) ni "OBSERVACION" de
   tenencia (sale de TIPO EQUIPO: Propio/Alquilado). UBICACIÓN → LUGAR.
   Header de salida = nombres que parseCodigos resuelve sin tocar el browser.
═══════════════════════════════════════════════════════════════════════ */
const COD_OUT_HEADER = ['CODIGO','EQUIPO','ESTADO','LUGAR','OPERARIO','FECHA','PATENTE','MARCA','MODELO','CLASIFICACION','OBSERVACION'];

function _catEquipo_(clasif, cod){
  const c = _snapNormCod(clasif);
  if(/(COMPRESOR|GENERADOR|SOLDAD|GRUPOELECTRO)/.test(c)) return 'S'; // SOPORTE
  const pref = String(cod || '').toUpperCase().split('-')[0].replace(/[^A-Z]/g,'');
  if(pref === 'CMT') return 'L'; // camionetas → TRANSPORTE LIVIANO
  if(pref === 'CMN') return 'P'; // camiones   → TRANSPORTE PESADO
  return 'V';                    // maquinaria vial / asfalto / trituración
}

function _buildCodigos_(snap){
  try{
    const t = _readTab_(SNAP_SRC.equipos, 'EQUIPOS') || _readTab_(SNAP_SRC.equipos, 'LISTA DE EQUIPOS');
    if(!t) return { tab:'COD_*', rows:0, status:'ERROR', detalle:'no pude leer LISTA DE EQUIPOS (pestaña EQUIPOS)' };
    const h = t.header;
    // La LISTA nueva titula la columna 'CÓDIO INTERNO' (con typo) y la patente
    // 'N° SERIE - N° PATENTE'. _snapNormCod quita acentos/símbolos, así que
    // alcanza con variantes ASCII sin tilde ('CODIO INTERNO'→'CODIOINTERNO').
    const iCod = _idx_(h, ['CÓDIGO','CODIGO','CODIGO INTERNO','CODIO INTERNO']);
    const iCla = _idx_(h, ['CLASIFICACIÓN','CLASIFICACION','TIPO']);
    const iMar = _idx_(h, ['MARCA']);
    const iMod = _idx_(h, ['MODELO']);
    const iPat = _idx_(h, ['PATENTE/SERIE','PATENTE','N° SERIE/PATENTE','N SERIE N PATENTE','SERIE','DOMINIO']);
    const iEst = _idx_(h, ['ESTADO']);
    const iOpe = _idx_(h, ['OPERARIO','RESPONSABLE']);
    const iUbi = _idx_(h, ['UBICACIÓN','UBICACION','LUGAR']);
    const iFec = _idx_(h, ['FECHA']);
    const iTen = _idx_(h, ['TIPO EQUIPO','TENENCIA','PROPIEDAD']);

    const buckets = { V:[COD_OUT_HEADER.slice()], L:[COD_OUT_HEADER.slice()], P:[COD_OUT_HEADER.slice()], S:[COD_OUT_HEADER.slice()] };
    let n = 0;
    for(const r of t.rows){
      const cod = _at_(r, iCod);
      if(!_snapNormCod(cod)) continue;
      const clasif = _at_(r, iCla), marca = _at_(r, iMar), modelo = _at_(r, iMod);
      const nombre = [clasif, marca, modelo].filter(x => x && x !== '-').join(' ');
      const out = [
        cod, nombre, _at_(r, iEst), _at_(r, iUbi), _at_(r, iOpe),
        _at_(r, iFec), _at_(r, iPat), marca, modelo, clasif, _at_(r, iTen),
      ];
      buckets[_catEquipo_(clasif, cod)].push(out);
      n++;
    }
    _write_(snap, 'COD_V', buckets.V, false);
    _write_(snap, 'COD_L', buckets.L, false);
    _write_(snap, 'COD_P', buckets.P, false);
    _write_(snap, 'COD_S', buckets.S, false);
    const det = `V:${buckets.V.length-1} L:${buckets.L.length-1} P:${buckets.P.length-1} S:${buckets.S.length-1}`;
    return { tab:'COD_*', rows:n, status:'OK', detalle:det };
  }catch(e){ return { tab:'COD_*', rows:0, status:'ERROR', detalle:String(e && e.message || e) }; }
}

/* ═══════════════════════════════════════════════════════════════════════
   TRAB_LIVE ← TRABAJOS REALIZADOS EN EQUIPOS
   procesarPanelTrabajos usa sinónimos: CODIGO, EQUIPO, FECHA TRABAJO,
   TIEMPO TRABAJO, RAZON TRABAJO, DESCRIPCION TRABAJOS. Renombramos a esos.
═══════════════════════════════════════════════════════════════════════ */
function _buildTrabajos_(snap){
  try{
    const t = _readTab_(SNAP_SRC.trabajos, 'TRABAJOS') || _readTab_(SNAP_SRC.trabajos, 'TRABAJOS REALIZADOS EN EQUIPOS') || _readTab_(SNAP_SRC.trabajos, 'Hoja 1');
    if(!t) return { tab:'TRAB_LIVE', rows:0, status:'ERROR', detalle:'no pude leer TRABAJOS' };
    const h = t.header;
    const iCod = _idx_(h, ['CÓDIGO','CODIGO']);
    const iEqu = _idx_(h, ['EQUIPO']);
    const iFec = _idx_(h, ['FECHA','FECHA TRABAJO']);
    const iLug = _idx_(h, ['LUGAR/OBRA','LUGAR','OBRA','LUGAR TRABAJO']);
    const iPer = _idx_(h, ['PERSONAL']);
    const iDes = _idx_(h, ['DESCRIPCIÓN','DESCRIPCION','DESCRIPCIÓN TRABAJOS']);
    const iTie = _idx_(h, ['T. TRABAJO (H)','T. TRABAJO','TIEMPO TRABAJO','TIEMPO']);
    const iPar = _idx_(h, ['T. PARADA (H)','T. PARADA','TIEMPO PARADA']);
    const iRaz = _idx_(h, ['RAZÓN','RAZON','RAZÓN TRABAJO']);

    const out = [['CÓDIGO','EQUIPO','FECHA TRABAJO','LUGAR TRABAJO','PERSONAL TRABAJO','DESCRIPCIÓN TRABAJOS','TIEMPO PARADA','TIEMPO TRABAJO','RAZÓN TRABAJO']];
    let n = 0;
    for(const r of t.rows){
      const cod = _at_(r, iCod), fecha = _at_(r, iFec), tie = _at_(r, iTie);
      if(!_snapNormCod(cod) && !fecha && !tie) continue;
      out.push([cod, _at_(r, iEqu), fecha, _at_(r, iLug), _at_(r, iPer), _at_(r, iDes), _at_(r, iPar), tie, _at_(r, iRaz)]);
      n++;
    }
    _write_(snap, 'TRAB_LIVE', out, true);
    return { tab:'TRAB_LIVE', rows:n, status:'OK', detalle:'' };
  }catch(e){ return { tab:'TRAB_LIVE', rows:0, status:'ERROR', detalle:String(e && e.message || e) }; }
}

/* ═══════════════════════════════════════════════════════════════════════
   REP_LIVE ← hoja ENTREGAS de PEDIDOS Y ENTREGAS DE REPUESTOS
   procesarPanelRepuestos deriva el ym de FECHA si no hay MES/AÑO, y busca el
   costo como 'COSTO ENTREGA'/'COSTO'. Renombramos el precio a COSTO ENTREGA.
═══════════════════════════════════════════════════════════════════════ */
function _buildRepuestos_(snap){
  try{
    // Mismo problema que pedidos: la pestaña de entregas del archivo volátil no
    // siempre se llama "ENTREGAS". Fallback por header. OJO: NO matchear por
    // 'N° ENTREGA' porque la hoja de PEDIDOS también tiene esa columna; uso
    // PROVEEDOR/COSTO, que son exclusivas de la hoja de entregas.
    const t = _readTab_(SNAP_SRC.repuestos, 'ENTREGAS') || _readTabByHeader_(SNAP_SRC.repuestos, ['PROVEEDOR','COSTO']);
    if(!t){
      let tabs='';
      try{ tabs = SpreadsheetApp.openById(SNAP_SRC.repuestos).getSheets().map(s=>s.getName()).join(' | '); }catch(_){}
      return { tab:'REP_LIVE', rows:0, status:'ERROR', detalle:'no encontré hoja de entregas (ni "ENTREGAS" ni una con PROVEEDOR/COSTO). Pestañas: '+tabs };
    }
    const h = t.header;
    const iNro = _idx_(h, ['N° ENTREGA','N ENTREGA','NRO ENTREGA','ENTREGA','N° DE ENTREGA']);
    const iFec = _idx_(h, ['FECHA','FECHA ENTREGA']);
    const iEqu = _idx_(h, ['EQUIPO','EQUIPO/SECTOR']);
    const iCod = _idx_(h, ['CÓDIGO','CODIGO']);
    const iCos = _idx_(h, ['COSTO','PRECIO','TOTAL','IMPORTE','COSTO ENTREGA','PRECIO TOTAL','MONTO','COSTO TOTAL']);
    const iRaz = _idx_(h, ['DESTINO/RAZÓN','RAZÓN','RAZON','MOTIVO','DESTINO']);
    const iRes = _idx_(h, ['RESPONSABLE','RESPONSABLE ENTREGA']);
    const iIte = _idx_(h, ['DESCRIPCIÓN DE REPUESTOS','DESCRIPCION DE REPUESTOS','REPUESTOS','ITEMS DETALLE','DESCRIPCIÓN','DESCRIPCION']);

    const out = [['N° ENTREGA','FECHA','EQUIPO','CÓDIGO','COSTO ENTREGA','RAZÓN ENTREGA','RESPONSABLE ENTREGA','ITEMS DETALLE']];
    let n = 0;
    for(const r of t.rows){
      const nro = _at_(r, iNro), fecha = _at_(r, iFec);
      if(!nro && !fecha) continue;
      out.push([nro, fecha, _at_(r, iEqu), _at_(r, iCod), _at_(r, iCos), _at_(r, iRaz), _at_(r, iRes), _at_(r, iIte)]);
      n++;
    }
    _write_(snap, 'REP_LIVE', out, true);
    const det = iCos < 0 ? 'OJO: no encontré columna de costo en ENTREGAS' : '';
    return { tab:'REP_LIVE', rows:n, status: iCos < 0 ? 'WARN' : 'OK', detalle:det };
  }catch(e){ return { tab:'REP_LIVE', rows:0, status:'ERROR', detalle:String(e && e.message || e) }; }
}

/* ═══════════════════════════════════════════════════════════════════════
   PED_PEND ← hoja PEDIDOS de PEDIDOS Y ENTREGAS DE REPUESTOS
   renderDashboard lee PED_PEND como matriz POSICIONAL:
     [0]=nro(num) [1]=fecha [2]=equipo [3]=codigo [4]=desc [5]=estado
   "pedidos activos" = estado contiene pendiente/parcial/comprado.
   PED_ENTR queda vacío (las entregas del panel salen de REP_LIVE).
═══════════════════════════════════════════════════════════════════════ */
function _buildPedidos_(snap){
  try{
    // La hoja de pedidos NO siempre se llama exactamente "PEDIDOS" (la primera
    // pestaña del archivo fue renombrada y getSheetByName('PEDIDOS') daba null →
    // PED_PEND quedaba vacío). Fallback robusto: ubicarla por la columna ESTADO,
    // que es única de pedidos (la hoja ENTREGAS no la tiene). Mirrors el patrón
    // de _buildService_.
    const t = _readTab_(SNAP_SRC.repuestos, 'PEDIDOS') || _readTabByHeader_(SNAP_SRC.repuestos, ['ESTADO']);
    if(!t){
      let tabs='';
      try{ tabs = SpreadsheetApp.openById(SNAP_SRC.repuestos).getSheets().map(s=>s.getName()).join(' | '); }catch(_){}
      _write_(snap, 'PED_PEND', [['N°','FECHA','EQUIPO','CÓDIGO','DESCRIPCIÓN','ESTADO']], false); _write_(snap, 'PED_ENTR', [['','','','','','','','']], true);
      return { tab:'PED_PEND', rows:0, status:'ERROR', detalle:'no encontré hoja de pedidos (ni "PEDIDOS" ni una con columna ESTADO). Pestañas: '+tabs }; }
    const h = t.header;
    const iNro = _idx_(h, ['N°','NRO','N° PEDIDO','NUMERO','ID','L1122']);
    const iFec = _idx_(h, ['FECHA']);
    const iEqu = _idx_(h, ['EQUIPO/SECTOR','EQUIPO']);
    const iCod = _idx_(h, ['CÓDIGO','CODIGO']);
    const iDes = _idx_(h, ['DESCRIPCIÓN DE REPUESTOS','DESCRIPCION DE REPUESTOS','DESCRIPCIÓN','DESCRIPCION','REPUESTOS']);
    const iEst = _idx_(h, ['ESTADO']);
    // Si el N° no está como header reconocible, usar la primera columna (la "L1122"
    // del archivo tiene los números de pedido como valores).
    const cNro = iNro >= 0 ? iNro : 0;

    const out = [['N°','FECHA','EQUIPO','CÓDIGO','DESCRIPCIÓN','ESTADO']];
    let n = 0;
    for(const r of t.rows){
      const nro = _at_(r, cNro), estado = _at_(r, iEst);
      if(!nro && !estado) continue;
      out.push([nro, _at_(r, iFec), _at_(r, iEqu), _at_(r, iCod), _at_(r, iDes), estado]);
      n++;
    }
    _write_(snap, 'PED_PEND', out, false);
    _write_(snap, 'PED_ENTR', [['','','','','','','','']], true); // sin uso (entregas → REP_LIVE)
    return { tab:'PED_PEND', rows:n, status:'OK', detalle:'' };
  }catch(e){ return { tab:'PED_PEND', rows:0, status:'ERROR', detalle:String(e && e.message || e) }; }
}

/* ═══════════════════════════════════════════════════════════════════════
   COMBUSTIBLE ← ENTREGAS DE COMBUSTIBLE - LEANDRO CASARES (pesados, horómetro)
   procesarCombustible usa _pickCol con sinónimos cortos: CODIGO, FECHA,
   ESTADO, HOROMETRO ACTUAL, CANTIDAD, TIPO, LUGAR, OPERARIO, OBSERVACIONES.
═══════════════════════════════════════════════════════════════════════ */
function _buildCombustible_(snap){
  try{
    const t = _readTab_(SNAP_SRC.combPesados, 'ENTREGAS') || _readTab_(SNAP_SRC.combPesados, 'Hoja 1');
    if(!t) return { tab:'COMBUSTIBLE', rows:0, status:'ERROR', detalle:'no pude leer combustible pesados' };
    const h = t.header;
    const iCod = _idx_(h, ['CÓDIGO INTERNO','CODIGO INTERNO','CÓDIGO','CODIGO']);
    const iFec = _idx_(h, ['FECHA']);
    const iEst = _idx_(h, ['ESTADO HORÓMETRO','ESTADO HOROMETRO','ESTADO']);
    const iHr  = _idx_(h, ['HORÓMETRO ACTUAL','HOROMETRO ACTUAL']);
    const iLit = _idx_(h, ['CANTIDAD (L)','CANTIDAD','LITROS']);
    const iTip = _idx_(h, ['TIPO COMBUSTIBLE','TIPO DE COMBUSTIBLE','TIPO']);
    const iLug = _idx_(h, ['LUGAR ENTREGA','LUGAR']);
    const iOpe = _idx_(h, ['OPERARIO']);

    const out = [['CODIGO','FECHA','ESTADO','HOROMETRO ACTUAL','CANTIDAD','TIPO','LUGAR','OPERARIO','OBSERVACIONES']];
    let n = 0;
    for(const r of t.rows){
      const cod = _at_(r, iCod);
      if(!_snapNormCod(cod)) continue;
      out.push([cod, _at_(r, iFec), _at_(r, iEst), _at_(r, iHr), _at_(r, iLit), _at_(r, iTip), _at_(r, iLug), _at_(r, iOpe), '']);
      n++;
    }
    _write_(snap, 'COMBUSTIBLE', out, true);
    return { tab:'COMBUSTIBLE', rows:n, status:'OK', detalle:'' };
  }catch(e){ return { tab:'COMBUSTIBLE', rows:0, status:'ERROR', detalle:String(e && e.message || e) }; }
}

/* ═══════════════════════════════════════════════════════════════════════
   COMB_LIVIANOS ← ENTREGAS DE COMBUSTIBLE - TIBURCIO SANZ (livianos, con costo)
   procesarCombustibleLivianos lee POSICIONAL:
     0 fecha · 3 tipo · 4 litros · 5 patente · 6 odómetro · 7 obra · 8 chofer · 11 total$
═══════════════════════════════════════════════════════════════════════ */
function _buildCombLivianos_(snap){
  try{
    const t = _readTab_(SNAP_SRC.combLivianos, 'ENTREGAS') || _readTab_(SNAP_SRC.combLivianos, 'Hoja 1');
    if(!t) return { tab:'COMB_LIVIANOS', rows:0, status:'ERROR', detalle:'no pude leer combustible livianos' };
    const h = t.header;
    const iFec = _idx_(h, ['FECHA ENTREGA','FECHA']);
    const iTip = _idx_(h, ['TIPO COMBUSTIBLE','TIPO DE COMBUSTIBLE','TIPO']);
    const iLit = _idx_(h, ['CANTIDAD (L)','CANTIDAD','LITROS']);
    // La fuente ahora titula la patente 'N° SERIE - N° PATENTE' (→ NSERIENPATENTE).
    // Sin este sinónimo iPat quedaba -1 → patente vacía → el ranking por equipo del
    // KPI no matcheaba nada (el total sí, porque suma sin mirar patente).
    const iPat = _idx_(h, ['N SERIE N PATENTE','N° PATENTE','PATENTE','DOMINIO']);
    const iOdo = _idx_(h, ['ODÓMETRO (KM)','ODOMETRO','KM']);
    const iOpe = _idx_(h, ['OPERARIO','CHOFER']);
    const iObr = _idx_(h, ['OBRA PARTICULAR','OBRA GENERAL','OBRA','LUGAR','LUGAR ENTREGA']);
    const iTot = _idx_(h, ['TOTAL','IMPORTE','COSTO']);

    const out = [['FECHA','','','TIPO','LITROS','PATENTE','ODOMETRO','OBRA','CHOFER','','','TOTAL']];
    let n = 0;
    for(const r of t.rows){
      const fecha = _at_(r, iFec), pat = _at_(r, iPat);
      if(!fecha && !pat) continue;
      const row = ['', '', '', '', '', '', '', '', '', '', '', ''];
      row[0]  = fecha;
      row[3]  = _at_(r, iTip);
      row[4]  = _at_(r, iLit);
      row[5]  = pat;
      row[6]  = _at_(r, iOdo);
      row[7]  = _at_(r, iObr);   // obra/lugar — el browser lee col 7 como 'lugar'
      row[8]  = _at_(r, iOpe);
      row[11] = _at_(r, iTot);
      out.push(row);
      n++;
    }
    _write_(snap, 'COMB_LIVIANOS', out, false);
    const det = iTot < 0 ? 'OJO: no encontré columna TOTAL/precio' : '';
    return { tab:'COMB_LIVIANOS', rows:n, status: iTot < 0 ? 'WARN' : 'OK', detalle:det };
  }catch(e){ return { tab:'COMB_LIVIANOS', rows:0, status:'ERROR', detalle:String(e && e.message || e) }; }
}

/* ═══════════════════════════════════════════════════════════════════════
   SERVICE — hoja OPERATIVIDAD de SERVICES DE EQUIPOS (ya pre-calculada con
   FRECUENCIA, HR/KM ACTUAL, PRÓXIMO SERVICE, OPERATIVIDAD y ESTADO).
   · SVC_PANELPROG: lo lee procesarPanelPrograma (sinónimos tolerantes).
     Sumamos columna ESTADO (label crítico/vencido/…) para que el frontend
     pueda usarla directo en el KPI de service crítico (paso 2).
   · SERVICE_EQ: horómetro actual + próximo por equipo (fallback del modal).
   · SVC_FREC / SVC_TRIM* quedan vacíos (reemplazados por OPERATIVIDAD).
═══════════════════════════════════════════════════════════════════════ */
function _buildService_(snap){
  try{
    // La 2ª hoja de SERVICES (operatividad pre-calculada). Si no se llama
    // "OPERATIVIDAD", la ubicamos por tener una columna OPERATIVIDAD.
    const t = _readTab_(SNAP_SRC.services, 'OPERATIVIDAD') || _readTabByHeader_(SNAP_SRC.services, ['OPERATIVIDAD']);
    // SVC_FREC / TRIM vacíos (el browser tolera sin filas).
    _write_(snap, 'SVC_FREC',  [['']], false);
    _write_(snap, 'SVC_TRIM1', [['']], false);
    _write_(snap, 'SVC_TRIM2', [['']], false);

    if(!t){
      _write_(snap, 'SVC_PANELPROG', [['CODIGO','DESCRIPCION','PATENTE','ULT FECHA','ULT HRKM','EST HRKM','OPERATIVIDAD','FRECUENCIA','ESTADO']], true);
      _write_(snap, 'SERVICE_EQ', [SNAP_SVCEQ_HEADER.slice()], true);
      return { tab:'SVC_PANELPROG', rows:0, status:'ERROR', detalle:'no pude leer hoja OPERATIVIDAD' };
    }
    const h = t.header;
    const iCod = _idx_(h, ['CÓDIGO','CODIGO']);
    const iDes = _idx_(h, ['DESCRIPCIÓN','DESCRIPCION','EQUIPO']);
    const iPat = _idx_(h, ['N° SERIE/PATENTE','PATENTE','SERIE']);
    const iFre = _idx_(h, ['FRECUENCIA']);
    const iAct = _idx_(h, ['HR/KM/FECHA ACTUAL','HR/KM ACTUAL','HRKM ACTUAL','ACTUAL']);
    const iUFe = _idx_(h, ['ÚLTIMO SERVICE FECHA','ULTIMO SERVICE FECHA','ULT FECHA']);
    const iUHr = _idx_(h, ['ÚLTIMO SERVICE HR/KM/FECHA','ÚLTIMO SERVICE HR/KM','ULTIMO SERVICE HR/KM','ULT HRKM']);
    const iPro = _idx_(h, ['PRÓXIMO SERVICE','PROXIMO SERVICE','PROX']);
    const iOpv = _idx_(h, ['OPERATIVIDAD']);
    const iEst = _idx_(h, ['ESTADO']);

    const panel = [['CODIGO','DESCRIPCION','PATENTE','ULT FECHA','ULT HRKM','HRKM ACTUAL','EST HRKM','OPERATIVIDAD','FRECUENCIA','ESTADO']];
    const eq = [SNAP_SVCEQ_HEADER.slice()];
    let n = 0;
    for(const r of t.rows){
      const cod = _at_(r, iCod);
      if(!_snapNormCod(cod)) continue;
      const desc = _at_(r, iDes), pat = _at_(r, iPat);
      const ultFecha = _at_(r, iUFe), ultHr = _at_(r, iUHr), actual = _at_(r, iAct), prox = _at_(r, iPro);
      panel.push([cod, desc, pat, ultFecha, ultHr, actual, prox, _at_(r, iOpv), _at_(r, iFre), _at_(r, iEst)]);
      // SERVICE_EQ: ACTUAL = hr/km actual del equipo, PROXIMO = próximo service.
      eq.push([_snapNormCod(cod), cod, cod, '', '', '', ultFecha, '', actual, prox, pat]);
      n++;
    }
    _write_(snap, 'SVC_PANELPROG', panel, true);
    _write_(snap, 'SERVICE_EQ', eq, true);
    return { tab:'SVC_PANELPROG', rows:n, status:'OK', detalle:n + ' equipos' };
  }catch(e){ return { tab:'SVC_PANELPROG', rows:0, status:'ERROR', detalle:String(e && e.message || e) }; }
}

/* ═══════════════════════════════════════════════════════════════════════
   HIST vacíos — 2025 todavía no existe en las fuentes nuevas. Header solo.
═══════════════════════════════════════════════════════════════════════ */
function _buildHistVacios_(snap, rec){
  _write_(snap, 'REP_HIST',  [['N° ENTREGA','FECHA','EQUIPO','CÓDIGO','COSTO ENTREGA','RAZÓN ENTREGA','RESPONSABLE ENTREGA','ITEMS DETALLE']], true);
  _write_(snap, 'TRAB_HIST', [['CÓDIGO','EQUIPO','FECHA TRABAJO','LUGAR TRABAJO','PERSONAL TRABAJO','DESCRIPCIÓN TRABAJOS','TIEMPO PARADA','TIEMPO TRABAJO','RAZÓN TRABAJO']], true);
  _write_(snap, 'TRAB_HIST58', [SNAP_HIST58_HEADER.slice()], true);
  // INDICADORES dado de baja (sin fuente nueva); pestaña vacía para no romper lecturas.
  _write_(snap, 'INDICADORES', [['']], false);
  rec({ tab:'HIST(vacíos)', rows:0, status:'OK', detalle:'REP_HIST/TRAB_HIST/TRAB_HIST58/INDICADORES vacíos hasta backfill 2025' });
}

/* ═══════════════════════════════════════════════════════════════════════
   META + INFRA (snapshot spreadsheet, pestañas, limpieza, triggers)
═══════════════════════════════════════════════════════════════════════ */
function _escribirMeta_(snap, meta, errores){
  const tz = snap.getSpreadsheetTimeZone() || Session.getScriptTimeZone();
  const now = new Date();
  const rows = [['TAB','ROWS','STATUS','DETALLE']];
  for(const m of meta) rows.push([m.tab, m.rows, m.status, m.detalle || '']);
  rows.push(['__BUILD__', now.getTime(), Utilities.formatDate(now, tz, 'd/M/yyyy HH:mm'), 'snapshot generado']);
  rows.push(['__ERRORES__', errores.length, errores.length ? 'WARN' : 'OK', errores.map(e=>e.tab).join(', ')]);
  const dst = _resetTab_(snap, 'META');
  dst.getRange(1, 1, rows.length, 4).setValues(rows);
  dst.setFrozenRows(1);
}

function _getOrCreateSnapshotSS_(){
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(SNAP_PROP_KEY);
  if(id){
    try{ return SpreadsheetApp.openById(id); }
    catch(e){ Logger.log('Snapshot guardado (' + id + ') ya no abre; recreo. ' + e.message); }
  }
  const ss = SpreadsheetApp.create(SNAP_NAME);
  id = ss.getId();
  props.setProperty(SNAP_PROP_KEY, id);
  try{
    DriveApp.getFileById(id).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }catch(e){
    Logger.log('OJO: no pude compartir auto. Compartir a mano "cualquiera con el link puede ver". ' + e.message);
  }
  Logger.log('Snapshot CREADO. ID=' + id + ' — pegar en app.js SNAPSHOT_ID si es nuevo.');
  return ss;
}

function _resetTab_(snap, name){
  let sh = snap.getSheetByName(name);
  if(!sh) sh = snap.insertSheet(name);
  else sh.clearContents();
  return sh;
}

function _limpiarTabsSobrantes_(snap){
  const validas = {};
  ['COD_V','COD_L','COD_P','COD_S','TRAB_LIVE','TRAB_HIST','TRAB_HIST58','REP_LIVE','REP_HIST',
   'PED_PEND','PED_ENTR','COMBUSTIBLE','COMB_LIVIANOS','SVC_FREC','SVC_TRIM1','SVC_TRIM2',
   'SVC_PANELPROG','SERVICE_EQ','INDICADORES','META'].forEach(t => validas[t] = true);
  for(const sh of snap.getSheets()){
    if(!validas[sh.getName()]){
      try{ snap.deleteSheet(sh); }catch(e){ /* nunca borrar la última pestaña */ }
    }
  }
}

function instalarTriggerSnapshot(){
  ScriptApp.getProjectTriggers().forEach(t => {
    if(t.getHandlerFunction() === 'construirSnapshot') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('construirSnapshot').timeBased().everyMinutes(30).create();
  Logger.log('Trigger instalado: construirSnapshot() cada 30 min.');
}

function verSnapshotId(){
  const id = PropertiesService.getScriptProperties().getProperty(SNAP_PROP_KEY);
  if(!id){ Logger.log('Todavía no hay snapshot. Corré construirSnapshot() una vez.'); return null; }
  Logger.log('Snapshot ID: ' + id);
  Logger.log('URL: https://docs.google.com/spreadsheets/d/' + id + '/edit');
  return id;
}

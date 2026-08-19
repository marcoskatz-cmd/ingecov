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
  combCamionetas: '1GB_oiL40fEXHXzhmor3ztnnriiikX1xp3fG-F5Uuw5E', // ENTREGAS DE COMBUSTIBLE camionetas (código directo, sin costo, sin horómetro)
  equipos:      '1EwbNlmBMx3OIviplvHSJM3N4CZ3vVXgVxH208VugG3M', // LISTA DE EQUIPOS (maestro de códigos)
  vtv:          '1-DSUu1HlBG2kXClsMkHiDwiKmtZdkGI853aS9Qyp6Gg', // VERIFICACIÓN TÉCNICA VEHICULAR (Marcos la va completando a mano, incompleta a propósito)
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
  rec(_buildVTV_(snap));            // VTV (verificación técnica vehicular)
  _buildHistVacios_(snap, rec);     // REP_HIST / TRAB_HIST / TRAB_HIST58 (header solo)
  rec(_buildFaltantes_(snap));      // FALTANTES — va ÚLTIMO: lee las pestañas ya escritas

  _escribirMeta_(snap, meta, errores);
  _limpiarTabsSobrantes_(snap);

  // Auditoría de consistencia de cargas (resultado PRIVADO: va a Script
  // Properties, NO al snapshot público; lo sirve la webapp con PIN).
  try{ _auditar_(); }catch(e){ Logger.log('[auditoría] falló: ' + (e && e.message || e)); }

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
    const iLug = _idx_(h, ['LUGAR/OBRA','LUGAR','OBRA','LUGAR TRABAJO','LUGAR TRABAJO/OBRA PARTICULAR 1']);
    const iPer = _idx_(h, ['PERSONAL','PERSONAL 1']);
    const iDes = _idx_(h, ['DESCRIPCIÓN','DESCRIPCION','DESCRIPCIÓN TRABAJOS']);
    const iTie = _idx_(h, ['T. TRABAJO (H)','T. TRABAJO','TIEMPO TRABAJO','TIEMPO','TIEMPO TRABAJO (hr)']);
    const iPar = _idx_(h, ['T. PARADA (H)','T. PARADA','TIEMPO PARADA','TIEMPO PARADA (hr)']);
    const iRaz = _idx_(h, ['RAZÓN','RAZON','RAZÓN TRABAJO','RAZÓN 1']);

    const out = [['CÓDIGO','EQUIPO','FECHA TRABAJO','LUGAR TRABAJO','PERSONAL TRABAJO','DESCRIPCIÓN TRABAJOS','TIEMPO PARADA','TIEMPO TRABAJO','RAZÓN TRABAJO']];
    let n = 0;
    for(const r of t.rows){
      const cod = _at_(r, iCod), fecha = _at_(r, iFec), tie = _at_(r, iTie);
      if(!_snapNormCod(cod) && !fecha && !tie) continue;
      out.push([cod, _at_(r, iEqu), fecha, _at_(r, iLug), _at_(r, iPer), _at_(r, iDes), _at_(r, iPar), tie, _at_(r, iRaz)]);
      n++;
    }
    _write_(snap, 'TRAB_LIVE', out, true);
    var _miss = [['iLug',iLug],['iPer',iPer],['iDes',iDes],['iTie',iTie],['iPar',iPar],['iRaz',iRaz]].filter(function(x){return x[1]<0;}).map(function(x){return x[0];});
    return { tab:'TRAB_LIVE', rows:n, status:'OK', detalle: _miss.length ? ('⚠ cols sin match: '+_miss.join(',')+' | HDR fuente: '+h.join(' ¦ ')) : '' };
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
    // jul-2026: el archivo se reestructuró; la hoja pasó a llamarse 'REGISTRO
    // ENTREGAS' y EQUIPO/SECTOR, CÓDIGO, RAZÓN y RESPONSABLE llevan sufijo ' 1'
    // (slots 1..4 por entrega). Los 4 slots se leen: una entrega puede estar
    // imputada a varios equipos y su costo se reparte en partes iguales.
    const t = _readTab_(SNAP_SRC.repuestos, 'ENTREGAS') || _readTab_(SNAP_SRC.repuestos, 'REGISTRO ENTREGAS') || _readTabByHeader_(SNAP_SRC.repuestos, ['PROVEEDOR','COSTO']);
    if(!t){
      let tabs='';
      try{ tabs = SpreadsheetApp.openById(SNAP_SRC.repuestos).getSheets().map(s=>s.getName()).join(' | '); }catch(_){}
      return { tab:'REP_LIVE', rows:0, status:'ERROR', detalle:'no encontré hoja de entregas (ni "ENTREGAS" ni una con PROVEEDOR/COSTO). Pestañas: '+tabs };
    }
    const h = t.header;
    const iNro = _idx_(h, ['N° ENTREGA','N ENTREGA','NRO ENTREGA','ENTREGA','N° DE ENTREGA']);
    const iFec = _idx_(h, ['FECHA','FECHA ENTREGA']);
    const iEqu = _idx_(h, ['EQUIPO','EQUIPO/SECTOR','EQUIPO/SECTOR 1']);
    const iCod = _idx_(h, ['CÓDIGO','CODIGO','CÓDIGO 1']);
    // Slots 2..4: una entrega puede imputarse hasta a 4 equipos. Emitimos UNA
    // fila por equipo imputado (misma entrega, COSTO verbatim completo) y
    // publicamos cuántos equipos comparten la entrega en 'EQUIPOS IMPUTADOS';
    // el browser divide el costo por ese número al atribuirlo por equipo.
    const SLOTS = [
      { eq:iEqu, cod:iCod },
      { eq:_idx_(h, ['EQUIPO/SECTOR 2']), cod:_idx_(h, ['CÓDIGO 2','CODIGO 2']) },
      { eq:_idx_(h, ['EQUIPO/SECTOR 3']), cod:_idx_(h, ['CÓDIGO 3','CODIGO 3']) },
      { eq:_idx_(h, ['EQUIPO/SECTOR 4']), cod:_idx_(h, ['CÓDIGO 4','CODIGO 4']) },
    ];
    const iCos = _idx_(h, ['COSTO','PRECIO','TOTAL','IMPORTE','COSTO ENTREGA','PRECIO TOTAL','MONTO','COSTO TOTAL']);
    const iRaz = _idx_(h, ['DESTINO/RAZÓN','RAZÓN','RAZON','MOTIVO','DESTINO','RAZÓN 1']);
    const iRes = _idx_(h, ['RESPONSABLE','RESPONSABLE ENTREGA','RESPONSABLE 1']);
    const iIte = _idx_(h, ['DESCRIPCIÓN DE REPUESTOS','DESCRIPCION DE REPUESTOS','REPUESTOS','ITEMS DETALLE','DESCRIPCIÓN','DESCRIPCION']);
    // N° PEDIDO de la entrega: vínculo entrega→pedido (el otro sentido del que
    // trae PED_PEND). Algunas entregas registran el pedido acá aunque el pedido
    // no tenga el back-ref N° ENTREGA cargado → el browser matchea por ambos
    // lados y así no quedan "entregas sin pedido" que en realidad sí lo tienen.
    const iPed = _idx_(h, ['N° PEDIDO','N PEDIDO','NRO PEDIDO','PEDIDO','N° DE PEDIDO','N° PEDIDO ENTREGADO']);
    // TIPO ENTREGA: "Caja chica" u "Orden de compra". Las de caja chica nunca
    // tienen (ni necesitan) un N° PEDIDO vinculado — el browser las excluye de
    // la lista de "entregas sin pedido vinculado" para no marcarlas como falla.
    const iTip = _idx_(h, ['TIPO ENTREGA']);

    const out = [['N° ENTREGA','FECHA','EQUIPO','CÓDIGO','COSTO ENTREGA','RAZÓN ENTREGA','RESPONSABLE ENTREGA','ITEMS DETALLE','EQUIPOS IMPUTADOS','N° PEDIDO','TIPO ENTREGA']];
    let n = 0, nMulti = 0;
    for(const r of t.rows){
      const nro = _at_(r, iNro), fecha = _at_(r, iFec);
      if(!nro && !fecha) continue;
      // Equipos realmente imputados: código no vacío y distinto de '-'
      // (_snapNormCod('-') === ''), sin repetir el mismo equipo dos veces.
      const imputados = [], vistos = {};
      for(const s of SLOTS){
        const cod = _at_(r, s.cod), key = _snapNormCod(cod);
        if(!key || vistos[key]) continue;
        vistos[key] = 1;
        imputados.push({ eq:_at_(r, s.eq), cod:cod });
      }
      const costo = _at_(r, iCos), raz = _at_(r, iRaz), res = _at_(r, iRes), ite = _at_(r, iIte), ped = _at_(r, iPed), tip = _at_(r, iTip);
      if(!imputados.length){
        // Entrega sin equipo válido (código '-' o vacío): se mantiene tal cual,
        // no se atribuye a nadie (el browser ya descarta código '-').
        out.push([nro, fecha, _at_(r, iEqu), _at_(r, iCod), costo, raz, res, ite, '1', ped, tip]);
        n++;
        continue;
      }
      if(imputados.length > 1) nMulti++;
      for(const im of imputados){
        out.push([nro, fecha, im.eq, im.cod, costo, raz, res, ite, String(imputados.length), ped, tip]);
        n++;
      }
    }
    _write_(snap, 'REP_LIVE', out, true);
    const det = iCos < 0 ? 'OJO: no encontré columna de costo en ENTREGAS'
                         : (nMulti ? ('entregas multi-equipo: ' + nMulti) : '');
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
    // jul-2026: el archivo se reestructuró; la hoja pasó a llamarse 'REGISTRO
    // PEDIDOS' y las columnas EQUIPO/SECTOR y CÓDIGO llevan sufijo ' 1' (hay
    // slots 1..4 por pedido, pero a la fecha solo se usa el 1).
    const t = _readTab_(SNAP_SRC.repuestos, 'PEDIDOS') || _readTab_(SNAP_SRC.repuestos, 'REGISTRO PEDIDOS') || _readTabByHeader_(SNAP_SRC.repuestos, ['ESTADO']);
    if(!t){
      let tabs='';
      try{ tabs = SpreadsheetApp.openById(SNAP_SRC.repuestos).getSheets().map(s=>s.getName()).join(' | '); }catch(_){}
      _write_(snap, 'PED_PEND', [['N°','FECHA','EQUIPO','CÓDIGO','DESCRIPCIÓN','ESTADO']], false); _write_(snap, 'PED_ENTR', [['','','','','','','','']], true);
      return { tab:'PED_PEND', rows:0, status:'ERROR', detalle:'no encontré hoja de pedidos (ni "PEDIDOS" ni una con columna ESTADO). Pestañas: '+tabs }; }
    const h = t.header;
    const iNro = _idx_(h, ['N°','NRO','N° PEDIDO','NUMERO','ID','L1122']);
    const iFec = _idx_(h, ['FECHA']);
    const iEqu = _idx_(h, ['EQUIPO/SECTOR','EQUIPO','EQUIPO/SECTOR 1']);
    const iCod = _idx_(h, ['CÓDIGO','CODIGO','CÓDIGO 1']);
    const iDes = _idx_(h, ['DESCRIPCIÓN DE REPUESTOS','DESCRIPCION DE REPUESTOS','DESCRIPCIÓN','DESCRIPCION','REPUESTOS']);
    const iEst = _idx_(h, ['ESTADO']);
    // N° ORDEN (orden de compra) y N° ENTREGA (back-ref del pedido a su/s
    // entrega/s, ej. "1168" o "648-650" cuando fue parcial/multi). Con N° ENTREGA
    // el browser cruza a REP_LIVE para traer fecha y costo de la entrega al
    // renglón del pedido. Se agregan como cols 7 y 8 (posiciones 0-5 intactas
    // porque renderDashboard lee PED_PEND posicional).
    const iOrd = _idx_(h, ['N° ORDEN','N ORDEN','NRO ORDEN','ORDEN','N° ORDEN DE COMPRA','N° OC','ORDEN DE COMPRA','N ORDEN DE COMPRA']);
    const iEnt = _idx_(h, ['N° ENTREGA','N ENTREGA','NRO ENTREGA','ENTREGA','N° DE ENTREGA']);
    // Si el N° no está como header reconocible, usar la primera columna (la "L1122"
    // del archivo tiene los números de pedido como valores).
    const cNro = iNro >= 0 ? iNro : 0;

    const out = [['N°','FECHA','EQUIPO','CÓDIGO','DESCRIPCIÓN','ESTADO','N° ORDEN','N° ENTREGA']];
    let n = 0;
    for(const r of t.rows){
      const nro = _at_(r, cNro), estado = _at_(r, iEst);
      if(!nro && !estado) continue;
      out.push([nro, _at_(r, iFec), _at_(r, iEqu), _at_(r, iCod), _at_(r, iDes), estado, _at_(r, iOrd), _at_(r, iEnt)]);
      n++;
    }
    _write_(snap, 'PED_PEND', out, false);
    _write_(snap, 'PED_ENTR', [['','','','','','','','']], true); // sin uso (entregas → REP_LIVE)
    return { tab:'PED_PEND', rows:n, status:'OK', detalle:'' };
  }catch(e){ return { tab:'PED_PEND', rows:0, status:'ERROR', detalle:String(e && e.message || e) }; }
}

/* ═══════════════════════════════════════════════════════════════════════
   COMBUSTIBLE ← 2 fuentes apiladas al mismo stream (match por código):
     · ENTREGAS DE COMBUSTIBLE - LEANDRO CASARES (pesados, horómetro)
     · ENTREGAS DE COMBUSTIBLE camionetas (código directo, sin costo ni horómetro)
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
    // Fuente actual (ago-2026): 'ESTADO HORÓMETRO/ODÓMETRO' (agregaron "/ODÓMETRO").
    const iEst = _idx_(h, ['ESTADO HORÓMETRO/ODÓMETRO','ESTADO HORÓMETRO','ESTADO HOROMETRO','ESTADO']);
    // Fuente actual (ago-2026): 'HORÓMETRO/ODÓMETRO ACTUAL (HR/KM)' (antes 'HORÓMETRO ACTUAL (HR)').
    const iHr  = _idx_(h, ['HORÓMETRO/ODÓMETRO ACTUAL (HR/KM)','HOROMETRO ACTUAL HR','HORÓMETRO ACTUAL','HOROMETRO ACTUAL']);
    const iLit = _idx_(h, ['CANTIDAD (L)','CANTIDAD','LITROS']);
    const iTip = _idx_(h, ['TIPO COMBUSTIBLE','TIPO DE COMBUSTIBLE','TIPO']);
    // Fuente actual: 'LUGAR ENTREGA/OBRA PARTICULAR'.
    const iLug = _idx_(h, ['LUGAR ENTREGA OBRA PARTICULAR','LUGAR ENTREGA','LUGAR']);
    const iOpe = _idx_(h, ['OPERARIO']);

    const out = [['CODIGO','FECHA','ESTADO','HOROMETRO ACTUAL','CANTIDAD','TIPO','LUGAR','OPERARIO','OBSERVACIONES']];
    let n = 0;
    for(const r of t.rows){
      const cod = _at_(r, iCod);
      if(!_snapNormCod(cod)) continue;
      out.push([cod, _at_(r, iFec), _at_(r, iEst), _at_(r, iHr), _at_(r, iLit), _at_(r, iTip), _at_(r, iLug), _at_(r, iOpe), '']);
      n++;
    }
    // ── Camionetas: 2ª fuente que apila al MISMO stream (match por código).
    //    Sin costo y sin horómetro/odómetro usable → ESTADO vacío ⇒ el browser
    //    guarda la carga con hr=null (no calcula consumo), pero suma litros/mes
    //    e historial por equipo. Columnas de la fuente:
    //    FECHA · REMITO INTERNO · TIPO COMBUSTIBLE · CANTIDAD · EQUIPO · CÓDIGO
    //    · N° SERIE/PATENTE · ODÓMETRO · RESPONSABLE · OBRA PARTICULAR · OBRA GENERAL
    let nCam = 0;
    try{
      const tc = _readTabByHeader_(SNAP_SRC.combCamionetas, ['REMITO INTERNO']);
      if(tc){
        const hc = tc.header;
        const cCod = _idx_(hc, ['CÓDIGO','CODIGO','CÓDIGO INTERNO','CODIGO INTERNO']);
        const cFec = _idx_(hc, ['FECHA']);
        const cLit = _idx_(hc, ['CANTIDAD (L)','CANTIDAD','LITROS']);
        const cTip = _idx_(hc, ['TIPO COMBUSTIBLE','TIPO DE COMBUSTIBLE','TIPO']);
        const cObr = _idx_(hc, ['OBRA PARTICULAR','OBRA GENERAL','OBRA']);
        const cRes = _idx_(hc, ['RESPONSABLE','OPERARIO','CHOFER']);
        const cRem = _idx_(hc, ['REMITO INTERNO','REMITO']);
        for(const r of tc.rows){
          const cod = _at_(r, cCod);
          if(!_snapNormCod(cod)) continue;   // "Bidón"/Obra sin código → se ignoran
          // Solo auditoría de cargas: hs/km salen de la planilla de service, NO de acá.
          // ESTADO vacío ⇒ el browser guarda con hr=null (no calcula consumo).
          out.push([
            cod, _at_(r, cFec), '', '',
            _at_(r, cLit), _at_(r, cTip), _at_(r, cObr), _at_(r, cRes),
            cRem >= 0 ? ('Remito ' + _at_(r, cRem)) : '',
          ]);
          nCam++;
        }
      }
    }catch(eCam){ /* si la fuente de camionetas falla, no tiramos todo el snapshot */ }

    _write_(snap, 'COMBUSTIBLE', out, true);
    const faltan = [];
    if(iHr  < 0) faltan.push('HOROMETRO ACTUAL');
    if(iEst < 0) faltan.push('ESTADO');
    if(iCod < 0) faltan.push('CODIGO');
    if(iLit < 0) faltan.push('CANTIDAD');
    const detCam = nCam ? ('camionetas: '+nCam) : '';
    return { tab:'COMBUSTIBLE', rows:n+nCam, status: faltan.length ? 'WARN' : 'OK',
             detalle: (faltan.length ? ('OJO: sin match de columna → ' + faltan.join(', ') + (detCam?' · ':'')) : '') + detCam };
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
    // La fuente titula la patente 'N° SERIE - N° PATENTE' (→ NSERIENPATENTE).
    // Sin este sinónimo iPat quedaba -1 → patente vacía → el ranking del KPI
    // no matcheaba nada (el total sí, porque suma sin mirar patente).
    const iPat = _idx_(h, ['N SERIE PATENTE','N SERIE N PATENTE','N° PATENTE','PATENTE','DOMINIO']);
    // La fuente titula la columna 'HORÓMETRO/ODÓMETRO (HR/KM)'. _snapNormCod
    // borra símbolos → 'HOROMETROODOMETROHRKM'; sin este sinónimo iOdo daba -1
    // y TODAS las cargas de livianos salían sin km (litros sí, odómetro vacío).
    const iOdo = _idx_(h, ['HOROMETRO ODOMETRO HR KM','HORÓMETRO/ODÓMETRO','ODÓMETRO (KM)','ODOMETRO','KM']);
    const iOpe = _idx_(h, ['OPERARIO','CHOFER']);
    const iObr = _idx_(h, ['OBRA PARTICULAR','OBRA GENERAL','OBRA','LUGAR','LUGAR ENTREGA']);
    const iTot = _idx_(h, ['PRECIO TOTAL','TOTAL','IMPORTE','COSTO']);

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
    const faltan = [];
    if(iTot < 0) faltan.push('TOTAL/precio');
    if(iOdo < 0) faltan.push('ODOMETRO');
    if(iPat < 0) faltan.push('PATENTE');
    if(iLit < 0) faltan.push('LITROS');
    const det = faltan.length ? ('OJO: sin match de columna → ' + faltan.join(', ')) : '';
    return { tab:'COMB_LIVIANOS', rows:n, status: faltan.length ? 'WARN' : 'OK', detalle:det };
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
    // jul-2026: la pestaña se renombró OPERATIVIDAD → RESUMEN (mismo layout).
    const t = _readTab_(SNAP_SRC.services, 'OPERATIVIDAD') || _readTab_(SNAP_SRC.services, 'RESUMEN') || _readTabByHeader_(SNAP_SRC.services, ['OPERATIVIDAD']);
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
    const iUFe = _idx_(h, ['ÚLTIMO SERVICE FECHA','ULTIMO SERVICE FECHA','ULT FECHA','FECHA ÚLTIMO SERVICE']);
    const iUHr = _idx_(h, ['ÚLTIMO SERVICE HR/KM/FECHA','ÚLTIMO SERVICE HR/KM','ULTIMO SERVICE HR/KM','ULT HRKM','HR/KM/FECHA ÚLTIMO SERVICE']);
    const iPro = _idx_(h, ['PRÓXIMO SERVICE','PROXIMO SERVICE','PROX','HR/KM/FECHA PRÓXIMO SERVICE']);
    const iOpv = _idx_(h, ['OPERATIVIDAD']);
    const iEst = _idx_(h, ['ESTADO']);

    // ── Base: filas del RESUMEN tal cual (frecuencia, desc, patente + fallback) ──
    const base = {}; // cod -> {desc,pat,frec,ultFecha,ultHr,actual,prox,oper,est}
    const orden = [];
    for(const r of t.rows){
      const cod = _at_(r, iCod);
      if(!_snapNormCod(cod)) continue;
      base[cod] = { desc:_at_(r,iDes), pat:_at_(r,iPat), frec:_at_(r,iFre),
                    ultFecha:_at_(r,iUFe), ultHr:_at_(r,iUHr), actual:_at_(r,iAct),
                    prox:_at_(r,iPro), oper:_at_(r,iOpv), est:_at_(r,iEst) };
      orden.push(cod);
    }

    // ── Refresco desde la PLANILLA DE SERVICE viva (jul-2026, pedido de
    // Marcos: TODO sale únicamente de esa planilla — nada de LISTA ni de
    // combustible en las horas) ──
    //  · último/próximo service: fila MÁS RECIENTE de REGISTROS por código
    //  · hr/km actual: columna HR/KM/FECHA ACTUAL del RESUMEN, tal cual;
    //    equipos S/H (frecuencia por días): actual = hoy (así los días
    //    restantes descuentan solos, igual que hace su script al regenerar)
    //  · OPERATIVIDAD y ESTADO se recalculan con las MISMAS fórmulas del script
    //    del encargado (calcularEstadoSrv: <0 vencido; S/H 56/22 días; resto
    //    62,5%/25% de la frecuencia). Si algo no parsea, queda lo del RESUMEN.
    // LISTA DE EQUIPOS se usa SOLO para desc/patente de equipos nuevos que
    // aún no figuran en RESUMEN.
    let sintetizado = false;
    try{
      const reg = _readTab_(SNAP_SRC.services, 'REGISTROS');
      const eqm = _readTab_(SNAP_SRC.equipos, 'EQUIPOS');
      if(reg && eqm){
        const rh = reg.header;
        const rCod = _idx_(rh, ['CÓDIGO','CODIGO']);
        const rFec = _idx_(rh, ['FECHA']);
        const rHr  = _idx_(rh, ['HR/KM/FECHA SERVICE']);
        const rPro = _idx_(rh, ['HR/KM/FECHA PRÓXIMO SERVICE']);
        const ult = {};
        for(const r of reg.rows){
          const cod = _at_(r, rCod); if(!cod) continue;
          const f = _audParseFecha_(_at_(r, rFec)); if(!f) continue;
          if(!ult[cod] || f > ult[cod].f) ult[cod] = { f, hr:_at_(r,rHr), prox:_at_(r,rPro) };
        }
        const eh = eqm.header;
        const qCod = _idx_(eh, ['CÓDIGO','CODIGO']);
        const qHor = _idx_(eh, ['HORÓMETRO/ODÓMETRO','HOROMETRO/ODOMETRO','HORÓMETRO','ODÓMETRO']);
        const qDes = { cla:_idx_(eh,['CLASIFICACIÓN','CLASIFICACION']), mar:_idx_(eh,['MARCA']), mod:_idx_(eh,['MODELO']) };
        const qPat = _idx_(eh, ['N° SERIE/PATENTE','PATENTE/SERIE','PATENTE']);
        const lista = {};
        for(const r of eqm.rows){
          const cod = _at_(r, qCod); if(!cod) continue;
          lista[cod] = { hor:_at_(r,qHor),
            desc:[_at_(r,qDes.cla),_at_(r,qDes.mar),_at_(r,qDes.mod)].filter(function(v){return v && v!=='-';}).join(' '),
            pat:_at_(r,qPat) };
        }
        const hoy = new Date(); hoy.setHours(0,0,0,0);
        const hoyStr = Utilities.formatDate(hoy, Session.getScriptTimeZone(), 'dd/MM/yyyy');
        // Equipos con service en REGISTROS que todavía no figuran en RESUMEN
        for(const cod in ult){ if(!base[cod]){ base[cod] = { desc:(lista[cod]||{}).desc||'', pat:(lista[cod]||{}).pat||'', frec:'', ultFecha:'', ultHr:'', actual:'', prox:'', oper:'', est:'-' }; orden.push(cod); } }
        orden.sort();
        for(const cod of orden){
          const b = base[cod];
          const esSH = /S\s*\/\s*H/i.test(b.frec);
          const u = ult[cod];
          if(u){
            b.ultFecha = Utilities.formatDate(u.f, Session.getScriptTimeZone(), 'dd/MM/yyyy');
            b.ultHr = u.hr; b.prox = u.prox;
          }
          if(esSH){
            b.actual = hoyStr;
            const pf = _audParseFecha_(b.prox);
            if(pf){
              const dias = Math.round((pf.getTime() - hoy.getTime()) / 86400000);
              b.oper = String(dias);
              b.est = dias < 0 ? '⚠ VENCIDO' : dias > 56 ? '🟢 HOLGADO' : dias > 22 ? '🟡 INTERMEDIO' : '🔴 CRÍTICO';
            }
          } else {
            const actN = _audNum_(b.actual), proxN = _audNum_(b.prox), frecN = _audNum_(b.frec);
            if(actN != null && proxN != null){
              const oper = proxN - actN;
              b.oper = String(oper);
              if(frecN && frecN > 0){
                const pct = oper / frecN;
                b.est = oper < 0 ? '⚠ VENCIDO' : pct > 0.625 ? '🟢 HOLGADO' : pct > 0.25 ? '🟡 INTERMEDIO' : '🔴 CRÍTICO';
              } else if(oper < 0) b.est = '⚠ VENCIDO';
            }
          }
        }
        sintetizado = true;
      }
    }catch(e){ Logger.log('[service] síntesis falló, quedo verbatim RESUMEN: ' + (e && e.message || e)); }

    const panel = [['CODIGO','DESCRIPCION','PATENTE','ULT FECHA','ULT HRKM','HRKM ACTUAL','EST HRKM','OPERATIVIDAD','FRECUENCIA','ESTADO']];
    const eq = [SNAP_SVCEQ_HEADER.slice()];
    let n = 0;
    for(const cod of orden){
      const b = base[cod];
      panel.push([cod, b.desc, b.pat, b.ultFecha, b.ultHr, b.actual, b.prox, b.oper, b.frec, b.est]);
      // SERVICE_EQ: ACTUAL = hr/km actual del equipo, PROXIMO = próximo service.
      eq.push([_snapNormCod(cod), cod, cod, '', '', '', b.ultFecha, '', b.actual, b.prox, b.pat]);
      n++;
    }
    _write_(snap, 'SVC_PANELPROG', panel, true);
    _write_(snap, 'SERVICE_EQ', eq, true);
    var _miss = [['iAct',iAct],['iUFe',iUFe],['iUHr',iUHr],['iPro',iPro],['iOpv',iOpv],['iEst',iEst]].filter(function(x){return x[1]<0;}).map(function(x){return x[0];});
    var _det = n + ' equipos' + (sintetizado ? ' · sintetizado de REGISTROS+LISTA' : ' · verbatim RESUMEN');
    return { tab:'SVC_PANELPROG', rows:n, status:'OK', detalle: _miss.length ? (_det+' ⚠ cols sin match: '+_miss.join(',')+' | HDR fuente: '+h.join(' ¦ ')) : _det };
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
    // Reintentos: el 7/7/2026 un fallo TRANSITORIO de openById hizo recrear el
    // snapshot y repuntar el property → el panel (ID hardcodeado en app.js)
    // quedó leyendo el viejo congelado 6 días. Recrear es el último recurso.
    for(let intento = 1; intento <= 3; intento++){
      try{ return SpreadsheetApp.openById(id); }
      catch(e){
        Logger.log('Snapshot (' + id + ') no abre, intento ' + intento + '/3: ' + e.message);
        if(intento < 3) Utilities.sleep(2000 * intento);
      }
    }
    Logger.log('Snapshot guardado (' + id + ') no abre tras 3 intentos; recreo. OJO: hay que actualizar SNAPSHOT_ID en app.js o repuntar el property.');
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

/* ═══════════════════════════════════════════════════════════════════════
   VTV ← hoja VTV de VERIFICACIÓN TÉCNICA VEHICULAR
   Lista que Marcos carga a mano y va completando de a poco — a propósito
   incompleta. Copiamos verbatim (código, patente, fecha de vencimiento);
   el browser calcula los días restantes al vuelo así siempre está al día
   sin depender de una columna de días recalculada en el sheet.
═══════════════════════════════════════════════════════════════════════ */
function _buildVTV_(snap){
  try{
    const t = _readTab_(SNAP_SRC.vtv, 'VTV') || _readTabByHeader_(SNAP_SRC.vtv, ['VENCIMIENTO VTV']);
    if(!t){
      _write_(snap, 'VTV', [['EQUIPO','CÓDIGO','PATENTE','VENCIMIENTO VTV']], true);
      return { tab:'VTV', rows:0, status:'ERROR', detalle:'no encontré hoja VTV (ni columna VENCIMIENTO VTV)' };
    }
    const h = t.header;
    const iEqu = _idx_(h, ['EQUIPO']);
    const iCod = _idx_(h, ['CÓDIGO','CODIGO']);
    const iPat = _idx_(h, ['N° SERIE/PATENTE','N SERIE PATENTE','PATENTE','N° SERIE','SERIE']);
    const iVen = _idx_(h, ['VENCIMIENTO VTV','VENCIMIENTO']);

    const out = [['EQUIPO','CÓDIGO','PATENTE','VENCIMIENTO VTV']];
    let n = 0;
    for(const r of t.rows){
      const cod = _at_(r, iCod);
      if(!_snapNormCod(cod)) continue; // fila sin código: lista incompleta, se salta sin error
      out.push([_at_(r, iEqu), cod, _at_(r, iPat), _at_(r, iVen)]);
      n++;
    }
    _write_(snap, 'VTV', out, true);
    return { tab:'VTV', rows:n, status: iVen < 0 ? 'WARN' : 'OK', detalle: iVen < 0 ? 'OJO: no encontré columna VENCIMIENTO VTV' : '' };
  }catch(e){ return { tab:'VTV', rows:0, status:'ERROR', detalle:String(e && e.message || e) }; }
}

function _limpiarTabsSobrantes_(snap){
  const validas = {};
  ['COD_V','COD_L','COD_P','COD_S','TRAB_LIVE','TRAB_HIST','TRAB_HIST58','REP_LIVE','REP_HIST',
   'PED_PEND','PED_ENTR','COMBUSTIBLE','COMB_LIVIANOS','SVC_FREC','SVC_TRIM1','SVC_TRIM2',
   'SVC_PANELPROG','SERVICE_EQ','VTV','FALTANTES','INDICADORES','META'].forEach(t => validas[t] = true);
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

/* ═══════════════════════════════════════════════════════════════════════
   AUDITORÍA DE CONSISTENCIA DE CARGAS (2026-07-13)
   Cruza las fuentes entre sí y contra LISTA DE EQUIPOS (maestro único).
   El resultado va a Script Property AUDIT_JSON (PRIVADO — nunca al snapshot,
   que es público por gviz). Lo sirve refresh.js ?ep=audit contra AUDIT_PIN.
   Reglas:
     R1 código↔patente/serie no coincide con LISTA (o patente de flota sin código)
     R2 horómetro/odómetro retrocede en la línea de tiempo (combustible+services)
     R3 próximo service ≠ último + frecuencia (solo último registro por equipo)
     R4 RESUMEN desactualizado respecto de REGISTROS
     R5 el builder no está escribiendo el snapshot que lee el panel
     R6 código inexistente en LISTA DE EQUIPOS
═══════════════════════════════════════════════════════════════════════ */
const SNAP_CANON_ID = '1E883xvPP_Oyt1mjQ2FjZLiY-Jmvyzgi0_UhEq2dFbGY'; // el que lee app.js

function _audParseFecha_(s){
  const m = String(s||'').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(!m) return null;
  const d = new Date(+m[3], +m[2]-1, +m[1]);
  return isNaN(d.getTime()) ? null : d;
}
function _audNum_(v){
  const s = String(v==null?'':v).trim();
  if(!s || s==='-' || /^S\/H/i.test(s) || /\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) return null;
  const m = s.replace(/\./g,'').replace(',','.').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/* ═══════════════════════════════════════════════════════════════════════
   FALTANTES — "qué falta cargar" (PÚBLICO: lo ve el encargado)
   A diferencia de _auditar_() —que detecta datos MAL cargados y es privada—
   esta pestaña lista datos que FALTAN cargar. Es la lista de tareas del
   encargado, no un informe de control.
   Lee las pestañas YA escritas del snapshot (no las fuentes) para no volver
   a abrir las planillas: más rápido y coherente con lo que muestra el panel.
   Salida: FALTANTES [TIPO, CODIGO, EQUIPO, DETALLE, DIAS, PRIORIDAD].
═══════════════════════════════════════════════════════════════════════ */

// Clases de equipo que NO llevan horómetro/odómetro que alguien cargue: no
// tiene sentido reclamarles ficha de service. Las plantas de asfalto tienen
// horas pero hoy nadie las lleva; si algún día se cargan, sacarlas de acá.
const CLASES_SIN_HOROMETRO = ['COMPRESOR','GENERADOR','MARTILLOHIDRAULICO','MARTILLO','CARRETON','BATEA','PLANTADEASFALTO'];
const FALT_DIAS_HOROMETRO  = 30; // sin lectura nueva hace más de N días
const FALT_DIAS_VTV        = 30; // VTV que vence dentro de N días (o vencida)

function _faltDiasDesde_(d, hoy){ return Math.round((hoy.getTime() - d.getTime()) / 86400000); }

function _buildFaltantes_(snap){
  try{
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const out = [['TIPO','CODIGO','EQUIPO','DETALLE','DIAS','PRIORIDAD']];
    const add = (tipo, cod, eq, det, dias, pri) => out.push([tipo, cod, eq, det, dias===''?'':String(dias), pri]);

    const leer = name => {
      const sh = snap.getSheetByName(name);
      if(!sh || sh.getLastRow() < 2) return { header:[], rows:[] };
      const d = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
      return { header:d[0], rows:d.slice(1) };
    };

    // ── Catálogo de equipos activos ────────────────────────────────────
    const equipos = [];
    for(const tab of ['COD_V','COD_L','COD_P','COD_S']){
      const t = leer(tab);
      const iC = _idx_(t.header,['CODIGO']), iN = _idx_(t.header,['EQUIPO']),
            iE = _idx_(t.header,['ESTADO']), iP = _idx_(t.header,['PATENTE']),
            iL = _idx_(t.header,['CLASIFICACION']);
      for(const r of t.rows){
        const cod = _at_(r, iC); if(!cod) continue;
        const est = _at_(r, iE);
        if(/baja/i.test(est)) continue;               // de baja: no se reclama nada
        equipos.push({ cod:cod, key:_snapNormCod(cod), nom:_at_(r,iN)||cod,
                       est:est, pat:_at_(r,iP), clase:_snapNormCod(_at_(r,iL)) });
      }
    }

    // ── R1 · SIN_SERVICE ───────────────────────────────────────────────
    const svc = leer('SVC_PANELPROG');
    const svcSet = {}, svcUlt = {};
    {
      const iC = _idx_(svc.header,['CODIGO']), iF = _idx_(svc.header,['ULT FECHA']);
      for(const r of svc.rows){
        const k = _snapNormCod(_at_(r, iC)); if(!k) continue;
        svcSet[k] = true;
        const f = _audParseFecha_(_at_(r, iF)); if(f) svcUlt[k] = f;
      }
    }
    for(const e of equipos){
      if(svcSet[e.key]) continue;
      if(CLASES_SIN_HOROMETRO.indexOf(e.clase) >= 0) continue;  // no lleva horómetro
      add('SIN_SERVICE', e.cod, e.nom, 'No tiene ficha en la planilla de service', '', 'alta');
    }

    // ── R2/R3 · VTV faltante o por vencer ──────────────────────────────
    const vtv = leer('VTV');
    const vtvVenc = {};
    {
      const iC = _idx_(vtv.header,['CÓDIGO','CODIGO']), iV = _idx_(vtv.header,['VENCIMIENTO VTV','VENCIMIENTO']);
      for(const r of vtv.rows){
        const k = _snapNormCod(_at_(r, iC)); if(!k) continue;
        vtvVenc[k] = _audParseFecha_(_at_(r, iV));
      }
    }
    // VTV solo aplica a vehículos con dominio (patente de calle, no N° de serie).
    const esDominio = p => /^[A-Z]{2}\d{3}[A-Z]{2}$|^[A-Z]{3}\d{3}$/.test(_snapNormCod(p));
    for(const e of equipos){
      if(!esDominio(e.pat)) continue;
      const v = vtvVenc[e.key];
      if(v === undefined){
        add('SIN_VTV', e.cod, e.nom, 'Sin fecha de vencimiento de VTV cargada', '', 'media');
      }else if(v){
        const dias = -_faltDiasDesde_(v, hoy);   // + = faltan días, − = vencida
        if(dias < 0)               add('VTV_VENCIDA',    e.cod, e.nom, 'VTV vencida el ' + Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy'), dias, 'alta');
        else if(dias <= FALT_DIAS_VTV) add('VTV_POR_VENCER', e.cod, e.nom, 'VTV vence el ' + Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy'), dias, 'alta');
      }
    }

    // ── R4/R5 · sobre las cargas de combustible ────────────────────────
    // OJO: la "última lectura de horómetro" NO sale de SVC_PANELPROG — ahí
    // ULT FECHA es la fecha del último SERVICE, que es otra cosa (un equipo
    // puede tener el horómetro cargado ayer y el service hace 3 meses). La
    // única fuente con fecha+lectura por evento es la carga de combustible.
    const porPat = {};
    for(const e of equipos) if(e.pat) porPat[_snapNormCod(e.pat)] = e;
    const cortar = new Date(hoy.getTime() - 30 * 86400000);
    const sinOdo = {};      // cargas del último mes sin lectura, por código
    const ultLectura = {};  // fecha de la última carga CON lectura, por código
    const marcar = (cod, fecha, tieneLectura) => {
      if(tieneLectura){
        if(!ultLectura[cod] || fecha > ultLectura[cod]) ultLectura[cod] = fecha;
      }else if(fecha >= cortar){
        sinOdo[cod] = (sinOdo[cod] || 0) + 1;
      }
    };
    {
      const cl = leer('COMB_LIVIANOS');
      for(const r of cl.rows){
        const f = _audParseFecha_(_at_(r, 0)); if(!f) continue;
        const e = porPat[_snapNormCod(_at_(r, 5))]; if(!e) continue;
        marcar(e.cod, f, !!_at_(r, 6).replace(/[^\d]/g, ''));
      }
      const cp = leer('COMBUSTIBLE');
      for(const r of cp.rows){
        const f = _audParseFecha_(_at_(r, 1)); if(!f) continue;
        const cod = _at_(r, 0); if(!cod) continue;
        marcar(cod, f, !!_at_(r, 3).replace(/[^\d]/g, ''));
      }
    }
    // R4: tiene cargas con lectura alguna vez, pero la última es vieja.
    for(const e of equipos){
      if(CLASES_SIN_HOROMETRO.indexOf(e.clase) >= 0) continue;
      const f = ultLectura[e.cod]; if(!f) continue;   // nunca tuvo → lo agarra R5
      const dias = _faltDiasDesde_(f, hoy);
      if(dias > FALT_DIAS_HOROMETRO)
        add('HOROMETRO_VIEJO', e.cod, e.nom, 'Última lectura anotada: ' + Utilities.formatDate(f, Session.getScriptTimeZone(), 'dd/MM/yyyy'), dias, dias > 60 ? 'alta' : 'media');
    }
    for(const cod in sinOdo){
      const e = equipos.filter(function(x){ return x.cod === cod; })[0];
      if(!e || CLASES_SIN_HOROMETRO.indexOf(e.clase) >= 0) continue;
      add('CARGA_SIN_ODOMETRO', cod, e.nom, sinOdo[cod] + ' carga(s) del último mes sin horómetro/odómetro anotado', sinOdo[cod], sinOdo[cod] >= 3 ? 'alta' : 'baja');
    }

    _write_(snap, 'FALTANTES', out, true);
    const n = out.length - 1;
    return { tab:'FALTANTES', rows:n, status:'OK', detalle:n + ' pendientes de carga' };
  }catch(e){ return { tab:'FALTANTES', rows:0, status:'ERROR', detalle:String(e && e.message || e) }; }
}

/* ── Mail semanal de pendientes ────────────────────────────────────────
   NO tiene trigger instalado a propósito: Marcos tiene que confirmar el
   destinatario antes de que esto le empiece a llegar a alguien. Para
   activarlo: setear la Script Property FALT_MAIL_TO (uno o más mails
   separados por coma) y correr instalarTriggerMailSemanal() UNA vez.
   Si no hay pendientes, NO manda nada: un mail que a veces no llega se
   lee; uno que llega siempre se filtra.
─────────────────────────────────────────────────────────────────────── */
function enviarResumenSemanal(dryRun){
  const to = PropertiesService.getScriptProperties().getProperty('FALT_MAIL_TO');
  if(!to){ Logger.log('[mail] FALT_MAIL_TO no seteado — no envío nada'); return 'sin destinatario'; }

  const snap = _getOrCreateSnapshotSS_();
  const sh = snap.getSheetByName('FALTANTES');
  if(!sh || sh.getLastRow() < 2){ Logger.log('[mail] sin pendientes'); return 'sin pendientes'; }
  const rows = sh.getRange(2, 1, sh.getLastRow()-1, 6).getDisplayValues();
  if(!rows.length) return 'sin pendientes';

  const TITULO = {
    SIN_SERVICE:'Equipos sin ficha de service',
    SIN_VTV:'Vehículos sin VTV cargada',
    VTV_VENCIDA:'VTV VENCIDA',
    VTV_POR_VENCER:'VTV por vencer (30 días)',
    HOROMETRO_VIEJO:'Horómetro sin actualizar',
    CARGA_SIN_ODOMETRO:'Cargas de combustible sin odómetro',
  };
  const ORDEN = ['VTV_VENCIDA','VTV_POR_VENCER','SIN_SERVICE','HOROMETRO_VIEJO','SIN_VTV','CARGA_SIN_ODOMETRO'];
  const grupos = {};
  for(const r of rows){ (grupos[r[0]] = grupos[r[0]] || []).push(r); }

  const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  let html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222">'
           + '<p>Pendientes de carga del panel de mantenimiento — ' + rows.length + ' en total.</p>';
  for(const tipo of ORDEN){
    const g = grupos[tipo]; if(!g || !g.length) continue;
    html += '<h3 style="margin:18px 0 6px;font-size:15px">' + esc(TITULO[tipo] || tipo) + ' (' + g.length + ')</h3>'
          + '<table cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse;font-size:13px">';
    for(const r of g){
      html += '<tr style="border-bottom:1px solid #eee"><td style="font-family:monospace"><b>' + esc(r[1]) + '</b></td>'
            + '<td>' + esc(r[2]) + '</td><td style="color:#555">' + esc(r[3]) + '</td></tr>';
    }
    html += '</table>';
  }
  html += '<p style="margin-top:22px;font-size:12px;color:#777">Panel: '
        + 'https://marcoskatz-cmd.github.io/ingecov/ — este mail se genera solo, no hace falta responderlo.</p></div>';

  const asunto = 'Panel INGECO — ' + rows.length + ' pendientes de carga';
  // dryRun: arma el mail y lo devuelve SIN enviarlo. Sirve para verificar el
  // contenido sin mandarle un correo suelto a nadie.
  if(dryRun) return { dryRun:true, to:to, subject:asunto, pendientes:rows.length, html:html };

  MailApp.sendEmail({ to:to, subject:asunto, htmlBody:html });
  Logger.log('[mail] enviado a ' + to + ' (' + rows.length + ' pendientes)');
  return 'enviado a ' + to;
}

function instalarTriggerMailSemanal(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction() === 'enviarResumenSemanal') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('enviarResumenSemanal').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).create();
  return 'trigger semanal instalado (lunes 7 hs)';
}

function _auditar_(){
  const F = []; // findings: {r, fuente, fila, codigo, msg}
  const add = (r, fuente, fila, codigo, msg) => F.push({ r, fuente, fila, codigo, msg });

  // ── Maestro ──
  const eq = _readTab_(SNAP_SRC.equipos, 'EQUIPOS');
  if(!eq) throw new Error('no pude leer LISTA DE EQUIPOS');
  const hE = eq.header;
  const eCod = _idx_(hE, ['CÓDIGO','CODIGO','CODIGO INTERNO','CODIO INTERNO']);
  const ePat = _idx_(hE, ['PATENTE/SERIE','PATENTE','N° SERIE/PATENTE','N SERIE N PATENTE','SERIE']);
  const codmap = {}, master = {};
  for(const r of eq.rows){
    const cod = _at_(r, eCod); if(!cod) continue;
    const patN = _snapNormCod(_at_(r, ePat) === '-' ? '' : _at_(r, ePat));
    codmap[cod] = patN;
    if(patN) master[patN] = cod;
  }

  // ── Lector genérico de una fuente tabular ──
  const leer = (id, tabs, cols) => {
    let t = null;
    for(const tb of tabs){ t = _readTab_(id, tb); if(t) break; }
    if(!t) return null;
    const ix = {};
    for(const k in cols) ix[k] = _idx_(t.header, cols[k]);
    return { rows: t.rows, ix };
  };

  const SRC = {
    'SERVICE REGISTROS': leer(SNAP_SRC.services, ['REGISTROS'],
      { cod:['CÓDIGO','CODIGO'], pat:['N° SERIE/PATENTE','PATENTE'], fec:['FECHA'],
        hr:['HR/KM/FECHA SERVICE'], prox:['HR/KM/FECHA PRÓXIMO SERVICE'] }),
    'SERVICE RESUMEN': leer(SNAP_SRC.services, ['RESUMEN','OPERATIVIDAD'],
      { cod:['CÓDIGO','CODIGO'], pat:['N° SERIE/PATENTE','PATENTE'], frec:['FRECUENCIA'],
        ufec:['FECHA ÚLTIMO SERVICE'], uhr:['HR/KM/FECHA ÚLTIMO SERVICE'],
        prox:['HR/KM/FECHA PRÓXIMO SERVICE'] }),
    'COMB PESADOS': leer(SNAP_SRC.combPesados, ['ENTREGAS'],
      { cod:['CÓDIGO','CODIGO'], pat:['N° SERIE/PATENTE','PATENTE'], fec:['FECHA'],
        hr:['HORÓMETRO ACTUAL','HOROMETRO ACTUAL'] }),
    'COMB LIVIANOS': leer(SNAP_SRC.combLivianos, ['ENTREGAS'],
      { cod:['CÓDIGO','CODIGO'], pat:['N° SERIE/PATENTE','PATENTE'], fec:['FECHA'],
        hr:['HORÓMETRO/ODÓMETRO','HOROMETRO/ODOMETRO','ODÓMETRO'] }),
  };

  // ── R1 + R6 por fuente · además junta serie temporal para R2 ──
  const series = {}; // cod -> [{f:Date, v:num, ref:'fuente f123'}]
  for(const nombre in SRC){
    const s = SRC[nombre];
    if(!s){ add('R5','pipeline',0,'', 'no pude leer la fuente '+nombre); continue; }
    s.rows.forEach((r, i) => {
      const fila = i + 2;
      const cod = _at_(r, s.ix.cod);
      const patRaw = _at_(r, s.ix.pat);
      const patN = _snapNormCod(patRaw === '-' ? '' : patRaw);
      if(cod && cod !== '-'){
        if(!(cod in codmap)){
          add('R6', nombre, fila, cod, 'código inexistente en LISTA DE EQUIPOS (patente "'+patRaw+'")');
        } else if(patN && codmap[cod] && codmap[cod] !== patN){
          const dueno = master[patN];
          add('R1', nombre, fila, cod, 'patente/serie "'+patRaw+'" no es de '+cod+
            (dueno ? ' — según LISTA pertenece a '+dueno : ' — no figura en LISTA'));
        }
      } else if(patN && master[patN]){
        add('R1', nombre, fila, master[patN], 'fila sin código pero la patente "'+patRaw+'" es de '+master[patN]);
      }
      // serie temporal (solo fuentes con fecha + valor numérico)
      if(s.ix.fec >= 0 && s.ix.hr >= 0 && cod && cod !== '-'){
        const f = _audParseFecha_(_at_(r, s.ix.fec));
        const v = _audNum_(_at_(r, s.ix.hr));
        if(f && v != null && v > 0){
          (series[cod] = series[cod] || []).push({ f, v, ref: nombre+' f'+fila });
        }
      }
    });
  }

  // ── R2: retrocesos de horómetro (tolerancia: 2% del valor y mínimo 300) ──
  for(const cod in series){
    const pts = series[cod].sort((a,b)=>a.f-b.f);
    for(let i = 1; i < pts.length; i++){
      const prev = pts[i-1], cur = pts[i];
      const tol = Math.max(300, prev.v * 0.02);
      if(cur.v < prev.v - tol){
        add('R2','cronología',0,cod,'horómetro retrocede: '+prev.v+' ('+prev.ref+', '+
          Utilities.formatDate(prev.f,'GMT-3','dd/MM')+') → '+cur.v+' ('+cur.ref+', '+
          Utilities.formatDate(cur.f,'GMT-3','dd/MM')+')');
      }
    }
  }

  // ── R3 + R4: services ──
  const reg = SRC['SERVICE REGISTROS'], res = SRC['SERVICE RESUMEN'];
  if(reg && res){
    // frecuencia por código según RESUMEN
    const frecMap = {}, resUlt = {}, resSet = {};
    res.rows.forEach(r => {
      const cod = _at_(r, res.ix.cod); if(!cod) return;
      resSet[cod] = true;
      frecMap[cod] = _audNum_(_at_(r, res.ix.frec)); // null si "S/H (90 días)"
      resUlt[cod] = _audParseFecha_(_at_(r, res.ix.ufec));
    });
    // último registro por código
    const ult = {};
    reg.rows.forEach((r, i) => {
      const cod = _at_(r, reg.ix.cod); if(!cod) return;
      const f = _audParseFecha_(_at_(r, reg.ix.fec)); if(!f) return;
      if(!ult[cod] || f > ult[cod].f) ult[cod] = { f, fila: i+2, r };
    });
    for(const cod in ult){
      const u = ult[cod];
      const frec = frecMap[cod];
      const hr = _audNum_(_at_(u.r, reg.ix.hr));
      const prox = _audNum_(_at_(u.r, reg.ix.prox));
      if(frec && hr != null && prox != null && Math.abs(prox - (hr + frec)) > 0.5){
        add('R3','SERVICE REGISTROS',u.fila,cod,'próximo '+prox+' ≠ último '+hr+' + frecuencia '+frec+' (esperado '+(hr+frec)+')');
      }
      // R4: RESUMEN atrasado o sin el equipo
      if(!resSet[cod]){
        add('R4','SERVICE RESUMEN',0,cod,'tiene services en REGISTROS pero no figura en RESUMEN (correr «Actualizar resumen»)');
      } else if(resUlt[cod] && u.f > resUlt[cod]){
        add('R4','SERVICE RESUMEN',0,cod,'RESUMEN muestra último service '+
          Utilities.formatDate(resUlt[cod],'GMT-3','dd/MM/yyyy')+' pero REGISTROS tiene uno del '+
          Utilities.formatDate(u.f,'GMT-3','dd/MM/yyyy')+' (correr «Actualizar resumen»)');
      }
    }
  }

  // ── R5: pipeline del snapshot ──
  const propId = PropertiesService.getScriptProperties().getProperty(SNAP_PROP_KEY);
  if(propId && propId !== SNAP_CANON_ID){
    add('R5','pipeline',0,'','el builder escribe en '+propId+' pero el panel lee '+SNAP_CANON_ID+' — repuntar el property');
  }

  // ── Persistir (con firstSeen para distinguir novedades) ──
  const props = PropertiesService.getScriptProperties();
  let seen = {};
  try{ seen = JSON.parse(props.getProperty('AUDIT_SEEN') || '{}'); }catch(e){}
  const hoy = Utilities.formatDate(new Date(), 'GMT-3', 'dd/MM/yyyy');
  const seenNew = {};
  F.forEach(x => {
    const k = [x.r, x.fuente, x.codigo, x.msg].join('|');
    x.desde = seen[k] || hoy;
    seenNew[k] = x.desde;
  });
  const counts = {};
  F.forEach(x => counts[x.r] = (counts[x.r]||0) + 1);
  let lista = F;
  let truncado = false;
  if(lista.length > 120){ lista = lista.slice(0, 120); truncado = true; }
  const payload = { at: new Date().toISOString(), total: F.length, counts, truncado, findings: lista };
  let json = JSON.stringify(payload);
  while(json.length > 8800 && lista.length > 10){ // límite 9KB por property
    lista = lista.slice(0, Math.floor(lista.length * 0.7));
    payload.findings = lista; payload.truncado = true;
    json = JSON.stringify(payload);
  }
  props.setProperty('AUDIT_JSON', json);
  props.setProperty('AUDIT_SEEN', JSON.stringify(seenNew).slice(0, 9000));
  Logger.log('[auditoría] ' + F.length + ' hallazgos ' + JSON.stringify(counts));
}

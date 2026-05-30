/**
 * INGECO Panel — CONSTRUCTOR DE SNAPSHOT
 * ──────────────────────────────────────────────────────────────────────────
 * Va en el proyecto Apps Script STANDALONE "INGECO Panel API"
 * (cuenta marcoskatz@grupoingeco.com.ar). NO va en ningún Sheet.
 *
 * PROBLEMA QUE RESUELVE
 *   El panel (browser) hacía ~120+ requests gviz por carga: 17 primarios +
 *   58 pestañas del HIST de trabajos + ~31 horómetros + indicadores. gviz
 *   hace rate limiting muy por debajo de eso, y cada fetch tenía catch→[]
 *   (fail-open). Resultado: cada reload fallaba un subconjunto distinto de
 *   requests → los totales (hr, costos, entregas) cambiaban entre reloads.
 *   Los parches previos (_withRetry, batching) bajaban la probabilidad de
 *   falla pero no la eliminaban.
 *
 * QUÉ HACE ESTE SCRIPT
 *   Corre server-side cada 30 min (trigger). Lee TODO con SpreadsheetApp
 *   (sin CORS, sin rate-limit por cliente, acceso nativo) y lo vuelca en UN
 *   solo spreadsheet "INGECO Panel Snapshot". El browser pasa a leer SOLO
 *   ese snapshot (~20 pestañas de un spreadsheet) en vez de ~120 requests.
 *   El snapshot queda CONGELADO entre builds → cada reload lee exactamente
 *   las mismas filas → la variación desaparece.
 *
 * FILOSOFÍA (importante para no romper la fidelidad de los números)
 *   El builder NO recalcula KPIs. Hace:
 *     · copia VERBATIM de 17 pestañas fuente (getDisplayValues → strings
 *       idénticos a lo que devolvía gviz vía _cellStr/cell.f).
 *     · aplana SOLO las 2 fuentes fan-out (58 pestañas → TRAB_HIST58,
 *       ~31 horómetros → SERVICE_EQ) replicando EXACTAMENTE la lógica de
 *       _procesarPestanaHistTrabajos y precargarHorometros del browser.
 *   Toda la matemática de KPIs sigue en js/app.js (procesarPanelRepuestos,
 *   procesarPanelTrabajos, los merges LIVE+HIST por año, rangos). Así los
 *   números quedan idénticos a los "buenos" de hoy, con cero divergencia
 *   aritmética, y los merges se siguen editando en JS (rápido), no en GAS.
 *
 * ÚNICO CAMBIO ESPERADO EN LOS NÚMEROS (una sola vez, hacia un valor estable)
 *   Las 58 pestañas del HIST tienen celdas FECHA con rango ("21/3/2025 -
 *   26/3/2025") en columnas formato Date. gviz devolvía null para esas celdas
 *   (bug conocido) y el browser las "adivinaba" con heurística de vecinos.
 *   Server-side getDisplayValues SÍ lee el texto real del rango → se recuperan
 *   trabajos 2025 que el bug descartaba. ⇒ el total de hr 2025 puede SUBIR una
 *   vez y después queda FIJO. Es más correcto y estable. (Decisión: recuperar
 *   el dato real, no esconder el bug de lectura.)
 *
 * USO
 *   1) Pegar este archivo en el editor de Apps Script de "INGECO Panel API".
 *   2) Ejecutar construirSnapshot() una vez (autoriza permisos).
 *   3) Ejecutar verSnapshotId() → copiar el ID del log (lo necesita app.js).
 *   4) Verificar que el spreadsheet quedó compartido "cualquiera con el link
 *      puede ver" (el script lo intenta solo; si falló, hacerlo a mano).
 *   5) Ejecutar instalarTriggerSnapshot() → corre cada 30 min solo.
 *
 * El snapshot NO reemplaza a los consolidadores existentes
 * (actualizarPanelTrabajos / actualizarPanelRepuestos): los lee. Depende de
 * que esos hayan corrido (igual que el browser hoy).
 */

/* ═══════════════════════════════════════════════════════════════════════
   CONFIG — IDs de las fuentes (hardcodeados, espejo de SHEET_IDS en app.js)
═══════════════════════════════════════════════════════════════════════ */
const SNAP_SRC = {
  pedidos:            '1VFJwFLLEaOE9tTuwah7QkaDTrYkeYtOH8brUgSyHeFY',
  indicadores:        '1GpP2ejMVXncr2OLmKK_IP-zqr5AARi1Q3YdQIPlsUUE',
  codigos:            '1Z8kg4aC6KUNeWyxpPiD3xKntRYB4oghxsbnxqWQdVio', // INGECO Panel Mirror
  repuestos_live:     '1TUEoOul4SI5O323LcMq2VkaxdcTMfTmZce7NToGESfc', // LIVE PANEL_REPUESTOS
  repuestos_hist:     '1WCtB-8C1VP4-axoQ_ugk_ersCfPJFjMC1fEDXRHOKFE', // HIST pre-2026
  trabajos_live:      '1ItkY8miYOwQEsbbjZlNslb86f7HY3TEzywpQx6pD5tU', // LIVE PANEL_TRABAJOS
  trabajos_hist:      '1cNWQ44UEDiotHyB65BfTMcFuOCfQXYQoSNNAdAKTsy8', // HIST: PANEL + 58 pestañas
  service:            '1zB9q0e9kxRKe52-I0u5Dqg7PUSE_nlxi3IYn7pxF0Iw',
  combustible:        '19dqJ-tcdmXiOns99mJgMMmZNDT3kKS7EQXwHd7VDILc',
  programaService:    '1y6pqbXscej3139lkImWJsJHeJvFa0B5sneICEyyNPmI',
  combustibleLivianos:'1bZkxrdVEcN4v5Aztf4RBxncJKWE20Jti8wjNdCmAl-E',
};

const SNAP_NAME     = 'INGECO Panel Snapshot';
const SNAP_PROP_KEY = 'INGECO_SNAPSHOT_ID';

/* Las 17 pestañas que se copian VERBATIM.
   mode 'obj'  → el browser la lee con headers=1 (keys = fila 1). frozen 1.
   mode 'raw'  → el browser la lee con headers=0 (matriz completa). frozen 0.
   fromRow     → primera fila a copiar (PED_ENTR arranca en la 11: el sheet
                 tiene título+contadores arriba; la 11 es el header real).
   maxCols     → recorta columnas (PED_ENTR replica el range 'A11:H' = 8 cols). */
const SNAP_VERBATIM = [
  { tab:'PED_PEND',      src:'pedidos',            sheet:'PENDIENTES',                    mode:'raw' },
  { tab:'PED_ENTR',      src:'pedidos',            sheet:'ENTREGADOS',                    mode:'obj', fromRow:11, maxCols:8 },
  { tab:'COD_V',         src:'codigos',            sheet:'VIALES, ASFALTO Y TRITURACIÓN', mode:'raw' },
  { tab:'COD_L',         src:'codigos',            sheet:'TRANSPORTE LIVIANO',            mode:'raw' },
  { tab:'COD_P',         src:'codigos',            sheet:'TRANSPORTE PESADO',             mode:'raw' },
  { tab:'COD_S',         src:'codigos',            sheet:'SOPORTE',                       mode:'raw' },
  { tab:'REP_LIVE',      src:'repuestos_live',     sheet:'PANEL_REPUESTOS',               mode:'obj' },
  { tab:'REP_HIST',      src:'repuestos_hist',     sheet:'PANEL_REPUESTOS',               mode:'obj' },
  { tab:'TRAB_LIVE',     src:'trabajos_live',      sheet:'PANEL_TRABAJOS',                mode:'obj' },
  { tab:'TRAB_HIST',     src:'trabajos_hist',      sheet:'PANEL_TRABAJOS',                mode:'obj' },
  { tab:'SVC_FREC',      src:'programaService',    sheet:'FRECUENCIA - OPERATIVIDAD',     mode:'raw' },
  { tab:'SVC_TRIM1',     src:'programaService',    sheet:'1° TRIMESTRE',                  mode:'raw' },
  { tab:'SVC_TRIM2',     src:'programaService',    sheet:'2° TRIMESTRE',                  mode:'raw' },
  { tab:'SVC_PANELPROG', src:'service',            sheet:'PANEL_PROGRAMA',                mode:'obj' },
  { tab:'COMBUSTIBLE',   src:'combustible',        sheet:'ENTREGA DE COMBUSTIBLE',        mode:'obj' },
  { tab:'COMB_LIVIANOS', src:'combustibleLivianos',sheet:'Hoja 1',                        mode:'raw' },
  { tab:'INDICADORES',   src:'indicadores',        sheet:'INDICADORES OPERACIONALES',     mode:'raw' },
];

/* Las 58 pestañas POR EQUIPO del HIST de trabajos (1cNWQ). Se aplanan en
   TRAB_HIST58. Si se agrega un equipo nuevo al sheet, sumarlo acá. */
const SNAP_TRAB58 = [
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

/* Sheets de SERVICE por mes (espejo de SERVICE_MESES en app.js). Cada equipo
   tiene una pestaña con su nombre = código. Se aplanan en SERVICE_EQ.
   Orden = prioridad first-wins para el horómetro (Abril gana sobre Marzo, etc.). */
const SNAP_SERVICE_MESES = [
  { id:'1AK902grpUm6l0VflNsJy0Y7_4X770SL0tMfO7aBLNiw', mes:'Abril 2026',
    equipos:['CMT-01','CMT-03','CMT-21','CMT-22','CMT-23','CMT-25','MNV-02','MNV-03','RTP-05','RTP-07','RTP-08','RTP-09','EXC-01'] },
  { id:'1mzt3Fhvwr8J4Mhrz-uIfX4OPBG5-zqweQ7pn0B_s-Vc', mes:'Marzo 2026',
    equipos:['CF-03','CF-04','CMT-03','EXC-01','RDL-02','RN-02','RTP-05','RTP-09'] },
  { id:'1N062h_xp9TOWsuZuIX_QNMvXRfB2Tpyf7EwtBmqGImw', mes:'Febrero 2026',
    equipos:['CF-05','CMT-21','EXC-07','TPD-01'] },
  { id:'1chZDHgtkjb-Jcs18lgoHrH-KOInzbVgLu5Ew6ThdcE4', mes:'Enero 2026',
    equipos:['CF-02','CMN-03','CMN-22','CMT-20','MNV-02','RTP-08'] },
];

/* Headers de las pestañas construidas. Deben coincidir EXACTO con las keys
   que esperan _filtrarAnio / procesarPanelTrabajos (TRAB_HIST58) y el código
   de horómetros/modal (SERVICE_EQ) del browser. */
const SNAP_HIST58_HEADER = ['FECHA TRABAJO','LUGAR TRABAJO','CÓDIGO','DESCRIPCIÓN TRABAJOS','TIEMPO TRABAJO','EQUIPO'];
const SNAP_SVCEQ_HEADER  = ['CODN','RAWCOD','KVCOD','MES','SHEET_ID','PLANILLA','FECHA','PERSONAL','ACTUAL','PROXIMO','SERIE'];

/* ═══════════════════════════════════════════════════════════════════════
   HELPERS (réplicas EXACTAS de los del browser, para fidelidad)
═══════════════════════════════════════════════════════════════════════ */
// normCod: quita tildes, espacios, guiones, cualquier no alfanumérico, mayúsculas.
function _snapNormCod(s){
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^A-Za-z0-9]/g,'').toUpperCase();
}
// nk: normaliza key de kv (NFD sin combinantes, trim, upper). Conserva ° y /.
function _snapNk(s){
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
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

  // 1) 17 copias verbatim. Cada una aislada: si una fuente falla, las demás
  //    siguen y la pestaña conserva su último contenido bueno.
  for(const v of SNAP_VERBATIM){
    rec(_copiarVerbatim_(snap, v));
  }

  // 2) Aplanados (fan-out → 1 pestaña c/u).
  rec(_construirHist58_(snap));
  rec(_construirServiceEq_(snap));

  // 3) META (row counts + timestamp para el sello "datos al HH:MM" y para el
  //    chequeo fail-CLOSED del browser).
  _escribirMeta_(snap, meta, errores);

  // 4) Limpieza: borrar pestañas sobrantes (ej. la "Hoja 1" por defecto).
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
   COPIA VERBATIM
═══════════════════════════════════════════════════════════════════════ */
function _copiarVerbatim_(snap, v){
  try{
    const srcId = SNAP_SRC[v.src];
    const ss = SpreadsheetApp.openById(srcId);
    const sh = ss.getSheetByName(v.sheet);
    if(!sh) return { tab:v.tab, rows:0, status:'ERROR', detalle:'no existe pestaña "' + v.sheet + '"' };

    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if(lastRow < 1 || lastCol < 1) return { tab:v.tab, rows:0, status:'ERROR', detalle:'pestaña vacía' };

    const fromRow = v.fromRow || 1;
    if(fromRow > lastRow) return { tab:v.tab, rows:0, status:'ERROR', detalle:'fromRow > lastRow' };

    const nRows = lastRow - fromRow + 1;
    const nCols = v.maxCols ? Math.min(v.maxCols, lastCol) : lastCol;
    // getDisplayValues = strings ya formateados, idénticos a lo que gviz
    // devolvía vía cell.f (_cellStr). Recupera además el texto real de celdas
    // que gviz dejaba en null (rangos en columnas Date, errores de fórmula).
    const data = sh.getRange(fromRow, 1, nRows, nCols).getDisplayValues();

    // Recién acá tocamos el snapshot (lectura OK ⇒ no dejamos la pestaña a medias).
    const dst = _resetTab_(snap, v.tab);
    dst.getRange(1, 1, data.length, data[0].length).setValues(data);
    dst.setFrozenRows(v.mode === 'obj' ? 1 : 0);

    return { tab:v.tab, rows:data.length, status:'OK', detalle:'' };
  }catch(e){
    // No tocamos la pestaña destino → conserva el último build bueno.
    return { tab:v.tab, rows:0, status:'ERROR', detalle:String(e && e.message || e) };
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   APLANADO 1 — TRAB_HIST58 (réplica de _procesarPestanaHistTrabajos, sin el
   filtro por año: el browser filtra ===2025 con _filtrarAnio).
═══════════════════════════════════════════════════════════════════════ */
function _construirHist58_(snap){
  try{
    const ss = SpreadsheetApp.openById(SNAP_SRC.trabajos_hist);
    const out = [SNAP_HIST58_HEADER.slice()];
    let pestOk = 0;
    const faltantes = [];

    for(const pest of SNAP_TRAB58){
      const sh = ss.getSheetByName(pest);
      if(!sh){ faltantes.push(pest); continue; }
      const lastRow = sh.getLastRow();
      const lastCol = sh.getLastColumn();
      if(lastRow < 1 || lastCol < 1) continue;
      const data = sh.getRange(1, 1, lastRow, Math.max(lastCol, 5)).getDisplayValues();

      // Pasada 1: quedarnos con filas "trabajo" (código + tiempo > 0).
      // Layout de estas pestañas: [0]=FECHA [1]=LUGAR [2]=CÓDIGO [3]=DESC [4]=TIEMPO
      const trabajos = [];
      for(const r of data){
        const cod = String(r[2] == null ? '' : r[2]).trim();
        const tiempoStr = String(r[4] == null ? '' : r[4]).trim();
        const tNum = parseFloat(tiempoStr.replace(',', '.'));
        if(!cod || !isFinite(tNum) || tNum <= 0) continue;
        trabajos.push({
          fechaStr: String(r[0] == null ? '' : r[0]).trim(),
          lugar:    String(r[1] == null ? '' : r[1]).trim(),
          cod:      cod,
          desc:     String(r[3] == null ? '' : r[3]).trim(),
          tiempoStr: tiempoStr,
        });
      }
      // Pasada 2: completar fechas vacías con la próxima visible (o la anterior).
      let ultima = '';
      for(let i = 0; i < trabajos.length; i++){
        if(trabajos[i].fechaStr){ ultima = trabajos[i].fechaStr; continue; }
        let prox = '';
        for(let j = i + 1; j < trabajos.length; j++){
          if(trabajos[j].fechaStr){ prox = trabajos[j].fechaStr; break; }
        }
        trabajos[i].fechaStr = prox || ultima;
      }
      // Pasada 3: emitir filas con fecha (el browser filtra por año).
      for(const t of trabajos){
        if(!t.fechaStr) continue;
        out.push([t.fechaStr, t.lugar, t.cod, t.desc, t.tiempoStr, pest]);
      }
      pestOk++;
    }

    const dst = _resetTab_(snap, 'TRAB_HIST58');
    dst.getRange(1, 1, out.length, SNAP_HIST58_HEADER.length).setValues(out);
    dst.setFrozenRows(1);

    const det = pestOk + '/' + SNAP_TRAB58.length + ' pestañas'
              + (faltantes.length ? ' · faltan: ' + faltantes.join(', ') : '');
    return { tab:'TRAB_HIST58', rows:out.length, status: faltantes.length ? 'WARN' : 'OK', detalle:det };
  }catch(e){
    return { tab:'TRAB_HIST58', rows:0, status:'ERROR', detalle:String(e && e.message || e) };
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   APLANADO 2 — SERVICE_EQ (réplica de precargarHorometros + del fetch de
   service del modal de equipo). Una fila por (mes, equipo) con tab existente.
   Orden = SNAP_SERVICE_MESES (Abril primero) ⇒ first-wins para el horómetro.
═══════════════════════════════════════════════════════════════════════ */
function _construirServiceEq_(snap){
  try{
    const out = [SNAP_SVCEQ_HEADER.slice()];
    const ssCache = {};
    let filas = 0;

    for(const m of SNAP_SERVICE_MESES){
      let ss;
      try{ ss = ssCache[m.id] || (ssCache[m.id] = SpreadsheetApp.openById(m.id)); }
      catch(e){ continue; } // sheet del mes inaccesible → saltar el mes entero
      for(const rawCod of m.equipos){
        try{
          const sh = ss.getSheetByName(rawCod);
          if(!sh) continue;
          const lastRow = sh.getLastRow();
          if(lastRow < 1) continue;
          const lastCol = Math.max(sh.getLastColumn(), 2);
          const data = sh.getRange(1, 1, lastRow, lastCol).getDisplayValues();

          // kv: col0 = clave (normalizada nk), col1 = valor.
          const kv = {};
          for(const r of data){
            const k = _snapNk(r[0]);
            if(k) kv[k] = String(r[1] == null ? '' : r[1]).trim();
          }
          // Sólo emitimos si la pestaña tiene un CODIGO cargado (las vacías se ignoran).
          const kvCod = kv['CODIGO'] || '';
          if(!kvCod) continue;

          out.push([
            _snapNormCod(rawCod),
            rawCod,
            kvCod,
            m.mes,
            m.id,
            kv['N° PLANILLA'] || kv['N PLANILLA'] || '',
            kv['FECHA'] || '',
            kv['PERSONAL DE TRABAJO'] || '',
            kv['HOROMETRO/ODOMETRO TRABAJO ACTUAL'] || '',
            kv['HOROMETRO/ODOMETRO PROXIMO TRABAJO'] || '',
            kv['N° SERIE/N° PATENTE'] || kv['N SERIE/N PATENTE'] || '',
          ]);
          filas++;
        }catch(e){ /* equipo puntual falla → seguir con el resto */ }
      }
    }

    const dst = _resetTab_(snap, 'SERVICE_EQ');
    dst.getRange(1, 1, out.length, SNAP_SVCEQ_HEADER.length).setValues(out);
    dst.setFrozenRows(1);

    return { tab:'SERVICE_EQ', rows:out.length, status:'OK', detalle: filas + ' equipos-mes' };
  }catch(e){
    return { tab:'SERVICE_EQ', rows:0, status:'ERROR', detalle:String(e && e.message || e) };
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   META — una fila por pestaña (TAB, ROWS, STATUS, DETALLE) + build stamp.
   El browser la usa para: (a) sello "datos al HH:MM"; (b) chequeo fail-CLOSED
   (si una pestaña crítica quedó en 0/ERROR, mostrar "datos incompletos,
   reintentando" en vez de un total equivocado).
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

/* ═══════════════════════════════════════════════════════════════════════
   INFRA — spreadsheet snapshot, pestañas, limpieza
═══════════════════════════════════════════════════════════════════════ */
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
  Logger.log('Snapshot CREADO. ID=' + id);
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
  SNAP_VERBATIM.forEach(v => validas[v.tab] = true);
  ['TRAB_HIST58','SERVICE_EQ','META'].forEach(t => validas[t] = true);
  const sheets = snap.getSheets();
  for(const sh of sheets){
    if(!validas[sh.getName()]){
      try{ snap.deleteSheet(sh); }catch(e){ /* nunca borrar la última pestaña */ }
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   UTILIDADES MANUALES (ejecutar desde el editor)
═══════════════════════════════════════════════════════════════════════ */
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

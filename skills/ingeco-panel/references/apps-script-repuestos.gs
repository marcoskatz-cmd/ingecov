/**
 * INGECOV — Consolidador PANEL_REPUESTOS
 *
 * Vive en el Apps Script del Sheet maestro de entregas de repuestos.
 * ID actual del Sheet: 1TUEoOul4SI5O323LcMq2VkaxdcTMfTmZce7NToGESfc
 *
 * Itera la carpeta del Drive identificada por FOLDER_ID (que contiene
 * los archivos mensuales `ENTREGAS DE REPUESTOS <MES> <AÑO>`), recorre
 * cada Google Sheet (ignora .xlsx), procesa todas las pestañas con
 * nombre puramente numérico (cada pestaña = una entrega) y vuelca todo
 * consolidado en la pestaña PANEL_REPUESTOS del Sheet maestro.
 *
 * Para ejecutar: menú INGECOV → "Actualizar PANEL_REPUESTOS"
 *
 * Layout asumido de cada pestaña <N° entrega>:
 *   B4  = N° entrega    | B5  = N° pedido entregado
 *   B6  = fecha
 *   B8  = nombre del equipo | B9  = código | B10 = N° serie/patente
 *   B12 = costo entrega | B13 = razón entrega
 *   Fila 15 = header de items: CANTIDAD | DESCRIPCIÓN | CÓDIGO | PROVEEDOR | OSBERVACIÓN (sic)
 *   Filas 16 hasta donde aparezca "RESPONSABLE ENTREGA" en columna A = items
 *   La fila "RESPONSABLE ENTREGA" tiene el responsable como valor a la derecha
 *
 * Pestañas a ignorar: RESUMEN, Hoja1, Hoja2, etc. El filtro `^\d+$`
 * acepta solo pestañas con nombre puramente numérico.
 *
 * El archivo padre se identifica por mes en el nombre. Si el nombre del
 * archivo no contiene un mes, se omite (ej: "ENTREGAS DE REPUESTOS 2026"
 * sin mes específico es probablemente un agregado anual).
 */

const CFG_R = {
  PANEL_SHEET: 'PANEL_REPUESTOS',
  FOLDER_ID: '18j8Sk7NoDdLp1hJmmb6STJBmk_Kd_AXi',  // carpeta "ENTREGAS DE REPUESTOS"
  ROW: {
    NRO_ENTREGA: 4,
    NRO_PEDIDO:  5,
    FECHA:       6,
    EQUIPO:      8,
    CODIGO:      9,
    SERIE:       10,
    COSTO:       12,
    RAZON:       13
  },
  COL_KV: 2,
  ROW_INICIO_ITEMS: 16,
  N_COLS_ITEMS: 5
};

const HEADERS_R = [
  'MES', 'AÑO ARCHIVO',
  'N° ENTREGA', 'N° PEDIDO ENTREGADO', 'FECHA',
  'EQUIPO', 'CÓDIGO', 'N° SERIE/PATENTE',
  'COSTO ENTREGA', 'RAZÓN ENTREGA', 'RESPONSABLE ENTREGA',
  'CANTIDAD ITEMS', 'ITEMS DETALLE'
];

const MESES_R = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                 'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];

function actualizarPanelRepuestos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const miPropioId = ss.getId();

  let panel = ss.getSheetByName(CFG_R.PANEL_SHEET);
  if (!panel) panel = ss.insertSheet(CFG_R.PANEL_SHEET);
  panel.clear();
  panel.getRange(1, 1, 1, HEADERS_R.length).setValues([HEADERS_R]);
  panel.setFrozenRows(1);

  const filasOut = [];
  let archivosOk = 0, archivosSkip = 0, archivosErr = 0;
  let pestanasOk = 0, pestanasNoNumericas = 0, pestanasVacias = 0, totalItems = 0;

  const folder = DriveApp.getFolderById(CFG_R.FOLDER_ID);
  const files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);

  while (files.hasNext()) {
    const file = files.next();
    const fileId = file.getId();
    if (fileId === miPropioId) { archivosSkip++; continue; }

    const fileName = file.getName();
    const { mes, anio } = parsearMesAnio_(fileName);
    if (!mes) { archivosSkip++; Logger.log(`Skip "${fileName}" (sin mes)`); continue; }

    let mensual;
    try { mensual = SpreadsheetApp.openById(fileId); }
    catch (e) {
      archivosErr++;
      Logger.log(`No se pudo abrir "${fileName}": ${e.message}`);
      continue;
    }
    archivosOk++;

    mensual.getSheets().forEach(sh => {
      const nombre = sh.getName();
      if (!/^\d+$/.test(nombre)) { pestanasNoNumericas++; return; }

      const nroEntrega = leerCelda_(sh, CFG_R.ROW.NRO_ENTREGA, CFG_R.COL_KV) || nombre;
      const nroPedido  = leerCelda_(sh, CFG_R.ROW.NRO_PEDIDO,  CFG_R.COL_KV);
      const fecha      = leerCelda_(sh, CFG_R.ROW.FECHA,       CFG_R.COL_KV);
      const equipo     = leerCelda_(sh, CFG_R.ROW.EQUIPO,      CFG_R.COL_KV);
      const codigo     = leerCelda_(sh, CFG_R.ROW.CODIGO,      CFG_R.COL_KV);
      const serie      = leerCelda_(sh, CFG_R.ROW.SERIE,       CFG_R.COL_KV);
      const costo      = leerCelda_(sh, CFG_R.ROW.COSTO,       CFG_R.COL_KV);
      const razon      = leerCelda_(sh, CFG_R.ROW.RAZON,       CFG_R.COL_KV);

      const lastRow = sh.getLastRow();
      const colA = lastRow > 0 ? sh.getRange(1, 1, lastRow, 1).getValues() : [];
      let filaResp = -1;
      for (let i = CFG_R.ROW_INICIO_ITEMS - 1; i < colA.length; i++) {
        const txt = String(colA[i][0] || '').toUpperCase();
        if (txt.includes('RESPONSABLE')) { filaResp = i + 1; break; }
      }
      const finItems = filaResp > 0 ? filaResp - 1 : lastRow;

      const items = [];
      if (finItems >= CFG_R.ROW_INICIO_ITEMS) {
        const n = finItems - CFG_R.ROW_INICIO_ITEMS + 1;
        const rango = sh.getRange(CFG_R.ROW_INICIO_ITEMS, 1, n, CFG_R.N_COLS_ITEMS).getValues();
        rango.forEach(row => {
          const [cantidad, descripcion, cod, proveedor, observacion] = row;
          if (!cantidad && !descripcion && !cod && !proveedor) return;
          items.push({ cantidad, descripcion, cod, proveedor, observacion });
        });
      }

      let responsable = '';
      if (filaResp > 0) {
        const filaR = sh.getRange(filaResp, 1, 1, 5).getValues()[0];
        for (let j = 1; j < filaR.length; j++) {
          if (filaR[j]) { responsable = filaR[j]; break; }
        }
      }

      if (!fecha && !equipo && !codigo && items.length === 0) {
        pestanasVacias++;
        return;
      }

      const itemsDetalle = items.map(it => {
        const partes = [];
        if (it.cantidad)    partes.push(`${it.cantidad}x`);
        if (it.descripcion) partes.push(it.descripcion);
        const extras = [];
        if (it.cod)         extras.push(`cód ${it.cod}`);
        if (it.proveedor)   extras.push(`prov ${it.proveedor}`);
        if (it.observacion) extras.push(`obs: ${it.observacion}`);
        if (extras.length)  partes.push(`(${extras.join(', ')})`);
        return partes.join(' ');
      }).join(' | ');

      filasOut.push([
        mes, anio,
        nroEntrega, nroPedido, formatearFecha_(fecha),
        equipo, codigo, serie,
        costo, razon, responsable,
        items.length, itemsDetalle
      ]);

      totalItems += items.length;
      pestanasOk++;
    });
  }

  if (filasOut.length > 0) {
    panel.getRange(2, 1, filasOut.length, HEADERS_R.length).setValues(filasOut);
  }
  panel.autoResizeColumns(1, HEADERS_R.length);

  const msg = `PANEL_REPUESTOS: ${filasOut.length} entregas | ${totalItems} items | `
            + `archivos: ${archivosOk} OK / ${archivosSkip} skip / ${archivosErr} err | `
            + `pestañas: ${pestanasOk} OK / ${pestanasNoNumericas} no num / ${pestanasVacias} vacías`;
  Logger.log(msg);
  SpreadsheetApp.getActive().toast(msg, 'INGECOV', 15);
}

function leerCelda_(sh, fila, col) {
  try { return sh.getRange(fila, col).getValue(); }
  catch (e) { return ''; }
}

function parsearMesAnio_(nombre) {
  const upper = nombre.toUpperCase();
  let mes = '';
  for (const m of MESES_R) if (upper.includes(m)) { mes = m; break; }
  const matchAnio = upper.match(/\b(20\d{2})\b/);
  return { mes, anio: matchAnio ? matchAnio[1] : '' };
}

function formatearFecha_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'd/M/yyyy');
  }
  return v;
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('INGECOV')
    .addItem('Actualizar PANEL_REPUESTOS', 'actualizarPanelRepuestos')
    .addToUi();
}

function instalarTriggerHorario() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'actualizarPanelRepuestos') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('actualizarPanelRepuestos').timeBased().everyHours(1).create();
}

/**
 * Función de diagnóstico para detectar problemas de matching.
 * Ejecutar manualmente desde el editor cuando el panel queda vacío.
 */
function listarPestanas() {
  const folder = DriveApp.getFolderById(CFG_R.FOLDER_ID);
  const files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (files.hasNext()) {
    const file = files.next();
    try {
      const ss = SpreadsheetApp.openById(file.getId());
      const tabs = ss.getSheets().map(s => s.getName());
      Logger.log(`"${file.getName()}" → ${JSON.stringify(tabs)}`);
    } catch (e) {
      Logger.log(`Error abriendo "${file.getName()}": ${e.message}`);
    }
  }
}

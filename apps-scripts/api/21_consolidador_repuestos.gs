/**
 * Consolidador de PANEL_REPUESTOS — versión standalone.
 *
 * Versión migrada del script que vivía en el Sheet maestro de entregas
 * (id 1TUEoOul4SI5O323LcMq2VkaxdcTMfTmZce7NToGESfc).
 *
 * Cambios vs versión vieja:
 *   - Usa openById(SHEET_IDS.repuestos_hist) en lugar de
 *     SpreadsheetApp.getActiveSpreadsheet().
 *   - LockService para evitar choque con triggers/refresh manual.
 *   - Sin menú INGECOV.
 *
 * Layout asumido de cada pestaña <N° entrega>:
 *   B4 = N° entrega | B5 = N° pedido | B6 = fecha
 *   B8 = equipo | B9 = código | B10 = serie/patente
 *   B12 = costo | B13 = razón
 *   Fila 15 = headers de items, filas 16+ = items hasta "RESPONSABLE ENTREGA"
 */

const CFG_R = {
  PANEL_SHEET: 'PANEL_REPUESTOS',
  FOLDER_ID: '18j8Sk7NoDdLp1hJmmb6STJBmk_Kd_AXi',
  ROW: {
    NRO_ENTREGA: 4, NRO_PEDIDO: 5, FECHA: 6,
    EQUIPO: 8, CODIGO: 9, SERIE: 10,
    COSTO: 12, RAZON: 13,
  },
  COL_KV: 2,
  ROW_INICIO_ITEMS: 16,
  N_COLS_ITEMS: 5,
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
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    Logger.log('[repuestos] otra corrida en curso, salto');
    return;
  }
  try {
    _runActualizarPanelRepuestos();
  } finally {
    lock.releaseLock();
  }
}

function _runActualizarPanelRepuestos() {
  const ss = SpreadsheetApp.openById(SHEET_IDS.repuestos_hist);
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
    const parsed = _parsearMesAnioR(fileName);
    if (!parsed.mes) { archivosSkip++; Logger.log('[repuestos] skip "' + fileName + '" (sin mes)'); continue; }

    let mensual;
    try { mensual = SpreadsheetApp.openById(fileId); }
    catch (e) {
      archivosErr++;
      Logger.log('[repuestos] no se pudo abrir "' + fileName + '": ' + e.message);
      continue;
    }
    archivosOk++;

    mensual.getSheets().forEach(function(sh) {
      const nombre = sh.getName();
      if (!/^\d+$/.test(nombre)) { pestanasNoNumericas++; return; }

      const nroEntrega = _leerCeldaR(sh, CFG_R.ROW.NRO_ENTREGA, CFG_R.COL_KV) || nombre;
      const nroPedido  = _leerCeldaR(sh, CFG_R.ROW.NRO_PEDIDO,  CFG_R.COL_KV);
      const fecha      = _leerCeldaR(sh, CFG_R.ROW.FECHA,       CFG_R.COL_KV);
      const equipo     = _leerCeldaR(sh, CFG_R.ROW.EQUIPO,      CFG_R.COL_KV);
      const codigo     = _leerCeldaR(sh, CFG_R.ROW.CODIGO,      CFG_R.COL_KV);
      const serie      = _leerCeldaR(sh, CFG_R.ROW.SERIE,       CFG_R.COL_KV);
      const costo      = _leerCeldaR(sh, CFG_R.ROW.COSTO,       CFG_R.COL_KV);
      const razon      = _leerCeldaR(sh, CFG_R.ROW.RAZON,       CFG_R.COL_KV);

      const lastRow = sh.getLastRow();
      const colA = lastRow > 0 ? sh.getRange(1, 1, lastRow, 1).getValues() : [];
      let filaResp = -1;
      for (let i = CFG_R.ROW_INICIO_ITEMS - 1; i < colA.length; i++) {
        const txt = String(colA[i][0] || '').toUpperCase();
        if (txt.indexOf('RESPONSABLE') !== -1) { filaResp = i + 1; break; }
      }
      const finItems = filaResp > 0 ? filaResp - 1 : lastRow;

      const items = [];
      if (finItems >= CFG_R.ROW_INICIO_ITEMS) {
        const n = finItems - CFG_R.ROW_INICIO_ITEMS + 1;
        const rango = sh.getRange(CFG_R.ROW_INICIO_ITEMS, 1, n, CFG_R.N_COLS_ITEMS).getValues();
        rango.forEach(function(row) {
          const cantidad = row[0], descripcion = row[1], cod = row[2];
          const proveedor = row[3], observacion = row[4];
          if (!cantidad && !descripcion && !cod && !proveedor) return;
          items.push({ cantidad: cantidad, descripcion: descripcion, cod: cod,
                       proveedor: proveedor, observacion: observacion });
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

      const itemsDetalle = items.map(function(it) {
        const partes = [];
        if (it.cantidad)    partes.push(it.cantidad + 'x');
        if (it.descripcion) partes.push(it.descripcion);
        const extras = [];
        if (it.cod)         extras.push('cód ' + it.cod);
        if (it.proveedor)   extras.push('prov ' + it.proveedor);
        if (it.observacion) extras.push('obs: ' + it.observacion);
        if (extras.length)  partes.push('(' + extras.join(', ') + ')');
        return partes.join(' ');
      }).join(' | ');

      filasOut.push([
        parsed.mes, parsed.anio,
        nroEntrega, nroPedido, _formatearFechaR(fecha),
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

  Logger.log('[repuestos] ' + filasOut.length + ' entregas | ' + totalItems + ' items | ' +
             'archivos: ' + archivosOk + ' OK / ' + archivosSkip + ' skip / ' + archivosErr + ' err | ' +
             'pestañas: ' + pestanasOk + ' OK / ' + pestanasNoNumericas + ' no num / ' + pestanasVacias + ' vacías');
}

function _leerCeldaR(sh, fila, col) {
  try { return sh.getRange(fila, col).getValue(); }
  catch (e) { return ''; }
}

function _parsearMesAnioR(nombre) {
  const upper = nombre.toUpperCase();
  let mes = '';
  for (let i = 0; i < MESES_R.length; i++) {
    if (upper.indexOf(MESES_R[i]) !== -1) { mes = MESES_R[i]; break; }
  }
  const matchAnio = upper.match(/\b(20\d{2})\b/);
  return { mes: mes, anio: matchAnio ? matchAnio[1] : '' };
}

function _formatearFechaR(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'd/M/yyyy');
  }
  return v;
}

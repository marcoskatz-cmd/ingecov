/**
 * INGECO — Consolidador PANEL_REPUESTOS (sheet histórico)
 *
 * Vive en el Apps Script del Sheet histórico de repuestos.
 * ID del Sheet: 1WCtB-8C1VP4-axoQ_ugk_ersCfPJFjMC1fEDXRHOKFE
 *
 * Recorre TODAS las pestañas del sheet (excepto PANEL_REPUESTOS), levanta cada
 * fila con N° ENTREGA numérico válido y vuelca todo a PANEL_REPUESTOS con el
 * shape que el panel HTML lee.
 *
 * Layout de cada pestaña:
 *   Col A = N° ENTREGA (número)
 *   Col B = FECHA ENTREGA
 *   Col C = CÓDIGO (para pestañas de equipo: CMT-27, TPD-01, etc. — para
 *                   pestañas de categoría como Fluidos/EPP/Herramientas/Insumos:
 *                   sub-categoría tipo "Lubricantes", "Taller mecánico", etc.)
 *   Col D = REPUESTOS ENTREGADOS (descripción)
 *   Col E = COSTO ENTREGA
 *
 * El nombre de la pestaña se usa como EQUIPO en PANEL_REPUESTOS.
 *
 * Para ejecutar: menú INGECOV → "Actualizar PANEL_REPUESTOS"
 * O via trigger temporizado (instalarTriggerHorario).
 */

const CFG = {
  PANEL_SHEET_NAME: 'PANEL_REPUESTOS',
  N_COLS: 5
};

const PANEL_HEADERS = [
  'N° ENTREGA', 'FECHA', 'EQUIPO', 'CÓDIGO', 'REPUESTOS ENTREGADOS', 'COSTO'
];

function actualizarPanelRepuestos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let panel = ss.getSheetByName(CFG.PANEL_SHEET_NAME);
  if (!panel) panel = ss.insertSheet(CFG.PANEL_SHEET_NAME);
  panel.clear();
  panel.getRange(1, 1, 1, PANEL_HEADERS.length).setValues([PANEL_HEADERS]);
  panel.setFrozenRows(1);

  const filas = [];
  const sheets = ss.getSheets();
  let pestanasOk = 0, filasIgnoradas = 0;

  for (const sh of sheets) {
    const name = sh.getName();
    if (name === CFG.PANEL_SHEET_NAME) continue;

    const lastRow = sh.getLastRow();
    if (lastRow < 1) continue;

    const data = sh.getRange(1, 1, lastRow, CFG.N_COLS).getValues();
    let filasPestana = 0;

    for (const row of data) {
      const [nroRaw, fecha, cod, desc, costo] = row;
      // Solo acepta filas con N° ENTREGA numérico válido. Descarta:
      //  - filas de header (texto tipo "#VALUE! EQUIPO N° ENTREGA")
      //  - filas de continuación (cuando la descripción se extiende sin nro)
      //  - filas vacías
      const nroNum = parseInt(String(nroRaw || '').trim(), 10);
      if (!isFinite(nroNum) || nroNum <= 0) { filasIgnoradas++; continue; }

      filas.push([
        nroNum,
        formatearFecha(fecha),
        name,
        String(cod || '').trim(),
        String(desc || '').trim(),
        costo  // dejar el formato original (texto "$ 12.345,67" o número)
      ]);
      filasPestana++;
    }
    if (filasPestana > 0) pestanasOk++;
  }

  // Ordenar por N° ENTREGA descendente (más reciente primero)
  filas.sort((a, b) => b[0] - a[0]);

  if (filas.length > 0) {
    panel.getRange(2, 1, filas.length, PANEL_HEADERS.length).setValues(filas);
  }
  panel.autoResizeColumns(1, PANEL_HEADERS.length);

  const msg = `PANEL_REPUESTOS actualizado: ${filas.length} entregas | `
            + `${pestanasOk} pestañas con datos | `
            + `${filasIgnoradas} filas ignoradas (headers/continuaciones)`;
  Logger.log(msg);
  SpreadsheetApp.getActive().toast(msg, 'INGECOV', 10);
}

function formatearFecha(v) {
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

/**
 * Instala trigger que corre el consolidador cada 1 hora.
 * Correr una vez a mano desde el editor de Apps Script:
 *   instalarTriggerHorario()
 */
function instalarTriggerHorario() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'actualizarPanelRepuestos') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('actualizarPanelRepuestos').timeBased().everyHours(1).create();
}

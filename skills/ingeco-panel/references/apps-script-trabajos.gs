/**
 * INGECOV — Consolidador PANEL_TRABAJOS
 *
 * Vive en el Apps Script del Sheet maestro de trabajos.
 * ID actual del Sheet: 1cNWQ44UEDiotHyB65BfTMcFuOCfQXYQoSNNAdAKTsy8
 *
 * Lee archivos del Drive cuyo nombre empieza con "TRABAJOS REALIZADOS",
 * recorre cada pestaña que arranque con "PLANILLA " y vuelca todos los
 * trabajos consolidados en la pestaña PANEL_TRABAJOS del Sheet maestro.
 *
 * Para ejecutar: menú INGECOV → "Actualizar PANEL_TRABAJOS"
 *
 * Layout asumido de cada pestaña PLANILLA <CÓDIGO>:
 *   B4  = N° planilla
 *   B6  = nombre del equipo (descripción)
 *   B7  = código del equipo (key principal)
 *   B8  = N° serie / patente
 *   Fila 10 = headers de la tabla de trabajos:
 *     A: FECHA TRABAJO | B: LUGAR | C: PERSONAL | D: DESCRIPCIÓN
 *     E: TIEMPO PARADA | F: TIEMPO TRABAJO | G: RAZÓN
 *   Filas 11+ = trabajos (crece hacia abajo)
 */

const CFG = {
  PANEL_SHEET_NAME: 'PANEL_TRABAJOS',
  SEARCH_QUERY: "title contains 'TRABAJOS REALIZADOS' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false",
  PESTANA_PREFIX: 'PLANILLA ',
  ROW_NRO_PLANILLA: 4,
  ROW_EQUIPO: 6,
  ROW_CODIGO: 7,
  ROW_SERIE: 8,
  ROW_INICIO_DATOS: 11,
  COL_VALOR_KV: 2,        // columna B
  N_COLS_TABLA: 7         // A..G
};

const PANEL_HEADERS = [
  'MES', 'AÑO ARCHIVO', 'N° PLANILLA', 'EQUIPO', 'CÓDIGO', 'N° SERIE/PATENTE',
  'FECHA TRABAJO', 'LUGAR TRABAJO', 'PERSONAL TRABAJO',
  'DESCRIPCIÓN TRABAJOS', 'TIEMPO PARADA', 'TIEMPO TRABAJO', 'RAZÓN TRABAJO'
];

const MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
               'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];

function actualizarPanelTrabajos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let panel = ss.getSheetByName(CFG.PANEL_SHEET_NAME);
  if (!panel) panel = ss.insertSheet(CFG.PANEL_SHEET_NAME);
  panel.clear();
  panel.getRange(1, 1, 1, PANEL_HEADERS.length).setValues([PANEL_HEADERS]);
  panel.setFrozenRows(1);

  const filasOut = [];
  let archivosOk = 0, archivosErr = 0, pestanasOk = 0;

  const files = DriveApp.searchFiles(CFG.SEARCH_QUERY);
  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();
    const { mes, anio } = parsearNombreArchivo(fileName);

    let mensual;
    try { mensual = SpreadsheetApp.openById(file.getId()); }
    catch (e) {
      archivosErr++;
      Logger.log(`No se pudo abrir "${fileName}": ${e.message}`);
      continue;
    }
    archivosOk++;

    mensual.getSheets().forEach(sh => {
      const name = sh.getName();
      if (!name.toUpperCase().startsWith(CFG.PESTANA_PREFIX)) return;

      const nroPlanilla = leerCelda(sh, CFG.ROW_NRO_PLANILLA, CFG.COL_VALOR_KV);
      const equipo      = leerCelda(sh, CFG.ROW_EQUIPO,       CFG.COL_VALOR_KV);
      const codigo      = leerCelda(sh, CFG.ROW_CODIGO,       CFG.COL_VALOR_KV);
      const serie       = leerCelda(sh, CFG.ROW_SERIE,        CFG.COL_VALOR_KV);

      const lastRow = sh.getLastRow();
      if (lastRow < CFG.ROW_INICIO_DATOS) return;

      const nFilas = lastRow - CFG.ROW_INICIO_DATOS + 1;
      const datos = sh.getRange(CFG.ROW_INICIO_DATOS, 1, nFilas, CFG.N_COLS_TABLA).getValues();

      datos.forEach(row => {
        const [fecha, lugar, personal, desc, tParada, tTrabajo, razon] = row;
        if (!fecha && !lugar && !personal && !desc && !razon) return;
        filasOut.push([
          mes, anio, nroPlanilla, equipo, codigo, serie,
          formatearFecha(fecha), lugar, personal, desc, tParada, tTrabajo, razon
        ]);
      });
      pestanasOk++;
    });
  }

  if (filasOut.length > 0) {
    panel.getRange(2, 1, filasOut.length, PANEL_HEADERS.length).setValues(filasOut);
  }
  panel.autoResizeColumns(1, PANEL_HEADERS.length);

  const msg = `PANEL_TRABAJOS actualizado: ${filasOut.length} trabajos | `
            + `${archivosOk} archivos OK / ${archivosErr} con error | `
            + `${pestanasOk} pestañas PLANILLA leídas`;
  Logger.log(msg);
  SpreadsheetApp.getActive().toast(msg, 'INGECOV', 10);
}

function leerCelda(sh, fila, col) {
  try { return sh.getRange(fila, col).getValue(); }
  catch (e) { return ''; }
}

function parsearNombreArchivo(nombre) {
  const upper = nombre.toUpperCase();
  let mes = '';
  for (const m of MESES) if (upper.includes(m)) { mes = m; break; }
  const matchAnio = upper.match(/\b(20\d{2})\b/);
  return { mes, anio: matchAnio ? matchAnio[1] : '' };
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
    .addItem('Actualizar PANEL_TRABAJOS', 'actualizarPanelTrabajos')
    .addToUi();
}

function instalarTriggerHorario() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'actualizarPanelTrabajos') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('actualizarPanelTrabajos').timeBased().everyHours(1).create();
}

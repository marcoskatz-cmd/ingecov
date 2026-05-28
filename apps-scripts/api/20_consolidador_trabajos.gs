/**
 * Consolidador de PANEL_TRABAJOS — versión standalone.
 *
 * Esta es la versión migrada del script que vivía en el Sheet maestro de
 * trabajos (id 1cNWQ44UEDiotHyB65BfTMcFuOCfQXYQoSNNAdAKTsy8).
 *
 * Diferencias vs la versión vieja:
 *   - Usa SpreadsheetApp.openById(SHEET_IDS.trabajos_reg) en lugar de
 *     SpreadsheetApp.getActiveSpreadsheet() (este proyecto es standalone,
 *     no tiene Sheet "activo").
 *   - LockService.tryLock evita corridas concurrentes (trigger vs refresh
 *     manual disparado desde el panel).
 *   - Quita el menú INGECOV → onOpen (no hace falta en standalone).
 *
 * Triggers: se setea desde setupTriggers() en 99_setup.gs, cada 30 min.
 *
 * Layout asumido de cada pestaña PLANILLA <CÓDIGO>:
 *   B4=N° planilla, B6=equipo, B7=código, B8=N° serie/patente
 *   Fila 10=headers, filas 11+ = trabajos.
 */

const CFG_T = {
  PANEL_SHEET_NAME: 'PANEL_TRABAJOS',
  SEARCH_QUERY: "title contains 'TRABAJOS REALIZADOS' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false",
  PESTANA_PREFIX: 'PLANILLA ',
  ROW_NRO_PLANILLA: 4,
  ROW_EQUIPO: 6,
  ROW_CODIGO: 7,
  ROW_SERIE: 8,
  ROW_INICIO_DATOS: 11,
  COL_VALOR_KV: 2,
  N_COLS_TABLA: 7,
};

const PANEL_HEADERS_T = [
  'MES', 'AÑO ARCHIVO', 'N° PLANILLA', 'EQUIPO', 'CÓDIGO', 'N° SERIE/PATENTE',
  'FECHA TRABAJO', 'LUGAR TRABAJO', 'PERSONAL TRABAJO',
  'DESCRIPCIÓN TRABAJOS', 'TIEMPO PARADA', 'TIEMPO TRABAJO', 'RAZÓN TRABAJO'
];

const MESES_T = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                 'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];

function actualizarPanelTrabajos() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    Logger.log('[trabajos] otra corrida en curso, salto');
    return;
  }
  try {
    _runActualizarPanelTrabajos();
  } finally {
    lock.releaseLock();
  }
}

function _runActualizarPanelTrabajos() {
  const ss = SpreadsheetApp.openById(SHEET_IDS.trabajos_reg);
  let panel = ss.getSheetByName(CFG_T.PANEL_SHEET_NAME);
  if (!panel) panel = ss.insertSheet(CFG_T.PANEL_SHEET_NAME);
  panel.clear();
  panel.getRange(1, 1, 1, PANEL_HEADERS_T.length).setValues([PANEL_HEADERS_T]);
  panel.setFrozenRows(1);

  const filasOut = [];
  let archivosOk = 0, archivosErr = 0, pestanasOk = 0;

  const files = DriveApp.searchFiles(CFG_T.SEARCH_QUERY);
  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();
    const parsed = _parsearNombreArchivoT(fileName);

    let mensual;
    try { mensual = SpreadsheetApp.openById(file.getId()); }
    catch (e) {
      archivosErr++;
      Logger.log('[trabajos] no se pudo abrir "' + fileName + '": ' + e.message);
      continue;
    }
    archivosOk++;

    mensual.getSheets().forEach(function(sh) {
      const name = sh.getName();
      if (!name.toUpperCase().startsWith(CFG_T.PESTANA_PREFIX)) return;

      const nroPlanilla = _leerCeldaT(sh, CFG_T.ROW_NRO_PLANILLA, CFG_T.COL_VALOR_KV);
      const equipo      = _leerCeldaT(sh, CFG_T.ROW_EQUIPO,       CFG_T.COL_VALOR_KV);
      const codigo      = _leerCeldaT(sh, CFG_T.ROW_CODIGO,       CFG_T.COL_VALOR_KV);
      const serie       = _leerCeldaT(sh, CFG_T.ROW_SERIE,        CFG_T.COL_VALOR_KV);

      const lastRow = sh.getLastRow();
      if (lastRow < CFG_T.ROW_INICIO_DATOS) return;

      const nFilas = lastRow - CFG_T.ROW_INICIO_DATOS + 1;
      const datos = sh.getRange(CFG_T.ROW_INICIO_DATOS, 1, nFilas, CFG_T.N_COLS_TABLA).getValues();

      datos.forEach(function(row) {
        const fecha = row[0], lugar = row[1], personal = row[2], desc = row[3];
        const tParada = row[4], tTrabajo = row[5], razon = row[6];
        if (!fecha && !lugar && !personal && !desc && !razon) return;
        filasOut.push([
          parsed.mes, parsed.anio, nroPlanilla, equipo, codigo, serie,
          _formatearFechaT(fecha), lugar, personal, desc, tParada, tTrabajo, razon
        ]);
      });
      pestanasOk++;
    });
  }

  if (filasOut.length > 0) {
    panel.getRange(2, 1, filasOut.length, PANEL_HEADERS_T.length).setValues(filasOut);
  }
  panel.autoResizeColumns(1, PANEL_HEADERS_T.length);

  Logger.log('[trabajos] ' + filasOut.length + ' trabajos | ' +
             archivosOk + ' archivos OK / ' + archivosErr + ' err | ' +
             pestanasOk + ' pestañas PLANILLA leídas');
}

function _leerCeldaT(sh, fila, col) {
  try { return sh.getRange(fila, col).getValue(); }
  catch (e) { return ''; }
}

function _parsearNombreArchivoT(nombre) {
  const upper = nombre.toUpperCase();
  let mes = '';
  for (let i = 0; i < MESES_T.length; i++) {
    if (upper.indexOf(MESES_T[i]) !== -1) { mes = MESES_T[i]; break; }
  }
  const matchAnio = upper.match(/\b(20\d{2})\b/);
  return { mes: mes, anio: matchAnio ? matchAnio[1] : '' };
}

function _formatearFechaT(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'd/M/yyyy');
  }
  return v;
}

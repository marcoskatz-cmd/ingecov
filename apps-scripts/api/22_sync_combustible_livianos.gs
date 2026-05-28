/**
 * Sync de combustible livianos.
 *
 * El operario sigue trabajando sobre su .xlsx en Drive. Este job (trigger
 * cada 30 min) lee el .xlsx y lo vuelca a una pestaña espejo en un Sheet
 * nativo (MIRROR_SHEET_ID) que el endpoint combustible_livianos consume.
 *
 * Dos implementaciones, elegir según se descubra en fase 1 cuál sirve:
 *
 *   Opción A (preferida, default): Drive.Files.export → text/csv
 *     Funciona si la pestaña "Control General" ES la primera del libro.
 *     Más rápida, sin archivos temporales.
 *
 *   Opción B (fallback): Drive.Files.copy a Sheet nativo, leer pestaña
 *     específica, borrar copia. Más costosa pero soporta cualquier pestaña.
 *
 * Cambiar de A a B: setear Script Property MIRROR_STRATEGY = 'copy'.
 *
 * REQUIERE: habilitar "Drive API" en Services (Services → + → Drive API).
 */

function syncCombustibleLivianos() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60 * 1000)) {
    Logger.log('[combustible_livianos] otra corrida en curso, salto');
    return;
  }
  try {
    const strategy = getProperty('MIRROR_STRATEGY', 'export');
    if (strategy === 'copy') {
      _syncCombustibleLivianos_copy();
    } else {
      _syncCombustibleLivianos_export();
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Opción A: export del .xlsx a CSV directo. Primera pestaña solamente.
 *
 * Drive.Files.export(id, mimeType) en Apps Script Advanced Drive v3 falla
 * con "Export requires alt=media to download the exported content."
 * (bug conocido cuando el método se usa con dos args). Workaround:
 * UrlFetchApp directo al endpoint REST con el OAuth token del script.
 */
function _syncCombustibleLivianos_export() {
  const xlsxId = getProperty('XLSX_COMBUSTIBLE_LIVIANOS_ID');
  const mirrorId = getProperty('MIRROR_SHEET_ID');
  if (!xlsxId || !mirrorId) {
    throw new Error('Faltan Script Properties XLSX_COMBUSTIBLE_LIVIANOS_ID y/o MIRROR_SHEET_ID');
  }

  const url = 'https://www.googleapis.com/drive/v3/files/' + xlsxId + '/export?mimeType=text/csv';
  const response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('Drive export falló (' + response.getResponseCode() + '): ' +
                    response.getContentText().substring(0, 200));
  }
  const csv = response.getContentText();
  const rows = Utilities.parseCsv(csv);

  _writeToMirror(mirrorId, rows);
  Logger.log('[combustible_livianos export] ' + rows.length + ' filas volcadas al mirror');
}

/** Opción B: copia a Sheet nativo, lee pestaña 'Control General', borra. */
function _syncCombustibleLivianos_copy() {
  const xlsxId = getProperty('XLSX_COMBUSTIBLE_LIVIANOS_ID');
  const mirrorId = getProperty('MIRROR_SHEET_ID');
  const sourceTab = getProperty('XLSX_COMBUSTIBLE_LIVIANOS_TAB', 'Control General');
  if (!xlsxId || !mirrorId) {
    throw new Error('Faltan Script Properties XLSX_COMBUSTIBLE_LIVIANOS_ID y/o MIRROR_SHEET_ID');
  }

  let tempId = null;
  try {
    const copy = Drive.Files.copy(
      { mimeType: 'application/vnd.google-apps.spreadsheet' },
      xlsxId
    );
    tempId = copy.id;

    const src = SpreadsheetApp.openById(tempId).getSheetByName(sourceTab);
    if (!src) {
      throw new Error('Pestaña "' + sourceTab + '" no encontrada en el .xlsx convertido');
    }
    const rows = src.getDataRange().getValues();
    _writeToMirror(mirrorId, rows);
    Logger.log('[combustible_livianos copy] ' + rows.length + ' filas volcadas al mirror');
  } finally {
    if (tempId) {
      try { Drive.Files.remove(tempId); }
      catch (e) { Logger.log('[combustible_livianos] no se pudo borrar copia temp ' + tempId + ': ' + e.message); }
    }
  }
}

function _writeToMirror(mirrorId, rows) {
  const mirror = SpreadsheetApp.openById(mirrorId);
  let sh = mirror.getSheetByName(SHEETS.combustible_mirror);
  if (!sh) sh = mirror.insertSheet(SHEETS.combustible_mirror);
  sh.clear();
  if (rows && rows.length) {
    // Normalizar: todas las filas con la misma longitud (la más larga)
    let maxCols = 0;
    rows.forEach(function(r) { if (r.length > maxCols) maxCols = r.length; });
    const normalized = rows.map(function(r) {
      if (r.length === maxCols) return r;
      const padded = r.slice();
      while (padded.length < maxCols) padded.push('');
      return padded;
    });
    sh.getRange(1, 1, normalized.length, maxCols).setValues(normalized);
    sh.setFrozenRows(1);
  }
}

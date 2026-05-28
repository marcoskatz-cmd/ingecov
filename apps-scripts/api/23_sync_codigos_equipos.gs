/**
 * Sync de CÓDIGOS DE EQUIPOS.
 *
 * El archivo original es un .xlsx mantenido por otra persona (Marcos no lo
 * edita). SpreadsheetApp.openById no puede leer .xlsx directamente. La
 * solución: hacer una copia temporal como Sheet nativo, leer las 4 pestañas
 * esperadas (CODIGOS_TABS), volcar a las mismas pestañas en MIRROR_SHEET_ID
 * (junto a COMBUSTIBLE_LIVIANOS_MIRROR), y borrar la copia.
 *
 * Trigger cada 30 min (mismo período que los otros consolidadores).
 *
 * Costo por corrida: ~2-3 segundos (Drive.Files.copy + read 4 sheets + remove).
 *
 * REQUIERE: Drive API habilitada en Services (ya está activa para el sync
 * de combustible livianos).
 */

function syncCodigosEquipos() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60 * 1000)) {
    Logger.log('[codigos] otra corrida en curso, salto');
    return;
  }
  let tempId = null;
  try {
    const xlsxId   = getProperty('XLSX_CODIGOS_EQUIPOS_ID');
    const mirrorId = getProperty('MIRROR_SHEET_ID');
    if (!xlsxId || !mirrorId) {
      throw new Error('Faltan Script Properties XLSX_CODIGOS_EQUIPOS_ID y/o MIRROR_SHEET_ID');
    }

    // Copia temporal del .xlsx como Sheet nativo (preserva las 4 pestañas).
    const copy = Drive.Files.copy(
      { mimeType: 'application/vnd.google-apps.spreadsheet' },
      xlsxId
    );
    tempId = copy.id;

    const src = SpreadsheetApp.openById(tempId);
    const dst = SpreadsheetApp.openById(mirrorId);

    let totalFilas = 0;
    let pestanasOk = 0;
    let pestanasFaltantes = 0;

    CODIGOS_TABS.forEach(function(name) {
      const srcSheet = src.getSheetByName(name);
      if (!srcSheet) {
        Logger.log('[codigos] pestaña "' + name + '" no existe en el .xlsx — salto');
        pestanasFaltantes++;
        return;
      }
      const data = srcSheet.getDataRange().getValues();
      let dstSheet = dst.getSheetByName(name);
      if (!dstSheet) dstSheet = dst.insertSheet(name);
      dstSheet.clear();
      if (data.length) {
        // Normalizar a misma cantidad de columnas (algunas .xlsx vienen con
        // filas dispares — Sheets pide rectangular).
        let maxCols = 0;
        data.forEach(function(r) { if (r.length > maxCols) maxCols = r.length; });
        const normalized = data.map(function(r) {
          if (r.length === maxCols) return r;
          const padded = r.slice();
          while (padded.length < maxCols) padded.push('');
          return padded;
        });
        dstSheet.getRange(1, 1, normalized.length, maxCols).setValues(normalized);
        dstSheet.setFrozenRows(1);
        totalFilas += data.length;
        pestanasOk++;
      }
    });

    Logger.log('[codigos] ' + totalFilas + ' filas volcadas | ' +
               pestanasOk + ' pestañas OK / ' + pestanasFaltantes + ' faltantes');
  } finally {
    if (tempId) {
      try { Drive.Files.remove(tempId); }
      catch (e) { Logger.log('[codigos] no se pudo borrar copia temp ' + tempId + ': ' + e.message); }
    }
    lock.releaseLock();
  }
}

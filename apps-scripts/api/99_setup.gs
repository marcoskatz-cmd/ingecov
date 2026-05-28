/**
 * Setup one-time del proyecto. Correr UNA VEZ desde el editor (botón "Run")
 * después del primer deploy.
 *
 * Lo que hace:
 *   1. Borra todos los triggers existentes del proyecto.
 *   2. Crea triggers temporizados nuevos (30 min para consolidadores).
 *   3. Inicializa Script Properties faltantes con defaults (NO sobreescribe
 *      lo que ya esté seteado).
 *
 * Re-ejecutable: correrlo de nuevo si querés resetear triggers.
 *
 * Permisos que va a pedir Google la primera vez:
 *   - Read/write a Google Sheets
 *   - Read/write a Drive (para listar archivos mensuales y el .xlsx mirror)
 *   - Acceso a Apps Script triggers
 *   - Acceso a CacheService
 */

function setupTriggers() {
  // 1. Limpiar triggers viejos
  const existing = ScriptApp.getProjectTriggers();
  existing.forEach(function(t) { ScriptApp.deleteTrigger(t); });
  Logger.log('Borrados ' + existing.length + ' triggers existentes');

  // 2. Crear triggers nuevos
  ScriptApp.newTrigger('actualizarPanelTrabajos')
    .timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger('actualizarPanelRepuestos')
    .timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger('syncCombustibleLivianos')
    .timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger('syncCodigosEquipos')
    .timeBased().everyMinutes(30).create();

  Logger.log('Triggers creados:');
  ScriptApp.getProjectTriggers().forEach(function(t) {
    Logger.log('  - ' + t.getHandlerFunction() + ' (' + t.getEventType() + ')');
  });
}

/**
 * Inicializa Properties faltantes con defaults razonables. NO sobreescribe.
 * Después de correr esto, editar las Properties manualmente con los valores
 * reales desde File → Project Properties → Script Properties.
 */
function initializeProperties() {
  const props = PropertiesService.getScriptProperties();
  const current = props.getProperties();

  const defaults = {
    ALLOWED_EMAILS:                 'marcoskatz@grupoingeco.com.ar,nicobdallagata@gmail.com',
    XLSX_COMBUSTIBLE_LIVIANOS_ID:   '16KmV7k9gsqBgtd3YpesD2w9Hq2BEasac',
    XLSX_CODIGOS_EQUIPOS_ID:        '1I4ejRAoMnpou-cRvefgfVCzPg9Obkmi2',
    MIRROR_SHEET_ID:                '',  // <-- EDITAR manualmente con el ID del Sheet mirror que creés
    CACHE_TTL_SECONDS:              '1800',
    MIRROR_STRATEGY:                'export', // 'export' (default) o 'copy' si Drive.Files.export no extrae la pestaña correcta
    SHARED_SECRET:                  '',  // <-- EDITAR con el mismo valor que SHARED_SECRET de Cloudflare Pages
  };

  let created = 0, skipped = 0;
  Object.keys(defaults).forEach(function(k) {
    if (current[k] == null || current[k] === '') {
      props.setProperty(k, defaults[k]);
      created++;
      Logger.log('  + ' + k + ' = ' + defaults[k]);
    } else {
      skipped++;
      Logger.log('  · ' + k + ' = (ya estaba)');
    }
  });
  Logger.log('initializeProperties: ' + created + ' creadas, ' + skipped + ' preservadas');
  Logger.log('IMPORTANTE: editar MIRROR_SHEET_ID con el ID del Sheet espejo que creaste antes de correr syncCombustibleLivianos.');
}

/**
 * Correr esta función para verificar que todo está en orden ANTES de
 * deployar como Web App. Loguea el estado de Properties, triggers, y
 * acceso a los Sheets.
 */
function checkSetup() {
  Logger.log('=== INGECO Panel API: check setup ===');

  // Properties
  Logger.log('Script Properties:');
  const props = PropertiesService.getScriptProperties().getProperties();
  ['ALLOWED_EMAILS', 'XLSX_COMBUSTIBLE_LIVIANOS_ID', 'XLSX_CODIGOS_EQUIPOS_ID',
   'MIRROR_SHEET_ID', 'CACHE_TTL_SECONDS', 'MIRROR_STRATEGY', 'SHARED_SECRET'].forEach(function(k) {
    let v = props[k] == null ? '(faltante)' : props[k];
    // No loguear el secret entero — solo confirmar que existe y mostrar longitud
    if (k === 'SHARED_SECRET' && v !== '(faltante)') {
      v = '(seteado, ' + v.length + ' chars)';
    }
    Logger.log('  ' + k + ' = ' + v);
  });

  // Triggers
  Logger.log('Triggers:');
  ScriptApp.getProjectTriggers().forEach(function(t) {
    Logger.log('  - ' + t.getHandlerFunction());
  });

  // Sheets reachable
  Logger.log('Sheets:');
  Object.keys(SHEET_IDS).forEach(function(k) {
    try {
      const ss = SpreadsheetApp.openById(SHEET_IDS[k]);
      Logger.log('  OK ' + k + ': "' + ss.getName() + '"');
    } catch (e) {
      Logger.log('  ERROR ' + k + ' (' + SHEET_IDS[k] + '): ' + e.message);
    }
  });

  // Mirror
  const mirrorId = getProperty('MIRROR_SHEET_ID');
  if (mirrorId) {
    try {
      const ss = SpreadsheetApp.openById(mirrorId);
      Logger.log('  OK mirror: "' + ss.getName() + '"');
      const sh = ss.getSheetByName(SHEETS.combustible_mirror);
      Logger.log('  Pestaña ' + SHEETS.combustible_mirror + ': ' + (sh ? 'existe' : 'FALTA — se crea automáticamente en el primer sync'));
      CODIGOS_TABS.forEach(function(name) {
        const t = ss.getSheetByName(name);
        Logger.log('  Pestaña "' + name + '": ' + (t ? 'existe' : 'FALTA — se crea automáticamente en el primer sync'));
      });
    } catch (e) {
      Logger.log('  ERROR mirror: ' + e.message);
    }
  } else {
    Logger.log('  Mirror NO configurado (MIRROR_SHEET_ID vacío)');
  }

  // Auth (corriendo como el deployer)
  Logger.log('Auth:');
  Logger.log('  Cuenta activa: ' + Session.getActiveUser().getEmail());
  Logger.log('  Whitelist: ' + Array.from(getAllowedEmails()).join(', '));
}

/**
 * INGECO Panel API — ALL-IN-ONE
 * ----------------------------------------------------------------------------
 * Concatenación de los 10 .gs del proyecto. Pegar TODO en el Code.gs por
 * defecto al crear el proyecto Apps Script.
 *
 * Generado automáticamente desde apps-scripts/api/<n>.gs — no editar acá.
 * ============================================================================
 */

// ============================================================================
// ARCHIVO: 00_config.gs
// ============================================================================

/**
 * INGECO Panel API — Configuración
 * ----------------------------------------------------------------------------
 * Proyecto Apps Script standalone que sirve los datos del panel a través de
 * un Web App con whitelist por email. Reemplaza la lectura directa de gviz
 * desde el navegador.
 *
 * Los IDs de Sheets están hardcoded acá (no son secreto: si alguien tiene
 * acceso a este código, ya tiene acceso al proyecto). Las cosas que CAMBIAN
 * (whitelist de emails, IDs del mirror de combustible livianos) viven en
 * Script Properties para poder editarse sin redeploy.
 */

// Sheets nativos que el Apps Script lee con openById.
// CÓDIGOS DE EQUIPOS y COMBUSTIBLE LIVIANOS son .xlsx externos; su ID original
// vive en Script Properties (XLSX_*) y un trigger los espeja a pestañas
// nativas dentro del Sheet identificado por MIRROR_SHEET_ID.
const SHEET_IDS = {
  pedidos:             '1VFJwFLLEaOE9tTuwah7QkaDTrYkeYtOH8brUgSyHeFY',
  indicadores:         '1GpP2ejMVXncr2OLmKK_IP-zqr5AARi1Q3YdQIPlsUUE',
  // codigos eliminado de acá: se lee del mirror (pestañas en MIRROR_SHEET_ID
  // mantenidas por syncCodigosEquipos, que copia el .xlsx XLSX_CODIGOS_EQUIPOS_ID).
  repuestos_hist:      '1TUEoOul4SI5O323LcMq2VkaxdcTMfTmZce7NToGESfc',
  trabajos_reg:        '1cNWQ44UEDiotHyB65BfTMcFuOCfQXYQoSNNAdAKTsy8',
  service:             '1zB9q0e9kxRKe52-I0u5Dqg7PUSE_nlxi3IYn7pxF0Iw',
  combustible:         '19dqJ-tcdmXiOns99mJgMMmZNDT3kKS7EQXwHd7VDILc',
  programaService:     '1y6pqbXscej3139lkImWJsJHeJvFa0B5sneICEyyNPmI',
};

// Pestañas esperadas en el .xlsx de CÓDIGOS DE EQUIPOS (= nombres de categoría
// que usa el panel). El sync espera estos nombres EXACTOS; si la persona que
// mantiene el .xlsx renombra una pestaña, hay que actualizar acá.
const CODIGOS_TABS = [
  'VIALES, ASFALTO Y TRITURACIÓN',
  'TRANSPORTE LIVIANO',
  'TRANSPORTE PESADO',
  'SOPORTE',
];

// Nombres de pestañas (matchean lo que el panel HTML esperaba).
const SHEETS = {
  pedidos_pend:        'PENDIENTES',
  pedidos_entreg:      'ENTREGADOS',
  panel_repuestos:     'PANEL_REPUESTOS',
  panel_trabajos:      'PANEL_TRABAJOS',
  combustible:         'ENTREGA DE COMBUSTIBLE',
  combustible_mirror:  'COMBUSTIBLE_LIVIANOS_MIRROR',
  service_frec:        'FRECUENCIA - OPERATIVIDAD',
};

// Trimestre vigente del programa de service. Mantiene la lógica del HTML.
function getServiceTrimSheet() {
  return (new Date().getMonth() < 3) ? '1° TRIMESTRE' : '2° TRIMESTRE';
}

// Cache: 30 min por defecto, configurable desde Properties.
function getCacheTTL() {
  const v = PropertiesService.getScriptProperties().getProperty('CACHE_TTL_SECONDS');
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 1800;
}

// Wrapper sobre Script Properties con default + parseo.
function getProperty(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  return (v == null || v === '') ? fallback : v;
}


// ============================================================================
// ARCHIVO: 01_auth.gs
// ============================================================================

/**
 * Auth: whitelist por email Google.
 *
 * Para agregar usuarios: editor del proyecto → File → Project Properties →
 * Script Properties → editar ALLOWED_EMAILS (lista separada por coma).
 * Cambio toma efecto inmediato, sin redeploy.
 */

function getAllowedEmails() {
  const raw = getProperty('ALLOWED_EMAILS', '');
  return new Set(
    raw.split(',')
       .map(s => s.trim().toLowerCase())
       .filter(Boolean)
  );
}

/**
 * Devuelve { email, allowed } sin lanzar excepción. Útil para el endpoint
 * whoami: el cliente puede mostrar "logueado como X, no autorizado"
 * en lugar de un 403 crudo.
 */
function getAuthInfo() {
  let email = '';
  try { email = (Session.getActiveUser().getEmail() || '').toLowerCase(); }
  catch (e) { email = ''; }
  const allowed = getAllowedEmails().has(email);
  return { email, allowed };
}

/**
 * Tira si el usuario no está autorizado. Llamada al principio de cada
 * endpoint que devuelve datos.
 */
function assertAllowed() {
  const { email, allowed } = getAuthInfo();
  if (!email) {
    throw new ApiError('no_session', 'No se pudo determinar el email del usuario. Logueate con tu cuenta Google.', 401);
  }
  if (!allowed) {
    throw new ApiError('not_authorized', `El email ${email} no está autorizado. Pedile a Marcos que te agregue.`, 403);
  }
  return email;
}

/** Error tipado que el router convierte a la respuesta JSON correcta. */
function ApiError(code, message, httpStatus) {
  this.name = 'ApiError';
  this.code = code;
  this.message = message;
  this.httpStatus = httpStatus || 400;
}
ApiError.prototype = Object.create(Error.prototype);


// ============================================================================
// ARCHIVO: 02_router.gs
// ============================================================================

/**
 * Router: punto de entrada del Web App.
 *
 * Enruta por el parámetro ?ep= y devuelve JSON. Cada endpoint corre dentro de
 * un try/catch que convierte ApiError a respuesta JSON con el código apropiado.
 *
 * Notas sobre Web App responses:
 *   - Apps Script no expone setStatusCode directamente para ContentService.
 *     Devolvemos siempre 200 desde el lado del Web App y el cliente lee el
 *     campo `ok` del JSON. El código de "status" semántico viene en `error`.
 *   - El cliente igualmente recibe 200 del proxy de Google; el browser ve
 *     siempre 200. Por eso el front chequea `ok: false` en lugar del status.
 */

function doGet(e) {
  const params = (e && e.parameter) || {};
  const ep = params.ep || '';

  // whoami no requiere autorización: devuelve auth state para que el front
  // pueda renderizar la pantalla "no autorizado" sin loop de redirects.
  if (ep === 'whoami') {
    return jsonOk(getAuthInfo(), ep);
  }

  try {
    assertAllowed();

    switch (ep) {
      case 'pedidos':              return jsonOk(getPedidos(params), ep);
      case 'codigos':              return jsonOk(getCodigos(params), ep);
      case 'panel_repuestos':      return jsonOk(getPanelRepuestos(params), ep);
      case 'panel_trabajos':       return jsonOk(getPanelTrabajos(params), ep);
      case 'indicadores':          return jsonOk(getIndicadores(params), ep);
      case 'service':              return jsonOk(getService(params), ep);
      case 'combustible':          return jsonOk(getCombustible(params), ep);
      case 'combustible_livianos': return jsonOk(getCombustibleLivianos(params), ep);
      case 'refresh':              return jsonOk(refreshHandler(params), ep);
      default:
        throw new ApiError('unknown_endpoint', `Endpoint desconocido: ${ep}`, 400);
    }
  } catch (err) {
    return jsonErr(err, ep);
  }
}

function jsonOk(payload, endpoint) {
  const body = {
    ok: true,
    endpoint: endpoint,
    at: new Date().toISOString(),
    cached: payload && payload.__cached === true,
    data: payload && payload.__cached !== undefined ? payload.data : payload,
  };
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonErr(err, endpoint) {
  const code = (err && err.code) || 'internal_error';
  const message = (err && err.message) || String(err);
  Logger.log(`[API] error en ${endpoint || '(no ep)'}: ${code} — ${message}`);
  const body = {
    ok: false,
    endpoint: endpoint,
    at: new Date().toISOString(),
    error: code,
    message: message,
  };
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================================================
// ARCHIVO: 03_cache.gs
// ============================================================================

/**
 * Cache server-side sobre CacheService.
 *
 * Cada endpoint genera una key estable. Si el cliente manda ?force=1, el
 * bypass es total (lee Sheets, reescribe cache).
 *
 * Limitación de CacheService: 100 KB por entry. Si algún payload se acerca,
 * partir en chunks (no implementado todavía: ningún endpoint actual lo
 * necesita).
 */

const CACHE_KEY_PREFIX = 'ep:v1:';

/**
 * @param {string} key  identificador del endpoint (ej. 'panel_repuestos')
 * @param {object} params  params del request; mira `force` para bypass
 * @param {function} fn  closure que produce los datos cuando hay miss
 * @returns {object} { data, __cached: bool }
 */
function cachedFetch(key, params, fn) {
  const force = String(params && params.force) === '1';
  const cache = CacheService.getScriptCache();
  const cacheKey = CACHE_KEY_PREFIX + key;

  if (!force) {
    const hit = cache.get(cacheKey);
    if (hit) {
      try {
        return { data: JSON.parse(hit), __cached: true };
      } catch (_) {
        // Cache corrupta — la borramos y recomputamos.
        cache.remove(cacheKey);
      }
    }
  }

  const fresh = fn();
  try {
    cache.put(cacheKey, JSON.stringify(fresh), getCacheTTL());
  } catch (e) {
    // Probablemente excedió 100 KB. Loguear y devolver sin cachear.
    Logger.log(`[cache] no se pudo cachear ${key}: ${e.message}`);
  }
  return { data: fresh, __cached: false };
}

/** Invalida una key específica. Lo usa el endpoint refresh. */
function invalidateCacheKey(key) {
  CacheService.getScriptCache().remove(CACHE_KEY_PREFIX + key);
}

/** Invalida varias keys. */
function invalidateCacheKeys(keys) {
  CacheService.getScriptCache().removeAll((keys || []).map(k => CACHE_KEY_PREFIX + k));
}


// ============================================================================
// ARCHIVO: 10_endpoints.gs
// ============================================================================

/**
 * Endpoints: cada función lee uno o más Sheets y devuelve el payload que
 * el panel HTML espera (array de objetos, mismas keys que `fetchGvizObj`
 * devolvía).
 *
 * Estos endpoints son los reemplazos directos de las llamadas `fetchGviz*`
 * del front. La forma del payload tiene que MATCHEAR lo que el front
 * espera porque el panel hace lookups por header (vía `_pickCol`).
 *
 * Helpers internos:
 *   - sheetToObjects(sh): convierte una pestaña a array de objetos usando
 *     la primera fila como headers (igual que fetchGvizObj del front).
 *   - sheetToMatrix(sh):  devuelve la matriz cruda (igual que fetchGvizRaw).
 */

// ───────────────────────────────────────────────────────────────────────────
// Helpers de lectura
// ───────────────────────────────────────────────────────────────────────────

function openSheet_(id, name) {
  const ss = SpreadsheetApp.openById(id);
  const sh = ss.getSheetByName(name);
  if (!sh) throw new ApiError('sheet_not_found', `Pestaña "${name}" no existe en ${id}`, 500);
  return sh;
}

function sheetToObjects_(sh) {
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(h => String(h || ''));
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    // Skip filas completamente vacías
    if (row.every(v => v === '' || v == null)) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = normalizeValue_(row[j]);
    }
    out.push(obj);
  }
  return out;
}

function sheetToMatrix_(sh) {
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return [];
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  return values.map(row => row.map(normalizeValue_));
}

/**
 * Date → ISO string (el panel lo parsea con _parseDate).
 * Number → number (no se toca).
 * String → trimmed (preserva ceros a la izquierda en códigos).
 */
function normalizeValue_(v) {
  if (v instanceof Date) return v.toISOString();
  if (v == null) return '';
  return v;
}

// ───────────────────────────────────────────────────────────────────────────
// Endpoints
// ───────────────────────────────────────────────────────────────────────────

function getPedidos(params) {
  return cachedFetch('pedidos', params, function() {
    const pendientes = sheetToObjects_(openSheet_(SHEET_IDS.pedidos, SHEETS.pedidos_pend));
    const entregados = sheetToObjects_(openSheet_(SHEET_IDS.pedidos, SHEETS.pedidos_entreg));
    return { pendientes: pendientes, entregados: entregados };
  });
}

/**
 * Códigos de equipos: pestañas espejadas desde el .xlsx por syncCodigosEquipos
 * en el Sheet MIRROR_SHEET_ID. Filtramos solo las 4 esperadas (CODIGOS_TABS)
 * para no mezclar con otras pestañas que viven en el mismo mirror Sheet
 * (ej. COMBUSTIBLE_LIVIANOS_MIRROR).
 */
function getCodigos(params) {
  return cachedFetch('codigos', params, function() {
    const mirrorId = getProperty('MIRROR_SHEET_ID');
    if (!mirrorId) {
      throw new ApiError('mirror_not_configured',
        'Falta Script Property MIRROR_SHEET_ID — ver DEPLOY.md', 500);
    }
    const ss = SpreadsheetApp.openById(mirrorId);
    const esperadas = {};
    for (let i = 0; i < CODIGOS_TABS.length; i++) esperadas[CODIGOS_TABS[i]] = true;
    const out = [];
    ss.getSheets().forEach(function(sh) {
      const name = sh.getName();
      if (!esperadas[name]) return;
      const rows = sheetToObjects_(sh);
      rows.forEach(function(r) {
        r.__pestana = name;
        out.push(r);
      });
    });
    return out;
  });
}

function getPanelRepuestos(params) {
  return cachedFetch('panel_repuestos', params, function() {
    return sheetToObjects_(openSheet_(SHEET_IDS.repuestos_hist, SHEETS.panel_repuestos));
  });
}

function getPanelTrabajos(params) {
  return cachedFetch('panel_trabajos', params, function() {
    return sheetToObjects_(openSheet_(SHEET_IDS.trabajos_reg, SHEETS.panel_trabajos));
  });
}

function getIndicadores(params) {
  return cachedFetch('indicadores', params, function() {
    // El sheet de indicadores tiene varias pestañas (horómetros mensuales).
    // Devolvemos un map { pestañaName: [filas...] } para que el front elija.
    const ss = SpreadsheetApp.openById(SHEET_IDS.indicadores);
    const out = {};
    ss.getSheets().forEach(function(sh) {
      out[sh.getName()] = sheetToObjects_(sh);
    });
    return out;
  });
}

function getService(params) {
  return cachedFetch('service', params, function() {
    const trimSheet = getServiceTrimSheet();
    return {
      frecuencia: sheetToObjects_(openSheet_(SHEET_IDS.programaService, SHEETS.service_frec)),
      trimestre: sheetToObjects_(openSheet_(SHEET_IDS.programaService, trimSheet)),
      trimestre_nombre: trimSheet,
    };
  });
}

function getCombustible(params) {
  return cachedFetch('combustible', params, function() {
    return sheetToObjects_(openSheet_(SHEET_IDS.combustible, SHEETS.combustible));
  });
}

function getCombustibleLivianos(params) {
  return cachedFetch('combustible_livianos', params, function() {
    const mirrorId = getProperty('MIRROR_SHEET_ID');
    if (!mirrorId) {
      throw new ApiError('mirror_not_configured',
        'Falta Script Property MIRROR_SHEET_ID — ver DEPLOY.md', 500);
    }
    return sheetToObjects_(openSheet_(mirrorId, SHEETS.combustible_mirror));
  });
}

/**
 * Refresh: corre el/los consolidador(es) e invalida las caches relacionadas.
 * params.panel ∈ {'all', 'trabajos', 'repuestos', 'combustible_livianos', 'codigos'}
 */
function refreshHandler(params) {
  const panel = (params && params.panel) || 'all';
  const ran = [];
  if (panel === 'all' || panel === 'trabajos') {
    actualizarPanelTrabajos();
    invalidateCacheKey('panel_trabajos');
    ran.push('panel_trabajos');
  }
  if (panel === 'all' || panel === 'repuestos') {
    actualizarPanelRepuestos();
    invalidateCacheKey('panel_repuestos');
    ran.push('panel_repuestos');
  }
  if (panel === 'all' || panel === 'combustible_livianos') {
    syncCombustibleLivianos();
    invalidateCacheKey('combustible_livianos');
    ran.push('combustible_livianos');
  }
  if (panel === 'all' || panel === 'codigos') {
    syncCodigosEquipos();
    invalidateCacheKey('codigos');
    ran.push('codigos');
  }
  // Cuando refrescamos todo también invalidamos endpoints sin sync propio.
  if (panel === 'all') {
    invalidateCacheKeys(['pedidos', 'combustible', 'service', 'indicadores']);
  }
  return { refreshed: ran, panel: panel };
}


// ============================================================================
// ARCHIVO: 20_consolidador_trabajos.gs
// ============================================================================

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


// ============================================================================
// ARCHIVO: 21_consolidador_repuestos.gs
// ============================================================================

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


// ============================================================================
// ARCHIVO: 22_sync_combustible_livianos.gs
// ============================================================================

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

/** Opción A: export del .xlsx a CSV directo. Primera pestaña solamente. */
function _syncCombustibleLivianos_export() {
  const xlsxId = getProperty('XLSX_COMBUSTIBLE_LIVIANOS_ID');
  const mirrorId = getProperty('MIRROR_SHEET_ID');
  if (!xlsxId || !mirrorId) {
    throw new Error('Faltan Script Properties XLSX_COMBUSTIBLE_LIVIANOS_ID y/o MIRROR_SHEET_ID');
  }

  const csvBlob = Drive.Files.export(xlsxId, 'text/csv');
  const csv = csvBlob.getDataAsString('UTF-8');
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


// ============================================================================
// ARCHIVO: 23_sync_codigos_equipos.gs
// ============================================================================

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


// ============================================================================
// ARCHIVO: 99_setup.gs
// ============================================================================

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
   'MIRROR_SHEET_ID', 'CACHE_TTL_SECONDS', 'MIRROR_STRATEGY'].forEach(function(k) {
    const v = props[k] == null ? '(faltante)' : props[k];
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


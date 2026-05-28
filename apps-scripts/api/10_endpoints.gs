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

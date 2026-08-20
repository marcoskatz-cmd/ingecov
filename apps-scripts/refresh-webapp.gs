/**
 * INGECO Panel — Web App de REFRESH on-demand
 * ============================================================================
 * Propósito: que el botón "sync" del panel dispare de verdad la actualización
 * de datos. El panel (GitHub Pages, estático) lee un snapshot congelado vía
 * gviz; ese snapshot solo cambia cuando corre construirSnapshot() server-side.
 * Esta Web App expone ese trabajo por HTTP GET para que el navegador lo dispare.
 *
 * FLUJO al hacer GET ?ep=refresh&key=<token>:
 *   1. valida el token contra Script Property REFRESH_KEY (disuasor, no cripto)
 *   2. corre construirSnapshot() → congela las tablas planas vivas (SNAP_SRC) en
 *      el snapshot que lee el panel. Es lo ÚNICO necesario (~1 min).
 *   3. devuelve JSON { ok, ran:[...], errors:[...], full, at }
 *
 * ?full=1 → además corre los consolidadores (trabajos/repuestos/combustible/
 * códigos) ANTES del snapshot. Quedan opt-in porque escriben paneles que el
 * snapshot actual ya no lee; correrlos sumaba ~2-3 min sin cambiar el resultado.
 *
 * El navegador, al recibir ok:true, recarga (loadAll) y lee el snapshot fresco.
 *
 * ----------------------------------------------------------------------------
 * DÓNDE PEGARLO
 *   En el proyecto Apps Script "INGECO Panel API" (el que ya tiene
 *   actualizarPanelTrabajos/…/construirSnapshot como triggers). Pegá este archivo
 *   como un .gs nuevo. Las funciones consolidadoras y construirSnapshot tienen
 *   que estar en ESE MISMO proyecto (lo están).
 *
 * IMPORTANTE — colisión de doGet:
 *   Un proyecto Apps Script solo puede tener UN doGet. Si todavía están los
 *   archivos de la API vieja abandonada (02_router.gs o
 *   INGECO_Panel_API_all_in_one.gs, ambos definen doGet), BORRALOS del proyecto
 *   antes de pegar este, o vas a tener un doGet duplicado y no compila.
 *
 * DEPLOY
 *   1. Script Properties → agregá  REFRESH_KEY = <un token largo random>
 *      (Proyecto → Configuración del proyecto → Propiedades del script).
 *   2. Implementar → Nueva implementación → tipo "Aplicación web".
 *        - Ejecutar como: Yo (marcoskatz@grupoingeco.com.ar)
 *        - Quién tiene acceso: Cualquier persona
 *   3. Copiá la URL /exec y pasámela junto con el REFRESH_KEY: yo los hardcodeo
 *      en js/app.js y habilito el dominio en la CSP.
 *
 * Nota de seguridad: el endpoint queda público (necesario para que el browser lo
 * llame sin login). El token en la query es un disuasor contra disparos casuales,
 * igual que el PIN del panel — no es seguridad criptográfica. El peor caso de
 * abuso es que alguien con la URL+token gatille reconstrucciones (gasto de cuota),
 * acotado y sin exposición de datos nuevos (los datos ya son públicos vía gviz).
 */

function doGet(e) {
  var params = (e && e.parameter) || {};

  // ── AUDITORÍA (?ep=audit&pin=…) ──────────────────────────────────────
  // Gate propio: AUDIT_PIN se valida SERVER-SIDE contra Script Property.
  // El PIN no existe en ningún código público (a diferencia de REFRESH_KEY,
  // que está hardcodeado en app.js y solo disuade crawlers). El payload sale
  // de AUDIT_JSON (privado, lo escribe _auditar_ en cada build del snapshot).
  if (params.ep === 'audit') {
    var pinOk = PropertiesService.getScriptProperties().getProperty('AUDIT_PIN');
    if (!pinOk) return _refreshJson({ ok: false, error: 'audit_pin_not_set' });
    if (String(params.pin || '') !== pinOk) {
      Utilities.sleep(800); // freno suave a fuerza bruta
      return _refreshJson({ ok: false, error: 'pin' });
    }
    var raw = PropertiesService.getScriptProperties().getProperty('AUDIT_JSON');
    if (!raw) return _refreshJson({ ok: true, audit: null, message: 'todavía no corrió la auditoría' });
    try { return _refreshJson({ ok: true, audit: JSON.parse(raw) }); }
    catch (err) { return _refreshJson({ ok: false, error: 'audit_json_corrupto' }); }
  }
  // Setea el PIN UNA sola vez (solo si no existe; después se cambia desde
  // el editor de Apps Script → Configuración → Propiedades del script).
  if (params.ep === 'audit_setpin') {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('AUDIT_PIN')) return _refreshJson({ ok: false, error: 'ya_seteado' });
    if (!params.nuevo || String(params.nuevo).length < 4) return _refreshJson({ ok: false, error: 'pin_corto' });
    props.setProperty('AUDIT_PIN', String(params.nuevo));
    return _refreshJson({ ok: true, message: 'AUDIT_PIN seteado' });
  }

  // ── CONFIG DEL PANEL (?ep=config → lectura pública, ?ep=config_set&pin=…
  // → escritura con PIN de auditoría) ──────────────────────────────────
  // Parámetros de negocio editables sin pedir un deploy — hoy solo el precio
  // de combustible pesados (Casares no trae costo por carga; se estima
  // litros × precio). Viven en Script Properties (prefijo CONFIG_), NO en el
  // snapshot: así un cambio impacta en el próximo reload, sin esperar el
  // rebuild de 30 min (mismo criterio que COSTOS DOWNTIME).
  // Antes del gate de REFRESH_KEY a propósito: la lectura es pública (el
  // precio no es sensible y lo necesita CUALQUIER cliente para calcular el
  // KPI de gasto de combustible, no solo quien entra a auditoría) y la
  // escritura tiene su PROPIO gate (AUDIT_PIN) — no necesita el token de
  // refresh además.
  var CONFIG_KEYS = ['precioCombustiblePesados'];
  if (params.ep === 'config') {
    var cfgProps = PropertiesService.getScriptProperties();
    var config = {};
    CONFIG_KEYS.forEach(function (k) {
      var v = cfgProps.getProperty('CONFIG_' + k);
      config[k] = v != null ? Number(v) : null;
    });
    return _refreshJson({ ok: true, config: config });
  }
  if (params.ep === 'config_set') {
    var pinOkCfg = PropertiesService.getScriptProperties().getProperty('AUDIT_PIN');
    if (!pinOkCfg) return _refreshJson({ ok: false, error: 'audit_pin_not_set' });
    if (String(params.pin || '') !== pinOkCfg) {
      Utilities.sleep(800);
      return _refreshJson({ ok: false, error: 'pin' });
    }
    var cfgKey = String(params.key || '');
    if (CONFIG_KEYS.indexOf(cfgKey) < 0) return _refreshJson({ ok: false, error: 'clave_invalida' });
    var val = parseFloat(params.value);
    if (!isFinite(val) || val < 0) return _refreshJson({ ok: false, error: 'valor_invalido' });
    PropertiesService.getScriptProperties().setProperty('CONFIG_' + cfgKey, String(val));
    return _refreshJson({ ok: true, key: cfgKey, value: val });
  }

  // El token también protege contra que un crawler que encuentre la URL dispare
  // una reconstrucción al azar.
  var expected = PropertiesService.getScriptProperties().getProperty('REFRESH_KEY');
  if (!expected) {
    return _refreshJson({ ok: false, error: 'refresh_key_not_set',
      message: 'Falta Script Property REFRESH_KEY en el proyecto Apps Script' });
  }
  if (params.key !== expected) {
    return _refreshJson({ ok: false, error: 'invalid_key',
      message: 'Token inválido' });
  }

  // (?ep=mailsetup y ?ep=mailpreview eran temporales para activar y verificar
  // el resumen semanal el 2026-08-04; ya cumplieron y se eliminaron. El
  // destinatario vive en la Script Property FALT_MAIL_TO y el trigger está
  // instalado. Para cambiar destinatarios: editar la property en el editor.)

  // ── DEBUG (?ep=debug_sheet&key=…&id=<sheetId>) ───────────────────────
  // Diagnóstico puntual: devuelve nombres de pestañas + header + primeras
  // filas de un sheet, para inspeccionar estructura sin acceso directo desde
  // el harness (el sheet puede no ser público). Temporal, mismo token que
  // refresh.
  if (params.ep === 'debug_sheet' && params.id) {
    try {
      var ss = SpreadsheetApp.openById(params.id);
      var sheets = ss.getSheets().map(function (sh) {
        var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
        var header = lastRow >= 1 && lastCol >= 1 ? sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0] : [];
        var sample = lastRow >= 2 && lastCol >= 1
          ? sh.getRange(2, 1, Math.min(5, lastRow - 1), lastCol).getDisplayValues() : [];
        return { name: sh.getName(), lastRow: lastRow, lastCol: lastCol, header: header, sample: sample };
      });
      return _refreshJson({ ok: true, sheets: sheets });
    } catch (err) {
      return _refreshJson({ ok: false, error: (err && err.message) || String(err) });
    }
  }

  var ran = [];
  var errors = [];

  // ?full=1 → además corre los consolidadores (Drive → paneles viejos). Por
  // defecto NO se corren: construirSnapshot lee las tablas planas vivas (SNAP_SRC:
  // 1JpXjGTJ pedidos/entregas, 1muXaJ trabajos, etc.) DIRECTO, y esos
  // consolidadores escriben en paneles (PANEL_TRABAJOS/PANEL_REPUESTOS/mirrors)
  // que el snapshot actual ya no lee → eran ~2-3 min de peso muerto en el refresh.
  var full = (params.full === '1' || params.full === 'true');
  if (full) {
    _runStep('actualizarPanelTrabajos',    ran, errors);
    _runStep('actualizarPanelRepuestos',   ran, errors);
    _runStep('syncCombustibleLivianos',    ran, errors);
    _runStep('syncCodigosEquipos',         ran, errors);
  }

  // Snapshot: congela las fuentes vivas. Es lo único que el panel realmente lee.
  _runStep('construirSnapshot',          ran, errors);

  return _refreshJson({
    ok: errors.length === 0,
    ran: ran,
    errors: errors,
    full: full,
    at: new Date().toISOString(),
  });
}

// Corre una función global por nombre si existe; registra resultado/erorr.
function _runStep(fnName, ran, errors) {
  try {
    var fn = this[fnName];
    if (typeof fn !== 'function') {
      errors.push({ step: fnName, message: 'función no encontrada en el proyecto' });
      return;
    }
    fn();
    ran.push(fnName);
  } catch (err) {
    errors.push({ step: fnName, message: (err && err.message) || String(err) });
    Logger.log('[refresh] error en ' + fnName + ': ' + ((err && err.message) || err));
  }
}

function _refreshJson(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
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
 *   2. corre los consolidadores (Drive → paneles): trabajos, repuestos,
 *      combustible livianos, códigos de equipos
 *   3. corre construirSnapshot() (paneles → snapshot congelado) — SIEMPRE último,
 *      porque el snapshot tiene que copiar los paneles ya actualizados
 *   4. devuelve JSON { ok, ran:[...], errors:[...], at }
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

  var ran = [];
  var errors = [];

  // 1) Consolidadores: Drive → paneles. Cada uno en su try para que un fallo
  //    aislado no impida que corran los demás ni el snapshot.
  _runStep('actualizarPanelTrabajos',    ran, errors);
  _runStep('actualizarPanelRepuestos',   ran, errors);
  _runStep('syncCombustibleLivianos',    ran, errors);
  _runStep('syncCodigosEquipos',         ran, errors);

  // 2) Snapshot SIEMPRE al final: congela los paneles ya actualizados.
  _runStep('construirSnapshot',          ran, errors);

  return _refreshJson({
    ok: errors.length === 0,
    ran: ran,
    errors: errors,
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

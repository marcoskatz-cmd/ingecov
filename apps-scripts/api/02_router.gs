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

  try {
    // Auth: dos rutas posibles según cómo viene el request.
    //
    // (1) Via Cloudflare Worker — los params _cfu (email del usuario autenticado
    //     por CF Access) y _cfs (shared secret) están presentes. Validamos el
    //     secret y que el email esté en whitelist.
    //
    // (2) Acceso directo al Web App (sin Worker) — usamos Session.getActiveUser()
    //     como antes. Útil para debugging y para el endpoint whoami.
    //
    // Path (1) es el flujo de producción. Path (2) queda como fallback.
    if (params._cfs != null || params._cfu != null) {
      authViaWorker(params);
    } else {
      // whoami no requiere autorización: devuelve auth state para que el front
      // pueda renderizar la pantalla "no autorizado" sin loop de redirects.
      if (ep === 'whoami') {
        return jsonOk(getAuthInfo(), ep);
      }
      assertAllowed();
    }

    // Limpiar params internos antes de pasarlos a los handlers (que no deben verlos)
    delete params._cfs;
    delete params._cfu;

    switch (ep) {
      case 'whoami':               return jsonOk({ email: params._cfu_resolved || getAuthInfo().email, allowed: true }, ep);
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

/**
 * Valida que el request venga del Cloudflare Worker y que el usuario que
 * pasó CF Access esté en nuestra whitelist propia (doble check).
 */
function authViaWorker(params) {
  const expectedSecret = getProperty('SHARED_SECRET');
  if (!expectedSecret) {
    throw new ApiError('shared_secret_not_configured',
      'Falta Script Property SHARED_SECRET en el proyecto Apps Script', 500);
  }
  if (params._cfs !== expectedSecret) {
    throw new ApiError('invalid_secret',
      'Shared secret inválido — request no viene del Cloudflare Worker autorizado', 403);
  }
  const email = String(params._cfu || '').toLowerCase().trim();
  if (!email) {
    throw new ApiError('no_cf_user', 'Falta el email del usuario de Cloudflare Access', 400);
  }
  if (!getAllowedEmails().has(email)) {
    throw new ApiError('not_authorized',
      `Email ${email} no está en la whitelist del Apps Script (ALLOWED_EMAILS Property)`, 403);
  }
  params._cfu_resolved = email; // disponible para handlers que quieran loguearlo
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

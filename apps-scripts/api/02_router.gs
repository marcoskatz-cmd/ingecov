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

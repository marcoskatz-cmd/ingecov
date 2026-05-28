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

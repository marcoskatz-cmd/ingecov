// Pages Function que actúa como proxy entre el panel y el Apps Script Web App.
// Vive en `/api/*` del dominio del panel.
//
// Auth model:
//   1. El panel hace login con Google (Identity Services / One Tap) y obtiene
//      un ID token (JWT firmado por Google).
//   2. Cada request al Worker pasa el token en `Authorization: Bearer <jwt>`.
//   3. El Worker valida la firma con las public keys de Google y verifica
//      claims (aud = nuestro Client ID, iss = Google, exp no expirado).
//   4. El email del JWT se chequea contra una whitelist (env var ALLOWED_EMAILS).
//   5. Si OK, reenvía al Apps Script con el email + SHARED_SECRET para que
//      el Apps Script confíe en el origen.
//
// Env vars (Cloudflare Pages → Settings → Environment variables):
//   APPS_SCRIPT_URL    plaintext: URL del Web App
//   SHARED_SECRET      secret: shared secret entre Worker y Apps Script
//   GOOGLE_CLIENT_ID   plaintext: OAuth Client ID (mismo que usa el panel)
//   ALLOWED_EMAILS     plaintext: emails autorizados, separados por coma

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') {
    // CORS preflight: necesario porque el panel mandará Authorization header.
    // Aunque sean same-origin, algunos navegadores son estrictos.
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': new URL(request.url).origin,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (!env.APPS_SCRIPT_URL || !env.SHARED_SECRET || !env.GOOGLE_CLIENT_ID || !env.ALLOWED_EMAILS) {
    return jsonResponse({
      ok: false,
      error: 'worker_misconfigured',
      message: 'Faltan env vars (APPS_SCRIPT_URL, SHARED_SECRET, GOOGLE_CLIENT_ID, ALLOWED_EMAILS).',
    }, 500);
  }

  // 1. Extraer el JWT del header Authorization
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return jsonResponse({
      ok: false,
      error: 'no_token',
      message: 'Falta header Authorization: Bearer <jwt>',
    }, 401);
  }
  const idToken = match[1].trim();

  // 2. Verificar el JWT contra Google
  let claims;
  try {
    claims = await verifyGoogleIdToken(idToken, env.GOOGLE_CLIENT_ID);
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: 'invalid_token',
      message: err.message,
    }, 401);
  }

  const email = String(claims.email || '').toLowerCase();
  if (!email || claims.email_verified !== true) {
    return jsonResponse({
      ok: false,
      error: 'email_unverified',
      message: 'El email del token no está verificado.',
    }, 401);
  }

  // 3. Chequear whitelist
  const allowed = env.ALLOWED_EMAILS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(email)) {
    return jsonResponse({
      ok: false,
      error: 'not_authorized',
      email,
      message: `El email ${email} no está en la whitelist. Pedile a Marcos que te agregue.`,
    }, 403);
  }

  // 4. Reenviar al Apps Script con email + shared secret
  const url = new URL(request.url);
  const params = new URLSearchParams(url.search);
  params.set('_cfu', email);
  params.set('_cfs', env.SHARED_SECRET);

  const targetUrl = env.APPS_SCRIPT_URL + '?' + params.toString();

  let upstream;
  try {
    upstream = await fetch(targetUrl, { method: 'GET', redirect: 'follow' });
  } catch (e) {
    return jsonResponse({
      ok: false,
      error: 'upstream_failed',
      message: e.message,
    }, 502);
  }

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
      'Cache-Control': 'private, max-age=30',
      'Access-Control-Allow-Origin': new URL(request.url).origin,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// JWT verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valida un Google ID token. Tira si algo está mal; devuelve el payload si OK.
 * Cachea las JWKs de Google entre invocaciones del Worker (caches.default).
 */
async function verifyGoogleIdToken(idToken, expectedClientId) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('JWT mal formado (no tiene 3 partes)');

  const [headerB64, payloadB64, signatureB64] = parts;
  let header, payload;
  try {
    header = JSON.parse(b64UrlDecode(headerB64));
    payload = JSON.parse(b64UrlDecode(payloadB64));
  } catch (_) {
    throw new Error('No se pudo decodificar header o payload del JWT');
  }

  // Validar claims antes de la firma (es más barato que crypto.subtle.verify)
  if (payload.aud !== expectedClientId) {
    throw new Error(`aud inválido: esperado ${expectedClientId}, recibido ${payload.aud}`);
  }
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(payload.iss)) {
    throw new Error(`iss inválido: ${payload.iss}`);
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) {
    throw new Error('Token expirado');
  }

  // Obtener la clave pública de Google que firmó este JWT
  const jwk = await fetchGoogleJwk(header.kid);
  if (!jwk) throw new Error(`No se encontró JWK con kid=${header.kid} en Google`);

  // Importar y verificar firma
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
    false,
    ['verify']
  );
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = b64UrlToArrayBuffer(signatureB64);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
  if (!valid) throw new Error('Firma del JWT inválida');

  return payload;
}

/**
 * Trae las JWKs de Google. Cachea respuestas via Cloudflare cache para
 * no fetchear en cada request (Google las rota cada ~6 horas).
 */
async function fetchGoogleJwk(kid) {
  const url = 'https://www.googleapis.com/oauth2/v3/certs';
  const cacheKey = new Request(url);
  const cache = caches.default;

  let response = await cache.match(cacheKey);
  if (!response) {
    response = await fetch(url, {
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    // Cache por 1 hora del lado del Worker
    const cloned = new Response(response.body, response);
    cloned.headers.set('Cache-Control', 'public, max-age=3600');
    await cache.put(cacheKey, cloned.clone());
    response = cloned;
  }

  const data = await response.json();
  return (data.keys || []).find(k => k.kid === kid);
}

function b64UrlDecode(b64Url) {
  const b64 = b64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return atob(padded);
}

function b64UrlToArrayBuffer(b64Url) {
  const bin = b64UrlDecode(b64Url);
  const ab = new ArrayBuffer(bin.length);
  const u8 = new Uint8Array(ab);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return ab;
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

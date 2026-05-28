// Pages Function que actúa como proxy entre el panel (Cloudflare Pages) y
// el Apps Script Web App. Vive en `/api/*` del dominio del panel.
//
// El problema que resuelve: Apps Script Web Apps no responden a fetch
// cross-origin (Google devuelve 503). El Worker hace el fetch server-to-server
// (sin restricciones CORS) y devuelve la respuesta al panel.
//
// Auth: Cloudflare Access protege este endpoint. Solo usuarios en la whitelist
// de CF Access llegan acá. CF agrega el header `cf-access-authenticated-user-email`
// con el email del usuario autenticado. El Worker se lo pasa al Apps Script
// junto con un SHARED_SECRET para que confíe en el origen del request.
//
// Env vars (Cloudflare Pages → Settings → Environment variables):
//   APPS_SCRIPT_URL   plaintext: URL del Web App
//   SHARED_SECRET     secret: shared secret entre Worker y Apps Script

export async function onRequest({ request, env }) {
  const userEmail = request.headers.get('cf-access-authenticated-user-email');

  if (!userEmail) {
    return jsonResponse({
      ok: false,
      error: 'no_cf_access',
      message: 'Esta API requiere autenticación via Cloudflare Access.',
    }, 401);
  }

  if (!env.APPS_SCRIPT_URL || !env.SHARED_SECRET) {
    return jsonResponse({
      ok: false,
      error: 'worker_misconfigured',
      message: 'Faltan env vars APPS_SCRIPT_URL y/o SHARED_SECRET en Cloudflare Pages.',
    }, 500);
  }

  // Pasamos los params originales (ej. ep=pedidos, force=1) y agregamos
  // los de auth (_cfu, _cfs). Apps Script lee headers via e.parameter, así
  // que tienen que ir en URL — pero el secret igualmente viaja TLS-encriptado
  // y solo entre Cloudflare y Google, sin pasar por el browser del usuario.
  const url = new URL(request.url);
  const params = new URLSearchParams(url.search);
  params.set('_cfu', userEmail);
  params.set('_cfs', env.SHARED_SECRET);

  const targetUrl = env.APPS_SCRIPT_URL + '?' + params.toString();

  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      // Sin headers del cliente: queremos que Apps Script vea solo lo que mandamos.
    });
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
      // HTTP cache corto del lado del browser. La capa real de cache vive en
      // CacheService server-side (Apps Script) con TTL 30 min.
      'Cache-Control': 'private, max-age=30',
    },
  });
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

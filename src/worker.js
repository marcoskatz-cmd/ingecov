// Worker entrypoint. Routea entre:
//   - /api/* → handler de la API (proxy autenticado al Apps Script)
//   - cualquier otra ruta → assets estáticos (HTML, JS, fonts, etc.)
//
// La lógica de la API vive en functions/api/[[path]].js para que el código
// sea legible aisladamente. Acá solo despachamos.

import { onRequest as apiHandler } from '../functions/api/[[path]].js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Rutas /api/* → handler dinámico (autenticación + proxy al Apps Script)
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return apiHandler({ request, env, ctx });
    }

    // Todo lo demás → assets estáticos servidos por Cloudflare.
    // env.ASSETS está disponible gracias al binding declarado en wrangler.jsonc.
    return env.ASSETS.fetch(request);
  },
};

/**
 * bot.js — AlberBot: proxy del panel INGECO hacia la API de Claude.
 *
 * El panel (GitHub Pages, repo público) NO puede guardar la API key, así que
 * manda cada turno de la conversación acá por POST y este archivo:
 *   1. valida el cupo diario (BOT_CUPO_DIARIO preguntas por día, Script Property BOT_CUPO),
 *   2. agrega el system prompt (vive acá para ajustarlo sin redeploy de Pages),
 *   3. llama a api.anthropic.com/v1/messages con la key de Script Property ANTHROPIC_API_KEY,
 *   4. devuelve la respuesta cruda de Claude (content blocks + stop_reason + usage).
 *
 * Las HERRAMIENTAS (tools) las define y ejecuta el navegador sobre los globales
 * que el panel ya tiene cargados (window._estadoEquipos, _entregasPorEquipo, …).
 * Acá solo se reenvían. Una pregunta del usuario puede implicar varias llamadas
 * (Claude pide una herramienta → el browser la ejecuta → vuelve a llamar): el
 * cupo cuenta PREGUNTAS (body.nueva === true), con un fusible duro de llamadas
 * totales por si el cliente miente.
 *
 * Setup (una vez): Script Properties → ANTHROPIC_API_KEY = sk-ant-…
 * Deploy: clasp push --force && clasp deploy -i <deploymentId> (la webapp sirve
 * la versión DEPLOYADA, no HEAD).
 *
 * Diagnóstico: GET ?ep=bot_estado → cupo usado hoy, sin exponer la key.
 */

var BOT_MODEL        = 'claude-sonnet-5-5';
var BOT_CUPO_DIARIO  = 30;                       // preguntas por día (todas las personas juntas)
var BOT_FUSIBLE_CALLS= BOT_CUPO_DIARIO * 8;      // llamadas HTTP máximas por día (rondas de herramientas incluidas)
var BOT_MAX_TOKENS   = 4000;

var BOT_SYSTEM = [
  'Sos AlberBot, el asistente del panel de mantenimiento de flota de INGECO S.A. (empresa vial de Tucumán, Argentina).',
  'Respondés preguntas sobre los equipos de la flota: estado, service, VTV, horómetros, trabajos realizados, trabajos pendientes, entregas de repuestos, pedidos de compra, costos y combustible.',
  '',
  'DATOS',
  '- Toda la información sale EXCLUSIVAMENTE de las herramientas. No inventes números, fechas ni equipos. Si una herramienta no devuelve lo que hace falta, decilo.',
  '- Los datos son los mismos que muestra el panel (un snapshot que se reconstruye cada 30 minutos desde las planillas de mantenimiento). Si algo parece faltar, puede ser que no esté cargado en la planilla de origen.',
  '- Los códigos de equipo tienen formas variadas ("RN-03", "RN 03", "rn03"): las herramientas los normalizan, pasalos como vengan.',
  '- Los meses se expresan como "AAAA-MM" (ej. 2026-03). Los importes están en pesos argentinos.',
  '- Si el usuario nombra un equipo por nombre o descripción en vez de código, usá listar_equipos con ese texto para encontrar el código.',
  '- Para preguntas amplias (rankings, totales, comparaciones) usá las herramientas de agregados (costos_por_mes, ranking) en vez de recorrer equipo por equipo.',
  '- Podés llamar varias herramientas en una misma respuesta cuando son independientes.',
  '',
  'ESTILO',
  '- Respondé en español rioplatense, tono neutral y directo, sin chistes ni adornos.',
  '- Sé concreto: números, fechas y códigos. Cuando listás varios equipos o ítems, usá una tabla o lista corta.',
  '- No repitas la pregunta ni expliques qué herramienta usaste. No ofrezcas ayuda adicional al final.',
  '- Si la pregunta es ambigua (ej. "cuánto gastamos"), elegí la lectura más probable, respondé, y aclarála en una línea.',
  '- Formato: markdown simple (negritas, listas con "- ", tablas con "|"). Sin títulos grandes.',
].join('\n');

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return _botJson({ ok: false, error: 'json_invalido' });
  }
  if (body.ep !== 'bot') return _botJson({ ok: false, error: 'ep_desconocido' });

  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return _botJson({ ok: false, error: 'api_key_no_configurada' });

  var messages = body.messages;
  var tools    = body.tools;
  if (!Array.isArray(messages) || !messages.length) return _botJson({ ok: false, error: 'sin_mensajes' });
  if (!Array.isArray(tools)) tools = [];

  // ── Cupo diario ──────────────────────────────────────────────────────
  var cupo = _botCupoConsumir_(body.nueva === true);
  if (!cupo.ok) return _botJson({ ok: false, error: cupo.error, usadas: cupo.usadas, cupo: BOT_CUPO_DIARIO });

  // ── Llamada a Claude ─────────────────────────────────────────────────
  // Render order del prompt: tools → system → messages. El breakpoint de caché
  // va en el system (bloque estable); la fecha va DESPUÉS, en bloque aparte,
  // así solo invalida la caché una vez por día.
  var hoy = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'yyyy-MM-dd');
  var payload = {
    model: BOT_MODEL,
    max_tokens: BOT_MAX_TOKENS,
    system: [
      { type: 'text', text: BOT_SYSTEM, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'Fecha de hoy: ' + hoy + '.' },
    ],
    tools: tools,
    messages: messages,
    output_config: { effort: 'medium' },
    // Si un clasificador de seguridad rechaza la consulta, la API la reintenta
    // sola en otro modelo en vez de cortar la respuesta.
    fallbacks: 'default',
  };

  var resp;
  try {
    resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch (err) {
    return _botJson({ ok: false, error: 'red: ' + ((err && err.message) || String(err)) });
  }

  var code = resp.getResponseCode();
  var text = resp.getContentText();
  var data;
  try { data = JSON.parse(text); } catch (_) { data = null; }

  if (code < 200 || code >= 300) {
    var msg = (data && data.error && data.error.message) || text.slice(0, 300);
    return _botJson({ ok: false, error: 'api ' + code + ': ' + msg, usadas: cupo.usadas, cupo: BOT_CUPO_DIARIO });
  }
  return _botJson({
    ok: true,
    content: data.content,
    stop_reason: data.stop_reason,
    stop_details: data.stop_details || null,
    usage: data.usage || null,
    usadas: cupo.usadas,
    cupo: BOT_CUPO_DIARIO,
  });
}

// Estado del cupo (Script Property BOT_CUPO = {"fecha":"yyyy-MM-dd","n":N,"calls":M}).
// nueva=true descuenta una pregunta; siempre descuenta una llamada del fusible.
function _botCupoConsumir_(nueva) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (_) { return { ok: false, error: 'ocupado', usadas: null }; }
  try {
    var props = PropertiesService.getScriptProperties();
    var hoy = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'yyyy-MM-dd');
    var st = {};
    try { st = JSON.parse(props.getProperty('BOT_CUPO') || '{}'); } catch (_) { st = {}; }
    if (st.fecha !== hoy) st = { fecha: hoy, n: 0, calls: 0 };
    if (nueva && st.n >= BOT_CUPO_DIARIO) return { ok: false, error: 'cupo_agotado', usadas: st.n };
    if (st.calls >= BOT_FUSIBLE_CALLS)     return { ok: false, error: 'fusible_agotado', usadas: st.n };
    if (nueva) st.n += 1;
    st.calls += 1;
    props.setProperty('BOT_CUPO', JSON.stringify(st));
    return { ok: true, usadas: st.n };
  } finally {
    lock.releaseLock();
  }
}

// Lectura pública del cupo (?ep=bot_estado desde doGet). No expone la key.
function botEstado_() {
  var st = {};
  try { st = JSON.parse(PropertiesService.getScriptProperties().getProperty('BOT_CUPO') || '{}'); } catch (_) {}
  var hoy = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'yyyy-MM-dd');
  var usadas = st.fecha === hoy ? (st.n || 0) : 0;
  var keyOk = !!PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  return { ok: true, usadas: usadas, cupo: BOT_CUPO_DIARIO, modelo: BOT_MODEL, keyConfigurada: keyOk };
}

function _botJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Para correr a mano desde el editor y verificar key + conectividad sin el panel.
function botProbar() {
  var e = { postData: { contents: JSON.stringify({ ep: 'bot', nueva: false, tools: [], messages: [{ role: 'user', content: 'Decí "ok" y nada más.' }] }) } };
  Logger.log(doPost(e).getContent());
}

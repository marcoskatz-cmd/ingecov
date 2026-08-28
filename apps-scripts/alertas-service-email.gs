/**
 * INGECO Panel — ALERTAS DE SERVICE POR EMAIL
 * ──────────────────────────────────────────────────────────────────────────
 * Corre al final de construirSnapshot() (trigger de 30 min). Lee la pestaña
 * SVC_PANELPROG recién escrita y avisa por mail cuando un equipo entra en
 * zona de aviso:
 *
 *      horas (frecuencia en hs)   →  quedan <=   80 hs
 *      km    (frecuencia en km)   →  quedan <= 1000 km
 *      S/H   (frecuencia en días) →  quedan <=   15 días
 *
 * ANTI-SPAM: estado por equipo en Script Property ALERTAS_SVC_ESTADO. Un
 * equipo se notifica UNA vez al cruzar el umbral. No vuelve a notificarse
 * hasta que salga de la zona (o sea: hasta que le hagan el service y el
 * restante vuelva por encima del umbral). Los vencidos no re-disparan.
 *
 * Primera corrida: manda la foto completa de todo lo que ya está en zona.
 *
 * Funciones útiles a mano desde el editor:
 *   alertasServiceProbar()   → manda el mail con TODO lo que hay en zona hoy,
 *                              sin tocar el estado.
 *   alertasServiceEstado()   → loguea el estado guardado.
 *   alertasServiceReset()    → borra el estado (la próxima corrida vuelve a
 *                              mandar la foto completa).
 */

var ALERTA_DEST      = ['mantenimiento@grupoingeco.com.ar', 'marcoskatz@grupoingeco.com.ar'];
var ALERTA_PANEL_URL = 'https://marcoskatz-cmd.github.io/ingecov/';
var ALERTA_PROP_KEY  = 'ALERTAS_SVC_ESTADO';

// Umbrales por unidad. Cambiar acá.
var ALERTA_UMBRAL = { hs: 80, km: 1000, dias: 15 };

// Días sin ver un equipo en SVC_PANELPROG antes de olvidarlo del estado.
var ALERTA_RESET_DIAS = 45;

/* ═══════════════════════════════════════════════════════════════════════
   NÚCLEO
═══════════════════════════════════════════════════════════════════════ */

function alertasService_(snap){
  try{
    var filas = _alertaLeerPanel_(snap);
    if(!filas.length){ Logger.log('[alertas] SVC_PANELPROG sin filas usables, salgo.'); return; }

    var props    = PropertiesService.getScriptProperties();
    var raw      = props.getProperty(ALERTA_PROP_KEY);
    var primera  = !raw;
    var estado   = {};
    if(raw){ try{ estado = JSON.parse(raw) || {}; }catch(e){ estado = {}; } }

    var hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var nuevos = [], siguen = [], vistos = {};

    for(var i=0;i<filas.length;i++){
      var f = filas[i];
      vistos[f.cod] = true;
      var prev = estado[f.cod] || {};
      var z = f.enZona ? 1 : 0;

      estado[f.cod] = {
        z: z,
        desde: (prev.z === z && prev.desde) ? prev.desde : hoy,
        lastSeen: hoy
      };

      if(!f.enZona) continue;
      if(prev.z === 1) siguen.push(f);
      else             nuevos.push(f);
    }

    // Olvidar equipos que ya no aparecen hace rato
    var corte = new Date(); corte.setDate(corte.getDate() - ALERTA_RESET_DIAS);
    var corteStr = Utilities.formatDate(corte, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    for(var k in estado){ if(!vistos[k] && String(estado[k].lastSeen||'') < corteStr) delete estado[k]; }

    props.setProperty(ALERTA_PROP_KEY, JSON.stringify(estado));

    Logger.log('[alertas] en zona: %s (nuevos: %s, ya avisados: %s)%s',
      nuevos.length + siguen.length, nuevos.length, siguen.length,
      primera ? ' · PRIMERA CORRIDA' : '');

    if(nuevos.length) _alertaEnviar_(nuevos, siguen, primera ? 'primera' : '');
  }catch(e){
    Logger.log('[alertas] falló: ' + (e && e.message || e));
  }
}

function alertasServiceProbar(){
  var filas = _alertaLeerPanel_(null).filter(function(f){ return f.enZona; });
  if(!filas.length){ Logger.log('[alertas] no hay equipos en zona de aviso.'); return 'nada en zona'; }
  _alertaEnviar_(filas, [], 'prueba');
  return filas.length + ' equipo(s) — mail de prueba enviado a ' + ALERTA_DEST.join(', ');
}

function alertasServiceEstado(){
  var raw = PropertiesService.getScriptProperties().getProperty(ALERTA_PROP_KEY);
  var e = raw ? JSON.parse(raw) : {};
  var n = 0;
  for(var k in e){ n++; Logger.log('  %s → %s (desde %s, visto %s)', k, e[k].z ? 'EN ZONA' : 'ok', e[k].desde, e[k].lastSeen); }
  Logger.log('[alertas] %s equipos en estado.', n);
  return n + ' equipos en estado';
}

function alertasServiceReset(){
  PropertiesService.getScriptProperties().deleteProperty(ALERTA_PROP_KEY);
  Logger.log('[alertas] estado borrado. La próxima corrida manda la foto completa.');
  return 'estado borrado';
}

/* ═══════════════════════════════════════════════════════════════════════
   LECTURA · SVC_PANELPROG
═══════════════════════════════════════════════════════════════════════ */

function _alertaLeerPanel_(snap){
  var ss = snap || _getOrCreateSnapshotSS_();
  var sh = ss.getSheetByName('SVC_PANELPROG');
  if(!sh) return [];
  var v = sh.getDataRange().getDisplayValues();
  if(v.length < 2) return [];
  var h = v[0];
  function col(name){ for(var i=0;i<h.length;i++){ if(String(h[i]).trim().toUpperCase() === name) return i; } return -1; }
  var c = { cod:col('CODIGO'), des:col('DESCRIPCION'), pat:col('PATENTE'), ufe:col('ULT FECHA'),
            act:col('HRKM ACTUAL'), pro:col('EST HRKM'), ope:col('OPERATIVIDAD'),
            fre:col('FRECUENCIA'), est:col('ESTADO') };
  if(c.cod < 0 || c.ope < 0 || c.fre < 0){
    Logger.log('[alertas] SVC_PANELPROG sin columnas clave. HDR: ' + h.join(' ¦ '));
    return [];
  }

  var out = [];
  for(var r=1;r<v.length;r++){
    var row = v[r];
    var cod = String(row[c.cod]||'').trim();
    if(!cod) continue;
    var frec = String(row[c.fre]||'').trim();
    var unidad = _alertaUnidad_(frec);
    if(!unidad) continue;                       // frecuencia ilegible → no alertar a ciegas
    var rest = _audNum_(row[c.ope]);
    if(rest == null) continue;                  // sin lectura actual (ej. CMT-36) → no alertar
    out.push({
      cod: cod,
      desc: String(row[c.des]||'').trim(),
      pat: String(row[c.pat]||'').trim(),
      ultFecha: String(row[c.ufe]||'').trim(),
      actual: String(row[c.act]||'').trim(),
      prox: String(row[c.pro]||'').trim(),
      frec: frec,
      estado: String(row[c.est]||'').trim(),
      rest: rest,
      unidad: unidad,
      umbral: ALERTA_UMBRAL[unidad],
      enZona: rest <= ALERTA_UMBRAL[unidad]
    });
  }
  return out;
}

// 'S/H (90 días)' → dias · 10000 → km · 250 → hs
function _alertaUnidad_(frec){
  var s = String(frec||'').trim();
  if(!s) return null;
  if(/S\s*\/\s*H/i.test(s) || /D[ÍI]AS?/i.test(s)) return 'dias';
  var n = _audNum_(s);
  if(n == null || n <= 0) return null;
  return n >= 1000 ? 'km' : 'hs';
}

/* ═══════════════════════════════════════════════════════════════════════
   EMAIL
═══════════════════════════════════════════════════════════════════════ */

var ALERTA_UNIDAD_TXT = { hs:'hs', km:'km', dias:'días' };

function _alertaEnviar_(nuevos, siguen, modo){
  var pre = modo === 'prueba' ? '[PRUEBA] ' : '';
  var subject = pre + '[INGECO] ' + nuevos.length + ' equipo(s) con service próximo';

  MailApp.sendEmail({
    to: ALERTA_DEST.join(','),
    subject: subject,
    body: _alertaTexto_(nuevos, siguen, modo),
    htmlBody: _alertaHtml_(nuevos, siguen, modo),
    name: 'Panel INGECO'
  });
  Logger.log('[alertas] mail enviado a %s — %s nuevos', ALERTA_DEST.join(','), nuevos.length);
}

function _alertaFmt_(n){ return Math.round(n).toLocaleString('es-AR'); }

function _alertaEsc_(s){
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _alertaRestTxt_(f){
  var u = ALERTA_UNIDAD_TXT[f.unidad];
  return f.rest < 0 ? ('VENCIDO por ' + _alertaFmt_(Math.abs(f.rest)) + ' ' + u)
                    : ('faltan ' + _alertaFmt_(f.rest) + ' ' + u);
}

function _alertaHtml_(nuevos, siguen, modo){
  function fila(f, destacar){
    var color = f.rest < 0 ? '#b3261e' : destacar ? '#0f766e' : '#6b6b6b';
    return '<tr style="border-bottom:1px solid #e6e6e6">' +
      '<td style="padding:9px 12px;font-family:monospace;font-weight:600">' + _alertaEsc_(f.cod) + '</td>' +
      '<td style="padding:9px 12px">' + _alertaEsc_(f.desc || '—') +
        (f.pat ? '<br><span style="font-size:11px;color:#999;font-family:monospace">' + _alertaEsc_(f.pat) + '</span>' : '') + '</td>' +
      '<td style="padding:9px 12px;font-family:monospace;font-size:13px;color:#444">' + _alertaEsc_(f.actual || '—') + '</td>' +
      '<td style="padding:9px 12px;font-family:monospace;font-size:13px;color:#444">' + _alertaEsc_(f.prox || '—') + '</td>' +
      '<td style="padding:9px 12px;font-family:monospace;font-size:12px;font-weight:700;text-align:right;color:' + color + '">' +
        _alertaEsc_(_alertaRestTxt_(f)) + '</td>' +
      '</tr>';
  }
  function tabla(arr, destacar){
    return '<table style="border-collapse:collapse;width:100%;font-size:13px;border:1px solid #dcdcdc">' +
      '<thead><tr style="background:#fafafa">' +
      ['Código','Equipo','Actual','Próximo service','Restante'].map(function(t,i){
        return '<th style="padding:8px 12px;text-align:' + (i===4?'right':'left') +
          ';font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.06em">' + t + '</th>';
      }).join('') + '</tr></thead><tbody>' +
      arr.map(function(f){ return fila(f, destacar); }).join('') + '</tbody></table>';
  }

  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:820px;margin:0 auto;padding:20px;color:#0f1318">' +
    (modo === 'prueba' ? '<div style="background:#fdf3d6;border-left:4px solid #d99b21;padding:10px 14px;margin-bottom:18px;font-size:13px">Email de PRUEBA — no modifica el estado de las alertas.</div>' : '') +
    (modo === 'primera' ? '<div style="background:#e6f4f1;border-left:4px solid #0f766e;padding:10px 14px;margin-bottom:18px;font-size:13px">Primera corrida del sistema de alertas: va la foto completa de lo que hoy está en zona de aviso. De acá en más solo se avisa cuando un equipo <b>entra</b> a la zona.</div>' : '') +
    '<h2 style="margin:0 0 6px;font-size:18px">🔧 Service próximo — flota INGECO</h2>' +
    '<p style="margin:0 0 18px;color:#666;font-size:13px">Avisa cuando faltan ' +
      ALERTA_UMBRAL.hs + ' hs o menos (equipos), ' + ALERTA_UMBRAL.km + ' km o menos (vehículos) o ' +
      ALERTA_UMBRAL.dias + ' días o menos (service por tiempo).</p>' +
    '<h3 style="font-size:14px;color:#0f766e;margin:20px 0 8px">Entraron en zona de aviso (' + nuevos.length + ')</h3>' +
    tabla(nuevos, true) +
    (siguen.length ?
      '<h3 style="font-size:14px;color:#6b6b6b;margin:24px 0 8px">Siguen en zona (ya avisados) — ' + siguen.length + '</h3>' +
      tabla(siguen, false) : '') +
    '<p style="margin:24px 0 0;font-size:12px"><a href="' + ALERTA_PANEL_URL + '" style="color:#0f766e">Abrir el panel completo →</a></p>' +
    '<hr style="border:none;border-top:1px solid #eee;margin:20px 0">' +
    '<p style="margin:0;font-size:11px;color:#aaa">Generado automáticamente por el Panel INGECO al reconstruir el snapshot. Cada equipo se avisa una sola vez por ciclo: no vuelve a aparecer como nuevo hasta que se le haga el service.</p>' +
    '</div>';
}

function _alertaTexto_(nuevos, siguen, modo){
  function linea(f){
    return '  - ' + f.cod + '  ' + (f.desc || '—') +
      '\n      actual ' + (f.actual||'?') + '  ·  próximo ' + (f.prox||'?') +
      '  ·  ' + _alertaRestTxt_(f);
  }
  var out = (modo === 'prueba' ? '[PRUEBA] ' : '') +
    'INGECO · ' + nuevos.length + ' equipo(s) con service próximo.\n' +
    'Umbrales: ' + ALERTA_UMBRAL.hs + ' hs · ' + ALERTA_UMBRAL.km + ' km · ' + ALERTA_UMBRAL.dias + ' días.\n\n';
  if(modo === 'primera') out += '(Primera corrida: va la foto completa de lo que hoy está en zona.)\n\n';
  out += 'ENTRARON EN ZONA:\n' + nuevos.map(linea).join('\n') + '\n';
  if(siguen.length) out += '\nSIGUEN EN ZONA (ya avisados):\n' + siguen.map(linea).join('\n') + '\n';
  out += '\nPanel: ' + ALERTA_PANEL_URL + '\n';
  return out;
}

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
var ALERTA_UMBRAL = { hs: 50, km: 1000, dias: 15 };   // hs: 50 según diseño app INGECO (oct-2026)

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
    if(nuevos.length) _alertaApp_(nuevos);
  }catch(e){
    Logger.log('[alertas] falló: ' + (e && e.message || e));
  }
  try{ _alertasVtvApp_(snap); }catch(e){ Logger.log('[alertas vtv app] falló: ' + (e && e.message || e)); }
}

/* ═══════════════════════════════════════════════════════════════════════
   AVISOS POR LA APP INGECO (bandeja + push). Requiere CLAVE_INGECOV en Script Properties.
   Dedupe del lado de la app con clave_unica, así puede correr cada 30 min sin repetir.
═══════════════════════════════════════════════════════════════════════ */

function _alertaApp_(nuevos){
  nuevos.forEach(function(f){
    var vencido = Number(f.rest) < 0;
    var u = f.unidad === 'dias' ? 'días' : f.unidad;
    var titulo = (vencido ? 'Service vencido: ' : 'Service próximo: ') + f.cod + (f.desc ? ' · ' + f.desc : '');
    var cuerpo = (vencido ? 'Pasó ' + Math.abs(Number(f.rest)) + ' ' + u + ' del service' : 'Faltan ' + f.rest + ' ' + u) +
      (f.actual ? '. Actual ' + f.actual : '') + (f.prox ? ' · próximo ' + f.prox : '') + (f.pat ? ' · ' + f.pat : '');
    notificarAppIngeco_('INGECOV', {
      destinatarios: [{ area: 'TALLER' }, { admin: true }], tipo: 'aviso_general', prioridad: vencido ? 'critica' : 'normal',
      titulo: titulo, cuerpo: cuerpo, url_destino: ALERTA_PANEL_URL,
      clave_unica: 'svc-' + f.cod + '-' + String(f.prox || '') + '-' + (vencido ? 'v' : 'p'), dias_unica: 45
    });
  });
}

/** VTV: aviso a 15 días, a 3 días (crítico) y al vencer (crítico), una sola vez por vencimiento. */
function _alertasVtvApp_(snap){
  var ss = snap || _getOrCreateSnapshotSS_();
  var sh = ss.getSheetByName('VTV'); if(!sh) return;
  var v = sh.getDataRange().getValues(); if(v.length < 2) return;
  var h = v[0].map(function(x){ return String(x).trim().toUpperCase(); });
  var iE = h.indexOf('EQUIPO'), iC = h.indexOf('CÓDIGO') >= 0 ? h.indexOf('CÓDIGO') : h.indexOf('CODIGO'), iP = h.indexOf('PATENTE');
  var iV = h.indexOf('VENCIMIENTO VTV') >= 0 ? h.indexOf('VENCIMIENTO VTV') : h.indexOf('VENCIMIENTO');
  if(iV < 0 || iC < 0) return;
  var tz = Session.getScriptTimeZone(), hoy = new Date(); hoy.setHours(0,0,0,0);
  for(var i=1;i<v.length;i++){
    var r = v[i], venc = r[iV];
    if(!(venc instanceof Date)) continue;
    var d = new Date(venc); d.setHours(0,0,0,0);
    var dias = Math.round((d - hoy) / 86400000);
    var bucket = dias < 0 ? 'vencida' : dias <= 3 ? '3' : dias <= 15 ? '15' : null;
    if(!bucket) continue;
    var cod = String(r[iC] || '').trim(), nom = String(iE >= 0 ? r[iE] : '').trim(), pat = String(iP >= 0 ? r[iP] : '').trim();
    var fecha = Utilities.formatDate(d, tz, 'dd/MM/yyyy');
    var titulo = bucket === 'vencida' ? 'VTV vencida: ' + cod : 'VTV vence en ' + dias + ' día' + (dias === 1 ? '' : 's') + ': ' + cod;
    var cuerpo = (nom ? nom + ' · ' : '') + (pat ? pat + ' · ' : '') + (bucket === 'vencida' ? 'Venció el ' + fecha : 'Vence el ' + fecha);
    notificarAppIngeco_('INGECOV', {
      destinatarios: [{ area: 'ADMINISTRACION' }, { admin: true }], tipo: 'vencimiento_doc', prioridad: bucket === '15' ? 'normal' : 'critica',
      titulo: titulo, cuerpo: cuerpo, url_destino: ALERTA_PANEL_URL,
      clave_unica: 'vtv-' + cod + '-' + Utilities.formatDate(d, tz, 'yyyyMMdd') + '-' + bucket, dias_unica: 120
    });
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

/* ═══════════════════════════════════════════════════════════════════════
   RESUMEN SEMANAL (lunes 8am)
   ──────────────────────────────────────────────────────────────────────
   El aviso por ENTRADA en zona (alertasService_) es silencioso mientras
   nada cambie: si a un equipo no le hacen el service, sigue en zona y no
   vuelve a avisar nunca. El silencio pasa a leerse como "todo bien".
   Este resumen corrige eso: cada lunes manda la foto completa —
   VENCIDOS · EN ZONA · PRÓXIMOS — aunque no haya novedades.

   Funciones a mano:
     alertasResumenSemanal()          → arma y manda el resumen ahora.
     alertasInstalarTriggerResumen()  → instala/reinstala el trigger de los lunes.
     alertasTriggersListar()          → lista los triggers instalados.
═══════════════════════════════════════════════════════════════════════ */

// Cuántos equipos "próximos" (todavía fuera de zona) listar en el resumen.
var ALERTA_RESUMEN_PROXIMOS = 15;

function alertasResumenSemanal(){
  try{
    var filas = _alertaLeerPanel_(null);
    if(!filas.length){ Logger.log('[alertas] resumen: SVC_PANELPROG sin filas usables, salgo.'); return 'sin filas'; }

    // Proximidad comparable entre unidades distintas: cuánto queda respecto del umbral.
    filas.forEach(function(f){ f.ratio = f.rest / (f.umbral || 1); });
    filas.sort(function(a,b){ return a.ratio - b.ratio; });

    var vencidos = filas.filter(function(f){ return f.rest < 0; });
    var enZona   = filas.filter(function(f){ return f.rest >= 0 && f.enZona; });
    var proximos = filas.filter(function(f){ return !f.enZona; }).slice(0, ALERTA_RESUMEN_PROXIMOS);

    if(!vencidos.length && !enZona.length && !proximos.length){
      Logger.log('[alertas] resumen: nada para reportar.'); return 'nada para reportar';
    }

    MailApp.sendEmail({
      to: ALERTA_DEST.join(','),
      subject: '[INGECO] Service de la semana — ' + vencidos.length + ' vencido(s), ' +
               enZona.length + ' por vencer',
      body: _alertaResumenTexto_(vencidos, enZona, proximos),
      htmlBody: _alertaResumenHtml_(vencidos, enZona, proximos),
      name: 'Panel INGECO'
    });
    Logger.log('[alertas] resumen enviado — %s vencidos, %s en zona, %s próximos',
      vencidos.length, enZona.length, proximos.length);
    return vencidos.length + ' vencidos · ' + enZona.length + ' en zona · ' + proximos.length + ' próximos';
  }catch(e){
    Logger.log('[alertas] resumen falló: ' + (e && e.message || e));
    throw e;
  }
}

function _alertaResumenTablaHtml_(arr, color){
  function fila(f){
    return '<tr style="border-bottom:1px solid #e6e6e6">' +
      '<td style="padding:9px 12px;font-family:monospace;font-weight:600">' + _alertaEsc_(f.cod) + '</td>' +
      '<td style="padding:9px 12px">' + _alertaEsc_(f.desc || '—') +
        (f.pat ? '<br><span style="font-size:11px;color:#999;font-family:monospace">' + _alertaEsc_(f.pat) + '</span>' : '') + '</td>' +
      '<td style="padding:9px 12px;font-family:monospace;font-size:13px;color:#444">' + _alertaEsc_(f.actual || '—') + '</td>' +
      '<td style="padding:9px 12px;font-family:monospace;font-size:13px;color:#444">' + _alertaEsc_(f.prox || '—') + '</td>' +
      '<td style="padding:9px 12px;font-family:monospace;font-size:12px;font-weight:700;text-align:right;color:' + color + '">' +
        _alertaEsc_(_alertaRestTxt_(f)) + '</td></tr>';
  }
  return '<table style="border-collapse:collapse;width:100%;font-size:13px;border:1px solid #dcdcdc">' +
    '<thead><tr style="background:#fafafa">' +
    ['Código','Equipo','Actual','Próximo service','Restante'].map(function(t,i){
      return '<th style="padding:8px 12px;text-align:' + (i===4?'right':'left') +
        ';font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.06em">' + t + '</th>';
    }).join('') + '</tr></thead><tbody>' + arr.map(fila).join('') + '</tbody></table>';
}

function _alertaResumenHtml_(vencidos, enZona, proximos){
  function bloque(titulo, arr, color, vacio){
    if(!arr.length) return '<h3 style="font-size:14px;color:' + color + ';margin:22px 0 8px">' + titulo +
      ' (0)</h3><p style="margin:0;font-size:13px;color:#8a8a8a">' + vacio + '</p>';
    return '<h3 style="font-size:14px;color:' + color + ';margin:22px 0 8px">' + titulo + ' (' + arr.length + ')</h3>' +
      _alertaResumenTablaHtml_(arr, color);
  }
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:820px;margin:0 auto;padding:20px;color:#0f1318">' +
    '<h2 style="margin:0 0 6px;font-size:18px">🔧 Service de la semana — flota INGECO</h2>' +
    '<p style="margin:0 0 18px;color:#666;font-size:13px">Foto completa de los lunes. Zona de aviso: ' +
      ALERTA_UMBRAL.hs + ' hs · ' + ALERTA_UMBRAL.km + ' km · ' + ALERTA_UMBRAL.dias + ' días.</p>' +
    bloque('⚠ Vencidos — hacer ya', vencidos, '#b3261e', 'Ninguno vencido. 👌') +
    bloque('Por vencer — en zona de aviso', enZona, '#0f766e', 'Ninguno en zona de aviso.') +
    bloque('Próximos — todavía fuera de zona', proximos, '#6b6b6b', 'Sin próximos para listar.') +
    '<p style="margin:24px 0 0;font-size:12px"><a href="' + ALERTA_PANEL_URL + '" style="color:#0f766e">Abrir el panel completo →</a></p>' +
    '<hr style="border:none;border-top:1px solid #eee;margin:20px 0">' +
    '<p style="margin:0;font-size:11px;color:#aaa">Resumen automático de los lunes del Panel INGECO. Va igual aunque no haya novedades: si no llega, algo se rompió.</p>' +
    '</div>';
}

function _alertaResumenTexto_(vencidos, enZona, proximos){
  function linea(f){
    return '  - ' + f.cod + '  ' + (f.desc || '—') +
      '\n      actual ' + (f.actual||'?') + '  ·  próximo ' + (f.prox||'?') +
      '  ·  ' + _alertaRestTxt_(f);
  }
  function bloque(t, arr, vacio){
    return t + ' (' + arr.length + '):\n' + (arr.length ? arr.map(linea).join('\n') : '  ' + vacio) + '\n\n';
  }
  return 'INGECO · service de la semana.\n' +
    'Zona de aviso: ' + ALERTA_UMBRAL.hs + ' hs · ' + ALERTA_UMBRAL.km + ' km · ' + ALERTA_UMBRAL.dias + ' días.\n\n' +
    bloque('VENCIDOS — HACER YA', vencidos, 'ninguno.') +
    bloque('POR VENCER — EN ZONA DE AVISO', enZona, 'ninguno.') +
    bloque('PRÓXIMOS — TODAVÍA FUERA DE ZONA', proximos, 'ninguno.') +
    'Panel: ' + ALERTA_PANEL_URL + '\n';
}

function alertasInstalarTriggerResumen(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction() === 'alertasResumenSemanal') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('alertasResumenSemanal').timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).nearMinute(0).create();
  Logger.log('[alertas] trigger semanal instalado (lunes 8am).');
  return 'trigger instalado: lunes 8am';
}

function alertasTriggersListar(){
  var out = ScriptApp.getProjectTriggers().map(function(t){ return t.getHandlerFunction(); });
  Logger.log('[alertas] triggers: ' + out.join(', '));
  return out;
}

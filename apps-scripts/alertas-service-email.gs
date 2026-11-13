/**
 * INGECO Panel — ALERTAS DE SERVICE POR EMAIL
 * ──────────────────────────────────────────────────────────────────────────
 * Corre al final de construirSnapshot() (trigger de 30 min). Lee la pestaña
 * SVC_PANELPROG recién escrita y detecta cuándo un equipo entra en zona de
 * aviso:
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
 * MAIL: la corrida de 30 min NO manda mails (nov-2026). Lo que detecta
 * (service nuevos en zona + VTV por vencer/vencidas) se acumula en la Script
 * Property ALERTAS_PENDIENTES y sale en UN solo mail por día, de lunes a
 * viernes a las 9, desde alertasDigestDiario(). Ese mail va SIEMPRE y trae
 * dos partes: lo que entró desde el mail anterior y todo lo pendiente hoy
 * (service vencidos · en zona · VTV vencidas o por vencer). Los lunes suma
 * los próximos service fuera de zona. Los avisos por la App INGECO (push)
 * siguen saliendo al momento.
 *
 * Funciones útiles a mano desde el editor:
 *   alertasDigestDiario(true)     → manda el mail del día ahora (también fin de semana).
 *   alertasInstalarTriggerDigest()→ instala el trigger lun-vie 9am (y borra el
 *                                   viejo de los lunes).
 *   alertasServiceProbar()        → manda el mail con TODO lo que hay en zona
 *                                   hoy, sin tocar el estado.
 *   alertasServiceEstado()        → loguea el estado guardado.
 *   alertasServiceReset()         → borra el estado (la próxima corrida vuelve
 *                                   a encolar la foto completa).
 */

var ALERTA_DEST      = ['mantenimiento@grupoingeco.com.ar', 'marcoskatz@grupoingeco.com.ar'];
var ALERTA_PANEL_URL = 'https://marcoskatz-cmd.github.io/ingecov/';
var ALERTA_PROP_KEY  = 'ALERTAS_SVC_ESTADO';
var ALERTA_PEND_KEY  = 'ALERTAS_PENDIENTES';   // cola del mail diario: { svc:{cod:fila}, vtv:{clave:item}, primera:bool }
var ALERTA_VTV_KEY   = 'ALERTAS_VTV_AVISADAS'; // { clave: 'yyyy-MM-dd' } para no re-encolar la misma VTV
var ALERTA_DIGEST_HORA = 9;                    // hora del mail diario (lun a vie)

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

    if(nuevos.length) _alertaEncolarSvc_(nuevos, primera);
    if(nuevos.length) _alertaApp_(nuevos);
  }catch(e){
    Logger.log('[alertas] falló: ' + (e && e.message || e));
  }
  try{ _alertasVtvApp_(snap); }catch(e){ Logger.log('[alertas vtv app] falló: ' + (e && e.message || e)); }
}

/* ═══════════════════════════════════════════════════════════════════════
   COLA DEL MAIL DIARIO
═══════════════════════════════════════════════════════════════════════ */

function _alertaPendLeer_(){
  var raw = PropertiesService.getScriptProperties().getProperty(ALERTA_PEND_KEY);
  var p = {};
  if(raw){ try{ p = JSON.parse(raw) || {}; }catch(e){ p = {}; } }
  p.svc = p.svc || {}; p.vtv = p.vtv || {}; p.primera = !!p.primera;
  return p;
}
function _alertaPendGuardar_(p){
  PropertiesService.getScriptProperties().setProperty(ALERTA_PEND_KEY, JSON.stringify(p));
}
function _alertaEncolarSvc_(nuevos, primera){
  var p = _alertaPendLeer_();
  nuevos.forEach(function(f){ p.svc[f.cod] = f; });   // si entra dos veces en el día, queda la lectura más nueva
  if(primera) p.primera = true;
  _alertaPendGuardar_(p);
  Logger.log('[alertas] %s equipo(s) encolados para el mail diario.', nuevos.length);
}
function _alertaEncolarVtv_(items){
  if(!items.length) return;
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(ALERTA_VTV_KEY), avisadas = {};
  if(raw){ try{ avisadas = JSON.parse(raw) || {}; }catch(e){ avisadas = {}; } }
  var hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var p = _alertaPendLeer_(), n = 0;
  items.forEach(function(it){
    if(avisadas[it.clave]) return;
    avisadas[it.clave] = hoy; p.vtv[it.clave] = it; n++;
  });
  // Olvidar claves viejas (vencimientos ya pasados hace mucho)
  var corte = new Date(); corte.setDate(corte.getDate() - 180);
  var corteStr = Utilities.formatDate(corte, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  for(var k in avisadas){ if(String(avisadas[k]) < corteStr) delete avisadas[k]; }
  props.setProperty(ALERTA_VTV_KEY, JSON.stringify(avisadas));
  if(n){ _alertaPendGuardar_(p); Logger.log('[alertas vtv] %s VTV encoladas para el mail diario.', n); }
}

/**
 * Mail diario (trigger lun-vie 9am). Va SIEMPRE, de lunes a viernes, con dos
 * partes (pedido de Marcos, nov-2026):
 *   1. Lo que entró desde el mail anterior: equipos que entraron en zona de
 *      service + VTV que cruzaron 15 días / 3 días / vencida.
 *   2. Todo lo pendiente hoy: service vencidos, service en zona de aviso y
 *      VTV vencidas o por vencer (≤ 15 días). Lo nuevo va marcado "NUEVO".
 * Los lunes suma además los próximos service todavía fuera de zona.
 * forzar: true → manda aunque sea fin de semana.
 */
function alertasDigestDiario(forzar){
  var dow = new Date().getDay();                 // 0 dom … 6 sáb
  if(!forzar && (dow === 0 || dow === 6)){ Logger.log('[alertas] fin de semana, sin mail.'); return 'fin de semana'; }
  var p = _alertaPendLeer_();
  var svc = Object.keys(p.svc).map(function(k){ return p.svc[k]; });
  var vtv = Object.keys(p.vtv).map(function(k){ return p.vtv[k]; });
  var lunes = dow === 1 || forzar === 'resumen';

  // Foto completa de lo pendiente, leída en el momento.
  var filas = _alertaLeerPanel_(null);
  filas.forEach(function(f){ f.ratio = f.rest / (f.umbral || 1); });
  filas.sort(function(a,b){ return a.ratio - b.ratio; });
  var nuevosCod = {}; svc.forEach(function(f){ nuevosCod[f.cod] = true; });
  filas.forEach(function(f){ f.nuevo = !!nuevosCod[f.cod]; });
  var pend = {
    vencidos: filas.filter(function(f){ return f.rest < 0; }),
    enZona:   filas.filter(function(f){ return f.rest >= 0 && f.enZona; }),
    proximos: lunes ? filas.filter(function(f){ return !f.enZona; }).slice(0, ALERTA_RESUMEN_PROXIMOS) : null,
    vtv:      _alertaLeerVtv_(null)
  };
  var vtvNuevas = {}; vtv.forEach(function(v){ vtvNuevas[v.cod + '|' + v.fecha] = true; });
  pend.vtv.forEach(function(v){ v.nuevo = !!vtvNuevas[v.cod + '|' + v.fecha]; });

  // Novedades: ordenar por proximidad; VTV por fecha de vencimiento.
  svc.forEach(function(f){ f.ratio = f.rest / (f.umbral || 1); });
  svc.sort(function(a,b){ return a.ratio - b.ratio; });
  vtv.sort(function(a,b){ return a.dias - b.dias; });

  var partes = [];
  var nNuevos = svc.length + vtv.length;
  partes.push(nNuevos ? nNuevos + ' nuevo' + (nNuevos===1?'':'s') : 'sin novedades');
  if(pend.vencidos.length) partes.push(pend.vencidos.length + ' vencido' + (pend.vencidos.length===1?'':'s'));
  if(pend.enZona.length)   partes.push(pend.enZona.length + ' por vencer');
  if(pend.vtv.length)      partes.push(pend.vtv.length + ' VTV');
  if(!pend.vencidos.length && !pend.enZona.length && !pend.vtv.length) partes.push('nada pendiente');
  var subject = '[INGECO] Service del día — ' + partes.join(' · ');

  MailApp.sendEmail({
    to: ALERTA_DEST.join(','),
    subject: subject,
    body: _alertaDigestTexto_(svc, vtv, pend, p.primera),
    htmlBody: _alertaDigestHtml_(svc, vtv, pend, p.primera),
    name: 'Panel INGECO'
  });
  _alertaPendGuardar_({ svc:{}, vtv:{}, primera:false });
  var res = svc.length + ' service nuevos · ' + vtv.length + ' VTV nuevas · pendientes: ' +
    pend.vencidos.length + ' vencidos, ' + pend.enZona.length + ' en zona, ' + pend.vtv.length + ' VTV';
  Logger.log('[alertas] mail diario enviado — ' + res);
  return res;
}

function _alertaVtvTxt_(v){
  return v.dias < 0 ? ('VENCIDA hace ' + Math.abs(v.dias) + ' día' + (Math.abs(v.dias)===1?'':'s') + ' (' + v.fecha + ')')
       : v.dias === 0 ? 'vence HOY (' + v.fecha + ')'
       : ('vence en ' + v.dias + ' día' + (v.dias===1?'':'s') + ' (' + v.fecha + ')');
}

// Colores pensando en daltonismo rojo-verde: ámbar (urgente) / teal (aviso) / gris.
var ALERTA_COL = { urgente:'#b45309', aviso:'#0f766e', gris:'#6b6b6b' };
var ALERTA_BADGE_NUEVO = '<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:3px;background:#1d4ed8;color:#fff;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:.04em;vertical-align:middle">NUEVO</span>';

function _alertaVtvTablaHtml_(arr){
  return '<table style="border-collapse:collapse;width:100%;font-size:13px;border:1px solid #dcdcdc">' +
    '<thead><tr style="background:#fafafa">' +
    ['Código','Vehículo','Patente','Vencimiento'].map(function(t,i){
      return '<th style="padding:8px 12px;text-align:' + (i===3?'right':'left') +
        ';font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.06em">' + t + '</th>';
    }).join('') + '</tr></thead><tbody>' +
    arr.map(function(v){
      var color = v.dias <= 3 ? ALERTA_COL.urgente : ALERTA_COL.aviso;
      return '<tr style="border-bottom:1px solid #e6e6e6">' +
        '<td style="padding:9px 12px;font-family:monospace;font-weight:600">' + _alertaEsc_(v.cod) + (v.nuevo ? ALERTA_BADGE_NUEVO : '') + '</td>' +
        '<td style="padding:9px 12px">' + _alertaEsc_(v.nom || '—') + '</td>' +
        '<td style="padding:9px 12px;font-family:monospace;font-size:12px;color:#666">' + _alertaEsc_(v.pat || '—') + '</td>' +
        '<td style="padding:9px 12px;font-family:monospace;font-size:12px;font-weight:700;text-align:right;color:' + color + '">' +
          _alertaEsc_(_alertaVtvTxt_(v)) + '</td></tr>';
    }).join('') + '</tbody></table>';
}

function _alertaDigestHtml_(svc, vtv, pend, primera){
  function h3(titulo, n, color, mt){
    return '<h3 style="font-size:14px;color:' + color + ';margin:' + (mt||22) + 'px 0 8px">' + titulo + ' (' + n + ')</h3>';
  }
  function vacio(t){ return '<p style="margin:0;font-size:13px;color:#8a8a8a">' + t + '</p>'; }
  function bloque(titulo, arr, color, txtVacio){
    return h3(titulo, arr.length, color) + (arr.length ? _alertaResumenTablaHtml_(arr, color) : vacio(txtVacio));
  }
  var html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:820px;margin:0 auto;padding:20px;color:#0f1318">' +
    (primera ? '<div style="background:#e6f4f1;border-left:4px solid #0f766e;padding:10px 14px;margin-bottom:18px;font-size:13px">Primera corrida del sistema de alertas: todo lo que hoy está en zona figura como nuevo.</div>' : '') +
    '<h2 style="margin:0 0 6px;font-size:18px">🔧 Service de la flota INGECO — mail del día</h2>' +
    '<p style="margin:0 0 18px;color:#666;font-size:13px">Arriba, lo que entró desde el mail anterior; abajo, todo lo que está pendiente hoy. Zona de aviso de service: ' +
      ALERTA_UMBRAL.hs + ' hs · ' + ALERTA_UMBRAL.km + ' km · ' + ALERTA_UMBRAL.dias + ' días. VTV: desde 15 días antes del vencimiento.</p>';

  // 1. Lo que entró
  html += '<h2 style="margin:8px 0 4px;font-size:16px;border-bottom:2px solid #1d4ed8;padding-bottom:4px">1 · Lo que entró desde el último mail</h2>';
  if(svc.length) html += h3('Service — entraron en zona de aviso', svc.length, ALERTA_COL.aviso, 14) + _alertaResumenTablaHtml_(svc, ALERTA_COL.aviso);
  if(vtv.length) html += h3('VTV — cruzaron un aviso', vtv.length, ALERTA_COL.aviso) + _alertaVtvTablaHtml_(vtv);
  if(!svc.length && !vtv.length) html += '<p style="margin:12px 0 0;font-size:13px;color:#8a8a8a">Nada nuevo desde el último mail.</p>';

  // 2. Todo lo pendiente
  html += '<h2 style="margin:30px 0 4px;font-size:16px;border-bottom:2px solid #0f1318;padding-bottom:4px">2 · Todo lo pendiente hoy</h2>' +
    bloque('⚠ Service vencido — hacer ya', pend.vencidos, ALERTA_COL.urgente, 'Ningún service vencido. 👌') +
    bloque('Service por vencer — en zona de aviso', pend.enZona, ALERTA_COL.aviso, 'Ningún equipo en zona de aviso.') +
    h3('VTV vencidas o por vencer', pend.vtv.length, ALERTA_COL.aviso) +
      (pend.vtv.length ? _alertaVtvTablaHtml_(pend.vtv) : vacio('Ninguna VTV vencida ni por vencer en 15 días.'));
  if(pend.proximos) html += bloque('Próximos service — todavía fuera de zona (solo lunes)', pend.proximos, ALERTA_COL.gris, 'Sin próximos para listar.');

  html += '<p style="margin:24px 0 0;font-size:12px"><a href="' + ALERTA_PANEL_URL + '" style="color:#0f766e">Abrir el panel completo →</a></p>' +
    '<hr style="border:none;border-top:1px solid #eee;margin:20px 0">' +
    '<p style="margin:0;font-size:11px;color:#aaa">Mail diario automático del Panel INGECO, lunes a viernes a las ' + ALERTA_DIGEST_HORA + ' hs. Sale todos los días aunque no haya novedades, para que el pendiente siempre esté a la vista.</p>' +
    '</div>';
  return html;
}

function _alertaDigestTexto_(svc, vtv, pend, primera){
  function linea(f){
    return '  - ' + f.cod + (f.nuevo ? ' [NUEVO]' : '') + '  ' + (f.desc || '—') +
      '\n      actual ' + (f.actual||'?') + '  ·  próximo ' + (f.prox||'?') + '  ·  ' + _alertaRestTxt_(f);
  }
  function lineaVtv(v){
    return '  - ' + v.cod + (v.nuevo ? ' [NUEVO]' : '') + '  ' + (v.nom || '—') + (v.pat ? '  ' + v.pat : '') + '  ·  ' + _alertaVtvTxt_(v);
  }
  function bloque(t, arr, fn, vacio){
    return t + ' (' + arr.length + '):\n' + (arr.length ? arr.map(fn).join('\n') : '  ' + vacio) + '\n\n';
  }
  var out = 'INGECO · service de la flota, mail del día.\n\n';
  if(primera) out += '(Primera corrida: todo lo que hoy está en zona figura como nuevo.)\n\n';
  out += '=== 1 · LO QUE ENTRÓ DESDE EL ÚLTIMO MAIL ===\n\n';
  if(svc.length) out += bloque('SERVICE — ENTRARON EN ZONA', svc, linea, '');
  if(vtv.length) out += bloque('VTV — CRUZARON UN AVISO', vtv, lineaVtv, '');
  if(!svc.length && !vtv.length) out += 'Nada nuevo desde el último mail.\n\n';
  out += '=== 2 · TODO LO PENDIENTE HOY ===\n\n' +
    bloque('SERVICE VENCIDO — HACER YA', pend.vencidos, linea, 'ninguno.') +
    bloque('SERVICE POR VENCER — EN ZONA DE AVISO', pend.enZona, linea, 'ninguno.') +
    bloque('VTV VENCIDAS O POR VENCER', pend.vtv, lineaVtv, 'ninguna.');
  if(pend.proximos) out += bloque('PRÓXIMOS SERVICE — TODAVÍA FUERA DE ZONA', pend.proximos, linea, 'ninguno.');
  out += 'Panel: ' + ALERTA_PANEL_URL + '\n';
  return out;
}

function alertasInstalarTriggerDigest(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    var h = t.getHandlerFunction();
    if(h === 'alertasDigestDiario' || h === 'alertasResumenSemanal') ScriptApp.deleteTrigger(t);
  });
  [ScriptApp.WeekDay.MONDAY, ScriptApp.WeekDay.TUESDAY, ScriptApp.WeekDay.WEDNESDAY,
   ScriptApp.WeekDay.THURSDAY, ScriptApp.WeekDay.FRIDAY].forEach(function(d){
    ScriptApp.newTrigger('alertasDigestDiario').timeBased().onWeekDay(d).atHour(ALERTA_DIGEST_HORA).nearMinute(0).create();
  });
  Logger.log('[alertas] trigger diario instalado (lun-vie %s hs). El de los lunes quedó borrado.', ALERTA_DIGEST_HORA);
  return 'trigger instalado: lunes a viernes ' + ALERTA_DIGEST_HORA + ' hs';
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

/**
 * VTV vencidas o que vencen en ≤ 15 días, leídas de la pestaña VTV del snapshot.
 * bucket: '15' | '3' | 'vencida'. Ordenadas por días restantes.
 */
function _alertaLeerVtv_(snap){
  var ss = snap || _getOrCreateSnapshotSS_();
  var sh = ss.getSheetByName('VTV'); if(!sh) return [];
  var v = sh.getDataRange().getValues(); if(v.length < 2) return [];
  var h = v[0].map(function(x){ return String(x).trim().toUpperCase(); });
  var iE = h.indexOf('EQUIPO'), iC = h.indexOf('CÓDIGO') >= 0 ? h.indexOf('CÓDIGO') : h.indexOf('CODIGO'), iP = h.indexOf('PATENTE');
  var iV = h.indexOf('VENCIMIENTO VTV') >= 0 ? h.indexOf('VENCIMIENTO VTV') : h.indexOf('VENCIMIENTO');
  if(iV < 0 || iC < 0) return [];
  var tz = Session.getScriptTimeZone(), hoy = new Date(); hoy.setHours(0,0,0,0);
  var out = [];
  for(var i=1;i<v.length;i++){
    var r = v[i], venc = r[iV];
    if(!(venc instanceof Date)) continue;
    var d = new Date(venc); d.setHours(0,0,0,0);
    var dias = Math.round((d - hoy) / 86400000);
    var bucket = dias < 0 ? 'vencida' : dias <= 3 ? '3' : dias <= 15 ? '15' : null;
    if(!bucket) continue;
    var cod = String(r[iC] || '').trim();
    out.push({
      clave: 'vtv-' + cod + '-' + Utilities.formatDate(d, tz, 'yyyyMMdd') + '-' + bucket,
      cod: cod, nom: String(iE >= 0 ? r[iE] : '').trim(), pat: String(iP >= 0 ? r[iP] : '').trim(),
      fecha: Utilities.formatDate(d, tz, 'dd/MM/yyyy'), dias: dias, bucket: bucket
    });
  }
  out.sort(function(a,b){ return a.dias - b.dias; });
  return out;
}

/** VTV: aviso a 15 días, a 3 días (crítico) y al vencer (crítico), una sola vez por vencimiento. */
function _alertasVtvApp_(snap){
  var items = _alertaLeerVtv_(snap);
  items.forEach(function(it){
    var titulo = it.bucket === 'vencida' ? 'VTV vencida: ' + it.cod : 'VTV vence en ' + it.dias + ' día' + (it.dias === 1 ? '' : 's') + ': ' + it.cod;
    var cuerpo = (it.nom ? it.nom + ' · ' : '') + (it.pat ? it.pat + ' · ' : '') + (it.bucket === 'vencida' ? 'Venció el ' + it.fecha : 'Vence el ' + it.fecha);
    notificarAppIngeco_('INGECOV', {
      destinatarios: [{ area: 'ADMINISTRACION' }, { admin: true }], tipo: 'vencimiento_doc', prioridad: it.bucket === '15' ? 'normal' : 'critica',
      titulo: titulo, cuerpo: cuerpo, url_destino: ALERTA_PANEL_URL,
      clave_unica: it.clave, dias_unica: 120
    });
  });
  _alertaEncolarVtv_(items);
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
  PropertiesService.getScriptProperties().deleteProperty(ALERTA_PEND_KEY);
  PropertiesService.getScriptProperties().deleteProperty(ALERTA_VTV_KEY);
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
    var color = f.rest < 0 ? '#b45309' : destacar ? '#0f766e' : '#6b6b6b';
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
   RESUMEN SEMANAL (foto completa)
   ──────────────────────────────────────────────────────────────────────
   El aviso por ENTRADA en zona (alertasService_) es silencioso mientras
   nada cambie: si a un equipo no le hacen el service, sigue en zona y no
   vuelve a avisar nunca. El silencio pasa a leerse como "todo bien".
   La foto completa — VENCIDOS · EN ZONA · PRÓXIMOS — corrige eso.
   Desde nov-2026 YA NO tiene trigger propio: lo pendiente va todos los
   días en el mail diario (alertasDigestDiario) y los próximos, los lunes.
   alertasResumenSemanal() queda solo para mandarla a mano (editor o
   ?ep=alertas&resumen=1).

   Funciones a mano:
     alertasResumenSemanal()          → arma y manda el resumen ahora (mail aparte).
     alertasInstalarTriggerResumen()  → alias de alertasInstalarTriggerDigest().
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
      '<td style="padding:9px 12px;font-family:monospace;font-weight:600">' + _alertaEsc_(f.cod) + (f.nuevo ? ALERTA_BADGE_NUEVO : '') + '</td>' +
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
    bloque('⚠ Vencidos — hacer ya', vencidos, '#b45309', 'Ninguno vencido. 👌') +
    bloque('Por vencer — en zona de aviso', enZona, '#0f766e', 'Ninguno en zona de aviso.') +
    bloque('Próximos — todavía fuera de zona', proximos, '#6b6b6b', 'Sin próximos para listar.') +
    '<p style="margin:24px 0 0;font-size:12px"><a href="' + ALERTA_PANEL_URL + '" style="color:#0f766e">Abrir el panel completo →</a></p>' +
    '<hr style="border:none;border-top:1px solid #eee;margin:20px 0">' +
    '<p style="margin:0;font-size:11px;color:#aaa">Foto completa de la flota, generada a mano desde el Panel INGECO.</p>' +
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

// Compatibilidad (refresh-webapp ?instalar=1 lo llama): hoy instala el diario.
function alertasInstalarTriggerResumen(){ return alertasInstalarTriggerDigest(); }

function alertasTriggersListar(){
  var out = ScriptApp.getProjectTriggers().map(function(t){ return t.getHandlerFunction(); });
  Logger.log('[alertas] triggers: ' + out.join(', '));
  return out;
}

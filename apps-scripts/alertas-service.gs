/**
 * INGECOV · Alertas por email de service crítico
 * ---------------------------------------------------------------------------
 * Lee PANEL_PROGRAMA, detecta equipos que CRUZARON al estado "rojo" desde la
 * última corrida, y manda un email a los destinatarios configurados.
 *
 * Idempotencia: si un equipo sigue en rojo en corridas sucesivas, NO se
 * re-notifica. Solo cuando vuelve a verde/amber por al menos 1 corrida y
 * vuelve a rojo, dispara una alerta nueva.
 *
 * Reset automático: si un equipo lleva más de RESET_DIAS sin ser visto,
 * se borra del snapshot — la próxima vez que aparezca rojo, alerta de nuevo
 * (esto cubre el caso de que el script no corra por mucho tiempo).
 *
 * Vive en el Sheet maestro de service:
 *   id: 1zB9q0e9kxRKe52-I0u5Dqg7PUSE_nlxi3IYn7pxF0Iw
 *
 * Funciones expuestas desde el menú INGECOV:
 *   - chequearAlertasService()    Corrida normal (la que dispara el trigger).
 *   - probarAlertaService()       Manda email con el estado actual sin actualizar
 *                                  el snapshot (útil para verificar plantilla).
 *   - resetSnapshotService()      Limpia el snapshot. Después de esto, todos
 *                                  los equipos en rojo van a aparecer como
 *                                  "nuevos" en la próxima corrida.
 *   - estadoSnapshotService()     Loguea el snapshot actual para debug.
 *
 * Setup:
 *   1) Abrir el Sheet maestro de service → Extensiones → Apps Script.
 *   2) Pegar este archivo. Guardar.
 *   3) Editar las constantes DESTINATARIOS al inicio si hace falta.
 *   4) Ejecutar `chequearAlertasService` una vez desde el editor → autorizar
 *      permisos (acceso al Sheet + envío de mail desde tu cuenta).
 *   5) Triggers (reloj a la izquierda) → Agregar trigger:
 *      - Función: chequearAlertasService
 *      - Fuente: temporizada
 *      - Tipo: "Día" → "Entre las 8 a.m. y las 9 a.m." (o el horario que prefieras).
 *   6) Listo. Cada mañana revisa el panel y manda mail si hay nuevos críticos.
 */

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ CONFIGURACIÓN                                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

var DESTINATARIOS = [
  'marcoskatz@grupoingeco.com.ar',
  'nicobdallagata@gmail.com'
];

var PANEL_URL = 'https://marcoskatz-cmd.github.io/ingecov/';

var PANEL_SHEET_NAME = 'PANEL_PROGRAMA';

// Días sin ver al equipo en el panel para resetear su entrada en el snapshot.
// Si un equipo no aparece en 30 días, lo olvidamos (probablemente lo sacaron del parque).
var RESET_DIAS = 30;

// Defaults para umbrales (mismos que el HTML usa cuando faltan los del equipo)
var DEFAULT_RANGO_CRITICA = 50;
var DEFAULT_RANGO_INTERMEDIA = 150;

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ MENU EN EL SHEET                                                     ║
// ╚══════════════════════════════════════════════════════════════════════╝

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('INGECOV')
    .addItem('Chequear alertas service', 'chequearAlertasService')
    .addItem('Probar alerta (sin actualizar snapshot)', 'probarAlertaService')
    .addSeparator()
    .addItem('Ver snapshot actual', 'estadoSnapshotService')
    .addItem('Resetear snapshot', 'resetSnapshotService')
    .addToUi();
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ NÚCLEO                                                               ║
// ╚══════════════════════════════════════════════════════════════════════╝

function chequearAlertasService() {
  var rows = leerPanelPrograma_();
  if (!rows.length) {
    Logger.log('PANEL_PROGRAMA vacío o no encontrado. Nada que chequear.');
    return;
  }

  var snapshot = leerSnapshot_();
  var hoy = new Date().toISOString().slice(0, 10);
  var nuevosCriticos = [];
  var aunCriticos = [];
  var vistos = {};

  for (var i = 0; i < rows.length; i++) {
    var sp = rows[i];
    var codN = normCod_(sp.codigo);
    if (!codN) continue;
    vistos[codN] = true;

    var clasif = clasificarServicio_(sp);
    var anterior = snapshot[codN] || {};

    // Snapshot actualizado: clasificación + fecha de última vez visto
    snapshot[codN] = {
      clasif: clasif,
      lastSeen: hoy,
      desde: anterior.clasif === clasif ? (anterior.desde || hoy) : hoy
    };

    if (clasif === 'red') {
      // ¿Era rojo en la corrida anterior?
      if (anterior.clasif === 'red') {
        aunCriticos.push(sp); // sigue rojo, no notifica
      } else {
        nuevosCriticos.push(sp); // recién cruzó a rojo
      }
    }
  }

  // Limpieza: borrar entradas que no se vieron hoy y que llevan más de RESET_DIAS sin verse
  var corte = new Date();
  corte.setDate(corte.getDate() - RESET_DIAS);
  var corteStr = corte.toISOString().slice(0, 10);
  for (var k in snapshot) {
    if (!vistos[k] && snapshot[k].lastSeen < corteStr) delete snapshot[k];
  }

  guardarSnapshot_(snapshot);

  Logger.log('Total críticos: %s (nuevos: %s, ya notificados: %s)',
    nuevosCriticos.length + aunCriticos.length,
    nuevosCriticos.length,
    aunCriticos.length);

  if (nuevosCriticos.length) {
    enviarEmail_(nuevosCriticos, aunCriticos);
  }
}

function probarAlertaService() {
  var rows = leerPanelPrograma_();
  var todosCriticos = rows.filter(function(sp) {
    return clasificarServicio_(sp) === 'red';
  });
  if (!todosCriticos.length) {
    SpreadsheetApp.getUi().alert('No hay equipos en service crítico actualmente.');
    return;
  }
  enviarEmail_(todosCriticos, [], true);
  SpreadsheetApp.getUi().alert(
    'Email de prueba enviado a: ' + DESTINATARIOS.join(', ') +
    '\n\nLista: ' + todosCriticos.length + ' equipo(s) en rojo.'
  );
}

function resetSnapshotService() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert(
    'Resetear snapshot',
    'Después de esto, todos los equipos en service crítico van a aparecer como ' +
    '"nuevos" en la próxima corrida y disparar un email. ¿Continuar?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().deleteProperty('snapshot');
  ui.alert('Snapshot reseteado.');
}

function estadoSnapshotService() {
  var snapshot = leerSnapshot_();
  var n = Object.keys(snapshot).length;
  Logger.log('Snapshot tiene %s entradas:', n);
  for (var k in snapshot) Logger.log('  %s → %s (desde %s, last %s)',
    k, snapshot[k].clasif, snapshot[k].desde, snapshot[k].lastSeen);
  SpreadsheetApp.getUi().alert('Snapshot tiene ' + n +
    ' entradas. Mirá Ver → Registros (Apps Script editor) para detalle.');
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ DATA                                                                 ║
// ╚══════════════════════════════════════════════════════════════════════╝

function leerPanelPrograma_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(PANEL_SHEET_NAME);
  if (!sh) throw new Error('Pestaña ' + PANEL_SHEET_NAME + ' no encontrada en este Sheet.');
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function(h) { return normHead_(h); });

  // Mapeo de sinónimos (espejo del HTML)
  var SIN = {
    codigo:          ['CODIGO','COD'],
    descripcion:     ['DESCRIPCION','DESCRIPCIÓN','EQUIPO'],
    patente:         ['PATENTE','N SERIE N PATENTE','N° SERIE N° PATENTE'],
    estFecha:        ['EST FECHA','FECHA ESTIMADA','PROXIMO FECHA'],
    estHrKm:         ['EST HRKM','EST HR KM','HRKM ESTIMADO','PROXIMO HRKM'],
    ultFecha:        ['ULT FECHA','ULTIMA FECHA','FECHA ULTIMO'],
    ultHrKm:         ['ULT HRKM','ULT HR KM','HRKM ULTIMO','HRKM ACTUAL'],
    operatividad:    ['OPERATIVIDAD','OPERATIVO'],
    frecuencia:      ['FRECUENCIA','FREC'],
    rangoCritica:    ['RANGO CRITICA','CRITICA','CRÍTICA','RANGO ROJO'],
    rangoIntermedia: ['RANGO INTERMEDIA','INTERMEDIA','RANGO AMARILLO']
  };

  var colIdx = {};
  for (var k in SIN) {
    for (var i = 0; i < SIN[k].length; i++) {
      var pos = headers.indexOf(SIN[k][i]);
      if (pos >= 0) { colIdx[k] = pos; break; }
    }
  }
  if (colIdx.codigo == null) throw new Error('No se encontró la columna CODIGO en PANEL_PROGRAMA.');

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var rec = {};
    for (var k in colIdx) rec[k] = String(row[colIdx[k]] || '').trim();
    if (rec.codigo) out.push(rec);
  }
  return out;
}

function leerSnapshot_() {
  var raw = PropertiesService.getScriptProperties().getProperty('snapshot');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}
function guardarSnapshot_(snapshot) {
  PropertiesService.getScriptProperties().setProperty('snapshot', JSON.stringify(snapshot));
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ CLASIFICACIÓN (espejo del HTML)                                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

function clasificarServicio_(sp) {
  var est = num_(sp.estHrKm);
  var hr = num_(sp.ultHrKm);
  if (est == null || hr == null) return 'gray';
  var restantes = est - hr;
  if (restantes <= 0) return 'red';
  var rCrit = num_(sp.rangoCritica);
  if (rCrit == null) rCrit = DEFAULT_RANGO_CRITICA;
  var rInt = num_(sp.rangoIntermedia);
  if (rInt == null) rInt = DEFAULT_RANGO_INTERMEDIA;
  if (restantes <= rCrit) return 'red';
  if (restantes <= rInt) return 'amber';
  return 'green';
}

function num_(v) {
  if (v == null) return null;
  var s = String(v).replace(/[^\d.,-]/g, '').replace(',', '.');
  var n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function normHead_(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}
function normCod_(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ EMAIL                                                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

function enviarEmail_(nuevos, otros, esPrueba) {
  var subject = (esPrueba ? '[PRUEBA] ' : '') +
    '[INGECOV] ' + nuevos.length + ' equipo(s) cruzó(aron) a service crítico';
  var html = construirHtml_(nuevos, otros, esPrueba);
  var plain = construirTexto_(nuevos, otros, esPrueba);

  MailApp.sendEmail({
    to: DESTINATARIOS.join(','),
    subject: subject,
    body: plain,
    htmlBody: html,
    name: 'Panel INGECOV'
  });
}

function construirHtml_(nuevos, otros, esPrueba) {
  function filaEquipo(sp, esNuevo) {
    var est = num_(sp.estHrKm), hr = num_(sp.ultHrKm);
    var restantes = (est != null && hr != null) ? (est - hr) : null;
    var restTxt = restantes == null ? '—'
      : restantes >= 0 ? ('faltan ' + formatNum_(restantes))
      : ('VENCIDO ' + formatNum_(Math.abs(restantes)));
    var color = esNuevo ? '#b91c1c' : '#92520a';
    return '' +
      '<tr style="border-bottom:1px solid #e0e0e0">' +
      '<td style="padding:10px 12px;font-family:monospace;font-weight:600;color:#0f1318;width:90px">' + esc_(sp.codigo) + '</td>' +
      '<td style="padding:10px 12px;color:#0f1318">' + esc_(sp.descripcion || '—') +
        (sp.patente ? '<br><span style="font-size:11px;color:#888;font-family:monospace">' + esc_(sp.patente) + '</span>' : '') +
      '</td>' +
      '<td style="padding:10px 12px;font-family:monospace;font-size:13px;color:#444">' +
        (sp.ultHrKm || '—') +
        (sp.ultFecha ? '<br><span style="font-size:10px;color:#888">' + esc_(sp.ultFecha) + '</span>' : '') +
      '</td>' +
      '<td style="padding:10px 12px;font-family:monospace;font-size:13px;color:#444">' + (sp.estHrKm || '—') + '</td>' +
      '<td style="padding:10px 12px;font-family:monospace;font-size:12px;font-weight:600;color:' + color + ';text-align:right">' +
        esc_(restTxt) +
      '</td>' +
      '</tr>';
  }

  var rows1 = nuevos.map(function(sp) { return filaEquipo(sp, true); }).join('');
  var rows2 = otros.map(function(sp) { return filaEquipo(sp, false); }).join('');

  return '' +
    '<div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:20px;color:#0f1318">' +
      (esPrueba ? '<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:10px 14px;margin-bottom:18px;font-size:13px">⚠ Este es un email de PRUEBA — no representa cambios reales en el snapshot.</div>' : '') +
      '<h2 style="margin:0 0 6px;font-size:18px;color:#b91c1c">🔧 Service crítico en flota INGECOV</h2>' +
      '<p style="margin:0 0 18px;color:#666;font-size:13px">' +
        nuevos.length + ' equipo(s) cruzaron a estado crítico desde la última revisión.' +
        (otros.length ? ' (' + otros.length + ' siguen en crítico — ya fueron notificados anteriormente.)' : '') +
      '</p>' +
      (nuevos.length ?
        '<h3 style="font-size:14px;color:#b91c1c;margin:20px 0 8px">🚨 Nuevos críticos</h3>' +
        '<table style="border-collapse:collapse;width:100%;font-size:13px;border:1px solid #d0d0d0">' +
        '<thead><tr style="background:#fafafa">' +
          '<th style="padding:8px 12px;text-align:left;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.06em">Código</th>' +
          '<th style="padding:8px 12px;text-align:left;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.06em">Equipo</th>' +
          '<th style="padding:8px 12px;text-align:left;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.06em">Última hr/km</th>' +
          '<th style="padding:8px 12px;text-align:left;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.06em">Próximo service</th>' +
          '<th style="padding:8px 12px;text-align:right;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.06em">Restantes</th>' +
        '</tr></thead><tbody>' + rows1 + '</tbody></table>'
        : '') +
      (otros.length ?
        '<h3 style="font-size:14px;color:#92520a;margin:22px 0 8px">📌 Siguen en crítico</h3>' +
        '<table style="border-collapse:collapse;width:100%;font-size:13px;border:1px solid #d0d0d0">' +
        '<tbody>' + rows2 + '</tbody></table>'
        : '') +
      '<p style="margin:24px 0 0;font-size:12px;color:#888">' +
        '<a href="' + PANEL_URL + '" style="color:#2a48a5">Abrir panel completo →</a>' +
      '</p>' +
      '<hr style="border:none;border-top:1px solid #eee;margin:20px 0">' +
      '<p style="margin:0;font-size:11px;color:#aaa">Generado automáticamente por el script de alertas del Sheet PANEL_PROGRAMA. Para dejar de recibirlo, ajustá DESTINATARIOS en el script o pausá el trigger desde el editor de Apps Script.</p>' +
    '</div>';
}

function construirTexto_(nuevos, otros, esPrueba) {
  function lineaEquipo(sp) {
    var est = num_(sp.estHrKm), hr = num_(sp.ultHrKm);
    var restantes = (est != null && hr != null) ? (est - hr) : null;
    var restTxt = restantes == null ? '—'
      : restantes >= 0 ? ('faltan ' + formatNum_(restantes))
      : ('VENCIDO ' + formatNum_(Math.abs(restantes)));
    return '  - ' + (sp.codigo || '?') + '  ' + (sp.descripcion || '—') +
      '\n      Última: ' + (sp.ultHrKm || '—') + ' (' + (sp.ultFecha || '?') + ')' +
      '   Próx: ' + (sp.estHrKm || '—') + '   → ' + restTxt;
  }
  var out = (esPrueba ? '[PRUEBA] ' : '') +
    'INGECOV · ' + nuevos.length + ' nuevo(s) equipo(s) en service crítico.\n\n';
  if (nuevos.length) {
    out += 'NUEVOS:\n' + nuevos.map(lineaEquipo).join('\n') + '\n';
  }
  if (otros.length) {
    out += '\nSIGUEN EN CRÍTICO (ya notificados):\n' + otros.map(lineaEquipo).join('\n') + '\n';
  }
  out += '\nPanel: ' + PANEL_URL + '\n';
  return out;
}

function esc_(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function formatNum_(n) {
  return Math.round(n).toLocaleString('es-AR');
}

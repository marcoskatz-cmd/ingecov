/**
 * INGECOV · Alertas por email de service crítico
 * ---------------------------------------------------------------------------
 * Lee PANEL_PROGRAMA y cruza con la planilla de combustible para determinar
 * el horómetro/odómetro REAL más actualizado de cada equipo (el form de
 * combustible se llena mucho más seguido que las planillas de service, así
 * que casi siempre tiene la lectura más fresca). Si la última carga de
 * combustible es más reciente que el ULT_FECHA del service, usa ESA hr/km
 * para clasificar — exactamente como hace el panel HTML.
 *
 * Detecta equipos que CRUZARON al estado "rojo" desde la última corrida y
 * manda email a los destinatarios configurados en la pestaña CONFIG_ALERTAS.
 *
 * Idempotencia: si un equipo sigue en rojo en corridas sucesivas, NO se
 * re-notifica. Solo cuando vuelve a verde/amber por al menos 1 corrida y
 * vuelve a rojo, dispara una alerta nueva.
 *
 * Reset automático: si un equipo lleva más de RESET_DIAS sin ser visto en
 * el panel, se borra del snapshot.
 *
 * Vive en el Sheet maestro de service:
 *   id: 1zB9q0e9kxRKe52-I0u5Dqg7PUSE_nlxi3IYn7pxF0Iw
 *
 * Funciones expuestas desde el menú INGECOV:
 *   - chequearAlertasService()    Corrida normal (la que dispara el trigger).
 *   - probarAlertaService()       Manda email con TODOS los críticos actuales
 *                                  sin actualizar el snapshot.
 *   - resetSnapshotService()      Limpia el snapshot.
 *   - estadoSnapshotService()     Loguea el snapshot actual para debug.
 *   - editarDestinatarios()       Abre la pestaña CONFIG_ALERTAS y posiciona
 *                                  el cursor en la celda de emails.
 *
 * Setup: ver apps-scripts/README.md
 */

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ CONFIGURACIÓN — solo cambia si sabés qué hacés.                      ║
// ║ Los DESTINATARIOS y otros parámetros editables se guardan en la      ║
// ║ pestaña CONFIG_ALERTAS del Sheet — NO acá.                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

// Defaults usados solo la primera vez que se crea la pestaña CONFIG_ALERTAS.
// Después, lo que está en la pestaña manda.
var DEFAULT_DESTINATARIOS = 'marcoskatz@grupoingeco.com.ar, nicobdallagata@gmail.com';
var DEFAULT_PANEL_URL     = 'https://marcoskatz-cmd.github.io/ingecov/';

var PANEL_SHEET_NAME = 'PANEL_PROGRAMA';
var CONFIG_SHEET_NAME = 'CONFIG_ALERTAS';

// ID y pestaña del Sheet de combustible — lo cruzamos para sacar la hr/km
// más fresca de cada equipo. Si cambia, actualizar acá.
var COMBUSTIBLE_SHEET_ID   = '19dqJ-tcdmXiOns99mJgMMmZNDT3kKS7EQXwHd7VDILc';
var COMBUSTIBLE_SHEET_NAME = 'ENTREGA DE COMBUSTIBLE';

// Días sin ver al equipo en el panel para resetear su entrada en el snapshot.
var RESET_DIAS = 30;

// Defaults para umbrales (mismos que el HTML cuando faltan en el panel)
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
    .addItem('Editar destinatarios (CONFIG_ALERTAS)', 'editarDestinatarios')
    .addItem('Ver snapshot actual', 'estadoSnapshotService')
    .addItem('Resetear snapshot', 'resetSnapshotService')
    .addToUi();
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ CONFIG · pestaña editable en el Sheet                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

function asegurarConfigSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (sh) return sh;

  // No existe: la creamos con defaults
  sh = ss.insertSheet(CONFIG_SHEET_NAME);
  sh.getRange('A1:B1').setValues([['Parámetro', 'Valor']]).setFontWeight('bold').setBackground('#e8eaed');
  sh.getRange('A2').setValue('Destinatarios (separados por coma)');
  sh.getRange('B2').setValue(DEFAULT_DESTINATARIOS);
  sh.getRange('A3').setValue('URL del panel');
  sh.getRange('B3').setValue(DEFAULT_PANEL_URL);
  sh.getRange('A4').setValue('Activado (TRUE/FALSE)');
  sh.getRange('B4').setValue('TRUE');
  sh.getRange('A6').setValue('— Notas —');
  sh.getRange('A6').setFontWeight('bold').setFontStyle('italic');
  sh.getRange('A7').setValue('• Destinatarios: separá emails con coma. Ejemplo: a@b.com, c@d.com');
  sh.getRange('A8').setValue('• Si Activado = FALSE, el trigger sigue corriendo pero NO manda mail.');
  sh.getRange('A9').setValue('• Cambios toman efecto en la PRÓXIMA corrida (no hace falta volver al script).');
  sh.setColumnWidth(1, 280);
  sh.setColumnWidth(2, 380);
  return sh;
}

function leerConfig_() {
  var sh = asegurarConfigSheet_();
  var rows = sh.getRange('A2:B4').getValues();
  var cfg = {};
  for (var i = 0; i < rows.length; i++) {
    var k = String(rows[i][0] || '').toLowerCase();
    var v = String(rows[i][1] || '').trim();
    if (k.indexOf('destinatarios') >= 0) cfg.destinatarios = v;
    else if (k.indexOf('url') >= 0)      cfg.panelUrl = v;
    else if (k.indexOf('activado') >= 0) cfg.activado = /^true$/i.test(v) || /^si$|^sí$/i.test(v) || v === '1';
  }
  // Parsear destinatarios → array
  cfg.destinatariosArr = (cfg.destinatarios || DEFAULT_DESTINATARIOS)
    .split(/[,;]+/)
    .map(function(s) { return s.trim(); })
    .filter(function(s) { return s && s.indexOf('@') > 0; });
  cfg.panelUrl = cfg.panelUrl || DEFAULT_PANEL_URL;
  if (cfg.activado == null) cfg.activado = true;
  return cfg;
}

function editarDestinatarios() {
  var sh = asegurarConfigSheet_();
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sh);
  sh.setActiveRange(sh.getRange('B2'));
  SpreadsheetApp.getUi().alert(
    'Editar destinatarios',
    'Estás en la celda B2 de CONFIG_ALERTAS.\n\n' +
    'Pegá los emails separados por coma. Ejemplo:\n' +
    '   marcoskatz@grupoingeco.com.ar, nicobdallagata@gmail.com\n\n' +
    'Los cambios toman efecto en la próxima corrida.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ NÚCLEO                                                               ║
// ╚══════════════════════════════════════════════════════════════════════╝

function chequearAlertasService() {
  var cfg = leerConfig_();
  if (!cfg.activado) { Logger.log('Alertas desactivadas en CONFIG_ALERTAS. Saliendo.'); return; }
  if (!cfg.destinatariosArr.length) { Logger.log('Sin destinatarios en CONFIG_ALERTAS. Saliendo.'); return; }

  var rows = leerPanelPrograma_();
  if (!rows.length) {
    Logger.log('PANEL_PROGRAMA vacío o no encontrado. Nada que chequear.');
    return;
  }

  // Cruzamos con combustible para obtener la hr/km más fresca por equipo.
  var ultCombPorEquipo = leerUltimaCombustiblePorEquipo_();

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

    // ── Determinar hr/km actual: combustible si es más reciente que service ──
    var ultServiceTs = parseFechaTs_(sp.ultFecha);
    var ultComb = ultCombPorEquipo[codN]; // {hr, fechaTs, fechaStr} | undefined
    var hrActual, hrFuente, hrFechaStr;
    if (ultComb && ultComb.hr != null && (ultComb.fechaTs || 0) > (ultServiceTs || 0)) {
      hrActual = ultComb.hr;
      hrFuente = 'combustible';
      hrFechaStr = ultComb.fechaStr;
    } else {
      hrActual = num_(sp.ultHrKm);
      hrFuente = 'service';
      hrFechaStr = sp.ultFecha || '';
    }

    var clasif = clasificarServicio_(sp, hrActual);
    var anterior = snapshot[codN] || {};

    snapshot[codN] = {
      clasif: clasif,
      lastSeen: hoy,
      desde: anterior.clasif === clasif ? (anterior.desde || hoy) : hoy
    };

    if (clasif === 'red') {
      // Anotamos en el objeto los datos derivados, para usar en el email
      sp._hrActual = hrActual;
      sp._hrFuente = hrFuente;
      sp._hrFechaStr = hrFechaStr;
      if (anterior.clasif === 'red') aunCriticos.push(sp);
      else                            nuevosCriticos.push(sp);
    }
  }

  // Limpieza de equipos no vistos hace mucho
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
    enviarEmail_(cfg, nuevosCriticos, aunCriticos, false);
  }
}

function probarAlertaService() {
  var cfg = leerConfig_();
  if (!cfg.destinatariosArr.length) {
    SpreadsheetApp.getUi().alert('Sin destinatarios configurados. Ejecutá "Editar destinatarios" primero.');
    return;
  }
  var rows = leerPanelPrograma_();
  var ultCombPorEquipo = leerUltimaCombustiblePorEquipo_();
  var todosCriticos = [];
  for (var i = 0; i < rows.length; i++) {
    var sp = rows[i];
    var codN = normCod_(sp.codigo);
    if (!codN) continue;
    var ultServiceTs = parseFechaTs_(sp.ultFecha);
    var ultComb = ultCombPorEquipo[codN];
    var hrActual, hrFuente, hrFechaStr;
    if (ultComb && ultComb.hr != null && (ultComb.fechaTs || 0) > (ultServiceTs || 0)) {
      hrActual = ultComb.hr;
      hrFuente = 'combustible';
      hrFechaStr = ultComb.fechaStr;
    } else {
      hrActual = num_(sp.ultHrKm);
      hrFuente = 'service';
      hrFechaStr = sp.ultFecha || '';
    }
    if (clasificarServicio_(sp, hrActual) === 'red') {
      sp._hrActual = hrActual; sp._hrFuente = hrFuente; sp._hrFechaStr = hrFechaStr;
      todosCriticos.push(sp);
    }
  }
  if (!todosCriticos.length) {
    SpreadsheetApp.getUi().alert('No hay equipos en service crítico (cruzado con combustible).');
    return;
  }
  enviarEmail_(cfg, todosCriticos, [], true);
  SpreadsheetApp.getUi().alert(
    'Email de prueba enviado a:\n' + cfg.destinatariosArr.join(', ') +
    '\n\n' + todosCriticos.length + ' equipo(s) en rojo.'
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
    ' entradas. Detalle en Apps Script → Ejecuciones → Registros.');
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ DATA · PANEL_PROGRAMA                                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

function leerPanelPrograma_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(PANEL_SHEET_NAME);
  if (!sh) throw new Error('Pestaña ' + PANEL_SHEET_NAME + ' no encontrada en este Sheet.');
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function(h) { return normHead_(h); });

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

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ DATA · COMBUSTIBLE — última hr/km funcional por equipo               ║
// ╚══════════════════════════════════════════════════════════════════════╝

function leerUltimaCombustiblePorEquipo_() {
  try {
    var ss = SpreadsheetApp.openById(COMBUSTIBLE_SHEET_ID);
    var sh = ss.getSheetByName(COMBUSTIBLE_SHEET_NAME);
    if (!sh) {
      Logger.log('Combustible: pestaña ' + COMBUSTIBLE_SHEET_NAME + ' no encontrada. Skipping.');
      return {};
    }
    var values = sh.getDataRange().getValues();
    if (values.length < 2) return {};
    var headers = values[0].map(function(h) { return normHead_(h); });

    var SIN = {
      codigo:   ['CODIGO INTERNO DE EQUIPO NUMERO DE PATENTE DE EQUIPO',
                 'CODIGO INTERNO DE EQUIPO','CODIGO INTERNO','CODIGO EQUIPO','CODIGO'],
      fecha:    ['FECHA'],
      estado:   ['ESTADO DE HOROMETRO U ODOMETRO DE EQUIPO','ESTADO HOROMETRO','ESTADO ODOMETRO','ESTADO'],
      hr:       ['HOROMETRO U ODOMETRO ACTUAL DE EQUIPO HORAS MAQUINA O KILOMETROS',
                 'HOROMETRO U ODOMETRO ACTUAL DE EQUIPO','HOROMETRO U ODOMETRO ACTUAL',
                 'HOROMETRO ACTUAL','ODOMETRO ACTUAL']
    };

    var colIdx = {};
    for (var k in SIN) {
      for (var i = 0; i < SIN[k].length; i++) {
        var pos = headers.indexOf(SIN[k][i]);
        if (pos >= 0) { colIdx[k] = pos; break; }
      }
    }
    if (colIdx.codigo == null || colIdx.hr == null) {
      Logger.log('Combustible: faltan columnas clave (codigo/hr). Headers vistos: ' + headers.join('|'));
      return {};
    }

    var out = {};
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var codN = normCod_(row[colIdx.codigo]);
      if (!codN) continue;
      var estado = String(row[colIdx.estado] || '').toLowerCase();
      var hrFunc = estado.indexOf('sí') === 0 || estado.indexOf('si') === 0;
      var hrNum = num_(row[colIdx.hr]);
      if (!hrFunc || hrNum == null || hrNum <= 0) continue;

      var fechaRaw = row[colIdx.fecha];
      var fechaTs = parseFechaTs_(fechaRaw);
      var fechaStr = fechaRaw instanceof Date
        ? Utilities.formatDate(fechaRaw, Session.getScriptTimeZone(), 'dd/MM/yyyy')
        : String(fechaRaw || '');

      if (!out[codN] || (fechaTs || 0) > (out[codN].fechaTs || 0)) {
        out[codN] = { hr: hrNum, fechaTs: fechaTs, fechaStr: fechaStr };
      }
    }
    Logger.log('Combustible: leyó ' + Object.keys(out).length + ' equipos con última hr/km.');
    return out;
  } catch (e) {
    Logger.log('Combustible: error leyendo Sheet — ' + e.message);
    return {};
  }
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ SNAPSHOT                                                             ║
// ╚══════════════════════════════════════════════════════════════════════╝

function leerSnapshot_() {
  var raw = PropertiesService.getScriptProperties().getProperty('snapshot');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}
function guardarSnapshot_(snapshot) {
  PropertiesService.getScriptProperties().setProperty('snapshot', JSON.stringify(snapshot));
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ CLASIFICACIÓN — espejo exacto de clasificarServicio() del HTML       ║
// ╚══════════════════════════════════════════════════════════════════════╝

// hrActualParam = hr/km derivado del cruce con combustible (o ULT_HRKM del
// panel si no hay carga más reciente). Es lo que decide rojo/amber/verde.
function clasificarServicio_(sp, hrActualParam) {
  var est = num_(sp.estHrKm);
  var hr  = hrActualParam != null ? hrActualParam : num_(sp.ultHrKm);
  if (est == null || hr == null) return 'gray';
  var restantes = est - hr;
  if (restantes <= 0) return 'red';
  var rCrit = num_(sp.rangoCritica); if (rCrit == null) rCrit = DEFAULT_RANGO_CRITICA;
  var rInt  = num_(sp.rangoIntermedia); if (rInt == null) rInt = DEFAULT_RANGO_INTERMEDIA;
  if (restantes <= rCrit) return 'red';
  if (restantes <= rInt)  return 'amber';
  return 'green';
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ HELPERS                                                              ║
// ╚══════════════════════════════════════════════════════════════════════╝

function num_(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = String(v).replace(/[^\d.,-]/g, '').replace(',', '.');
  var n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function parseFechaTs_(v) {
  if (v == null || v === '') return 0;
  if (v instanceof Date) return v.getTime();
  // Intentamos dd/mm/yyyy
  var s = String(v).trim();
  var m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    var d = +m[1], mo = +m[2] - 1, y = +m[3];
    if (y < 100) y += 2000;
    var dt = new Date(y, mo, d);
    return isFinite(dt.getTime()) ? dt.getTime() : 0;
  }
  var dt2 = new Date(s);
  return isFinite(dt2.getTime()) ? dt2.getTime() : 0;
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

function enviarEmail_(cfg, nuevos, otros, esPrueba) {
  var subject = (esPrueba ? '[PRUEBA] ' : '') +
    '[INGECOV] ' + nuevos.length + ' equipo(s) en service crítico';
  var html  = construirHtml_(cfg, nuevos, otros, esPrueba);
  var plain = construirTexto_(cfg, nuevos, otros, esPrueba);

  MailApp.sendEmail({
    to: cfg.destinatariosArr.join(','),
    subject: subject,
    body: plain,
    htmlBody: html,
    name: 'Panel INGECOV'
  });
}

function construirHtml_(cfg, nuevos, otros, esPrueba) {
  function filaEquipo(sp, esNuevo) {
    var est = num_(sp.estHrKm);
    var hr  = sp._hrActual != null ? sp._hrActual : num_(sp.ultHrKm);
    var restantes = (est != null && hr != null) ? (est - hr) : null;
    var restTxt = restantes == null ? '—'
      : restantes >= 0 ? ('faltan ' + formatNum_(restantes))
      : ('VENCIDO ' + formatNum_(Math.abs(restantes)));
    var color = esNuevo ? '#b91c1c' : '#92520a';
    var fuenteTag = sp._hrFuente === 'combustible'
      ? '<span style="font-size:9px;background:#fbeed0;color:#92520a;padding:1px 6px;margin-left:6px;letter-spacing:.04em">vía combustible</span>'
      : '';
    return '' +
      '<tr style="border-bottom:1px solid #e0e0e0">' +
      '<td style="padding:10px 12px;font-family:monospace;font-weight:600;color:#0f1318;width:90px">' + esc_(sp.codigo) + '</td>' +
      '<td style="padding:10px 12px;color:#0f1318">' + esc_(sp.descripcion || '—') +
        (sp.patente ? '<br><span style="font-size:11px;color:#888;font-family:monospace">' + esc_(sp.patente) + '</span>' : '') +
      '</td>' +
      '<td style="padding:10px 12px;font-family:monospace;font-size:13px;color:#444">' +
        (hr != null ? formatNum_(hr) : '—') + fuenteTag +
        (sp._hrFechaStr ? '<br><span style="font-size:10px;color:#888">' + esc_(sp._hrFechaStr) + '</span>' : '') +
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
          '<th style="padding:8px 12px;text-align:left;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.06em">Próximo</th>' +
          '<th style="padding:8px 12px;text-align:right;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.06em">Restantes</th>' +
        '</tr></thead><tbody>' + rows1 + '</tbody></table>'
        : '') +
      (otros.length ?
        '<h3 style="font-size:14px;color:#92520a;margin:22px 0 8px">📌 Siguen en crítico</h3>' +
        '<table style="border-collapse:collapse;width:100%;font-size:13px;border:1px solid #d0d0d0">' +
        '<tbody>' + rows2 + '</tbody></table>'
        : '') +
      '<p style="margin:24px 0 0;font-size:12px;color:#888">' +
        '<a href="' + cfg.panelUrl + '" style="color:#2a48a5">Abrir panel completo →</a>' +
      '</p>' +
      '<hr style="border:none;border-top:1px solid #eee;margin:20px 0">' +
      '<p style="margin:0;font-size:11px;color:#aaa">Generado automáticamente. Para cambiar destinatarios o desactivar las alertas, editá la pestaña CONFIG_ALERTAS del Sheet de service.</p>' +
    '</div>';
}

function construirTexto_(cfg, nuevos, otros, esPrueba) {
  function linea(sp) {
    var est = num_(sp.estHrKm);
    var hr  = sp._hrActual != null ? sp._hrActual : num_(sp.ultHrKm);
    var restantes = (est != null && hr != null) ? (est - hr) : null;
    var restTxt = restantes == null ? '—'
      : restantes >= 0 ? ('faltan ' + formatNum_(restantes))
      : ('VENCIDO ' + formatNum_(Math.abs(restantes)));
    var fuente = sp._hrFuente === 'combustible' ? ' [vía combustible]' : '';
    return '  - ' + (sp.codigo || '?') + '  ' + (sp.descripcion || '—') +
      '\n      Última hr: ' + (hr != null ? formatNum_(hr) : '—') + fuente + ' (' + (sp._hrFechaStr || '?') + ')' +
      '   Próx: ' + (sp.estHrKm || '—') + '   → ' + restTxt;
  }
  var out = (esPrueba ? '[PRUEBA] ' : '') +
    'INGECOV · ' + nuevos.length + ' nuevo(s) equipo(s) en service crítico.\n\n';
  if (nuevos.length) {
    out += 'NUEVOS:\n' + nuevos.map(linea).join('\n') + '\n';
  }
  if (otros.length) {
    out += '\nSIGUEN EN CRÍTICO (ya notificados):\n' + otros.map(linea).join('\n') + '\n';
  }
  out += '\nPanel: ' + cfg.panelUrl + '\n';
  return out;
}

function esc_(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function formatNum_(n) {
  return Math.round(n).toLocaleString('es-AR');
}

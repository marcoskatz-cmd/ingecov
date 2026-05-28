/**
 * INGECO Panel API — Configuración
 * ----------------------------------------------------------------------------
 * Proyecto Apps Script standalone que sirve los datos del panel a través de
 * un Web App con whitelist por email. Reemplaza la lectura directa de gviz
 * desde el navegador.
 *
 * Los IDs de Sheets están hardcoded acá (no son secreto: si alguien tiene
 * acceso a este código, ya tiene acceso al proyecto). Las cosas que CAMBIAN
 * (whitelist de emails, IDs del mirror de combustible livianos) viven en
 * Script Properties para poder editarse sin redeploy.
 */

// Sheets nativos que el Apps Script lee con openById.
// CÓDIGOS DE EQUIPOS y COMBUSTIBLE LIVIANOS son .xlsx externos; su ID original
// vive en Script Properties (XLSX_*) y un trigger los espeja a pestañas
// nativas dentro del Sheet identificado por MIRROR_SHEET_ID.
const SHEET_IDS = {
  pedidos:             '1VFJwFLLEaOE9tTuwah7QkaDTrYkeYtOH8brUgSyHeFY',
  indicadores:         '1GpP2ejMVXncr2OLmKK_IP-zqr5AARi1Q3YdQIPlsUUE',
  // codigos eliminado de acá: se lee del mirror (pestañas en MIRROR_SHEET_ID
  // mantenidas por syncCodigosEquipos, que copia el .xlsx XLSX_CODIGOS_EQUIPOS_ID).
  repuestos_hist:      '1TUEoOul4SI5O323LcMq2VkaxdcTMfTmZce7NToGESfc',
  trabajos_reg:        '1cNWQ44UEDiotHyB65BfTMcFuOCfQXYQoSNNAdAKTsy8',
  service:             '1zB9q0e9kxRKe52-I0u5Dqg7PUSE_nlxi3IYn7pxF0Iw',
  combustible:         '19dqJ-tcdmXiOns99mJgMMmZNDT3kKS7EQXwHd7VDILc',
  programaService:     '1y6pqbXscej3139lkImWJsJHeJvFa0B5sneICEyyNPmI',
};

// Pestañas esperadas en el .xlsx de CÓDIGOS DE EQUIPOS (= nombres de categoría
// que usa el panel). El sync espera estos nombres EXACTOS; si la persona que
// mantiene el .xlsx renombra una pestaña, hay que actualizar acá.
const CODIGOS_TABS = [
  'VIALES, ASFALTO Y TRITURACIÓN',
  'TRANSPORTE LIVIANO',
  'TRANSPORTE PESADO',
  'SOPORTE',
];

// Nombres de pestañas (matchean lo que el panel HTML esperaba).
const SHEETS = {
  pedidos_pend:        'PENDIENTES',
  pedidos_entreg:      'ENTREGADOS',
  panel_repuestos:     'PANEL_REPUESTOS',
  panel_trabajos:      'PANEL_TRABAJOS',
  combustible:         'ENTREGA DE COMBUSTIBLE',
  combustible_mirror:  'COMBUSTIBLE_LIVIANOS_MIRROR',
  service_frec:        'FRECUENCIA - OPERATIVIDAD',
};

// Trimestre vigente del programa de service. Mantiene la lógica del HTML.
function getServiceTrimSheet() {
  return (new Date().getMonth() < 3) ? '1° TRIMESTRE' : '2° TRIMESTRE';
}

// Cache: 30 min por defecto, configurable desde Properties.
function getCacheTTL() {
  const v = PropertiesService.getScriptProperties().getProperty('CACHE_TTL_SECONDS');
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 1800;
}

// Wrapper sobre Script Properties con default + parseo.
function getProperty(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  return (v == null || v === '') ? fallback : v;
}

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

// Sheets que el panel consume. Estos IDs son los mismos que estaban en
// js/app.js antes del migrate a la API.
const SHEET_IDS = {
  pedidos:             '1VFJwFLLEaOE9tTuwah7QkaDTrYkeYtOH8brUgSyHeFY',
  indicadores:         '1GpP2ejMVXncr2OLmKK_IP-zqr5AARi1Q3YdQIPlsUUE',
  codigos:             '1I4ejRAoMnpou-cRvefgfVCzPg9Obkmi2',
  repuestos_hist:      '1TUEoOul4SI5O323LcMq2VkaxdcTMfTmZce7NToGESfc',
  trabajos_reg:        '1cNWQ44UEDiotHyB65BfTMcFuOCfQXYQoSNNAdAKTsy8',
  service:             '1zB9q0e9kxRKe52-I0u5Dqg7PUSE_nlxi3IYn7pxF0Iw',
  combustible:         '19dqJ-tcdmXiOns99mJgMMmZNDT3kKS7EQXwHd7VDILc',
  programaService:     '1y6pqbXscej3139lkImWJsJHeJvFa0B5sneICEyyNPmI',
  // combustibleLivianos NO va acá porque es un .xlsx — su ID y el del mirror
  // viven en Script Properties para que cualquier cambio sea sin redeploy.
};

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

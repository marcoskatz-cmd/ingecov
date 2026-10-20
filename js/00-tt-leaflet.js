/* Trusted Types: política "default" SOLO para las cadenas fijas que Leaflet
   asigna con innerHTML (chequeo de SVG al cargar, botones de zoom y el botón
   de cerrar popups). Cualquier otra cadena sigue bloqueada como siempre: la
   app usa la política 'ingecov-html' vía setHTML().
   Tiene que cargarse ANTES que leaflet.js (el chequeo de SVG corre al cargar). */
(function () {
  if (!window.trustedTypes || !window.trustedTypes.createPolicy) return;
  var PERMITIDAS = {
    '<svg/>': 1,
    '<v:shape adj="1"/>': 1,
    '<span aria-hidden="true">+</span>': 1,
    '<span aria-hidden="true">&#x2212;</span>': 1,
    '<span aria-hidden="true">&#215;</span>': 1,
    '': 1
  };
  try {
    window.trustedTypes.createPolicy('default', {
      createHTML: function (s) {
        if (PERMITIDAS[s]) return s;
        console.warn('[INGECO] Trusted Types: HTML no permitido bloqueado');
        return null;
      }
    });
  } catch (e) { /* ya existía */ }
})();

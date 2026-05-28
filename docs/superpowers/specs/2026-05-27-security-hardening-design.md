# Hardening de seguridad del panel INGECO

Fecha: 2026-05-27
Autor: Marcos Katz + Claude
Repo: github.com/marcoskatz-cmd/ingecov
HEAD al momento del diseño: `b4fa93f`

## Objetivo

Cerrar los vectores reales de XSS y supply-chain en el panel, sin reescribir lógica de negocio. El panel se sirve desde GitHub Pages (estático, sin HTTP headers) y se alimenta de Google Sheets via gviz sin autenticación.

**Lo que entra en este spec:** CSP estricta vía meta, Trusted Types, template helper escapado, migración de los 19 `innerHTML` y los 49 handlers `onclick` inline, self-host de fonts, error boundary global, frame-buster, fix de manifest.

**Lo que NO entra:** robustez de red (retries, timeouts, cache tope), refactor modular, tests automatizados, performance, lazy-load de Chart.js. Esos pueden venir en specs aparte si se decide.

## Restricciones del entorno

1. GitHub Pages no permite setear HTTP headers. Toda la CSP va en `<meta http-equiv="Content-Security-Policy">`.
2. Directivas no soportadas por meta CSP: `frame-ancestors`, `report-uri`, `report-to`, `sandbox`. Se mitigan con JS donde corresponde.
3. El panel se alimenta de Sheets compartidos como "cualquiera con link" — los IDs son públicos y conocidos. Esto está fuera de scope.

## Diseño

### 1. Content-Security-Policy via meta tag

```
default-src 'none';
script-src 'self' https://cdnjs.cloudflare.com;
style-src  'self' 'unsafe-inline';
font-src   'self';
img-src    'self' data:;
connect-src https://docs.google.com;
manifest-src 'self';
worker-src 'self';
base-uri 'self';
form-action 'none';
object-src 'none';
require-trusted-types-for 'script';
trusted-types ingecov-html;
```

**Decisiones:**
- `default-src 'none'`: deny-by-default. Cualquier recurso no listado se bloquea.
- `script-src` sin `'unsafe-inline'` ni `'unsafe-eval'`. El `<script>` inline del HTML es del mismo origen y CSP lo trata como tal cuando va sin `nonce` ni `'unsafe-inline'` — pero **a partir de CSP3 los scripts inline necesitan `'unsafe-inline'` o nonce/hash**. Como queremos evitar `'unsafe-inline'`, **mover el `<script>` inline a `js/app.js`** y referenciarlo como `<script src="./js/app.js" defer></script>`. Costo: bajo (es cortar/pegar). Beneficio: CSP estricta real.
- `style-src 'unsafe-inline'` se mantiene. Hay 161 atributos `style="..."` inline + el `<style>` block grande. Endurecerlo es otro design (no XSS-blocking si tenés Trusted Types).
- `connect-src` solo `docs.google.com`. Cualquier exfil intento a otro host muere.
- `require-trusted-types-for 'script'` + `trusted-types ingecov-html`: activa Trusted Types con una sola policy nombrada.

### 2. Self-host de fonts

Hoy: `fonts.googleapis.com/css2?family=IBM+Plex+Sans...` + `fonts.gstatic.com/...`.

Cambio: descargar IBM Plex Sans (400/500/600/700) y JetBrains Mono (400/500/600/700) subseteados a `latin`, guardar en `/fonts/`, generar `@font-face` en un `<style>` aparte (o en un `.css`).

Generador: google-webfonts-helper. Tamaño esperado: ~200 KB total.

Eliminados los preconnect/`<link>` a `fonts.googleapis.com` y `fonts.gstatic.com`.

### 3. Trusted Types policy + template helpers

```javascript
const TT = window.trustedTypes?.createPolicy('ingecov-html', {
  createHTML: s => s
});

class RawHTML { constructor(v){ this.value = v; } }

function esc(v) {
  if (v == null) return '';
  if (v instanceof RawHTML) return v.value;
  if (Array.isArray(v)) return v.map(esc).join('');
  return String(v).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function html(strings, ...values) {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) out += esc(values[i]);
  }
  return new RawHTML(out);
}

function setHTML(el, content) {
  const s = content instanceof RawHTML ? content.value : esc(content);
  el.innerHTML = TT ? TT.createHTML(s) : s;
}
```

**Garantías:**
- Cualquier valor interpolado en `html\`\`` queda escapado.
- `html\`\`` devuelve `RawHTML`, que se interpola sin re-escapar al anidar templates.
- `setHTML` envuelve siempre el output en `TrustedHTML` cuando TT está activo. Con CSP estricta, asignar un string raw a `innerHTML` lanza `TypeError` — la única forma de meter HTML es vía esta policy.

### 4. Migración de los 19 `innerHTML`

Sitios listados en líneas: 2997, 3061, 3066, 3119, 3152, 3343, 3489, 3605, 3606, 4076, 4143, 4272, 4292, 4367, 4373, 4399, 4556, 4558 (y un caso para `bar.innerHTML=...` en línea 2997).

Patrón:
```javascript
// antes
body.innerHTML = `<div>${codigo}</div>`;

// después
setHTML(body, html`<div>${codigo}</div>`);
```

Para construcciones con map+join, las funciones internas devuelven `html\`\`` (RawHTML) y se interpolan directo:
```javascript
setHTML(grid, html`<div class="g">${eq.map(e => html`<div>${e.nombre}</div>`)}</div>`);
```

### 5. Migración de los 49 handlers inline

Reemplazar todos los `onclick=`, `onchange=`, etc. inline con delegación de eventos:

```javascript
const ACTIONS = {
  loadAll:             ()    => loadAll(),
  toggleSection:       (id)  => toggleSection(id),
  toggleEquipoDetail:  (cod) => toggleEquipoDetail(cod),
  closeEquipoDetail:   ()    => closeEquipoDetail(),
  closeServiceCriticoModal: () => closeServiceCriticoModal(),
  setRange:            (r)   => setRange(r),
  setFiltro:           (f)   => setFiltro(f),
  // … completar al migrar
};

document.body.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  e.preventDefault();
  ACTIONS[t.dataset.action]?.(t.dataset.arg, t, e);
});
```

Para los handlers que tienen lógica inline más rica (ej. `onclick="if(event.target===this)closeServiceCriticoModal()"`), envolver esa lógica en una función con nombre dentro de `ACTIONS`.

Templates:
```html
<!-- antes -->
<button onclick="loadAll()">Reintentar</button>

<!-- después -->
<button data-action="loadAll">Reintentar</button>
```

```html
<!-- antes -->
<div onclick="toggleEquipoDetail('${codigo}')">

<!-- después -->
<div data-action="toggleEquipoDetail" data-arg="${codigo}">
```

### 6. Error boundary global

```javascript
window.addEventListener('error', (e) => {
  console.error('[INGECO] error:', e.error || e.message, e.filename + ':' + e.lineno);
  showErrorToast(e.error?.message || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[INGECO] promise rechazada:', e.reason);
  showErrorToast(String(e.reason?.message || e.reason));
});

function showErrorToast(msg) {
  // Toast fijo bottom-right, ~320px, autohide 8s.
  // Click → copia stack al portapapeles.
  // Múltiples errores se apilan; el N-ésimo desplaza al primero hacia arriba.
}
```

CSS del toast en `<style>` existente. Estilo mínimo, color `--red`.

### 7. Frame-buster

Al tope del script (antes de cualquier render):
```javascript
if (window.top !== window.self) {
  try { window.top.location = window.self.location; }
  catch { document.body.textContent = ''; }
}
```

Sustituye `frame-ancestors 'none'` que no se puede setear por meta.

### 8. Manifest.json

Agregar:
```json
{
  "id": "/ingecov/",
  "start_url": "/ingecov/",
  "scope": "/ingecov/"
}
```

Evita que el browser cree dos PWAs separadas (raíz vs subpath) al instalarse desde el subdomain de Pages.

## Plan de implementación

Dos commits, cada uno revertible solo.

**Commit 1 — refactor sin CSP:**
- Extraer `<script>` inline a `js/app.js`.
- Agregar helpers `esc`, `html`, `setHTML`, `RawHTML` + policy `ingecov-html` (defensivo, no-op sin CSP).
- Migrar los 19 `innerHTML` a `setHTML(..., html\`\`)`.
- Migrar los 49 `onclick` (y handlers similares) a `data-action` + delegación.
- Agregar `window.error` / `unhandledrejection` listeners + `showErrorToast`.
- Agregar frame-buster al inicio.
- Fix `manifest.json` (`id`, `start_url`, `scope`).
- **Verificar:** abrir en localhost (o file://), click sobre toda interacción mayor. UI idéntica.

**Commit 2 — CSP estricta + Trusted Types + self-host fonts:**
- Bajar fonts subseteadas a `/fonts/`, agregar `fonts/fonts.css` con `@font-face`.
- Eliminar `<link>` y `<link rel="preconnect">` de Google Fonts.
- Agregar `<meta http-equiv="Content-Security-Policy" content="...">`.
- Actualizar `sw.js`: agregar `./js/app.js` y `./fonts/fonts.css` a `SHELL_ASSETS`, bump `CACHE_VERSION` a `v2`.
- **Verificar:** F12 → Console: 0 violaciones CSP, 0 violaciones Trusted Types. Click sobre toda interacción mayor. Pegar `<img src=x onerror=alert(1)>` en una celda del Sheet de CÓDIGOS, refrescar el panel → debe verse como texto plano, sin alert.
- Si rompe algo: `git revert` de este commit deja el panel funcional con todo el hardening del commit 1 menos CSP/Trusted Types.

> Nota: en commit 1 también hay que actualizar `sw.js` para agregar `./js/app.js` al precache y bumpear `CACHE_VERSION` a `v2` cuando se extrae el script. Si se omite, los visitantes con SW antiguo siguen sirviendo `index.html` vieja del cache hasta que el SW se actualice.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Algún `onclick` tiene lógica compuesta no trivial | Re-escribir caso por caso en función con nombre en `ACTIONS`. Inventariar antes de migrar. |
| Trusted Types violación inesperada en código generado por terceros (Chart.js) | Chart.js v4 no usa `innerHTML`. Si aparece violación: bajar a `report-only` y refinar. |
| Si alguien embebe el panel en un iframe interno, el frame-buster lo rompe | Marcos confirmó: nadie embebe. Si cambia, eliminar buster o agregar allowlist. |
| Self-host de fonts: rendering levemente distinto si subset es incompleto | Usar subset `latin` (cubre español sin caracteres especiales). Verificar visualmente. |
| `style-src 'unsafe-inline'` no se endurece | Trade-off aceptado: ataque por style injection no ejecuta JS si script-src es estricto + Trusted Types. Endurecimiento opcional en spec futuro. |

## Verificación de aceptación

- Lighthouse → Best Practices: subir score (anotar antes/después).
- DevTools → Network: cero requests a `fonts.googleapis.com` / `fonts.gstatic.com`.
- DevTools → Console: cero errores CSP, cero violaciones de Trusted Types.
- Inyección manual de `<img src=x onerror=alert(1)>` en CÓDIGOS: se renderiza como texto plano.
- Test de funcionalidad: refresh, toggle de inactivos, drill-down de ranking, modal de service crítico, selector de mes en combustible.

## Archivos esperados después del cambio

```
ingecov/
├── index.html              ← <head> con CSP meta + <link> a fonts locales
├── js/
│   └── app.js              ← el <script> inline de hoy + helpers + listeners
├── fonts/
│   ├── ibm-plex-sans-*.woff2
│   ├── jetbrains-mono-*.woff2
│   └── fonts.css           ← @font-face rules
├── manifest.json           ← +id +start_url +scope
├── sw.js                   ← bump CACHE_VERSION para invalidar
└── …iconos sin cambios
```

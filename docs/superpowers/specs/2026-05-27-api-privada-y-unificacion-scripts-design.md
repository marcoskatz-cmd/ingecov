# API privada vía Apps Script Web App + unificación de scripts

Fecha: 2026-05-27
Autor: Marcos Katz + Claude
Repo: github.com/marcoskatz-cmd/ingecov
HEAD al momento del diseño: `aaf1654`

## Objetivo

Cerrar el agujero de privacidad real del panel: hoy los Sheets están compartidos como "anyone with link" — cualquiera con la URL del panel (o que mire `js/app.js` y saque los IDs) puede leer todos los datos de flota de INGECO directamente desde `docs.google.com`.

A la vez, unificar los Apps Scripts dispersos (`actualizarPanelTrabajos` en Sheet de trabajos, `actualizarPanelRepuestos` en Sheet de entregas, `alertas-service.gs` en Sheet de service, y posiblemente otros) en un único proyecto standalone con triggers automáticos.

**En scope:**
- Proyecto Apps Script standalone "INGECO Panel API" que sirve datos en JSON a través de un `doGet(e)` con whitelist por email.
- Sync periódico (cada 30 min) de las consolidaciones que hoy son manuales.
- Mirror del `.xlsx` de combustible livianos (el operario sigue editándolo como hasta ahora; un trigger refleja los datos a una pestaña nativa que el Web App lee).
- Cambio del panel: reemplazar `fetchGviz*` por `fetchApi`, eliminar `SHEET_IDS` del JS, ajustar CSP.
- Privatización de los Sheets (después de validar que el Web App funciona).
- Borrado de los scripts viejos en los Sheets maestros (después de validar).

**Fuera de scope:**
- OAuth genérico (Auth0, magic links). La whitelist por email Google alcanza.
- Mover el hosting del HTML fuera de GitHub Pages.
- Refactor del front-end más allá de lo necesario para usar la nueva API.
- Nuevas features del panel.

## Restricciones del entorno

1. INGECO usa Google Workspace pero no todos los empleados tienen cuenta corporativa — algunos usuarios van a entrar con `@gmail.com` personal. La whitelist se hace por email explícito (no por dominio).
2. El operario de combustible livianos trabaja sobre un `.xlsx` en Drive. Su flujo NO debe cambiar. La conversión a Sheet nativo se hace del lado del Apps Script.
3. GitHub Pages no permite setear HTTP headers — la CSP sigue siendo via meta tag.
4. La transición debe ser gradual (no big-bang). Validar todo en paralelo antes de borrar scripts o privatizar Sheets.

## Diseño

### 1. Proyecto Apps Script "INGECO Panel API"

Proyecto standalone (no atado a ningún Sheet). Estructura:

```
INGECO Panel API/
├── 00_config.gs              SHEET_IDS, lectura de Script Properties, constantes
├── 01_auth.gs                assertAllowed(): chequea email vs whitelist
├── 02_router.gs              doGet(e), enruta por ?ep=
├── 03_cache.gs               wrapper sobre CacheService (TTL 30 min)
├── 10_endpoints.gs           handlers por endpoint (getPedidos, getCodigos, …)
├── 20_consolidador_trabajos.gs   actualizarPanelTrabajos (migrado del Sheet de trabajos)
├── 21_consolidador_repuestos.gs  actualizarPanelRepuestos (migrado del Sheet de entregas)
├── 22_sync_combustible_livianos.gs   lee el .xlsx vía Drive.Files.export, vuelca al mirror
├── 30_alertas.gs             alertas-service migrado del Sheet de service
└── 99_setup.gs               función onetime: crea triggers, inicializa Properties
```

**Deployment**:
- Tipo: Web App.
- Execute as: **me** (Marcos Katz).
- Who has access: **Anyone with Google account** (no "anyone" público; cada request trae el email del usuario logueado, el `assertAllowed()` filtra).

**Script Properties** (editables desde el editor del proyecto, sin redeploy):
- `ALLOWED_EMAILS`: lista separada por coma. Arranca con `marcoskatz@grupoingeco.com.ar,nicobdallagata@gmail.com`. Se agregan emails a medida que se sumen usuarios.
- `XLSX_COMBUSTIBLE_LIVIANOS_ID`: ID del archivo `.xlsx` del operario (Drive file ID).
- `MIRROR_SHEET_ID`: ID del Sheet propio del panel donde vive la pestaña espejo `COMBUSTIBLE_LIVIANOS_MIRROR`.
- `CACHE_TTL_SECONDS`: 1800 por defecto (30 min). Configurable.

### 2. Endpoints del Web App

Todos retornan JSON con shape común:

```json
{
  "ok": true,
  "data": <payload>,
  "at": "2026-05-27T15:30:00.000Z",
  "cached": false,
  "endpoint": "pedidos"
}
```

O en caso de error:

```json
{
  "ok": false,
  "error": "not_authorized" | "unknown_endpoint" | "internal_error",
  "message": "..."
}
```

| `?ep=` | Devuelve | Sheets que toca | Cache TTL |
|---|---|---|---|
| `pedidos` | Pestañas PENDIENTES + ENTREGADOS | `SHEET_IDS.pedidos` | 30 min |
| `codigos` | 4 pestañas de CÓDIGOS unificadas | `SHEET_IDS.codigos` | 30 min |
| `panel_repuestos` | `PANEL_REPUESTOS` consolidado | `SHEET_IDS.repuestos_hist` | 30 min |
| `panel_trabajos` | `PANEL_TRABAJOS` consolidado | `SHEET_IDS.trabajos_reg` | 30 min |
| `indicadores` | Indicadores | `SHEET_IDS.indicadores` | 30 min |
| `service` | FRECUENCIA - OPERATIVIDAD + trimestre vigente | `SHEET_IDS.programaService` | 30 min |
| `combustible` | Pestaña ENTREGA DE COMBUSTIBLE | `SHEET_IDS.combustible` | 30 min |
| `combustible_livianos` | Pestaña espejo del .xlsx | `MIRROR_SHEET_ID` / `COMBUSTIBLE_LIVIANOS_MIRROR` | 30 min |
| `refresh&panel=all\|trabajos\|repuestos\|combustible_livianos` | Fuerza consolidación + invalida cache | — | — |
| `whoami` | `{email, allowed: bool}` para debug | — | — |

**Parámetros comunes:**
- `force=1` → bypassa cache server-side, lee Sheets en vivo y reescribe cache.

### 3. Auth y whitelist

Cada `doGet(e)` arranca con:

```javascript
function doGet(e) {
  const email = Session.getActiveUser().getEmail();
  if (!email) {
    return jsonResponse({ok: false, error: 'no_session'}, 401);
  }
  const allowed = getAllowedEmails(); // lee Property ALLOWED_EMAILS
  if (!allowed.has(email.toLowerCase())) {
    return jsonResponse({ok: false, error: 'not_authorized', email}, 403);
  }
  // … router
}
```

Para agregar usuarios: editor del proyecto → File → Project Properties → Script Properties → editar `ALLOWED_EMAILS`. Cambio toma efecto inmediato, sin redeploy.

`whoami` endpoint devuelve `{email, allowed}` antes del filtro, para que el panel pueda mostrar "logueado como X, contactá a Marcos para acceso" si el usuario no está en la lista.

### 4. Cache server-side

Wrapper sobre `CacheService.getScriptCache()`:

```javascript
function cachedFetch(key, ttl, fn) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) return { data: JSON.parse(hit), cached: true };
  const fresh = fn();
  cache.put(key, JSON.stringify(fresh), ttl); // ttl en segundos
  return { data: fresh, cached: false };
}
```

Cada endpoint usa una key estable (ej. `ep:panel_repuestos:v1`). Bumpear el sufijo `v1→v2` invalida globalmente cuando cambia el shape del payload.

Limitación de `CacheService`: valores hasta 100 KB. Si algún payload se acerca al límite, partir en sub-keys (`ep:panel_repuestos:v1:chunk1`, etc.). El consolidado actual de repuestos pesa ~40 KB → margen 2.5×.

### 5. Triggers temporizados

Setup desde `99_setup.gs` (correrlo una sola vez después de deploy):

```javascript
function setupTriggers() {
  // Limpia triggers existentes del proyecto
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('actualizarPanelTrabajos').timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger('actualizarPanelRepuestos').timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger('syncCombustibleLivianos').timeBased().everyMinutes(30).create();

  // Alertas mantienen su frecuencia actual: una vez al día (no se cambia)
  ScriptApp.newTrigger('alertasService').timeBased().atHour(8).everyDays(1).create();
}
```

Cada función protegida con `LockService.getScriptLock().tryLock(30000)` para evitar choque de corridas concurrentes.

### 6. Sync combustible livianos (mantener flujo del operario)

El `.xlsx` del operario sigue tal cual. El trigger `syncCombustibleLivianos` (cada 30 min) tiene dos implementaciones posibles según se descubra en fase 1:

**Opción A — `Drive.Files.export` a CSV** (preferida, más liviana):

```javascript
function syncCombustibleLivianos() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const xlsxId = getProperty('XLSX_COMBUSTIBLE_LIVIANOS_ID');
    const csvBlob = Drive.Files.export(xlsxId, 'text/csv');
    const rows = Utilities.parseCsv(csvBlob.getDataAsString('UTF-8'));

    const mirrorId = getProperty('MIRROR_SHEET_ID');
    const sheet = SpreadsheetApp.openById(mirrorId)
                                .getSheetByName('COMBUSTIBLE_LIVIANOS_MIRROR');
    sheet.clear();
    if (rows.length) sheet.getRange(1,1,rows.length,rows[0].length).setValues(rows);
  } finally {
    lock.releaseLock();
  }
}
```

Limitación: `text/csv` solo exporta la primera pestaña del `.xlsx`. Hoy el panel lee la pestaña `Control General` del archivo. **Verificar en fase 1**: si esa pestaña es la primera del libro, opción A funciona. Si no, opción B.

**Opción B — Copia temporal a Sheet nativo** (fallback si A no aplica):

```javascript
function syncCombustibleLivianos() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  let tempId = null;
  try {
    const xlsxId = getProperty('XLSX_COMBUSTIBLE_LIVIANOS_ID');
    // Drive.Files.copy con mimeType convierte a Sheet nativo
    const copy = Drive.Files.copy(
      { mimeType: 'application/vnd.google-apps.spreadsheet' },
      xlsxId
    );
    tempId = copy.id;
    const src = SpreadsheetApp.openById(tempId).getSheetByName('Control General');
    const rows = src.getDataRange().getValues();

    const mirrorId = getProperty('MIRROR_SHEET_ID');
    const sheet = SpreadsheetApp.openById(mirrorId)
                                .getSheetByName('COMBUSTIBLE_LIVIANOS_MIRROR');
    sheet.clear();
    if (rows.length) sheet.getRange(1,1,rows.length,rows[0].length).setValues(rows);
  } finally {
    if (tempId) try { Drive.Files.remove(tempId); } catch (_) {}
    lock.releaseLock();
  }
}
```

Costo extra: ~2-3 s por corrida (crear copia + borrar). Aceptable para frecuencia 30 min.

El endpoint `?ep=combustible_livianos` lee del mirror, no del `.xlsx` original.

### 7. Cambios en el panel (HTML/JS)

**`js/app.js`:**

```javascript
const API_URL = 'https://script.google.com/macros/s/<deployment-id>/exec'; // se completa en fase 1 tras el deploy

async function fetchApi(endpoint, opts = {}) {
  const params = new URLSearchParams({ ep: endpoint, ...opts });
  const r = await fetch(`${API_URL}?${params}`, { credentials: 'include' });
  if (r.status === 403) {
    const body = await r.json().catch(() => ({}));
    showAuthGate(body.email);
    throw new Error('not_authorized');
  }
  const json = await r.json();
  if (!json.ok) throw new Error(json.error || 'api_error');
  return json.data;
}
```

**Reemplazos:**
- `fetchGvizRaw(id, sheet)` → `fetchApi(endpointDe(id, sheet))` — un mapeo trivial de los pares (id, sheet) viejos a endpoints nuevos.
- `fetchGvizObj(id, sheet)` → igual, pero el shape del JSON ya viene como array de objetos (el server lo arma), así que el consumer code no cambia.
- Eliminar `SHEET_IDS`, `COMBUSTIBLE_SHEET`, `SERVICE_FREC_SHEET` del JS.
- `loadAll()` no cambia su shape externa; solo internamente cambia qué llama.

**Botón "sync"** del header (el que hoy llama `loadAll()`): se modifica para llamar primero `fetchApi('refresh', {panel: 'all'})` (que ejecuta los consolidadores server-side e invalida cache) y después `loadAll()` (que re-fetchea todos los endpoints).

**Pantalla de auth fail (`showAuthGate(email)`):**

```html
<div class="auth-gate">
  <h2>No estás autorizado</h2>
  <p>Estás logueado como <code>${email}</code>.</p>
  <p>Pedile a Marcos (<a href="mailto:marcoskatz@grupoingeco.com.ar">marcoskatz@grupoingeco.com.ar</a>) que te agregue a la lista de usuarios.</p>
</div>
```

Reemplaza al dashboard cuando el server devuelve 403. El error boundary global no la dispara — la maneja `fetchApi` explícitamente.

**`index.html`:**

CSP `connect-src` cambia:
- Antes: `connect-src https://docs.google.com;`
- Después: `connect-src https://script.google.com;`

(Si el deployment del Web App devuelve un redirect a `script.googleusercontent.com` en algunos navegadores, agregar también ese dominio. Verificar empíricamente.)

### 8. Service worker

Bump `CACHE_VERSION` de `v2` a `v3`. La función `isCDNRequest` no cambia (sigue siendo solo cdnjs). La función `isGvizRequest` se renombra a `isApiRequest` y matchea `script.google.com`. Sigue siendo passthrough (la app cachea en localStorage).

### 9. Privatización de Sheets

**Después** de validar que el panel funciona contra el Web App, cambiar el share de cada uno de los 9 Sheets:

- "Anyone with link can view" → **borrar ese permiso**, dejar solo "Marcos owner".
- Si algún usuario tiene acceso individual históricamente, se mantiene (no afecta).

Esto se hace manualmente desde la UI de cada Sheet (no automatizable sin permisos delicados). Lista para chequear:

```
[ ] 1VFJwFLLEaOE9tTuwah7QkaDTrYkeYtOH8brUgSyHeFY  (pedidos)
[ ] 1GpP2ejMVXncr2OLmKK_IP-zqr5AARi1Q3YdQIPlsUUE  (indicadores)
[ ] 1I4ejRAoMnpou-cRvefgfVCzPg9Obkmi2              (codigos)
[ ] 1TUEoOul4SI5O323LcMq2VkaxdcTMfTmZce7NToGESfc  (repuestos_hist)
[ ] 1cNWQ44UEDiotHyB65BfTMcFuOCfQXYQoSNNAdAKTsy8  (trabajos_reg)
[ ] 1zB9q0e9kxRKe52-I0u5Dqg7PUSE_nlxi3IYn7pxF0Iw  (service)
[ ] 19dqJ-tcdmXiOns99mJgMMmZNDT3kKS7EQXwHd7VDILc  (combustible)
[ ] 1y6pqbXscej3139lkImWJsJHeJvFa0B5sneICEyyNPmI  (programaService)
[ ] 16KmV7k9gsqBgtd3YpesD2w9Hq2BEasac              (combustibleLivianos .xlsx — del operario)
```

El `.xlsx` del operario merece nota aparte: como sigue siendo su archivo, su compartido lo decide él. Lo importante es que el Apps Script (corriendo como Marcos) pueda leerlo. Si el operario lo tiene en su Drive y lo comparte con Marcos como "viewer", alcanza. Si está en una carpeta compartida del Workspace, también alcanza.

### 10. Borrado de scripts viejos

**Después** de validar que los triggers nuevos están corriendo y produciendo el mismo output que los manuales:

- Sheet de trabajos: abrir editor Apps Script → borrar el script entero (o vaciar el código). El menú `INGECOV → Actualizar PANEL_TRABAJOS` deja de aparecer al siguiente refresh del Sheet.
- Sheet de entregas: idem.
- Sheet de service: idem para `alertas-service.gs`.

El repo `apps-scripts/alertas-service.gs` queda como referencia histórica (con README actualizado: "código vivo ahora en proyecto standalone INGECO Panel API"). Opcionalmente borrar el archivo del repo en un commit posterior.

## Plan de implementación

Cinco fases. Cada una termina con un punto de validación; la siguiente arranca solo si la previa pasó.

### Fase 1 — Crear el Web App en paralelo (sin tocar el panel)

1. Crear proyecto Apps Script standalone "INGECO Panel API" en la cuenta `marcoskatz@grupoingeco.com.ar`.
2. Configurar Script Properties (whitelist, IDs).
3. Implementar los archivos `.gs` listados arriba.
4. Migrar `actualizarPanelTrabajos`, `actualizarPanelRepuestos`, `alertas-service.gs` al proyecto (copiar el código de los Sheets originales).
5. Implementar `syncCombustibleLivianos` (lectura del `.xlsx` vía `Drive.Files.export`).
6. Implementar endpoints + cache + auth.
7. Deploy como Web App (Execute as: me, Access: Anyone with Google account).
8. Setup de triggers vía `setupTriggers()`.

**Validación fase 1:**
- Probar cada endpoint manualmente desde el browser (logueado como Marcos): `https://script.google.com/.../exec?ep=pedidos`, `?ep=codigos`, etc.
- Comparar JSON contra lo que devuelve gviz hoy para los mismos Sheets — los datos deben coincidir.
- Probar `?ep=whoami` con una cuenta no autorizada → debe devolver `not_authorized`.
- Verificar que los triggers corrieron (Apps Script → Executions) y que `PANEL_REPUESTOS` / `PANEL_TRABAJOS` se actualizan. Compararlos con los outputs de los scripts viejos (que siguen corriendo en los Sheets, en paralelo).

### Fase 2 — Switchear el panel detrás de un flag

1. En `js/app.js`, agregar `const USE_API = false` (flag inicial).
2. Implementar `fetchApi(endpoint, opts)` y el shim que mapea `fetchGviz*` → `fetchApi`.
3. Cuando `USE_API=true`, todos los `fetchGviz*` redirigen a `fetchApi`. Cuando `false`, comportamiento idéntico al actual.
4. Implementar `showAuthGate(email)`.
5. Setear `USE_API=true`, commit, push.
6. CSP NO se cambia todavía (sigue permitiendo `docs.google.com`). El panel ahora tiene `connect-src https://docs.google.com https://script.google.com` para soportar las dos rutas en convivencia.

**Validación fase 2:**
- Abrir el panel logueado como Marcos. F12 → Network: las requests salen a `script.google.com`, no a `docs.google.com`.
- Verificar que todos los KPIs, equipos, rankings, modales se renderizan idéntico.
- Click sobre cada toggle, filtro, drill-down — ningún botón roto.
- Probar `?force=1` desde el header del panel ("sync") — Network debe mostrar el fetch con `force=1` y la respuesta `cached: false`.
- Probar desde una pestaña incógnito con una cuenta no whiteliested → debe aparecer la pantalla de auth gate, no el dashboard.

### Fase 3 — Endurecer CSP y limpiar el JS

1. Quitar `SHEET_IDS`, `COMBUSTIBLE_SHEET`, `SERVICE_FREC_SHEET`, `SERVICE_TRIM_SHEET` del JS.
2. CSP `connect-src`: dejar solo `https://script.google.com` (eliminar `docs.google.com`).
3. Eliminar el flag `USE_API` (ya no hace falta).
4. Eliminar las funciones `fetchGvizRaw` / `fetchGvizObj` muertas.
5. Update `sw.js`: `CACHE_VERSION='v3'`, renombrar `isGvizRequest` → `isApiRequest` matcheando `script.google.com`.

**Validación fase 3:**
- F12 → Console: cero violaciones CSP.
- F12 → Network: cero requests a `docs.google.com`.
- Reload duro (Ctrl+F5) — todo debe seguir funcionando.

### Fase 4 — Privatizar los Sheets

1. Para cada Sheet de la lista de arriba: UI → Share → quitar "anyone with link can view".
2. Verificar: abrir el Sheet en una pestaña incógnito → debe redirigir a login wall.
3. Verificar: panel sigue funcionando (porque el Web App corre como Marcos y mantiene acceso).

**Validación fase 4:**
- Intentar abrir cada Sheet ID en `docs.google.com/spreadsheets/d/<ID>` sin estar logueado → 403/login required.
- Panel sigue cargando datos sin issues.
- Probar también la URL del `.xlsx` de combustible livianos: debe seguir privado al operario y Marcos.

### Fase 5 — Borrar los scripts viejos

1. Sheet de trabajos: editor Apps Script → eliminar el código del proyecto (no eliminar el proyecto entero — quedaría huérfano un trigger zombie si existiera). Vaciar el código. Borrar triggers asociados.
2. Sheet de entregas: idem.
3. Sheet de service: idem para `alertas-service.gs`.
4. Refresh manual de cada Sheet → verificar que ya no aparece el menú `INGECOV`.
5. Repo: actualizar `apps-scripts/README.md` para indicar que la lógica vive en el proyecto standalone. Opcionalmente borrar `apps-scripts/alertas-service.gs` en un commit posterior (decisión de Marcos).

**Validación fase 5:**
- En el panel, hacer click "sync" → log de execution del Web App muestra una corrida nueva.
- Esperar 30 min → verificar que el trigger corrió y los paneles `PANEL_REPUESTOS` / `PANEL_TRABAJOS` se actualizaron con datos frescos.

## Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Apps Script latencia spike en first call del día (cold start ~5 s) | Media | Cache server-side + cache cliente. Primera carga del día va a notarse; reload subsecuentes son instantáneos. |
| Quota Apps Script: URL Fetch o execution time | Baja | Workspace tiene 100k URL fetches/día y ~6 hr de execution/día. Con cache server, uso real es ~5% de eso. Si alguna vez se acerca, bumpear TTL del cache. |
| Apps Script outage | Muy baja | Histórico >99.9% uptime. Trade-off aceptado a cambio de privacidad real. |
| Empleado con `@gmail.com` personal pierde acceso al panel cuando lo agrega y después cambia el email | Baja | La whitelist tiene el email exacto. Si lo cambia, hay que actualizar la Property. Edge case raro. |
| Race entre trigger temporizado y edición manual del Sheet por Marcos | Media | `LockService.tryLock(30000)` en cada consolidador. Si choca, salta esa corrida (30 min después la siguiente atrapa). |
| El operario mueve/renombra el `.xlsx` de combustible livianos | Media | El sync usa file ID (`XLSX_COMBUSTIBLE_LIVIANOS_ID`), que sobrevive a renames y moves. Si el operario *recrea* el archivo (delete + new), hay que actualizar la Property. |
| El payload de algún endpoint excede 100 KB de CacheService | Baja | El más grande hoy (`panel_repuestos`) pesa ~40 KB. Margen 2.5×. Si crece, partir en chunks. |
| Cliente con SW `v2` cacheado: HTML viejo apunta a `docs.google.com`, CSP nueva bloquea | Media | El bump a `CACHE_VERSION='v3'` invalida automáticamente al detectar la nueva versión. Usuarios pueden necesitar un hard refresh la primera vez. |
| Algún usuario no quiere/no tiene cuenta Google | Baja | Whitelist es por email Google. Los usuarios sin cuenta tienen que crearse un Gmail (gratis). Política aceptada. |
| Cuenta `marcoskatz@grupoingeco.com.ar` deja de existir (cambio de empresa, etc.) | Baja, alto impacto | El Web App está atado a esa cuenta. Migración futura requiere recrear el proyecto bajo otra cuenta y redeploy. Documentado para el plan B. |

## Verificación de aceptación

- ✅ Abrir el panel en una cuenta no whitelisted → aparece la auth gate, no el dashboard.
- ✅ Abrir cada Sheet ID en una pestaña incógnito → 403/login required (Sheets ya no son públicos).
- ✅ F12 → Network mientras se carga el panel → todas las requests salen a `script.google.com`, cero a `docs.google.com`.
- ✅ F12 → Console: cero violaciones CSP, cero violaciones de Trusted Types.
- ✅ Botón "sync" del panel → log de execution en el editor del Web App muestra la corrida.
- ✅ Esperar 30 min → trigger automático corrió, `PANEL_REPUESTOS` y `PANEL_TRABAJOS` tienen datos frescos.
- ✅ Cambiar una celda en el `.xlsx` de combustible livianos → 30 min después (al siguiente sync) el panel refleja el cambio.
- ✅ Sheets de trabajos/entregas/service: abrir el editor Apps Script → no hay código ni triggers (todo migrado al proyecto standalone).
- ✅ Agregar un email nuevo a `ALLOWED_EMAILS` desde Script Properties → ese usuario puede entrar inmediatamente sin redeploy.

## Archivos esperados después del cambio

```
Repo (github.com/marcoskatz-cmd/ingecov)
├── index.html                  ← CSP actualizada (connect-src script.google.com)
├── js/
│   ├── init.js                 ← sin cambios
│   └── app.js                  ← fetchApi en lugar de fetchGviz, sin SHEET_IDS, showAuthGate
├── fonts/                      ← sin cambios
├── manifest.json               ← sin cambios
├── sw.js                       ← CACHE_VERSION='v3', isApiRequest
├── apps-scripts/
│   ├── README.md               ← apuntando al proyecto standalone como fuente de verdad
│   └── alertas-service.gs      ← copia histórica (o borrado en commit posterior)
└── docs/superpowers/specs/     ← este spec + el de hardening anterior

Apps Script (script.google.com, cuenta marcoskatz@grupoingeco.com.ar)
└── INGECO Panel API/
    └── (los archivos listados en sección 1)

Drive
├── Sheets ahora privados (solo Marcos owner)
└── .xlsx de combustible livianos sigue siendo del operario, compartido con Marcos como viewer
```

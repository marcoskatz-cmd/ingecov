---
name: ingeco-panel
description: Contexto técnico del panel de mantenimiento de flota INGECO (Marcos Katz, INGECO S.A. Tucumán). Cargar SIEMPRE que el usuario mencione "ingecov", "panel de mantenimiento", "panel de flota", "INGECO", el repo ingecov / ingecov-repo, js/app.js, index.html, sw.js, el snapshot congelado, construirSnapshot, snapshot-builder, las pestañas COD_V/L/P/S / REP_LIVE / TRAB_LIVE / COMB_LIVIANOS / SVC_PANELPROG, el proyecto Apps Script "INGECO Panel API", clasp, las planillas fuente (LISTA DE EQUIPOS, combustible, pedidos/entregas de repuestos), o cualquier cambio sobre el sistema. También activar cuando pegue código del panel (app.js / .gs) o pida tocar la carga/procesamiento de datos, KPIs, o el deploy.
---

# Panel de mantenimiento de flota INGECO

Panel web que Marcos mantiene en INGECO S.A. para ver el estado de la flota vial: equipos (estado/ubicación/tenencia), trabajos, repuestos, pedidos, service, combustible, horas en taller, costos. Publicado en GitHub Pages con PIN en la UI.

## ⚠️ La arquitectura CAMBIÓ — leé esto primero

- **Producción NO es un único `ingecov<N>.html`.** Ese modelo (single-file, gviz directo) quedó **ABANDONADO**. Los `ingecov<N>.html` sueltos en `Downloads/` (hasta ~v55) son árbol muerto: **NO se despliegan, no los edites para producción.**
- **Producción = repo modular**: `index.html` + `js/app.js` (toda la lógica) + `js/init.js` + `sw.js` (PWA) + `apps-scripts/*.gs`. Clon local en `C:\Users\Usuario\Downloads\ingecov-repo\`.
- **La fuente de verdad de la arquitectura es `PANEL_CONTEXT_FOR_CHAT.md` en la raíz del repo.** LEELO antes de tocar código — tiene SHEET_IDS vigentes, features, bugs históricos y gotchas. Este skill solo orienta.

## Cómo llegan los datos (snapshot congelado)

El browser **no** lee las planillas fuente directo. Un Apps Script (`construirSnapshot()`, trigger cada 30 min) lee TODAS las fuentes server-side y vuelca **copias verbatim reshapeadas** en UN spreadsheet congelado (`SNAPSHOT_ID = 1E883xvPP_Oyt1mjQ2FjZLiY-Jmvyzgi0_UhEq2dFbGY`). El browser tiene un mapa `SNAP_REDIRECT` que hace que `app.js` crea leer las fuentes originales pero todo sale del snapshot → mismos números en cada reload.

- **Builder**: `construirSnapshot()` en el proyecto Apps Script standalone **"INGECO Panel API"**. Repo lo versiona como `apps-scripts/snapshot-builder.gs`.
- **Pestañas del snapshot**: `COD_V/L/P/S` (equipos por categoría), `TRAB_LIVE`, `REP_LIVE`, `PED_PEND`, `COMBUSTIBLE` (pesados), `COMB_LIVIANOS` (livianos), `SVC_PANELPROG`, `SERVICE_EQ`, `META`, y HIST vacíos. El browser las parsea con `parseCodigos` / `procesarX`.
- **Filosofía verbatim**: el builder NO recalcula KPIs; copia texto plano. Si un número sale mal, el bug está en la fuente o en la copia, no en un recálculo.

## Deploy (dos caminos, sin copiar/pegar)

- **HTML / JS (frontend)** → GitHub Pages. Push al repo `marcoskatz-cmd/ingecov` (rama `main`). Bumpear `?v=` en index.html. Token y comando exacto en la memoria [[ingecov-deploy]]. Pages redeploya 1-3 min.
- **`.gs` (builder / webapp)** → vía **clasp**, NO se despliega desde GitHub. Clon completo del proyecto en `C:\Users\Usuario\Downloads\ingeco-panel-api\` (`Código.js` = builder, `refresh.js` = webapp, `appsscript.json`). Flujo: editar `Código.js` local → `node --check` → `clasp push`. Detalles (scriptId, `clasp login`, deployments, correr `construirSnapshot`) en la memoria [[ingecov-deploy]]. En el editor el archivo del builder se llama **`Código.js`** (no `concatenador.gs`).
- **Correr `construirSnapshot()`**: trigger de 30 min (auto), ▶ en el editor, o la webapp de refresh. El harness puede bloquear pegarle al `/exec` de producción.

## Seguridad del frontend (CSP estricta + Trusted Types)

`app.js` tiene reglas duras (ver CSP en index.html): **cero `<script>`/`onclick` inline** (handlers vía `data-action="..."` + registro `ACTIONS` al final de app.js), **cero `innerHTML=`** (usar `setHTML(el, html\`...\`)`), fonts self-hosted. Si agregás un dominio de fetch, actualizá `connect-src` en la meta CSP y en `sw.js`. Si cambian assets cacheados, bumpeá `CACHE_VERSION` en `sw.js`.

## Workflow de debugging (patrón recurrente)

Las planillas fuente las manejan terceros y **se reestructuran sin aviso** (renombran columnas/pestañas). Cuando una sección/KPI aparece vacío:

1. **Mirá la pestaña del snapshot** (gviz sobre `SNAPSHOT_ID`, ej. `COD_V`, `COMB_LIVIANOS`). ¿Trae filas de datos o solo el header?
2. **Si el snapshot está vacío/incompleto → el bug está en el builder**, casi siempre un **sinónimo de columna que dejó de matchear**. `_idx_(header, [sinónimos])` hace match **EXACTO** sobre el header normalizado (`_snapNormCod` quita acentos/símbolos/espacios). Si la fuente retituló la columna, `_idx_` da -1 → esa columna sale vacía → el resto del pipeline no matchea.
   - Casos reales (jul-2026): la LISTA DE EQUIPOS pasó a titular el código `CÓDIO INTERNO` (con typo) y la patente `N° SERIE - N° PATENTE`; el combustible livianos igual. Fix = agregar el sinónimo (basta ASCII sin tilde: `CODIO INTERNO`, `N SERIE N PATENTE`, porque `_snapNormCod` normaliza).
3. **Verificá contra la fuente EN VIVO antes de desplegar**: bajá el header/filas de la planilla por gviz con un harness node y confirmá que los índices y el match dan bien. No parchees a ciegas.
4. **Gotcha gviz**: pedir una pestaña inexistente a veces devuelve la hoja default igual (no error) → no asumas que "trae datos" significa "leyó la pestaña correcta". El builder usa `getSheetByName` (exacto) o `_readTabByHeader_`.
5. Si el problema está en el **dato fuente** (mal cargado a mano), decilo y NO parchees el código para esconderlo.

## Preferencias de Marcos

- Tono directo, sin rodeos. No anunciar lo que vas a hacer, hacerlo.
- Si una respuesta es incómoda, decirla. No dorar la píldora.
- Razonamiento ingenieril: causas, efectos, optimización.
- Cuando un cambio toca varios archivos, hacerlos todos y commitear/pushear de una.
- Después de cualquier cambio, marcar el siguiente paso de verificación concreto.
- Cuando pasa un link de Sheet/Drive, hardcodear el ID en el código. No dejar placeholders.

## Archivos de referencia (LEGACY — arquitectura vieja)

`references/apps-script-trabajos.gs`, `references/apps-script-repuestos.gs` y `references/estructura-planillas.md` describen los consolidadores y planillas del **modelo viejo** (mensuales + una pestaña por equipo), reemplazado por el snapshot. Sirven solo como historia; para producción, `PANEL_CONTEXT_FOR_CHAT.md` del repo manda.

# Panel INGECO · Contexto para llevar a otro chat (2026-06-01)

> Pegá esto entero al inicio del nuevo chat y se ahorra reconstruir todo.

## Acceso

- **URL**: https://marcoskatz-cmd.github.io/ingecov/
- **PIN**: `5289` (compartido)
- **Cambiar PIN**: `js/init.js` const `PANEL_PIN` → commit + push → ~1 min en Pages.
- **Sumar/quitar usuario**: pasarle / no pasarle el PIN. No hay whitelist técnica.

## Repo y clon

- **Repo público**: https://github.com/marcoskatz-cmd/ingecov
- **Clon local**: `C:\Users\Usuario\Downloads\ingecov-repo\`
- **HEAD actual**: `25a2f38` (`?v=28`, `sw v5`)
- **Workflow**: editar `index.html` y/o `js/app.js` del clon → `node --check js/app.js` → bumpear `?v=` en `index.html` (ambas referencias) → si cambiaron assets cacheados, bumpear `CACHE_VERSION` en `sw.js` → `git push origin main`. Pages redeploya en 1-3 min.
- **Antes de editar, `git pull`** (Marcos a veces commitea desde otra máquina).
- **`.gs` NO se deploya desde el repo**: están versionados en `apps-scripts/` solo para historial. Para que corran hay que pegarlos en el editor de Apps Script y, en el caso del snapshot, correr `construirSnapshot()` una vez (o esperar el trigger de 30 min).

## Arquitectura de datos: el panel lee UN snapshot congelado (determinismo)

**Cambio estructural (commit `3305a82` y posteriores).** Antes el browser hacía ~120 fetchs gviz directos a 10 sheets distintos → los KPIs variaban entre reloads (rate limiting, celdas typed que devolvían null intermitente, orden de llegada). Ahora:

- Un Apps Script standalone (`construirSnapshot()`, trigger cada 30 min) lee TODAS las fuentes server-side con `SpreadsheetApp` y vuelca **copias verbatim** en UN solo spreadsheet congelado: `SNAPSHOT_ID = '1E883xvPP_Oyt1mjQ2FjZLiY-Jmvyzgi0_UhEq2dFbGY'`.
- El builder **NO recalcula KPIs**. Copia textual con `getDisplayValues` y aplana las 2 fuentes fan-out (58 pestañas por equipo del HIST trabajos + las pestañas mensuales de service) en pestañas únicas. ~20 pestañas en total en el snapshot.
- El browser tiene un mapa `SNAP_REDIRECT` (`${sourceId}|${sheet}` → pestaña del snapshot). `_gvizRawImpl`/`_gvizObjImpl` redirigen transparente: el resto de `app.js` cree que sigue leyendo las fuentes originales pero todo sale del snapshot. Resultado: **mismos números en cada reload**.
- **Código fuente del builder**: `apps-scripts/snapshot-builder.gs` (versionado, deploy manual). Funciones útiles desde el editor: `construirSnapshot()` (corre ya), `instalarTriggerSnapshot()` (instala trigger 30 min), `verSnapshotId()`.
- **Filosofía verbatim**: si un número sale mal en el panel, el bug está en la fuente o en la copia, NO en un recálculo del builder. No hay lógica de KPI en el builder a propósito.

## SHEET_IDS vigentes

| Variable | ID | Para qué sirve |
|---|---|---|
| `pedidos` | `1VFJwFLLEaOE9tTuwah7QkaDTrYkeYtOH8brUgSyHeFY` | PENDIENTES + ENTREGADOS de 2026 |
| `indicadores` | `1GpP2ejMVXncr2OLmKK_IP-zqr5AARi1Q3YdQIPlsUUE` | Disponibilidad global |
| `codigos` | `1Z8kg4aC6KUNeWyxpPiD3xKntRYB4oghxsbnxqWQdVio` | INGECO Panel Mirror — catálogo de equipos (4 pestañas) |
| `repuestos_hist` | `1TUEoOul4SI5O323LcMq2VkaxdcTMfTmZce7NToGESfc` | **LIVE 2026 REPUESTOS** (diario al día) |
| `repuestos_hist_old` | `1WCtB-8C1VP4-axoQ_ugk_ersCfPJFjMC1fEDXRHOKFE` | **HIST pre-2026 REPUESTOS** (cambia cada tanto). Header roto `#ERROR!` en col 0 → renormaliza a `N° ENTREGA` en `loadAll`. |
| `trabajos_reg` | `1ItkY8miYOwQEsbbjZlNslb86f7HY3TEzywpQx6pD5tU` | **LIVE 2026 TRABAJOS** (diario al día) |
| `trabajos_hist` | `1cNWQ44UEDiotHyB65BfTMcFuOCfQXYQoSNNAdAKTsy8` | **HIST pre-2026 TRABAJOS**. PANEL_TRABAJOS truncado por consolidador. Histórico real está en 58 pestañas POR EQUIPO. |
| `service` | `1zB9q0e9kxRKe52-I0u5Dqg7PUSE_nlxi3IYn7pxF0Iw` | Sheet de service. Pestaña `PANEL_PROGRAMA` con último/próximo service por equipo. |
| `combustible` | `19dqJ-tcdmXiOns99mJgMMmZNDT3kKS7EQXwHd7VDILc` | Combustible equipos pesados (tabular plano) |
| `programaService` | `1y6pqbXscej3139lkImWJsJHeJvFa0B5sneICEyyNPmI` | PROGRAMA DE TRABAJOS DE SERVICE 2026 (frecuencias + trimestre vigente) |
| `combustibleLivianos` | `1bZkxrdVEcN4v5Aztf4RBxncJKWE20Jti8wjNdCmAl-E` | Sheet operativo combustible vehículos livianos. Solo 2026. Pestaña `'Hoja 1'`. |
| `SNAPSHOT_ID` | `1E883xvPP_Oyt1mjQ2FjZLiY-Jmvyzgi0_UhEq2dFbGY` | **Snapshot congelado** que lee el panel. Lo escribe `construirSnapshot()`. El browser redirige acá vía `SNAP_REDIRECT`. Ver sección de arquitectura. |

## Filtro LIVE + HIST (patrón usado para 3 fuentes)

```js
// En loadAll, combinamos LIVE (al día) con HIST (histórico). Filtro por año
// simple — la dedup textual no funciona porque las descripciones difieren
// entre fuentes y la heurística de fecha asigna fechas distintas a las del LIVE.
const panelTrabajosObj=[
  ..._filtrarAnio(panelTrabajosLiveObj, y=>y>=2026, _SIN_FECHA_TRAB),
  ..._filtrarAnio(panelTrabajosHistObj, y=>y===2025, _SIN_FECHA_TRAB),
  ...panelTrabajosHist2025, // pestañas por equipo del 1cNWQ
];
```

**Trade-off conocido**: ~700 hr de trabajos 2026 cargados manualmente en las pestañas por equipo (que no pasan por la planilla mensual del Drive → no llegan al LIVE) no aparecen en el panel. Aceptado a cambio de cero duplicación.

## Features del panel

### KPIs (8 cards)

| KPI | Clickeable | Filtra por rango |
|---|:---:|:---:|
| Operativos · Pedidos activos · Equipos en reparación | ❌ | ❌ snapshot |
| Service crítico | ✅ → lista críticos | ❌ |
| Costo en repuestos | ✅ → ranking equipos | ✅ |
| Horas en taller (split corr/prev) | ✅ → ranking equipos | ✅ |
| Combustible livianos | ✅ → ranking equipos | ✅ |
| Disponibilidad global | ❌ | ❌ |

### Selector de rango de meses

Barra arriba del kpi grid: `[mes] [últ 3m] [últ 6m] [2024] [2025] [2026] [todo]`. Default `mesActual`. Afecta los 3 KPIs sensibles a tiempo. Click en cualquier botón → recalcula los 3 KPIs. Estado en `window._kpiRangoKey`.

### Modal de detalle por KPI (con drill-down)

Click en KPI costo/horas/combustible → modal `kpiDetailOverlay` con ranking de equipos del rango activo, con barra proporcional al top + `% del total`. Click en una fila del ranking → cierra modal + abre detalle del equipo (`toggleEquipoDetail`). Cierre: ×, click background, Esc.

### Cruce services planificados ↔ trabajos

Lee 3 sheets de planning (1°/2° TRIMESTRE del `programaService` + `PANEL_PROGRAMA` del `service`). 77 services únicos al año. Ventana de cruce `SERVICE_VENTANA_DIAS = 7`.

Regla operativa de Marcos: services PUROS van solo en sheets de service; services CON reparación van en TRABAJOS REALIZADOS. El cruce produce:
- `cargadosService`: también en planilla
- `cargadosOtraRazon`: parada conjunta cargada como Reparación, NO se reclasifica
- `sinCarga`: services puros (esto NO es falla de carga)

Horas estimadas con mediana por prefijo (~3 hr) se suman a `horasFlota.prev` solo para `sinCarga` y solo en años con ≥100 hr de cobertura.

Tag visual "🔧 svc" al lado de la fecha del trabajo cuando coincide con service planificado en ±7d.

### Robustez de fetchs gviz (ahora secundaria)

Con el snapshot, el browser hace ~20 fetchs a UN solo sheet en vez de ~120 a 10 sheets → el rate limiting prácticamente desapareció. Igual quedan las defensas: `fetchGvizRaw` y `fetchGvizObj` envueltos en `_withRetry(fn, 3)` con backoff exponencial (400 / 800 / 1600 ms). Las pestañas se procesan en lotes concurrentes con retry. Fallos persistentes quedan en `window._fetchTrabajosHistErrores` + `console.warn`.

**Quién lee las fuentes reales ahora es el builder** (`construirSnapshot`, server-side), no el browser. La heurística de fecha y la dedup viven del lado del browser sobre los datos ya congelados.

### Horas trituradora = espejo de la zaranda (commit `4d03a5d`)

TRT01 (trituradora) y ZRN01 (zaranda) comparten el mismo tren de chancado → las horas de taller de una se imputan a la otra. El panel espeja: TRT01 muestra las horas de ZRN01. Si se separan físicamente algún día, sacar el mirror.

### Heurística de fecha para pestañas hist trabajos

Las celdas FECHA TRABAJO con **rango** (`"21/3/2025 - 26/3/2025"`) están en columnas formato Date → gviz devuelve null. CORS bloquea XLSX export. Workaround: para filas con código + tiempo pero sin fecha visible, asignamos la fecha de la próxima fila visible (o anterior si no hay próxima).

## Seguridad activa (CSP estricta)

```
default-src 'none';
script-src 'self' https://cdnjs.cloudflare.com;
style-src 'self' 'unsafe-inline';
font-src 'self';
img-src 'self' data:;
connect-src 'self' https://docs.google.com;
require-trusted-types-for 'script';
trusted-types ingecov-html;
```

**Reglas duras**:
- Cero `<script>` inline / `onclick=` inline. Handlers via `data-action="..."` + entry en `ACTIONS` al final de `js/app.js`.
- Cero `innerHTML=` directo. Usar `setHTML(el, html\`...\`)`.
- Cero fonts CDN externos (self-hosted en `/fonts/`).
- Si se agrega un dominio para fetch: actualizar `connect-src` en meta CSP + `sw.js`.
- Si cambian assets cacheados por SW: bumpear `CACHE_VERSION` en `sw.js`.

## Bugs históricos importantes (NO re-cometerlos)

0. **Snapshot re-tipaba fechas y números (commit `25a2f38`)**: el spreadsheet creado por `SpreadsheetApp.create()` nace en locale US (m/d/yyyy) y sin formato de celda. Al hacer `setValues(getDisplayValues())`, Sheets **re-parseaba** los strings: fechas `"13/1/2026"` leídas como m/d → día>12 = mes inválido → gviz devolvía null → el browser tiraba la fila (combustible livianos bajó a ~28.7M en vez de ~76.3M, repuestos perdió ~2.2M). Números planos `"6000"` se re-formateaban a `"$6,000.00"` → `parseMoney` argentino leía la coma como decimal → 6. **FIX**: `rng.setNumberFormat('@')` (texto plano) ANTES de cada `setValues` en el builder → las celdas guardan el string literal → gviz lo devuelve verbatim → los parsers del browser lo manejan bien. Coherente con el diseño verbatim del builder. **Verificado post-fix**: combustible livianos ≈ 76.3M, costo repuestos ≈ 175.5M.

1. **gviz devuelve null para texto en columna typed**: si una columna del sheet está formateada como Date/Number pero el operario escribe texto (`"$ 25.800"`, `"21/3/2025 - 26/3/2025"`), gviz silenciosamente devuelve null para esas celdas. Marcos cambió `COSTO ENTREGA` a Texto plano. Para fechas con rango usamos heurística porque son 58 pestañas y no escala cambiar formato manual.

2. **Header roto `#ERROR!`** en col 0 del HIST 1WCtB PANEL_REPUESTOS → renormalizamos.

3. **Sinónimo de columna**: la columna del sheet de pedidos se llama `'DESCRIPCIÓN DE REPUESTOS ENTREGADOS'` (con ENTREGADOS al final). `COLS_PED.desc` tiene los sinónimos correctos ahora.

4. **Rate limiting de gviz** cuando se piden ~16+ requests paralelos. Solucionado con `_withRetry` universal + concurrencia limitada en pestañas del HIST.

5. **Dedup textual entre LIVE y HIST de trabajos** NO funciona (descripciones difieren entre fuentes, fechas divergen por heurística). Filtro simple por año.

6. **Reestructura del archivo de pedidos/entregas (jul-2026)**: `1JpXjGTJ...` renombró sus pestañas a `REGISTRO PEDIDOS` / `REGISTRO ENTREGAS` (además hay `PEDIDOS PENDIENTES`, `PEDIDOS ENTREGADOS`, formularios) y pasó a slots multi-equipo: `EQUIPO/SECTOR 1..4`, `CÓDIGO 1..4`, `PATENTE 1..4`, `RAZÓN 1/2`, `RESPONSABLE 1/2`. `_idx_` es match exacto → EQUIPO/CÓDIGO/RAZÓN/RESPONSABLE salían vacíos en PED_PEND/REP_LIVE (el builder reportaba OK porque las filas sí copiaban) → `renderDashboard` filtra por `r[2]` no vacío → KPIs de pedidos en 0 y costos sin cruce por código. Fix: sinónimos `EQUIPO/SECTOR 1`, `CÓDIGO 1`, `RAZÓN 1`, `RESPONSABLE 1` + nombres de pestaña explícitos en `_buildPedidos_`/`_buildRepuestos_`. A la fecha los slots 2..4 están siempre vacíos (0 filas); si empiezan a usarse, el builder solo toma el slot 1 — habría que expandir filas.

## Apps Script standalone "INGECO Panel API"

En `marcoskatz@grupoingeco.com.ar`. Triggers cada 30 min:
- `actualizarPanelTrabajos`, `actualizarPanelRepuestos`: consolidan archivos mensuales del Drive a Sheets.
- `syncCombustibleLivianos`, `syncCodigosEquipos`: sync .xlsx → Mirror (`1Z8kg...`).
- `construirSnapshot` (de `apps-scripts/snapshot-builder.gs`): lee todas las fuentes y vuelca copias verbatim al snapshot congelado (`1E883xvPP_...`) que lee el panel. Es la pieza que da determinismo. Ojo con el orden: el snapshot debe correr DESPUÉS de que los otros consolidadores actualicen sus paneles, si no copia datos viejos.

**NO borrar el proyecto.**

## Apps Script de alertas (`apps-scripts/alertas-service.gs`)

Está en el repo solo para que quede versionado. **NO corre desde Pages**. Pegarlo manualmente en el editor de Apps Script del Sheet de service (`1zB9q0e9kxRKe52-I0u5Dqg7PUSE_nlxi3IYn7pxF0Iw`). Destinatarios por defecto: `marcoskatz@grupoingeco.com.ar`, `nicobdallagata@gmail.com`.

## Gotchas

- **Caches a romper si parecen pegados**: SW + localStorage + Pages CDN. Incognito tab, `cacheClear()` en consola, bump `CACHE_VERSION` en `sw.js`.
- **CORS bloquea XLSX export** desde browser. Por eso usamos workarounds en lugar de parsear el XLSX directo.
- **`procesarPanelTrabajos` ahora produce `horasPorMesYEquipo`** (`{ym: {codN: hr}}`) clave para el ranking del modal KPI por rango.
- **`TRABAJOS_HIST_PESTANAS_EQUIPOS`** (lista hardcoded de 58 pestañas del 1cNWQ): si se agrega un equipo nuevo al sheet, sumarlo acá o se pierde su histórico 2025.
- **El repo es público** → IDs de sheets están expuestos. Trade-off elegido (accesibilidad desde celular sin login).

## Preferencias de Marcos

- Tono directo, sin rodeos. No anunciar lo que vas a hacer, hacerlo.
- Si una respuesta es incómoda, decirla. No dorar la píldora.
- Razonamiento ingenieril: causas, efectos, optimización.
- Cuando un cambio toca varios archivos, hacerlos todos (en el clon) y commitear/pushear de una.
- Después de cualquier cambio, marcar el siguiente paso de verificación concreto.
- Si el problema parece estar en el dato fuente (no en el código), decirlo y NO parchear el código para esconderlo.
- Cuando pasa un link de Sheet/Drive, hardcodear el ID en el código. No dejar placeholders ni pedir que él complete.

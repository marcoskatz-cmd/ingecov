# Tab "Conservar vs Reemplazar" — modelo de decisión de recambio de equipo

**Fecha:** 2026-07-08
**Autor:** Marcos Katz (modelo) + Claude (integración)
**Repo:** `marcoskatz-cmd/ingecov` → `index.html` + `js/app.js`

## Objetivo

Agregar un tab al panel INGECOV que compare, para un equipo de la flota, el
costo mensual de **seguir** con el equipo actual contra **comprar uno 0km**,
incorporando mantenimiento, tiempo improductivo valuado al alquiler,
depreciación con financiación, y riesgo esperado de rotura mayor. El resultado
es un veredicto **CONSERVAR / REEMPLAZAR** con su desglose.

El motor de cálculo ya existe (funciones `evaluar`, `costoViejo`, `costoNuevo`,
`riesgoCola`, `valorHora`, `vidaBreakEven`, `probBreakEven`) y se integra
**sin modificar su matemática**.

## Requisito de UX: separación visual del dashboard

El panel es una herramienta **visual** (charts, rankings, cards de colores).
Este tab es **analítico**: una planilla de trabajo. Debe verse y sentirse
distinto. No reutiliza las `telemetria-card`; usa un namespace de clases propio
(`rep-*`) con estética de "consola de análisis":

- Columna única a ancho completo (no la grilla del dashboard).
- Estética sobria: tipografía monoespaciada para números, acento usado con
  moderación, fondos neutros, bordes finos tipo hoja de cálculo.
- Inputs agrupados en fieldsets rotulados en mayúsculas (`EQUIPO ACTUAL`,
  `0KM + FINANCIACIÓN`, `RIESGO DE COLA`).
- El resultado se presenta como un **informe**: banda de veredicto + libro
  mayor de dos columnas (SEGUIR vs COMPRAR con sus líneas) + tira de métricas
  secundarias.
- Respeta tema claro/oscuro existente vía variables CSS (`--text`, `--bg`, etc.).

## Alcance

- **Incluye:** tab nuevo, motor de cálculo embebido, autoprellenado desde datos
  del panel, inputs manuales editables, tabla editable de modos de falla,
  recálculo en vivo, persistencia en `localStorage`, opción "manual / sin
  equipo".
- **No incluye:** cambios a la matemática del modelo; nuevos Sheets o columnas;
  nuevos permisos CSP/`connect-src`; charts (este tab es tabular/numérico).

## Arquitectura

### 1. Markup (`index.html`)

- Botón nuevo en `#tabBar`:
  `<button class="tab-btn" data-action="setTab" data-arg="tabReemplazo">conservar vs reemplazar<span class="tab-badge" id="reemplazoBadge">—</span></button>`
- Panel nuevo `<div class="tab-panel" id="tabReemplazo">` al final del bloque de
  tabs (después de `#tabService`). Contiene el contenedor raíz
  `<div id="repRoot" class="rep-console">cargando…</div>` que se rellena por JS.
- Bloque `<style>` nuevo con el namespace `rep-*` (dentro del `<style>` grande
  existente, sección claramente comentada). Sin fonts nuevas.

### 2. Motor de cálculo (`js/app.js`)

Bloque autocontenido con las funciones del modelo, adaptadas para recibir un
objeto `cfg` como parámetro (en vez de una constante global `CONFIG`):

```
valorHora(c) · costoViejo(c) · costoNuevo(c) · riesgoCola(c)
evaluar(c) · vidaBreakEven(c) · probBreakEven(c, costoRotura)
```

La matemática es **idéntica** al código provisto por Marcos. Único cambio:
`CONFIG` deja de ser constante y `evaluar` recibe `cfg`. Todos los montos de
salida en ARS (el modelo ya mezcla ARS nativos y conversión por `dolar`).

### 3. Estructura de datos del form (`repState`)

Objeto en memoria que espeja `CONFIG`:

```js
{
  codN: 'RN03' | null,            // equipo elegido, null = manual
  mesesHorizonte, 
  costos: { neumaticos, serviceOficial, fallaTotal, itemsUnicos },
  horas:  { improductivasViejo, serviceYGomas },
  alquilerMensual, horasProductivasMes, factorServiceNoOficial, dolar,
  nuevo:  { precioUSD, residualPct, vidaUtilAnios, tasaAnual,
            tradeInPct, plazoFinancMeses, reparacionesMensual },
  modosFalla: [ { nombre, p, costo }, ... ],
}
```

### 4. Flujo de datos

```
entrar al tab (setTab tabReemplazo)
   └─ si faltan globales de costos → await cargarCostosDowntime()
   └─ renderReemplazo(): dibuja consola, puebla dropdown desde _equiposOrdenados
seleccionar equipo (change)
   └─ repSelectEquipo(codN):
        derivar defaults del panel (ver mapeo)
        overlay de localStorage[codN] si existe
        set repState, re-render inputs, recalc
editar cualquier input (input)
   └─ repRecalc(): lee inputs → repState → evaluar(repState) → pinta resultado
        + persiste repState en localStorage bajo su codN
agregar/quitar modo de falla (click)
   └─ repAddFalla() / repDelFalla(i) → recalc
```

### 5. Mapeo de autoprellenado

Al elegir un equipo `codN`, se derivan (todo override-able por el usuario):

| Campo `repState` | Fuente |
|---|---|
| `mesesHorizonte` | nº de `ym` distintos con dato correctivo para `codN` en `_costosCorrPorMes` ∪ `_horasCorrPorMesYEquipo` |
| `costos.fallaTotal` | Σ sobre `ym` de `_costosCorrPorMes[ym][codN]` |
| `horas.improductivasViejo` | Σ sobre `ym` de `_horasCorrPorMesYEquipo[ym][codN]` |
| `alquilerMensual` | `_costosCfg.alq[codN] × _costosCfg.tc` (ARS/mes) |
| `horasProductivasMes` | `_costosCfg.horasMes` |
| `dolar` | `_costosCfg.tc` |

**Manual / defaults** (el panel no los tiene por equipo):
`costos.serviceOficial=0`, `costos.itemsUnicos=0`, `costos.neumaticos=0`,
`horas.serviceYGomas=0`, `factorServiceNoOficial=1/3`, y el bloque `nuevo`
completo (`precioUSD=180000`, `residualPct=0.5`, `vidaUtilAnios=10`,
`tasaAnual=0`, `tradeInPct=0.5`, `plazoFinancMeses=24`, `reparacionesMensual=0`).
`modosFalla` arranca con las 5 filas de la CONFIG original (Caja, Motor,
Diferencial, Turbo/inyección, Embrague pesado), editables.

**Consistencia (sin doble conteo):** el `fallaTotal` del panel proviene de
correctivo `RAZÓN=Reparación`, que **ya excluye neumáticos y service**. Por eso
`neumaticos` y `serviceOficial` son líneas separadas manuales, no derivadas.
`itemsUnicos` se resta de `fallaTotal` (fórmula original): ahí el usuario carga
a mano las reparaciones one-off grandes que quiere excluir del corriente.

**Sin alquiler cargado:** si `_costosCfg.alq[codN]` no existe, `alquilerMensual`
queda en 0 y se muestra una advertencia (el costo de oportunidad no se computa;
sugerir cargar el alquiler en la pestaña ALQUILERES del sheet de costos).

### 6. Persistencia

`localStorage`, un solo key: `ingecov_reemplazo_v1`, valor JSON
`{ [codN]: repState }`. Al seleccionar un equipo: se parte de los defaults
derivados del panel y se hace overlay del estado guardado (así los overrides
—precio 0km, modos de falla— sobreviven recargas). Guardado en cada `repRecalc`.
Manejo tolerante a JSON inválido (try/catch → ignora y arranca limpio).
El modo "manual / sin equipo" persiste bajo la clave `'__manual__'`.

### 7. Resultado mostrado

- **Veredicto:** `CONSERVAR` (verde) si `netoMensual > 0`, `REEMPLAZAR` (ámbar)
  si ≤ 0. Regla del modelo: neto = `nuevoTotal − viejoTotal`, >0 ⇒ conservar.
- **Libro mayor SEGUIR:** service, falla corriente, neumáticos, oportunidad,
  + riesgo esperado mensual → subtotal `viejoTotal`.
- **Libro mayor COMPRAR:** depreciación, interés, service, reparaciones,
  neumáticos, oportunidad → subtotal `nuevoTotal`.
- **Neto mensual** y veredicto.
- **Métricas secundarias:** umbral de riesgo mensual y anual, factor de escala
  de riesgo, cuota 24m (flujo de caja), vida de indiferencia (años).
- Todos los montos con `_fmtARS` (formato es-AR con miles).

## Integración con patrones del panel (seguridad)

- **CSP:** sin `<script>` inline, sin `onclick=`. Todo por delegación
  `data-action` + entradas nuevas en el map `ACTIONS`.
- **Trusted Types:** todo render vía `setHTML(el, html\`...\`)` / `RawHTML`.
  Nunca `innerHTML=` directo.
- **`localStorage`** no requiere cambios de CSP (no es `connect-src`).
- **Sin dependencias externas nuevas** → sin cambios en `sw.js` ni SRI.
- **`normCod`** para comparar códigos de equipo siempre.

### Acciones nuevas en `ACTIONS`

| Acción | Evento | Función |
|---|---|---|
| `repSelectEquipo` | change | `repSelectEquipo(codN)` |
| `repRecalc` | input | `repRecalc()` |
| `repAddFalla` | click | `repAddFalla()` |
| `repDelFalla` | click | `repDelFalla(i)` (i vía `data-arg`) |
| `repReset` | click | `repReset()` (limpia overrides del equipo actual) |

`setTab` ya existe; se extiende su hook para disparar la carga perezosa de
datos de costos y `renderReemplazo()` la primera vez que se abre el tab.

## Dependencias a verificar en implementación

- Que `window._costosCorrPorMes` y `window._horasCorrPorMesYEquipo` estén
  efectivamente poblados globalmente (se leen con fallback en
  `renderCostosDowntime`; confirmar el punto donde se asignan).
- Que `cargarCostosDowntime()` sea idempotente y re-invocable para el prefetch
  perezoso del tab.

## Testing / verificación

Sin suite automatizada (el panel no tiene una). Verificación manual:

1. `node --check js/app.js` — sintaxis.
2. Servir local (`python -m http.server 8765` en la raíz del clon), abrir,
   F12 → Console limpia (sin errores CSP ni Trusted Types).
3. Abrir el tab: dropdown poblado, estética separada del dashboard.
4. Elegir un equipo con datos correctivos conocidos (p.ej. de la tabla del tab
   de costos): verificar que `fallaTotal` y `improductivasViejo` autoprellenados
   coinciden con lo que muestra el tab de costos.
5. Editar inputs → el resultado recalcula en vivo; el veredicto cambia de lado
   al cruzar el break-even.
6. Recargar la página → los overrides del equipo persisten.
7. Elegir "manual / sin equipo" → todos los campos en default, editables.
8. Equipo sin alquiler cargado → advertencia, oportunidad en 0, sin crash.
9. Tema claro/oscuro → legible en ambos.

## Riesgos / notas

- El modelo tiene **muchos supuestos** (modos de falla, precio 0km, vida útil).
  El tab los expone todos editables; no pretende ser una verdad automática sino
  una planilla para razonar el recambio con los números reales del equipo.
- El interés financiero del modelo original solo aplica si `tasaAnual > 0`;
  con tasa 0 el costo de capital es solo la depreciación (comportamiento
  preservado).

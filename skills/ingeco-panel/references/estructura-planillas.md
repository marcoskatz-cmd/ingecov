# Estructura de las planillas mensuales

Cargar este archivo cuando vayas a modificar la lógica de parseo del Apps Script (cambiar columnas, filas, headers, etc.) o cuando necesites entender cómo están armadas las pestañas individuales.

## Planilla de TRABAJO (una por equipo, dentro de archivos `TRABAJOS REALIZADOS <MES>`)

```
       A                          B                        C..G
   ┌─────────────────────┬──────────────────────────────────────┐
1  │     #VALUE!         │   TRABAJOS DE MANTENIMIENTO Y REP    │  ← título mergeado, A1:A2 tiene fórmula rota
2  │                     │   <título continúa...>               │
3  │                     │                                      │
4  │  N° PLANILLA        │   <número>                           │  ← B4 = ID de la planilla
5  │                     │                                      │
6  │  EQUIPO             │   <nombre del equipo>                │  ← B6 = descripción
7  │  CÓDIGO             │   <código de equipo>                 │  ← B7 = código (KEY)
8  │  N° SERIE/N° PATENTE│   <patente o serie>                  │  ← B8
9  │                     │                                      │
10 │  FECHA TRABAJO      │ LUGAR │ PERSONAL │ DESC │ T.PAR │ T.TRA │ RAZÓN   ← headers tabla
11 │  14/1/2026          │ Predio│ Mecánicos│ ...  │ 0 hs  │ 0,5 hs│ ...     ← trabajos
12 │  15/1/2026          │ Taller│ Mecánicos│ ...  │ 0,5 hs│ 2 hs  │ ...
   │  ... (crece hacia abajo)                                              │
   └──────────────────────────────────────────────────────────────────────┘
```

Constantes en el Apps Script:
- `ROW_NRO_PLANILLA: 4`, `ROW_EQUIPO: 6`, `ROW_CODIGO: 7`, `ROW_SERIE: 8`
- `COL_VALOR_KV: 2` (columna B)
- `ROW_INICIO_DATOS: 11`
- `N_COLS_TABLA: 7` (A a G)

Nombre de la pestaña: `PLANILLA <CÓDIGO>` con espacio (ej: `PLANILLA CMT-17`).
Pestañas a ignorar: cualquiera que NO empiece con `PLANILLA `.

## Planilla de ENTREGA DE REPUESTOS (una por entrega, dentro de archivos `ENTREGAS DE REPUESTOS <MES>`)

```
       A                          B..E
   ┌─────────────────────┬────────────────────────────────────┐
1  │     #VALUE!         │   ENTREGA DE REPUESTOS 2026        │  ← título mergeado
2  │                     │                                    │
3  │                     │                                    │
4  │  N° ENTREGA         │   <número, igual al nombre pestaña>│  ← B4
5  │  N° PEDIDO ENTREGADO│   <N° pedido si aplica>            │  ← B5
6  │  FECHA              │   <fecha entrega>                  │  ← B6
7  │                     │                                    │
8  │  EQUIPO             │   <nombre del equipo>              │  ← B8
9  │  CÓDIGO             │   <código de equipo>               │  ← B9
10 │  N° SERIE/N° PATENTE│   <patente o serie>                │  ← B10
11 │                     │                                    │
12 │  COSTO ENTREGA      │   <monto en $>                     │  ← B12
13 │  RAZÓN ENTREGA      │   <texto>                          │  ← B13
14 │                     │                                    │
15 │  CANTIDAD │ DESCRIPCIÓN │ CÓDIGO │ PROVEEDOR │ OSBERVACIÓN  ← header items (sic, "OSBERVACIÓN")
16 │  <cant>   │ <desc>      │ <cod>  │ <prov>    │ <obs>        ← items
17 │  ...      │ ...         │ ...    │ ...       │ ...
   │  (filas variables hasta donde se ingresen items)
N  │  RESPONSABLE ENTREGA │ <nombre del responsable, valor a la derecha>
   └────────────────────────────────────────────────────────────┘
```

Constantes en el Apps Script:
- `ROW.NRO_ENTREGA: 4`, `ROW.NRO_PEDIDO: 5`, `ROW.FECHA: 6`
- `ROW.EQUIPO: 8`, `ROW.CODIGO: 9`, `ROW.SERIE: 10`
- `ROW.COSTO: 12`, `ROW.RAZON: 13`
- `COL_KV: 2` (columna B)
- `ROW_INICIO_ITEMS: 16`
- `N_COLS_ITEMS: 5` (A a E)

Nombre de la pestaña: número entero (ej: `780`, `611`). Numeración secuencial GLOBAL a través de todos los meses (enero: 506-558, febrero: 559-630, marzo: 631-756, abril: 757-885, mayo: 886+).

Pestañas a ignorar (detección por regex `^\d+$`):
- `RESUMEN`
- `Hoja1`, `Hoja2`, etc. (pestañas vacías sobrantes)

La fila de RESPONSABLE ENTREGA es **dinámica**: depende de cuántos items tiene la entrega. Por eso el Apps Script la busca recorriendo la columna A desde la fila 16, buscando el texto "RESPONSABLE".

## Estructura del PANEL consolidado (output de los Apps Scripts)

### PANEL_TRABAJOS

| Col | Header |
|-----|--------|
| A | MES |
| B | AÑO ARCHIVO |
| C | N° PLANILLA |
| D | EQUIPO |
| E | CÓDIGO |
| F | N° SERIE/PATENTE |
| G | FECHA TRABAJO |
| H | LUGAR TRABAJO |
| I | PERSONAL TRABAJO |
| J | DESCRIPCIÓN TRABAJOS |
| K | TIEMPO PARADA |
| L | TIEMPO TRABAJO |
| M | RAZÓN TRABAJO |

### PANEL_REPUESTOS

| Col | Header |
|-----|--------|
| A | MES |
| B | AÑO ARCHIVO |
| C | N° ENTREGA |
| D | N° PEDIDO ENTREGADO |
| E | FECHA |
| F | EQUIPO |
| G | CÓDIGO |
| H | N° SERIE/PATENTE |
| I | COSTO ENTREGA |
| J | RAZÓN ENTREGA |
| K | RESPONSABLE ENTREGA |
| L | CANTIDAD ITEMS |
| M | ITEMS DETALLE |

`ITEMS DETALLE` es un string concatenado con formato:
```
<cantidad>x <descripcion> (cód <codigo>, prov <proveedor>, obs: <observacion>) | <siguiente item>
```

Ejemplos reales:
- `1x Polea grande con centro chavetero (cód -, prov VITALCROM, obs: Fabricación según muestra)`
- `20 litrosx Aceite 15W40 Diesel (cód 7200006053, prov ECONOVO, obs: -)`
- `0,4 metrosx Goma en plancha sintética de 3 mm (cód -, prov Tucumán Goma, obs: -)`
- `-x Service (cód -, prov Simonetto Lubricantes, obs: -)`

El HTML reparsea este string con `parseItemsDetalle()` para reconstruir el array de items estructurado.

## Errores comunes en los datos fuente

Las planillas son llenadas a mano por los operarios. Errores frecuentes observados:

- **N° ENTREGA como fecha**: B4 quedó con `19/03/2026` en lugar del número. El Apps Script usa el nombre de la pestaña como fallback, así que en el panel queda el nombre correcto pero la columna B no aporta nada.
- **N° ENTREGA duplicado**: dos pestañas con el mismo nombre o el mismo valor en B4. El segundo aparece con el mismo número en el panel; en el HTML, `_itemsPorEntrega[nro]` queda con los items de la última leída.
- **N° ENTREGA pegado a otro**: `66226` cuando debería ser `626`. Probablemente un copy-paste accidental.
- **Tabla de items vacía**: la entrega tiene kv (costo, fecha) pero ningún item cargado. En el panel, `ITEMS DETALLE` queda vacío.
- **Header de tabla corrido**: la tabla de items empieza en una fila distinta a la 16 (raro, pero pasó). El parser actual asume fila 16 hardcodeada.

Cuando algo en el HTML "no carga", lo primero a verificar es siempre la planilla original, no el código. La cadena es: planilla → Apps Script → panel → HTML. El eslabón más débil es la planilla.

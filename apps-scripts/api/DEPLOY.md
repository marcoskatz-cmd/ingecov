# INGECO Panel API — instrucciones de deploy

Lo que tenés que hacer **una sola vez** para poner el proyecto en marcha. Estimado: ~15 min.

Después, agregar usuarios nuevos al panel es solo editar una Property (sin redeploy).

---

## 1. Crear el Sheet "INGECO Panel Mirror" en tu Drive (~1 min)

Este Sheet es donde el sync va a volcar el espejo del .xlsx de combustible livianos.

1. Abrir Drive con tu cuenta `marcoskatz@grupoingeco.com.ar`.
2. New → Google Sheets. Nombrarlo: **INGECO Panel Mirror**.
3. Renombrar la pestaña "Sheet1" / "Hoja 1" a: **COMBUSTIBLE_LIVIANOS_MIRROR** (mayúsculas, con guiones bajos).
4. Anotar el **ID del Sheet**: lo ves en la URL, entre `/d/` y `/edit`. Algo como `1AbC...XyZ`.

---

## 2. Crear el proyecto Apps Script (~2 min)

1. Abrir [script.google.com](https://script.google.com) (logueado como `marcoskatz@grupoingeco.com.ar`).
2. **New project**. Nombrarlo: **INGECO Panel API**.
3. Borrar el contenido por defecto del archivo `Código.gs`.
4. Para cada archivo `.gs` del repo (`apps-scripts/api/`):
   - En el editor, click en el `+` al lado de "Files" → "Script".
   - Nombrarlo con el mismo nombre del archivo del repo (sin la extensión `.gs`).
   - Pegar el contenido del archivo.

Archivos a crear, en este orden:

```
00_config
01_auth
02_router
03_cache
10_endpoints
20_consolidador_trabajos
21_consolidador_repuestos
22_sync_combustible_livianos
99_setup
```

El archivo `Código.gs` original podés borrarlo (click derecho → Delete) o renombrarlo a alguno de los de arriba.

---

## 3. Habilitar el servicio Drive API (~30 seg)

El sync de combustible livianos usa la Advanced Drive Service.

1. Panel izquierdo del editor → **Services** (el ícono `+`).
2. Buscar **Drive API**, click Add.
3. Verificar que la identifier sea `Drive`. Versión: v3.

---

## 4. Configurar Script Properties (~3 min)

1. **File → Project Properties → Script Properties** (en editores nuevos: ⚙️ Project Settings → Script Properties).
2. Agregar las siguientes properties (Add script property):

| Property | Valor |
|---|---|
| `ALLOWED_EMAILS` | `marcoskatz@grupoingeco.com.ar,nicobdallagata@gmail.com` (sumá emails separados por coma a medida que sumes usuarios) |
| `XLSX_COMBUSTIBLE_LIVIANOS_ID` | `16KmV7k9gsqBgtd3YpesD2w9Hq2BEasac` |
| `MIRROR_SHEET_ID` | **El ID del Sheet que creaste en el paso 1** |
| `CACHE_TTL_SECONDS` | `1800` |
| `MIRROR_STRATEGY` | `export` (o `copy` si Drive.Files.export no extrae la pestaña correcta — ver paso 7) |

3. Save.

---

## 5. Correr `checkSetup()` para verificar (~30 seg)

1. En el editor, abrir el archivo `99_setup`.
2. En el dropdown de funciones (arriba), seleccionar `checkSetup`.
3. Click **Run**.
4. Primera vez te va a pedir autorizar permisos:
   - **Review permissions** → tu cuenta → **Advanced** → **Go to INGECO Panel API (unsafe)** → **Allow**.
   - Esto es normal y necesario para que el script lea/escriba Sheets y Drive.
5. Revisar el log (View → Logs o Ctrl+Enter):
   - Properties: todas deben tener valor (no `(faltante)`).
   - Sheets: todos `OK`.
   - Mirror: `OK` y pestaña `COMBUSTIBLE_LIVIANOS_MIRROR` debe existir.
   - Auth: tu cuenta + whitelist con tus emails.

Si todo está en orden, seguí. Si algo falla, revisar las Properties y permisos.

---

## 6. Crear los triggers (~30 seg)

1. Mismo archivo `99_setup`.
2. Función `setupTriggers` → Run.
3. Verificar en **Triggers** (panel izquierdo, ícono de reloj) que aparecen tres triggers cada 30 min:
   - `actualizarPanelTrabajos`
   - `actualizarPanelRepuestos`
   - `syncCombustibleLivianos`

---

## 7. Probar el sync de combustible livianos (~2 min)

1. En el editor, abrir `22_sync_combustible_livianos`.
2. Función `syncCombustibleLivianos` → Run.
3. View → Logs: debería decir algo como `[combustible_livianos export] N filas volcadas al mirror`.
4. Abrir el Sheet "INGECO Panel Mirror" → pestaña `COMBUSTIBLE_LIVIANOS_MIRROR`. Verificar que tiene datos.
5. **Si la pestaña Mirror tiene los datos correctos (cargas de combustible)**: ✅ seguir.
6. **Si los datos son de otra pestaña del .xlsx** (no "Control General"): cambiar `MIRROR_STRATEGY` de `export` a `copy` en Script Properties, y agregar otra property `XLSX_COMBUSTIBLE_LIVIANOS_TAB` con el valor `Control General`. Re-correr el sync.

---

## 8. Deploy como Web App (~2 min)

1. **Deploy → New deployment** (botón azul, arriba derecha).
2. Click ⚙️ junto a "Select type" → **Web app**.
3. Configurar:
   - **Description**: `INGECO Panel API v1`
   - **Execute as**: `Me (marcoskatz@grupoingeco.com.ar)`
   - **Who has access**: `Anyone with Google account`
4. Click **Deploy**. Google te puede pedir autorizar permisos otra vez.
5. **Copiar el "Web app URL"**. Algo como `https://script.google.com/macros/s/AKfycb.../exec`.

---

## 9. Probar la API a mano (~1 min)

Abrir en el navegador (logueado con tu cuenta):

```
<WEB_APP_URL>?ep=whoami
```

Debería devolver:

```json
{
  "ok": true,
  "endpoint": "whoami",
  "data": { "email": "marcoskatz@grupoingeco.com.ar", "allowed": true }
}
```

Probar también un endpoint con datos:

```
<WEB_APP_URL>?ep=pedidos
```

Debería devolver un JSON con `data.pendientes` y `data.entregados` como arrays.

Si todo OK, **avisame** y switcheamos el panel a usar la API (paso siguiente — eso lo hace Claude editando `js/app.js`).

---

## 10. Switchear el panel a la API

Ya está preparado en `js/app.js`. Yo (Claude) lo hago cuando vos confirmes que la API responde bien:

1. Pegar el URL del Web App en `js/app.js` como `API_URL`.
2. Cambiar `USE_API = true`.
3. Commit + push. GitHub Pages redeploya en 1-3 min.

Después validamos en el browser que el panel sigue funcionando idéntico, pero ahora vía la API en lugar de gviz.

---

## 11. Privatizar los Sheets (después de validar)

Una vez que el panel funcione contra la API y vos lo apruebes durante unos días, cambiar el share de estos Sheets:

```
[ ] 1VFJwFLLEaOE9tTuwah7QkaDTrYkeYtOH8brUgSyHeFY  (pedidos)
[ ] 1GpP2ejMVXncr2OLmKK_IP-zqr5AARi1Q3YdQIPlsUUE  (indicadores)
[ ] 1I4ejRAoMnpou-cRvefgfVCzPg9Obkmi2              (codigos)
[ ] 1TUEoOul4SI5O323LcMq2VkaxdcTMfTmZce7NToGESfc  (repuestos_hist)
[ ] 1cNWQ44UEDiotHyB65BfTMcFuOCfQXYQoSNNAdAKTsy8  (trabajos_reg)
[ ] 1zB9q0e9kxRKe52-I0u5Dqg7PUSE_nlxi3IYn7pxF0Iw  (service)
[ ] 19dqJ-tcdmXiOns99mJgMMmZNDT3kKS7EQXwHd7VDILc  (combustible)
[ ] 1y6pqbXscej3139lkImWJsJHeJvFa0B5sneICEyyNPmI  (programaService)
```

Para cada uno:
- Abrir el Sheet → Share (botón arriba a la derecha).
- En "General access" cambiar "Anyone with the link" → "Restricted".
- Save.

El `.xlsx` de combustible livianos (`16KmV7k9gsqBgtd3YpesD2w9Hq2BEasac`) sigue siendo del operario — solo asegurate que esté compartido con vos como viewer/editor (para que el Apps Script pueda leerlo).

---

## 12. Borrar los scripts viejos (después de privatizar)

Una vez privatizados y todo funcionando:

- Sheet de trabajos (`1cNWQ44UEDiotHyB65BfTMcFuOCfQXYQoSNNAdAKTsy8`): Extensions → Apps Script → borrar el contenido del proyecto y los triggers asociados.
- Sheet de entregas (`1TUEoOul4SI5O323LcMq2VkaxdcTMfTmZce7NToGESfc`): idem.
- Sheet de service (`1zB9q0e9kxRKe52-I0u5Dqg7PUSE_nlxi3IYn7pxF0Iw`): **NO TODAVÍA** — las alertas de service viven ahí y NO están migradas en esta fase. Lo hacemos en una iteración posterior.

---

## Mantenimiento futuro

### Agregar un usuario nuevo al panel

1. File → Project Properties → Script Properties → `ALLOWED_EMAILS`.
2. Agregar el email al final, separado por coma.
3. Save. **No requiere redeploy** — funciona en la próxima request.

### Cambiar el .xlsx de combustible livianos (si el operario lo recrea)

1. Tomar el ID nuevo de Drive.
2. File → Project Properties → Script Properties → editar `XLSX_COMBUSTIBLE_LIVIANOS_ID`.
3. Correr `syncCombustibleLivianos` manualmente para validar.

### Forzar refresh manual del panel

Desde el panel: botón "sync" del header (ya lo hace automáticamente cuando esté el flag activo).
Desde la API a mano: `<WEB_APP_URL>?ep=refresh&panel=all`.

### Re-deploy del Web App

Solo necesario si cambiás el código `.gs` (no para cambios en Properties).

1. Deploy → Manage deployments.
2. Click ✎ junto al deploy activo.
3. Version → **New version**.
4. Deploy.

**Importante**: el URL no cambia entre versions. Cambia si hacés "New deployment" (Deploy → New deployment). Si cambia el URL, hay que actualizar `API_URL` en `js/app.js` y pushear.

### Si el panel deja de funcionar

Diagnóstico rápido:
1. En el browser, F12 → Console: buscar errores.
2. Abrir `<WEB_APP_URL>?ep=whoami` directo en el navegador → ¿devuelve JSON correcto?
3. Ir al editor del Apps Script → Executions (panel izquierdo, ícono de log) → revisar errores recientes.
4. Properties: ¿están todas seteadas?

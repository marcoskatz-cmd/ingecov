# Deploy fast path (~5 min)

Versión condensada del [DEPLOY.md](./DEPLOY.md). Si querés entender qué hace cada paso, lee ese. Acá van solo los clicks.

**Antes de arrancar**: tener abierto Chrome, logueado con `marcoskatz@grupoingeco.com.ar`.

---

## Paso 1 · Crear el Sheet "INGECO Panel Mirror" (~30 seg)

1. Ir a [drive.google.com](https://drive.google.com) → **New → Google Sheets**.
2. Nombre del Sheet: `INGECO Panel Mirror`.
3. Renombrar la pestaña por defecto a: `COMBUSTIBLE_LIVIANOS_MIRROR` (con guiones bajos, todo mayúsculas).
4. **Anotar el ID del Sheet** (lo ves en la URL entre `/d/` y `/edit`).

---

## Paso 2 · Crear el proyecto Apps Script (~1 min)

1. Ir a [script.google.com](https://script.google.com) → botón azul **New project**.
2. Arriba a la izquierda donde dice "Untitled project" → renombrar a `INGECO Panel API`.
3. En el editor, el archivo por defecto `Code.gs`:
   - Seleccionar TODO el contenido (Ctrl+A) y borrarlo.
   - Pegar el contenido completo de `apps-scripts/api/INGECO_Panel_API_all_in_one.gs` (UN solo paste).
4. **Ctrl+S** para guardar.

---

## Paso 3 · Habilitar Drive API (~20 seg)

1. Panel izquierdo del editor → ícono **Services** (un `+` al lado de "Services").
2. Buscar **Drive API** → click Add.
3. Verificar: identifier `Drive`, versión `v3`. OK.

---

## Paso 4 · Setear Script Properties (~1 min)

1. Panel izquierdo → ícono ⚙️ **Project Settings**.
2. Scroll hasta "Script Properties" → click **Add script property**.
3. Agregar 5 properties (clic "Add" entre cada una):

| Property | Value |
|---|---|
| `ALLOWED_EMAILS` | `marcoskatz@grupoingeco.com.ar,nicobdallagata@gmail.com` |
| `XLSX_COMBUSTIBLE_LIVIANOS_ID` | `16KmV7k9gsqBgtd3YpesD2w9Hq2BEasac` |
| `XLSX_CODIGOS_EQUIPOS_ID` | `1I4ejRAoMnpou-cRvefgfVCzPg9Obkmi2` |
| `MIRROR_SHEET_ID` | **(pegar acá el ID que anotaste en el paso 1)** |
| `CACHE_TTL_SECONDS` | `1800` |
| `MIRROR_STRATEGY` | `export` |

4. Click **Save script properties**.

---

## Paso 5 · Correr `setupTriggers` y autorizar permisos (~2 min)

1. Volver al editor (panel izquierdo → ícono `<>`).
2. En el dropdown de funciones (arriba, al lado del botón Run) → seleccionar `setupTriggers`.
3. Click **Run**.
4. Va a aparecer **"Authorization required"** → click **Review permissions**.
5. Elegir tu cuenta `marcoskatz@grupoingeco.com.ar`.
6. Si aparece "Google hasn't verified this app" → click **Advanced** → click **Go to INGECO Panel API (unsafe)**.
7. **Allow** a la lista de permisos (Drive, Sheets, Triggers, etc.).
8. Al volver al editor, click **Run** otra vez si la función no corrió.
9. View → **Executions** (panel izquierdo, ícono de log) → ver que `setupTriggers` corrió OK.

---

## Paso 6 · Verificar con `checkSetup` (~30 seg)

1. Dropdown de funciones → `checkSetup` → Run.
2. View → **Executions** → click en la ejecución reciente → ver logs.
3. Todos los Sheets deben decir `OK ...`. Si alguno dice `ERROR`, copiá el mensaje y mandámelo.

---

## Paso 6.5 · Probar el sync de CÓDIGOS DE EQUIPOS (~1 min)

1. Dropdown de funciones → `syncCodigosEquipos` → Run.
2. View → Executions → ver logs. Tiene que decir algo como `[codigos] N filas volcadas | 4 pestañas OK / 0 faltantes`.
3. Abrir "INGECO Panel Mirror" en otra pestaña — deben haberse creado las 4 pestañas (VIALES, ASFALTO Y TRITURACIÓN / TRANSPORTE LIVIANO / TRANSPORTE PESADO / SOPORTE) con datos.

Si dice "pestañas faltantes": el .xlsx original cambió nombres de pestaña. Avisame y ajustamos `CODIGOS_TABS` en el código.

---

## Paso 7 · Probar el sync de combustible livianos (~1 min)

1. Dropdown de funciones → `syncCombustibleLivianos` → Run.
2. View → Executions → ver logs. Tiene que decir algo como `[combustible_livianos export] N filas volcadas al mirror`.
3. Abrir el Sheet "INGECO Panel Mirror" en otra pestaña → debe tener datos en la pestaña `COMBUSTIBLE_LIVIANOS_MIRROR`.

Si no tiene datos correctos:
- Volver a Script Properties → cambiar `MIRROR_STRATEGY` de `export` a `copy`.
- Agregar otra Property: `XLSX_COMBUSTIBLE_LIVIANOS_TAB` = `Control General`.
- Volver al editor → Run `syncCombustibleLivianos` de nuevo.

---

## Paso 8 · Deploy como Web App (~1 min)

1. Esquina arriba a la derecha → **Deploy** → **New deployment**.
2. Al lado de "Select type" → ⚙️ → marcar **Web app**.
3. Configurar:
   - **Description**: `v1`
   - **Execute as**: `Me (marcoskatz@grupoingeco.com.ar)`
   - **Who has access**: `Anyone with Google account` ← MUY IMPORTANTE, no "Anyone" sin login
4. Click **Deploy**.
5. **Copiar la "Web app URL"** que aparece. La pegás en el chat conmigo.

---

## Cuando me mandes la URL

Yo hago en 30 seg:
1. Pegar URL en `js/app.js` como `API_URL`.
2. Cambiar `USE_API` a `true`.
3. Commit + push.
4. Validar end-to-end en preview local que el panel carga datos vía API.
5. Avisarte que está activo y a partir de ahí el panel está protegido.

---

## Si algo falla

Cuanto más específico el mensaje de error, más rápido te ayudo. Copiar y mandar:
- Texto del error (de la pantalla, no screenshot a menos que sea muy raro).
- En qué paso pasó.
- Qué función estabas corriendo (si es paso 5/6/7).

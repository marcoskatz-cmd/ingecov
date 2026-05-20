# Apps Scripts del panel INGECOV

Scripts auxiliares que viven en los Sheets maestros del sistema. No se ejecutan en el browser ni en GitHub Pages — son código de Google Apps Script.

## alertas-service.gs

**Vive en**: Sheet maestro de service (`1zB9q0e9kxRKe52-I0u5Dqg7PUSE_nlxi3IYn7pxF0Iw`), pestaña `PANEL_PROGRAMA`.

**Qué hace**: lee el panel, **cruza con la planilla de combustible para obtener la hr/km real más actualizada de cada equipo** (igual que el panel HTML), detecta equipos que cruzaron a estado crítico desde la última corrida, y manda un email con la lista.

**Por qué cruza con combustible**: el form de combustible se llena mucho más seguido que las planillas de service. Si la última carga es más reciente que el `ULT_FECHA` del service, su horómetro/odómetro es la mejor lectura disponible — y por lo tanto el que define si el equipo está crítico o no. Sin este cruce, equipos con horómetro actualizado solo en combustible no aparecen como críticos.

**Diferencia clave vs revisar el panel a mano**: solo te notifica de los *nuevos* críticos. Si un equipo ya está en rojo desde hace una semana y todavía no lo arreglaron, no te llega un mail nuevo cada día. Esto evita la fatiga de notificaciones.

### Setup (primera vez)

1. Abrir el Sheet maestro de service en el navegador.
2. `Extensiones → Apps Script` (abre un nuevo tab).
3. Borrar el contenido por defecto del archivo `Código.gs`.
4. Pegar todo el contenido de `alertas-service.gs`.
5. Guardar (Ctrl+S). Ponele el nombre del proyecto que prefieras (ej. "INGECOV Alertas").
6. **Ejecutar `chequearAlertasService` una vez desde el editor** (botón ▶). Google va a pedir autorización — autorizá. Permisos requeridos:
   - Leer el Sheet maestro
   - Enviar emails desde tu cuenta de Google
7. Volver al Sheet, recargar. Va a aparecer un menú nuevo "INGECOV" en la barra superior.

### Crear el trigger temporizado

8. En el editor de Apps Script: panel izquierdo, icono de reloj (⏰ Triggers / Activadores).
9. `+ Agregar activador` (abajo a la derecha):
   - Función: `chequearAlertasService`
   - Implementación: `Principal`
   - Origen del evento: `Basado en tiempo`
   - Tipo de activador: `Temporizador diario`
   - Hora: `Entre las 8:00 a. m. y las 9:00 a. m.` (o lo que prefieras)
10. Guardar.

A partir de ese momento, cada mañana corre solo.

### Funciones disponibles desde el menú INGECOV

| Item | Qué hace |
|---|---|
| Chequear alertas service | Corrida normal. Manda email si hay nuevos críticos. |
| Probar alerta (sin actualizar snapshot) | Manda email con TODOS los críticos actuales como si fueran nuevos. No toca el snapshot. Útil para verificar que el formato del mail está bien. |
| Ver snapshot actual | Loguea el estado guardado (qué equipos están marcados como ya-notificados). Mirar `Ejecuciones → Registros` en el editor de Apps Script. |
| Resetear snapshot | Borra el snapshot. La próxima corrida va a considerar TODOS los críticos como nuevos. |

### Destinatarios — **editables desde el Sheet, NO desde el código**

La primera vez que corre, el script crea automáticamente una pestaña llamada `CONFIG_ALERTAS` con esta estructura:

| Parámetro | Valor |
|---|---|
| Destinatarios (separados por coma) | `marcoskatz@grupoingeco.com.ar, nicobdallagata@gmail.com` |
| URL del panel | `https://marcoskatz-cmd.github.io/ingecov/` |
| Activado (TRUE/FALSE) | `TRUE` |

Para cambiar a quién avisa: abrí la pestaña `CONFIG_ALERTAS` y editás la celda `B2`. Separá emails con coma. Los cambios toman efecto en la **próxima corrida** (no hay que volver al editor de Apps Script).

Atajo: menú `INGECOV → Editar destinatarios (CONFIG_ALERTAS)` te lleva directo a la celda y te muestra un recordatorio.

**Para pausar las alertas temporalmente** (sin borrar el trigger): poné `FALSE` en la celda de "Activado". El trigger sigue corriendo, no manda mail. Volvé a `TRUE` cuando quieras reactivar.

### Lógica de clasificación

Espejo exacto de `clasificarServicio()` del panel HTML, **incluido el cruce con combustible**:

1. Para cada equipo, se busca la última carga de combustible con horómetro/odómetro funcional ("Sí" en el campo de estado).
2. Si la fecha de esa carga es **más reciente** que la `ULT_FECHA` del panel de service, se usa el horómetro/odómetro del combustible como "hr/km actual". Si no, se usa el del panel.
3. La clasificación es:
   - `rojo` = `(EST_HRKM - hr_actual) <= RANGO_CRITICA` (default 50 hr/km si no está cargado).
   - `amarillo` = `(EST_HRKM - hr_actual) <= RANGO_INTERMEDIA` (default 150).
   - `verde` = el resto.
   - `gris` = falta dato (no se considera crítico ni se notifica).

En el email, los equipos cuya hr/km salió de combustible muestran un pill `vía combustible` para que sepas de dónde vino el dato.

Si en el HTML cambia esa lógica (umbrales, fuentes, algoritmo), hay que actualizar acá también — están desacoplados.

### Diferencia con el resto de scripts del sistema

- `actualizarPanelTrabajos` y `actualizarPanelRepuestos` (los consolidadores existentes) viven en sus respectivos Sheets maestros y **escriben** datos al panel.
- `alertas-service` vive en el Sheet de service y solo **lee** y **manda mail**. No modifica nada del Sheet.

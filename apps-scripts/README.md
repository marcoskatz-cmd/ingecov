# Apps Scripts del panel INGECOV

Scripts auxiliares que viven en los Sheets maestros del sistema. No se ejecutan en el browser ni en GitHub Pages — son código de Google Apps Script.

## alertas-service.gs

**Vive en**: Sheet maestro de service (`1zB9q0e9kxRKe52-I0u5Dqg7PUSE_nlxi3IYn7pxF0Iw`), pestaña `PANEL_PROGRAMA`.

**Qué hace**: lee el panel, detecta equipos que **cruzaron a estado crítico** desde la última corrida, y manda un email con la lista.

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

### Destinatarios

Editables en la constante `DESTINATARIOS` arriba del script. Por defecto:

```js
var DESTINATARIOS = [
  'marcoskatz@grupoingeco.com.ar',
  'nicobdallagata@gmail.com'
];
```

Para agregar/quitar destinatarios: editás el array, guardás. Toma efecto en la próxima corrida.

### Lógica de clasificación

Espejo exacto de `clasificarServicio()` del panel HTML:

- `rojo` = `(EST_HRKM - ULT_HRKM) <= RANGO_CRITICA` (default 50 hr/km si no está cargado en el panel).
- `amarillo` = `(EST_HRKM - ULT_HRKM) <= RANGO_INTERMEDIA` (default 150).
- `verde` = el resto.
- `gris` = falta dato (no se considera crítico ni se notifica).

Si en el HTML cambia esa lógica (umbrales o algoritmo), hay que actualizar acá también — están desacoplados.

### Diferencia con el resto de scripts del sistema

- `actualizarPanelTrabajos` y `actualizarPanelRepuestos` (los consolidadores existentes) viven en sus respectivos Sheets maestros y **escriben** datos al panel.
- `alertas-service` vive en el Sheet de service y solo **lee** y **manda mail**. No modifica nada del Sheet.

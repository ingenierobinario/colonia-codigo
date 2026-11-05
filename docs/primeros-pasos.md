# Primeros pasos

## 1. Instala Colonia

Descarga el instalador de tu sistema desde la página de recursos a la que accedes tras la compra.

| Sistema | Archivo |
|---|---|
| Windows | Instalador `.exe` |
| macOS | Imagen `.dmg` |
| Linux | `.AppImage` |

La aplicación todavía no está firmada, así que tu sistema puede avisarte la primera vez. Confirma que el archivo viene de tu página de recursos y sigue estos pasos.

### En macOS

1. Abre el `.dmg` y arrastra Colonia a Aplicaciones.
2. Abre Colonia. macOS te avisará y no la abrirá; pulsa **Aceptar** o **Hecho**.
3. Ve a **Ajustes del Sistema → Privacidad y seguridad**, baja hasta **Seguridad** y pulsa **Abrir igualmente**.
4. Confirma con tu contraseña. A partir de ahí se abre con normalidad.

Si macOS dice que la aplicación está dañada, abre Terminal, ejecuta este comando y vuelve a abrirla:

```bash
xattr -cr /Applications/Colonia.app
```

### En Windows

Si aparece **Windows protegió su PC**, pulsa **Más información** y después **Ejecutar de todas formas**.

## 2. Conecta tu IA

La primera vez que abras Colonia, elige con qué IA van a trabajar tus agentes: una suscripción que ya tengas, una clave de un proveedor o un modelo que funcione en tu propio ordenador. El coste de la IA lo pagas directamente a ese proveedor.

## 3. Crea tu primer proyecto

Un proyecto agrupa el trabajo de un negocio o de un tema. Crea uno y añade agentes con un papel claro: por ejemplo, uno de desarrollo y otro de atención al cliente.

## 4. Habla con tu secretaria

Escríbele desde la bandeja de la aplicación. Puede responderte con lo que hay pendiente y pasar tareas al equipo. Si quieres hablar con ella desde el móvil a través de una aplicación de mensajería, conecta un [canal](canales.md).

## Si algo no funciona

Ejecuta esto en una terminal para ver por qué no responde el servicio y qué hacer a continuación:

```bash
colonia doctor
```

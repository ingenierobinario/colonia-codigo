# Primeros pasos

## 1. Instala Colonia

Descarga el instalador de tu sistema desde la página de recursos a la que accedes tras la compra.

| Sistema | Archivo |
|---|---|
| Windows | Instalador `.exe` |
| macOS | Imagen `.dmg` |
| Linux | `.AppImage`, `.deb` o `.rpm` |

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

### En Linux

Con el `.AppImage`, hazlo ejecutable una vez y ábrelo:

```bash
chmod +x Colonia-*.AppImage
./Colonia-*.AppImage
```

Si no se abre y dice que necesita FUSE (Ubuntu 22.04 y posteriores), instala la biblioteca una vez:

```bash
sudo apt install libfuse2t64 || sudo apt install libfuse2
```

Si prefieres un paquete del sistema, sin FUSE y con Colonia en el menú de aplicaciones, instala el `.deb` (Debian, Ubuntu) o el `.rpm` (Fedora, RHEL, openSUSE) desde la carpeta donde lo descargaste:

```bash
sudo apt install ./Colonia-*-linux-amd64.deb     # Debian, Ubuntu (arm64 en ARM)
sudo dnf install ./Colonia-*-linux-x86_64.rpm    # Fedora, RHEL (aarch64 en ARM)
```

El paquete no se actualiza solo, porque instalarlo pide tu contraseña: cuando haya una versión nueva, Colonia descarga el paquete del mismo tipo (`.deb` o `.rpm`, nunca el `.AppImage`) y te da la orden exacta para instalarlo, por ejemplo `sudo apt install '/home/tu-usuario/Descargas/Colonia-2.4.0-linux-amd64.deb'`. Cierra Colonia, pégala en una terminal y vuelve a abrirla.

## 2. Conecta tu IA

La primera vez que abras Colonia, elige con qué IA van a trabajar tus agentes: una suscripción que ya tengas, una clave de un proveedor o un modelo que funcione en tu propio ordenador. El coste de la IA lo pagas directamente a ese proveedor.

## 3. Crea tu primer proyecto

Un proyecto agrupa el trabajo de un negocio o de un tema. Crea uno y añade agentes con un papel claro: por ejemplo, uno de desarrollo y otro de atención al cliente.

## 4. Habla con tu secretaria

Escríbele desde la bandeja de la aplicación. Puede responderte con lo que hay pendiente y pasar tareas al equipo. Si quieres hablar con ella desde el móvil a través de una aplicación de mensajería, conecta un [canal](canales.md).

## Si algo no funciona

Cierra Colonia del todo y vuelve a abrirla: la aplicación arranca de nuevo su servicio y, si no puede, te dice por qué en la pantalla de conexión.

Si sigue sin responder y tienes la orden `colonia` en la terminal, ejecuta esto para ver por qué no responde el servicio y qué hacer a continuación:

```bash
colonia doctor
```

La orden `colonia` existe si instalaste Colonia con la línea de instalación de la documentación o desde el código. Los instaladores `.exe`, `.dmg` y `.AppImage` solo instalan la aplicación: si al escribir `colonia` la terminal dice que no la encuentra, instala la terminal con esa línea de instalación (no toca la aplicación) y vuelve a probar.

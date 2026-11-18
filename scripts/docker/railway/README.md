# Servidor de Colonia para una plantilla de Railway

La imagen usa el bundle Linux público fijado en `estable.txt`. Comprueba el SHA-256 de la arquitectura antes de extraerlo. El repositorio de la plantilla solo necesita el directorio `scripts/docker` con esa misma ruta desde la raíz y finales de línea LF. La imagen de Debian y los bundles se descargan de forma anónima. [Versión fijada de Colonia 2.36.49](https://github.com/ingenierobinario/colonia/releases/tag/v2.36.49)

En cada nueva entrega, `colonia-railway-<versión>.zip` y su `.sha256` acompañan a los instaladores públicos. El ZIP contiene una guía, el Dockerfile, dos scripts y el archivo de versión y sumas calculado desde ambos bundles Linux de esa versión. Descomprímelo en el repositorio de la plantilla.

## Configuración de la plantilla

1. En el editor de plantillas, añade un servicio desde un repositorio accesible que contenga esa fuente. Usa la raíz del repositorio como directorio de construcción. En las variables del servicio configura `RAILWAY_DOCKERFILE_PATH=/scripts/docker/Dockerfile`. Deja el comando de inicio vacío para usar el de la imagen y selecciona `/health` como ruta de comprobación del despliegue.
2. Habilita un dominio HTTP público y adjunta un volumen en `/data`. Define `COLONIA_HOME=/data/colonia` para el motor y cualquier herramienta del servicio. Railway proporciona `PORT`, `RAILWAY_PUBLIC_DOMAIN` y `RAILWAY_VOLUME_MOUNT_PATH`. Colonia usa la dirección HTTPS exacta de ese dominio para el panel y sus solicitudes.
3. Define `COLONIA_TOKEN` con el valor de plantilla `${{secret(64)}}` y `RAILWAY_RUN_UID` con `0`. Railway genera un token por instancia y lo conserva entre despliegues. El arranque ajusta el propietario de la raíz del volumen y ejecuta tanto el proceso inicial como el servidor con UID 1000. Conserva el secreto en las variables privadas del servicio.
4. Usa una réplica por volumen. En los ajustes de despliegue deja desactivado `Serverless` (suspensión por inactividad) para mantener disponibles las tareas programadas y el acceso las 24 horas. Para actualizar, cambia la versión y los hashes en `estable.txt` a los del release público revisado y reconstruye la imagen. El volumen conserva los proyectos y la identidad del servidor.

[Crear una plantilla](https://docs.railway.com/templates/create) · [Volúmenes y permisos](https://docs.railway.com/volumes) · [Dockerfile en una subcarpeta](https://docs.railway.com/builds/dockerfiles) · [Variables de Railway](https://docs.railway.com/variables/reference)

## Enlazar la plantilla desde Colonia

Una vez publicada la plantilla, guarda su código público en la variable de GitHub Actions `COLONIA_RAILWAY_TEMPLATE`. Si se usa un código de afiliado, guárdalo en `COLONIA_RAILWAY_REFERRAL`. Configura estas variables antes de construir el panel. El botón Railway aparece al definir el código de plantilla. La guía para usar un servidor propio está disponible en todos los casos.

El bundle público 2.36.49 permite verificar la infraestructura y el acceso con el token. Para introducir por primera vez la clave desde el panel gráfico, fija una versión publicada que ya incluya este recorrido.

## Prueba local

Ejecuta estos comandos desde la raíz del repositorio con Docker Desktop o Docker Engine y Node 24.

```sh
docker build -f scripts/docker/Dockerfile -t colonia-railway-prueba:2.36.49 .
node --test scripts/docker/railway/servidor.test.mjs
```

La prueba crea una red interna, un secreto ficticio y un volumen temporal. Comprueba el acceso desde un segundo contenedor, la identidad, el proyecto persistente y el usuario del servicio después de recrearlo. Para usar otra etiqueta de imagen local, define `COLONIA_RAILWAY_IMAGE`. El flujo local existente admite `--build-arg BUNDLE=out/colonia-core-<versión>-linux-x64.tar.gz`.

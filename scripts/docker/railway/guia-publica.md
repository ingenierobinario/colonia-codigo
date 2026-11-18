# Desplegar Colonia en Railway

Este archivo contiene la fuente de una plantilla de servidor. El Dockerfile descarga el bundle de la versión indicada en `scripts/docker/railway/estable.txt` desde las versiones públicas de Colonia y comprueba el SHA-256 de la arquitectura antes de instalarlo.

1. Descomprime el ZIP en un repositorio que Railway pueda leer. Conserva las rutas y los finales de línea LF.
2. En el editor de plantillas de Railway, añade un servicio desde ese repositorio. Usa su raíz como directorio de construcción y define `RAILWAY_DOCKERFILE_PATH=/scripts/docker/Dockerfile`. Deja el comando de inicio vacío.
3. En los ajustes de despliegue desactiva `Serverless` (suspensión por inactividad) para que el servidor funcione las 24 horas. Adjunta un volumen en `/data` y usa una réplica. Define `COLONIA_HOME=/data/colonia` y `RAILWAY_RUN_UID=0`. El arranque prepara el volumen y pasa al usuario del servidor.
4. Crea la variable de plantilla `COLONIA_TOKEN` con el valor `${{secret(64)}}`. Railway generará una clave al instalar cada instancia y la conservará al redesplegar.
5. Genera un dominio HTTP público y configura `/health` como ruta de comprobación. El servidor usa el puerto asignado por Railway y admite el origen HTTPS de ese dominio.
6. Tras desplegar, abre el dominio HTTPS del servicio. La clave para conectarte está en `COLONIA_TOKEN` de las variables privadas de tu instancia.

Para actualizar, sustituye la fuente por el ZIP de la nueva entrega y vuelve a desplegar conservando el servicio, su clave y el volumen.

[Editor de plantillas de Railway](https://docs.railway.com/templates/create) · [Volúmenes de Railway](https://docs.railway.com/volumes) · [Versiones públicas de Colonia](https://github.com/ingenierobinario/colonia/releases)

## English

This ZIP contains the source for a Railway service running Colonia. The Dockerfile downloads the selected public Linux release and verifies its SHA-256 checksum for the target architecture.

1. Unzip into a repository that Railway can read. Preserve the directory layout and use LF line endings.
2. In Railway's template editor, add a service from that repository. Use the repository root as the build directory, set `RAILWAY_DOCKERFILE_PATH=/scripts/docker/Dockerfile`, and leave the start command empty.
3. Turn off **Serverless** to keep Colonia running while the desktop is off. Use one replica, mount a volume at `/data`, and set `COLONIA_HOME=/data/colonia` and `RAILWAY_RUN_UID=0`. The entrypoint prepares the volume, then starts Colonia as an unprivileged user.
4. Set the template variable `COLONIA_TOKEN` to `${{secret(64)}}`. Each installation gets its own key, which is preserved across redeployments.
5. Generate a public HTTP domain and set the health check path to `/health`. Colonia uses Railway's assigned port and accepts the domain's HTTPS origin.
6. Open the service's HTTPS address. The key for linking your browser is in the private `COLONIA_TOKEN` variable.

To update, use the ZIP from the next release and redeploy the same service with its existing key and volume.

[Railway template editor](https://docs.railway.com/templates/create) · [Railway volumes](https://docs.railway.com/volumes) · [Colonia releases](https://github.com/ingenierobinario/colonia/releases)

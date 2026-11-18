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

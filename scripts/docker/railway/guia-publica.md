# Instalar Colonia en tu cuenta de Railway

El ZIP incluye los archivos para crear un servidor que siga funcionando al apagar el PC. Necesitarás una cuenta de Railway y un repositorio de GitHub en el que puedas subir archivos. Puedes hacer la instalación desde el navegador.

1. **Sube el contenido del ZIP a GitHub.** Descomprímelo y sube la carpeta `scripts` y el archivo `README.md` a la raíz de un repositorio tuyo. Al abrir el repositorio debes ver `scripts/docker/Dockerfile`. Conserva la estructura y los finales de línea LF.
2. **Crea un servicio en Railway.** En tu cuenta, crea un proyecto vacío y añade un servicio vacío. En **Settings → Source → Connect Repo**, selecciona el repositorio anterior. Si Railway te pide acceso a GitHub, concede acceso a ese repositorio. Usa la raíz del repositorio y deja vacío el comando de inicio.
3. **Reserva espacio para los datos.** En el proyecto, añade un volumen a ese servicio con la ruta de montaje `/data`. En los ajustes del servicio, usa una réplica y desactiva **Serverless** para que el servidor siga activo.
4. **Configura las variables del servicio.** En **Variables**, añade `RAILWAY_DOCKERFILE_PATH=/scripts/docker/Dockerfile`, `COLONIA_HOME=/data/colonia` y `RAILWAY_RUN_UID=0`. En tu gestor de contraseñas genera una clave aleatoria de al menos 32 caracteres y guárdala como `COLONIA_TOKEN` en las variables privadas del servicio. Conserva la clave en el gestor. Cuando vincules tu navegador, introdúcela únicamente en el campo privado del paso 6.
5. **Abre el servicio por HTTPS.** En **Settings → Networking → Public Networking**, pulsa **Generate Domain**. En los ajustes de despliegue, indica `/health` como ruta de comprobación. Aplica los cambios y despliega. El servidor usa el puerto asignado por Railway.
6. **Entra en tu Colonia.** Cuando el despliegue esté listo, abre el dominio HTTPS del servicio. Elige **Este servidor es mío** e introduce la clave en el campo privado. Para enlazar el escritorio, abre **Mis equipos → Generar invitación para el PC** en el servidor y pega la invitación en **Mis equipos** del PC.

Para actualizar, sube los archivos del nuevo ZIP al mismo repositorio y vuelve a desplegar el servicio conservando su volumen y su clave. El Dockerfile comprueba el SHA-256 del motor de Colonia que corresponde a la versión del ZIP y a la arquitectura del servidor.

**Si publicas una plantilla para otras personas**, usa el editor de plantillas con los mismos ajustes de servicio y la variable de plantilla `COLONIA_TOKEN=${{secret(64)}}`. Railway generará una clave distinta para cada instalación.

[Crear un servicio en Railway](https://docs.railway.com/services) · [Volúmenes](https://docs.railway.com/volumes) · [Dominios](https://docs.railway.com/networking/public-networking) · [Versiones de Colonia](https://github.com/ingenierobinario/colonia/releases)

## Install Colonia in your Railway account

This ZIP contains the files for a server that stays online when your PC is off. You need a Railway account and a GitHub repository where you can upload files. You can complete the setup in your browser.

1. **Upload the contents of the ZIP to GitHub.** Extract it and upload the `scripts` folder and `README.md` to the root of your repository. You should see `scripts/docker/Dockerfile` when browsing the repository. Keep the directory structure and LF line endings.
2. **Create a Railway service.** In your Railway account, create an empty project and add an empty service. Under **Settings → Source → Connect Repo**, choose your repository. If Railway asks for GitHub access, grant it access to that repository. Use the repository root and leave the start command empty.
3. **Give Colonia persistent storage.** In the project, add a volume to this service and mount it at `/data`. In the service settings, use one replica and turn off **Serverless** to keep the server running.
4. **Set the service variables.** Under **Variables**, add `RAILWAY_DOCKERFILE_PATH=/scripts/docker/Dockerfile`, `COLONIA_HOME=/data/colonia` and `RAILWAY_RUN_UID=0`. Use a password manager to generate a random key of at least 32 characters and enter it as `COLONIA_TOKEN` in the private service variables. Keep the key in your password manager. When linking your browser, enter the key only in the private field in step 6.
5. **Enable HTTPS.** Under **Settings → Networking → Public Networking**, select **Generate Domain**. In deployment settings, enter `/health` as the health check path. Apply the changes and deploy. Colonia uses the port Railway assigns.
6. **Open your Colonia.** When the deployment is ready, open the service’s HTTPS address. Choose **I own this server** and enter the key in the private field. To link your desktop, open **My computers → Create desktop invitation** on the server and paste the invitation into **My computers** on your PC.

To update, upload the new ZIP’s contents to the same repository and redeploy the service with its existing volume and key. The Dockerfile verifies the SHA-256 checksum for the Colonia version in the ZIP and the server’s architecture.

**If you publish a template for others**, use the template editor with the same service settings and set the template variable to `COLONIA_TOKEN=${{secret(64)}}`. Railway generates a separate key for each installation.

[Create a Railway service](https://docs.railway.com/services) · [Volumes](https://docs.railway.com/volumes) · [Domains](https://docs.railway.com/networking/public-networking) · [Colonia releases](https://github.com/ingenierobinario/colonia/releases)

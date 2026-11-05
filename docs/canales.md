# Canales

Un canal te permite hablar con tus agentes desde otra aplicación, con la misma memoria que en Colonia. Se configuran desde los ajustes de la aplicación.

El código incluye conectores para:

- **Mensajería:** WhatsApp, Telegram, Signal, iMessage, SMS y LINE.
- **Equipos:** Slack, Microsoft Teams, Google Chat, Mattermost, Nextcloud y Discord.
- **Otros:** correo electrónico, Matrix, IRC, Twitch y ntfy.

Cada conector necesita los datos de acceso de su servicio, y algunos dependen de las condiciones o de la disponibilidad de ese servicio. iMessage, por ejemplo, depende del ecosistema de Apple.

Los conectores están en `apps/core/src/channels/`.

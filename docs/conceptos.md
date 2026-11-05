# Conceptos

| Pieza | Qué es |
|---|---|
| **Servicio** (`apps/core`) | El proceso que guarda el estado y ejecuta a los agentes. Todo lo demás se conecta a él. |
| **Agente** | Un pingüino con su papel, su memoria y sus herramientas. |
| **Secretaria** | El agente que te atiende en primer lugar y conoce el conjunto de tu trabajo. |
| **Proyecto** | El espacio de trabajo de un negocio o tema, con su propio equipo. |
| **Conversación** | Un hilo de mensajes con un agente. |
| **Tarea** | Un trabajo con responsable, que un agente puede pasar a otro. |
| **Rutina** | Un trabajo que se ejecuta solo según un horario, mientras Colonia está en marcha. |
| **Canal** | Una aplicación por la que hablas con tus agentes, como WhatsApp o Telegram. |
| **Proveedor** | El servicio de IA que responde a los agentes. |
| **Herramienta MCP** | Una conexión estándar que da a los agentes acceso a otro servicio. |

## Dónde se guardan tus datos

Por defecto, en la carpeta `.colonia/v2` de tu usuario. Puedes cambiarla con la variable de entorno `COLONIA_HOME`.

## Telemetría

Está desactivada por defecto. Solo se envía si `COLONIA_TELEMETRY` indica un destino.

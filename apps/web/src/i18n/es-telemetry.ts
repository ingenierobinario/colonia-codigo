import type { MessageKey } from "./en.ts";

// Telemetría: el checkbox del setup, la tarjeta que le pregunta una vez a una instalación anterior y su parte de Avanzado.
export const esTelemetry: Partial<Record<MessageKey, string>> = {
  "telemetry.check": "Compartir estadísticas de uso anónimas",
  "telemetry.checkHint":
    "Las estadísticas de uso anónimas nos muestran cómo se usa Colonia de verdad, para saber qué mejorar primero. Nunca miramos tus chats, archivos ni datos personales.",
  "telemetry.cardTitle": "Ayuda a mejorar Colonia",
  "telemetry.cardYes": "Compartir estadísticas",
  "telemetry.cardNo": "No, gracias",
  "telemetry.whatIsSent": "Qué se envía",
  "telemetry.title": "Estadísticas de uso",
  "telemetry.lead":
    "Un id al azar, no ligado a ti, le avisa al proyecto Colonia cuándo se configuró esta instalación, cuándo se usó por primera vez y cuándo se actualizó. Si dices que sí, además envía una vez por día los números de abajo.",
  "telemetry.off": "La telemetría está apagada en este ordenador: no se envía nada.",
  "telemetry.preview": "Próximo informe",
  "telemetry.last": "Último envío",
  "telemetry.never": "Todavía no se envió nada",
  "telemetry.id": "Id de telemetría",
  "telemetry.steps": "Pasos enviados",
  "telemetry.stat.tokens_in": "Tokens de entrada",
  "telemetry.stat.tokens_out": "Tokens de salida",
  "telemetry.stat.runs": "Turnos",
  "telemetry.stat.projects": "Proyectos",
  "telemetry.stat.agents": "Agentes",
  "telemetry.stat.channels": "Canales",
  "telemetry.stat.routines": "Rutinas",
  "telemetry.stage.installed": "Instalado",
  "telemetry.stage.opened": "Abierto",
  "telemetry.stage.consent": "Respuesta sobre estadísticas",
  "telemetry.stage.setup": "Setup terminado",
  "telemetry.stage.first_run": "Primer uso",
  "telemetry.stage.updated": "Actualizado",
};

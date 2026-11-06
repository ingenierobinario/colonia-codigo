// An OpenAI-compatible model for the screenshots: it answers like the demo crew would, from a short script picked by
// the owner's last words (in the language of the office being shot), so captures show real-looking conversations
// without calling anyone.
import http from "node:http";
import type { AddressInfo } from "node:net";

type Message = { role: string; content?: unknown };
type Lang = "en" | "es";

const SCRIPT: Record<Lang, Array<[RegExp, string]>> = {
  en: [
    [
      /plate today|on my plate/i,
      [
        "Here's your day at **Brezo Ceramics**:",
        "",
        "1. **Christmas launch**: Lucía drafted the plan and is waiting for your OK.",
        "2. **Checkout fix**: Tomás has the fix in review; it goes out tomorrow if you approve.",
        "3. **Newsletter**: Inés scheduled it for Friday at 9:00.",
        "",
        "Nothing is due today. Want me to tell Lucía you'll look at the plan after lunch?",
      ].join("\n"),
    ],
    [/after lunch|yes,? ping/i, "Done. I told Lucía you'll review the plan at 14:00 and added a reminder for you."],
    [
      /christmas launch|plan the launch/i,
      [
        "Here's a first cut of the **Christmas launch**:",
        "",
        "| Week | What | Who |",
        "|---|---|---|",
        "| 1 | Freeze the catalog and fix the checkout | Tomás |",
        "| 2 | Landing page and emails | Inés |",
        "| 3 | Black Friday campaign goes live | Inés |",
        "| 4 | Review the numbers and follow up | Lucía |",
        "",
        "I created four tasks and assigned them. I'll check in every Monday.",
      ].join("\n"),
    ],
    [/checkout/i, "On it. The coupon field breaks when the cart is empty; the fix is ready and the tests pass."],
    [/newsletter/i, 'Draft ready: "Three Christmas sets under €40". Scheduled for Friday at 9:00.'],
  ],
  es: [
    [
      /tengo hoy/i,
      [
        "Esto es lo que tienes hoy en **Brezo Cerámica**:",
        "",
        "1. **Lanzamiento de Navidad**: Lucía ha preparado el plan y espera tu visto bueno.",
        "2. **Arreglo del pago**: Tomás tiene el arreglo en revisión; sale mañana si lo apruebas.",
        "3. **Boletín**: Inés lo ha programado para el viernes a las 9:00.",
        "",
        "Hoy no vence nada. ¿Quieres que le diga a Lucía que miras el plan después de comer?",
      ].join("\n"),
    ],
    [
      /después de comer|sí,? dile/i,
      "Hecho. Le he dicho a Lucía que revisas el plan a las 14:00 y te he puesto un recordatorio.",
    ],
    [
      /lanzamiento de navidad|planifica/i,
      [
        "Aquí tienes una primera versión del **lanzamiento de Navidad**:",
        "",
        "| Semana | Qué | Quién |",
        "|---|---|---|",
        "| 1 | Cerrar el catálogo y arreglar el pago | Tomás |",
        "| 2 | Página de la campaña y correos | Inés |",
        "| 3 | Sale la campaña de Black Friday | Inés |",
        "| 4 | Revisar los números y hacer seguimiento | Lucía |",
        "",
        "He creado cuatro tareas y las he asignado. Lo reviso cada lunes.",
      ].join("\n"),
    ],
    [
      /pago|cupón/i,
      "Me pongo. El campo del cupón falla cuando el carrito está vacío; el arreglo está listo y las pruebas pasan.",
    ],
    [/boletín/i, "Borrador listo: «Tres juegos para Navidad por menos de 40 €». Programado para el viernes a las 9:00."],
  ],
};

function lastWords(messages: Message[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const text =
    typeof last?.content === "string"
      ? last.content
      : Array.isArray(last?.content)
        ? last.content.map((p) => (p as { text?: string }).text ?? "").join("\n")
        : "";
  return text;
}

function answer(messages: Message[], lang: Lang): string {
  const system = String(messages[0]?.content ?? "");
  const said = lastWords(messages);
  const es = lang === "es";
  if (/title/i.test(system) && system.length < 2000) {
    if (/plate|tengo hoy/i.test(said)) return es ? "El plan de hoy" : "Today's plan";
    if (/launch|lanzamiento/i.test(said)) return es ? "Plan del lanzamiento de Navidad" : "Christmas launch plan";
    if (/checkout|pago/i.test(said)) return es ? "Arreglo del pago" : "Checkout fix";
    return es ? "Una pregunta rápida" : "Quick question";
  }
  for (const [rx, text] of SCRIPT[lang]) if (rx.test(said)) return text;
  return es ? "De acuerdo. Me encargo y te aviso cuando esté." : "Sure. I'll take care of it and let you know when it's done.";
}

export async function demoLlm(models: string[], lang: Lang = "en") {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      if (req.url?.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ data: models.map((id) => ({ id, object: "model" })) }));
      }
      const body = (raw ? JSON.parse(raw) : {}) as { messages?: Message[]; stream?: boolean };
      const text = answer(body.messages ?? [], lang);
      const usage = { prompt_tokens: 8120, completion_tokens: 96, total_tokens: 8216 };
      if (!body.stream) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            id: "demo",
            choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
            usage,
          }),
        );
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      for (const part of text.match(/[\s\S]{1,24}/g) ?? [text])
        send({ id: "demo", choices: [{ index: 0, delta: { content: part }, finish_reason: null }] });
      send({ id: "demo", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      send({ id: "demo", choices: [], usage });
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

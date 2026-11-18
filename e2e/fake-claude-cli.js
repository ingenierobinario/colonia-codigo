#!/usr/bin/env node
// El catálogo usa el protocolo de control del SDK incluso cuando no hay una sesión iniciada.
if (process.argv[2] === "--version") {
  process.stdout.write("2.0.0 (Claude Code)\n");
} else if (process.argv[2] === "auth") {
  process.stdout.write(`${JSON.stringify({ loggedIn: false })}\n`);
} else if (process.argv.includes("stream-json")) {
  void import("node:readline").then(({ createInterface }) => {
    createInterface({ input: process.stdin }).on("line", (line) => {
      const frame = JSON.parse(line);
      if (frame.type !== "control_request") return;
      const request_id = frame.request_id;
      const response =
        frame.request.subtype === "initialize"
          ? {
              subtype: "success",
              request_id,
              response: {
                commands: [],
                agents: [],
                output_style: "default",
                available_output_styles: ["default"],
                account: {},
                models: [{ value: "default", displayName: "Claude de prueba", description: "Modelo de prueba" }],
              },
            }
          : { subtype: "error", request_id, error: "Solicitud no disponible en el simulador" };
      process.stdout.write(`${JSON.stringify({ type: "control_response", response })}\n`);
    });
  });
}

import { serveAgent } from "./a2a.ts";

await serveAgent(process.argv[2] ?? "");

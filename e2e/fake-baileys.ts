// The simulated phone shares the sandbox core's IPC channel, so it never competes for an HTTP port.
import { fakeWhatsApp } from "../apps/core/src/channels/fake-whatsapp.test-support.ts";

const wa = fakeWhatsApp();
export const {
  makeWASocket,
  useMultiFileAuthState,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = wa.lib;
export default wa.lib;

export function controlWhatsApp(requestPath: string, raw: string): unknown {
  const body = (raw ? JSON.parse(raw) : {}) as {
    from?: { phone: string; name: string };
    text?: string;
    jid?: string;
    status?: number;
    online?: boolean;
    emoji?: string;
    /** A message's content as the library hands it (a video, a document), its file's bytes in `bytes`. */
    content?: object;
    id?: string;
  };
  const url = new URL(requestPath, "http://x");
  let out: unknown = { ok: true };
  if (url.pathname === "/scan") wa.scan();
  else if (url.pathname === "/owner") wa.fromOwner(String(body.text ?? ""));
  else if (url.pathname === "/message" && body.from) out = { id: wa.message(body.from, String(body.text ?? "")) };
  else if (url.pathname === "/keep" && body.id && body.content) wa.phoneKeeps(body.id, body.content);
  else if (url.pathname === "/media" && body.from && body.content) wa.message(body.from, "", { content: body.content });
  else if (url.pathname === "/receipt") {
    const last = wa.sent.filter((x) => x.jid === body.jid).at(-1);
    if (last) wa.receipt(last.id, Number(body.status ?? 3));
  } else if (url.pathname === "/react" && body.from) {
    const last = wa.sent.filter((x) => x.jid === body.from?.phone).at(-1);
    if (last) wa.react(body.from, last.id, String(body.emoji ?? ""));
  } else if (url.pathname === "/presence")
    wa.presence(String(body.jid ?? ""), body.online ? "available" : "unavailable");
  else if (url.pathname === "/sent") out = { owner: wa.owner, sent: wa.textsTo(url.searchParams.get("jid") ?? "") };
  else throw new Error("Unknown simulated WhatsApp control");
  return out;
}

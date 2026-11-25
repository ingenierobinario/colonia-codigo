import { type IncomingMessage, request, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { FILE_PAYLOAD_BYTES, PANEL_WS_PROTOCOL } from "@colonia/protocol";
import { WebSocket, WebSocketServer } from "ws";
import { type Gate, refuse } from "../transport/guard.ts";
import { socketCredential } from "../transport/ws.ts";
import { type ForwardedDevice, WORKSPACE_DEVICE } from "./device.ts";
import type { Workspaces } from "./manager.ts";

export function workspaceRoute(url: string | undefined) {
  const pathname = new URL(url ?? "/", "http://core").pathname;
  const match = /^\/workspaces\/(w_[a-f0-9]{32})(\/rpc\/[a-zA-Z0-9_.]+|\/ws|\/sincronizar|\/vm-display)$/.exec(
    pathname,
  );
  return match ? { id: match[1] as string, path: match[2] as string } : undefined;
}

/** Only owner credentials may cross into another business; app/client tokens never become owner tokens. */
function denied(req: IncomingMessage, gate: Gate, credential?: string | null, oauthReturn = false) {
  return (
    Boolean(req.headers["x-colonia-client"]) ||
    req.headers.authorization?.startsWith("Bearer coloniac_") ||
    credential?.startsWith("coloniac_") ||
    Boolean(refuse(req, gate, credential, false, oauthReturn))
  );
}

function failure(res: ServerResponse, status: number, code: string, message: string) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ ok: false, error: { code, message } }));
}

export function workspaceBridge(
  manager: Workspaces,
  gate: Gate,
  deviceOf: (token: string) => ForwardedDevice | undefined,
) {
  const deviceHeader = (req: IncomingMessage, credential?: string | null) => {
    const key = credential ?? req.headers.authorization?.replace(/^Bearer /, "");
    const device = key ? deviceOf(key) : undefined;
    return device
      ? { [WORKSPACE_DEVICE]: Buffer.from(JSON.stringify({ id: device.id, name: device.name })).toString("base64url") }
      : {};
  };
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: FILE_PAYLOAD_BYTES,
    handleProtocols: (offered) => (offered.has(PANEL_WS_PROTOCOL) ? PANEL_WS_PROTOCOL : false),
  });
  return {
    async request(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const route = workspaceRoute(req.url);
      if (!route || req.method !== "POST" || !route.path.startsWith("/rpc/")) {
        res.writeHead(404).end();
        return;
      }
      // This existing open method verifies a one-use, signed state inside the selected business.
      if (denied(req, gate, undefined, route.path === "/rpc/integrations.oauth_finish")) {
        failure(res, 403, "unauthorized", "missing or bad workspace credentials");
        return;
      }
      try {
        const target = await manager.target(route.id);
        if (res.destroyed) return;
        const upstream = request(
          `${target.url}${route.path}`,
          {
            method: "POST",
            headers: {
              "content-type": String(req.headers["content-type"] ?? ""),
              authorization: `Bearer ${target.token}`,
              ...deviceHeader(req),
              ...(typeof req.headers["idempotency-key"] === "string"
                ? { "idempotency-key": req.headers["idempotency-key"] }
                : {}),
              ...(req.headers["x-colonia-actor"] === "agent" ? { "x-colonia-actor": "agent" } : {}),
              // The worker must never mistake a request proxied from Railway for a local owner operation.
              "x-forwarded-for": req.socket.remoteAddress ?? "workspace-owner",
            },
          },
          (response) => {
            res.writeHead(response.statusCode ?? 502, {
              "content-type": "application/json",
              "cache-control": "no-store",
            });
            response.pipe(res);
            response.on("error", () => res.destroy());
          },
        );
        upstream.on("error", () => {
          failure(res, 502, "unavailable", "workspace connection failed");
        });
        res.once("close", () => upstream.destroy());
        req.once("aborted", () => upstream.destroy());
        req.pipe(upstream);
      } catch {
        failure(res, 503, "unavailable", "workspace is unavailable");
      }
    },
    async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
      const route = workspaceRoute(req.url);
      if (!route || !["/ws", "/sincronizar", "/vm-display"].includes(route.path)) {
        socket.destroy();
        return;
      }
      const credential = socketCredential(req);
      const allowedRequest = () => {
        if (route.path === "/sincronizar") return !req.headers.origin;
        if (route.path === "/vm-display")
          return Boolean(req.headers.origin && gate.allowedOrigins.has(req.headers.origin));
        return credential !== undefined && !denied(req, gate, credential);
      };
      if (!allowedRequest()) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      try {
        const target = await manager.target(route.id);
        if (socket.destroyed) return;
        const query = route.path === "/vm-display" ? new URL(req.url ?? "/", "http://core").search : "";
        const upstream = new WebSocket(`${target.url.replace(/^http/, "ws")}${route.path}${query}`, {
          headers: {
            authorization: `Bearer ${target.token}`,
            ...deviceHeader(req, credential),
            "x-forwarded-for": req.socket.remoteAddress ?? "workspace-owner",
            ...(route.path === "/sincronizar" ? {} : { origin: new URL(target.url).origin }),
          },
          maxPayload: FILE_PAYLOAD_BYTES,
          handshakeTimeout: 10_000,
        });
        socket.once("close", () => upstream.terminate());
        upstream.once("error", () => socket.destroy());
        upstream.once("open", () =>
          sockets.handleUpgrade(req, socket, head, (client) => {
            const allowed = () => {
              if (allowedRequest()) return true;
              client.close(1008, "missing or bad token");
              upstream.close();
              return false;
            };
            client.on("message", (data, binary) => {
              if (allowed() && upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
            });
            upstream.on("message", (data, binary) => {
              if (allowed() && client.readyState === WebSocket.OPEN) client.send(data, { binary });
            });
            client.once("close", () => upstream.close());
            client.once("error", () => upstream.terminate());
            upstream.once("close", () => client.close());
          }),
        );
      } catch {
        socket.destroy();
      }
    },
    close() {
      for (const client of sockets.clients) client.terminate();
      sockets.close();
    },
  };
}

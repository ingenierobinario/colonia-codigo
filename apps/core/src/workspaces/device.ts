import type { IncomingMessage } from "node:http";
import { unauthorized } from "../errors.ts";

export const WORKSPACE_DEVICE = "x-colonia-workspace-device";
export type ForwardedDevice = { id: string; name: string };

/** Enabled only in a worker: the supervisor's private token authenticates this additional restriction. */
export function workspaceDevice(req: IncomingMessage, token: string | undefined): ForwardedDevice | undefined {
  const encoded = req.headers[WORKSPACE_DEVICE];
  if (!encoded) return undefined;
  if (!token || req.headers.authorization !== `Bearer ${token}` || typeof encoded !== "string" || encoded.length > 2048)
    throw unauthorized("invalid workspace device");
  try {
    const value: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (
      value &&
      typeof value === "object" &&
      "id" in value &&
      "name" in value &&
      typeof value.id === "string" &&
      /^[a-zA-Z0-9_-]{1,100}$/.test(value.id) &&
      typeof value.name === "string" &&
      value.name.length <= 200
    )
      return { id: value.id, name: value.name };
  } catch {}
  throw unauthorized("invalid workspace device");
}

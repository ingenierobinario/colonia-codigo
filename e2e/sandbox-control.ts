import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

export type SandboxCommand = { type: "clock"; at: string | null } | { type: "whatsapp"; path: string; body: string };

/** Correlation keeps simultaneous clock and phone controls from acknowledging one another. */
export function callSandbox(child: ChildProcess, command: SandboxCommand): Promise<unknown> {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("message", received);
      child.off("exit", exited);
      child.off("error", failed);
      child.off("disconnect", disconnected);
      if (error) reject(error);
      else resolve(result);
    };
    const received = (message: unknown) => {
      if (!message || typeof message !== "object" || !("sandbox" in message) || message.sandbox !== id) return;
      if ("error" in message && typeof message.error === "string") finish(new Error(message.error));
      else finish(undefined, "result" in message ? message.result : undefined);
    };
    const exited = () => finish(new Error("The sandbox core stopped before answering its control request"));
    const failed = (error: Error) => finish(error);
    const disconnected = () => finish(new Error("The sandbox core is disconnected"));
    const timer = setTimeout(() => finish(new Error("The sandbox core did not answer its control request")), 10_000);
    child.on("message", received);
    child.once("exit", exited);
    child.once("error", failed);
    child.once("disconnect", disconnected);
    if (!child.connected) return finish(new Error("The sandbox core is disconnected"));
    child.send({ sandbox: id, command }, (error) => {
      if (error) finish(error);
    });
  });
}

export function serveSandbox(channel: NodeJS.Process, handle: (command: SandboxCommand) => unknown): void {
  channel.on("message", (message: unknown) => {
    if (
      !message ||
      typeof message !== "object" ||
      !("sandbox" in message) ||
      typeof message.sandbox !== "string" ||
      !("command" in message)
    )
      return;
    const command = message.command as SandboxCommand;
    const respond = (payload: { result?: unknown; error?: string }) => {
      if (channel.connected) channel.send?.({ sandbox: message.sandbox, ...payload }, () => {});
    };
    try {
      if (command?.type !== "clock" && command?.type !== "whatsapp") throw new Error("Unknown sandbox control");
      const result = handle(command);
      respond({ result });
    } catch (error) {
      respond({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

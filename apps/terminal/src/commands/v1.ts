// colonia v1 [off]: whether Colonia v1 is still on this machine and running beside v2, and turning it off for good.
import type { ColoniaClient } from "@colonia/protocol/client";

export async function v1(client: ColoniaClient, [sub]: string[]): Promise<void> {
  if (sub === "off") {
    const r = await client.call("setup.take_over_cli", {});
    console.log(`${r.ok ? "✓" : "⚠"} ${r.detail.replaceAll(". ", "\n  ")}`);
    if (!r.ok) process.exitCode = 1;
    return;
  }
  if (sub) throw new Error("usage: colonia v1 [off]");
  const s = await client.call("setup.status", {});
  if (!s.v1) {
    console.log("Colonia v1 is not on this machine.");
    return;
  }
  console.log(`Colonia v1${s.v1.version ? ` ${s.v1.version}` : ""} in ${s.v1.home} · ${s.v1.projects} projects`);
  console.log(
    s.v1_running
      ? "⚠ its daemon is running: routines and bots may run twice. Turn it off: colonia v1 off (colonia2 v1 off where colonia is still v1's)"
      : "✓ its daemon is off",
  );
}

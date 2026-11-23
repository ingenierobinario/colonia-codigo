// Where secret values live outside Colonia's own files, one store per operating system: the login Keychain (macOS), a file
// only the user's Windows account can decrypt (DPAPI, what Credential Manager itself uses) and the desktop keyring
// through the Secret Service (Linux, `secret-tool`). Each runs the system's own command; values go on stdin, never on
// argv. See DECISIONS.md#d-010 and DECISIONS.md#d-133.
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type SecretsBackend = "keychain" | "dpapi" | "secret-service" | "file";

/** The store each operating system uses by default. */
export const systemBackend = (platform: NodeJS.Platform = process.platform): SecretsBackend =>
  platform === "darwin" ? "keychain" : platform === "win32" ? "dpapi" : "secret-service";

/** A system command: its stdout, or a throw when it fails or exits non-zero. Injected so tests can fake it. */
export type Run = (
  cmd: string,
  args: string[],
  o?: { input?: string; env?: Record<string, string>; timeoutMs?: number },
) => string;

export const runCommand: Run = (cmd, args, o = {}) =>
  execFileSync(cmd, args, {
    encoding: "utf8",
    input: o.input ?? "",
    stdio: ["pipe", "pipe", "ignore"],
    ...(o.env ? { env: { ...process.env, ...o.env } } : {}),
    timeout: o.timeoutMs ?? 15_000,
    windowsHide: true,
  });

export type ValueStore = {
  get(name: string): string | undefined;
  set(name: string, value: string | null): void;
  /**
   * Several values at once (RESTAURAR-DPAPI-1): a store that seals everything together (DPAPI) does it in one system
   * call, not one per name; a restore with forty keys used to start PowerShell forty times and one slow start failed it.
   */
  setMany?(values: Record<string, string | null>): void;
  /** Whether the store answers at all (a keyring daemon, PowerShell); tried once, when nothing was kept there yet. */
  works(): boolean;
  /**
   * ARRANQUE-RAPIDO-1: opens the store without blocking (its program runs in the background) and answers whether it
   * works; what it reads stays in memory, so the first secret read after it starts no program.
   */
  warm?(): Promise<boolean>;
};

/** Like runCommand, but without stopping the event loop while the program runs. */
export const runCommandAsync = (
  cmd: string,
  args: string[],
  o: { input?: string; env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      {
        encoding: "utf8",
        ...(o.env ? { env: { ...process.env, ...o.env } } : {}),
        timeout: o.timeoutMs ?? 15_000,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
    child.stdin?.end(o.input ?? "");
  });

const SECURITY = "/usr/bin/security";

export function keychainStore(service: string, run: Run = runCommand): ValueStore {
  return {
    get(name) {
      try {
        return run(SECURITY, ["find-generic-password", "-s", service, "-a", name, "-w"]).replace(/\n$/, "");
      } catch {
        return undefined;
      }
    },
    set(name, value) {
      if (value === null) {
        try {
          run(SECURITY, ["delete-generic-password", "-s", service, "-a", name]);
        } catch {}
        return;
      }
      // Through `security -i` on stdin: a value on argv would show up in the process list.
      const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      run(SECURITY, ["-i"], { input: `add-generic-password -U -s ${service} -a ${q(name)} -w ${q(value)}\n` });
    },
    works: () => true,
  };
}

const KEYRING_READ_MS = 8000;
const KEYRING_REST_MS = 60_000;

/** The Secret Service (GNOME Keyring, KWallet, KeePassXC) through libsecret's `secret-tool`. */
export function secretServiceStore(service: string, run: Run = runCommand, now: () => number = Date.now): ValueStore {
  const attrs = (name: string) => ["service", service, "account", name];
  // A locked keyring with nobody to unlock it (a server, a session with no prompter) never answers, and every call
  // blocks the core while it waits: after one that timed out, the keyring is left alone for a minute.
  let restUntil = 0;
  const tool = (args: string[], o: { input?: string; timeoutMs: number }) => {
    if (now() < restUntil) throw new Error("the keyring is not answering");
    try {
      return run("secret-tool", args, o);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ETIMEDOUT") restUntil = now() + KEYRING_REST_MS;
      throw err;
    }
  };
  const store: ValueStore = {
    get(name) {
      try {
        return tool(["lookup", ...attrs(name)], { timeoutMs: KEYRING_READ_MS }).replace(/\n$/, "") || undefined;
      } catch {
        return undefined;
      }
    },
    set(name, value) {
      if (value === null) {
        try {
          tool(["clear", ...attrs(name)], { timeoutMs: KEYRING_READ_MS });
        } catch {}
        return;
      }
      // Storing may ask the person to unlock the keyring: it gets the time a person needs.
      tool(["store", "--label", `Colonia ${name}`, ...attrs(name)], { input: value, timeoutMs: 15_000 });
    },
    works() {
      // A round trip: a keyring that is missing, or a session bus that is not there, fails here.
      const probe = "colonia-store-probe";
      try {
        store.set(probe, "ok");
        const back = store.get(probe);
        store.set(probe, null);
        return back === "ok";
      } catch {
        return false;
      }
    },
  };
  return store;
}

// Windows PowerShell (always present) has .NET's ProtectedData; the operation and entropy come as variables and the
// bytes on stdin, so nothing secret reaches argv.
const DPAPI_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.Security",
  "$data = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())",
  "$entropy = [Text.Encoding]::UTF8.GetBytes($env:COLONIA_DPAPI_ENTROPY)",
  "$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser",
  "if ($env:COLONIA_DPAPI_OP -eq 'protect') { $out = [Security.Cryptography.ProtectedData]::Protect($data, $entropy, $scope) }",
  "else { $out = [Security.Cryptography.ProtectedData]::Unprotect($data, $entropy, $scope) }",
  "[Console]::Out.Write([Convert]::ToBase64String($out))",
].join("\n");
const ENCODED_SCRIPT = Buffer.from(DPAPI_SCRIPT, "utf16le").toString("base64");

/**
 * Values in `<home>/secrets.dpapi`, encrypted for the user's Windows account (DPAPI, CurrentUser): another account,
 * or the disk read elsewhere, cannot decrypt it. Credential Manager is DPAPI too, but caps a value at 2.5 KB.
 */
export function dpapiStore(
  home: string,
  service: string,
  run: Run = runCommand,
  runAsync: typeof runCommandAsync = runCommandAsync,
): ValueStore {
  const file = path.join(home, "secrets.dpapi");
  let values: Record<string, string> | undefined;
  const crypt = (op: "protect" | "unprotect", b64: string) =>
    run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", ENCODED_SCRIPT], {
      input: b64,
      env: { COLONIA_DPAPI_OP: op, COLONIA_DPAPI_ENTROPY: service },
    }).trim();
  // ARRANQUE-RAPIDO-1: a file this account cannot open (copied from another folder or computer) is not asked again on
  // every read: each try is a PowerShell (~0.5 s, blocking), and /health reads a secret. A change still tries again.
  let failedAt = 0;
  const RETRY_MS = 60_000;
  const load = (again = false): Record<string, string> => {
    if (values) return values;
    if (!again && failedAt && Date.now() - failedAt < RETRY_MS) throw new Error("secrets.dpapi could not be opened");
    try {
      return open();
    } catch (err) {
      failedAt = Date.now();
      throw err;
    }
  };
  const open = (): Record<string, string> => {
    const loaded = fs.existsSync(file)
      ? (JSON.parse(
          Buffer.from(crypt("unprotect", fs.readFileSync(file, "utf8").trim()), "base64").toString("utf8"),
        ) as Record<string, string>)
      : {};
    values = loaded;
    return loaded;
  };
  const save = (next: Record<string, string>) => {
    const sealed = crypt("protect", Buffer.from(JSON.stringify(next), "utf8").toString("base64"));
    fs.mkdirSync(home, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, sealed, { mode: 0o600 });
    fs.renameSync(tmp, file);
    values = next;
  };
  // RESTAURAR-DPAPI-1: every change goes through one Protect, however many names it carries.
  const apply = (changes: Record<string, string | null>) => {
    const next = { ...load(true) };
    for (const [name, value] of Object.entries(changes)) {
      if (value === null) delete next[name];
      else next[name] = value;
    }
    save(next);
  };
  return {
    get(name) {
      try {
        return load()[name];
      } catch {
        return undefined;
      }
    },
    set(name, value) {
      apply({ [name]: value });
    },
    setMany: (changes) => apply(changes),
    works() {
      try {
        const sample = Buffer.from("ok").toString("base64");
        return Buffer.from(crypt("unprotect", crypt("protect", sample)), "base64").toString("utf8") === "ok";
      } catch {
        return false;
      }
    },
    async warm() {
      const cryptAsync = async (op: "protect" | "unprotect", b64: string) =>
        (
          await runAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", ENCODED_SCRIPT], {
            input: b64,
            env: { COLONIA_DPAPI_OP: op, COLONIA_DPAPI_ENTROPY: service },
          })
        ).trim();
      try {
        if (values) return true;
        if (!fs.existsSync(file)) {
          const sample = Buffer.from("ok").toString("base64");
          return (
            Buffer.from(await cryptAsync("unprotect", await cryptAsync("protect", sample)), "base64").toString(
              "utf8",
            ) === "ok"
          );
        }
        const sealed = fs.readFileSync(file, "utf8").trim();
        const loaded = JSON.parse(
          Buffer.from(await cryptAsync("unprotect", sealed), "base64").toString("utf8"),
        ) as Record<string, string>;
        // A change saved while PowerShell ran already holds the newer values.
        values ??= loaded;
        return true;
      } catch {
        return false;
      }
    },
  };
}

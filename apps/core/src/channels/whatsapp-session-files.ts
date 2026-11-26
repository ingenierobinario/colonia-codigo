import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export const SESSION_LIMIT = 8 * 1024 * 1024;
const FILE_LIMIT = 2 * 1024 * 1024;
const prefixes = [
  "pre-key-",
  "session-",
  "sender-key-",
  "sender-key-memory-",
  "app-state-sync-key-",
  "app-state-sync-version-",
  "lid-mapping-",
  "device-list-",
  "tctoken-",
  "identity-key-",
];
export const sessionFileName = (name: string) =>
  name.length <= 240 &&
  /^[a-zA-Z0-9_@.+=-]+\.json$/.test(name) &&
  (name === "creds.json" ||
    name === "colonia-history-asked.json" ||
    prefixes.some((prefix) => name.startsWith(prefix)));
export const SessionFiles = z
  .array(z.object({ name: z.string().refine(sessionFileName), text: z.string().max(FILE_LIMIT) }).strict())
  .min(1)
  .max(20_000);
export type SessionFiles = z.infer<typeof SessionFiles>;
export const IMPORT_MARKER = ".colonia-handoff.json";

const binary = (length: number) =>
  z.unknown().transform((input, ctx) => {
    const parsed = z
      .union([
        z.string(),
        z.object({ type: z.literal("Buffer"), data: z.union([z.string(), z.array(z.number().int().min(0).max(255))]) }),
      ])
      .safeParse(input);
    const value = parsed.success ? (typeof parsed.data === "string" ? parsed.data : parsed.data.data) : undefined;
    const bytes =
      typeof value === "string" ? Buffer.from(value, "base64") : Array.isArray(value) ? Buffer.from(value) : undefined;
    if (!bytes || bytes.length !== length || (typeof value === "string" && bytes.toString("base64") !== value)) {
      ctx.addIssue({ code: "custom", message: "Invalid WhatsApp key" });
      return z.NEVER;
    }
    return bytes;
  });
const pair = z.object({ private: binary(32), public: binary(32) });
const linkedCredentials = z.object({
  me: z.object({ id: z.string().min(1).max(160) }),
  signedIdentityKey: pair,
  noiseKey: pair,
  signedPreKey: z.object({ keyPair: pair, signature: binary(64), keyId: z.number().int().nonnegative() }),
  account: z.object({ accountSignatureKey: binary(32), accountSignature: binary(64), deviceSignature: binary(64) }),
});

export function sessionIdentity(text: string): string | undefined {
  const value = JSON.parse(text);
  if (!value?.me?.id && !value?.account) return;
  const c = linkedCredentials.parse(value);
  return createHash("sha256").update(c.me.id).update(c.signedIdentityKey.public).digest("hex");
}

export function safeDirectory(dir: string, create = false): void {
  if (create && !fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe WhatsApp session directory");
}

export function readPrivateFile(file: string, max = FILE_LIMIT): string {
  safeDirectory(path.dirname(file));
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > max) throw new Error("Unsafe WhatsApp session file");
  return fs.readFileSync(file, "utf8");
}

export function linkedSession(dir: string): boolean {
  if (!fs.existsSync(path.dirname(dir))) return false;
  safeDirectory(path.dirname(dir));
  if (!fs.existsSync(dir)) return false;
  safeDirectory(dir);
  const file = path.join(dir, "creds.json");
  if (!fs.existsSync(file)) return false;
  return Boolean(sessionIdentity(readPrivateFile(file)));
}

export function validateSession(input: unknown): { files: SessionFiles; identity: string; digest: string } {
  const files = SessionFiles.parse(input).sort((a, b) => a.name.localeCompare(b.name, "en"));
  const names = new Set<string>();
  let bytes = 0;
  for (const f of files) {
    const key = f.name.toLowerCase();
    if (names.has(key)) throw new Error("Duplicate WhatsApp session file");
    names.add(key);
    bytes += Buffer.byteLength(f.text);
    if (Buffer.byteLength(f.text) > FILE_LIMIT || bytes > SESSION_LIMIT)
      throw new Error("WhatsApp session is too large to transfer");
    f.text = JSON.stringify(JSON.parse(f.text));
  }
  const creds = files.find((f) => f.name === "creds.json");
  const identity = creds && sessionIdentity(creds.text);
  if (!identity) throw new Error("WhatsApp session is not linked");
  return { files, identity, digest: createHash("sha256").update(JSON.stringify(files)).digest("hex") };
}

/** Only called for a channel which has never initialized its auth store in this process. */
export function readSession(dir: string) {
  const parent = fs.lstatSync(path.dirname(dir));
  const root = fs.lstatSync(dir);
  if (parent.isSymbolicLink() || root.isSymbolicLink() || !root.isDirectory())
    throw new Error("Unsafe WhatsApp session directory");
  if (fs.existsSync(path.join(dir, IMPORT_MARKER))) readPrivateFile(path.join(dir, IMPORT_MARKER));
  const entries = fs.readdirSync(dir).filter((name) => name !== IMPORT_MARKER);
  if (entries.length > 20_000) throw new Error("Too many WhatsApp session files");
  let bytes = 0;
  const files = entries.map((name) => {
    if (!sessionFileName(name)) throw new Error("Unexpected WhatsApp session file");
    const file = path.join(dir, name);
    const stat = fs.lstatSync(file);
    bytes += stat.size;
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > FILE_LIMIT || bytes > SESSION_LIMIT)
      throw new Error("Unsafe WhatsApp session file");
    return { name, text: fs.readFileSync(file, "utf8") };
  });
  return validateSession(files);
}

export function syncDirectory(dir: string) {
  safeDirectory(dir);
  if (process.platform === "win32") return;
  const fd = fs.openSync(dir, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export function durableJson(file: string, value: unknown) {
  const dir = path.dirname(file);
  safeDirectory(dir);
  const before = fs.lstatSync(dir);
  const temp = path.join(dir, `.${randomUUID()}.tmp`);
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    safeDirectory(dir);
    if (fs.lstatSync(dir).ino !== before.ino) throw new Error("WhatsApp directory changed while writing");
    fs.renameSync(temp, file);
    syncDirectory(dir);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

/** Bounded asynchronous I/O keeps the authenticated sync heartbeat alive for large sessions. */
export async function readSessionAsync(dir: string) {
  safeDirectory(path.dirname(dir));
  safeDirectory(dir);
  const entries = await fs.promises.readdir(dir);
  if (entries.length > 20_001) throw new Error("Too many WhatsApp session files");
  const files: SessionFiles = [];
  let bytes = 0;
  for (let at = 0; at < entries.length; at += 16) {
    const batch = await Promise.all(
      entries.slice(at, at + 16).map(async (name) => {
        if (name !== IMPORT_MARKER && !sessionFileName(name)) throw new Error("Unexpected WhatsApp session file");
        const file = path.join(dir, name);
        const stat = await fs.promises.lstat(file);
        bytes += stat.size;
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > FILE_LIMIT || bytes > SESSION_LIMIT)
          throw new Error("Unsafe WhatsApp session file");
        if (name === IMPORT_MARKER) return;
        return { name, text: await fs.promises.readFile(file, "utf8") };
      }),
    );
    for (const file of batch) if (file) files.push(file);
  }
  return validateSession(files);
}

export async function writeSessionFiles(dir: string, files: SessionFiles) {
  safeDirectory(dir);
  for (let at = 0; at < files.length; at += 16) {
    const results = await Promise.allSettled(
      files.slice(at, at + 16).map(async (entry) => {
        const fd = await fs.promises.open(path.join(dir, entry.name), "wx", 0o600);
        try {
          await fd.writeFile(entry.text);
          await fd.sync();
        } finally {
          await fd.close();
        }
      }),
    );
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
  syncDirectory(dir);
}

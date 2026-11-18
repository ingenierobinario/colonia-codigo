// COPIA-COMPLETA-1 · El contenedor de la copia completa de Colonia (DECISIONS.md#d-192): un único archivo cifrado con
// la contraseña de la persona. Dentro va una secuencia de entradas (ruta + bytes); fuera solo queda una cabecera sin
// nada privado. La clave sale de la contraseña con scrypt y cada trozo se cifra con AES-256-GCM, de modo que una
// contraseña mala, un archivo cortado o un byte cambiado se distinguen entre sí y nunca pasan por buenos.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from "node:crypto";
import fs from "node:fs";
import { deflateRawSync, inflateRawSync } from "node:zlib";

export const MAGIC = Buffer.from("COLONIA-COPIA-1\n", "utf8");
export const ARCHIVE_VERSION = 1;
export const PASSWORD_MIN = 8;
/** Texto en claro por trozo, antes de comprimir. */
const CHUNK = 1024 * 1024;
const TAG = 16;
const KDF = { n: 32768, r: 8, p: 1 } as const;
/** Tope de una cabecera o de los metadatos de una entrada: quien lo pasa no es una copia de Colonia. */
const SMALL_MAX = 64 * 1024;
/** Tope del cifrado de un trozo: el trozo en claro más lo que deflate puede añadir. */
const FRAME_MAX = CHUNK + 64 * 1024;

export type ArchiveWhy = "foreign" | "newer" | "password" | "broken" | "scope" | "folder";

/** Por qué no se pudo leer una copia; el RPC lo traduce a una frase para la persona. */
export class ArchiveError extends Error {
  readonly why: ArchiveWhy;
  constructor(why: ArchiveWhy) {
    super(`copia: ${why}`);
    this.why = why;
  }
}

export type ArchiveHeader = {
  v: number;
  kdf: { name: "scrypt"; n: number; r: number; p: number; salt: string };
  nonce: string;
  created_at: string;
  app_version: string;
};

export type EntryMeta = { p: string; n: number };

const pause = () => new Promise<void>((done) => setImmediate(done));

function deriveKey(password: string, salt: Buffer, kdf: { n: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      32,
      { N: kdf.n, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

const nonceOf = (prefix: Buffer, counter: number) => {
  const nonce = Buffer.alloc(12);
  prefix.copy(nonce, 0, 0, 8);
  nonce.writeUInt32BE(counter, 8);
  return nonce;
};

const aadOf = (headerHash: Buffer, last: boolean) => Buffer.concat([headerHash, Buffer.from([last ? 1 : 0])]);

export type ArchiveWriter = {
  /** Añade una entrada con sus bytes en memoria. */
  add(p: string, bytes: Buffer): Promise<void>;
  /** Añade un fichero del disco, leído por trozos. */
  addFile(p: string, file: string, verify?: (fd: number) => void): Promise<void>;
  /** Cierra el archivo; sin esto la copia no vale (le falta el trozo final). */
  close(): Promise<void>;
  /** Suelta el archivo a medias (tras un fallo). */
  abort(): void;
  /** Bytes en claro escritos hasta ahora. */
  written(): number;
};

/** Abre `file` para escribir una copia cifrada con `password`. */
export async function writeArchive(
  file: string,
  password: string,
  info: { created_at: string; app_version: string },
): Promise<ArchiveWriter> {
  const salt = randomBytes(16);
  const prefix = randomBytes(8);
  const header: ArchiveHeader = {
    v: ARCHIVE_VERSION,
    kdf: { name: "scrypt", ...KDF, salt: salt.toString("base64") },
    nonce: prefix.toString("base64"),
    created_at: info.created_at,
    app_version: info.app_version,
  };
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const headerHash = createHash("sha256").update(headerBytes).digest();
  const key = await deriveKey(password, salt, KDF);
  const fd = fs.openSync(file, "w", 0o600);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(headerBytes.length);
  fs.writeSync(fd, Buffer.concat([MAGIC, len, headerBytes]));

  let pending: Buffer[] = [];
  let pendingSize = 0;
  let counter = 0;
  let total = 0;
  let open = true;

  const frame = (plain: Buffer, last: boolean) => {
    const cipher = createCipheriv("aes-256-gcm", key, nonceOf(prefix, counter++));
    cipher.setAAD(aadOf(headerHash, last));
    const body = Buffer.concat([cipher.update(deflateRawSync(plain)), cipher.final()]);
    const head = Buffer.alloc(5);
    head.writeUInt32BE(body.length);
    head[4] = last ? 1 : 0;
    fs.writeSync(fd, Buffer.concat([head, body, cipher.getAuthTag()]));
  };

  const push = async (bytes: Buffer) => {
    total += bytes.length;
    pending.push(bytes);
    pendingSize += bytes.length;
    while (pendingSize >= CHUNK) {
      const all = pending.length === 1 ? (pending[0] as Buffer) : Buffer.concat(pending);
      frame(all.subarray(0, CHUNK), false);
      const rest = all.subarray(CHUNK);
      pending = rest.length ? [rest] : [];
      pendingSize = rest.length;
      await pause();
    }
  };

  const entryHead = (meta: EntryMeta) => {
    const json = Buffer.from(JSON.stringify(meta), "utf8");
    const n = Buffer.alloc(4);
    n.writeUInt32BE(json.length);
    return Buffer.concat([n, json]);
  };

  return {
    async add(p, bytes) {
      await push(entryHead({ p, n: bytes.length }));
      await push(bytes);
    },
    async addFile(p, source, verify) {
      const src = fs.openSync(
        source,
        verify ? fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK : "r",
      );
      try {
        verify?.(src);
        // El tamaño se fija al abrir: si el fichero crece mientras se copia, viaja lo que había; si mengua, se rellena.
        const size = fs.fstatSync(src).size;
        await push(entryHead({ p, n: size }));
        let left = size;
        while (left > 0) {
          const buf = Buffer.alloc(Math.min(CHUNK, left));
          let used = 0;
          while (used < buf.length) {
            const count = fs.readSync(src, buf, used, buf.length - used, size - left + used);
            if (!count) {
              if (verify) throw new Error("El archivo cambió mientras se copiaba.");
              break;
            }
            used += count;
          }
          left -= buf.length;
          await push(buf);
        }
        verify?.(src);
      } finally {
        fs.closeSync(src);
      }
    },
    async close() {
      if (!open) return;
      open = false;
      frame(pending.length ? Buffer.concat(pending) : Buffer.alloc(0), true);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    },
    abort() {
      if (!open) return;
      open = false;
      try {
        fs.closeSync(fd);
      } catch {}
      fs.rmSync(file, { force: true });
    },
    written: () => total,
  };
}

/** Lo que recibe los bytes de una entrada mientras se lee la copia. */
export type EntrySink = { write(bytes: Buffer): void; end(): void };

/** La cabecera en claro de una copia, sin contraseña; lanza `foreign` o `newer`. */
export function readHeader(fd: number): { header: ArchiveHeader; headerHash: Buffer; at: number } {
  const start = Buffer.alloc(MAGIC.length + 4);
  if (fs.readSync(fd, start, 0, start.length, 0) < start.length || !start.subarray(0, MAGIC.length).equals(MAGIC))
    throw new ArchiveError("foreign");
  const size = start.readUInt32BE(MAGIC.length);
  if (size === 0 || size > SMALL_MAX) throw new ArchiveError("foreign");
  const bytes = Buffer.alloc(size);
  if (fs.readSync(fd, bytes, 0, size, start.length) < size) throw new ArchiveError("broken");
  let header: ArchiveHeader;
  try {
    header = JSON.parse(bytes.toString("utf8")) as ArchiveHeader;
  } catch {
    throw new ArchiveError("foreign");
  }
  if (typeof header?.v !== "number" || !header.kdf || typeof header.nonce !== "string")
    throw new ArchiveError("foreign");
  if (header.v > ARCHIVE_VERSION) throw new ArchiveError("newer");
  const { n, r, p } = header.kdf;
  // Una cabecera manipulada no puede pedir una derivación que tumbe el equipo.
  if (header.kdf.name !== "scrypt" || !(n >= 1024 && n <= 1 << 20) || !(r >= 1 && r <= 16) || !(p >= 1 && p <= 4))
    throw new ArchiveError("foreign");
  return { header, headerHash: createHash("sha256").update(bytes).digest(), at: start.length + size };
}

/**
 * Lee una copia. Por cada entrada llama a `onEntry`: devuelve dónde dejar sus bytes, `null` para saltarla o "stop" para
 * no leer más (así el resumen sale de la primera entrada sin descifrar el resto).
 */
export async function readArchive(
  file: string,
  password: string,
  onEntry: (meta: EntryMeta) => EntrySink | null | "stop",
): Promise<ArchiveHeader> {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    throw new ArchiveError("foreign");
  }
  try {
    const { header, headerHash, at } = readHeader(fd);
    const key = await deriveKey(password, Buffer.from(header.kdf.salt, "base64"), header.kdf);
    const prefix = Buffer.from(header.nonce, "base64");
    if (prefix.length !== 8) throw new ArchiveError("foreign");

    let pos = at;
    let counter = 0;
    let done = false;
    // El analizador de entradas: bytes sueltos entre trozos, y la entrada a medias.
    let carry = Buffer.alloc(0);
    let sink: EntrySink | null = null;
    let left = 0;
    let stopped = false;

    const feed = (input: Buffer) => {
      let data = carry.length ? Buffer.concat([carry, input]) : input;
      carry = Buffer.alloc(0);
      while (data.length && !stopped) {
        if (left > 0) {
          const take = data.subarray(0, Math.min(left, data.length));
          sink?.write(take);
          left -= take.length;
          data = data.subarray(take.length);
          if (left === 0) {
            sink?.end();
            sink = null;
          }
          continue;
        }
        if (data.length < 4) break;
        const size = data.readUInt32BE(0);
        if (size === 0 || size > SMALL_MAX) throw new ArchiveError("broken");
        if (data.length < 4 + size) break;
        let meta: EntryMeta;
        try {
          meta = JSON.parse(data.subarray(4, 4 + size).toString("utf8")) as EntryMeta;
        } catch {
          throw new ArchiveError("broken");
        }
        if (typeof meta?.p !== "string" || !Number.isSafeInteger(meta.n) || meta.n < 0)
          throw new ArchiveError("broken");
        data = data.subarray(4 + size);
        const got = onEntry(meta);
        if (got === "stop") {
          stopped = true;
          return;
        }
        sink = got;
        left = meta.n;
        if (left === 0) {
          sink?.end();
          sink = null;
        }
      }
      if (!stopped) carry = Buffer.from(data);
    };

    while (!done && !stopped) {
      const head = Buffer.alloc(5);
      if (fs.readSync(fd, head, 0, 5, pos) < 5) throw new ArchiveError("broken");
      const size = head.readUInt32BE(0);
      const last = head[4] === 1;
      if (size > FRAME_MAX || (head[4] !== 0 && head[4] !== 1)) throw new ArchiveError(counter ? "broken" : "password");
      const body = Buffer.alloc(size + TAG);
      if (fs.readSync(fd, body, 0, body.length, pos + 5) < body.length) throw new ArchiveError("broken");
      pos += 5 + body.length;
      const decipher = createDecipheriv("aes-256-gcm", key, nonceOf(prefix, counter));
      decipher.setAAD(aadOf(headerHash, last));
      decipher.setAuthTag(body.subarray(size));
      let plain: Buffer;
      try {
        plain = inflateRawSync(Buffer.concat([decipher.update(body.subarray(0, size)), decipher.final()]), {
          maxOutputLength: CHUNK + 1024,
        });
      } catch {
        // El primer trozo que no abre es la contraseña; uno posterior, el archivo.
        throw new ArchiveError(counter ? "broken" : "password");
      }
      counter++;
      feed(plain);
      done = last;
      await pause();
    }
    if (!stopped && (left > 0 || carry.length)) throw new ArchiveError("broken");
    return header;
  } finally {
    fs.closeSync(fd);
  }
}

// Canal cifrado y con autenticación mutua entre Colonia principal y un equipo emparejado. Solo node:crypto.
//  - Cada lado tiene una clave Ed25519 propia (la identidad). El principal la fija el equipo al emparejar (huella en el
//    comando de instalación); el equipo la fija el principal al confirmarse el código.
//  - Cada conexión hace un ECDH X25519 efímero, firmado por ambos lados sobre toda la transcripción (secreto hacia
//    delante, sin repetición) y de ahí salen dos claves AES-256-GCM, una por sentido, con contador como nonce.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  type KeyObject,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
} from "node:crypto";

export type Identity = { publicKey: string; privateKey: string };

const b64 = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");

export function generateIdentity(): Identity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: b64(publicKey.export({ type: "spki", format: "der" })),
    privateKey: b64(privateKey.export({ type: "pkcs8", format: "der" })),
  };
}

const publicOf = (spki: string) => createPublicKey({ key: unb64(spki), format: "der", type: "spki" });
const privateOf = (pkcs8: string) => createPrivateKey({ key: unb64(pkcs8), format: "der", type: "pkcs8" });

/** Huella corta y legible de una clave pública: 128 bits en grupos de cuatro. */
export function fingerprintOf(publicKey: string): string {
  const hex = createHash("sha256").update(unb64(publicKey)).digest("hex").slice(0, 32);
  return hex.match(/.{4}/g)?.join("-") ?? hex;
}
export const sameFingerprint = (a: string, b: string) => {
  const clean = (s: string) => s.toLowerCase().replace(/[^0-9a-f]/g, "");
  const x = Buffer.from(clean(a));
  const y = Buffer.from(clean(b));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};

export type Ephemeral = { pub: string; priv: KeyObject };
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
export function newEphemeral(): Ephemeral {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const der = publicKey.export({ type: "spki", format: "der" });
  return { pub: b64(der.subarray(der.length - 32)), priv: privateKey };
}
const ephemeralPublic = (raw: string) => {
  const key = unb64(raw);
  if (key.length !== 32) throw new Error("clave efímera inválida");
  return createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, key]), format: "der", type: "spki" });
};

export const newNonce = () => b64(randomBytes(16));

/** Todo lo que se dijeron los dos lados: lo que se firma y de lo que salen las claves. Con longitud por campo. */
export function transcript(mode: "pair" | "session", ephC: string, nonceC: string, ephS: string, nonceS: string) {
  const parts = ["colonia-equipo-v1", mode, ephC, nonceC, ephS, nonceS].map((p) => Buffer.from(p));
  return Buffer.concat(parts.flatMap((p) => [Buffer.from([p.length]), p]));
}

export const signAs = (role: "principal" | "equipo", tr: Buffer, privateKey: string) =>
  b64(sign(null, Buffer.concat([Buffer.from(`firma:${role}:`), tr]), privateOf(privateKey)));
export function verifyAs(role: "principal" | "equipo", tr: Buffer, signature: string, publicKey: string): boolean {
  try {
    return verify(null, Buffer.concat([Buffer.from(`firma:${role}:`), tr]), publicOf(publicKey), unb64(signature));
  } catch {
    return false;
  }
}

/** Prueba de que quien empareja conoce el código, atada a la transcripción y a su clave (el código nunca viaja). */
export function pairProof(code: string, tr: Buffer, publicKey: string): string {
  return b64(createHmac("sha256", `codigo:${code}`).update(tr).update(unb64(publicKey)).digest());
}
export function sameProof(a: string, b: string): boolean {
  const x = unb64(a);
  const y = unb64(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type SessionKeys = { send: Buffer; receive: Buffer };
/** `role` es quien llama: el cliente envía con la primera clave y recibe con la segunda; el servidor al revés. */
export function deriveKeys(mine: Ephemeral, theirEph: string, tr: Buffer, role: "client" | "server"): SessionKeys {
  const shared = diffieHellman({ privateKey: mine.priv, publicKey: ephemeralPublic(theirEph) });
  const okm = Buffer.from(
    hkdfSync("sha256", shared, createHash("sha256").update(tr).digest(), "colonia-equipo-v1-claves", 64),
  );
  const c2s = okm.subarray(0, 32);
  const s2c = okm.subarray(32, 64);
  return role === "client" ? { send: c2s, receive: s2c } : { send: s2c, receive: c2s };
}

const TAG = 16;
const ivOf = (n: bigint) => {
  const iv = Buffer.alloc(12);
  iv.writeBigUInt64BE(n, 4);
  return iv;
};

/** Un sentido del canal: el contador es el nonce, así una trama repetida, perdida o reordenada no se abre. */
export function createSealer(key: Buffer) {
  let n = 0n;
  return (plain: Buffer): string => {
    const c = createCipheriv("aes-256-gcm", key, ivOf(n++));
    return b64(Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]));
  };
}
export function createOpener(key: Buffer) {
  let n = 0n;
  return (frame: string): Buffer => {
    const raw = unb64(frame);
    if (raw.length < TAG) throw new Error("trama corta");
    const d = createDecipheriv("aes-256-gcm", key, ivOf(n));
    d.setAuthTag(raw.subarray(raw.length - TAG));
    const out = Buffer.concat([d.update(raw.subarray(0, raw.length - TAG)), d.final()]);
    n++;
    return out;
  };
}

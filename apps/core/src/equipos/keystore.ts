// Dónde vive la clave privada de este equipo. NUNCA en claro, ni en un fichero 0600:
//  - con almacén del sistema (Keychain, DPAPI, libsecret) → ahí, por el mecanismo de secrets.ts;
//  - sin él → un fichero cifrado con AES-256-GCM y una clave derivada con scrypt de una contraseña que el dueño
//    pone una vez; sin contraseña no se empareja (la interfaz explica por qué).
// La misma clave firma la marca «permitir siempre» (HMAC), para que editar equipo.json a mano no conceda nada.
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Secrets } from "../secrets.ts";
import type { Identity } from "./channel.ts";

const KEY_SECRET = "equipo.clave";
export const vaultFile = (home: string) => path.join(home, "equipo.clave.cifrada");
const MIN_PASSPHRASE = 8;

export function createKeyStore(d: { home: string; secrets: Secrets }) {
  let loaded: Identity | undefined;
  /** Con el almacén del sistema la clave está protegida por él; sin él hace falta contraseña. */
  const system = () => d.secrets.backend !== "file";

  const derive = (pass: string, salt: Buffer) =>
    scryptSync(pass, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });

  return {
    /** ¿Hay que pedir una contraseña para poder guardar la clave? */
    needsPassphrase: () => !system(),
    /** ¿Existe una clave guardada que aún no se ha desbloqueado en esta ejecución? */
    locked(): boolean {
      if (loaded) return false;
      return !system() && fs.existsSync(vaultFile(d.home));
    },
    has(): boolean {
      return (
        Boolean(loaded) ||
        (system() ? Boolean(d.secrets.resolve(`secret://${KEY_SECRET}`)) : fs.existsSync(vaultFile(d.home)))
      );
    },
    save(id: Identity, passphrase?: string): void {
      if (system()) {
        d.secrets.set(KEY_SECRET, JSON.stringify(id));
      } else {
        if (!passphrase || passphrase.length < MIN_PASSPHRASE)
          throw new Error(
            `este equipo no tiene almacén de claves del sistema: elige una contraseña de al menos ${MIN_PASSPHRASE} caracteres para proteger la clave`,
          );
        const salt = randomBytes(16);
        const iv = randomBytes(12);
        const c = createCipheriv("aes-256-gcm", derive(passphrase, salt), iv);
        const ct = Buffer.concat([c.update(JSON.stringify(id), "utf8"), c.final()]);
        fs.mkdirSync(d.home, { recursive: true });
        fs.writeFileSync(
          vaultFile(d.home),
          JSON.stringify({
            v: 1,
            kdf: "scrypt",
            salt: salt.toString("base64"),
            iv: iv.toString("base64"),
            tag: c.getAuthTag().toString("base64"),
            ct: ct.toString("base64"),
          }),
          { mode: 0o600 },
        );
      }
      loaded = id;
    },
    /** Devuelve la clave si está disponible; con contraseña, la descifra y la deja en memoria. */
    load(passphrase?: string): Identity | undefined {
      if (loaded) return loaded;
      if (system()) {
        const raw = d.secrets.resolve(`secret://${KEY_SECRET}`);
        try {
          loaded = raw ? (JSON.parse(raw) as Identity) : undefined;
        } catch {
          loaded = undefined;
        }
        return loaded;
      }
      if (!passphrase || !fs.existsSync(vaultFile(d.home))) return undefined;
      try {
        const v = JSON.parse(fs.readFileSync(vaultFile(d.home), "utf8"));
        const k = derive(passphrase, Buffer.from(v.salt, "base64"));
        const x = createDecipheriv("aes-256-gcm", k, Buffer.from(v.iv, "base64"));
        x.setAuthTag(Buffer.from(v.tag, "base64"));
        loaded = JSON.parse(
          Buffer.concat([x.update(Buffer.from(v.ct, "base64")), x.final()]).toString("utf8"),
        ) as Identity;
        return loaded;
      } catch {
        return undefined;
      }
    },
    clear(): void {
      loaded = undefined;
      d.secrets.set(KEY_SECRET, null);
      fs.rmSync(vaultFile(d.home), { force: true });
    },
    /** Se olvida de la memoria (al parar); la clave sigue guardada. */
    forget(): void {
      loaded = undefined;
    },
    /** Firma una marca local con una clave derivada de la privada. Sin la clave no hay firma ni verificación. */
    mac(message: string): string | undefined {
      const id = loaded ?? this.load();
      if (!id) return undefined;
      const k = Buffer.from(hkdfSync("sha256", Buffer.from(id.privateKey), "colonia-equipo", "marca-local", 32));
      return createHmac("sha256", k).update(message).digest("base64");
    },
    verify(message: string, mac: string | undefined): boolean {
      const want = this.mac(message);
      if (!want || !mac) return false;
      const a = Buffer.from(want);
      const b = Buffer.from(mac);
      return a.length === b.length && timingSafeEqual(a, b);
    },
  };
}
export type KeyStore = ReturnType<typeof createKeyStore>;

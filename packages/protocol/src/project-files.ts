const SENSITIVE_FILE =
  /(^|\/)(\.env(\..*)?|\.npmrc|\.netrc|\.pypirc|id_[a-z0-9]+|.*\.(pem|key|p12|pfx|jks|keystore|crt|cer|der|sqlite|db)|.*(cookie|credential|secret|token|session|password|passwd)s?[^/]*)$/i;
export const sensitiveFile = (rel: string) => SENSITIVE_FILE.test(rel) || rel.split("/").some((s) => s.startsWith("."));

export const WORK_FILE_MAX = 200_000;
export const WORK_FILES_MAX = 60;

/** Las tres plataformas pueden recuperar el nombre y distinguirlo del estado privado del proyecto. */
export function shareableWorkPath(rel: string): boolean {
  if (!rel || rel.length > 240) return false;
  return rel
    .split("/")
    .every(
      (part) =>
        part.length > 0 &&
        part.length <= 140 &&
        !/[\p{Cc}<>:"\\|?*]/u.test(part) &&
        !/[. ]$/.test(part) &&
        !sensitiveFile(part) &&
        !/^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part) &&
        !/^(?:(?:login data|web data)(?:-journal|-wal|-shm)?|logins\.json|local state|keychain|node_modules|agents(?:\.override)?\.md|claude\.md)$/i.test(
          part,
        ),
    );
}

/** Un paquete no puede confundir un archivo con una carpeta ni mezclar grafías de la misma ruta. */
export function distinctWorkPaths(paths: readonly string[]): boolean {
  const entries = new Map<string, { path: string; directory: boolean }>();
  for (const rel of paths) {
    const parts = rel.split("/");
    let current = "";
    for (const [i, part] of parts.entries()) {
      current = current ? `${current}/${part}` : part;
      const key = current.normalize("NFC").toLowerCase();
      const directory = i < parts.length - 1;
      const seen = entries.get(key);
      if (seen && (!seen.directory || !directory || seen.path !== current)) return false;
      entries.set(key, { path: current, directory });
    }
  }
  return true;
}

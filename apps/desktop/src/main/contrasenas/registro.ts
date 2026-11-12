// Cableado de las contraseñas guardadas y de la importación del navegador: solo el panel puede preguntar, y la
// aplicación que habla sale del registro que hace el anfitrión al crear su página, no de lo que diga la propia página.
import path from "node:path";
import { type BaseWindow, ipcMain, safeStorage, type WebContents } from "electron";
import type { BrowserHost } from "../browser/host.ts";
import { descubrirFuentes, leerFuente } from "../migrar/navegadores.ts";
import { type CajaSecreta, crearBoveda } from "./boveda.ts";
import { confirmarDueno } from "./confirmar.ts";
import { crearGuardian, type Respuesta } from "./guardian.ts";

// En Linux sin llavero, safeStorage cae a un «basic_text» que no protege nada: cuenta como no disponible.
const cajaDelSistema: CajaSecreta = {
  disponible: () =>
    safeStorage.isEncryptionAvailable() &&
    !(process.platform === "linux" && safeStorage.getSelectedStorageBackend?.() === "basic_text"),
  cifrar: (t) => safeStorage.encryptString(t),
  descifrar: (d) => safeStorage.decryptString(d),
};

const TEXTOS = {
  es: {
    motivo: "Confirma que eres tú para ver una contraseña guardada en Colonia.",
    titulo: "¿Ver la contraseña?",
    aceptar: "Ver",
    cancelar: "Cancelar",
  },
  en: {
    motivo: "Confirm it is you to view a password saved in Colonia.",
    titulo: "View the password?",
    aceptar: "View",
    cancelar: "Cancel",
  },
};

export function registrarContrasenas(o: {
  host: BrowserHost;
  panel: WebContents;
  ventana: () => BaseWindow | undefined;
  idioma: () => string | undefined;
  datos: string;
  dist: string;
}): void {
  const boveda = crearBoveda({ archivo: path.join(o.datos, "logins.json"), caja: cajaDelSistema });
  const guardian = crearGuardian(boveda, (oferta) => {
    if (!o.panel.isDestroyed()) o.panel.send("logins:offer", oferta);
  });
  const apps = new Map<number, string>();
  o.host.onAppView = (appId, wc) => {
    apps.set(wc.id, appId);
    wc.once("destroyed", () => apps.delete(wc.id));
  };
  o.host.appPreload = path.join(o.dist, "app-preload.cjs");

  const delPanel = (e: { sender: WebContents }) => e.sender === o.panel;
  // La aplicación y la dirección son las del fotograma principal que envía; un subfotograma no cuenta.
  const origenPagina = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => {
    const app = apps.get(e.sender.id);
    const f = e.senderFrame;
    return app && f && f === e.sender.mainFrame ? { app, url: f.url } : undefined;
  };

  ipcMain.handle("login:probe", (e) => {
    const p = origenPagina(e);
    return p ? guardian.sondear(p.app, p.url) : undefined;
  });
  ipcMain.on("login:capture", (e, usuario: unknown, contrasena: unknown) => {
    const p = origenPagina(e);
    if (p) guardian.capturar(p.app, p.url, usuario, contrasena);
  });

  ipcMain.handle("logins:available", (e) => delPanel(e) && boveda.disponible());
  ipcMain.handle("logins:answer", (e, id: unknown, r: unknown) =>
    delPanel(e) && typeof id === "string" && (r === "guardar" || r === "nunca" || r === "ahora-no")
      ? guardian.responder(id, r as Respuesta)
      : "descartada",
  );
  ipcMain.handle("logins:list", (e) => (delPanel(e) ? boveda.lista() : []));
  ipcMain.handle("logins:remove", (e, id: unknown) => delPanel(e) && typeof id === "string" && boveda.borrar(id));
  ipcMain.handle("logins:reveal", async (e, id: unknown) => {
    if (!delPanel(e) || typeof id !== "string") return { ok: false };
    const t = o.idioma()?.startsWith("es") ? TEXTOS.es : TEXTOS.en;
    if (!(await confirmarDueno(o.ventana(), t))) return { ok: false };
    const contrasena = boveda.revelar(id);
    return contrasena === undefined ? { ok: false } : { ok: true, contrasena };
  });

  // Importar: solo cuando el usuario pulsa «Importar»; el panel recibe nombres de perfil, nunca rutas.
  ipcMain.handle("import:sources", (e) =>
    delPanel(e) ? descubrirFuentes().map(({ id, navegador, perfil }) => ({ id, navegador, perfil })) : [],
  );
  ipcMain.handle("import:read", (e, id: unknown) => {
    const f = delPanel(e) && typeof id === "string" ? descubrirFuentes().find((x) => x.id === id) : undefined;
    return f ? leerFuente(f) : undefined;
  });
}

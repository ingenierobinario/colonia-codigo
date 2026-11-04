// The update as the app menu says it ("Check for updates…", "Update to Colonia 2.3.0…", "Restart to update to Colonia 2.3.0")
// and the native questions it asks when the owner started it there: restart now or later.
import { type BaseWindow, dialog, type MenuItemConstructorOptions, Notification } from "electron";
import type { DesktopUpdate, RestartAnswer } from "./updater.ts";

type Updater = Omit<ReturnType<typeof import("./updater.ts").createDesktopUpdater>, "restart"> & {
  restart(): RestartAnswer | Promise<RestartAnswer>;
  automatic?(): boolean;
};

const words = (es: boolean, platform: string) => ({
  check: es ? "Buscar actualizaciones…" : "Check for updates…",
  update: (v: string) => (es ? `Actualizar a Colonia ${v}…` : `Update to Colonia ${v}…`),
  downloading: (v: string) => (es ? `Descargando Colonia ${v}…` : `Downloading Colonia ${v}…`),
  restart: (v: string) => (es ? `Reiniciar para actualizar a Colonia ${v}` : `Restart to update to Colonia ${v}`),
  readyTitle: (v: string) => (es ? `Colonia ${v} está listo` : `Colonia ${v} is ready`),
  readyDetail:
    platform === "win32"
      ? es
        ? "Se instala al reiniciar Colonia. Si elegís más tarde, queda en el menú Colonia: Reiniciar para actualizar."
        : "It goes in when Colonia restarts. If you choose later, it waits in the Colonia menu: Restart to update."
      : es
        ? "Se instala al reiniciar Colonia. Si elegís más tarde, se instala cuando salgas de Colonia."
        : "It goes in when Colonia restarts. If you choose later, it goes in when you quit Colonia.",
  remoteReady: es
    ? "El servidor ya confirmó la versión. Se vuelve a verificar antes de aplicar esta app; salir de Colonia no la instala."
    : "The server confirmed the target release. It is checked again before applying this app; quitting Colonia does not install it.",
  openInstaller: es ? "Abrir instalador" : "Open installer",
  manualReady: es
    ? "El servidor se verifica antes de abrir el instalador. Reemplazá esta app manualmente y volvé a abrirla."
    : "The server is checked before opening the installer. Replace this app manually, then open it again.",
  restartNow: es ? "Reiniciar ahora" : "Restart now",
  later: es ? "Más tarde" : "Later",
  upToDate: es ? "Colonia está al día" : "Colonia is up to date",
  version: (v: string) => (es ? `Tenés la versión ${v}.` : `You have version ${v}.`),
  failed: es ? "No se pudo actualizar Colonia" : "Colonia could not update",
  noFeed: es ? "No se pudo consultar si hay una versión nueva." : "Could not ask whether a newer version is out.",
  dragged: (v: string) =>
    es
      ? `Se abrió Colonia ${v}: arrastralo a Aplicaciones, reemplazando este, y abrilo de nuevo.`
      : `Colonia ${v} opened: drag it into Applications, replacing this one, and open it again.`,
  readyNote: (v: string) =>
    es ? `Colonia ${v} está listo. Reiniciá Colonia para usarlo.` : `Colonia ${v} is ready. Restart Colonia to use it.`,
  outNote: (v: string) => (es ? `Salió Colonia ${v}. Abrí Colonia para actualizar.` : `Colonia ${v} is out. Open Colonia to update.`),
  ok: es ? "Aceptar" : "OK",
});

export function createUpdateMenu(opts: { updater: Updater; window: BaseWindow; es: boolean; platform: string }) {
  const { updater, window } = opts;
  const t = words(opts.es, opts.platform);
  let told: string | undefined;

  async function askRestart(version: string): Promise<void> {
    const { response } = await dialog.showMessageBox(window, {
      type: "info",
      message: t.readyTitle(version),
      detail: updater.mode === "drag" ? t.manualReady : updater.automatic?.() === false ? t.remoteReady : t.readyDetail,
      buttons: [updater.mode === "drag" ? t.openInstaller : t.restartNow, t.later],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) await restart();
  }

  /** Restarting quits Colonia; an answer back means it could not, and the owner is told why. */
  async function restart(): Promise<void> {
    const r = await updater.restart();
    if (!r.ok)
      await dialog.showMessageBox(window, { type: "warning", message: t.failed, detail: r.error, buttons: [t.ok] });
  }

  async function update(version: string): Promise<void> {
    const r = await updater.install();
    if (!r.ok) {
      await dialog.showMessageBox(window, { type: "warning", message: t.failed, detail: r.error, buttons: [t.ok] });
      return;
    }
    if (r.ready) await askRestart(version);
    else await dialog.showMessageBox(window, { type: "info", message: t.dragged(version), buttons: [t.ok] });
  }

  async function checkNow(): Promise<void> {
    const s = await updater.check();
    if (s.latest) return update(s.latest);
    await dialog.showMessageBox(window, {
      type: s.error ? "warning" : "info",
      message: s.error ? t.failed : t.upToDate,
      detail: s.error ? `${t.noFeed}\n${s.error}` : t.version(s.current),
      buttons: [t.ok],
    });
  }

  return {
    /** The app menu's update entry, as things stand now; none where the app does not update itself (a checkout). */
    item(s: DesktopUpdate): MenuItemConstructorOptions | undefined {
      if (!updater.enabled) return undefined;
      if (s.ready)
        return {
          id: "update",
          label: updater.mode === "drag" ? `${t.openInstaller} (${s.ready})…` : t.restart(s.ready),
          click: () => void restart(),
        };
      if (s.downloading && s.latest) return { id: "update", label: t.downloading(s.latest), enabled: false };
      const latest = s.latest;
      if (latest) return { id: "update", label: t.update(latest), click: () => void update(latest) };
      return { id: "update", label: t.check, click: () => void checkNow() };
    },
    /** A background check found a newer Colonia: auto mode downloads it and says once it is ready; drag mode says it is out. */
    found(s: DesktopUpdate) {
      const latest = s.latest;
      if (!latest || told === latest) return;
      told = latest;
      const notify = (body: string, click?: () => void) => {
        if (!Notification.isSupported()) return;
        const n = new Notification({ title: "Colonia", body });
        if (click) n.on("click", click);
        n.show();
      };
      if (updater.mode !== "auto" || updater.automatic?.() === false) return notify(t.outNote(latest));
      void updater.install().then((r) => {
        if (r.ok && r.ready) notify(t.readyNote(latest), () => void askRestart(latest));
      });
    },
  };
}

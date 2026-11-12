// The update as the app menu says it ("Check for updates…", "Update to Colonia 2.3.0…", "Restart to update to Colonia 2.3.0")
// and the native questions it asks when the owner started it there: restart now or later.
import { type BaseWindow, dialog, type MenuItemConstructorOptions, Notification } from "electron";
import type { BundlePlace } from "./app-bundle.ts";
import { updateNotice } from "./update-notes.ts";
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
        ? "Se instala al reiniciar Colonia. Si eliges más tarde, queda en el menú Colonia: Reiniciar para actualizar."
        : "It goes in when Colonia restarts. If you choose later, it waits in the Colonia menu: Restart to update."
      : es
        ? "Se instala al reiniciar Colonia. Si eliges más tarde, se instala cuando salgas de Colonia."
        : "It goes in when Colonia restarts. If you choose later, it goes in when you quit Colonia.",
  remoteReady: es
    ? "El servidor ya confirmó la versión. Se vuelve a verificar antes de aplicar esta app; salir de Colonia no la instala."
    : "The server confirmed the target release. It is checked again before applying this app; quitting Colonia does not install it.",
  openInstaller:
    platform === "linux"
      ? es
        ? "Mostrar la versión nueva"
        : "Show the new version"
      : es
        ? "Abrir instalador"
        : "Open installer",
  manualReady:
    platform === "linux"
      ? es
        ? "El servidor se verifica antes de mostrarte el fichero nuevo. Cierra Colonia y ábrelo."
        : "The server is checked before Colonia shows you the new file. Close Colonia and open it."
      : es
        ? "El servidor se verifica antes de abrir el instalador. Reemplaza esta app manualmente y vuelve a abrirla."
        : "The server is checked before opening the installer. Replace this app manually, then open it again.",
  // Colonia came from the .deb or .rpm: the system's package manager puts the newer package in, with the owner's password.
  packageSteps: (command: string) =>
    es
      ? `Colonia se instaló con el gestor de paquetes del sistema, así que la versión nueva se instala igual: cierra Colonia, abre una terminal y escribe esta orden (te pedirá tu contraseña):\n\n${command}\n\nLuego vuelve a abrir Colonia.`
      : `Colonia was installed with the system's package manager, so the new version goes in the same way: quit Colonia, open a terminal and type this command (it asks for your password):\n\n${command}\n\nThen open Colonia again.`,
  restartNow: es ? "Reiniciar ahora" : "Restart now",
  later: es ? "Más tarde" : "Later",
  upToDate: es ? "Colonia está al día" : "Colonia is up to date",
  version: (v: string) => (es ? `Tienes la versión ${v}.` : `You have version ${v}.`),
  failed: es ? "No se pudo actualizar Colonia" : "Colonia could not update",
  noFeed: es ? "No se pudo consultar si hay una versión nueva." : "Could not ask whether a newer version is out.",
  dragged: (v: string) =>
    platform === "linux"
      ? es
        ? `Colonia te muestra el fichero de Colonia ${v}. Cierra Colonia y ábrelo.`
        : `Colonia shows you the new file for Colonia ${v}. Close Colonia and open it.`
      : es
      ? `Se abrió Colonia ${v}: arrástralo a Aplicaciones, reemplazando este, y ábrelo de nuevo.`
      : `Colonia ${v} opened: drag it into Applications, replacing this one, and open it again.`,
  ok: es ? "Aceptar" : "OK",
  // Why this Mac app cannot update itself, and the one thing that fixes it.
  moveFirst: (place: BundlePlace | undefined) =>
    place === "translocated"
      ? es
        ? "Colonia no puede actualizarse sola aquí: macOS la está ejecutando desde una copia temporal porque se abrió donde se descargó. Sal de Colonia, arrástrala a Aplicaciones en el Finder y ábrela desde allí; a partir de entonces se actualiza sola."
        : "Colonia cannot update itself here: macOS is running it from a temporary copy because it was opened where it was downloaded. Quit Colonia, drag it into Applications in the Finder and open it from there; from then on it updates by itself."
      : place === "disk-image"
        ? es
          ? "Colonia no puede actualizarse sola aquí: se está ejecutando desde su imagen de disco. Arrástrala a Aplicaciones, expulsa la imagen y ábrela desde Aplicaciones; a partir de entonces se actualiza sola."
          : "Colonia cannot update itself here: it is running from its disk image. Drag it into Applications, eject the disk image and open it from Applications; from then on it updates by itself."
        : place === "read-only"
          ? es
            ? "Colonia no puede actualizarse sola aquí: tu cuenta no puede cambiar la carpeta donde está. Muévela a Aplicaciones (o a una carpeta Aplicaciones dentro de tu carpeta de inicio) y ábrela desde allí; a partir de entonces se actualiza sola."
            : "Colonia cannot update itself here: your account cannot change the folder it is in. Move it to Applications (or to an Applications folder inside your home folder) and open it from there; from then on it updates by itself."
          : undefined,
});

export function createUpdateMenu(opts: { updater: Updater; window: BaseWindow; es: boolean; platform: string }) {
  const { updater, window } = opts;
  const t = words(opts.es, opts.platform);
  let told: string | undefined;

  async function askRestart(version: string): Promise<void> {
    const command = updater.packageCommand?.();
    const { response } = await dialog.showMessageBox(window, {
      type: "info",
      message: t.readyTitle(version),
      detail:
        updater.mode === "drag"
          ? command
            ? t.packageSteps(command)
            : [t.manualReady, t.moveFirst(updater.place)].filter(Boolean).join("\n\n")
          : updater.automatic?.() === false
            ? t.remoteReady
            : t.readyDetail,
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
    else {
      const command = updater.packageCommand?.();
      const detail = command ? t.packageSteps(command) : t.moveFirst(updater.place);
      await dialog.showMessageBox(window, {
        type: "info",
        message: command ? t.readyTitle(version) : t.dragged(version),
        ...(detail ? { detail } : {}),
        buttons: [t.ok],
      });
    }
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
      const notify = (kind: "out" | "ready", click?: () => void) => {
        if (!Notification.isSupported()) return;
        // The version in the title, then the first thing it brings: what there is room for in a notification.
        const n = new Notification(updateNotice(kind, latest, opts.es, s));
        if (click) n.on("click", click);
        n.show();
      };
      if (updater.mode !== "auto" || updater.automatic?.() === false) return notify("out");
      void updater.install().then((r) => {
        if (r.ok && r.ready) notify("ready", () => void askRestart(latest));
      });
    },
  };
}

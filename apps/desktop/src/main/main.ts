// The window is the Colonia panel (web). The panel reserves a slot for the browser and reports its bounds;
// the active tab's native view is positioned over that slot. Tab views are siblings of the panel, so a
// panel reload never kills tabs.
import fs from "node:fs";
import path from "node:path";
import {
  app,
  BaseWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  Notification,
  powerMonitor,
  shell,
  type WebContents,
  WebContentsView,
} from "electron";
import { showAbout } from "./about.ts";
import { registerAppScheme, serveAppScheme, webDist } from "./app-scheme.ts";
import { createArtifactWindows } from "./artifact-windows.ts";
import { runAskpass } from "./askpass.ts";
import { installedBrowsers, isWebUrl, openExternal } from "./browser/external.ts";
import { BrowserHost, blockAppOrigins } from "./browser/host.ts";
import { type Bounds, createPopout } from "./browser/popout.ts";
import { COMPUTER_PLATFORMS, computerPermissions, createComputer, openPrivacy } from "./computer.ts";
import { applySavedLocalTarget, loadConnection, localCoreUrl } from "./connection.ts";
import { createConnector } from "./connector.ts";
import { createCursor } from "./cursor.ts";
import { editMenu } from "./edit-menu.ts";
import { hasTrayHost, sandboxNotice, sandboxText } from "./linux-desktop.ts";
import { artifactOwners, itemName, memoryReport, memoryText, memoryWatch, size } from "./memory.ts";
import { nativeUpdates } from "./native-updates.ts";
import { startNodeLink } from "./node-link.ts";
import { openedIn, openedQueue } from "./opened-files.ts";
import { createPrograms } from "./programs.ts";
import { createQuick, type DesktopPrefs } from "./quick.ts";
import { confirmQuit } from "./quit-confirm.ts";
import { createUpdateMenu } from "./update-menu.ts";
import { createDesktopUpdater, type DesktopUpdate } from "./updater.ts";

// ssh runs this same executable as its SSH_ASKPASS (askpass.ts): it answers one question and exits before the app's
// data folder, its scheme or the single-instance lock are touched.
if (process.env.COLONIA_ASKPASS) process.exit(await runAskpass(process.env, process.argv));

const WEB_URL = process.env.COLONIA_WEB_URL ?? "http://127.0.0.1:7441";
const DIST = import.meta.dirname;

/** Past this, Colonia tells the owner how much it takes and what takes the most. */
const MEMORY_LIMIT_MB = 4096;

// The app is Colonia (menus, notifications, About), keeping the data folder it always had (its browser sessions and
// imported cookies live there). COLONIA_DESKTOP_DATA gives a copy its own (a test run): its own sessions and its own
// single-instance lock, so it never meets the owner's running Colonia.
app.setPath("userData", process.env.COLONIA_DESKTOP_DATA ?? path.join(app.getPath("appData"), "@colonia", "desktop"));
app.setName("Colonia");
// Windows files notifications and taskbar pins under this id: the installer's shortcut carries the same one.
if (process.platform === "win32") app.setAppUserModelId("com.ingenierobinario.colonia");
// Wayland groups a window under the launcher whose file name this is; the installer writes that file.
if (process.platform === "linux") app.setDesktopName("colonia.desktop");
applySavedLocalTarget(app.getPath("userData"), process.env);
const CORE_URL = localCoreUrl();
const openedConnection = JSON.stringify(loadConnection(app.getPath("userData")));

registerAppScheme();

// One Colonia at a time: opening it again brings the running one forward.
const single = app.requestSingleInstanceLock();
if (!single) app.quit();

// Files opened with Colonia (double-click, Open with, the Dock icon): macOS sends them even before the window exists.
let tellPanel = () => {};
const opened = openedQueue(() => tellPanel());
app.on("open-file", (e, file) => {
  e.preventDefault();
  opened.add([file]);
});
opened.add(openedIn(process.argv.slice(1)));

let quitting = false;
// Quitting asks first (closing the window only hides it). Set by the updater, a shutdown or a confirmed answer.
let askBeforeQuit: (() => boolean) | undefined;
app.on("before-quit", (e) => {
  if (!quitting && askBeforeQuit && !askBeforeQuit()) {
    e.preventDefault();
    return;
  }
  quitting = true;
});

app.whenReady().then(() => {
  if (!single) return;
  // Run straight from Electron (not the Colonia bundle `pnpm app` makes), the Dock still shows Colonia's face.
  // The packaged app already carries its bundle icon (shaped by macOS); a PNG set here would replace it as drawn.
  if (!app.isPackaged) app.dock?.setIcon(path.join(DIST, "icon.png"));
  // One chrome bar: native window controls sit in the topbar (hidden title bar on every OS).
  const win = new BaseWindow({
    width: 1480,
    height: 920,
    minWidth: 980,
    minHeight: 600,
    title: "Colonia",
    autoHideMenuBar: true,
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 14 } }
      : {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: { color: "#1a1a19", symbolColor: "#c8c8c8", height: 46 },
        }),
    // Behind the panel, the theme's own color: a pixel the panel does not cover never shows white.
    backgroundColor: "#1a1a19",
  });
  const foregroundMain = () => {
    // Steal focus so a double-click on the tray brings Colonia above other apps on every display.
    if (process.platform === "darwin") app.focus({ steal: true });
    win.show();
    win.moveTop();
    win.focus();
  };
  const openMain = () => {
    if (win.isMinimized()) {
      // Restoring is asynchronous: focus after the native window finishes its transition.
      win.removeListener("restore", foregroundMain);
      win.once("restore", foregroundMain);
      win.restore();
    } else foregroundMain();
  };
  // Closing the window hides it — its browser tabs and the core link stay alive; the Dock, the menu-bar icon or
  // opening Colonia again bring it back, and Quit ends it.
  // A Linux desktop without a tray (GNOME) has nothing to bring a hidden window back with: there it minimises.
  let trayHost = true;
  const findTrayHost = () => {
    void hasTrayHost(process.platform, process.env).then((has) => {
      trayHost = has;
    });
  };
  findTrayHost();
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    if (trayHost) win.hide();
    else win.minimize();
    // A tray extension can come or go while Colonia runs.
    findTrayHost();
  });
  app.on("activate", openMain);
  app.on("second-instance", (_event, argv) => {
    if (
      argv.includes("--colonia-adopt-local") &&
      JSON.stringify(loadConnection(app.getPath("userData"))) !== openedConnection
    ) {
      quitting = true;
      delete process.env.COLONIA_HOME;
      delete process.env.COLONIA_PORT;
      delete process.env.COLONIA_URL;
      delete process.env.COLONIA_TOKEN;
      app.relaunch();
      app.quit();
      return;
    }
    opened.add(openedIn(argv.slice(1)));
    openMain();
  });
  // Every page (the panel, the quick chat, browser tabs) gets the edit menu on a right click.
  app.on("web-contents-created", (_e, contents) => {
    contents.on("context-menu", (_ev, params) => {
      const items = editMenu(params, app.getLocale(), {
        replaceMisspelling: (word) => contents.replaceMisspelling(word),
        addToDictionary: (word) => contents.session.addWordToSpellCheckerDictionary(word),
        copyText: (text) => clipboard.writeText(text),
      });
      if (items.length) Menu.buildFromTemplate(items).popup({ frame: params.frame ?? undefined });
    });
  });
  serveAppScheme("persist:colonia-ui", webDist(DIST));
  const host = new BrowserHost();
  blockAppOrigins([CORE_URL, WEB_URL]);

  // The panel never shares a partition with web tabs; its preload only exposes the bounds bridge.
  const panel = new WebContentsView({
    webPreferences: {
      partition: "persist:colonia-ui",
      sandbox: true,
      preload: path.join(DIST, "panel-preload.cjs"),
      // The panel must keep applying live events while the window is behind others.
      backgroundThrottling: false,
    },
  });
  win.contentView.addChildView(panel);
  externalLinks(panel.webContents);
  let shown: WebContentsView | undefined;
  let slot: Bounds | null = null;
  // The quick chat loads from wherever the panel did (the dev server or the core); so does the browser window.
  let base = CORE_URL;
  // The panel's language (it says so on load and on every change), for the About window.
  let language: string | undefined;

  const popout = createPopout({
    url: () => base,
    preload: path.join(DIST, "panel-preload.cjs"),
    partition: "persist:colonia-ui",
    changed: (open) => {
      const pw = popout.panel();
      if (open && pw) externalLinks(pw);
      panel.webContents.send("browser:popout", open);
      layout();
    },
    layout: () => layout(),
  });
  const unparent = (view: WebContentsView) => {
    for (const w of [win, popout.window()])
      if (w?.contentView.children.includes(view)) w.contentView.removeChildView(view);
  };
  // The tab is on screen in the browser window while it is open, else in the main window's slot.
  const stage = () => {
    const pw = popout.window();
    return pw ? { w: pw, slot: popout.slot() } : { w: win, slot };
  };
  const onScreen = () => {
    const s = stage().slot;
    return Boolean(s && s.width > 0 && s.height > 0);
  };

  const layout = () => {
    const { width, height } = win.getContentBounds();
    panel.setBounds({ x: 0, y: 0, width, height });
    if (!shown) return;
    const { w, slot: at } = stage();
    // Hidden tabs sit behind the panel at a real size instead of setVisible(false): an invisible view stops
    // painting, and the agent still needs screenshots and layout of the page it is driving.
    unparent(shown);
    if (at && onScreen()) {
      w.contentView.addChildView(shown);
      shown.setBounds(at);
    } else {
      const area = w.getContentBounds();
      w.contentView.addChildView(shown, 0);
      shown.setBounds({ x: 0, y: 0, width: Math.min(area.width, 1280), height: area.height });
    }
  };
  host.onShow = (view) => {
    if (shown && shown !== view) unparent(shown);
    shown = view;
    layout();
  };
  host.on("changed", () => {
    const active = host.active ? host.list().find((t) => t.tab === host.active) : undefined;
    popout.setTitle(active?.title || "Colonia");
  });
  host.onAttention = (message) => {
    openMain();
    if (Notification.isSupported()) new Notification({ title: "Colonia", body: message }).show();
  };
  win.on("resize", layout);
  // Windows sends resize before a maximize settles: lay out again once the final size is in.
  const settled = () => setImmediate(layout);
  win.on("maximize", settled);
  win.on("unmaximize", settled);
  win.on("restore", settled);
  win.on("enter-full-screen", settled);
  win.on("leave-full-screen", settled);
  // The panel's bars leave room for the traffic lights only outside native fullscreen, which only the window knows.
  const fullScreen = () => panel.webContents.send("window:fullscreen", win.isFullScreen());
  win.on("enter-full-screen", fullScreen);
  win.on("leave-full-screen", fullScreen);
  panel.webContents.on("did-finish-load", fullScreen);
  layout();

  ipcMain.on("panel:browser-bounds", (e, b: Bounds | null) => {
    const next =
      b && Number.isFinite(b.x)
        ? { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
        : null;
    if (popout.isPanel(e.sender)) return popout.setSlot(next);
    if (e.sender !== panel.webContents) return;
    slot = next;
    layout();
  });

  const ownBrowserPanel = (sender: WebContents) => sender === panel.webContents || popout.isPanel(sender);
  ipcMain.on("panel:browser-tab", (e, tab: unknown) => {
    if (!ownBrowserPanel(e.sender) || typeof tab !== "string") return;
    try {
      host.select(tab);
    } catch {
      // unknown tab: the panel's list is stale; the next tabs event corrects it
    }
  });

  // The browser in its own window (with its toolbar), or a page in one of the owner's own browsers.
  ipcMain.on("browser:popout", (e, open: unknown) => {
    if (!ownBrowserPanel(e.sender)) return;
    if (open === false) return popout.close();
    const active = host.active ? host.list().find((t) => t.tab === host.active) : undefined;
    popout.open(active?.title || "Colonia", active?.tab);
  });
  ipcMain.on("browser:popout-state", (e) => {
    e.returnValue = ownBrowserPanel(e.sender) && popout.window() != null;
  });
  ipcMain.handle("browser:installed", (e) =>
    ownBrowserPanel(e.sender) ? installedBrowsers().map(({ id, name }) => ({ id, name })) : [],
  );
  ipcMain.handle("browser:open-external", (e, url: unknown, browser: unknown) =>
    ownBrowserPanel(e.sender) ? openExternal(url, browser ?? undefined) : false,
  );

  const artifactWindows = createArtifactWindows({
    url: () => base,
    preload: path.join(DIST, "panel-preload.cjs"),
    partition: "persist:colonia-ui",
    links: externalLinks,
    changed: (id, open) => panel.webContents.send("artifact:window", id, open),
  });
  ipcMain.on("artifact:close-window", (e, id: unknown) => {
    if (e.sender === panel.webContents && typeof id === "string") artifactWindows.close(id);
  });
  ipcMain.on("artifact:open-window", (e, id: unknown, title: unknown) => {
    if (e.sender !== panel.webContents || typeof id !== "string") return;
    artifactWindows.open(id, typeof title === "string" ? title : "Colonia");
  });

  const quick = createQuick({
    url: () => base,
    preload: path.join(DIST, "panel-preload.cjs"),
    partition: "persist:colonia-ui",
    assets: DIST,
    openMain,
  });

  // Computer use: off until the panel applies the owner's choice (Config › Desktop); macOS and Windows.
  let computerOn = false;
  const computer = createComputer({
    cursor: createCursor(),
    onActivity: (a) => panel.webContents.send("computer:activity", a),
    onStopped: (stopped) => {
      if (stopped) link?.emit("computer.stopped");
      panel.webContents.send("computer:stopped", stopped);
      if (stopped && Notification.isSupported())
        new Notification({
          title: "Colonia",
          body: language === "es" ? "Uso del ordenador detenido." : "Computer use stopped.",
        }).show();
    },
    // macOS refused it: System Settings opens where to allow it, and a notification says what to turn on.
    onPermission: (kind) => {
      openPrivacy(kind);
      if (!Notification.isSupported()) return;
      const es = language === "es";
      const what =
        kind === "screen"
          ? es
            ? "Grabación de pantalla"
            : "Screen Recording"
          : es
            ? "Accesibilidad"
            : "Accessibility";
      const n = new Notification({
        title: es ? `Colonia necesita el permiso de ${what}` : `Colonia needs the ${what} permission`,
        body: es
          ? "Activa Colonia en Configuración del Sistema. Si ya está activado, quítalo con − y añádelo de nuevo."
          : "Turn Colonia on in System Settings. If it is already on, remove it with − and add it again.",
      });
      n.on("click", () => openPrivacy(kind));
      n.show();
    },
  });
  // PERMISOS-TRAS-ACTUALIZAR-1: en Mac, una versión nueva sin firmar pierde Accesibilidad y Grabación de pantalla.
  // Al arrancar tras una actualización, si falta alguno, un aviso explica que hay que darlos de nuevo.
  if (process.platform === "darwin" && app.isPackaged) {
    const marca = path.join(app.getPath("userData"), "ultima-version.txt");
    let anterior = "";
    try {
      anterior = fs.readFileSync(marca, "utf8").trim();
    } catch {}
    const actual = app.getVersion();
    if (anterior !== actual) {
      try {
        fs.writeFileSync(marca, actual);
      } catch {}
      const p = computerPermissions();
      if (anterior && (p.screen !== "granted" || !p.accessibility)) {
        const es = (language ?? app.getLocale()).startsWith("es");
        setTimeout(async () => {
          const { response } = await dialog.showMessageBox({
            type: "info",
            title: "Colonia",
            message: es ? `Colonia se ha actualizado a la versión ${actual}` : `Colonia was updated to ${actual}`,
            detail: es
              ? "Tras cada actualización, macOS retira los permisos. Vuelve a activar Colonia en Accesibilidad y en Grabación de pantalla (si ya aparece activado, quítalo con − y añádelo de nuevo) y reinicia Colonia."
              : "After each update, macOS removes the permissions. Turn Colonia on again in Accessibility and Screen Recording (if it already shows as on, remove it with − and add it again), then restart Colonia.",
            buttons: es
              ? ["Abrir Accesibilidad", "Abrir Grabación de pantalla", "Más tarde"]
              : ["Open Accessibility", "Open Screen Recording", "Later"],
            defaultId: 0,
            cancelId: 2,
          });
          if (response === 0) openPrivacy("accessibility");
          if (response === 1) openPrivacy("screen");
        }, 3000);
      }
    }
  }
  // The AppImage launcher drops the sandbox by itself where the system forbids it: the owner is told, with the fix.
  const unsandboxed = app.isPackaged
    ? sandboxNotice({
        platform: process.platform,
        argv: process.argv,
        appImage: process.env.APPIMAGE,
        read: (file) => {
          try {
            return fs.readFileSync(file, "utf8");
          } catch {
            return undefined;
          }
        },
        exists: fs.existsSync,
      })
    : undefined;
  const silenced = path.join(app.getPath("userData"), "sandbox-notice-off");
  if (unsandboxed && !fs.existsSync(silenced)) {
    setTimeout(async () => {
      const es = (language ?? app.getLocale()).startsWith("es");
      const command = unsandboxed.command;
      const copy = es ? "Copiar la orden" : "Copy the command";
      const later = es ? "Ahora no" : "Not now";
      const { response, checkboxChecked } = await dialog.showMessageBox({
        type: "warning",
        title: "Colonia",
        ...sandboxText(unsandboxed, es),
        buttons: command ? [copy, later] : [later],
        defaultId: 0,
        cancelId: command ? 1 : 0,
        checkboxLabel: es ? "No volver a mostrar" : "Do not show this again",
      });
      if (command && response === 0) clipboard.writeText(command);
      if (checkboxChecked) {
        try {
          fs.writeFileSync(silenced, "");
        } catch {}
      }
    }, 3000);
  }
  // The emergency stop, from any app, while computer use is on.
  // Ctrl+Shift+Esc is Windows' own Task Manager: there it is Ctrl+Alt+Esc.
  const STOP_KEYS = process.platform === "win32" ? "Control+Alt+Escape" : "CommandOrControl+Shift+Escape";
  const armStop = () => {
    const armed = globalShortcut.isRegistered(STOP_KEYS);
    // Where the desktop lends no global shortcuts (Wayland) this registers nothing; the stop button stays.
    if (computerOn && !armed) globalShortcut.register(STOP_KEYS, () => computer.stop());
    if (!computerOn && armed) globalShortcut.unregister(STOP_KEYS);
  };
  let link: ReturnType<typeof startNodeLink> | undefined;
  const connector = createConnector({
    panel: panel.webContents,
    coreUrl: CORE_URL,
    webUrl: WEB_URL,
    dist: DIST,
    isOwnWindow: (sender) =>
      sender === panel.webContents || popout.isPanel(sender) || quick.isQuick(sender) || artifactWindows.owns(sender),
    disconnected: () => {
      updater.connect(undefined);
      link?.stop();
      link = undefined;
      if (computerOn) computer.stop();
      computerOn = false;
      armStop();
    },
    updating: (connection) => updater.connect(connection),
    opened: (url, node) => {
      base = url;
      quick.start();
      link?.stop();
      link = undefined;
      if (!node) return;
      link = startNodeLink(host, node.url, () => {}, node.token, {
        on: () => computerOn && COMPUTER_PLATFORMS.includes(process.platform),
        handle: computer.handle,
      });
    },
  });
  // Tests quit the app themselves (COLONIA_QUIT_CONFIRM=off); a shutdown or a logout never waits on a question.
  if (process.env.COLONIA_QUIT_CONFIRM !== "off")
    askBeforeQuit = () => confirmQuit(win, { es: app.getLocale().startsWith("es"), runsCore: connector.runsCore() });
  powerMonitor.on("shutdown", () => {
    quitting = true;
  });
  win.on("session-end", () => {
    quitting = true;
  });

  // A newer Colonia: the panel and the app menu show it; the app downloads it and it goes in at the next restart.
  const updater = nativeUpdates(
    createDesktopUpdater({
      logFile: path.join(app.getPath("logs"), "update.log"),
      quit: () => {
        quitting = true;
        app.quit();
      },
      changed: (s) => {
        setMenu(s);
        panel.webContents.send("desktop:update-changed", s);
      },
    }),
    win,
    { change: () => connector.change() },
  );
  panel.webContents.on("did-fail-load", (_event, code, _description, _url, mainFrame) => {
    if (mainFrame && code !== -3) updater.panelUnavailable();
  });
  const updateMenu = createUpdateMenu({
    updater,
    window: win,
    es: app.getLocale().startsWith("es"),
    platform: process.platform,
  });
  const setMenu = (s: DesktopUpdate) =>
    Menu.setApplicationMenu(
      appMenu(
        () => quick.toggle(false),
        () => void connector.change(),
        () => void showAbout("persist:colonia-ui", { coreUrl: base, language }),
        updateMenu.item(s),
      ),
    );
  setMenu(updater.status());

  // The panel takes opened files when it is ready and whenever it hears of more.
  ipcMain.handle("artifact:take-opened", (e) => (e.sender === panel.webContents ? opened.take() : []));
  tellPanel = () => {
    openMain();
    panel.webContents.send("artifact:file-opened");
  };
  ipcMain.on("quick:open-main", (e, threadId: unknown) => {
    if (!quick.isQuick(e.sender)) return;
    quick.hide();
    openMain();
    if (typeof threadId === "string") panel.webContents.send("nav:thread", threadId);
  });
  ipcMain.on("desktop:language", (e, lang: unknown) => {
    if (e.sender === panel.webContents && (lang === "en" || lang === "es")) language = lang;
  });
  ipcMain.on("desktop:prefs", (e, prefs: DesktopPrefs & { computerUse?: boolean }) => {
    if (e.sender !== panel.webContents || typeof prefs?.shortcut !== "string") return;
    computerOn = prefs.computerUse === true;
    armStop();
    link?.refresh();
    const error = quick.apply(
      { shortcut: prefs.shortcut, launchAtLogin: prefs.launchAtLogin === true },
      language === "es",
    );
    if (error && Notification.isSupported()) new Notification({ title: "Colonia", body: error }).show();
  });
  // Computer use: what macOS allows, where to allow it, and live frames of the window an agent works on (panel only).
  ipcMain.handle("computer:permissions", (e) => (e.sender === panel.webContents ? computerPermissions() : undefined));
  ipcMain.handle("computer:open-privacy", (e, kind: unknown) => {
    if (e.sender === panel.webContents && (kind === "screen" || kind === "accessibility")) openPrivacy(kind);
  });
  ipcMain.handle("computer:stop", (e) => {
    if (e.sender === panel.webContents) computer.stop();
  });
  ipcMain.handle("computer:frame", (e) =>
    e.sender === panel.webContents && computerOn ? computer.frame().catch(() => undefined) : undefined,
  );
  // The owner picks a folder (a project's) with the system's own dialog; only the panel may ask.
  ipcMain.handle("panel:pick-folder", async (e) => {
    if (e.sender !== panel.webContents) return undefined;
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
    return r.canceled ? undefined : r.filePaths[0];
  });
  // PROGRAMAS-1: the owner's desktop programs; picked with the system dialog, launched by id. Only the panel asks.
  const programs = createPrograms({
    file: path.join(app.getPath("userData"), "programs.json"),
    platform: process.platform,
    pick: async (filters) => {
      const r = await dialog.showOpenDialog(win, {
        properties: ["openFile", "multiSelections"],
        filters,
        defaultPath:
          process.platform === "darwin" ? "/Applications" : process.platform === "win32" ? process.env.ProgramFiles : undefined,
      });
      return r.canceled ? [] : r.filePaths;
    },
    openPath: (p) => shell.openPath(p),
    icon: async (p) => (await app.getFileIcon(p, { size: "normal" })).toDataURL(),
  });
  ipcMain.handle("programs:list", (e) => (e.sender === panel.webContents ? programs.list() : []));
  ipcMain.handle("programs:add", (e) => (e.sender === panel.webContents ? programs.add() : []));
  ipcMain.handle("programs:rename", (e, id: unknown, name: unknown) =>
    e.sender === panel.webContents ? programs.rename(String(id), String(name)) : [],
  );
  ipcMain.handle("programs:remove", (e, id: unknown) =>
    e.sender === panel.webContents ? programs.remove(String(id)) : [],
  );
  ipcMain.handle("programs:launch", (e, id: unknown) =>
    e.sender === panel.webContents ? programs.launch(String(id)) : "denied",
  );
  ipcMain.on("desktop:attention", (e, unread: unknown) => {
    if (e.sender !== panel.webContents || typeof unread !== "number") return;
    quick.badge(unread);
  });
  // The window background follows the panel theme on every OS; the window-control overlay only on Windows/Linux (mac
  // draws its own traffic lights, there is no overlay to recolor).
  ipcMain.on("desktop:titlebar", (e, mode: unknown) => {
    if (e.sender !== panel.webContents) return;
    if (mode !== "light" && mode !== "dark") return;
    win.setBackgroundColor(mode === "light" ? "#f4f3f0" : "#1a1a19");
    if (process.platform === "darwin") return;
    win.setTitleBarOverlay(
      mode === "light"
        ? { color: "#f4f3f0", symbolColor: "#444444", height: 46 }
        : { color: "#1a1a19", symbolColor: "#c8c8c8", height: 46 },
    );
  });
  app.on("will-quit", () => quick.stop());

  ipcMain.handle("desktop:update-status", (e, check: unknown) => {
    if (e.sender !== panel.webContents) return undefined;
    return check === true ? updater.check() : updater.status();
  });
  ipcMain.on("desktop:update-auth", (e, token: unknown) => {
    if (e.sender !== panel.webContents || (token !== undefined && (typeof token !== "string" || token.length > 8192)))
      return;
    try {
      updater.authenticate(token, new URL(e.sender.getURL()).origin);
    } catch {}
  });
  ipcMain.handle("desktop:update-install", (e) => (e.sender === panel.webContents ? updater.install() : undefined));
  // Windows and Linux show no menu bar (frameless): the panel's account menu runs these app menu items instead.
  ipcMain.on("desktop:menu-action", (e, id: unknown) => {
    if (e.sender !== panel.webContents || typeof id !== "string" || !MENU_ACTIONS.has(id)) return;
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (item?.enabled) item.click();
  });
  ipcMain.handle("desktop:update-restart", (e) => (e.sender === panel.webContents ? updater.restart() : undefined));
  updater.start(updateMenu.found);
  app.on("will-quit", () => {
    updater.log("will-quit");
    updater.stop();
    updater.quitting();
    connector.stop();
  });

  void connector.open();

  // Dev-only: `kill -USR2 <pid>` writes the panel, the visible tab and the slot so a script can compose them.
  const captureDir = process.env.COLONIA_CAPTURE_DIR;
  if (captureDir) {
    process.on("SIGUSR2", async () => {
      const fs = await import("node:fs");
      fs.mkdirSync(captureDir, { recursive: true });
      fs.writeFileSync(path.join(captureDir, "panel.png"), (await panel.webContents.capturePage()).toPNG());
      if (shown && onScreen())
        fs.writeFileSync(path.join(captureDir, "tab.png"), (await shown.webContents.capturePage()).toPNG());
      fs.writeFileSync(path.join(captureDir, "slot.json"), JSON.stringify({ slot, at: Date.now() }));
    });
  }

  // Every minute: tabs nobody uses close, and Colonia says when it takes too much memory (and what takes it).
  const report = () => {
    const owners = host.processOwners();
    owners.set(panel.webContents.getOSProcessId(), { kind: "panel" });
    const quickPid = quick.processId();
    if (quickPid) owners.set(quickPid, { kind: "quick" });
    const popoutPid = popout.processId();
    if (popoutPid) owners.set(popoutPid, { kind: "panel" });
    // Open apps and live widgets: in the panel and in their own windows.
    for (const page of [{ title: "", contents: panel.webContents }, ...artifactWindows.pages()]) {
      const pid = page.contents.getOSProcessId();
      if (page.title) owners.set(pid, { kind: "app", site: page.title });
      for (const [p, o] of artifactOwners(page.contents.mainFrame.framesInSubtree, pid)) owners.set(p, o);
    }
    return memoryReport(app.getAppMetrics(), owners);
  };
  const memText = memoryText(app.getLocale());
  const memoryLog = path.join(app.getPath("logs"), "memory.log");
  const watch = memoryWatch({
    read: report,
    limitMb: MEMORY_LIMIT_MB,
    quietMs: 3_600_000,
    text: memText,
    warn: (message, r) => {
      const lines = r.items.map((i) => `  ${size(i.mb).padStart(8)}  ${itemName(i, memText)}`).join("\n");
      void fs.promises
        .mkdir(path.dirname(memoryLog), { recursive: true })
        .then(() => fs.promises.appendFile(memoryLog, `${new Date().toISOString()} ${message}\n${lines}\n`))
        .catch(() => {});
      if (Notification.isSupported()) new Notification({ title: "Colonia", body: message }).show();
    },
  });
  const tick = setInterval(() => {
    void host.closeIdle((view) => view === shown && onScreen());
    watch.check();
  }, 60_000);
  tick.unref();
  ipcMain.handle("desktop:memory", (e) => (e.sender === panel.webContents ? report() : undefined));
});

app.on("window-all-closed", () => app.quit());

/** Colonia's own pages never open child windows (they would carry the panel's preload): web links go to the system. */
function externalLinks(wc: WebContents): void {
  wc.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
}

/** The app menu items the panel may run (by id), for platforms whose window shows no menu bar. */
const MENU_ACTIONS = new Set(["about", "update", "change-connection"]);

/** The system's own menus, plus "Quick chat" in Window: reachable from the keyboard and by name. */
function appMenu(
  openQuick: () => void,
  changeConnection: () => void,
  openAbout: () => void,
  update: MenuItemConstructorOptions | undefined,
): Menu {
  const es = app.getLocale().startsWith("es");
  const about = {
    id: "about",
    label: es ? "Acerca de Colonia" : "About Colonia",
    click: openAbout,
  };
  const change = {
    id: "change-connection",
    label: es ? "Cambiar conexión…" : "Change connection…",
    click: changeConnection,
  };
  return Menu.buildFromTemplate([
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              about,
              ...(update ? [update] : []),
              { type: "separator" as const },
              change,
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : [
          {
            label: "Colonia",
            submenu: [
              about,
              ...(update ? [update] : []),
              change,
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]),
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      label: es ? "Ventana" : "Window",
      role: "windowMenu",
      submenu: [
        { id: "quick", label: es ? "Chat rápido" : "Quick chat", click: openQuick },
        { type: "separator" },
        { role: "minimize" },
        { role: "zoom" },
        { role: "close" },
      ],
    },
  ]);
}

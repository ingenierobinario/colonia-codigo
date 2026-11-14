// Bridge the desktop app (Electron preload) exposes to the panel. Absent in a plain browser.
type ConnectAnswer =
  | { ok: true; ready?: true; linger?: string }
  | { ok: false; reason?: string; error?: string; key?: string };

/** A question ssh asks while logging in: masked (`secret`) for a password or passphrase, plain for yes/no. */
export type SshPrompt = { id: string; text: string; secret: boolean };

/** PROGRAMAS-1: a desktop program pinned in the sidebar (icon: a data: URL from the system). */
export type ImportSource = {
  id: string;
  navegador: "chrome" | "edge" | "brave" | "firefox";
  perfil: string;
  /** PERFIL-NOMBRE-1: nombre visible del perfil y su cuenta, si el navegador los guarda. */
  nombre?: string;
  email?: string;
};
export type ImportRead = {
  marcadores: { titulo: string; url: string }[];
  visitadas: { host: string; visitas: number }[];
  visitadasNoDisponibles: boolean;
};
/** INSTALAR-NAV-1: how installing a browser is going. `page` is its maker's download page. */
export type BrowserInstallProgress = {
  id: string;
  name: string;
  page: string;
  phase: "installing" | "downloading" | "waiting" | "done" | "failed";
  /** 0–100 while downloading, when the size is known. */
  percent?: number;
  /** What the owner has in front while waiting. */
  step?: "installer" | "dmg" | "package" | "page";
};
/** NAVEGADORES-2: a bookmark of a profile's bookmarks bar, or a folder of them. */
export type BookmarkNode = { titulo: string; url: string } | { titulo: string; hijos: BookmarkNode[] };
export type SavedLogin = { id: string; app: string; origen: string; usuario: string };
export type LoginOffer = { id: string; app: string; sitio: string; usuario: string; cambia: boolean };
export type DesktopProgram = { id: string; name: string; path: string; icon?: string };

/** The desktop app's own update (it carries its own core). */
export type DesktopUpdate = {
  current: string;
  latest?: string;
  notes: string[];
  /** The same lines once per language, when the releases say them so. */
  localized?: { en?: string[]; es?: string[] };
  /** auto: it downloads and goes in at the next restart; drag: macOS opens the disk image for the owner. */
  install: "auto" | "drag" | "none";
  /** Downloading the newer app now. */
  downloading?: boolean;
  /** The newer app, downloaded and checked: it goes in when Colonia restarts. */
  ready?: string;
  checked_at?: string;
  error?: string;
};

declare global {
  interface Window {
    /** Only on the desktop app's first-run page: this computer's Colonia (server) or one elsewhere (client). */
    coloniaConnect?: {
      local(access: "none" | "lan" | "tailscale"): Promise<ConnectAnswer>;
      url(url: string): Promise<ConnectAnswer>;
      ssh(target: string): Promise<ConnectAnswer>;
      /** Installs Colonia on that server over SSH (this app's version), then connects to it. */
      installSsh(target: string): Promise<ConnectAnswer>;
      /** Turns on linger for the SSH user with sudo; the password goes to sudo over ssh and is not kept. */
      lingerSsh(target: string, password: string): Promise<ConnectAnswer>;
      onProgress(listener: (line: string) => void): () => void;
      /** Missing in builds from before the steps were reported. */
      onStep?(listener: (step: string) => void): () => void;
      /** ssh asks something while logging in with a password; null = nothing waits any more. */
      onPrompt?(listener: (prompt: SshPrompt | null) => void): () => void;
      /** The owner's answer to that question, never kept; undefined cancels it. */
      answer?(id: string, answer: string | undefined): void;
    };
    coloniaDesktop?: {
      /** Host OS of the desktop shell (`darwin` | `win32` | `linux`). */
      platform?: string;
      /** The window is in native fullscreen (no traffic lights). Missing in builds from before it was reported. */
      isFullScreen?(): boolean;
      onFullScreen?(listener: (full: boolean) => void): () => void;
      /** The core's token, when the app knows it: the panel sends it on every call. */
      coreToken?: string;
      updateAuth?(token?: string): void;
      /** Whether the core runs on this computer; false for one at an address or over SSH. */
      coreLocal?: boolean;
      /** Where to place the real browser view, in viewport CSS pixels (integers); null hides it. */
      setBrowserBounds(bounds: { x: number; y: number; width: number; height: number } | null): void;
      /** Which tab the native browser view shows. */
      showBrowserTab?(tab: string): void;
      /** Moves the browser to a window of its own (true) or back into the side panel (false). */
      popOutBrowser?(open: boolean): void;
      /** Whether the browser is in its own window right now. */
      browserPoppedOut?(): boolean;
      /** The main window hears when the browser window opens or closes. */
      onBrowserPopout?(listener: (open: boolean) => void): () => void;
      /** CHROME-1: searches the shown page; `next` moves to the following (or, with forward false, previous) match. */
      findInPage?(tab: string, text: string, forward?: boolean, next?: boolean): void;
      /** Ends the search and gives the keys back to the page. */
      stopFind?(tab: string): void;
      /** The owner pressed Ctrl/Cmd+F on a page. */
      onFindOpen?(listener: (tab: string) => void): () => void;
      /** Which match is selected and how many there are. */
      onFound?(listener: (tab: string, active: number, total: number) => void): () => void;
      /** What a browser does to a tab: zoom, print, stop, reload. */
      tabAction?(
        tab: string,
        action: "find" | "zoom-in" | "zoom-out" | "zoom-reset" | "print" | "reload" | "stop" | "back" | "forward",
      ): void;
      /** A download of the owner's started, finished or failed. */
      onDownload?(
        listener: (notice: {
          id: string;
          name: string;
          state: "started" | "completed" | "failed";
          opens?: boolean;
        }) => void,
      ): () => void;
      /** Opens a finished download (a program is shown in its folder instead). */
      openDownload?(id: string): void;
      showDownload?(id: string): void;
      /** The browsers installed on this computer (Chrome, Safari, Firefox…). */
      installedBrowsers?(): Promise<Array<{ id: string; name: string }>>;
      /** INSTALAR-NAV-1: the browsers this computer lacks and can install, from their makers. */
      installableBrowsers?(): Promise<Array<{ id: string; name: string }>>;
      /** Installs one by id; resolves how it ended (undefined: another one is being installed). */
      installBrowser?(id: string): Promise<BrowserInstallProgress | undefined>;
      cancelBrowserInstall?(): void;
      onBrowserInstall?(listener: (progress: BrowserInstallProgress) => void): () => void;
      /** Opens a web page in the system's default browser, or in an installed one by id. */
      openExternal?(url: string, browser?: string): Promise<boolean>;
      /** Opens an artifact in a desktop window of its own (one per artifact). */
      openArtifactWindow?(id: string, title: string): void;
      /** Closes an artifact's own window; the panel shows the app again. */
      closeArtifactWindow?(id: string): void;
      /** An artifact's window opened or closed (by any means). */
      onArtifactWindow?(listener: (id: string, open: boolean) => void): () => void;
      /** From the quick window: bring the main window up, on this chat. */
      openMain?(threadId?: string): void;
      /** The main window is told to open a chat (asked from the quick window). */
      /** Files opened with Colonia from the system, each with its text or why it has none (taken once). */
      takeOpenedFiles?(): Promise<{ name: string; text?: string; error?: "too-big" | "unreadable" }[]>;
      onFileOpened?(listener: () => void): () => void;
      onOpenThread?(listener: (threadId: string) => void): () => void;
      /** Runs one of the app menu's items: Windows and Linux show no menu bar for them. */
      menuAction?(id: "about" | "update" | "change-connection"): void;
      /** Applies the desktop settings (shortcut, start at login, computer use) in the shell. */
      applyDesktopPrefs?(prefs: { shortcut: string; launchAtLogin: boolean; computerUse?: boolean }): void;
      /** What macOS lets Colonia do for computer use: see the screen ("granted"…) and drive other apps. */
      computerPermissions?(): Promise<{ screen: string; accessibility: boolean } | undefined>;
      /** Opens the System Settings pane where the owner allows it. */
      openPrivacy?(kind: "screen" | "accessibility"): Promise<void>;
      /** A live frame of the window an agent works on (a data URL), or nothing yet. */
      computerFrame?(): Promise<unknown>;
      /** The emergency stop (also its keys from any app): ends the turns using the computer, this time only. */
      stopComputer?(): Promise<void>;
      onComputerStopped?(listener: (stopped: boolean) => void): () => void;
      /** An agent looked at the screen, clicked or typed; returns how to stop listening. */
      onComputerActivity?(listener: (a: unknown) => void): () => void;
      /** How many notices wait for the owner: shown on the menu-bar icon and the Dock. */
      setAttention?(unread: number): void;
      /** The panel's language, for the shell's own windows (About), which cannot read the panel's settings. */
      setLanguage?(language: string): void;
      /** Windows/Linux: match the native title-bar overlay to the panel theme. */
      setTitleBar?(mode: "light" | "dark"): void;
      /** The system's folder dialog; undefined when the owner cancels. */
      pickFolder?(): Promise<string | undefined>;
      /** PROGRAMAS-1: the owner's desktop programs on this computer (icon: a data: URL). */
      programs?(): Promise<DesktopProgram[]>;
      /** Opens the system's file dialog; the list after adding what the owner picked. */
      addProgram?(): Promise<DesktopProgram[]>;
      renameProgram?(id: string, name: string): Promise<DesktopProgram[]>;
      removeProgram?(id: string): Promise<DesktopProgram[]>;
      /** "" when it started; "missing" when the file is gone; else why not. */
      launchProgram?(id: string): Promise<string>;
      /** Perfiles de Chrome, Edge, Brave y Firefox encontrados en este equipo (sin rutas). Nada se lee hasta importar. */
      importSources?(): Promise<ImportSource[]>;
      /** Marcadores y webs más visitadas de un perfil; undefined si ya no existe. */
      importRead?(id: string): Promise<ImportRead | undefined>;
      /** NAVEGADORES-2: the bookmarks bar of a profile of the real browser (read only); [] when it has none. */
      bookmarkBar?(id: string): Promise<BookmarkNode[]>;
      /** Si el sistema puede cifrar contraseñas; si no, Colonia no guarda ninguna. */
      loginsAvailable?(): Promise<boolean>;
      loginsList?(): Promise<SavedLogin[]>;
      /** Pide confirmación al sistema (Windows Hello, Touch ID o un aviso) y devuelve la contraseña. */
      loginsReveal?(id: string): Promise<{ ok: boolean; contrasena?: string }>;
      loginsRemove?(id: string): Promise<boolean>;
      /** Borra las contraseñas de una aplicación que se quita de la barra lateral. */
      loginsRemoveApp?(app: string): Promise<boolean>;
      answerLoginOffer?(id: string, answer: "guardar" | "nunca" | "ahora-no"): Promise<string>;
      /** Una web app ha visto un acceso nuevo: se ofrece guardarlo (el panel nunca recibe la contraseña). */
      onLoginOffer?(listener: (offer: LoginOffer) => void): () => void;
      /** Whether a newer Colonia app is out; `check` asks the release feed now. */
      updateStatus?(check?: boolean): Promise<DesktopUpdate | undefined>;
      /** Downloads the newer app and leaves it ready (`ready: false`: opened for the owner to drag in). */
      installUpdate?(): Promise<{ ok: true; ready: boolean } | { ok: false; error: string } | undefined>;
      /** Quits and opens the newer app that is ready; an answer means it could not (an older app answers nothing). */
      restartToUpdate?(): Promise<{ ok: true } | { ok: false; error: string } | undefined> | undefined;
      /** The app's update changed, wherever it was started (the panel or the app menu). */
      onUpdateStatus?(listener: (status: DesktopUpdate) => void): () => void;
      /** What each of the app's processes takes in memory (the panel, each browser tab, the GPU…), biggest first. */
      memory?(): Promise<
        | {
            total_mb: number;
            items: Array<{
              pid: number;
              kind: "main" | "gpu" | "panel" | "quick" | "tab" | "page" | "app" | "helper";
              site?: string;
              mb: number;
            }>;
          }
        | undefined
      >;
    };
  }
}

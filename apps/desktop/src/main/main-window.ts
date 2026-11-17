// VENTANA-DESTRUIDA-1: la ventana principal se destruye al salir (y en Windows la salida espera hasta 7 s a que el
// núcleo cierre). En ese hueco la bandeja, otra instancia («second-instance»), el Dock («activate»), un aviso o un
// fichero abierto seguían llamando a openMain sobre la ventana muerta: «TypeError: Object has been destroyed», con el
// diálogo de error del proceso principal bloqueando la salida (y con ella la actualización que se instala al salir).
// Aquí: abrir la ventana solo si vive, y los eventos de la app que la reabren se desregistran cuando se cierra.

type Destroyable = { isDestroyed(): boolean };

/** La ventana, si aún vive; si no, nada (para no tocarla ni usarla de padre de un diálogo). */
export function liveWindow<T extends Destroyable>(w: T | undefined | null): T | undefined {
  return w && !w.isDestroyed() ? w : undefined;
}

type MainWindow = Destroyable & {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  moveTop(): void;
  focus(): void;
  once(event: "restore", fn: () => void): unknown;
  removeListener(event: "restore", fn: () => void): unknown;
};

/** Traer la ventana principal al frente; no hace nada si ya se destruyó (la app está saliendo). */
export function mainOpener(win: MainWindow, before: () => void = () => {}) {
  const foreground = () => {
    if (win.isDestroyed()) return;
    before();
    win.show();
    win.moveTop();
    win.focus();
  };
  const open = () => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) {
      // Restaurar es asíncrono: el foco, cuando la ventana nativa termina la transición.
      win.removeListener("restore", foreground);
      win.once("restore", foreground);
      win.restore();
    } else foreground();
  };
  return { foreground, open };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AppEvents = {
  on(event: string, fn: (...args: any[]) => void): unknown;
  removeListener(event: string, fn: (...args: any[]) => void): unknown;
};

/**
 * Registra en la app los eventos que vuelven a mostrar la ventana y los quita en cuanto la ventana se cierra: después
 * no queda ventana que mostrar, y la app ya está saliendo.
 */
export function whileWindowLives(
  app: AppEvents,
  win: { once(event: "closed", fn: () => void): unknown },
  handlers: Record<string, (...args: any[]) => void>,
): void {
  for (const [event, fn] of Object.entries(handlers)) app.on(event, fn);
  win.once("closed", () => {
    for (const [event, fn] of Object.entries(handlers)) app.removeListener(event, fn);
  });
}

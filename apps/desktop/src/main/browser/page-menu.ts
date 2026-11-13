// CHROME-1: what a right click on a web page adds to the edit menu, as in any browser: the link and the image under
// the pointer, moving through the history, printing and inspecting.
import type { ContextMenuParams, MenuItemConstructorOptions } from "electron";

const TEXT = {
  en: {
    openLink: "Open link in new tab",
    openImage: "Open image in new tab",
    saveImage: "Save image",
    copyImage: "Copy image",
    copyImageLink: "Copy image address",
    back: "Back",
    forward: "Forward",
    reload: "Reload",
    print: "Print…",
    inspect: "Inspect",
  },
  es: {
    openLink: "Abrir enlace en una pestaña nueva",
    openImage: "Abrir imagen en una pestaña nueva",
    saveImage: "Guardar imagen",
    copyImage: "Copiar imagen",
    copyImageLink: "Copiar dirección de la imagen",
    back: "Atrás",
    forward: "Adelante",
    reload: "Recargar",
    print: "Imprimir…",
    inspect: "Inspeccionar",
  },
};

export type PageActions = {
  openTab: (url: string) => void;
  saveUrl: (url: string) => void;
  copyImage: () => void;
  copyText: (text: string) => void;
  back: () => void;
  forward: () => void;
  reload: () => void;
  print: () => void;
  inspect: () => void;
};

type Params = Pick<ContextMenuParams, "linkURL" | "mediaType" | "srcURL" | "isEditable" | "selectionText">;

const web = (url: string) => /^https?:\/\//i.test(url);

/** The items for a link and an image (they go before the edit menu's) and for the page itself (they go after). */
export function pageMenu(
  params: Params,
  locale: string,
  state: { canGoBack: boolean; canGoForward: boolean },
  actions: PageActions,
): { target: MenuItemConstructorOptions[]; page: MenuItemConstructorOptions[] } {
  const text = locale.startsWith("es") ? TEXT.es : TEXT.en;
  const target: MenuItemConstructorOptions[] = [];
  const link = params.linkURL;
  if (web(link)) target.push({ label: text.openLink, click: () => actions.openTab(link) });
  const src = params.srcURL;
  if (params.mediaType === "image" && src) {
    if (target.length) target.push({ type: "separator" });
    if (web(src)) target.push({ label: text.openImage, click: () => actions.openTab(src) });
    target.push(
      { label: text.saveImage, click: () => actions.saveUrl(src) },
      { label: text.copyImage, click: () => actions.copyImage() },
    );
    if (web(src)) target.push({ label: text.copyImageLink, click: () => actions.copyText(src) });
  }
  const page: MenuItemConstructorOptions[] = [];
  // Over a text field or a selection the menu is about the text; the page's own items would only be noise.
  if (!params.isEditable && !params.selectionText.trim() && !target.length)
    page.push(
      { label: text.back, enabled: state.canGoBack, click: () => actions.back() },
      { label: text.forward, enabled: state.canGoForward, click: () => actions.forward() },
      { label: text.reload, click: () => actions.reload() },
      { type: "separator" },
      { label: text.print, click: () => actions.print() },
      { type: "separator" },
    );
  page.push({ label: text.inspect, click: () => actions.inspect() });
  return { target, page };
}

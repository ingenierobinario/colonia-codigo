import "@colonia/ui/styles.css";
import "./app.css";
import "./styles/inbox.css";
import "./styles/chat.css";
import "./styles/side-panel.css";
import "./styles/documents.css";
import "./styles/chat-tools.css";
import "./styles/composer.css";
import "./styles/inbox-views.css";
import "./styles/nav.css";
import "./styles/topbar.css";
import "./styles/shared.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { setPresetPairCode } from "./data/pairing.ts";
import { prefs } from "./data/prefs.ts";
import { takePairCode } from "./data/token.ts";
import { isLanguage, startI18n } from "./i18n/index.ts";

// A newer panel replaced this page's lazy parts (an update, a rebuild): load it again instead of a blank screen. Not
// twice in a few seconds: a panel that keeps failing shows its error.
window.addEventListener("vite:preloadError", (e) => {
  const key = "colonia.preloadReload";
  try {
    if (Date.now() - Number(sessionStorage.getItem(key) ?? 0) < 10_000) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    return;
  }
  e.preventDefault();
  window.location.reload();
});

// PRECARGA-PAIR-1 · Un enlace con `?COLONIA_PAIR_CODE=` rellena la pantalla de emparejar; el código sale de la
// dirección antes de pintar nada, para que no quede en el historial ni en el Referer de ninguna petición.
const pair = takePairCode(window.location.href);
if (pair.clean !== undefined) window.history.replaceState(window.history.state, "", pair.clean);
setPresetPairCode(pair.code);

// The desktop's About window is on another origin than the panel: the shell passes the panel's language along.
const lang = new URLSearchParams(window.location.search).get("lang");
if (isLanguage(lang)) prefs.set({ language: lang });

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
// The language's texts arrive first (one small chunk): the panel never flashes keys or another language.
void startI18n().then(async () => {
  const Preview =
    import.meta.env.DEV && import.meta.env.VITE_COLONIA_INBOX_PREVIEW === "1"
      ? (await import("./inbox/InboxPreview.tsx")).default
      : undefined;
  createRoot(root).render(<StrictMode>{Preview ? <Preview /> : <App />}</StrictMode>);
});

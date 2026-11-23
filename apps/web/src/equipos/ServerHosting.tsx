import { Button, Icons } from "@colonia/ui";
import { useEffect, useRef, useState } from "react";
import { browserOpen } from "../data/actions.ts";
import { openLink } from "../data/links.ts";
import { useLanguage, useT } from "../i18n/index.ts";
import { go, nav, useNav } from "../shell/nav.ts";
import { HostingPair } from "./HostingPair.tsx";
import {
  forgetPairCode,
  hostingLinks,
  newPairCode,
  pendingPairCode,
  rememberPairCode,
  withPairCode,
} from "./serverHosting.ts";

export function ServerHosting() {
  const t = useT();
  const section = useRef<HTMLElement>(null);
  const focus = useNav((s) => s.focus);
  const [pending, setPending] = useState(() => pendingPairCode());
  useEffect(() => {
    if (focus !== "servidor-continuo" || !section.current) return;
    section.current.focus({ preventScroll: true });
    section.current.scrollIntoView({ block: "start" });
    nav.set({ focus: undefined });
  }, [focus]);
  const { deploy, signup, guide, referred, files } = hostingLinks(
    useLanguage(),
    import.meta.env.VITE_COLONIA_RAILWAY_TEMPLATE,
    import.meta.env.VITE_COLONIA_RAILWAY_REFERRAL,
    import.meta.env.VITE_COLONIA_VERSION,
  );
  const open = (url: string) => {
    if (window.coloniaDesktop?.openExternal) void window.coloniaDesktop.openExternal(url);
    else openLink(url);
  };
  // SERVIDOR-NAVEGADOR-1 · En el escritorio, Railway se abre en el navegador de Colonia: su inicio de sesión con
  // GitHub o Google abre una ventana emergente que el navegador integrado convierte en pestaña con su `opener`
  // (host.ts, CHROME-1: las pestañas del dueño permiten ventanas emergentes; solo las de un agente las cargan en sitio).
  // Si no hay escritorio o no se pudo abrir la pestaña, se abre fuera como antes.
  const openRailway = async (url: string) => {
    if (!window.coloniaDesktop) return openLink(url);
    const tab = await browserOpen(url);
    if (!tab) return open(url);
    nav.set({ browserTab: tab });
    // Mis equipos no tiene panel lateral: la pestaña se ve en la ventana propia del navegador de Colonia.
    if (window.coloniaDesktop.popOutBrowser) window.coloniaDesktop.popOutBrowser(true, tab);
    else go.panel("browser");
  };
  return (
    <section ref={section} tabIndex={-1} className="eq-card eq-card--static" aria-label={t("equipos.hosting")}>
      <h2 className="eq-transfer__title">{t("equipos.hosting")}</h2>
      <p className="eq-muted">{t("equipos.hostingHint")}</p>
      <div className="eq-row">
        <Button
          variant="primary"
          leadingIcon={<Icons.ExternalLink />}
          onClick={() => {
            if (!deploy) return void openRailway(signup);
            // AUTOVINCULAR-1 · El servidor nace con este código y el escritorio lo espera.
            const code = pending ?? newPairCode();
            rememberPairCode(code);
            setPending(code);
            void openRailway(withPairCode(deploy, code));
          }}
        >
          {t(deploy ? "equipos.hostingRailway" : "equipos.hostingSignup")}
        </Button>
        <Button variant="secondary" leadingIcon={<Icons.BookOpen />} onClick={() => open(guide)}>
          {t("equipos.hostingGuide")}
        </Button>
      </div>
      {!deploy && (
        <p className="eq-hosting-manual">
          {t("equipos.hostingManual")}
          <a
            href={files.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              if (window.coloniaDesktop?.openExternal) {
                event.preventDefault();
                open(files.url);
              }
            }}
          >
            {t(files.download ? "equipos.hostingDownload" : "equipos.hostingReleases")}
          </a>
        </p>
      )}
      {deploy && !referred && <p className="eq-muted">{t("equipos.hostingPlan")}</p>}
      <HostingPair
        {...(deploy && pending ? { pending } : {})}
        onSettled={() => {
          forgetPairCode();
          setPending(undefined);
        }}
      />
    </section>
  );
}

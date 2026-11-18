import { Button, Icons } from "@colonia/ui";
import { useEffect, useRef } from "react";
import { openLink } from "../data/links.ts";
import { useLanguage, useT } from "../i18n/index.ts";
import { nav, useNav } from "../shell/nav.ts";
import { HostingPair } from "./HostingPair.tsx";
import { hostingLinks } from "./serverHosting.ts";

export function ServerHosting() {
  const t = useT();
  const section = useRef<HTMLElement>(null);
  const focus = useNav((s) => s.focus);
  useEffect(() => {
    if (focus !== "servidor-continuo" || !section.current) return;
    section.current.focus({ preventScroll: true });
    section.current.scrollIntoView({ block: "start" });
    nav.set({ focus: undefined });
  }, [focus]);
  const { deploy, signup, guide, referred } = hostingLinks(
    useLanguage(),
    import.meta.env.VITE_COLONIA_RAILWAY_TEMPLATE,
    import.meta.env.VITE_COLONIA_RAILWAY_REFERRAL,
  );
  const open = (url: string) => {
    if (window.coloniaDesktop?.openExternal) void window.coloniaDesktop.openExternal(url);
    else openLink(url);
  };
  return (
    <section ref={section} tabIndex={-1} className="eq-card eq-card--static" aria-label={t("equipos.hosting")}>
      <h2 className="eq-transfer__title">{t("equipos.hosting")}</h2>
      <p className="eq-muted">{t("equipos.hostingHint")}</p>
      <div className="eq-row">
        <Button variant="primary" leadingIcon={<Icons.ExternalLink />} onClick={() => open(deploy ?? signup)}>
          {t(deploy ? "equipos.hostingRailway" : "equipos.hostingSignup")}
        </Button>
        <Button variant="secondary" leadingIcon={<Icons.BookOpen />} onClick={() => open(guide)}>
          {t("equipos.hostingGuide")}
        </Button>
      </div>
      {!deploy && <p className="eq-muted">{t("equipos.hostingManual")}</p>}
      {referred && <p className="eq-muted">{t("equipos.hostingReferral")}</p>}
      {deploy && !referred && <p className="eq-muted">{t("equipos.hostingPlan")}</p>}
      <HostingPair />
    </section>
  );
}

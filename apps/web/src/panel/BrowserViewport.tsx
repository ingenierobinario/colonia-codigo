import { Button, EmptyState, Icons, Skeleton, useColonia } from "@colonia/ui";
import { type RefObject, useEffect, useRef, useState } from "react";
import { hostPath } from "../common/format.ts";
import { usePageVisible } from "../common/useInView.ts";
import { useScreenshot } from "../common/useScreenshot.ts";
import { browserHistory } from "../data/actions.ts";
import { useSlice } from "../data/createStore.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { popOutBrowser, useBrowserPoppedOut } from "./browserWindow.ts";
import { nativeCover } from "./nativeCover.ts";

const POLL_MS = 1500;

/** The page area: the desktop app's real browser view when embedded, else a polled screenshot. */
export function BrowserViewport({ tab }: { tab: string }) {
  const desktop = typeof window !== "undefined" ? window.coloniaDesktop : undefined;
  const poppedOut = useBrowserPoppedOut();
  const info = useData((s) => s.tabs.find((x) => x.tab === tab));
  // CHROME-1: a page that did not load says so, instead of a blank page under its address.
  if (info?.error && !info.loading) return <LoadFailed tab={tab} url={info.url} error={info.error} />;
  if (desktop && poppedOut) return <PoppedOut />;
  return desktop ? <DesktopSlot desktop={desktop} /> : <ScreenshotView tab={tab} />;
}

function LoadFailed({ tab, url, error }: { tab: string; url: string; error: string }) {
  const t = useT();
  return (
    <div className="browser__page">
      <EmptyState
        icon={<Icons.TriangleAlert />}
        title={t("browser.failed")}
        action={
          <Button size="sm" variant="secondary" onClick={() => void browserHistory(tab, "reload")}>
            {t("browser.retry")}
          </Button>
        }
      >
        {t("browser.failedBody", { host: hostPath(url).split("/")[0] ?? url })}
        <span className="browser__errcode">{error}</span>
      </EmptyState>
    </div>
  );
}

/** The page is in the browser window: say so, and offer to bring it back here. */
function PoppedOut() {
  const t = useT();
  return (
    <div className="browser__page">
      <EmptyState
        icon={<Icons.AppWindow />}
        title={t("browser.inWindow")}
        action={
          <Button size="sm" variant="secondary" onClick={() => popOutBrowser(false)}>
            {t("browser.backToPanel")}
          </Button>
        }
      >
        {t("browser.inWindowBody")}
      </EmptyState>
    </div>
  );
}

function DesktopSlot({ desktop }: { desktop: NonNullable<Window["coloniaDesktop"]> }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useSlice(nativeCover, (s) => s.on);
  const overlaid = usePopupOver(ref);
  const covered = dragging || overlaid;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const visible = !covered && r.width > 0 && r.height > 0 && document.visibilityState === "visible";
        desktop.setBrowserBounds(
          visible
            ? { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
            : null,
        );
      });
    };
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener("resize", report);
    document.addEventListener("visibilitychange", report);
    report();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", report);
      document.removeEventListener("visibilitychange", report);
      desktop.setBrowserBounds(null);
    };
  }, [desktop, covered]);
  return <div ref={ref} className="browser__page browser__page--native" />;
}

/**
 * Whether a menu, popover or dialog of the panel lies over the page area. The native page paints above every HTML
 * layer, so it steps behind while one is open instead of hiding it.
 */
function usePopupOver(slot: RefObject<HTMLDivElement | null>): boolean {
  const { portalRef } = useColonia();
  const [over, setOver] = useState(false);
  useEffect(() => {
    const portal = portalRef.current;
    if (!portal) return;
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = slot.current;
        if (!el) return setOver(false);
        const a = el.getBoundingClientRect();
        const hit = [
          ...portal.querySelectorAll<HTMLElement>("[role=menu], [role=dialog], [role=listbox], .colonia-menu"),
        ].some((p) => {
          const b = p.getBoundingClientRect();
          return (
            b.width > 0 && b.height > 0 && b.left < a.right && b.right > a.left && b.top < a.bottom && b.bottom > a.top
          );
        });
        setOver(hit);
      });
    };
    const mo = new MutationObserver(check);
    mo.observe(portal, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "data-open"] });
    check();
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
    };
  }, [portalRef, slot]);
  return over;
}

function ScreenshotView({ tab }: { tab: string }) {
  const t = useT();
  const visible = usePageVisible();
  const { src, error } = useScreenshot(tab, POLL_MS, visible);
  return (
    <div className="browser__page">
      {src ? (
        <img className="browser__shot" src={src} alt={t("browser.liveView")} draggable={false} />
      ) : error ? (
        <EmptyState icon={<Icons.TriangleAlert />} title={t("browser.noImage")}>
          {t("browser.noImageBody")}
        </EmptyState>
      ) : (
        <Skeleton shape="block" height="100%" />
      )}
    </div>
  );
}

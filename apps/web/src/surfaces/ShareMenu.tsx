import type { SurfaceSummary } from "@colonia/protocol";
import { Button, IconButton, Icons, Menu, type MenuEntry } from "@colonia/ui";
import { useEffect, useState } from "react";
import { shareSurface } from "../data/actions.ts";
import { client } from "../data/client.ts";

import { notify } from "../data/notices.ts";
import { openTempLink, readAddress } from "../data/project-share.ts";
import { type MessageKey, t as tr, useT } from "../i18n/index.ts";
import { ensurePublicLink, openPublicLink, PopupBlockedError, PublicLinkError, publicLink } from "./public-link.ts";

export async function publicShareLink(path: string): Promise<string> {
  const address = await client.call("webhooks.get", {});
  return publicLink(path, address);
}

/** ENLACE-PUBLICO-1 · Why the public address is not up, in plain words. */
const REASONS: Partial<Record<string, MessageKey>> = {
  funnel_failed: "hooks.err.funnel_failed",
  ngrok_timeout: "hooks.err.ngrok_timeout",
  ngrok_failed: "hooks.err.ngrok_failed",
  ngrok_stopped: "hooks.err.ngrok_stopped",
  cloudflare_download: "hooks.err.cloudflare_download",
  cloudflare_timeout: "hooks.err.cloudflare_timeout",
  cloudflare_stopped: "hooks.err.cloudflare_stopped",
};

function failed(e: unknown): void {
  const reason = e instanceof PublicLinkError ? e.reason : undefined;
  notify(tr("share.activateFailed", { reason: tr(REASONS[reason ?? ""] ?? "hooks.err.failed") }));
}

/** ENLACE-PUBLICO-1 · The link, switching the public address on right here (never "go to Settings") when there is none. */
function linkFor(path: string): Promise<string> {
  return ensurePublicLink(path, {
    read: readAddress,
    activate: () => {
      notify(tr("share.activating"), "info");
      return openTempLink(() => {});
    },
  });
}

/** Whether the public address is up while the menu is open: `ready` is undefined while asking. */
function useAddress(path: string): { url?: string; ready?: boolean } {
  const [state, setState] = useState<{ url?: string; ready?: boolean }>({});
  useEffect(() => {
    let current = true;
    void readAddress().then((a) => {
      if (!current) return;
      try {
        setState({ url: publicLink(path, a ?? {}), ready: true });
      } catch {
        setState({ ready: false });
      }
    });
    return () => {
      current = false;
    };
  }, [path]);
  return state;
}

function PublicLinkPreview({ path }: { path: string }) {
  const t = useT();
  const { url, ready } = useAddress(path);
  if (ready === undefined) return <span className="share__url">…</span>;
  return <span className="share__url">{url ?? t("share.noLinkYet")}</span>;
}

/** "Copy link" / "Open link", or "Switch on the public link and…" while there is none yet. */
function ActionLabel({ path, kind }: { path: string; kind: "copy" | "open" }) {
  const t = useT();
  const { ready } = useAddress(path);
  if (ready === false) return <>{t(kind === "copy" ? "share.activateCopy" : "share.activateOpen")}</>;
  return <>{t(kind === "copy" ? "share.copy" : "share.open")}</>;
}

export function linkOf(s: SurfaceSummary): string | undefined {
  return s.share_path;
}

async function copy(url: string, done: MessageKey = "share.copied"): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    notify(tr(done), "info");
  } catch {
    notify(tr("share.copyFailed"));
  }
}

/** The share choices for a surface: private or public link, and copy/open of the link once public. */
export function shareEntries(surface: SurfaceSummary, t: typeof tr): MenuEntry[] {
  const url = linkOf(surface);
  const path = surface.share_path ?? "";
  return [
    { type: "label", label: t("share.hint") },
    {
      label: url ? t("share.private") : `${t("share.private")} ✓`,
      icon: <Icons.Lock size={16} />,
      onSelect: () => url && void shareSurface(surface.id, false),
    },
    {
      label: url ? `${t("share.anyone")} ✓` : t("share.anyone"),
      icon: <Icons.Globe size={16} />,
      onSelect: async () => {
        if (url) return;
        const shared = await shareSurface(surface.id, true);
        if (!shared) return;
        try {
          await copy(await publicShareLink(shared));
        } catch {
          // No public address yet: it is switched on from this same menu, with its warning in view.
          notify(t("share.sharedNoLink"), "info");
        }
      },
    },
    ...(url
      ? ([
          { type: "separator" },
          { type: "label", label: <PublicLinkPreview path={path} /> },
          {
            label: <ActionLabel path={path} kind="copy" />,
            icon: <Icons.Copy size={16} />,
            onSelect: async () => {
              try {
                await copy(await linkFor(path));
              } catch (e) {
                failed(e);
              }
            },
          },
          {
            label: <ActionLabel path={path} kind="open" />,
            icon: <Icons.ExternalLink size={16} />,
            onSelect: async () => {
              try {
                await openPublicLink(
                  () => linkFor(path),
                  () => {
                    const tab = window.open("about:blank", "_blank");
                    if (!tab) return null;
                    tab.opener = null;
                    const policy = tab.document.createElement("meta");
                    policy.name = "referrer";
                    policy.content = "no-referrer";
                    tab.document.head.append(policy);
                    return { navigate: (value) => tab.location.replace(value), close: () => tab.close() };
                  },
                );
              } catch (e) {
                if (!(e instanceof PopupBlockedError)) return failed(e);
                // ENLACE-PUBLICO-1 · The browser blocked the new tab: the link goes to the clipboard instead.
                try {
                  await copy(await linkFor(path), "share.popupCopied");
                } catch (again) {
                  failed(again);
                }
              }
            },
          },
        ] satisfies MenuEntry[])
      : []),
  ];
}

/** Private ↔ public link for a surface (surfaces.share), with copy/open of the link. */
export function ShareMenu({ surface, variant = "button" }: { surface: SurfaceSummary; variant?: "button" | "icon" }) {
  const t = useT();
  const url = linkOf(surface);
  const items = shareEntries(surface, t);
  const label = url ? t("share.shared") : t("share.private");
  const trigger =
    variant === "icon" ? (
      <IconButton
        size="sm"
        label={t("share.iconLabel", { state: label })}
        icon={url ? <Icons.Globe size={14} /> : <Icons.Share size={14} />}
        active={Boolean(url)}
      />
    ) : (
      <Button size="sm" variant="secondary" leadingIcon={url ? <Icons.Globe size={14} /> : <Icons.Lock size={14} />}>
        {url ? t("share.shared") : t("share.share")}
      </Button>
    );
  return <Menu align="end" items={items} trigger={trigger} />;
}

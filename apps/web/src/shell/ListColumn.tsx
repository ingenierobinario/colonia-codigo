import { IconButton, Icons, ResizeHandle } from "@colonia/ui";
import type { ReactNode } from "react";
import { setPrefs, usePrefs } from "../data/prefs.ts";
import { useT } from "../i18n/index.ts";
import { LAYOUT } from "./layout.ts";

/**
 * The chat list beside a chat (Inbox, a project's chats, an engine's sessions): narrower or wider from its edge.
 * Folded (LISTA-PLEGABLE-1) it leaves a strip whose button opens it again, never nothing to go back to.
 */
export function ListColumn({ width, children }: { width: number; children: ReactNode }) {
  const t = useT();
  const folded = usePrefs((s) => s.listCollapsed);
  if (folded)
    return (
      <div className="listcol listcol--folded">
        <IconButton
          size="sm"
          label={t("inbox.expand")}
          icon={<Icons.PanelLeftOpen size={15} />}
          onClick={() => setPrefs({ listCollapsed: false })}
        />
      </div>
    );
  return (
    <div className="listcol">
      {children}
      <ResizeHandle
        className="listcol__resize"
        width={width}
        min={LAYOUT.listMinW}
        max={LAYOUT.listMaxW}
        onResize={(w) => setPrefs({ listW: w })}
        onReset={() => setPrefs({ listW: 0 })}
        label={t("inbox.resize")}
      />
    </div>
  );
}

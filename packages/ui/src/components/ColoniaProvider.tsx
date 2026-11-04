import { type CSSProperties, createContext, type ReactNode, type RefObject, useContext, useRef } from "react";
import { cx } from "../cx";

export type ColoniaLook = "minimal" | "classic";
export type ColoniaMode = "light" | "dark";

type ColoniaContextValue = { look: ColoniaLook; mode: ColoniaMode; portalRef: RefObject<HTMLDivElement | null> };
const ColoniaContext = createContext<ColoniaContextValue | null>(null);

export interface ColoniaProviderProps {
  /** Visual language. "minimal" = v2 (warm greys, ink accent, pills). "classic" = Colonia v1 (green selection, mono meta, 12px radius). */
  look?: ColoniaLook;
  /** Color mode. Every look has a light and a dark value set. */
  mode?: ColoniaMode;
  /** Paint the page background (`--colonia-bg`) and fill the parent's height. Use on the app root. */
  fill?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Root of every Colonia surface. Sets the look and mode (as `data-colonia-look` / `data-colonia-mode`),
 * which switches every `--colonia-*` token underneath, and hosts the portal layer that menus,
 * tooltips and dialogs render into so overlays keep the same look. Nest a second provider
 * to show one region in another look or mode.
 */
export function ColoniaProvider({
  look = "minimal",
  mode = "light",
  fill = false,
  className,
  style,
  children,
}: ColoniaProviderProps) {
  const portalRef = useRef<HTMLDivElement | null>(null);
  return (
    <ColoniaContext.Provider value={{ look, mode, portalRef }}>
      <div className={cx("colonia", fill && "colonia-fill", className)} data-colonia-look={look} data-colonia-mode={mode} style={style}>
        {children}
        <div ref={portalRef} className="colonia-portal" />
      </div>
    </ColoniaContext.Provider>
  );
}

/** Current look/mode, and the portal container overlays should mount into. Works outside a provider (minimal · light). */
export function useColonia(): ColoniaContextValue {
  const ctx = useContext(ColoniaContext);
  const fallback = useRef<HTMLDivElement | null>(null);
  return ctx ?? { look: "minimal", mode: "light", portalRef: fallback };
}

import { AgentAvatar, IconButton, Icons } from "@colonia/ui";
import { type PointerEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { stopKeys } from "../config/desktopPrefs.ts";
import { blobOf } from "../data/identity.ts";
import { useT } from "../i18n/index.ts";
import { ComputerIcon } from "./parts/ComputerIcon.tsx";
import { activity } from "./screenLiveDesktop.ts";

type Frame = {
  data: string;
  action?: number;
  bounds?: { x: number; y: number; width: number; height: number };
  app: string;
  window: string;
};
type Size = "mini" | "large" | "hidden";
type Offset = { x: number; y: number };

const FRAME_MS = 700;
const HOME: Offset = { x: 0, y: 0 };

/**
 * The window an agent works on, live, in a card over the chat (desktop app only). It starts small at the bottom; it
 * moves by its title bar within the chat, grows, shrinks or hides into a pill at the top, and marks where the agent
 * last clicked. When computer use ends it closes, and the next time it starts at the bottom again. Frames go from the
 * desktop to this panel only. DETENER-VIVO-1: after the emergency stop it says so and closes by itself, and it always
 * has a close button.
 */
export function ScreenLive() {
  const t = useT();
  const { last, stopped, handoff } = useSyncExternalStore(activity.subscribe, activity.get);
  const [capture, setFrame] = useState<Frame>();
  const [size, setSize] = useState<Size>("mini");
  const [offset, setOffset] = useState<Offset>(HOME);
  const card = useRef<HTMLElement>(null);
  const drag = useRef<{ px: number; py: number; from: Offset } | undefined>(undefined);

  // Closed (idle, stopped, or by the owner): the next session starts small at the bottom, with no old frame.
  const open = Boolean(last);
  useEffect(() => {
    if (open) return;
    setFrame(undefined);
    if (handoff) return;
    setOffset(HOME);
    setSize("mini");
  }, [open, handoff]);

  // Stopped, nothing is live any more: no more frames are asked for.
  const action = last?.action;
  const frame = capture?.action === action ? capture : undefined;
  const live = open && !stopped && size !== "hidden";
  useEffect(() => {
    const desktop = window.coloniaDesktop;
    if (!live || !desktop?.computerFrame) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const f = (await desktop.computerFrame?.().catch(() => undefined)) as Frame | undefined;
      if (stop) return;
      if (f && f.action === action) setFrame(f);
      timer = setTimeout(() => void tick(), FRAME_MS);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [live, action]);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { px: e.clientX, py: e.clientY, from: offset };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = card.current;
    const area = el?.parentElement?.getBoundingClientRect();
    if (!d || !el || !area) return;
    // Within the chat: the card's own default spot is the bottom right, so it moves up and to the left from there.
    const box = el.getBoundingClientRect();
    const w = box.width;
    const h = box.height;
    const x = Math.min(0, Math.max(-(area.width - w - 32), d.from.x + e.clientX - d.px));
    const y = Math.min(0, Math.max(-(area.height - h - 112), d.from.y + e.clientY - d.py));
    setOffset({ x, y });
  };
  const onUp = () => {
    drag.current = undefined;
  };

  if (!window.coloniaDesktop?.computerFrame || !last) return null;
  // Hidden, the stop still shows: the card comes back to say so before it closes.
  if (size === "hidden" && !stopped)
    return (
      <button type="button" className="screenlive__pill" onClick={() => setSize("mini")}>
        <ComputerIcon busy size={14} />
        {t("live.show")}
      </button>
    );
  const b = frame?.bounds;
  const point =
    b && last.kind === "click" && last.x !== undefined && last.y !== undefined
      ? { x: (last.x - b.x) / b.width, y: (last.y - b.y) / b.height }
      : undefined;
  const dot =
    point && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
      ? { left: `${point.x * 100}%`, top: `${point.y * 100}%` }
      : undefined;
  const actor = !stopped && last.actor;
  const badge = actor && (
    <span className="screenlive__actor" role="img" aria-label={t("live.actor", { name: actor.name })}>
      <AgentAvatar name={actor.name} blob={blobOf(actor)} size={20} animated={false} />
      <span>{actor.name}</span>
    </span>
  );
  return (
    <section
      ref={card}
      className={`screenlive screenlive--${size === "hidden" ? "mini" : size}`}
      aria-label={t("live.title")}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      <div className="screenlive__head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <ComputerIcon busy={!stopped} size={14} />
        <span className="screenlive__title">
          {frame?.app || last.app}
          {(frame?.window || last.window) && (
            <span className="screenlive__window"> · {frame?.window || last.window}</span>
          )}
        </span>
        {!stopped && (
          // Small and quiet until the pointer is on it: then it opens and says what it does.
          <button
            type="button"
            className="screenlive__stop"
            aria-label={t("live.stopHint", { keys: stopKeys() })}
            onClick={() => void window.coloniaDesktop?.stopComputer?.()}
          >
            <Icons.Square size={10} />
            <span className="screenlive__stoplabel">{t("live.stop")}</span>
          </button>
        )}
        <IconButton
          size="sm"
          label={size === "mini" ? t("live.bigger") : t("live.smaller")}
          icon={size === "mini" ? <Icons.Maximize2 size={13} /> : <Icons.Minimize2 size={13} />}
          onClick={() => setSize(size === "mini" ? "large" : "mini")}
        />
        <IconButton
          size="sm"
          label={t("live.hide")}
          icon={<Icons.EyeOff size={13} />}
          onClick={() => setSize("hidden")}
        />
        <IconButton
          size="sm"
          label={t("live.close")}
          icon={<Icons.X size={13} />}
          onClick={() => activity.dispatch({ type: "close" })}
        />
      </div>
      {!dot && badge}
      <div className="screenlive__view">
        {frame ? (
          <img src={frame.data} alt={t("live.title")} draggable={false} />
        ) : (
          <div className="screenlive__wait">{t("live.wait")}</div>
        )}
        {dot && point && !stopped && (
          <>
            <span className="screenlive__dot" style={dot} />
            {badge && (
              <span
                className="screenlive__pointer-label"
                data-left={point.x > 0.5}
                data-above={point.y > 0.5}
                style={dot}
              >
                {badge}
              </span>
            )}
          </>
        )}
        {stopped && (
          <div className="screenlive__stopped" role="status">
            <span>{t("live.stopped")}</span>
          </div>
        )}
      </div>
    </section>
  );
}

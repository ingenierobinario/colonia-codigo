import type { CSSProperties } from "react";
import { EXTRA_AVATARS } from "../blobs/avatars";
import { BLOB_VIEWBOX, BLOBS, type BlobName } from "../blobs/catalog";
import { hashSeed } from "../blobs/seed";
import { cx } from "../cx";

export interface AgentAvatarProps {
  /** Agent name for accessible image text. */
  name: string;
  /** Blob from the Colonia catalog: "menta", "noche", "kiwi", "coral", "zafiro", "amatista"… (see BLOB_NAMES). */
  blob?: BlobName | (string & {});
  /** Pixel size (default 32). Blobs read well from 16 to 64. */
  size?: number;
  /** Bob, look around and blink. Off for dense lists or pickers. Respects prefers-reduced-motion. */
  animated?: boolean;
  /** Presence dot. */
  status?: "online" | "busy" | "away" | "offline";
  /** Spoken name of `status` (translations); defaults to the status id. */
  statusLabel?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * The one avatar for agents — the colony's penguins with SVG eyes that look around and blink,
 * each agent desynced by a name-derived delay. Missing or unknown choices keep the default penguin.
 */
export function AgentAvatar({
  name,
  blob,
  size = 32,
  animated = true,
  status,
  statusLabel,
  className,
  style,
}: AgentAvatarProps) {
  const extra = blob ? EXTRA_AVATARS[blob as keyof typeof EXTRA_AVATARS] : undefined;
  const p = (blob ? (BLOBS as Record<string, (typeof BLOBS)[BlobName]>)[blob] : undefined) ?? BLOBS.menta;
  const delay = `-${(hashSeed(name) % 40) / 10}s`;
  return (
    <span
      className={cx("colonia-blob", animated && "colonia-blob--anim", className)}
      style={{ width: size, height: size, ["--colonia-blob-delay" as string]: delay, ...style }}
      role="img"
      aria-label={status ? `${name} (${statusLabel ?? status})` : name}
    >
      <span className="colonia-blob__bob">
        <img className="colonia-blob__body" src={extra?.src ?? p.src} alt="" draggable={false} />
        {!extra && (
          <svg className="colonia-blob__eyes" viewBox={`0 0 ${BLOB_VIEWBOX} ${BLOB_VIEWBOX}`} aria-hidden="true">
            <g className="colonia-blob__look">
              <g className="colonia-blob__blink">
                {p.eyes.map((e) => (
                  <rect key={`${e.x},${e.y}`} x={e.x} y={e.y} width={e.w} height={e.h} rx={e.rx} fill={p.eyeColor} />
                ))}
              </g>
            </g>
          </svg>
        )}
      </span>
      {status && <span className={cx("colonia-avatar__status", `is-${status}`)} />}
    </span>
  );
}

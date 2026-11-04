import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Bold first line. */
  title?: ReactNode;
  /** Muted text under the title. */
  description?: ReactNode;
  /** Top-right slot (a Badge, an IconButton). */
  aside?: ReactNode;
  /** soft = warm fill, no border (feature/info panels); surface = white panel (bordered in classic); outline = transparent with border. */
  variant?: "soft" | "surface" | "outline";
  padding?: "sm" | "md" | "lg";
  children?: ReactNode;
}

/** Generic panel: feature cards, settings sections, empty states. */
export function Card({
  title,
  description,
  aside,
  variant = "surface",
  padding = "md",
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div className={cx("colonia-card", `colonia-card--${variant}`, `colonia-card--pad-${padding}`, className)} {...rest}>
      {(title || aside) && (
        <div className="colonia-card__head">
          <div className="colonia-card__titles">
            {title && <div className="colonia-card__title">{title}</div>}
            {description && <div className="colonia-card__desc">{description}</div>}
          </div>
          {aside}
        </div>
      )}
      {!title && description && <div className="colonia-card__desc">{description}</div>}
      {children}
    </div>
  );
}

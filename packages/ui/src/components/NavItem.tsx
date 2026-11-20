import type { ReactNode } from "react";
import { cx } from "../cx";
import { Tooltip } from "./Tooltip";

export interface NavItemProps {
  label: ReactNode;
  /** Optional context for the accessible name and the collapsed row's tooltip. */
  description?: string | undefined;
  /** Leading icon (lucide, 16px) or a small AgentAvatar/project avatar. */
  icon?: ReactNode;
  /** Right-aligned counter (Inbox 3). */
  count?: number;
  /** Highlight the count as needing attention. */
  attention?: boolean;
  /** Right-aligned slot after the count: a lock icon, a running dot. */
  trailing?: ReactNode;
  active?: boolean;
  /** Icon-only rail mode: hides label, count and trailing; the label becomes the tooltip/aria-label. */
  collapsed?: boolean;
  /** Indent level for nested items (a project's sub-sections). */
  depth?: 0 | 1;
  /** Shown but not clickable (a feature that is coming). */
  disabled?: boolean;
  href?: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
  className?: string;
}

/** Sidebar navigation row: Home, Inbox, In progress, a project, a project section. */
export function NavItem({
  label,
  description,
  icon,
  count,
  attention = false,
  trailing,
  active = false,
  collapsed = false,
  depth = 0,
  disabled = false,
  href,
  onClick,
  onDoubleClick,
  className,
}: NavItemProps) {
  const cls = cx(
    "colonia-nav",
    depth === 1 && "colonia-nav--nested",
    collapsed && "colonia-nav--collapsed",
    active && "is-active",
    disabled && "is-disabled",
    className,
  );
  const name = collapsed && typeof label === "string" ? label : undefined;
  const badge = count != null && count > 0 && (
    <span className={cx("colonia-nav__count", attention && "is-attention")}>{count}</span>
  );
  const inner = (
    <>
      {icon && <span className="colonia-nav__icon">{icon}</span>}
      {!collapsed && <span className="colonia-nav__label">{label}</span>}
      {!collapsed && badge}
      {!collapsed && trailing && <span className="colonia-nav__trailing">{trailing}</span>}
      {collapsed && count != null && count > 0 && <span className="colonia-nav__dot" aria-hidden="true" />}
    </>
  );
  const el = href ? (
    <a
      className={cls}
      href={href}
      aria-current={active ? "page" : undefined}
      aria-label={name}
      aria-description={description}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {inner}
    </a>
  ) : (
    <button
      type="button"
      className={cls}
      aria-current={active ? "page" : undefined}
      aria-label={name}
      aria-description={description}
      disabled={disabled}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {inner}
    </button>
  );
  // In the rail only the icon shows: its name comes up beside it.
  return name ? (
    <Tooltip
      content={<span className="colonia-nav__hint">{description ? `${name} · ${description}` : name}</span>}
      side="right"
    >
      {el}
    </Tooltip>
  ) : (
    el
  );
}

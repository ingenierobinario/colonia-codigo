import { Icons } from "@colonia/ui";
import { type ReactNode, useEffect } from "react";
import { prefs, setPrefs, usePrefs } from "../data/prefs.ts";

/** Folds remembered at most: the oldest are forgotten (their group goes back to how it starts). */
const KEPT = 300;

/**
 * PLEGAR-BANDEJA-1: whether a group of the Inbox is open, remembered across sessions like the sidebar's sections.
 * `inboxFolded` keeps the groups the owner turned away from how they start (open, or closed when `startOpen` is false).
 * A group holding the open chat opens itself.
 */
export function useFold(key: string, { startOpen = true, holdsSelected = false } = {}) {
  const turned = usePrefs((s) => s.inboxFolded.includes(key));
  const open = turned !== startOpen;
  const setOpen = (next: boolean) => {
    const list = prefs.get().inboxFolded.filter((k) => k !== key);
    setPrefs({ inboxFolded: next === startOpen ? list : [...list, key].slice(-KEPT) });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: open it once when it comes to hold the open chat.
  useEffect(() => {
    if (holdsSelected && !open) setOpen(true);
  }, [holdsSelected]);
  return [open, setOpen] as const;
}

/** The fold mark of every group, the sidebar's: one chevron, at the end, turned while folded. */
export function FoldChevron({ open }: { open: boolean }) {
  return <Icons.ChevronDown size={12} className={open ? "foldhead__chev" : "foldhead__chev is-closed"} />;
}

/**
 * The head of a group of the Inbox (a task, a routine, an agent, the chats a chat delegated, the archived): its mark in
 * the column of the avatars, its name, what it holds under it (never cut), and the chevron last. The same in every view.
 */
export function FoldHead({
  open,
  onToggle,
  label,
  lead,
  title,
  count,
  side,
  unread = false,
  sub = false,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  /** What the button does, for screen readers and the tooltip. */
  label: string;
  lead?: ReactNode;
  title?: ReactNode;
  count?: ReactNode;
  /** Unread and time, before the chevron. */
  side?: ReactNode;
  unread?: boolean;
  /** A line under a chat (its delegated chats): no mark, the count in the column of the titles. */
  sub?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={["foldhead", sub && "is-sub", unread && "is-unread", className].filter(Boolean).join(" ")}
      aria-expanded={open}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <span className="foldhead__lead">{lead}</span>
      <span className="foldhead__body">
        {title && <span className="foldhead__title">{title}</span>}
        {count && <span className="foldhead__count">{count}</span>}
      </span>
      {side}
      <FoldChevron open={open} />
    </button>
  );
}

// The Tasks list's "Closed" group: every done and dropped task, read a page at a time once the group is unfolded.
import type { Task, TaskKind } from "@colonia/protocol";
import { SearchField, Spinner } from "@colonia/ui";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadClosed, useTasks } from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";

/** How many closed tasks each "See more" brings. */
const PAGE = 20;
/** The most a refresh reads back in one go; past it, "See more" pages again. */
const MAX_REFRESH = 200;
/** How long the search waits for the next keystroke. */
const SEARCH_WAIT_MS = 250;

/** Which closed tasks a list shows: one project's, the ones outside every project, or all; of one kind or all. */
export type ClosedScope = { project?: string; unfiled?: boolean; kind?: TaskKind };

export type ClosedState = {
  /** The pages read so far, newest first; undefined until the first one arrives. */
  items: Task[] | undefined;
  /** How many closed tasks the scope has, whatever the search says; undefined until known. */
  total: number | undefined;
  /** How many match the search (the same as `total` without one). */
  matches: number;
  /** What the search box holds, and what was last searched for. */
  query: string;
  searched: string;
  busy: boolean;
  setQuery(query: string): void;
  more(): void;
  refresh(): void;
};

/**
 * Closed tasks of a scope, read only while `open`. Reads again when the board changes (a task closed, reopened,
 * edited or deleted), keeping as many rows as were on screen.
 */
export function useClosedTasks(scope: ClosedScope, open: boolean): ClosedState {
  const board = useTasks((s) => s.tasks);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [page, setPage] = useState<{ items: Task[]; matches: number }>();
  const [total, setTotal] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const shown = useRef({ key: "", count: 0 });

  useEffect(() => {
    const id = setTimeout(() => setSearched(query.trim()), SEARCH_WAIT_MS);
    return () => clearTimeout(id);
  }, [query]);

  // What tells a closed list it is stale: which tasks are closed, and when those last changed.
  const stamp = useMemo(
    () =>
      Object.values(board)
        .map((x) => `${x.id}:${x.state}:${x.state === "open" ? "" : x.updated_at}`)
        .sort()
        .join("|"),
    [board],
  );
  const { project, unfiled, kind } = scope;
  const key = JSON.stringify([project, unfiled, kind, searched]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `stamp` and `tick` only say when to read again.
  useEffect(() => {
    if (!open) return;
    let stale = false;
    const same = shown.current.key === key;
    const limit = same ? Math.min(MAX_REFRESH, Math.max(PAGE, shown.current.count)) : PAGE;
    setBusy(true);
    void loadClosed({ project, unfiled, kind, query: searched || undefined, offset: 0, limit }).then((r) => {
      if (stale) return;
      setBusy(false);
      if (!r) return;
      shown.current = { key, count: r.tasks.length };
      setPage({ items: r.tasks, matches: r.total });
      if (!searched) setTotal(r.total);
    });
    return () => {
      stale = true;
    };
  }, [open, key, stamp, tick]);

  const more = useCallback(() => {
    if (!page || busy) return;
    setBusy(true);
    const at = key;
    void loadClosed({
      project,
      unfiled,
      kind,
      query: searched || undefined,
      offset: page.items.length,
      limit: PAGE,
    }).then((r) => {
      setBusy(false);
      if (!r || shown.current.key !== at) return;
      setPage((cur) => {
        if (!cur) return cur;
        const have = new Set(cur.items.map((x) => x.id));
        const items = [...cur.items, ...r.tasks.filter((x) => !have.has(x.id))];
        shown.current = { key: at, count: items.length };
        return { items, matches: r.total };
      });
    });
  }, [page, busy, key, project, unfiled, kind, searched]);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // The board's copy of a task is the fresher one; a task reopened a moment ago leaves before the next read.
  const items = useMemo(
    () => page?.items.map((x) => board[x.id] ?? x).filter((x) => x.state !== "open"),
    [page, board],
  );
  return { items, total, matches: page?.matches ?? 0, query, searched, busy, setQuery, more, refresh };
}

/** The unfolded group: a search box, the rows, and "See more" while there are more. */
export function ClosedTasks({ closed, row }: { closed: ClosedState; row(task: Task): ReactNode }) {
  const t = useT();
  const { items } = closed;
  if (!items)
    return (
      <div className="tasks__closedwait">
        <Spinner size={14} />
      </div>
    );
  const left = closed.matches - items.length;
  return (
    <>
      {(closed.total !== 0 || closed.searched !== "") && (
        <div className="tasks__closedbar">
          <SearchField
            size="sm"
            className="tasks__closedsearch"
            aria-label={t("tasks.closed.search")}
            placeholder={t("tasks.closed.search")}
            value={closed.query}
            onChange={(e) => closed.setQuery(e.currentTarget.value)}
          />
          {closed.searched && (
            <span className="tasks__closedfound" aria-live="polite">
              {t(closed.matches === 1 ? "tasks.closed.found.one" : "tasks.closed.found.other", { n: closed.matches })}
            </span>
          )}
        </div>
      )}
      {items.length ? (
        <ul className="tasks__rows">{items.map(row)}</ul>
      ) : (
        <p className="tasks__closedempty">{t(closed.searched ? "tasks.closed.noMatch" : "tasks.closed.empty")}</p>
      )}
      {left > 0 && (
        <button type="button" className="tasks__more" disabled={closed.busy} onClick={closed.more}>
          {t("tasks.seeMore", { n: left })}
        </button>
      )}
    </>
  );
}

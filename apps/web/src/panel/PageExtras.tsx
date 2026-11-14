// CHROME-1: what a browser shows between its toolbar and the page: that the page is loading, the search in the page
// (Ctrl/Cmd+F) and the last download. They live here and not over the page because the desktop app's page is a native
// view that paints above every HTML layer.
import type { TabInfo } from "@colonia/protocol";
import { Button, IconButton, Icons } from "@colonia/ui";
import { useEffect, useRef, useState } from "react";
import { createStore, useSlice } from "../data/createStore.ts";
import { useT } from "../i18n/index.ts";

type Download = { id: string; name: string; state: "started" | "completed" | "failed"; opens?: boolean };

const desktop = typeof window !== "undefined" ? window.coloniaDesktop : undefined;
const extras = createStore<{
  /** The tab being searched; `asked` counts the times the owner pressed the shortcut (it focuses the field again). */
  find: { tab: string; asked: number } | undefined;
  found: { tab: string; active: number; total: number } | undefined;
  download: Download | undefined;
}>({ find: undefined, found: undefined, download: undefined });

desktop?.onFindOpen?.((tab) =>
  extras.set((s) => ({ find: { tab, asked: (s.find?.tab === tab ? s.find.asked : 0) + 1 } })),
);
desktop?.onFound?.((tab, active, total) => extras.set({ found: { tab, active, total } }));
desktop?.onDownload?.((notice) => extras.set({ download: notice }));

export function PageExtras({ tab }: { tab: TabInfo | undefined }) {
  const find = useSlice(extras, (s) => s.find);
  const download = useSlice(extras, (s) => s.download);
  return (
    <>
      <div className={tab?.loading ? "bloading is-on" : "bloading"} aria-hidden="true" />
      {tab && find?.tab === tab.tab && <FindBar tab={tab.tab} asked={find.asked} />}
      {download && <DownloadBar download={download} />}
    </>
  );
}

function FindBar({ tab, asked }: { tab: string; asked: number }) {
  const t = useT();
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const found = useSlice(extras, (s) => s.found);
  const count = found?.tab === tab && text ? found : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: pressing the shortcut again takes the keys back to the field
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [asked]);
  useEffect(() => () => desktop?.stopFind?.(tab), [tab]);
  const close = () => extras.set({ find: undefined, found: undefined });
  const step = (forward: boolean) => text && desktop?.findInPage?.(tab, text, forward, true);
  return (
    <search className="bextra">
      <Icons.Search size={14} />
      <input
        ref={input}
        className="bextra__input"
        aria-label={t("browser.find")}
        placeholder={t("browser.find")}
        value={text}
        onChange={(e) => {
          const next = e.currentTarget.value;
          setText(next);
          desktop?.findInPage?.(tab, next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") step(!e.shiftKey);
          if (e.key === "Escape") close();
        }}
      />
      {text && (
        <span className="bextra__count" aria-live="polite">
          {count ? t("browser.findCount", { n: count.active, total: count.total }) : ""}
        </span>
      )}
      <IconButton
        size="sm"
        label={t("browser.findPrev")}
        icon={<Icons.ChevronUp size={14} />}
        disabled={!text}
        onClick={() => step(false)}
      />
      <IconButton
        size="sm"
        label={t("browser.findNext")}
        icon={<Icons.ChevronDown size={14} />}
        disabled={!text}
        onClick={() => step(true)}
      />
      <IconButton size="sm" label={t("common.close")} icon={<Icons.X size={14} />} onClick={close} />
    </search>
  );
}

function DownloadBar({ download }: { download: Download }) {
  const t = useT();
  const done = download.state === "completed";
  return (
    <div className={download.state === "failed" ? "bextra is-error" : "bextra"} role="status">
      {download.state === "failed" ? <Icons.TriangleAlert size={14} /> : <Icons.Download size={14} />}
      <span className="bextra__text" title={download.name}>
        {t(
          done ? "browser.downloaded" : download.state === "failed" ? "browser.downloadFailed" : "browser.downloading",
          { name: download.name },
        )}
      </span>
      {done && download.opens && (
        <Button
          size="sm"
          variant="secondary"
          className="btoolbar__btn"
          onClick={() => desktop?.openDownload?.(download.id)}
        >
          {t("browser.downloadOpen")}
        </Button>
      )}
      {done && (
        <Button
          size="sm"
          variant="secondary"
          className="btoolbar__btn"
          onClick={() => desktop?.showDownload?.(download.id)}
        >
          {t("browser.downloadShow")}
        </Button>
      )}
      <IconButton
        size="sm"
        label={t("common.close")}
        icon={<Icons.X size={14} />}
        onClick={() => extras.set({ download: undefined })}
      />
    </div>
  );
}

import { Button, Checkbox } from "@colonia/ui";
import { useState } from "react";
import { conversationSource } from "../../data/conversation-origin.ts";
import { useT } from "../../i18n/index.ts";
import type { ChatSummary, FileIssue } from "./conversation-file.ts";

export type ChatResult = { thread: string; added: number } | { issue: "conflict" | "save" };
export type Review = {
  key: number;
  file: File;
  issue?: FileIssue;
  chats: ChatSummary[];
  omitted: number;
  chosen: Set<number>;
  cowork: boolean;
  results: Record<number, ChatResult>;
};

export const canImport = (row: Review, index: number) => {
  const result = row.results[index];
  return !result || ("issue" in result && result.issue === "save");
};

export function ImportFileReview({
  review,
  busy,
  started,
  change,
  open,
}: {
  review: Review;
  busy: boolean;
  started: boolean;
  change(patch: Partial<Review>): void;
  open(thread: string): void;
}) {
  const t = useT();
  const [page, setPage] = useState(0);
  const first = page * 20;
  const { chats, results, chosen } = review;
  const available = chats.map((_, index) => index).filter((index) => canImport(review, index));
  const selected = available.filter((index) => chosen.has(index)).length;
  const isClaude = chats.length > 0 && chats.every(({ source }) => source === "claude" || source === "claude-code");
  const toggle = (index: number, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(index);
    else next.delete(index);
    change({ chosen: next });
  };
  return (
    <section className="import-chats__file">
      <h3>{review.file.name}</h3>
      {review.issue && <p role="alert">{t(`chatImport.error.${review.issue}`)}</p>}
      {review.omitted > 0 && <p>{t("chatImport.omitted", { n: review.omitted })}</p>}
      {isClaude && (
        <Checkbox
          checked={review.cowork}
          disabled={busy || started}
          label={t("chatImport.cowork")}
          onCheckedChange={(cowork) => change({ cowork })}
        />
      )}
      {chats.length > 1 && (
        <Checkbox
          checked={available.length > 0 && selected === available.length}
          indeterminate={selected > 0 && selected < available.length}
          disabled={busy || !available.length}
          label={t("chatImport.all", { n: chats.length })}
          onCheckedChange={(on) => change({ chosen: new Set(on ? available : []) })}
        />
      )}
      {chats.slice(first, first + 20).map((chat, offset) => {
        const index = first + offset;
        const result = results[index];
        return (
          <div key={JSON.stringify([chat.source, chat.id, chat.branch, index])} className="import-chats__row">
            <Checkbox
              checked={chosen.has(index)}
              onCheckedChange={(checked) => toggle(index, checked)}
              disabled={busy || !canImport(review, index)}
              label={chat.title}
              description={
                chat.note
                  ? t("chatImport.note")
                  : t("chatImport.turns", {
                      source: conversationSource[review.cowork ? "cowork" : chat.source],
                      n: chat.turns,
                    })
              }
            />
            {chat.currentBranch && <p>{t("chatImport.currentBranch")}</p>}
            {chat.excerpt && <p className="import-chats__excerpt">{chat.excerpt}</p>}
            {result &&
              ("issue" in result ? (
                <p role="alert">{t(`chatImport.error.${result.issue}`)}</p>
              ) : (
                <div className="import-chats__saved">
                  <span>{result.added ? t("chatImport.added", { n: result.added }) : t("chatImport.unchanged")}</span>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => open(result.thread)}>
                    {t("chatImport.open")}
                  </Button>
                </div>
              ))}
          </div>
        );
      })}
      {chats.length > 20 && (
        <div className="import-chats__pages">
          <Button size="sm" variant="secondary" disabled={!page} onClick={() => setPage(page - 1)}>
            {t("chatImport.previous")}
          </Button>
          <span>{t("chatImport.page", { p: page + 1, n: Math.ceil(chats.length / 20) })}</span>
          <Button size="sm" variant="secondary" disabled={first + 20 >= chats.length} onClick={() => setPage(page + 1)}>
            {t("chatImport.next")}
          </Button>
        </div>
      )}
    </section>
  );
}

import type { Agent, Message as Msg, Thread } from "@colonia/protocol";
import {
  ActivityPill,
  AgentAvatar,
  DayDivider,
  EmptyState,
  Icons,
  Message,
  StickyScroll,
  type StickyScrollHandle,
  SystemNote,
  withMentions,
} from "@colonia/ui";
import { memo, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { ReactionList } from "../channels/MessageMarks.tsx";
import { dayLabel, sameDay } from "../common/format.ts";
import { useEngineLabel } from "../common/useEngineLabel.ts";
import { blobOf, isWorking, routineName, threadAgent } from "../data/identity.ts";
import { useData, useShownAgents } from "../data/state.ts";
import { useLanguage, useT } from "../i18n/index.ts";
import { AgentEvent, MediaGroup, TaskDescription } from "../lazy.ts";
import { nav, useNav } from "../shell/nav.ts";
import { AgentTurn } from "./AgentTurn.tsx";
import { isAgentEvent, isIndividualChat } from "./agentEvent.ts";
import { MessageActions } from "./MessageActions.tsx";
import { FilePart } from "./parts/FilePart.tsx";
import { AudioPart } from "./parts/lazyAudio.tsx";
import { bubbleFiles, mediaBlocks, withoutFilesNote } from "./parts/mediaGroups.ts";
import { NoticePart } from "./parts/NoticePart.tsx";
import { quotedIndex, quoteParts, splitQuote } from "./quote.ts";
import { Regenerate, UserMessage } from "./Rewind.tsx";

const EMPTY: Msg[] = [];

/**
 * `comments`: a task's conversation, read as comments (no skill chips on the agents' answers). `via`: only what came
 * on or went out on that channel (a channel's part of Home).
 */
export function Transcript({ thread, comments = false, via }: { thread: Thread; comments?: boolean; via?: string }) {
  const t = useT();
  const lang = useLanguage();
  const all = useData((s) => s.messages[thread.id] ?? EMPTY);
  const messages = useMemo(() => (via ? all.filter((m) => m.via === via) : all), [all, via]);
  const agents = useShownAgents();
  const engineLabel = useEngineLabel(thread.engine);
  const engineId = thread.engine;
  const engine = useMemo(
    () => (engineId && engineLabel ? { id: engineId, label: engineLabel } : undefined),
    [engineId, engineLabel],
  );
  const showTools = useNav((s) => s.tools);
  const agent = threadAgent(thread, agents);
  const scroll = useRef<StickyScrollHandle>(null);
  const multiAgent =
    !isIndividualChat(thread) &&
    (thread.kind === "group" ||
      thread.kind === "a2a" ||
      thread.kind === "task" ||
      thread.agent_ids.length > 1 ||
      new Set(messages.flatMap((m) => (m.author.kind === "agent" ? [m.author.id] : []))).size > 1);

  // biome-ignore lint/correctness/useExhaustiveDependencies: day labels are re-made when the language changes
  const rows = useMemo(() => {
    const out: { key: string; day?: string; msg: Msg }[] = [];
    let prev: string | undefined;
    for (const m of messages) {
      out.push({ key: m.id, day: !prev || !sameDay(prev, m.created_at) ? dayLabel(m.created_at) : undefined, msg: m });
      prev = m.created_at;
    }
    return out;
  }, [messages, lang]);

  // A search result points at one message ("msg:<id>"): scroll to it once it is loaded, and light it for a moment.
  const focus = useNav((s) => s.focus);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tried again as the thread's messages arrive
  useEffect(() => {
    if (!focus?.startsWith("msg:")) return;
    const row = scroll.current?.content()?.querySelector<HTMLElement>(`[data-msg="${CSS.escape(focus.slice(4))}"]`);
    if (!row) return;
    scroll.current?.release();
    nav.set({ focus: undefined });
    row.scrollIntoView({ block: "center" });
    row.classList.add("is-flash");
    row.addEventListener("animationend", () => row.classList.remove("is-flash"), { once: true });
  }, [focus, rows]);

  // A reply's quote leads back to the message it was taken from.
  const texts = useMemo(() => messages.map(textOf), [messages]);
  // PERF-11: what a row asks about the whole chat (the message a quote came from, what a rewind would remove) is read
  // when it is asked, through functions that never change: a row is then drawn again only when its own message does,
  // not on every word of the answer being written under it.
  const latest = useRef({ messages, texts });
  latest.current = { messages, texts };
  const getMessages = useCallback(() => latest.current.messages, []);
  const quoted = useCallback((id: string, quote: string) => {
    const { messages, texts } = latest.current;
    const i = quotedIndex(
      texts,
      messages.findIndex((m) => m.id === id),
      quote,
    );
    return i >= 0 ? messages[i]?.id : undefined;
  }, []);

  const working = isWorking(thread.state);
  return (
    <StickyScroll
      ref={scroll}
      resetKey={thread.id}
      toBottomLabel={t("chat.toBottom")}
      className="chat__scroll"
      contentClassName="transcript"
    >
      {rows.length === 0 && !working && (
        <EmptyState
          icon={<Icons.MessageCircle />}
          title={t("chat.with", { name: engineLabel ?? agent?.name ?? thread.title })}
        >
          {t("chat.startHint")}
        </EmptyState>
      )}
      {rows.map(({ key, day, msg }, i) => (
        <Row
          key={key}
          thread={thread}
          msg={msg}
          day={day}
          first={i === 0}
          agent={msg.author.kind === "agent" ? agents[msg.author.id] : undefined}
          agentName={agent?.name ?? ""}
          multiAgent={multiAgent}
          showTools={showTools}
          comments={comments}
          engine={engine}
          getMessages={getMessages}
          quoted={quoted}
        />
      ))}
      {working && (
        <div className="transcript__activity">
          <ActivityPill
            tone="brand"
            label={t("chat.agentWorking", { name: agent?.name ?? t("chat.theAgent") })}
            from={agent && <AgentAvatar name={agent.name} blob={blobOf(agent)} size={22} />}
          />
        </div>
      )}
      {thread.state === "queued" && (
        <div className="transcript__activity">
          <ActivityPill label={t("chat.agentQueued", { name: agent?.name ?? t("chat.theAgent") })} />
        </div>
      )}
      {thread.state === "input-required" && (
        <div className="transcript__activity">
          <ActivityPill tone="danger" label={t("chat.agentWaiting", { name: agent?.name ?? t("chat.theAgent") })} />
        </div>
      )}
    </StickyScroll>
  );
}

/** One message of the chat. Memoized (PERF-11): everything it is given stays the same while its message does. */
const Row = memo(function Row({
  thread,
  msg,
  day,
  first,
  agent,
  agentName,
  multiAgent,
  showTools,
  comments,
  engine,
  getMessages,
  quoted,
}: {
  thread: Thread;
  msg: Msg;
  day: string | undefined;
  /** The first message shown. */
  first: boolean;
  /** Who wrote it, when an agent did. */
  agent: Agent | undefined;
  /** The chat's agent: the one who put the reactions on the owner's words. */
  agentName: string;
  multiAgent: boolean;
  showTools: boolean;
  comments: boolean;
  engine: { id: string; label: string } | undefined;
  getMessages: () => Msg[];
  quoted: (id: string, quote: string) => string | undefined;
}) {
  const t = useT();
  const text = textOf(msg);
  const reactions = msg.reactions?.length ? <ReactionList list={msg.reactions} agentName={agentName} /> : undefined;
  const sourceOf = (quote: string) => quoted(msg.id, quote);
  return (
    <div className="transcript__row" data-msg={msg.id}>
      {day && <DayDivider label={day} />}
      {thread.task_id && first && text === "Work on this task." && (
        <Suspense fallback={null}>
          <TaskDescription id={thread.task_id} />
        </Suspense>
      )}
      {thread.kind === "routine" && msg.author.kind === "user" && first ? (
        <RoutinePrompt name={routineName(thread)} text={text} />
      ) : msg.author.kind === "user" ? (
        <>
          <UserMedia message={msg} from="user" />
          <UserMessage thread={thread} message={msg} messages={getMessages} text={text} reactions={reactions}>
            <UserFiles message={msg} />
            <UserText text={text} sourceOf={sourceOf} />
          </UserMessage>
        </>
      ) : msg.author.kind === "system" ? (
        <SystemMessage message={msg} />
      ) : msg.author.kind === "person" ? (
        <>
          {/* A sticker or a photo alone: what anyone put on it shows on the picture, there is no bubble. */}
          <UserMedia
            message={msg}
            from="agent"
            reactions={text || bubbleFiles(msg.parts).length > 0 ? undefined : reactions}
          />
          {(text || bubbleFiles(msg.parts).length > 0) && (
            <Message
              from="agent"
              variant="bubble"
              avatar={<AgentAvatar name={msg.author.name} size={24} />}
              meta={<span className="transcript__person">{msg.author.name}</span>}
              reactions={reactions}
              actions={<MessageActions thread={thread} message={msg} text={text} speechKey={msg.id} />}
            >
              <UserFiles message={msg} />
              <UserText text={text} sourceOf={sourceOf} />
            </Message>
          )}
        </>
      ) : msg.author.kind === "surface" ? (
        <SystemNote icon={<Icons.LayoutGrid size={12} />} className="transcript__fromsurface">
          {t("chat.fromWidget")} <b>{msg.author.title}</b>: {text}
        </SystemNote>
      ) : isAgentEvent(thread, msg) ? (
        <Suspense fallback={<SystemNote>{text}</SystemNote>}>
          <AgentEvent message={msg} agent={agent}>
            <AgentTurn
              thread={thread}
              message={msg}
              agent={agent}
              showAvatar={false}
              showTools={showTools}
              showSkills={false}
            />
          </AgentEvent>
        </Suspense>
      ) : (
        <AgentTurn
          thread={thread}
          message={msg}
          agent={agent}
          showAvatar={multiAgent}
          showTools={showTools}
          showSkills={!comments}
          engine={engine}
          actions={<Regenerate thread={thread} message={msg} messages={getMessages} />}
        />
      )}
    </div>
  );
});

/** What Colonia itself says in a thread: notices (paused, summarized) and plain notes. */
function SystemMessage({ message }: { message: Msg }) {
  const notices = message.parts.filter((p) => p.type === "notice");
  if (!notices.length) return <SystemNote>{textOf(message)}</SystemNote>;
  return (
    <>
      {notices.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a message's parts never reorder.
        <NoticePart key={i} part={p} />
      ))}
    </>
  );
}

/** A routine run opens with the routine's instructions: folded, so what the agent told stands out. */
function RoutinePrompt({ name, text }: { name: string; text: string }) {
  const t = useT();
  return (
    <details className="transcript__routine">
      <summary>
        <Icons.Clock size={13} />
        <span>{t("thread.routinePrompt", { name })}</span>
        <Icons.ChevronRight size={13} className="transcript__routinechev" />
      </summary>
      <p className="transcript__routinetext">{text}</p>
    </details>
  );
}

/** A message's pictures and videos, as blocks of their own beside its bubble: a grid, a carousel. */
function UserMedia({ message, from, reactions }: { message: Msg; from: "user" | "agent"; reactions?: ReactNode }) {
  const groups = mediaBlocks(message.parts).filter((b) => b.kind !== "part");
  if (!groups.length) return null;
  return (
    <Message from={from} variant="bare" className="transcript__media" reactions={reactions}>
      <Suspense fallback={null}>
        {groups.map((g) => (
          <MediaGroup key={g.key} block={g} />
        ))}
      </Suspense>
    </Message>
  );
}

/** What else the owner attached to a message (voice notes, other files), inside its bubble. */
function UserFiles({ message }: { message: Msg }) {
  const files = bubbleFiles(message.parts);
  if (!files.length) return null;
  return (
    <div className="transcript__files">
      {files.map((p) =>
        p.type === "file" ? (
          <FilePart key={p.media_id} part={p} />
        ) : p.type === "audio" ? (
          <AudioPart key={p.media_id} part={p} />
        ) : null,
      )}
    </div>
  );
}

function textOf(m: Msg): string {
  const text = m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n");
  const said = m.parts.some((p) => p.type === "audio") ? text.replace(/\[voice note\]\s*/g, "") : text;
  return withoutFilesNote(m.parts, said);
}

/**
 * The owner's (or a contact's) words as written; a leading "> " quote shows as the quote they answer, and leads back
 * to the message it was taken from when that one is still in the chat.
 */
function UserText({ text, sourceOf }: { text: string; sourceOf: (quote: string) => string | undefined }) {
  const t = useT();
  const { quote, rest } = splitQuote(text);
  const source = quote ? sourceOf(quote) : undefined;
  const { author, text: words } = quoteParts(quote);
  const body = (
    <>
      {author && <span className="transcript__quoteauthor">{author}</span>}
      <span className="transcript__quotetext">{words}</span>
    </>
  );
  return (
    <>
      {quote &&
        (source ? (
          <button
            type="button"
            className="transcript__quote is-link"
            title={t("msg.quoteJump")}
            onClick={() => nav.set({ focus: `msg:${source}` })}
          >
            {body}
          </button>
        ) : (
          <blockquote className="transcript__quote">{body}</blockquote>
        ))}
      {rest && <p className="transcript__usertext">{withMentions(rest)}</p>}
    </>
  );
}

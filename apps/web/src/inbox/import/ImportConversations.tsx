import { Button, Dialog, Field, Icons } from "@colonia/ui";
import { useEffect, useRef, useState } from "react";
import { loadProjectThreads } from "../../data/actions.ts";
import { client } from "../../data/client.ts";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { SearchSelect } from "../../lazy.ts";
import { go } from "../../shell/nav.ts";
import { conversationFileReader } from "./conversation-file.ts";
import { type ChatResult, canImport, ImportFileReview, type Review } from "./ImportFileReview.tsx";
import "./import-conversations.css";

function useConversationFiles(destination: string | undefined) {
  const [files, setFiles] = useState<Review[]>([]);
  const [phase, setPhase] = useState<"preview" | "save">();
  const [started, setStarted] = useState(false);
  const nextFile = useRef(0);
  const current = useRef<AbortController | null>(null);
  const [reader] = useState(conversationFileReader);
  useEffect(
    () => () => {
      current.current?.abort();
      reader.close();
    },
    [reader],
  );
  const pending = files.map((row) =>
    [...row.chosen].filter((i) => !row.issue && canImport(row, i)).sort((a, b) => a - b),
  );
  const total = pending.reduce((count, ids) => count + ids.length, 0);
  const update = (index: number, patch: Partial<Review>) =>
    setFiles((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  async function preview(selected: File[]) {
    if (!selected.length || current.current) return;
    const job = new AbortController();
    current.current = job;
    setPhase("preview");
    setFiles([]);
    try {
      for (const file of selected) {
        const reply = await reader.read({ file }, job.signal).catch(() => ({ issue: "read" as const }));
        if (job.signal.aborted) return;
        const chats = "summaries" in reply ? reply.summaries : [];
        const row: Review = {
          key: ++nextFile.current,
          file,
          chats,
          omitted: "omitted" in reply ? reply.omitted : 0,
          cowork: false,
          results: {},
          chosen: new Set(chats.length === 1 ? [0] : []),
          ...("issue" in reply ? { issue: reply.issue } : {}),
        };
        setFiles((rows) => [...rows, row]);
      }
    } finally {
      current.current = null;
      if (!job.signal.aborted) setPhase(undefined);
    }
  }
  async function save() {
    if (!destination || !total || current.current) return;
    const job = new AbortController();
    current.current = job;
    setPhase("save");
    setStarted(true);
    try {
      for (const [i, row] of files.entries()) {
        const selected = pending[i];
        if (!selected?.length) continue;
        const reply = await reader
          .read({ file: row.file, selected, cowork: row.cowork }, job.signal)
          .catch(() => ({ issue: "read" as const }));
        if (job.signal.aborted) return;
        if (!("conversations" in reply) || reply.conversations.length !== selected.length) {
          update(i, { issue: "issue" in reply ? reply.issue : "structure" });
          continue;
        }
        if (
          reply.conversations.some((chat, position) => {
            const index = selected[position];
            const preview = index === undefined ? undefined : row.chats[index];
            return !preview || preview.id !== chat.id || preview.branch !== chat.branch || preview.title !== chat.title;
          })
        ) {
          update(i, { issue: "structure" });
          continue;
        }
        const results = { ...row.results };
        for (const [position, conversation] of reply.conversations.entries()) {
          const index = selected[position];
          if (index === undefined || job.signal.aborted) return;
          let result: ChatResult;
          try {
            result = await client.call("sessions.import_conversation", { project_id: destination, conversation });
          } catch (error) {
            result = {
              issue: error instanceof Error && error.message.includes("conversation_conflict") ? "conflict" : "save",
            };
          }
          if (job.signal.aborted) return;
          results[index] = result;
          update(i, { results: { ...results } });
        }
      }
      await loadProjectThreads(destination);
    } finally {
      current.current = null;
      if (!job.signal.aborted) setPhase(undefined);
    }
  }
  return { files, phase, started, total, update, preview, save };
}

export function ImportConversations({
  initialProject,
  onClose,
}: {
  initialProject: string | undefined;
  onClose(): void;
}) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const [project, setProject] = useState(initialProject);
  const destination = projects.find((entry) => entry.id === project);
  const picker = useRef<HTMLInputElement>(null);
  const { files, phase, started, total, update, preview, save } = useConversationFiles(destination?.id);
  return (
    <Dialog
      open
      size="lg"
      className="import-chats"
      title={t("chatImport.title")}
      closeLabel={t("common.close")}
      onOpenChange={(open) => !open && phase !== "save" && onClose()}
      description={t("chatImport.help")}
      footer={
        <>
          <Button variant="secondary" disabled={phase === "save"} onClick={onClose}>
            {t(started ? "common.close" : "common.cancel")}
          </Button>
          {(!started || total > 0) && (
            <Button loading={phase === "save"} disabled={!!phase || !destination || !total} onClick={() => void save()}>
              {t("chatImport.confirm", { n: total })}
            </Button>
          )}
        </>
      }
    >
      <Field label={t("chatImport.project")} hint={!projects.length ? t("chatImport.noProject") : undefined}>
        <SearchSelect
          value={destination?.id ?? null}
          onValueChange={(v) => setProject(v ?? undefined)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          placeholder={t("chatImport.pickProject")}
          label={t("chatImport.project")}
          searchPlaceholder={t("pickers.searchProject")}
          emptyLabel={t("pickers.noMatch")}
          disabled={started || !projects.length}
        />
      </Field>
      {!started && (
        <>
          <input
            ref={picker}
            type="file"
            hidden
            multiple
            accept=".zip,.json,.jsonl,.md,.txt"
            data-testid="chat-import-files"
            onChange={(event) => {
              const selected = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void preview(selected);
            }}
          />
          <Button
            variant="secondary"
            disabled={!!phase}
            leadingIcon={<Icons.Upload size={14} />}
            onClick={() => picker.current?.click()}
          >
            {t(files.length ? "chatImport.replace" : "chatImport.choose")}
          </Button>
        </>
      )}
      <p className="import-chats__status" role="status">
        {phase
          ? t(phase === "preview" ? "chatImport.reading" : "chatImport.saving")
          : files.length
            ? t(started ? "chatImport.results" : "chatImport.preview")
            : ""}
      </p>
      {files.map((review, index) => (
        <ImportFileReview
          key={review.key}
          review={review}
          busy={!!phase}
          started={started}
          change={(patch) => update(index, patch)}
          open={(id) => {
            if (destination) {
              onClose();
              go.project(destination.id, "chats", id);
              go.thread(id);
            }
          }}
        />
      ))}
    </Dialog>
  );
}

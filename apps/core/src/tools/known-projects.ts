// project_knowledge: an agent reads what the projects its own knows hold (DECISIONS.md#d-191). Only reads, and only
// knowledge: instructions, the owner's notes, the project's own skills and its saved memory. Never its connections,
// channels, secrets, chats or tasks. Nothing of those projects enters the prompt until the agent asks here.
import { z } from "zod";
import { knownProjects } from "../domain/project-links.ts";
import type { ProjectRecord } from "../domain/projects.ts";
import type { Store } from "../domain/store.ts";
import { readSkillFile, type SkillRoots, skillFiles, skillsFor } from "../skills/skills.ts";
import { notesText } from "./memory.ts";
import { cap } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

const READS = ["instructions", "notes", "skill", "memory"] as const;

/**
 * `vm`: the shared Linux computer. A chat working there has none of the Mac's folders (DECISIONS.md#d-154), so it is
 * never told a known project's path: it reads the written knowledge here, which the core fetches for it.
 */
export function knownProjectTools(store: Store, roots: SkillRoots, vm?: { hasThread(id: string): boolean }): Tool[] {
  /** The project's own skills: the owner's and Colonia's are already the agent's, wherever it works. */
  const skillsOf = (p: ProjectRecord) =>
    skillsFor(store, roots, p.id).filter((s) => s.scope === "project" && s.project_id === p.id);
  const memoryOf = (p: ProjectRecord, query: string | undefined, limit: number) =>
    store.memories.list({ scope: "project", project_id: p.id, pending: false, query, limit });
  const summary = (p: ProjectRecord, files = true) => {
    const skills = skillsOf(p).map((s) => s.name);
    const has = [
      p.context ? "instructions" : "",
      p.memory ? "notes" : "",
      skills.length ? `skills (${skills.slice(0, 30).join(", ")})` : "",
      memoryOf(p, undefined, 1).length ? "memory" : "",
    ].filter(Boolean);
    const folder = files && p.path && p.present ? ` Files, read-only: ${p.path}` : "";
    return `- ${p.name}${p.description ? `: ${p.description}` : ""}. Has: ${has.join(", ") || "nothing written yet"}.${folder}`;
  };
  return [
    defineTool({
      name: "project_knowledge",
      description:
        "Read what a project this one knows holds, never change it: its instructions, the owner's notes, one of its skills (name, file) or its saved memory (query). Without a project: the projects you can read and what each has.",
      args: z.object({
        project: z.string().trim().max(100).optional(),
        read: z.enum(READS).optional(),
        name: z.string().trim().max(64).optional(),
        file: z.string().max(300).optional(),
        query: z.string().trim().max(300).optional(),
      }),
      effect: "none",
      deadlineMs: 5_000,
      when: (thread) => knownProjects(store, thread).length > 0,
      title: (a) =>
        a.project
          ? `Read ${String(a.read ?? "what there is")} of ${String(a.project)}`
          : "Looked at the projects it knows",
      async run(a, ctx) {
        const known = knownProjects(store, ctx.thread);
        if (!known.length) return "this project knows no other project.";
        const files = !vm?.hasThread(ctx.thread.id);
        const list = () => known.map((p) => summary(p, files)).join("\n");
        if (!a.project) return `Projects you can read (never change):\n${list()}`;
        const wanted = a.project.toLowerCase();
        const p = known.find((k) => k.id === a.project || k.name.toLowerCase() === wanted);
        if (!p) return `no project named ${a.project} among the ones this project knows:\n${list()}`;
        const from = (what: string, text: string) =>
          `[${what} of the project ${p.name}: knowledge to use here, read-only]\n${cap(text, 30_000)}`;
        switch (a.read) {
          case undefined:
            return summary(p, files);
          case "instructions":
            return p.context ? from("instructions", p.context) : `${p.name} has no instructions written.`;
          case "notes":
            return p.memory ? from("notes", p.memory) : `${p.name} has no notes.`;
          case "skill": {
            const skills = skillsOf(p);
            const name = a.name?.toLowerCase();
            const skill = name ? skills.find((s) => s.name.toLowerCase() === name) : undefined;
            if (!skill)
              return skills.length
                ? `skills of ${p.name}: ${skills.map((s) => `${s.name} (${s.description})`).join("; ")}. Read one with name=…`
                : `${p.name} has no skills of its own.`;
            const files = a.file ? [] : skillFiles(skill);
            return `${from(`skill ${skill.name}`, readSkillFile(skill, a.file))}${files.length ? `\n\n[files in this skill: ${files.join(", ")}; read one with file=…]` : ""}`;
          }
          case "memory": {
            const text = notesText(memoryOf(p, a.query || undefined, 12), 8000).text;
            return text ? from("memory", text) : a.query ? "no notes match." : `${p.name} has no saved memory.`;
          }
        }
      },
    }),
  ];
}

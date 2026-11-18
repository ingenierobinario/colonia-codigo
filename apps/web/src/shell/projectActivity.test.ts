import assert from "node:assert/strict";
import { test } from "node:test";
import { type ActivityThread, projectActivity } from "./projectActivity.ts";

const thread = (id: string, other: Partial<ActivityThread> = {}): ActivityThread => ({
  id,
  kind: "loose",
  state: "completed",
  archived: false,
  unread: 1,
  updated_at: "2026-01-01",
  ...other,
});

test("proyectos con actividad, chats sin proyecto y novedades de rutinas conservan su orden y ámbito", () => {
  const entries = [{ id: "~default" }, { id: "p_ventas" }];
  const threads = [
    thread("personal"),
    thread("venta", { project_id: "p_ventas", state: "working" }),
    thread("rutina", { kind: "routine" }),
    thread("archivado", { archived: true }),
    thread("delegación", { parent_id: "venta" }),
    thread("externo", { project_id: "p_sin_registro" }),
    thread("id-reservado", { project_id: "~default", state: "working" }),
    thread("rutina-en-marcha", { kind: "routine", state: "working" }),
    thread("leído", { project_id: "p_ventas", unread: 0, updated_at: "2026-02-01" }),
  ];
  const on = projectActivity(entries, threads, true);
  assert.deepEqual([...on.running], ["p_ventas"]);
  assert.deepEqual(on.unread.get("~default"), ["personal", "rutina"]);
  assert.deepEqual(on.unread.get("p_ventas"), ["venta"]);
  assert.deepEqual(on.unread.get(""), ["externo", "id-reservado"]);
  assert.deepEqual([...on.lastActive.keys()], ["~default", "p_ventas"]);
  assert.equal(on.lastActive.get("p_ventas"), "2026-02-01");
  assert.deepEqual(projectActivity(entries, threads, false).unread.get("~default"), ["personal"]);
});

test("la barra consulta el proyecto de cada chat una sola vez al calcular su actividad", () => {
  const entries = Array.from({ length: 100 }, (_, i) => ({ id: `p_${i}` }));
  let reads = 0;
  const threads = Array.from({ length: 500 }, (_, i) => ({
    ...thread(`chat-${i}`),
    get project_id() {
      reads++;
      return entries[i % entries.length]?.id;
    },
  }));
  const { unread } = projectActivity(entries, threads, true);
  assert.equal(unread.size, 100);
  assert.equal(reads, threads.length);
});

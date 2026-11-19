import assert from "node:assert/strict";
import test from "node:test";
import { claudeArtifactPage, claudeArtifactUrl, linkedClaudeArtifact } from "./claude-artifact.ts";

test("el acceso conserva el visor original y solo admite direcciones de artefactos de Claude", () => {
  for (const route of ["artifacts", "public/artifacts", "code/artifact"]) {
    const url = "https://claude.ai/" + route + "/monitor-abcdef";
    assert.equal(linkedClaudeArtifact(claudeArtifactPage(url)), url);
  }
  for (const url of [
    "https://claude.ai/chat/monitor-abcdef",
    "https://claude.ai/new",
    "https://claude.ai.example/artifacts/monitor-abcdef",
    "https://me@claude.ai/artifacts/monitor-abcdef",
    "javascript:alert(1)",
  ]) {
    assert.equal(claudeArtifactUrl(url), undefined);
    assert.throws(() => claudeArtifactPage(url));
  }
});

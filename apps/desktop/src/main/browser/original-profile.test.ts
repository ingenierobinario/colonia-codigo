import assert from "node:assert/strict";
import { test } from "node:test";
import type { FuenteImportar } from "../migrar/navegadores.ts";
import { originalProfileCommand } from "./original-profile.ts";

const source: FuenteImportar = {
  id: "chrome:Profile 2",
  familia: "chromium",
  perfil: "Profile 2",
  navegador: "chrome",
  dir: "/prueba/Profile 2",
};
for (const system of ["win32", "linux", "darwin"] as const) {
  test(`el navegador recibe el perfil elegido en ${system}`, () => {
    const result = originalProfileCommand(source, "Chrome", system);
    assert.deepEqual(result.args, ["--profile-directory=Profile 2", "--new-window", "about:blank"]);
    assert.equal(
      result.command.replaceAll("\\", "/"),
      system === "darwin" ? "Chrome/Contents/MacOS/Google Chrome" : "Chrome",
    );
    const firefox = originalProfileCommand({ ...source, navegador: "firefox", familia: "firefox" }, "Firefox", system);
    assert.deepEqual(firefox.args, ["-profile", source.dir, "-new-window", "about:blank"]);
  });
}

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { waitFor } from "../../../core/src/testkit/platform.ts";
import { prefs } from "../data/prefs.ts";
import * as messages from "./messages.ts";

const pending = Promise.withResolvers<messages.Messages>();
const requested: string[] = [];
const key = Symbol.for("colonia.test.languages");
Object.assign(globalThis, {
  [key]: {
    ...messages,
    loadMessages: async (lang: messages.Language) => {
      if (lang === "en") return pending.promise;
      return {};
    },
    loadPack: async (pack: messages.Pack, lang: messages.Language) => {
      requested.push(`${pack}:${lang}`);
      return pack === "approvals" ? { "input.accept": lang === "en" ? "Accept" : "Aceptar" } : {};
    },
  },
});
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "./messages.ts" && context.parentURL?.endsWith("/i18n/index.ts")) {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent('const m = globalThis[Symbol.for("colonia.test.languages")]; export const { loadMessages, loadPack, LOCALES, isLanguage, LANGUAGE_NAMES, LANGUAGES } = m;')}`,
      };
    }
    return next(specifier, context);
  },
});
const i18n = await import("./index.ts");
hook.deregister();
Reflect.deleteProperty(globalThis, key);

test("un paquete solicitado durante el cambio de idioma llega traducido al nuevo idioma", async () => {
  prefs.set({ language: "es" });
  await i18n.startI18n();
  await i18n.addPack("screens");
  prefs.set({ language: "en" });
  await i18n.addPack("approvals");
  assert.equal(i18n.t("input.accept"), "Aceptar");
  pending.resolve({});
  await waitFor(() => i18n.currentLocale() === "en-US", "cambio de idioma");
  assert.equal(i18n.t("input.accept"), "Accept");
  assert.ok(requested.includes("approvals:en"));
});

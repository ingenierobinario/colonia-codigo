import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { documentationId } from "./doc-routes.mjs";

// La documentación queda en el repo pero se carga salvo con COLONIA_DOCS=0 (ver astro.config.mjs).
export const collections =
  process.env.COLONIA_DOCS !== "0"
    ? {
        docs: defineCollection({
          loader: docsLoader({ generateId: ({ entry }) => documentationId(entry) }),
          schema: docsSchema(),
        }),
      }
    : {};

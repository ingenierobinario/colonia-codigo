import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { documentationId } from "./doc-routes.mjs";

// La documentación queda en el repo pero sólo se carga con COLONIA_DOCS=1 (ver astro.config.mjs).
export const collections =
  process.env.COLONIA_DOCS === "1"
    ? {
        docs: defineCollection({
          loader: docsLoader({ generateId: ({ entry }) => documentationId(entry) }),
          schema: docsSchema(),
        }),
      }
    : {};

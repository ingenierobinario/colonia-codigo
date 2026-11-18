// Lo que el dueño aún debe fijar. Cambia estos valores y toda la web los sigue.
/** A dónde lleva «Quiero mi colonia». La compra vive en el funnel de LeadMatch. */
export const RESERVAR_URL = "https://www.leadmatch.ingenierobinario.com/checkout-bf";
/**
 * Dirección donde se publicarán install.sh e install.ps1. Aún no existe.
 * Las páginas .mdx con bloques de código repiten este mismo literal: búscalo con grep al fijarla.
 */
export const INSTALL_BASE_URL = "https://PENDIENTE-URL-INSTALADOR.example";

/** Instalador de Windows. Vacío = aún no publicado: la página lo dice en vez de dar un enlace roto. */
export const WINDOWS_INSTALLER_URL = "";

export type SectionId = "what" | "new" | "start" | "map" | "terminal" | "questions" | "compare" | "download";
/** Secciones que no se publican: enlazan a páginas fuera del build. */
export const HIDDEN_SECTIONS: SectionId[] = ["map", "compare", "download"];
/** VSL-BF-1: la portada es la página de venta con vídeo; la landing del producto vive en /producto/ y /en/product/. */
export const homeRoute = (lang: "es" | "en") => (lang === "es" ? "/" : "/en/");
/** Ancla de una sección en la landing del producto de ese idioma; sin sección, la landing. */
export const sectionRoute = (lang: "es" | "en", id?: SectionId) =>
  `${lang === "es" ? "/producto/" : "/en/product/"}${id ? `#${id}` : ""}`;

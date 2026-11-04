/** Inline, dependency-free widget styles: shared by panel, phone and published pages without opening their CSP. */
export const WIDGET_KIT_CSS = `
.colonia-widget{max-width:var(--colonia-content-width,1100px);margin-inline:auto;min-width:0;font:14px/1.5 var(--colonia-font-sans,system-ui,sans-serif);color:var(--colonia-fg);overflow-wrap:anywhere}
.colonia-widget *{box-sizing:border-box;min-width:0}
.colonia-widget :where(h1,h2,h3,p){margin:0}
.colonia-widget h1{font-size:clamp(22px,4vw,30px);line-height:1.2;letter-spacing:-.03em;font-weight:650}
.colonia-widget h2{font-size:17px;line-height:1.35;font-weight:650}
.colonia-widget h3{font-size:14px;font-weight:650}
.colonia-stack{display:grid;gap:16px}
.colonia-row{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}
.colonia-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:12px}
.colonia-card{padding:20px;border:1px solid var(--colonia-border);border-radius:14px;background:var(--colonia-surface)}
.colonia-muted{color:var(--colonia-fg-muted)}
.colonia-eyebrow{color:var(--colonia-fg-muted);font-size:12px;font-weight:600;letter-spacing:.04em}
.colonia-stat{font-size:32px;line-height:1.15;font-weight:650;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.colonia-badge{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--colonia-border);border-radius:999px;padding:3px 9px;font-size:12px;white-space:nowrap}
.colonia-badge[data-tone="brand"]{color:var(--colonia-brand);background:color-mix(in srgb,var(--colonia-brand) 10%,transparent)}
.colonia-toolbar{display:flex;flex-wrap:wrap;align-items:end;gap:12px}
.colonia-field{display:grid;gap:6px;flex:1 1 160px;font-size:12px;color:var(--colonia-fg-muted)}
.colonia-widget :where(input,select,textarea,button){font:inherit;color:var(--colonia-fg);border:1px solid var(--colonia-border);border-radius:8px;background:var(--colonia-surface);padding:9px 12px;min-height:40px;max-width:100%}
.colonia-widget :where(input,select,textarea){width:100%}
.colonia-widget :where(button){cursor:pointer;font-weight:600}
.colonia-widget button[data-variant="primary"]{background:color-mix(in srgb,var(--colonia-brand) 16%,var(--colonia-surface));border-color:color-mix(in srgb,var(--colonia-brand) 45%,var(--colonia-border))}
.colonia-widget button:hover:not(:disabled){background:var(--colonia-fill,var(--colonia-bg))}
.colonia-widget button:disabled{opacity:.5;cursor:default}
.colonia-widget :where(button,input,select,textarea,a):focus-visible{outline:2px solid var(--colonia-brand);outline-offset:3px}
.colonia-widget [hidden]{display:none}
.colonia-widget a{color:var(--colonia-brand);text-underline-offset:3px}
.colonia-table-wrap{overflow-x:auto;border:1px solid var(--colonia-border);border-radius:12px}
.colonia-widget table{width:100%;border-collapse:collapse;text-align:left;background:var(--colonia-surface)}
.colonia-widget :where(th,td){padding:12px 16px;border-bottom:1px solid var(--colonia-border);vertical-align:top}
.colonia-widget th{font-size:12px;color:var(--colonia-fg-muted);font-weight:600}
.colonia-widget tr:last-child td{border-bottom:0}
@media(max-width:480px){.colonia-card{padding:16px}.colonia-toolbar{align-items:stretch}.colonia-toolbar>button{width:100%}}
`;

/** Fallback colors for hosts without the panel's live theme tokens. */
export const WIDGET_TOKENS = {
  light:
    "--colonia-bg:#faf9f7;--colonia-surface:#ffffff;--colonia-fill:#efeeea;--colonia-fg:#161616;--colonia-fg-muted:#5f5e5a;--colonia-border:#e7e5e0;--colonia-brand:#1a9460;--colonia-danger:#d23c3c;--colonia-font-sans:system-ui,-apple-system,sans-serif;--colonia-font-mono:ui-monospace,Menlo,monospace;",
  dark: "--colonia-bg:#161615;--colonia-surface:#1e1e1d;--colonia-fill:#272726;--colonia-fg:#ededeb;--colonia-fg-muted:#a6a59f;--colonia-border:#2c2c2a;--colonia-brand:#3ec98b;--colonia-danger:#f06464;--colonia-font-sans:system-ui,-apple-system,sans-serif;--colonia-font-mono:ui-monospace,Menlo,monospace;",
} as const;

/** Inject before author styles so custom designs can override the kit. */
export function injectSurfaceHead(html: string, head: string): string {
  const prefix = /^(?:\s|<!--[\s\S]*?-->|<!doctype[^>]*>)*/i.exec(html)?.[0] ?? "";
  const opening = /^<html(?=[\s>])[^>]*>/i.exec(html.slice(prefix.length));
  if (opening) {
    const afterHtml = prefix.length + opening[0].length;
    const openingHead = /^(?:\s|<!--[\s\S]*?-->)*<head(?=[\s>])[^>]*>/i.exec(html.slice(afterHtml));
    const at = afterHtml + (openingHead?.[0].length ?? 0);
    const injected = openingHead ? head : `<head>${head}</head>`;
    return html.slice(0, at) + injected + html.slice(at);
  }
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}

export type SurfaceLayout = "widget" | "app";

/** Placement owns the outer inset; app content can occupy the entire viewport. */
export function surfaceLayoutCss(layout: SurfaceLayout = "widget"): string {
  return `:root{--colonia-content-width:${layout === "app" ? "none" : "1100px"};--colonia-page-padding:${layout === "app" ? "0px" : "clamp(16px,2vw,24px)"}}`;
}

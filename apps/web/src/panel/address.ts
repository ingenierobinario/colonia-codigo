// NAVFIX-1: lo que se escribe en la barra de direcciones, como en Chrome: una dirección se abre; cualquier otra cosa
// («test», «tiempo en madrid») se busca. Antes «test» se abría como https://test/ y la pestaña quedaba en blanco.
const SEARCH = "https://www.google.com/search?q=";
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Un nombre que se puede abrir tal cual: localhost, una IP, o un dominio con su terminación (ejemplo.com). */
function isHost(hostname: string): boolean {
  if (hostname === "localhost" || IPV4.test(hostname) || hostname.startsWith("[")) return true;
  const tld = hostname.split(".").at(-1) ?? "";
  return hostname.includes(".") && /^[a-z]{2,}$/i.test(tld);
}

/** La URL a cargar para lo escrito; undefined si está vacío o es un esquema que el navegador no abre (file:, about:…). */
export function addressToUrl(raw: string): string | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const search = SEARCH + encodeURIComponent(text);
  if (/\s/.test(text)) return search;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      const u = new URL(text);
      return u.protocol === "http:" || u.protocol === "https:" ? u.href : undefined;
    } catch {
      return search;
    }
  }
  // Un esquema sin «//» que no es un puerto (mailto:, javascript:, file:…): no se abre ni se busca.
  if (/^(about|blob|chrome|data|file|javascript|mailto|tel|view-source):/i.test(text)) return undefined;
  try {
    const local = /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(text);
    const u = new URL(`${local ? "http" : "https"}://${text}`);
    // usuario@sitio no es una dirección que se abra (el navegador bloquea credenciales en la URL): se busca.
    // El nombre tal como se escribió: URL convierte «3.14» en la IP 3.0.0.14, y eso era una búsqueda.
    const typed = text.startsWith("[") ? u.hostname : (text.split(/[/:?#]/)[0] ?? "");
    if (u.username || u.password || !isHost(typed)) return search;
    return u.href;
  } catch {
    return search;
  }
}

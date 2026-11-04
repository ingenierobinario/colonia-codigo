// El arte de los pingüinos: SVG puro, sin ficheros externos. Lienzo de 256×256, el mismo de los rectángulos de ojos.

/** Ojos comunes a todos los pingüinos: quedan sobre la máscara blanca también en el recorrido máximo de la mirada. */
export const EYES = [
  { x: 99, y: 80, w: 17, h: 30, rx: 7.5 },
  { x: 140, y: 80, w: 17, h: 30, rx: 7.5 },
];
export const EYE_COLOR = "#15181C";
export const BRAND = "#14C79A";

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (a) => `#${a.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
export const mix = (a, b, t) => {
  const [x, y] = [rgb(a), rgb(b)];
  return hex(x.map((v, i) => v + (y[i] - v) * t));
};
const lum = (h) => {
  const [r, g, b] = rgb(h);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

const BODY = "M128 14C186 14 212 62 212 122C212 190 178 232 128 232C78 232 44 190 44 122C44 62 70 14 128 14Z";
const FLIPPER = "M54 106C30 122 16 154 20 186C22 197 33 197 39 188C49 174 60 156 70 140Z";
const MASK =
  "M128 62C142 46 176 50 186 78C194 102 180 128 158 140C148 146 138 150 128 150C118 150 108 146 98 140C76 128 62 102 70 78C80 50 114 46 128 62Z";
const BEAK = "M108 122C116 114 140 114 148 122C145 136 135 146 128 146C121 146 111 136 108 122Z";

function accessory(kind, color, p) {
  const a = hex(rgb(color).reverse());
  const tone = lum(a) < 0.25 ? mix(a, "#ffffff", 0.45) : a;
  if (kind === "tuft")
    return `<path d="M118 22C112 12 112 6 116 2C120 8 124 12 128 18C130 10 134 5 140 2C141 10 140 16 138 23Z" fill="url(#${p}f)"/>`;
  if (kind === "crest")
    return `<path d="M124 20C130 6 150 2 168 8C160 12 156 16 154 22C148 18 136 18 124 20Z" fill="${mix(color, "#ffffff", 0.3)}"/>`;
  if (kind === "scarf")
    return `<g clip-path="url(#${p}c)"><path d="M40 152Q128 192 216 152V172Q128 212 40 172Z" fill="${tone}"/><path d="M40 152Q128 192 216 152V156Q128 196 40 156Z" fill="#fff" opacity=".25"/></g><path d="M158 174L182 168L186 208Q176 214 166 208Z" fill="${mix(tone, "#000000", 0.14)}"/>`;
  if (kind === "bow")
    return `<path d="M128 170L102 156Q96 170 102 184ZM128 170L154 156Q160 170 154 184Z" fill="${tone}"/><rect x="120" y="162" width="16" height="16" rx="6" fill="${mix(tone, "#000000", 0.18)}"/>`;
  return "";
}

/** Grupo SVG del pingüino, listo para meter en un viewBox de 256. `eyes` los hornea (logos); los cuerpos van sin ellos. */
export function penguin({ color, kind = "none", eyes = false, id = "p" }) {
  const dark = lum(color) < 0.26;
  // Sobre fondo oscuro un pingüino negro desaparecía: los cuerpos oscuros llevan un filo de luz.
  const rim = dark ? ` stroke="${mix(color, "#ffffff", 0.42)}" stroke-width="2.5"` : "";
  const hi = mix(color, "#ffffff", dark ? 0.32 : 0.3);
  const lo = mix(color, "#000000", dark ? 0.25 : 0.34);
  const p = id;
  return `<defs>
<radialGradient id="${p}b" cx=".36" cy=".24" r=".92"><stop offset="0" stop-color="${hi}"/><stop offset=".48" stop-color="${color}"/><stop offset="1" stop-color="${lo}"/></radialGradient>
<linearGradient id="${p}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${lo}"/></linearGradient>
<linearGradient id="${p}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".62" stop-color="#fbfcfe"/><stop offset="1" stop-color="#d9e1ec"/></linearGradient>
<linearGradient id="${p}o" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc24d"/><stop offset="1" stop-color="#f27a18"/></linearGradient>
<filter id="${p}s" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
<clipPath id="${p}c"><path d="${BODY}"/></clipPath>
</defs>
<ellipse cx="90" cy="228" rx="27" ry="12" fill="url(#${p}o)"/><ellipse cx="166" cy="228" rx="27" ry="12" fill="url(#${p}o)"/>
<path d="${FLIPPER}" fill="url(#${p}f)"${rim}/><path d="${FLIPPER}" transform="translate(256 0) scale(-1 1)" fill="url(#${p}f)"${rim}/>
${kind === "tuft" || kind === "crest" ? accessory(kind, color, p) : ""}
<path d="${BODY}" fill="url(#${p}b)"${rim}/>
<g clip-path="url(#${p}c)">
<ellipse cx="96" cy="42" rx="32" ry="15" transform="rotate(-28 96 42)" fill="#fff" opacity=".3" filter="url(#${p}s)"/>
<ellipse cx="128" cy="172" rx="60" ry="60" fill="url(#${p}w)"/>
</g>
<path d="${MASK}" fill="#fff"/>
<ellipse cx="82" cy="124" rx="11" ry="7" fill="#ff8fa3" opacity=".5" filter="url(#${p}s)"/><ellipse cx="174" cy="124" rx="11" ry="7" fill="#ff8fa3" opacity=".5" filter="url(#${p}s)"/>
<ellipse cx="128" cy="147" rx="17" ry="5" fill="#8a97ad" opacity=".3" filter="url(#${p}s)"/>
<path d="${BEAK}" fill="url(#${p}o)"/><path d="M116 121Q128 116 140 121Q128 125 116 121Z" fill="#fff" opacity=".42"/>
${kind === "scarf" || kind === "bow" ? accessory(kind, color, p) : ""}
${eyes ? EYES.map((e) => `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="${e.rx}" fill="${EYE_COLOR}"/><circle cx="${e.x + 5.5}" cy="${e.y + 7}" r="3" fill="#fff"/>`).join("") : ""}`;
}

/** Figura plana de una tinta para iconos diminutos: silueta con la cara vaciada y los ojos y el pico macizos. */
export function glyph(fill, { id = "g", dot = false } = {}) {
  const eyes = `<rect x="94" y="78" width="24" height="36" rx="11"/><rect x="138" y="78" width="24" height="36" rx="11"/>`;
  const cut = dot ? `<circle cx="206" cy="50" r="62" fill="#000"/>` : "";
  return `<defs><mask id="${id}m" maskUnits="userSpaceOnUse" x="0" y="0" width="256" height="256"><rect width="256" height="256" fill="#fff"/><path d="${MASK}" fill="#000"/><ellipse cx="128" cy="176" rx="56" ry="50" fill="#000"/><g fill="#fff">${eyes}<path d="M104 122H152L128 150Z"/></g>${cut}</mask></defs>
<g fill="${fill}" mask="url(#${id}m)"><path d="${BODY}"/><path d="${FLIPPER}"/><path d="${FLIPPER}" transform="translate(256 0) scale(-1 1)"/><ellipse cx="90" cy="232" rx="30" ry="14"/><ellipse cx="166" cy="232" rx="30" ry="14"/></g>${dot ? `<circle cx="206" cy="50" r="46" fill="#ff9500"/>` : ""}`;
}

export const svg = (inner, vb = 256, title = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb} ${vb}"${title ? ` role="img" aria-labelledby="title"><title id="title">${title}</title>` : ">"}${inner}</svg>\n`;

/** Icono de app: losa oscura con degradado y el pingüino de marca. `bleed` llena el cuadrado (apple-touch). */
export function appIcon({ bleed = false } = {}) {
  const tile = bleed
    ? `<rect width="256" height="256" fill="url(#tile)"/>`
    : `<rect x="10" y="10" width="236" height="236" rx="54" fill="url(#tile)"/><rect x="11" y="11" width="234" height="234" rx="53" fill="none" stroke="#ffffff" stroke-opacity=".1" stroke-width="2"/>`;
  return svg(
    `<defs><linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2a33"/><stop offset="1" stop-color="#090e12"/></linearGradient></defs>${tile}<g transform="translate(40 36) scale(.69)">${penguin({ color: BRAND, eyes: true })}</g>`,
  );
}

const BADGES = {
  art: `<path d="M-22-8L0-20L22-8V14L0 26L-22 14Z" fill="none" stroke="#fff" stroke-width="6" stroke-linejoin="round"/><path d="M-22-8L0 4L22-8M0 4V26" fill="none" stroke="#fff" stroke-width="6" stroke-linejoin="round"/>`,
  app: `<g fill="#fff"><rect x="-23" y="-23" width="20" height="20" rx="5"/><rect x="3" y="-23" width="20" height="20" rx="5"/><rect x="-23" y="3" width="20" height="20" rx="5"/><rect x="3" y="3" width="20" height="20" rx="5"/></g>`,
  ext: `<path d="M-20-12H-7C-9-24 9-24 7-12H20V1C32-1 32 17 20 15V26H-20Z" fill="#fff"/>`,
};

/** Icono de documento: hoja con esquina doblada, pingüino del color del tipo y distintivo. */
export function fileIcon(type, color) {
  const lo = mix(color, "#000000", 0.62);
  const hi = mix(color, "#000000", 0.32);
  return svg(
    `<defs><linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="1" stop-color="${lo}"/></linearGradient><linearGradient id="fd" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${mix(color, "#ffffff", 0.2)}"/><stop offset="1" stop-color="${mix(color, "#ffffff", 0.7)}"/></linearGradient></defs>
<path d="M58 12H164L216 64V222Q216 244 194 244H62Q40 244 40 222V30Q40 12 58 12Z" fill="url(#pg)" stroke="${mix(color, "#ffffff", 0.35)}" stroke-width="3"/>
<path d="M164 12L216 64H178Q164 64 164 50Z" fill="url(#fd)"/>
<g transform="translate(58 62) scale(.55)">${penguin({ color, id: "x", eyes: true })}</g>
<g transform="translate(182 206)"><circle r="33" fill="${color}" stroke="#0b1016" stroke-width="5"/><g transform="scale(.82)">${BADGES[type]}</g></g>`,
  );
}

/** Pancarta: fondo oscuro, marca y fila de pingüinos. */
export function banner(W, H, row) {
  const n = row.length;
  const size = Math.min(H * 0.34, (W * 0.5) / n / 0.72);
  const startX = W * 0.46;
  const step = (W * 0.52) / n;
  const items = row
    .map((b, i) => {
      const y = H * 0.56 + (i % 2 ? -0.05 : 0.03) * H;
      return `<g transform="translate(${startX + i * step} ${y - size / 2}) scale(${size / 256})">${penguin({ color: b.color, kind: b.kind, id: `r${i}`, eyes: true })}</g>`;
    })
    .join("");
  const k = H / 547;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><radialGradient id="bg" cx=".75" cy=".55" r=".9"><stop offset="0" stop-color="#123c37"/><stop offset=".55" stop-color="#0a1a1d"/><stop offset="1" stop-color="#060a0d"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#bg)"/>
<g transform="translate(${70 * k} ${130 * k}) scale(${(110 * k) / 256})">${penguin({ color: BRAND, id: "lg", eyes: true })}</g>
<text x="${200 * k}" y="${222 * k}" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="${92 * k}" fill="#fff">Colonia</text>
<text x="${72 * k}" y="${322 * k}" font-family="Segoe UI, Arial, sans-serif" font-weight="600" font-size="${50 * k}" fill="#7ff0cf">Tu equipo de agentes</text>
<text x="${72 * k}" y="${384 * k}" font-family="Segoe UI, Arial, sans-serif" font-size="${30 * k}" fill="#b9c6cc">en tu ordenador · Ingeniero Binario</text>
${items}</svg>`;
}

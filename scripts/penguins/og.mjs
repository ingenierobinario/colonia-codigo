// Las miniaturas al compartir (Open Graph): 1200×630, una por idioma.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { penguin } from "./art.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sharp = createRequire(path.join(root, "apps/docs/package.json"))("sharp");
const crew = [
  ["#07BB9C", "none"],
  ["#752AF1", "tuft"],
  ["#1064EB", "scarf"],
  ["#EE8912", "bow"],
  ["#E5484D", "crest"],
];
const TEXT = {
  "og-es.jpg": ["Tu propio equipo de", "agentes de IA,", "en tu ordenador.", "Una secretaria y un equipo por proyecto.", "Pago único, con todo el código."],
  "og.jpg": ["Your own team of", "AI agents,", "on your computer.", "A secretary and a team per project.", "One-time payment, full source code."],
};
for (const [file, [a, b, c, s1, s2]] of Object.entries(TEXT)) {
  const row = crew
    .map(([color, kind], i) => {
      const x = i < 3 ? 640 + i * 180 : 730 + (i - 3) * 180;
      const y = i < 3 ? 110 : 330;
      return `<g transform="translate(${x} ${y}) scale(.72)">${penguin({ color, kind, eyes: true, id: `c${i}` })}</g>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef3f8"/><stop offset=".6" stop-color="#d5f3ec"/><stop offset="1" stop-color="#a9ead9"/></linearGradient></defs>
<rect width="1200" height="630" fill="url(#bg)"/>${row}
<g fill="#10151c" font-family="Segoe UI, Arial, sans-serif">
<text x="64" y="104" font-size="30" font-weight="700">Colonia <tspan font-size="24" font-weight="400" fill="#4b5563">· Ingeniero Binario</tspan></text>
<g font-size="56" font-weight="700"><text x="64" y="256">${a}</text><text x="64" y="326">${b}</text><text x="64" y="396">${c}</text></g>
<g font-size="24" fill="#374151"><text x="64" y="466">${s1}</text><text x="64" y="500">${s2}</text></g></g></svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 88, mozjpeg: true }).toFile(path.join(root, "apps/docs/public", file));
}

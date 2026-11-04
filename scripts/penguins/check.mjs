#!/usr/bin/env node
// Comprueba el arte generado: ojos sobre la máscara blanca en todo el recorrido de la mirada, ICO/ICNS legibles y hoja de contacto.
// Uso: node scripts/penguins/check.mjs [ruta-de-la-hoja.png]
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const r = (p) => path.join(root, p);
const sharp = createRequire(r("apps/docs/package.json"))("sharp");
const blobs = JSON.parse(fs.readFileSync(r("apps/docs/src/data/blobs.json"), "utf8"));
const names = Object.keys(blobs);
let bad = 0;
let faces = 0;
for (const name of names) {
  const b = blobs[name];
  const { data } = await sharp(r(`packages/ui/src/blobs/bodies/${name}.webp`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => {
    const i = (Math.round(y / 2) * 128 + Math.round(x / 2)) * 4;
    return [...data.subarray(i, i + 4)];
  };
  let ok = b.eyes.length === 2;
  // Recorrido de BlobEyes.astro: ±9 en horizontal, de -8,5 a +1,5 en vertical.
  for (const e of b.eyes)
    for (const [dx, dy] of [[-9, -8.5], [9, -8.5], [-9, 1.5], [9, 1.5], [0, 0]])
      for (const [x, y] of [[e.x, e.y], [e.x + e.w, e.y], [e.x, e.y + e.h], [e.x + e.w, e.y + e.h]]) {
        const [cr, cg, cb, a] = at(x + dx, y + dy);
        if (a < 250 || Math.min(cr, cg, cb) < 215) {
          ok = false;
          console.log("FUERA", name, x + dx, y + dy, cr, cg, cb, a);
        }
      }
  if (ok) faces++;
  else bad++;
}
console.log(`ojos en la cara: ${faces}/${names.length}`);

let icons = 0;
const want = { ic11: 32, ic12: 64, ic07: 128, ic08: 256, ic13: 256, ic09: 512, ic14: 512, ic10: 1024 };
for (const ext of ["coloniaart", "coloniaapp", "coloniaext"]) {
  const i = fs.readFileSync(r(`apps/desktop/assets/file-${ext}.ico`));
  for (let k = 0; k < i.readUInt16LE(4); k++) {
    const p = 6 + 16 * k;
    const at = i.readUInt32LE(p + 12);
    const m = await sharp(i.subarray(at, at + i.readUInt32LE(p + 8))).metadata();
    if (m.width !== (i[p] || 256)) bad++;
    else icons++;
  }
  const n = fs.readFileSync(r(`apps/desktop/assets/file-${ext}.icns`));
  if (n.readUInt32BE(4) !== n.length) bad++;
  for (let p = 8; p < n.length; p += n.readUInt32BE(p + 4)) {
    const m = await sharp(n.subarray(p + 8, p + n.readUInt32BE(p + 4))).metadata();
    if (m.width !== want[n.toString("latin1", p, p + 4)]) bad++;
    else icons++;
  }
}
console.log(`imágenes ICO/ICNS correctas: ${icons}/45`);
if (icons !== 45) bad++;

const out = process.argv[2];
if (out) {
  const cell = async (n, s) => {
    const body = await sharp(r(`packages/ui/src/blobs/bodies/${n}.webp`)).resize(s, s).png().toBuffer();
    const rects = blobs[n].eyes.map((e) => `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="${e.rx}" fill="${blobs[n].eyeColor}"/>`).join("");
    const eye = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 256 256">${rects}</svg>`)).png().toBuffer();
    return sharp(body).composite([{ input: eye }]).png().toBuffer();
  };
  const W = 1680;
  const layers = [];
  const band = (top, height, color) => layers.push({ input: { create: { width: W, height, channels: 4, background: color } }, top, left: 0 });
  let y = 0;
  const grids = [];
  for (const [color, s] of [["#f5f6f8", 96], ["#10141a", 96], ["#f5f6f8", 24], ["#10141a", 24]]) {
    const step = s + 14;
    const per = Math.floor((W - 12) / step);
    const h = Math.ceil(names.length / per) * (s + 12) + 12;
    band(y, h, color);
    grids.push([s, y, per, step]);
    y += h;
  }
  const H2 = 160;
  band(y, H2, "#f5f6f8");
  band(y + H2, H2, "#10141a");
  const top = [];
  for (const [s, yy, per, step] of grids) {
    let i = 0;
    for (const n of names) {
      top.push({ input: await cell(n, s), left: 12 + (i % per) * step, top: yy + 8 + Math.floor(i / per) * (s + 12) });
      i++;
    }
  }
  const A = "apps/desktop/assets/";
  for (const yy of [y, y + H2]) {
    let x = 12;
    for (const f of ["icon.png", "file-coloniaart.png", "file-coloniaapp.png", "file-coloniaext.png"]) {
      top.push({ input: await sharp(r(A + f)).resize(140, 140).png().toBuffer(), left: x, top: yy + 10 });
      x += 150;
    }
    for (const [f, s] of [["trayTemplate@2x.png", 44], ["trayTemplate.png", 22], ["trayTemplate-attention@2x.png", 44], ["tray-white-attention@2x.png", 44], ["tray-color@2x.png", 44], ["tray-color.png", 22], ["tray-color-attention@2x.png", 44]]) {
      top.push({ input: fs.readFileSync(r(A + f)), left: x, top: yy + 50 });
      x += s + 22;
    }
    for (const s of [16, 32, 64]) {
      top.push({ input: await sharp(r("apps/web/src/assets/favicon.svg"), { density: 400 }).resize(s, s).png().toBuffer(), left: x, top: yy + 50 });
      x += s + 20;
    }
    top.push({ input: await sharp(r("assets/banner.webp")).resize(420).png().toBuffer(), left: x, top: yy + 10 });
  }
  await sharp({ create: { width: W, height: y + 2 * H2, channels: 4, background: "#888888" } }).composite([...layers, ...top]).png().toFile(out);
}
process.exit(bad ? 1 : 0);

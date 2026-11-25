// Original vector companions. Regenerate with node scripts/penguins/animals.mjs.
import { writeFileSync } from "node:fs";

const root = new URL("../../packages/ui/src/blobs/avatars/", import.meta.url);
const animals = {
  fox: ["#d98045", '<path d="M25 39 19 9 45 25M57 25 81 9 76 41"/>'],
  cat: ["#8c96af", '<path d="M25 40 21 12 44 27M58 27 79 12 76 40"/>'],
  dog: ["#b78b66", '<ellipse cx="24" cy="39" rx="13" ry="23"/><ellipse cx="76" cy="39" rx="13" ry="23"/>'],
  rabbit: ["#d6c3ba", '<ellipse cx="36" cy="23" rx="9" ry="22"/><ellipse cx="64" cy="23" rx="9" ry="22"/>'],
  bear: ["#a47b60", '<circle cx="26" cy="27" r="13"/><circle cx="74" cy="27" r="13"/>'],
  frog: ["#73a97e", '<circle cx="31" cy="29" r="13"/><circle cx="69" cy="29" r="13"/>'],
};
for (const [name, [color, ears]] of Object.entries(animals)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>${name}</title><g fill="${color}" stroke="#333b42" stroke-width="2.5" stroke-linejoin="round">${ears}<ellipse cx="50" cy="72" rx="24" ry="23"/><ellipse cx="50" cy="46" rx="31" ry="27"/><ellipse cx="30" cy="91" rx="12" ry="6"/><ellipse cx="70" cy="91" rx="12" ry="6"/></g><ellipse cx="50" cy="76" rx="15" ry="15" fill="#fff2db"/><ellipse cx="50" cy="57" rx="18" ry="12" fill="#fff2db"/><g fill="#28313a"><ellipse cx="37" cy="43" rx="3.5" ry="5"/><ellipse cx="63" cy="43" rx="3.5" ry="5"/><path d="M45 52Q50 48 55 52L50 57Z"/></g><path d="M50 57v4m0 0q-5 5-9 0m9 0q5 5 9 0" fill="none" stroke="#28313a" stroke-width="2" stroke-linecap="round"/><g fill="#fff" opacity=".8"><circle cx="36" cy="41" r="1.2"/><circle cx="62" cy="41" r="1.2"/></g></svg>`;
  writeFileSync(new URL(`${name}.svg`, root), `${svg}\n`);
}

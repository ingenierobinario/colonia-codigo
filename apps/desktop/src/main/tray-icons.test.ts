import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const assets = path.resolve(import.meta.dirname, "../../assets");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

for (const name of ["tray-color", "tray-color-attention"]) {
  test(`${name}.ico holds a PNG entry for every Windows tray size`, () => {
    const file = fs.readFileSync(path.join(assets, `${name}.ico`));
    assert.equal(file.readUInt16LE(0), 0);
    assert.equal(file.readUInt16LE(2), 1, "an icon, not a cursor");
    const count = file.readUInt16LE(4);
    const sizes: number[] = [];
    for (let i = 0; i < count; i++) {
      const at = 6 + 16 * i;
      const size = file.readUInt8(at);
      const length = file.readUInt32LE(at + 8);
      const offset = file.readUInt32LE(at + 12);
      assert.ok(offset + length <= file.length, `${size}px entry inside the file`);
      assert.deepEqual(file.subarray(offset, offset + 8), PNG, `${size}px entry is a PNG`);
      assert.equal(file.readUInt32BE(offset + 16), size, `${size}px entry is ${size}px wide`);
      sizes.push(size);
    }
    assert.deepEqual(sizes, [16, 20, 24, 32, 40, 48]);
  });
}

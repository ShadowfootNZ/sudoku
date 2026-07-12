import assert from 'node:assert/strict';
import { clusterPeaks, findRegularRun, classifyBlank, detectGrid, assessGridQuality } from '../tools/grid-detector.js';

assert.deepEqual(clusterPeaks([0, 4, 8, 3, 0, 7, 7, 0], 4), [2, 6]);
assert.deepEqual(clusterPeaks([9, 9, 9, 0, 0, 8, 8], 5), [1, 6]);
const regular = findRegularRun([10,20,30,40,50,60,70,80,90,100], 50);
assert.deepEqual(regular.lines, [10,20,30,40,50,60,70,80,90,100]);
assert.equal(regular.regularity, 1);
assert.equal(findRegularRun([1, 5, 20], 10), null);

function solid(value) {
  const data = new Uint8ClampedArray(20 * 20 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([value, value, value, 255], i);
  return { width: 20, height: 20, data };
}
assert.equal(classifyBlank(solid(255)).blank, true);
assert.equal(classifyBlank(solid(0)).blank, false);

function grayscaleImage(size, pixel) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const value = pixel(x, y);
    data.set([value, value, value, 255], (y * size + x) * 4);
  }
  return { width: size, height: size, data };
}

// Gradual illumination and fine paper texture should normalize away.
const texturedPaper = grayscaleImage(64, (x, y) => 205 + x * .5 + ((x * 17 + y * 31) % 9));
assert.equal(classifyBlank(texturedPaper).blank, true);

// A central digit-sized stroke must survive that same uneven background.
const printedOne = grayscaleImage(64, (x, y) => {
  const paper = 210 + x * .35 + ((x * 17 + y * 31) % 7);
  return x >= 29 && x <= 34 && y >= 15 && y <= 49 ? 45 : paper;
});
const printedResult = classifyBlank(printedOne);
assert.equal(printedResult.blank, false);
assert.ok(printedResult.componentCount >= 1);

// A pale grid is invisible to the dark-pixel threshold but must be found from edges.
const size = 100;
const pale = new Uint8ClampedArray(size * size * 4).fill(255);
for (let n = 0; n < 10; n++) {
  const p = Math.min(99, 5 + n * 10);
  for (let q = 5; q <= 95; q++) {
    for (const [x, y] of [[p, q], [q, p]]) {
      const i = (y * size + x) * 4;
      pale.set([190, 190, 190, 255], i);
    }
  }
}
const paleResult = detectGrid({ width: size, height: size, data: pale });
assert.ok(paleResult);
assert.equal(paleResult.method, 'axis-aligned-grid-edges');
assert.equal(assessGridQuality({ width: 269, height: 300 }).level, 'reject');
assert.equal(assessGridQuality({ width: 270, height: 300 }).level, 'warning');
assert.equal(assessGridQuality({ width: 450, height: 500 }).level, 'adequate');

console.log('ok - grid detector helpers');

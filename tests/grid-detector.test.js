import assert from 'node:assert/strict';
import { clusterPeaks, findRegularRun, classifyBlank, detectGrid } from '../tools/grid-detector.js';

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

console.log('ok - grid detector helpers');

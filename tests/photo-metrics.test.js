import assert from 'node:assert/strict';
import { normalizeGrid, scorePrediction, summarize } from '../tools/photo-metrics.js';

const grid = '53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79';
assert.equal(normalizeGrid(grid).length, 81);
assert.deepEqual(normalizeGrid('.'.repeat(81)), new Array(81).fill(0));
assert.throws(() => normalizeGrid('123'), /Expected 81 cells/);

const exact = scorePrediction(grid, grid);
assert.equal(exact.cellAccuracy, 1);
assert.equal(exact.exactGrid, true);
const wrong = normalizeGrid(grid);
wrong[0] = 9;
const partial = scorePrediction(grid, wrong);
assert.equal(partial.correct, 80);
assert.equal(partial.exactGrid, false);

const totals = summarize([
  { status: 'complete', totalMs: 30, metrics: exact },
  { status: 'complete', totalMs: 10, metrics: partial },
  { status: 'error', error: 'bad image' },
]);
assert.equal(totals.images, 3);
assert.equal(totals.completed, 2);
assert.equal(totals.exactGrids, 1);
assert.equal(totals.cellAccuracy, 161 / 162);
assert.equal(totals.medianMs, 30);

console.log('ok - photo import metrics');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { infer, normalizeGlyph } from '../tools/mlp-recognizer.js';

const model = JSON.parse(readFileSync(new URL('../models/sudoku-digits-mlp.json', import.meta.url)));
assert.deepEqual(model.input, [1, 16, 16]);
assert.deepEqual(model.classes, [1,2,3,4,5,6,7,8,9]);
assert.equal(model.w1.length, 256);
assert.equal(model.w1[0].length, model.b1.length);
assert.equal(model.w2.length, model.b1.length);
const output = infer(model, [new Array(256).fill(0)]);
assert.equal(output.digits.length, 1);
assert.ok(output.digits[0] >= 1 && output.digits[0] <= 9);
assert.ok(output.confidence[0] > 0 && output.confidence[0] <= 1);

const shifted = new Array(256).fill(0);
shifted[1 * 16 + 1] = 1;
shifted[2 * 16 + 1] = 1;
const normalized = normalizeGlyph(shifted);
assert.equal(normalized.length, 256);
assert.ok(normalized.some(value => value === 1));
assert.equal(normalizeGlyph(new Array(256).fill(0)).every(value => value === 0), true);

console.log('ok - browser-native MLP model contract');

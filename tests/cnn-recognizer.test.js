import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { infer } from '../tools/cnn-recognizer.js';

const model = JSON.parse(readFileSync(new URL('../models/sudoku-digits-cnn-js.json', import.meta.url)));
assert.equal(model.format, 'cnn-js-v1');
assert.deepEqual(model.input, [1,16,16]);
const output = infer(model, [new Array(256).fill(0)], true);
assert.equal(output.digits.length, 1);
assert.ok(output.digits[0] >= 1 && output.digits[0] <= 9);
assert.ok(output.confidence[0] > 0 && output.confidence[0] <= 1);
output.logits[0].forEach((value, index) => {
  assert.ok(Math.abs(value - model.verification.logits[index]) < 1e-4,
    `logit ${index} differs from PyTorch`);
});
console.log('ok - browser-native CNN model contract');

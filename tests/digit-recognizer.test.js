import assert from 'node:assert/strict';
import { meanAbsoluteDistance } from '../tools/digit-recognizer.js';

assert.equal(meanAbsoluteDistance([0, 0, 0], [0, 0, 0]), 0);
assert.equal(meanAbsoluteDistance([0, 0, 0], [1, 1, 1]), 1);
assert.equal(meanAbsoluteDistance([0, .5, 1], [0, 0, 0]), .5);

console.log('ok - digit recognizer metrics');

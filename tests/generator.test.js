// Regression tests for js/generator.js — run with `node tests/generator.test.js`.
// No test framework: plain node:assert checks, exits non-zero on first failure.

import assert from 'node:assert/strict';
import {
  hasConflictingGivens,
  countSolutions,
  solve,
  generateComplete,
  createPuzzle,
} from '../js/generator.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// A known valid, fully-solved board.
const SOLVED = [
  5,3,4,6,7,8,9,1,2,
  6,7,2,1,9,5,3,4,8,
  1,9,8,3,4,2,5,6,7,
  8,5,9,7,6,1,4,2,3,
  4,2,6,8,5,3,7,9,1,
  7,1,3,9,2,4,8,5,6,
  9,6,1,5,3,7,2,8,4,
  2,8,7,4,1,9,6,3,5,
  3,4,5,2,8,6,1,7,9,
];

// Givens that conflict: duplicate 5s in row 0 (indices 0 and 1).
const CONFLICTING = [...SOLVED];
CONFLICTING[1] = CONFLICTING[0];

check('hasConflictingGivens: false for a valid full board', () => {
  assert.equal(hasConflictingGivens(SOLVED), false);
});

check('hasConflictingGivens: false for an empty board', () => {
  assert.equal(hasConflictingGivens(new Array(81).fill(0)), false);
});

check('hasConflictingGivens: true for a duplicate in a row', () => {
  assert.equal(hasConflictingGivens(CONFLICTING), true);
});

check('countSolutions: returns 0 for conflicting givens (previously miscounted as solvable)', () => {
  assert.equal(countSolutions([...CONFLICTING]), 0);
});

check('solve: returns null for conflicting givens (previously returned an invalid board)', () => {
  assert.equal(solve([...CONFLICTING]), null);
});

check('countSolutions: still returns 1 for a fully solved, valid board', () => {
  assert.equal(countSolutions([...SOLVED]), 1);
});

check('solve: still returns the same board for a fully solved, valid board', () => {
  assert.deepEqual(solve([...SOLVED]), SOLVED);
});

check('countSolutions: still finds multiple solutions for an empty board (limit reached)', () => {
  assert.equal(countSolutions(new Array(81).fill(0), 2), 2);
});

check('createPuzzle/countSolutions/solve: a generated puzzle has exactly one solution and solves back to its source', () => {
  const solution = generateComplete();
  const puzzle = createPuzzle(solution, 'medium');
  assert.equal(hasConflictingGivens(puzzle), false);
  assert.equal(countSolutions([...puzzle]), 1);
  assert.deepEqual(solve([...puzzle]), solution);
});

console.log(`\n${passed} passed`);

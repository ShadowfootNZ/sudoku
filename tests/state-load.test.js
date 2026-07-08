// Regression tests for state.load() robustness.
// Run with `node tests/state-load.test.js`.

import assert from 'node:assert/strict';

const store = new Map();

globalThis.localStorage = {
  getItem(key) {
    return store.has(key) ? store.get(key) : null;
  },
  setItem(key, value) {
    store.set(key, String(value));
  },
  removeItem(key) {
    store.delete(key);
  },
};

globalThis.document = {
  listeners: new Map(),
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  },
  removeEventListener(type, fn) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter(listener => listener !== fn));
  },
  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
  },
  documentElement: {
    style: {
      setProperty() {},
    },
  },
};

globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};

const { default: state } = await import('../js/state.js');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const solved = [
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

const empty = new Array(81).fill(0);
const emptyNotes = Array.from({ length: 81 }, () => []);

function savePayload(overrides = {}) {
  const payload = {
    given: [...empty],
    answer: [...empty],
    notes: emptyNotes.map(a => [...a]),
    solution: [...solved],
    difficulty: 'medium',
    notesMode: false,
    hintsUsed: 0,
    hintsPointed: 0,
    errors: 0,
    selected: -1,
    fillOrder: [],
    ...overrides,
  };
  localStorage.setItem('sudoku-save', JSON.stringify(payload));
  return payload;
}

check('load: accepts a complete valid save', () => {
  savePayload({ answer: solved.map((d, i) => i === 0 ? d : 0), notes: emptyNotes.map((a, i) => i === 1 ? [2, 3] : a) });
  assert.equal(state.load(), true);
  assert.equal(state.raw.answer[0], 5);
  assert.deepEqual([...state.raw.notes[1]], [2, 3]);
});

check('load: rejects a save missing answer without mutating state', () => {
  const previousAnswer = state.raw.answer;
  const payload = savePayload();
  delete payload.answer;
  localStorage.setItem('sudoku-save', JSON.stringify(payload));
  assert.equal(state.load(), false);
  assert.equal(state.raw.answer, previousAnswer);
});

check('load: rejects wrong-length board arrays', () => {
  savePayload({ given: new Array(80).fill(0) });
  assert.equal(state.load(), false);

  savePayload({ answer: new Array(82).fill(0) });
  assert.equal(state.load(), false);

  savePayload({ solution: new Array(80).fill(0) });
  assert.equal(state.load(), false);
});

check('load: rejects missing, non-array, or wrong-length notes', () => {
  const payload = savePayload();
  delete payload.notes;
  localStorage.setItem('sudoku-save', JSON.stringify(payload));
  assert.equal(state.load(), false);

  savePayload({ notes: 'not notes' });
  assert.equal(state.load(), false);

  savePayload({ notes: new Array(80).fill([]) });
  assert.equal(state.load(), false);
});

check('load: rejects non-array note entries', () => {
  const notes = emptyNotes.map(a => [...a]);
  notes[12] = 5;
  savePayload({ notes });
  assert.equal(state.load(), false);
});

check('getHint: emits hintstuck when no hint is available', () => {
  let stuck = false;
  const onStuck = () => { stuck = true; };
  document.addEventListener('hintstuck', onStuck);
  state.newGame(solved, solved, 'custom');
  state.getHint();
  document.removeEventListener('hintstuck', onStuck);
  assert.equal(stuck, true);
});

check('completion lock: blocks selection, edits, and undo', () => {
  state.newGame(empty, solved, 'medium');
  state.setValue(0, 5);
  state.setCompleting(true);

  state.selectCell(4);
  state.setValue(1, 3);
  state.clearCell(0);
  state.undo();

  assert.equal(state.selected, -1);
  assert.equal(state.raw.answer[0], 5);
  assert.equal(state.raw.answer[1], 0);

  state.setCompleting(false);
});

check('peek counter: undo does not refund revealed information', () => {
  state.newGame(empty, solved, 'medium');
  state.peekCell(0);
  assert.equal(state.hintsUsed, 1);
  assert.equal(state.raw.answer[0], 5);

  state.undo();
  assert.equal(state.hintsUsed, 1);
  assert.equal(state.raw.answer[0], 0);

  state.redo();
  assert.equal(state.hintsUsed, 1);
  assert.equal(state.raw.answer[0], 5);
});

check('redo availability: canRedo tracks undo and new edits', () => {
  state.newGame(empty, solved, 'medium');
  assert.equal(state.canRedo, false);

  state.setValue(0, 5);
  state.undo();
  assert.equal(state.canRedo, true);

  state.setValue(1, 3);
  assert.equal(state.canRedo, false);
});

console.log(`\n${passed} passed`);

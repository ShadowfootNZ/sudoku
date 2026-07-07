// Game state: board, notes, undo history, localStorage persistence

import { findHint } from './generator.js';
import settings from './settings.js';

const EMPTY = 0;

function buildPeers() {
  return Array.from({ length: 81 }, (_, i) => {
    const row = Math.floor(i / 9), col = i % 9;
    const br = Math.floor(row / 3) * 3, bc = Math.floor(col / 3) * 3;
    const s = new Set();
    for (let c = 0; c < 9; c++) s.add(row * 9 + c);
    for (let r = 0; r < 9; r++) s.add(r * 9 + col);
    for (let r = br; r < br + 3; r++)
      for (let c = bc; c < bc + 3; c++)
        s.add(r * 9 + c);
    s.delete(i);
    return [...s];
  });
}

export const PEERS = buildPeers();

const _s = {
  given:        new Array(81).fill(EMPTY),
  answer:       new Array(81).fill(EMPTY),
  notes:        Array.from({ length: 81 }, () => new Set()),
  solution:     new Array(81).fill(EMPTY),
  selected:     -1,
  hintChain:    null, // ordered array of technique steps from findHint(), or null
  hintStep:     0,    // index into hintChain currently shown by the stepper
  history:      [],
  redoStack:    [],
  notesMode:    false,
  hintsUsed:    0,
  hintsPointed: 0,
  errors:       0,
  difficulty:   'medium',
  fillOrder:    [], // cell indices in the order they were filled by the player
};

function emit(type, detail = {}) {
  document.dispatchEvent(new CustomEvent(type, { detail }));
}

function isConflict(cell, val) {
  return PEERS[cell].some(p => (_s.given[p] || _s.answer[p]) === val);
}

function validCandidates(cell) {
  if (_s.given[cell] || _s.answer[cell]) return new Set();
  const used = new Set(
    PEERS[cell].map(p => _s.given[p] || _s.answer[p]).filter(Boolean)
  );
  const valid = new Set();
  for (let d = 1; d <= 9; d++) if (!used.has(d)) valid.add(d);
  return valid;
}

function pruneAllCandidates() {
  for (let i = 0; i < 81; i++) {
    if (_s.given[i] || _s.answer[i]) continue;
    for (const d of [..._s.notes[i]]) {
      if (isConflict(i, d)) _s.notes[i].delete(d);
    }
  }
}

function snapshot() {
  return {
    answer:      [..._s.answer],
    notes:       _s.notes.map(s => new Set(s)),
    hintChain:   _s.hintChain,
    hintStep:    _s.hintStep,
    hintsUsed:   _s.hintsUsed,
    fillOrder:   [..._s.fillOrder],
  };
}

function restoreSnapshot(snap) {
  _s.answer      = snap.answer;
  _s.notes       = snap.notes;
  _s.hintChain   = snap.hintChain ?? null;
  _s.hintStep    = snap.hintStep ?? 0;
  _s.hintsUsed   = snap.hintsUsed;
  _s.fillOrder   = snap.fillOrder ?? [];
}

// Recorded eliminations are only valid against the exact candidate state they
// were computed from — any board mutation (a value placed/cleared, a note
// edited, an undo/redo) can invalidate them, so every mutator clears the
// whole chain rather than trying to patch it.
function invalidateHint() {
  _s.hintChain = null;
  _s.hintStep  = 0;
}

function pushHistory() {
  _s.history.push(snapshot());
  _s.redoStack = [];
  if (_s.history.length > 200) _s.history.shift();
}

const state = {
  get selected()     { return _s.selected; },
  // Derived from the chain for backward compatibility: the eventual placement
  // cell (last step), and the technique of the step currently shown by the
  // stepper (first step until phase 4's UI lets the player advance it).
  get hintCell()      { return _s.hintChain ? _s.hintChain[_s.hintChain.length - 1].placement.cell : -1; },
  get hintTechnique() { return _s.hintChain ? _s.hintChain[_s.hintStep].type : null; },
  get hintChain()     { return _s.hintChain; },
  get hintStep()      { return _s.hintStep; },
  get hintsUsed()     { return _s.hintsUsed; },
  get hintsPointed()  { return _s.hintsPointed; },
  get errors()        { return _s.errors; },
  get difficulty()   { return _s.difficulty; },
  get notesMode()    { return _s.notesMode; },
  get fillOrder()    { return _s.fillOrder; },
  get raw()          { return _s; },
  PEERS,
  isConflict,

  set notesMode(v)     { _s.notesMode = v;     state.save(); },

  newGame(puzzle, solution, difficulty) {
    _s.given       = [...puzzle];
    _s.answer      = new Array(81).fill(EMPTY);
    _s.notes       = Array.from({ length: 81 }, () => new Set());
    _s.solution    = [...solution];
    _s.selected    = -1;
    invalidateHint();
    _s.history     = [];
    _s.redoStack   = [];
    _s.difficulty  = difficulty;
    _s.hintsUsed    = 0;
    _s.hintsPointed = 0;
    _s.errors       = 0;
    _s.fillOrder    = [];
    state.save();
    emit('statechange', { all: true });
    emit('selectionchange', { cell: -1 });
  },

  resetPuzzle() {
    _s.answer        = new Array(81).fill(EMPTY);
    _s.notes         = Array.from({ length: 81 }, () => new Set());
    invalidateHint();
    _s.history       = [];
    _s.redoStack     = [];
    _s.fillOrder     = [];
    _s.hintsUsed     = 0;
    _s.hintsPointed  = 0;
    _s.errors        = 0;
    state.save();
    emit('statechange', { all: true });
    emit('hintschanged');
    emit('errorschanged');
  },

  selectCell(cell) {
    if (_s.selected === cell) return;
    _s.selected = cell;
    emit('selectionchange', { cell });
  },

  setValue(cell, digit) {
    if (_s.given[cell]) return;
    pushHistory();
    if (settings.conflictCheck && _s.answer[cell] !== digit && isConflict(cell, digit)) {
      _s.errors++;
      emit('errorschanged');
    }
    _s.answer[cell] = digit;
    invalidateHint();
    _s.notes[cell].clear();
    const fo1 = _s.fillOrder.indexOf(cell);
    if (fo1 !== -1) _s.fillOrder.splice(fo1, 1);
    _s.fillOrder.push(cell);
    pruneAllCandidates();
    state.save();
    emit('statechange', { cell });
    if (state.isComplete()) emit('complete');
  },

  clearCell(cell) {
    if (_s.given[cell]) return;
    pushHistory();
    _s.answer[cell] = EMPTY;
    invalidateHint();
    _s.notes[cell].clear();
    const fo2 = _s.fillOrder.indexOf(cell);
    if (fo2 !== -1) _s.fillOrder.splice(fo2, 1);
    pruneAllCandidates();
    state.save();
    emit('statechange', { cell });
  },

  // Intentionally no pushHistory() — see the comment above undo(). Notes are
  // not covered by undo/redo.
  toggleNote(cell, digit) {
    if (_s.given[cell] || _s.answer[cell]) return;
    const notes = _s.notes[cell];
    if (notes.has(digit)) {
      notes.delete(digit);
    } else if (!isConflict(cell, digit)) {
      notes.add(digit);
    }
    invalidateHint();
    state.save();
    emit('statechange', { cell });
  },

  // Intentionally no pushHistory() — see the comment above undo().
  fillCandidates(cell) {
    if (_s.given[cell] || _s.answer[cell]) return;
    _s.notes[cell] = validCandidates(cell);
    invalidateHint();
    state.save();
    emit('statechange', { cell });
  },

  // Intentionally no pushHistory() — see the comment above undo().
  fillAllCandidates() {
    for (let i = 0; i < 81; i++) {
      if (!_s.given[i] && !_s.answer[i]) {
        _s.notes[i] = validCandidates(i);
      }
    }
    invalidateHint();
    state.save();
    emit('statechange', { all: true });
  },

  // Undo/redo only cover answer placements (setValue/clearCell push history).
  // toggleNote/fillCandidates/fillAllCandidates deliberately don't push
  // history: notes are scratch work, not moves to step back through.
  undo() {
    if (!_s.history.length) return;
    _s.redoStack.push(snapshot());
    restoreSnapshot(_s.history.pop());
    pruneAllCandidates();
    state.save();
    emit('statechange', { all: true });
  },

  redo() {
    if (!_s.redoStack.length) return;
    _s.history.push(snapshot());
    restoreSnapshot(_s.redoStack.pop());
    pruneAllCandidates();
    state.save();
    emit('statechange', { all: true });
  },

  getHint() {
    if (_s.hintChain) return;
    const board = _s.given.map((g, i) => g || _s.answer[i]);
    const result = findHint(board, _s.solution);
    if (result.type === 'error') { emit('hinterror'); return; }
    if (result.type === 'stuck') return;
    _s.hintChain = result.steps;
    _s.hintStep  = 0;
    _s.hintsPointed++;
    state.selectCell(state.hintCell);
    state.save();
    emit('statechange', { cell: state.hintCell });
    emit('hintschanged');
  },

  hintStepNext() {
    if (!_s.hintChain || _s.hintStep >= _s.hintChain.length - 1) return;
    _s.hintStep++;
    emit('hintstepchanged');
  },

  hintStepPrev() {
    if (!_s.hintChain || _s.hintStep <= 0) return;
    _s.hintStep--;
    emit('hintstepchanged');
  },

  peekCell(cell) {
    if (_s.given[cell] || _s.answer[cell]) return;
    pushHistory();
    _s.answer[cell] = _s.solution[cell];
    invalidateHint();
    _s.notes[cell].clear();
    const fo3 = _s.fillOrder.indexOf(cell);
    if (fo3 !== -1) _s.fillOrder.splice(fo3, 1);
    _s.fillOrder.push(cell);
    pruneAllCandidates();
    _s.hintsUsed++;
    state.save();
    emit('statechange', { cell });
    emit('hintschanged');
    if (state.isComplete()) emit('complete');
  },

  isComplete() {
    for (let i = 0; i < 81; i++) {
      const val = _s.given[i] || _s.answer[i];
      if (!val || val !== _s.solution[i]) return false;
    }
    return true;
  },

  save() {
    try {
      localStorage.setItem('sudoku-save', JSON.stringify({
        given:         _s.given,
        answer:        _s.answer,
        notes:         _s.notes.map(s => [...s]),
        solution:      _s.solution,
        difficulty:    _s.difficulty,
        notesMode:     _s.notesMode,
        hintsUsed:     _s.hintsUsed,
        hintsPointed:  _s.hintsPointed,
        errors:        _s.errors,
        selected:      _s.selected,
        fillOrder:     _s.fillOrder,
      }));
    } catch (_) {}
  },

  load() {
    try {
      const raw = localStorage.getItem('sudoku-save');
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!Array.isArray(d.given) || !Array.isArray(d.solution)) return false;
      _s.given         = d.given;
      _s.answer        = d.answer;
      _s.notes         = d.notes.map(a => new Set(a));
      _s.solution      = d.solution;
      _s.difficulty    = d.difficulty    ?? 'medium';
      _s.notesMode     = d.notesMode     ?? false;
      _s.hintsUsed     = d.hintsUsed     ?? 0;
      _s.hintsPointed  = d.hintsPointed  ?? 0;
      _s.errors        = d.errors        ?? 0;
      _s.selected      = d.selected      ?? -1;
      _s.fillOrder     = d.fillOrder     ?? [];
      invalidateHint();
      _s.history       = [];
      _s.redoStack     = [];
      return true;
    } catch (_) {
      return false;
    }
  },

  clearSave() {
    localStorage.removeItem('sudoku-save');
  },
};

export default state;

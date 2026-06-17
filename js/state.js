// Game state: board, notes, undo history, localStorage persistence

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
  hintCell:     -1,
  history:      [],
  redoStack:    [],
  notesMode:    false,
  conflictCheck: true,
  hintsUsed:    0,
  difficulty:   'medium',
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
    answer:    [..._s.answer],
    notes:     _s.notes.map(s => new Set(s)),
    hintCell:  _s.hintCell,
    hintsUsed: _s.hintsUsed,
  };
}

function restoreSnapshot(snap) {
  _s.answer    = snap.answer;
  _s.notes     = snap.notes;
  _s.hintCell  = snap.hintCell;
  _s.hintsUsed = snap.hintsUsed;
}

function pushHistory() {
  _s.history.push(snapshot());
  _s.redoStack = [];
  if (_s.history.length > 200) _s.history.shift();
}

const state = {
  get selected()     { return _s.selected; },
  get hintCell()     { return _s.hintCell; },
  get hintsUsed()    { return _s.hintsUsed; },
  get difficulty()   { return _s.difficulty; },
  get notesMode()    { return _s.notesMode; },
  get conflictCheck(){ return _s.conflictCheck; },
  get raw()          { return _s; },
  PEERS,
  isConflict,

  set notesMode(v)     { _s.notesMode = v;     state.save(); },
  set conflictCheck(v) {
    _s.conflictCheck = v;
    state.save();
    emit('statechange', { all: true });
  },

  newGame(puzzle, solution, difficulty) {
    _s.given       = [...puzzle];
    _s.answer      = new Array(81).fill(EMPTY);
    _s.notes       = Array.from({ length: 81 }, () => new Set());
    _s.solution    = [...solution];
    _s.selected    = -1;
    _s.hintCell    = -1;
    _s.history     = [];
    _s.redoStack   = [];
    _s.difficulty  = difficulty;
    _s.hintsUsed   = 0;
    state.save();
    emit('statechange', { all: true });
    emit('selectionchange', { cell: -1 });
  },

  selectCell(cell) {
    if (_s.selected === cell) return;
    _s.selected = cell;
    emit('selectionchange', { cell });
  },

  setValue(cell, digit) {
    if (_s.given[cell]) return;
    pushHistory();
    _s.answer[cell] = digit;
    _s.notes[cell].clear();
    pruneAllCandidates();
    state.save();
    emit('statechange', { cell });
    if (state.isComplete()) emit('complete');
  },

  clearCell(cell) {
    if (_s.given[cell]) return;
    pushHistory();
    _s.answer[cell] = EMPTY;
    _s.notes[cell].clear();
    pruneAllCandidates();
    state.save();
    emit('statechange', { cell });
  },

  toggleNote(cell, digit) {
    if (_s.given[cell] || _s.answer[cell]) return;
    const notes = _s.notes[cell];
    if (notes.has(digit)) {
      notes.delete(digit);
    } else if (!isConflict(cell, digit)) {
      notes.add(digit);
    }
    state.save();
    emit('statechange', { cell });
  },

  fillCandidates(cell) {
    if (_s.given[cell] || _s.answer[cell]) return;
    _s.notes[cell] = validCandidates(cell);
    state.save();
    emit('statechange', { cell });
  },

  fillAllCandidates() {
    for (let i = 0; i < 81; i++) {
      if (!_s.given[i] && !_s.answer[i]) {
        _s.notes[i] = validCandidates(i);
      }
    }
    state.save();
    emit('statechange', { all: true });
  },

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
    // Find naked singles (only one valid candidate)
    const nakeds = [];
    for (let i = 0; i < 81; i++) {
      if (_s.given[i] || _s.answer[i]) continue;
      const cands = validCandidates(i);
      if (cands.size === 1) nakeds.push(i);
    }
    const pool = nakeds.length > 0
      ? nakeds
      : Array.from({ length: 81 }, (_, i) => i)
          .filter(i => !_s.given[i] && !_s.answer[i]);

    if (!pool.length) return;

    if (_s.hintCell !== -1 && pool.includes(_s.hintCell)) {
      // Second tap on already-hinted cell → reveal answer
      pushHistory();
      const val = _s.solution[_s.hintCell];
      _s.answer[_s.hintCell] = val;
      _s.notes[_s.hintCell].clear();
      pruneAllCandidates();
      _s.hintsUsed++;
      const revealed = _s.hintCell;
      _s.hintCell = -1;
      state.save();
      emit('statechange', { cell: revealed });
      emit('hintschanged');
      if (state.isComplete()) emit('complete');
    } else {
      // First tap → point to a constrained cell
      _s.hintCell = pool[Math.floor(Math.random() * pool.length)];
      state.selectCell(_s.hintCell);
      emit('statechange', { cell: _s.hintCell });
    }
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
        conflictCheck: _s.conflictCheck,
        notesMode:     _s.notesMode,
        hintsUsed:     _s.hintsUsed,
        selected:      _s.selected,
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
      _s.conflictCheck = d.conflictCheck ?? true;
      _s.notesMode     = d.notesMode     ?? false;
      _s.hintsUsed     = d.hintsUsed     ?? 0;
      _s.selected      = d.selected      ?? -1;
      _s.hintCell      = -1;
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

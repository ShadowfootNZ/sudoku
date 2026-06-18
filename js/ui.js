// DOM rendering: grid cells and all visual state

import state from './state.js';

let cells = [];

export function buildGrid() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  cells = [];
  for (let i = 0; i < 81; i++) {
    const div = document.createElement('div');
    div.className = 'cell';
    div.dataset.cell = i;
    div.dataset.row  = Math.floor(i / 9);
    div.dataset.col  = i % 9;
    div.setAttribute('role', 'gridcell');
    grid.appendChild(div);
    cells.push(div);
  }
  renderAll();
}

export function renderAll() {
  for (let i = 0; i < 81; i++) renderCell(i);
}

export function renderCell(i) {
  const el = cells[i];
  if (!el) return;
  const s = state.raw;

  // --- Class list ---
  const cls = ['cell'];

  const given  = s.given[i];
  const answer = s.answer[i];
  const notes  = s.notes[i];

  if (given) {
    cls.push('given');
  } else if (answer) {
    cls.push('user');
    if (s.conflictCheck && state.isConflict(i, answer)) cls.push('conflict');
  }

  if (i === s.selected) {
    cls.push('selected');
  } else if (i === s.hintCell) {
    cls.push('hint-cell');
  } else if (s.selected !== -1) {
    const sr = Math.floor(s.selected / 9), sc = s.selected % 9;
    const ir = Math.floor(i / 9),          ic = i % 9;
    const sameBox = Math.floor(sr / 3) === Math.floor(ir / 3) &&
                    Math.floor(sc / 3) === Math.floor(ic / 3);
    if (sr === ir || sc === ic || sameBox) cls.push('peer');

    // Highlight cells sharing the same digit as the selected cell
    const selVal = s.given[s.selected] || s.answer[s.selected];
    const iVal   = given || answer;
    if (selVal && selVal === iVal) cls.push('same-digit');
  }

  el.className = cls.join(' ');

  // --- Content ---
  if (given || answer) {
    el.innerHTML = `<span class="digit">${given || answer}</span>`;
  } else if (notes.size > 0) {
    let html = '<div class="notes-grid">';
    for (let d = 1; d <= 9; d++) {
      html += `<span class="note${notes.has(d) ? ' on' : ''}">${notes.has(d) ? d : ''}</span>`;
    }
    html += '</div>';
    el.innerHTML = html;
  } else {
    el.innerHTML = '';
  }
}

export function renderPeersOf(cell) {
  renderCell(cell);
  state.PEERS[cell].forEach(p => renderCell(p));
  // Also re-render any cell with the same digit (same-digit highlight may change)
  const s = state.raw;
  const val = s.given[cell] || s.answer[cell];
  if (val) {
    for (let i = 0; i < 81; i++) {
      if (i !== cell && (s.given[i] || s.answer[i]) === val) renderCell(i);
    }
  }
}

export function updateNumpad() {
  const s = state.raw;
  const counts = new Array(10).fill(0);
  for (let i = 0; i < 81; i++) {
    const v = s.given[i] || s.answer[i];
    if (v) counts[v]++;
  }
  document.querySelectorAll('.num-btn[data-digit]').forEach(btn => {
    const d = parseInt(btn.dataset.digit, 10);
    const remaining = 9 - counts[d];
    btn.disabled = remaining === 0;
    const remEl = btn.querySelector('.num-remaining');
    if (remEl) remEl.textContent = remaining;
  });
}

export function updateHintsDisplay() {
  const n = state.hintsPointed;
  const el = document.getElementById('hints-display');
  if (el) el.textContent = `${n} ${n === 1 ? 'Hint' : 'Hints'}`;
}

export function updateRevealsDisplay() {
  const el = document.getElementById('reveals-display');
  if (el) el.textContent = `👁${state.hintsUsed}`;
}

export function updateErrorsDisplay() {
  const n = state.errors;
  const el = document.getElementById('errors-display');
  if (el) el.textContent = `${n} ${n === 1 ? 'Error' : 'Errors'}`;
}

export function updateTimerDisplay(ms) {
  const el = document.getElementById('timer-display');
  if (!el) return;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
}

export function updateHintBtn() {
  const btn = document.getElementById('hint-btn');
  if (!btn) return;
  btn.textContent = state.hintCell !== -1 ? '👁 Peek' : '? Hint';
}

export function setNotesModeUI(active) {
  document.getElementById('notes-btn').classList.toggle('active', active);
}

export function setConflictUI(active) {
  document.getElementById('conflict-btn').classList.toggle('active', active);
}

export function showLoading(show) {
  document.getElementById('loading').hidden  = !show;
  document.getElementById('grid').style.visibility = show ? 'hidden' : 'visible';
}

export function showOverlay(dialogId) {
  document.getElementById('overlay').classList.remove('hidden');
  document.getElementById(dialogId).classList.remove('hidden');
}

export function hideOverlay() {
  document.getElementById('overlay').classList.add('hidden');
  document.querySelectorAll('.dialog').forEach(d => d.classList.add('hidden'));
}

export function showComplete() {
  const el = document.getElementById('complete-details');
  el.textContent = state.hintsUsed === 0
    ? 'Solved without any hints!'
    : `Hints used: ${state.hintsUsed}`;
  showOverlay('complete-dialog');
}

export function showResume() {
  showOverlay('resume-dialog');
}

// DOM rendering: grid cells and all visual state

import state from './state.js';
import settings from './settings.js';

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

  // Digit in the selected cell (0 when no selection or selected cell is empty)
  const selVal = s.selected !== -1
    ? (s.given[s.selected] || s.answer[s.selected])
    : 0;

  if (given) {
    cls.push('given');
  } else if (answer) {
    cls.push('user');
    if (settings.conflictCheck && state.isConflict(i, answer)) cls.push('conflict');
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
    if (settings.highlightPeers && (sr === ir || sc === ic || sameBox)) cls.push('peer');

    const iVal = given || answer;
    if (settings.highlightMatches && selVal && selVal === iVal) cls.push('same-digit');

    if (settings.highlightLegal && selVal && !given && !answer && !state.isConflict(i, selVal)) {
      cls.push('legal-entry');
    }
  }

  el.className = cls.join(' ');

  // --- Content ---
  if (given || answer) {
    el.innerHTML = `<span class="digit">${given || answer}</span>`;
  } else if (notes.size > 0) {
    let html = '<div class="notes-grid">';
    for (let d = 1; d <= 9; d++) {
      const on = notes.has(d);
      const hl = settings.highlightMatches && on && selVal === d;
      html += `<span class="note${on ? ' on' : ''}${hl ? ' highlighted' : ''}">${on ? d : ''}</span>`;
    }
    html += '</div>';
    el.innerHTML = html;
  } else {
    el.innerHTML = '';
  }
}

export function renderEntryAll(entryGrid) {
  for (let i = 0; i < 81; i++) {
    const el = cells[i];
    if (!el) continue;
    const digit = entryGrid[i];
    const cls = ['cell'];
    if (digit) {
      cls.push('given');
      if (state.PEERS[i].some(p => entryGrid[p] === digit)) cls.push('conflict');
    }
    if (i === state.raw.selected) cls.push('selected');
    el.className = cls.join(' ');
    el.innerHTML = digit ? `<span class="digit">${digit}</span>` : '';
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
  if (!el) return;
  el.textContent = `🔍${n}`;
  el.hidden = n === 0;
}

export function updateRevealsDisplay() {
  const n = state.hintsUsed;
  const el = document.getElementById('reveals-display');
  if (!el) return;
  el.textContent = `👁${n}`;
  el.hidden = n === 0;
}

export function updateErrorsDisplay() {
  const n = state.errors;
  const el = document.getElementById('errors-display');
  if (!el) return;
  el.textContent = `❌${n}`;
  el.hidden = n === 0;
}

export function updateHintBtn() {
  const btn = document.getElementById('hint-btn');
  if (!btn) return;
  btn.textContent = state.hintCell !== -1 ? '👁 Peek' : '🔍 Hint';
}

const TECHNIQUE_LABELS = {
  'naked-single':  'Naked Single',
  'hidden-single': 'Hidden Single',
  'naked-pair':    'Naked Pair',
  'naked-triple':  'Naked Triple',
  'hidden-pair':   'Hidden Pair',
  'pointing':      'Pointing Pair/Triple',
  'box-line':      'Box-Line Reduction',
  'x-wing':        'X-Wing',
};

let _techniqueDismissed = false;

export function updateHintTechnique() {
  const el = document.getElementById('hint-technique');
  if (!el) return;
  const tech = state.hintTechnique;
  if (!tech) {
    _techniqueDismissed = false;
    el.hidden = true;
    return;
  }
  if (_techniqueDismissed) return;
  const label = settings.showStrategyOnHint ? (TECHNIQUE_LABELS[tech] ?? tech) : null;
  document.getElementById('hint-technique-label').textContent = label ?? '';
  el.hidden = !label;
}

export function dismissHintTechnique() {
  _techniqueDismissed = true;
  const el = document.getElementById('hint-technique');
  if (el) el.hidden = true;
}

export function setNotesModeUI(active) {
  document.getElementById('notes-btn').classList.toggle('active', active);
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
  const fillOrder = state.fillOrder; // oldest fill first
  const n = fillOrder.length;

  // Reverse so the last cell placed flashes first (delay 0)
  const reversed = fillOrder.slice().reverse();
  const maxStagger = n > 1 ? Math.min(600, (n - 1) * 30) : 0;

  reversed.forEach((cellIdx, i) => {
    const el = cells[cellIdx];
    if (!el) return;
    const delay = n > 1 ? Math.round((i / (n - 1)) * maxStagger) : 0;
    el.style.animationDelay = `${delay}ms`;
    el.classList.add('completing');
  });

  const flashDuration = 480; // matches CSS
  setTimeout(() => {
    cells.forEach(el => {
      el.classList.remove('completing');
      el.style.animationDelay = '';
    });
    const detailEl = document.getElementById('complete-details');
    const totalHelp = state.hintsUsed + state.hintsPointed;
    detailEl.textContent = totalHelp === 0
      ? 'Solved without any help!'
      : totalHelp <= 2
        ? 'Solved with a little help'
        : 'Solved with help';
    showOverlay('complete-dialog');
  }, maxStagger + flashDuration + 80);
}

export function showResume() {
  showOverlay('resume-dialog');
}

export function showSettings() {
  showOverlay('settings-dialog');
}

export function showHelp() {
  showOverlay('help-dialog');
}

export function showClearDialog() {
  showOverlay('clear-dialog');
}

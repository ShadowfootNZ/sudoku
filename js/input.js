// Pointer events, palm rejection, Scribble, and keyboard input

import state from './state.js';

let penActive = false;
let penTimer  = null;

function focusScribble() {
  const el = document.getElementById('scribble-input');
  if (el) el.focus({ preventScroll: true });
}

function handleCellSelect(e) {
  const cell = e.target.closest('[data-cell]');
  if (!cell) return;
  state.selectCell(parseInt(cell.dataset.cell, 10));
}

function applyDigit(digit) {
  if (state.selected === -1) return;
  if (state.notesMode) {
    state.toggleNote(state.selected, digit);
  } else {
    state.setValue(state.selected, digit);
  }
}

export function initInput() {
  const grid = document.getElementById('grid');

  // ── Pointer events on grid ──────────────────────────────────────────────
  grid.addEventListener('pointerdown', e => {
    e.preventDefault(); // block text selection + default scroll/zoom

    if (e.pointerType === 'pen') {
      penActive = true;
      clearTimeout(penTimer);
      handleCellSelect(e);
      focusScribble(); // only pen input uses Scribble — keeps keyboard off for finger taps
    } else if (e.pointerType === 'touch') {
      if (!penActive) handleCellSelect(e);
      // else: palm — ignore
    } else {
      handleCellSelect(e); // mouse (desktop testing)
    }
  });

  grid.addEventListener('pointerup', e => {
    if (e.pointerType === 'pen') {
      // Keep penActive true for a short window so a resting palm is ignored
      penTimer = setTimeout(() => { penActive = false; }, 300);
    }
  });

  // Pen hover: highlight cell without selecting
  grid.addEventListener('pointerover', e => {
    if (e.pointerType === 'pen' && !(e.buttons & 1)) {
      document.querySelectorAll('.cell.hover').forEach(c => c.classList.remove('hover'));
      const cell = e.target.closest('[data-cell]');
      if (cell) cell.classList.add('hover');
    }
  });

  grid.addEventListener('pointerleave', () => {
    document.querySelectorAll('.cell.hover').forEach(c => c.classList.remove('hover'));
  });

  // Prevent context menu on long-press (iPadOS)
  grid.addEventListener('contextmenu', e => e.preventDefault());

  // ── Scribble / on-screen keyboard sink ─────────────────────────────────
  const scribble = document.getElementById('scribble-input');

  scribble.addEventListener('input', () => {
    const raw = scribble.value;
    scribble.value = '';
    // Scribble may deliver multi-char strings; take the last digit character
    const digits = raw.replace(/\D/g, '');
    if (!digits) return;
    const d = parseInt(digits[digits.length - 1], 10);
    if (d >= 1 && d <= 9) applyDigit(d);
  });

  scribble.addEventListener('keydown', e => {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      if (state.selected !== -1) state.clearCell(state.selected);
    } else if (e.key === 'ArrowLeft'  && state.selected > 0)  state.selectCell(state.selected - 1);
    else if (e.key === 'ArrowRight' && state.selected < 80) state.selectCell(state.selected + 1);
    else if (e.key === 'ArrowUp'    && state.selected >= 9)  state.selectCell(state.selected - 9);
    else if (e.key === 'ArrowDown'  && state.selected <= 71) state.selectCell(state.selected + 9);
  });

  // ── Global keyboard (desktop convenience) ──────────────────────────────
  document.addEventListener('keydown', e => {
    if (document.activeElement === scribble) return;
    const d = parseInt(e.key, 10);
    if (d >= 1 && d <= 9) {
      applyDigit(d);
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      if (state.selected !== -1) state.clearCell(state.selected);
    } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      state.undo();
    } else if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      state.redo();
    } else if (e.key === 'ArrowLeft'  && state.selected > 0)  state.selectCell(state.selected - 1);
    else if (e.key === 'ArrowRight' && state.selected < 80) state.selectCell(state.selected + 1);
    else if (e.key === 'ArrowUp'    && state.selected >= 9)  state.selectCell(state.selected - 9);
    else if (e.key === 'ArrowDown'  && state.selected <= 71) state.selectCell(state.selected + 9);
  });
}

// Pointer events, palm rejection, Scribble, and keyboard input

import state from './state.js';

let penActive         = false;
let penTimer          = null;
let touchDebounceTimer = null;

// Position the hidden Scribble input over a grid cell so iPadOS Scribble
// activates at the right place on screen, then focus it.
function focusScribble(cellEl) {
  const scribble = document.getElementById('scribble-input');
  if (!scribble) return;
  if (cellEl) {
    const r = cellEl.getBoundingClientRect();
    scribble.style.left   = r.left   + 'px';
    scribble.style.top    = r.top    + 'px';
    scribble.style.width  = r.width  + 'px';
    scribble.style.height = r.height + 'px';
  }
  scribble.focus({ preventScroll: true });
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
      clearTimeout(touchDebounceTimer);
      handleCellSelect(e);
      focusScribble(e.target.closest('[data-cell]'));
    } else if (e.pointerType === 'touch') {
      if (!penActive) {
        // 50 ms debounce: if the pen fires concurrently (palm landing before
        // the tip registers) the penActive flag will be set before this fires.
        clearTimeout(touchDebounceTimer);
        touchDebounceTimer = setTimeout(() => {
          if (!penActive) handleCellSelect(e);
        }, 50);
      }
      // else: penActive — palm contact while pencil is in use, ignore
    } else {
      handleCellSelect(e); // mouse (desktop testing)
    }
  });

  grid.addEventListener('pointerup', e => {
    if (e.pointerType === 'pen') {
      // Keep penActive true for 500 ms after pen lifts so a resting palm
      // that follows can't accidentally select a cell.
      penTimer = setTimeout(() => { penActive = false; }, 500);
    }
  });

  // Pen hover: highlight cell + pre-position Scribble input so it's ready before writing starts
  grid.addEventListener('pointerover', e => {
    if (e.pointerType === 'pen' && !(e.buttons & 1)) {
      document.querySelectorAll('.cell.hover').forEach(c => c.classList.remove('hover'));
      const cell = e.target.closest('[data-cell]');
      if (cell) {
        cell.classList.add('hover');
        focusScribble(cell); // Scribble needs the input on-screen during hover, before pointerdown
      }
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

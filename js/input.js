// Pointer events, palm rejection, Scribble, and keyboard input

import state from './state.js';

let penActive          = false;
let penTimer           = null;
let touchDebounceTimer = null;
let scribbleCell       = -1; // cell index currently under the scribble input

let _handlers = null; // set by app.js in entry mode to redirect digit/delete input

export function setInputHandlers(handlers) {
  _handlers = handlers;
}

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
    scribbleCell = parseInt(cellEl.dataset.cell, 10);
  }
  scribble.focus({ preventScroll: true });
}

function handleCellSelect(e) {
  const cell = e.target.closest('[data-cell]');
  if (!cell) return;
  state.selectCell(parseInt(cell.dataset.cell, 10));
}

function applyDigit(digit) {
  if (_handlers) { _handlers.digit(digit); return; }
  if (state.selected === -1) return;
  if (state.notesMode) {
    state.toggleNote(state.selected, digit);
  } else {
    state.setValue(state.selected, digit);
  }
}

function applyDelete() {
  if (_handlers) { _handlers.delete(); return; }
  if (state.selected !== -1) state.clearCell(state.selected);
}

export function initInput() {
  const grid = document.getElementById('grid');

  // ── Pointer events on grid ──────────────────────────────────────────────
  grid.addEventListener('pointerdown', e => {
    // Don't preventDefault for pen — WKWebView may pass that signal to the OS
    // and suppress Scribble activation. Scroll/zoom prevented by touch-action:none;
    // text selection prevented by user-select:none.
    if (e.pointerType !== 'pen') e.preventDefault();

    if (e.pointerType === 'pen') {
      penActive = true;
      clearTimeout(penTimer);
      clearTimeout(touchDebounceTimer);
      // Capture cell div BEFORE handleCellSelect — that triggers renderAll() which
      // replaces innerHTML of all cells, detaching any child elements (e.g. .digit
      // spans). getBoundingClientRect() on a detached element returns all zeros,
      // which would reposition the scribble input off-screen. The cell div itself
      // survives renderAll(); only its children are replaced.
      const cellEl = e.target.closest('[data-cell]');
      handleCellSelect(e);
      focusScribble(cellEl);
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
    // Scribble may suppress pointerdown (intercepting the gesture), so the cell
    // might not be selected yet. Ensure the cell under the scribble input is selected.
    if (scribbleCell !== -1 && state.selected !== scribbleCell) state.selectCell(scribbleCell);

    const raw = scribble.value;
    scribble.value = '';
    if (!raw) return;

    const digits = raw.replace(/\D/g, '');
    if (!digits) {
      // Non-digit gesture (unrecognized cross-out, slash, etc.) → erase the cell.
      // Note: cross-out strokes are often misread as "1" by Scribble OCR — for reliable
      // deletion use the iPadOS scratch-out gesture (rapid zigzag), which sends Backspace.
      applyDelete();
    } else {
      const d = parseInt(digits[digits.length - 1], 10);
      if (d >= 1 && d <= 9) applyDigit(d);
    }

    // Blur after every Scribble write so iPadOS resets its handwriting session.
    // Without this, Scribble stays in a "used" state and won't capture the next stroke.
    // The next pen hover re-focuses via focusScribble(), giving Scribble a clean start.
    scribble.blur();
  });

  scribble.addEventListener('keydown', e => {
    // Ensure correct cell is selected (same pointerdown-suppression guard as above)
    if (scribbleCell !== -1 && state.selected !== scribbleCell) state.selectCell(scribbleCell);

    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      applyDelete();
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
      applyDelete();
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

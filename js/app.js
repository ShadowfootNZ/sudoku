// Entry point: wires all modules together

import state from './state.js';
import settings from './settings.js';
import {
  buildGrid, renderAll, renderPeersOf, renderEntryAll,
  updateHintsDisplay, updateRevealsDisplay, updateErrorsDisplay,
  updateHintBtn, updateFillBtn, updateHintTechnique, dismissHintTechnique, renderHintStep, updateNumpad, setNotesModeUI,
  showLoading, showComplete, showResume, showSettings, showHelp, showClearDialog, hideOverlay,
} from './ui.js';
import { initInput, setInputHandlers } from './input.js';
import { generateGraded, countSolutions, solve, hasConflictingGivens } from './generator.js';

let inEntryMode = false;
let entryGrid   = new Array(81).fill(0);

function updateEntryNumpad() {
  const counts = new Array(10).fill(0);
  entryGrid.forEach(v => { if (v) counts[v]++; });
  document.querySelectorAll('.num-btn[data-digit]').forEach(btn => {
    const d = parseInt(btn.dataset.digit, 10);
    const remaining = Math.max(0, 9 - counts[d]);
    btn.disabled = remaining === 0;
    const remEl = btn.querySelector('.num-remaining');
    if (remEl) remEl.textContent = remaining;
  });
}

function showEntryError(msg) {
  const el = document.getElementById('entry-error');
  el.textContent = msg;
  el.hidden = false;
}

function enterEntryMode({ preserve = false } = {}) {
  inEntryMode = true;
  if (!preserve) entryGrid = new Array(81).fill(0);
  setInputHandlers({
    digit: d => {
      if (state.selected === -1) return;
      entryGrid[state.selected] = d;
      document.getElementById('entry-error').hidden = true;
      renderEntryAll(entryGrid);
      updateEntryNumpad();
    },
    delete: () => {
      if (state.selected === -1) return;
      entryGrid[state.selected] = 0;
      document.getElementById('entry-error').hidden = true;
      renderEntryAll(entryGrid);
      updateEntryNumpad();
    },
  });
  document.getElementById('mode-controls').hidden  = true;
  document.getElementById('entry-controls').hidden = false;
  document.getElementById('entry-error').hidden    = true;
  updateEntryNumpad();
  renderEntryAll(entryGrid);
}

function exitEntryMode() {
  inEntryMode = false;
  setInputHandlers(null);
  document.getElementById('mode-controls').hidden  = false;
  document.getElementById('entry-controls').hidden = true;
  updateNumpad();
}

function startNewGame(difficulty) {
  hideOverlay();
  state.setCompleting(false);
  if (difficulty === 'custom') {
    enterEntryMode({ preserve: inEntryMode });
    return;
  }
  if (inEntryMode) exitEntryMode();
  showLoading(true);

  // Double rAF ensures the loading screen is painted before generation blocks the thread
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const { puzzle, solution } = generateGraded(difficulty);
      state.newGame(puzzle, solution, difficulty);
      showLoading(false);
      buildGrid();
      updateHintsDisplay();
      updateRevealsDisplay();
      updateErrorsDisplay();
      updateNumpad();
      updateHintBtn();
      updateFillBtn();
      updateHintTechnique();
      setNotesModeUI(state.notesMode);
    });
  });
}

function updateSettingsDialog() {
  document.querySelectorAll('.toggle-btn[data-key]').forEach(btn => {
    const val = settings[btn.dataset.key];
    btn.classList.toggle('active', !!val);
    btn.textContent = val ? 'On' : 'Off';
  });
  document.querySelectorAll('.seg-btn[data-key]').forEach(btn => {
    btn.classList.toggle('active', settings[btn.dataset.key] === btn.dataset.value);
  });
}

function initUndoRedoGesture() {
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-popover-btn');
  const holdMs = 420;
  let holdTimer = null;
  let activePointer = null;
  let popoverOpen = false;
  let suppressClick = false;

  function pointHitsRedo(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return el === redoBtn || redoBtn.contains(el);
  }

  function hideRedo() {
    clearTimeout(holdTimer);
    holdTimer = null;
    popoverOpen = false;
    redoBtn.hidden = true;
    redoBtn.classList.remove('active');
    undoBtn.setAttribute('aria-expanded', 'false');
  }

  function showRedo() {
    if (state.completing || !state.canRedo) return;
    popoverOpen = true;
    suppressClick = true;
    redoBtn.hidden = false;
    undoBtn.setAttribute('aria-expanded', 'true');
  }

  undoBtn.setAttribute('aria-haspopup', 'true');
  undoBtn.setAttribute('aria-expanded', 'false');

  undoBtn.addEventListener('pointerdown', e => {
    if (state.completing) return;
    activePointer = e.pointerId;
    suppressClick = false;
    clearTimeout(holdTimer);
    if (state.canRedo) holdTimer = setTimeout(showRedo, holdMs);
    undoBtn.setPointerCapture?.(e.pointerId);
  });

  undoBtn.addEventListener('pointermove', e => {
    if (e.pointerId !== activePointer || !popoverOpen) return;
    redoBtn.classList.toggle('active', pointHitsRedo(e));
  });

  undoBtn.addEventListener('pointerup', e => {
    if (e.pointerId !== activePointer) return;
    clearTimeout(holdTimer);
    if (popoverOpen) {
      e.preventDefault();
      if (pointHitsRedo(e) && state.canRedo) state.redo();
      suppressClick = true;
    }
    activePointer = null;
    hideRedo();
  });

  undoBtn.addEventListener('pointercancel', () => {
    activePointer = null;
    if (popoverOpen) suppressClick = true;
    hideRedo();
  });

  undoBtn.addEventListener('contextmenu', e => {
    if (popoverOpen || activePointer !== null) e.preventDefault();
  });

  undoBtn.addEventListener('click', e => {
    if (suppressClick) {
      e.preventDefault();
      e.stopPropagation();
      suppressClick = false;
      return;
    }
    if (state.completing) return;
    state.undo();
  });

  redoBtn.addEventListener('click', e => {
    e.preventDefault();
    if (!state.completing && state.canRedo) state.redo();
    hideRedo();
  });

  document.addEventListener('statechange', () => {
    if (popoverOpen && !state.canRedo) hideRedo();
  });
}

function init() {
  settings.load();

  // PWA service worker
  if ('serviceWorker' in navigator) {
    let updateReloadRequested = false;
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        function showUpdateAvailable(sw) {
          document.getElementById('settings-app-group').hidden = false;
          document.getElementById('settings-update-btn').onclick = () => {
            updateReloadRequested = true;
            sw.postMessage('SKIP_WAITING');
          };
        }
        if (reg.waiting) showUpdateAvailable(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) showUpdateAvailable(sw);
          });
        });
      })
      .catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!updateReloadRequested) return;
      state.save();
      location.reload();
    });
  }

  buildGrid();
  initInput();

  // ── State event listeners ─────────────────────────────────────────────

  document.addEventListener('statechange', ({ detail }) => {
    if (detail.all || detail.cell === state.selected) {
      renderAll();
    } else if (detail.cell !== undefined) {
      renderPeersOf(detail.cell);
    }
    updateHintsDisplay();
    updateNumpad();
    updateHintBtn();
    updateFillBtn();
    updateHintTechnique();
  });

  document.addEventListener('selectionchange', () => {
    if (inEntryMode) renderEntryAll(entryGrid);
    else renderAll();
    updateFillBtn();
  });

  document.addEventListener('complete', () => {
    showComplete();
  });
  document.addEventListener('hintschanged',  () => { updateHintsDisplay(); updateRevealsDisplay(); });
  document.addEventListener('hintstepchanged', renderHintStep);
  document.addEventListener('errorschanged', () => updateErrorsDisplay());
  document.addEventListener('settingschange', () => {
    renderAll();
    updateHintTechnique();
  });

  document.addEventListener('hinterror', () => {
    const btn = document.getElementById('hint-btn');
    const prev = btn.textContent;
    btn.textContent = '⚠️ Fix errors';
    setTimeout(() => { btn.textContent = prev; }, 1800);
  });

  document.addEventListener('hintstuck', () => {
    const btn = document.getElementById('hint-btn');
    const prev = btn.textContent;
    btn.textContent = 'No hint found';
    setTimeout(() => { btn.textContent = prev; }, 1800);
  });

  // ── Button wiring ─────────────────────────────────────────────────────

  document.getElementById('new-game-btn').addEventListener('click', () => {
    startNewGame(document.getElementById('difficulty-select').value);
  });

  document.getElementById('notes-btn').addEventListener('click', () => {
    if (state.completing) return;
    state.notesMode = !state.notesMode;
    setNotesModeUI(state.notesMode);
  });

  initUndoRedoGesture();

  document.getElementById('fill-btn').addEventListener('click', () => {
    if (state.completing) return;
    if (state.selected !== -1) state.fillCandidates(state.selected);
    else state.fillAllCandidates();
  });

  document.getElementById('hint-btn').addEventListener('click', () => {
    if (state.completing) return;
    if (state.hintCell !== -1) {
      const cell = state.selected !== -1 ? state.selected : state.hintCell;
      state.peekCell(cell);
    } else {
      state.getHint();
    }
  });

  document.getElementById('settings-btn').addEventListener('click', () => {
    if (state.completing) return;
    updateSettingsDialog();
    showSettings();
  });

  document.getElementById('settings-close-btn').addEventListener('click', () => {
    hideOverlay();
  });

  document.getElementById('settings-reset-btn').addEventListener('click', () => {
    settings.reset();
    updateSettingsDialog();
  });

  document.querySelectorAll('.toggle-btn[data-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.set(btn.dataset.key, !settings[btn.dataset.key]);
      updateSettingsDialog();
    });
  });

  document.querySelectorAll('.seg-btn[data-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.set(btn.dataset.key, btn.dataset.value);
      updateSettingsDialog();
    });
  });

  document.getElementById('delete-btn').addEventListener('click', () => {
    if (state.completing) return;
    if (inEntryMode) {
      const sel = state.selected;
      if (sel !== -1 && entryGrid[sel] !== 0) {
        entryGrid[sel] = 0;
        document.getElementById('entry-error').hidden = true;
        renderEntryAll(entryGrid);
        updateEntryNumpad();
      } else {
        showClearDialog();
      }
      return;
    }
    const sel = state.selected;
    const canDelete = sel !== -1 && !state.raw.given[sel] &&
                      (state.raw.answer[sel] !== 0 || state.raw.notes[sel].size > 0);
    if (!canDelete) { showClearDialog(); return; }
    state.clearCell(sel);
  });

  document.querySelectorAll('.num-btn[data-digit]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.completing) return;
      const d = parseInt(btn.dataset.digit, 10);
      if (inEntryMode) {
        if (state.selected === -1) return;
        entryGrid[state.selected] = d;
        document.getElementById('entry-error').hidden = true;
        renderEntryAll(entryGrid);
        updateEntryNumpad();
        return;
      }
      if (state.selected === -1) return;
      if (state.notesMode) state.toggleNote(state.selected, d);
      else state.setValue(state.selected, d);
    });
  });

  // Resume / discard dialog
  document.getElementById('resume-btn').addEventListener('click', () => {
    hideOverlay();
    buildGrid();
    updateHintsDisplay();
    updateRevealsDisplay();
    updateErrorsDisplay();
    updateNumpad();
    updateHintBtn();
    updateFillBtn();
    updateHintTechnique();
    setNotesModeUI(state.notesMode);
    document.getElementById('difficulty-select').value = state.difficulty;
  });

  document.getElementById('discard-btn').addEventListener('click', () => {
    state.clearSave();
    startNewGame(document.getElementById('difficulty-select').value);
  });

  document.getElementById('play-again-btn').addEventListener('click', () => {
    startNewGame(document.getElementById('difficulty-select').value);
  });

  document.getElementById('hint-technique-close').addEventListener('click', dismissHintTechnique);
  document.getElementById('hint-step-prev').addEventListener('click', () => state.hintStepPrev());
  document.getElementById('hint-step-next').addEventListener('click', () => state.hintStepNext());

  document.getElementById('entry-confirm-btn').addEventListener('click', () => {
    const puzzle = [...entryGrid];

    if (puzzle.every(v => v !== 0)) {
      showEntryError('This puzzle is already complete — leave some cells empty.');
      return;
    }
    if (hasConflictingGivens(puzzle)) {
      showEntryError('Conflicting digits — check rows, columns, and boxes.');
      return;
    }
    const count = countSolutions([...puzzle]);
    if (count === 0) {
      showEntryError('No valid solution — check for conflicting digits.');
      return;
    }
    if (count > 1) {
      showEntryError('Multiple solutions — check for missing or incorrect digits.');
      return;
    }

    const solution = solve([...puzzle]);
    exitEntryMode();
    state.newGame(puzzle, solution, 'custom');
    buildGrid();
    updateHintsDisplay();
    updateRevealsDisplay();
    updateErrorsDisplay();
    updateNumpad();
    updateHintBtn();
    updateFillBtn();
    updateHintTechnique();
    setNotesModeUI(state.notesMode);
  });

  document.getElementById('entry-cancel-btn').addEventListener('click', () => {
    exitEntryMode();
    document.getElementById('difficulty-select').value = state.difficulty;
    renderAll();
    updateNumpad();
  });

  document.getElementById('clear-cancel-btn').addEventListener('click', hideOverlay);

  document.getElementById('clear-confirm-btn').addEventListener('click', () => {
    hideOverlay();
    if (inEntryMode) {
      entryGrid = new Array(81).fill(0);
      document.getElementById('entry-error').hidden = true;
      renderEntryAll(entryGrid);
      updateEntryNumpad();
    } else {
      state.resetPuzzle();
    }
  });

  document.getElementById('help-btn').addEventListener('click', () => {
    if (state.completing) return;
    showHelp();
  });

  document.getElementById('help-close-btn').addEventListener('click', () => {
    hideOverlay();
  });

  // ── Startup ───────────────────────────────────────────────────────────

  if (state.load()) {
    document.getElementById('difficulty-select').value = state.difficulty;
    setNotesModeUI(state.notesMode);
    buildGrid();
    updateHintsDisplay();
    updateRevealsDisplay();
    updateErrorsDisplay();
    updateNumpad();
    updateHintBtn();
    updateFillBtn();
    updateHintTechnique();
    showResume();
  } else {
    startNewGame('medium');
  }
}

document.addEventListener('DOMContentLoaded', init);

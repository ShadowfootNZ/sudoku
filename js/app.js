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

function showEntryError(msg) {
  const el = document.getElementById('entry-error');
  el.textContent = msg;
  el.hidden = false;
}

function enterEntryMode() {
  inEntryMode = true;
  entryGrid   = new Array(81).fill(0);
  setInputHandlers({
    digit: d => {
      if (state.selected === -1) return;
      entryGrid[state.selected] = d;
      document.getElementById('entry-error').hidden = true;
      renderEntryAll(entryGrid);
    },
    delete: () => {
      if (state.selected === -1) return;
      entryGrid[state.selected] = 0;
      document.getElementById('entry-error').hidden = true;
      renderEntryAll(entryGrid);
    },
  });
  document.getElementById('mode-controls').hidden  = true;
  document.getElementById('entry-controls').hidden = false;
  document.getElementById('entry-error').hidden    = true;
  document.querySelectorAll('.num-btn[data-digit]').forEach(btn => btn.disabled = false);
  renderEntryAll(entryGrid);
}

function exitEntryMode() {
  inEntryMode = false;
  setInputHandlers(null);
  document.getElementById('mode-controls').hidden  = false;
  document.getElementById('entry-controls').hidden = true;
}

function startNewGame(difficulty) {
  if (difficulty === 'custom') { enterEntryMode(); return; }
  if (inEntryMode) exitEntryMode();
  hideOverlay();
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

function init() {
  settings.load();

  // PWA service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        function showUpdateAvailable(sw) {
          document.getElementById('settings-app-group').hidden = false;
          document.getElementById('settings-update-btn').onclick = () => sw.postMessage('SKIP_WAITING');
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
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
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

  // ── Button wiring ─────────────────────────────────────────────────────

  document.getElementById('new-game-btn').addEventListener('click', () => {
    startNewGame(document.getElementById('difficulty-select').value);
  });

  document.getElementById('notes-btn').addEventListener('click', () => {
    state.notesMode = !state.notesMode;
    setNotesModeUI(state.notesMode);
  });

  document.getElementById('undo-btn').addEventListener('click', () => state.undo());

  document.getElementById('fill-btn').addEventListener('click', () => {
    if (state.selected !== -1) state.fillCandidates(state.selected);
    else state.fillAllCandidates();
  });

  document.getElementById('hint-btn').addEventListener('click', () => {
    if (state.hintCell !== -1) {
      if (state.selected !== -1) state.peekCell(state.selected);
    } else {
      state.getHint();
    }
  });

  document.getElementById('settings-btn').addEventListener('click', () => {
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
    if (inEntryMode) {
      const sel = state.selected;
      if (sel !== -1 && entryGrid[sel] !== 0) {
        entryGrid[sel] = 0;
        document.getElementById('entry-error').hidden = true;
        renderEntryAll(entryGrid);
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
      const d = parseInt(btn.dataset.digit, 10);
      if (inEntryMode) {
        if (state.selected === -1) return;
        entryGrid[state.selected] = d;
        document.getElementById('entry-error').hidden = true;
        renderEntryAll(entryGrid);
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
    } else {
      state.resetPuzzle();
    }
  });

  document.getElementById('help-btn').addEventListener('click', () => {
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

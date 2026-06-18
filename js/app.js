// Entry point: wires all modules together

import state from './state.js';
import {
  buildGrid, renderAll, renderPeersOf,
  updateHintsDisplay, updateRevealsDisplay, updateErrorsDisplay, updateTimerDisplay,
  updateHintBtn, updateNumpad, setNotesModeUI, setConflictUI,
  showLoading, showComplete, showResume, hideOverlay,
} from './ui.js';
import { initInput } from './input.js';
import { generateComplete, createPuzzle } from './generator.js';

// ── Timer ─────────────────────────────────────────────────────────────────────

let timerElapsed  = 0;    // accumulated ms before the current running segment
let timerStart    = null; // Date.now() when segment started; null when paused
let timerInterval = null;
let gameComplete  = false;

function getElapsedMs() {
  return timerElapsed + (timerStart !== null ? Date.now() - timerStart : 0);
}

function startTimer() {
  if (timerStart !== null || gameComplete) return;
  timerStart = Date.now();
  timerInterval = timerInterval ?? setInterval(() => updateTimerDisplay(getElapsedMs()), 1000);
  updateTimerDisplay(getElapsedMs());
}

function pauseTimer() {
  if (timerStart === null) return;
  timerElapsed += Date.now() - timerStart;
  timerStart = null;
  clearInterval(timerInterval);
  timerInterval = null;
}

function resetTimer() {
  pauseTimer();
  timerElapsed = 0;
  gameComplete  = false;
  try { localStorage.removeItem('sudoku-timer'); } catch (_) {}
  updateTimerDisplay(0);
}

function saveTimer() {
  try { localStorage.setItem('sudoku-timer', getElapsedMs()); } catch (_) {}
}

function loadTimerElapsed() {
  try {
    const v = localStorage.getItem('sudoku-timer');
    timerElapsed = v ? parseInt(v, 10) : 0;
  } catch (_) { timerElapsed = 0; }
}

function startNewGame(difficulty) {
  hideOverlay();
  resetTimer();
  showLoading(true);

  // Double rAF ensures the loading screen is painted before generation blocks the thread
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const solution = generateComplete();
      const puzzle   = createPuzzle(solution, difficulty);
      state.newGame(puzzle, solution, difficulty);
      showLoading(false);
      buildGrid();
      updateHintsDisplay();
      updateRevealsDisplay();
      updateErrorsDisplay();
      updateNumpad();
      updateHintBtn();
      setNotesModeUI(state.notesMode);
      setConflictUI(state.conflictCheck);
      startTimer();
    });
  });
}

function init() {
  // PWA service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  buildGrid();
  initInput();

  // ── State event listeners ─────────────────────────────────────────────

  document.addEventListener('statechange', ({ detail }) => {
    if (detail.all) {
      renderAll();
    } else if (detail.cell !== undefined) {
      renderPeersOf(detail.cell);
    }
    updateHintsDisplay();
    updateNumpad();
    updateHintBtn();
  });

  document.addEventListener('selectionchange', () => {
    renderAll(); // peer/same-digit highlights depend on selection
  });

  document.addEventListener('complete', () => {
    gameComplete = true;
    pauseTimer();
    saveTimer();
    showComplete();
  });
  document.addEventListener('hintschanged',  () => { updateHintsDisplay(); updateRevealsDisplay(); });
  document.addEventListener('errorschanged', () => updateErrorsDisplay());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pauseTimer();
      saveTimer();
    } else {
      startTimer();
    }
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

  document.getElementById('conflict-btn').addEventListener('click', () => {
    state.conflictCheck = !state.conflictCheck;
    setConflictUI(state.conflictCheck);
  });

  document.getElementById('delete-btn').addEventListener('click', () => {
    if (state.selected !== -1) state.clearCell(state.selected);
  });

  document.querySelectorAll('.num-btn[data-digit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = parseInt(btn.dataset.digit, 10);
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
    setNotesModeUI(state.notesMode);
    setConflictUI(state.conflictCheck);
    document.getElementById('difficulty-select').value = state.difficulty;
    loadTimerElapsed();
    updateTimerDisplay(timerElapsed);
    startTimer();
  });

  document.getElementById('discard-btn').addEventListener('click', () => {
    state.clearSave();
    startNewGame(document.getElementById('difficulty-select').value);
  });

  document.getElementById('play-again-btn').addEventListener('click', () => {
    startNewGame(document.getElementById('difficulty-select').value);
  });

  // ── Startup ───────────────────────────────────────────────────────────

  if (state.load()) {
    document.getElementById('difficulty-select').value = state.difficulty;
    setNotesModeUI(state.notesMode);
    setConflictUI(state.conflictCheck);
    buildGrid();
    updateHintsDisplay();
    updateRevealsDisplay();
    updateErrorsDisplay();
    updateNumpad();
    updateHintBtn();
    loadTimerElapsed();
    updateTimerDisplay(timerElapsed);
    showResume();
  } else {
    startNewGame('medium');
  }
}

document.addEventListener('DOMContentLoaded', init);

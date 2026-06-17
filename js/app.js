// Entry point: wires all modules together

import state from './state.js';
import {
  buildGrid, renderAll, renderCell, renderPeersOf,
  updateHintsDisplay, setNotesModeUI, setConflictUI,
  showLoading, showComplete, showResume, hideOverlay,
} from './ui.js';
import { initInput } from './input.js';

let activeWorker = null;

function startNewGame(difficulty) {
  hideOverlay();
  showLoading(true);
  if (activeWorker) { activeWorker.terminate(); activeWorker = null; }

  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  activeWorker = worker;

  worker.onmessage = ({ data: { puzzle, solution } }) => {
    activeWorker = null;
    state.newGame(puzzle, solution, difficulty);
    showLoading(false);
    buildGrid();
    updateHintsDisplay();
    setNotesModeUI(state.notesMode);
    setConflictUI(state.conflictCheck);
  };

  worker.onerror = err => {
    console.error('Worker error:', err);
    showLoading(false);
  };

  worker.postMessage({ difficulty });
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
  });

  document.addEventListener('selectionchange', () => {
    renderAll(); // peer/same-digit highlights depend on selection
  });

  document.addEventListener('complete', () => showComplete());
  document.addEventListener('hintschanged', () => updateHintsDisplay());

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

  document.getElementById('hint-btn').addEventListener('click', () => state.getHint());

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
    setNotesModeUI(state.notesMode);
    setConflictUI(state.conflictCheck);
    document.getElementById('difficulty-select').value = state.difficulty;
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
    showResume();
  } else {
    startNewGame('medium');
  }
}

document.addEventListener('DOMContentLoaded', init);

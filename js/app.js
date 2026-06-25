// Entry point: wires all modules together

import state from './state.js';
import settings from './settings.js';
import {
  buildGrid, renderAll, renderPeersOf,
  updateHintsDisplay, updateRevealsDisplay, updateErrorsDisplay,
  updateHintBtn, updateHintTechnique, dismissHintTechnique, updateNumpad, setNotesModeUI,
  showLoading, showComplete, showResume, showSettings, showHelp, hideOverlay,
} from './ui.js';
import { initInput } from './input.js';
import { generateGraded } from './generator.js';

function startNewGame(difficulty) {
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
    updateHintTechnique();
  });

  document.addEventListener('selectionchange', () => {
    renderAll(); // peer/same-digit highlights depend on selection
  });

  document.addEventListener('complete', () => {
    showComplete();
  });
  document.addEventListener('hintschanged',  () => { updateHintsDisplay(); updateRevealsDisplay(); });
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
    updateHintTechnique();
    showResume();
  } else {
    startNewGame('medium');
  }
}

document.addEventListener('DOMContentLoaded', init);

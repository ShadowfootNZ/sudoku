// Entry point: wires all modules together

import state from './state.js';
import settings from './settings.js';
import {
  buildGrid, renderAll, renderPeersOf, renderEntryAll,
  updateHintsDisplay, updateRevealsDisplay, updateErrorsDisplay,
  updateHintBtn, updateFillBtn, updateHintTechnique, dismissHintTechnique, renderHintStep, updateNumpad, setNotesModeUI,
  showLoading, showComplete, showResume, showSettings, showHelp, showClearDialog, showOverlay, hideOverlay,
} from './ui.js';
import { initInput, setInputHandlers } from './input.js';
import { generateGraded, countSolutions, solve, hasConflictingGivens } from './generator.js';
import { loadPhotoScanner } from './photo-scanner-loader.js';

let inEntryMode = false;
let entryGrid   = new Array(81).fill(0);
let entryReviewCells = new Set();
let cornerEditor = null;
let cropEditor = null;
let photoImportActive = false;

function trackPhotoFeature(event) {
  globalThis.trackAppFeature?.(event);
}

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
  if (!preserve) { entryGrid = new Array(81).fill(0); entryReviewCells = new Set(); }
  setInputHandlers({
    digit: d => {
      if (state.selected === -1) return;
      entryGrid[state.selected] = d;
      entryReviewCells.delete(state.selected);
      document.getElementById('entry-error').hidden = true;
      renderEntryAll(entryGrid, entryReviewCells);
      updateEntryNumpad();
    },
    delete: () => {
      if (state.selected === -1) return;
      entryGrid[state.selected] = 0;
      entryReviewCells.delete(state.selected);
      document.getElementById('entry-error').hidden = true;
      renderEntryAll(entryGrid, entryReviewCells);
      updateEntryNumpad();
    },
  });
  document.getElementById('mode-controls').hidden  = true;
  document.getElementById('entry-controls').hidden = false;
  document.getElementById('entry-error').hidden    = true;
  document.getElementById('entry-instructions').textContent = entryReviewCells.size
    ? 'Review every highlighted digit, correct any mistakes, then tap Confirm.'
    : "Enter the puzzle's given digits, then tap Confirm.";
  updateEntryNumpad();
  renderEntryAll(entryGrid, entryReviewCells);
}

function exitEntryMode() {
  inEntryMode = false;
  setInputHandlers(null);
  document.getElementById('mode-controls').hidden  = false;
  document.getElementById('entry-controls').hidden = true;
  updateNumpad();
}

async function importPhoto(file, corners = null, offerCrop = true, confirmDetectedCorners = false) {
  const button = document.getElementById('photo-import-btn');
  const instructions = document.getElementById('entry-instructions');
  button.disabled = true;
  instructions.textContent = 'Loading photo scanner…';
  try {
    const scanner = await loadPhotoScanner();
    instructions.textContent = 'Finding the grid and reading digits…';
    const result = await scanner.scanPhoto(file, corners, !confirmDetectedCorners || !!corners);
    if (confirmDetectedCorners && !corners) {
      const {boundary,source}=result;
      const proposed=[
        {x:boundary.x/source.width,y:boundary.y/source.height},
        {x:(boundary.x+boundary.width)/source.width,y:boundary.y/source.height},
        {x:(boundary.x+boundary.width)/source.width,y:(boundary.y+boundary.height)/source.height},
        {x:boundary.x/source.width,y:(boundary.y+boundary.height)/source.height},
      ];
      await openCornerEditor(file, '', proposed);
      return;
    }
    entryGrid = [...result.digits];
    entryReviewCells = new Set(result.reviewCells);
    photoImportActive = true;
    renderEntryAll(entryGrid, entryReviewCells);
    updateEntryNumpad();
    instructions.textContent = 'Review every highlighted digit, correct any mistakes, then tap Confirm.';
    document.getElementById('entry-error').hidden = true;
  } catch (error) {
    if (error.reason === 'corners') {
      if (!corners && offerCrop) await openCropEditor(file);
      else await openCornerEditor(file, corners ? error.message : '');
      return;
    }
    showEntryError(error.message || 'The photo could not be scanned. Enter the puzzle manually.');
    instructions.textContent = 'Enter the puzzle manually, or try another photo.';
  } finally {
    button.disabled = false;
  }
}

async function openCropEditor(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const canvas = document.getElementById('photo-crop-canvas');
  const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  cropEditor = { file, bitmap, active:-1, rect:{left:.08,top:.08,right:.92,bottom:.92} };
  drawCropEditor();
  showOverlay('photo-crop-dialog');
}

function drawCropEditor() {
  if (!cropEditor) return;
  const canvas=document.getElementById('photo-crop-canvas'), context=canvas.getContext('2d');
  context.drawImage(cropEditor.bitmap,0,0,canvas.width,canvas.height);
  const {left,top,right,bottom}=cropEditor.rect;
  const x=left*canvas.width,y=top*canvas.height,w=(right-left)*canvas.width,h=(bottom-top)*canvas.height;
  context.fillStyle='rgba(0,0,0,.48)';
  context.fillRect(0,0,canvas.width,y); context.fillRect(0,y,x,h);
  context.fillRect(x+w,y,canvas.width-x-w,h); context.fillRect(0,y+h,canvas.width,canvas.height-y-h);
  context.strokeStyle='#00e5ff'; context.lineWidth=Math.max(3,canvas.width/250); context.strokeRect(x,y,w,h);
  const radius=Math.max(12,canvas.width/50);
  [[x,y],[x+w,y],[x+w,y+h],[x,y+h]].forEach(([cx,cy])=>{
    context.fillStyle='#ff3b30';context.beginPath();context.arc(cx,cy,radius,0,Math.PI*2);context.fill();
  });
}

function closeCropEditor() {
  cropEditor?.bitmap.close(); cropEditor=null; hideOverlay();
}

async function cropPhoto() {
  const {bitmap,rect}=cropEditor;
  const sx=rect.left*bitmap.width, sy=rect.top*bitmap.height;
  const sw=(rect.right-rect.left)*bitmap.width, sh=(rect.bottom-rect.top)*bitmap.height;
  const scale=Math.min(1,1600/Math.max(sw,sh));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(sw*scale)); canvas.height=Math.max(1,Math.round(sh*scale));
  canvas.getContext('2d',{alpha:false}).drawImage(bitmap,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Crop failed.')),'image/jpeg',.92));
}

async function openCornerEditor(file, message = '', proposedCorners = null) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const canvas = document.getElementById('photo-corners-canvas');
  const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const side = Math.min(canvas.width, canvas.height) * .84;
  const left = (canvas.width - side) / 2, top = (canvas.height - side) / 2;
  cornerEditor = {
    file, bitmap, active: -1,
    corners: proposedCorners || [{x:left/canvas.width,y:top/canvas.height},
      {x:(left+side)/canvas.width,y:top/canvas.height},
      {x:(left+side)/canvas.width,y:(top+side)/canvas.height},
      {x:left/canvas.width,y:(top+side)/canvas.height}],
  };
  drawCornerEditor();
  const error = document.getElementById('photo-corners-error');
  error.textContent = message;
  error.hidden = !message;
  showOverlay('photo-corners-dialog');
}

function drawCornerEditor() {
  if (!cornerEditor) return;
  const canvas = document.getElementById('photo-corners-canvas');
  const context = canvas.getContext('2d');
  context.drawImage(cornerEditor.bitmap, 0, 0, canvas.width, canvas.height);
  const points = cornerEditor.corners.map(p => ({x:p.x*canvas.width,y:p.y*canvas.height}));
  context.strokeStyle = '#00e5ff'; context.lineWidth = Math.max(3, canvas.width/250);
  context.beginPath(); points.forEach((p,i)=>i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y));
  context.closePath(); context.stroke();
  const radius = Math.max(13, canvas.width/45);
  points.forEach((point,index) => {
    context.fillStyle='#ff3b30'; context.beginPath(); context.arc(point.x,point.y,radius,0,Math.PI*2); context.fill();
    context.fillStyle='white'; context.font=`600 ${radius}px system-ui`; context.textAlign='center';
    context.textBaseline='middle'; context.fillText(String(index+1),point.x,point.y);
  });
}

function closeCornerEditor() {
  cornerEditor?.bitmap.close();
  cornerEditor = null;
  hideOverlay();
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
    if (inEntryMode) renderEntryAll(entryGrid, entryReviewCells);
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

  const photoInput = document.getElementById('photo-import-input');
  document.getElementById('photo-import-btn').addEventListener('click', () => {
    trackPhotoFeature('photo_import_opened');
    photoInput.value = '';
    photoInput.click();
  });
  photoInput.addEventListener('change', () => {
    if (photoInput.files[0]) importPhoto(photoInput.files[0]);
  });

  const cropCanvas=document.getElementById('photo-crop-canvas');
  const cropPoint=event=>{const rect=cropCanvas.getBoundingClientRect();return {
    x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height};};
  cropCanvas.addEventListener('pointerdown',event=>{
    if(!cropEditor)return;
    const point=cropPoint(event),r=cropEditor.rect;
    const handles=[{x:r.left,y:r.top},{x:r.right,y:r.top},{x:r.right,y:r.bottom},{x:r.left,y:r.bottom}];
    cropEditor.active=handles.reduce((best,p,i)=>Math.hypot(p.x-point.x,p.y-point.y)<
      Math.hypot(handles[best].x-point.x,handles[best].y-point.y)?i:best,0);
    cropCanvas.setPointerCapture(event.pointerId);
  });
  cropCanvas.addEventListener('pointermove',event=>{
    if(!cropEditor||cropEditor.active<0)return;
    const p=cropPoint(event),r=cropEditor.rect,min=.08;
    if(cropEditor.active===0||cropEditor.active===3)r.left=Math.max(0,Math.min(r.right-min,p.x));
    else r.right=Math.min(1,Math.max(r.left+min,p.x));
    if(cropEditor.active===0||cropEditor.active===1)r.top=Math.max(0,Math.min(r.bottom-min,p.y));
    else r.bottom=Math.min(1,Math.max(r.top+min,p.y));
    drawCropEditor();
  });
  const releaseCrop=()=>{if(cropEditor)cropEditor.active=-1;};
  cropCanvas.addEventListener('pointerup',releaseCrop);
  cropCanvas.addEventListener('pointercancel',releaseCrop);
  document.getElementById('photo-crop-cancel').addEventListener('click',()=>{
    closeCropEditor();
    document.getElementById('entry-instructions').textContent='Enter the puzzle manually, or try another photo.';
  });
  document.getElementById('photo-crop-skip').addEventListener('click',()=>{
    if(!cropEditor)return; const file=cropEditor.file; closeCropEditor(); openCornerEditor(file);
  });
  document.getElementById('photo-crop-confirm').addEventListener('click',async()=>{
    if(!cropEditor)return;
    try { const cropped=await cropPhoto(); closeCropEditor(); importPhoto(cropped,null,false,true); }
    catch(error) { showEntryError(error.message); }
  });

  const cornerCanvas = document.getElementById('photo-corners-canvas');
  const cornerPoint = event => {
    const rect = cornerCanvas.getBoundingClientRect();
    return { x:(event.clientX-rect.left)/rect.width, y:(event.clientY-rect.top)/rect.height };
  };
  cornerCanvas.addEventListener('pointerdown', event => {
    if (!cornerEditor) return;
    const point=cornerPoint(event);
    cornerEditor.active=cornerEditor.corners.reduce((best,p,i) =>
      Math.hypot(p.x-point.x,p.y-point.y)<Math.hypot(cornerEditor.corners[best].x-point.x,cornerEditor.corners[best].y-point.y)?i:best,0);
    cornerCanvas.setPointerCapture(event.pointerId);
  });
  cornerCanvas.addEventListener('pointermove', event => {
    if (!cornerEditor || cornerEditor.active<0) return;
    const point=cornerPoint(event);
    cornerEditor.corners[cornerEditor.active]={x:Math.max(0,Math.min(1,point.x)),y:Math.max(0,Math.min(1,point.y))};
    drawCornerEditor();
  });
  const releaseCorner = () => { if (cornerEditor) cornerEditor.active=-1; };
  cornerCanvas.addEventListener('pointerup', releaseCorner);
  cornerCanvas.addEventListener('pointercancel', releaseCorner);
  document.getElementById('photo-corners-cancel').addEventListener('click', () => {
    closeCornerEditor();
    document.getElementById('entry-instructions').textContent = 'Enter the puzzle manually, or try another photo.';
  });
  document.getElementById('photo-corners-confirm').addEventListener('click', () => {
    if (!cornerEditor) return;
    const {file,corners}=cornerEditor;
    closeCornerEditor();
    importPhoto(file,corners);
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
        entryReviewCells.delete(sel);
        document.getElementById('entry-error').hidden = true;
        renderEntryAll(entryGrid, entryReviewCells);
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
        entryReviewCells.delete(state.selected);
        document.getElementById('entry-error').hidden = true;
        renderEntryAll(entryGrid, entryReviewCells);
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
    if (photoImportActive) trackPhotoFeature('photo_import_confirmed');
    photoImportActive = false;
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
    if (photoImportActive) trackPhotoFeature('photo_import_cancelled');
    photoImportActive = false;
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
      entryReviewCells = new Set();
      document.getElementById('entry-error').hidden = true;
      renderEntryAll(entryGrid, entryReviewCells);
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

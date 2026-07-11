import { normalizeGrid, scorePrediction, summarize } from './photo-metrics.js';
import { detectGrid, classifyBlank, assessGridQuality } from './grid-detector.js';
import { recognizeLeaveOneOut } from './digit-recognizer.js';
import { loadMlpRecognizer, normalizeGlyph } from './mlp-recognizer.js';
import { loadCnnRecognizer } from './cnn-recognizer.js';
import { warpPerspective } from './perspective.js';

const imageInput = document.querySelector('#images');
const truthInput = document.querySelector('#ground-truth');
const runButton = document.querySelector('#run');
const exportButton = document.querySelector('#export');
const exportCellsButton = document.querySelector('#export-cells');
const status = document.querySelector('#status');
const summary = document.querySelector('#summary');
const resultsRoot = document.querySelector('#results');
const cornerDialog = document.querySelector('#corner-dialog');
const cornerCanvas = document.querySelector('#corner-canvas');
let truth = {};
let report = null;
let labeledCells = null;
let currentResults = [];
let currentRecognizer = null;
let currentRecognizerName = null;
let cornerState = null;

fetch('../tests/fixtures/photo-import/ground-truth.json')
  .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
  .then(value => {
    truth = value;
    status.textContent = `Loaded built-in ground truth for ${Object.keys(truth).length} image(s). Choose images.`;
  })
  .catch(() => { /* A manually selected file still works on other hosting layouts. */ });

imageInput.addEventListener('change', () => {
  runButton.disabled = imageInput.files.length === 0;
  status.textContent = imageInput.files.length
    ? `${imageInput.files.length} image(s) ready.` : 'Choose at least one image.';
});

truthInput.addEventListener('change', async () => {
  try {
    truth = truthInput.files[0] ? JSON.parse(await truthInput.files[0].text()) : {};
    status.textContent = `Loaded ground truth for ${Object.keys(truth).length} image(s).`;
  } catch (error) {
    truth = {};
    status.textContent = `Ground-truth file is invalid: ${error.message}`;
  }
});

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  exportButton.disabled = true;
  exportCellsButton.disabled = true;
  resultsRoot.replaceChildren();
  const results = [];
  for (const [index, file] of [...imageInput.files].entries()) {
    status.textContent = `Processing ${index + 1} of ${imageInput.files.length}: ${file.name}`;
    try {
      const result = await evaluate(file);
      results.push(result);
    } catch (error) {
      const result = { filename: file.name, status: 'error', error: error.message };
      results.push(result);
    }
  }
  try {
    const recognizer = await loadCnnRecognizer();
    currentRecognizer = recognizer;
    currentRecognizerName = `synthetic-font-cnn-js-v${recognizer.model.version}`;
    for (const result of results) applyModel(result, recognizer);
  } catch (error) {
    console.warn('CNN model unavailable; trying MLP.', error);
    try {
      const recognizer = await loadMlpRecognizer();
      currentRecognizer = recognizer;
      currentRecognizerName = `synthetic-font-mlp-v${recognizer.model.version}`;
      for (const result of results) applyModel(result, recognizer, `synthetic-font-mlp-v${recognizer.model.version}`);
    } catch {
      recognizeLeaveOneOut(results);
    }
  }
  for (const result of results) {
    finalizeResult(result);
    renderResult(result);
  }
  currentResults = results;
  const totals = summarize(results);
  report = { version: 1, createdAt: new Date().toISOString(), totals, results: results.map(stripUrls) };
  labeledCells = buildLabeledCells(results);
  renderSummary(totals);
  status.textContent = `Evaluation complete: ${totals.completed}/${totals.images} images processed.`;
  runButton.disabled = false;
  exportButton.disabled = false;
  exportCellsButton.disabled = labeledCells.samples.length === 0;
});

exportButton.addEventListener('click', () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: 'photo-evaluation.json' });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

exportCellsButton.addEventListener('click', () => {
  if (labeledCells) downloadJson(labeledCells, 'photo-labeled-cells.json');
});

async function evaluate(file, manualCorners = null) {
  const start = performance.now();
  const decodeStart = performance.now();
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const decodeMs = performance.now() - decodeStart;
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const originalUrl = canvas.toDataURL('image/webp', 0.9);
  let pixels = canvas.getContext('2d').getImageData(0, 0, width, height);
  let detected = detectGrid(pixels);
  const side = Math.min(width, height);
  const fallback = { method: 'centered-square-fallback', x: Math.floor((width - side) / 2),
    y: Math.floor((height - side) / 2), width: side, height: side, confidence: 0 };
  let boundary = detected || fallback;
  if (manualCorners) {
    const warped = warpPerspective(pixels, manualCorners, 900);
    canvas.width = canvas.height = 900;
    canvas.getContext('2d', { alpha: false }).putImageData(warped, 0, 0);
    pixels = warped;
    boundary = { method: 'manual-perspective', x: 0, y: 0, width: 899, height: 899, confidence: 1 };
  }
  const quality = assessGridQuality(boundary);
  if (quality.level === 'reject') throw new Error(quality.message);
  const cells = [];
  const features = [];
  const blankPrediction = [];
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const cell = document.createElement('canvas');
      cell.width = cell.height = 64;
      const cellWidth = boundary.width / 9;
      const cellHeight = boundary.height / 9;
      const insetX = cellWidth * 0.08;
      const insetY = cellHeight * 0.08;
      cell.getContext('2d', { alpha: false }).drawImage(
        canvas, boundary.x + col * cellWidth + insetX, boundary.y + row * cellHeight + insetY,
        cellWidth - 2 * insetX, cellHeight - 2 * insetY, 0, 0, 64, 64,
      );
      blankPrediction.push(classifyBlank(cell.getContext('2d').getImageData(0, 0, 64, 64)));
      features.push(extractFeature(cell));
      cells.push(cell.toDataURL('image/webp', 0.8));
    }
  }
  const expected = truth[file.name] ? normalizeGrid(truth[file.name]) : null;
  const predictedOccupancy = blankPrediction.map(item => item.blank ? 0 : 1);
  const expectedOccupancy = expected?.map(value => value ? 1 : 0) ?? null;
  const occupancyMetrics = expected ? scorePrediction(expectedOccupancy, predictedOccupancy) : null;
  const result = {
    filename: file.name, status: 'complete', source: { width, height },
    boundary, quality,
    decodeMs, totalMs: performance.now() - start, expected,
    // No recognizer is selected yet. Predictions intentionally remain absent rather than
    // reporting misleading OCR accuracy for a segmentation-only baseline.
    metrics: occupancyMetrics, metricType: 'occupancy', predictedOccupancy,
    inkRatios: blankPrediction.map(item => item.inkRatio),
    previewUrl: canvas.toDataURL('image/webp', 0.85), cellUrls: cells, _features: features,
    _file: file, _sourcePreviewUrl: originalUrl,
    _initialCorners: boundaryToCorners(detected || fallback),
  };
  return result;
}

function renderResult(result) {
  const article = document.createElement('article');
  article.className = 'panel result';
  if (result.status === 'error') {
    article.innerHTML = `<div><h2></h2><p class="error"></p></div>`;
    article.querySelector('h2').textContent = result.filename;
    article.querySelector('.error').textContent = result.error;
  } else {
    const visual = document.createElement('div');
    visual.innerHTML = '<h2></h2><img class="preview" alt="Decoded source preview">';
    visual.querySelector('h2').textContent = result.filename;
    visual.querySelector('img').src = result.previewUrl;
    const details = document.createElement('div');
    details.innerHTML = `<p>${result.source.width}×${result.source.height}; ${result.boundary.method}
      (${(result.boundary.confidence * 100).toFixed(0)}% confidence); decoded in
      ${result.decodeMs.toFixed(1)} ms; total ${result.totalMs.toFixed(1)} ms.
      ${result.recognizer ? `Digit accuracy ${(result.metrics.cellAccuracy * 100).toFixed(1)}%.` : ''}
      ${result.quality.message}</p>`;
    const grid = document.createElement('div');
    grid.className = 'cells';
    result.cellUrls.forEach((url, index) => {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.innerHTML = `<img alt="Cell ${index + 1}"><span class="prediction"></span>`;
      cell.firstElementChild.src = url;
      const prediction = result.predictedDigits?.[index];
      cell.querySelector('.prediction').textContent = prediction
        ? `${prediction} ${Math.round(result.digitConfidence[index] * 100)}%` : '';
      if (result.expected && prediction !== undefined && prediction !== result.expected[index]) {
        cell.classList.add('incorrect');
      }
      grid.append(cell);
    });
    details.append(grid);
    const adjust = document.createElement('button');
    adjust.type = 'button'; adjust.className = 'adjust-corners'; adjust.textContent = 'Adjust corners';
    adjust.addEventListener('click', () => openCornerEditor(result));
    details.append(adjust);
    visual.append(details);
    article.append(visual);
  }
  resultsRoot.append(article);
}

function renderSummary(totals) {
  summary.hidden = false;
  summary.innerHTML = `<h2>Summary</h2><table>
    <tr><th>Images processed</th><td>${totals.completed}/${totals.images}</td></tr>
    <tr><th>Median total time</th><td>${totals.medianMs?.toFixed(1) ?? '—'} ms</td></tr>
    <tr><th>Grids scored</th><td>${totals.scored}; ${totals.cellAccuracy === null ? '—' : (totals.cellAccuracy * 100).toFixed(1) + '%'} cell accuracy</td></tr>
    <tr><th>Exact grids</th><td>${totals.exactGrids}/${totals.scored}</td></tr>
  </table>`;
}

function stripUrls(result) {
  const { previewUrl, cellUrls, _features, _file, _sourcePreviewUrl, _initialCorners, ...serializable } = result;
  return serializable;
}

function finalizeResult(result) {
  if (result.expected && result.predictedDigits) {
    result.occupancyMetrics = result.metrics;
    result.metrics = scorePrediction(result.expected, result.predictedDigits);
    result.metricType = 'digits';
    result.totalMs += result.recognitionMs;
  }
}

function boundaryToCorners(boundary) {
  return [{x:boundary.x,y:boundary.y}, {x:boundary.x+boundary.width,y:boundary.y},
    {x:boundary.x+boundary.width,y:boundary.y+boundary.height}, {x:boundary.x,y:boundary.y+boundary.height}];
}

function buildLabeledCells(results) {
  const samples = [];
  for (const result of results) {
    if (!result.expected || !result._features) continue;
    // Ground truth is available in this harness, so detector confidence alone must never
    // authorize exporting incorrectly mapped cell crops as training data.
    const trustedSegmentation = result.occupancyMetrics?.exactGrid === true;
    if (!trustedSegmentation) continue;
    result.expected.forEach((digit, cell) => {
      if (digit) samples.push({ fixture: result.filename, cell, digit, feature: result._features[cell] });
    });
  }
  return { version: 1, normalization: 'bbox-12x14-v1', width: 16, height: 16,
    createdAt: new Date().toISOString(), samples };
}

function downloadJson(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function extractFeature(source) {
  const small = document.createElement('canvas');
  small.width = small.height = 16;
  const context = small.getContext('2d', { alpha: false, willReadFrequently: true });
  context.drawImage(source, 0, 0, 16, 16);
  const pixels = context.getImageData(0, 0, 16, 16).data;
  const feature = new Array(256);
  for (let i = 0; i < 256; i++) {
    const p = i * 4;
    const luminance = pixels[p] * .299 + pixels[p + 1] * .587 + pixels[p + 2] * .114;
    feature[i] = (255 - luminance) / 255;
  }
  return normalizeGlyph(feature);
}

function applyModel(result, recognizer, name = `synthetic-font-cnn-js-v${recognizer.model.version}`) {
  if (!result.expected || !result._features) return;
  const occupiedIndexes = result.predictedOccupancy
    .map((occupied, index) => occupied ? index : -1).filter(index => index >= 0);
  const output = recognizer.recognize(occupiedIndexes.map(index => result._features[index]));
  const digits = new Array(81).fill(0);
  const confidence = new Array(81).fill(1);
  occupiedIndexes.forEach((cell, index) => {
    digits[cell] = output.digits[index];
    confidence[cell] = output.confidence[index];
  });
  result.predictedDigits = digits;
  result.digitConfidence = confidence;
  result.recognizer = name;
  result.modelLoadMs = recognizer.loadMs;
  result.recognitionMs = output.recognitionMs;
}

function openCornerEditor(result) {
  const image = new Image();
  image.onload = () => {
    cornerCanvas.width = result.source.width;
    cornerCanvas.height = result.source.height;
    cornerState = { result, image, corners: result._initialCorners.map(point => ({...point})), active: -1 };
    drawCornerEditor();
    cornerDialog.showModal();
  };
  image.src = result._sourcePreviewUrl;
}

function drawCornerEditor() {
  const { image, corners } = cornerState;
  const context = cornerCanvas.getContext('2d');
  context.drawImage(image, 0, 0, cornerCanvas.width, cornerCanvas.height);
  context.strokeStyle = '#00e5ff'; context.lineWidth = Math.max(3, cornerCanvas.width / 300);
  context.fillStyle = '#ff3b30';
  context.beginPath();
  corners.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
  context.closePath(); context.stroke();
  const radius = Math.max(12, cornerCanvas.width / 65);
  corners.forEach((point, index) => {
    context.beginPath(); context.arc(point.x, point.y, radius, 0, Math.PI * 2); context.fill();
    context.fillStyle = 'white'; context.font = `${radius}px system-ui`; context.textAlign = 'center';
    context.textBaseline = 'middle'; context.fillText(String(index + 1), point.x, point.y);
    context.fillStyle = '#ff3b30';
  });
}

function canvasPoint(event) {
  const rect = cornerCanvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * cornerCanvas.width / rect.width,
    y: (event.clientY - rect.top) * cornerCanvas.height / rect.height };
}

cornerCanvas.addEventListener('pointerdown', event => {
  if (!cornerState) return;
  const point = canvasPoint(event);
  let nearest = 0;
  for (let i = 1; i < 4; i++) {
    const distance = p => Math.hypot(p.x - point.x, p.y - point.y);
    if (distance(cornerState.corners[i]) < distance(cornerState.corners[nearest])) nearest = i;
  }
  cornerState.active = nearest;
  cornerCanvas.setPointerCapture?.(event.pointerId);
});

cornerCanvas.addEventListener('pointermove', event => {
  if (!cornerState || cornerState.active < 0) return;
  const point = canvasPoint(event);
  cornerState.corners[cornerState.active] = {
    x: Math.max(0, Math.min(cornerCanvas.width - 1, point.x)),
    y: Math.max(0, Math.min(cornerCanvas.height - 1, point.y)),
  };
  drawCornerEditor();
});

cornerCanvas.addEventListener('pointerup', () => { if (cornerState) cornerState.active = -1; });
cornerCanvas.addEventListener('pointercancel', () => { if (cornerState) cornerState.active = -1; });
document.querySelector('#corner-cancel').addEventListener('click', () => cornerDialog.close());
document.querySelector('#corner-reset').addEventListener('click', () => {
  cornerState.corners = cornerState.result._initialCorners.map(point => ({...point}));
  drawCornerEditor();
});
document.querySelector('#corner-apply').addEventListener('click', async () => {
  const state = cornerState;
  cornerDialog.close();
  status.textContent = `Rectifying ${state.result.filename}…`;
  try {
    const replacement = await evaluate(state.result._file, state.corners);
    if (currentRecognizer) applyModel(replacement, currentRecognizer, currentRecognizerName);
    finalizeResult(replacement);
    const index = currentResults.indexOf(state.result);
    currentResults[index] = replacement;
    resultsRoot.replaceChildren();
    currentResults.forEach(renderResult);
    const totals = summarize(currentResults);
    report = { version: 1, createdAt: new Date().toISOString(), totals,
      results: currentResults.map(stripUrls) };
    labeledCells = buildLabeledCells(currentResults);
    renderSummary(totals);
    exportCellsButton.disabled = labeledCells.samples.length === 0;
    status.textContent = `${replacement.filename} rectified and rescanned.`;
  } catch (error) {
    status.textContent = `Rectification failed: ${error.message}`;
  }
});

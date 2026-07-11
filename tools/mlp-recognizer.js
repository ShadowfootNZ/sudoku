export async function loadMlpRecognizer(url = '../models/sudoku-digits-mlp.json') {
  const started = performance.now();
  const response = await fetch(url, { cache: 'default' });
  if (!response.ok) throw new Error(`Digit model download failed: HTTP ${response.status}`);
  const model = await response.json();
  return { model, loadMs: performance.now() - started, recognize: features => infer(model, features) };
}

export function normalizeGlyph(feature, size = 16, targetWidth = 12, targetHeight = 14) {
  let left = size, top = size, right = -1, bottom = -1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (feature[y * size + x] > 0.10) {
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (right < left) return new Array(size * size).fill(0);
  const sourceWidth = right - left + 1;
  const sourceHeight = bottom - top + 1;
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const offsetX = Math.floor((size - width) / 2);
  const offsetY = Math.floor((size - height) / 2);
  const result = new Array(size * size).fill(0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = left + Math.min(sourceWidth - 1, Math.floor((x + .5) * sourceWidth / width));
    const sy = top + Math.min(sourceHeight - 1, Math.floor((y + .5) * sourceHeight / height));
    result[(offsetY + y) * size + offsetX + x] = feature[sy * size + sx];
  }
  return result;
}

export function infer(model, features) {
  const started = performance.now();
  const digits = [], confidence = [];
  for (const input of features) {
    const hidden = model.b1.map((bias, j) => {
      let value = bias;
      for (let i = 0; i < input.length; i++) value += input[i] * model.w1[i][j];
      return Math.max(0, value);
    });
    const logits = model.b2.map((bias, j) => {
      let value = bias;
      for (let i = 0; i < hidden.length; i++) value += hidden[i] * model.w2[i][j];
      return value;
    });
    const max = Math.max(...logits);
    const exp = logits.map(value => Math.exp(value - max));
    const total = exp.reduce((a, b) => a + b, 0);
    let best = 0;
    for (let i = 1; i < exp.length; i++) if (exp[i] > exp[best]) best = i;
    digits.push(model.classes[best]);
    confidence.push(exp[best] / total);
  }
  return { digits, confidence, recognitionMs: performance.now() - started };
}

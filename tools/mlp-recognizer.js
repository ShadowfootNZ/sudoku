export async function loadMlpRecognizer(url = '../models/sudoku-digits-mlp.json') {
  const started = performance.now();
  const response = await fetch(url, { cache: 'default' });
  if (!response.ok) throw new Error(`Digit model download failed: HTTP ${response.status}`);
  const model = await response.json();
  return { model, loadMs: performance.now() - started, recognize: features => infer(model, features) };
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

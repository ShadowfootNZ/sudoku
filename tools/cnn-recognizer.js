export async function loadCnnRecognizer(url = '../models/sudoku-digits-cnn-js.json') {
  const started = performance.now();
  const response = await fetch(url, { cache: 'default' });
  if (!response.ok) throw new Error(`CNN model download failed: HTTP ${response.status}`);
  const model = await response.json();
  return { model, loadMs: performance.now() - started, recognize: features => infer(model, features) };
}

export function infer(model, features, includeLogits = false) {
  const started = performance.now();
  const t = model.tensors;
  const digits = [], confidence = [], allLogits = [];
  for (const feature of features) {
    let value = convRelu(feature, 1, 16, 16, t['features.0.weight'], t['features.0.bias'], 1);
    value = maxPool(value.data, value.channels, value.height, value.width);
    value = convRelu(value.data, value.channels, value.height, value.width,
      t['features.3.weight'], t['features.3.bias'], 1);
    value = maxPool(value.data, value.channels, value.height, value.width);
    let dense = linearRelu(value.data, t['classifier.1.weight'], t['classifier.1.bias']);
    const logits = linear(dense, t['classifier.3.weight'], t['classifier.3.bias']);
    if (includeLogits) allLogits.push(logits);
    const max = Math.max(...logits);
    const exp = logits.map(item => Math.exp(item - max));
    const total = exp.reduce((a, b) => a + b, 0);
    let best = 0;
    for (let i = 1; i < exp.length; i++) if (exp[i] > exp[best]) best = i;
    digits.push(model.classes[best]);
    confidence.push(exp[best] / total);
  }
  return { digits, confidence, logits: includeLogits ? allLogits : undefined,
    recognitionMs: performance.now() - started };
}

function convRelu(input, inChannels, height, width, weights, biases, padding) {
  const [outChannels,, kh, kw] = weights.shape;
  const output = new Float32Array(outChannels * height * width);
  for (let oc = 0; oc < outChannels; oc++) for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = biases.data[oc];
      for (let ic = 0; ic < inChannels; ic++) for (let ky = 0; ky < kh; ky++) {
        for (let kx = 0; kx < kw; kx++) {
          const iy = y + ky - padding, ix = x + kx - padding;
          if (iy < 0 || iy >= height || ix < 0 || ix >= width) continue;
          const wi = ((oc * inChannels + ic) * kh + ky) * kw + kx;
          sum += input[(ic * height + iy) * width + ix] * weights.data[wi];
        }
      }
      output[(oc * height + y) * width + x] = Math.max(0, sum);
    }
  }
  return { data: output, channels: outChannels, height, width };
}

function maxPool(input, channels, height, width) {
  const oh = Math.floor(height / 2), ow = Math.floor(width / 2);
  const output = new Float32Array(channels * oh * ow);
  for (let c = 0; c < channels; c++) for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    let max = -Infinity;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++)
      max = Math.max(max, input[(c * height + y * 2 + dy) * width + x * 2 + dx]);
    output[(c * oh + y) * ow + x] = max;
  }
  return { data: output, channels, height: oh, width: ow };
}

function linear(input, weights, biases) {
  const [outputs, inputs] = weights.shape;
  const result = new Array(outputs);
  for (let o = 0; o < outputs; o++) {
    let sum = biases.data[o];
    for (let i = 0; i < inputs; i++) sum += input[i] * weights.data[o * inputs + i];
    result[o] = sum;
  }
  return result;
}

function linearRelu(input, weights, biases) {
  return linear(input, weights, biases).map(value => Math.max(0, value));
}

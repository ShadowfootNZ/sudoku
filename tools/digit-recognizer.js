// Phase 0 comparison baseline. Templates are learned from *other* selected fixtures so a
// fixture is never scored against its own cells. Production recognition will implement the
// same { digits, confidence } result contract with a bundled model.

export function recognizeLeaveOneOut(results) {
  for (const target of results) {
    if (!target.expected || !target._features) continue;
    const templates = [];
    for (const source of results) {
      if (source === target || !source.expected || !source._features) continue;
      source.expected.forEach((digit, index) => {
        if (digit && source.predictedOccupancy[index]) {
          templates.push({ digit, feature: source._features[index] });
        }
      });
    }
    if (!templates.length) continue;
    const start = performance.now();
    const digits = [];
    const confidence = [];
    target.predictedOccupancy.forEach((occupied, index) => {
      if (!occupied) {
        digits.push(0);
        confidence.push(1);
        return;
      }
      const ranked = templates.map(template => ({
        digit: template.digit,
        distance: meanAbsoluteDistance(target._features[index], template.feature),
      })).sort((a, b) => a.distance - b.distance);
      const best = ranked[0];
      const different = ranked.find(item => item.digit !== best.digit) || { distance: 1 };
      digits.push(best.digit);
      confidence.push(Math.max(0, Math.min(1, 1 - best.distance / Math.max(different.distance, 0.001))));
    });
    target.predictedDigits = digits;
    target.digitConfidence = confidence;
    target.recognizer = 'leave-one-fixture-out-template';
    target.recognitionMs = performance.now() - start;
  }
  return results;
}

export function meanAbsoluteDistance(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

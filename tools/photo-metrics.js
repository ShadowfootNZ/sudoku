export function normalizeGrid(value) {
  const cells = Array.isArray(value) ? value : String(value).replace(/[^0-9.]/g, '').split('');
  if (cells.length !== 81) throw new Error(`Expected 81 cells, received ${cells.length}`);
  return cells.map(cell => cell === '.' ? 0 : Number(cell));
}

export function scorePrediction(expected, predicted) {
  const truth = normalizeGrid(expected);
  const result = normalizeGrid(predicted);
  let correct = 0;
  let blankCorrect = 0;
  let blankTotal = 0;
  let digitCorrect = 0;
  let digitTotal = 0;
  for (let i = 0; i < 81; i++) {
    if (truth[i] === result[i]) correct++;
    if (truth[i] === 0) {
      blankTotal++;
      if (result[i] === 0) blankCorrect++;
    } else {
      digitTotal++;
      if (truth[i] === result[i]) digitCorrect++;
    }
  }
  return {
    correct,
    total: 81,
    cellAccuracy: correct / 81,
    exactGrid: correct === 81,
    blankAccuracy: blankTotal ? blankCorrect / blankTotal : null,
    digitAccuracy: digitTotal ? digitCorrect / digitTotal : null,
  };
}

export function summarize(results) {
  const timed = results.filter(item => Number.isFinite(item.totalMs));
  const scored = results.filter(item => item.metrics);
  const sortedTimes = timed.map(item => item.totalMs).sort((a, b) => a - b);
  const medianMs = sortedTimes.length ? sortedTimes[Math.floor(sortedTimes.length / 2)] : null;
  return {
    images: results.length,
    completed: results.filter(item => item.status === 'complete').length,
    scored: scored.length,
    exactGrids: scored.filter(item => item.metrics.exactGrid).length,
    cellAccuracy: scored.length
      ? scored.reduce((sum, item) => sum + item.metrics.correct, 0) / (scored.length * 81)
      : null,
    medianMs,
  };
}

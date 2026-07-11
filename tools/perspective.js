// Perspective mapping helpers shared by the Phase 0 harness and eventual scanner.

export function solveProjection(destination, source) {
  if (destination.length !== 4 || source.length !== 4) throw new Error('Four corners required');
  const matrix = [], values = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = destination[i];
    const { x, y } = source[i];
    matrix.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); values.push(x);
    matrix.push([0, 0, 0, u, v, 1, -u * y, -v * y]); values.push(y);
  }
  const [a,b,c,d,e,f,g,h] = gaussianSolve(matrix, values);
  return { a,b,c,d,e,f,g,h };
}

export function projectPoint(transform, u, v) {
  const denominator = transform.g * u + transform.h * v + 1;
  return {
    x: (transform.a * u + transform.b * v + transform.c) / denominator,
    y: (transform.d * u + transform.e * v + transform.f) / denominator,
  };
}

export function warpPerspective(sourceImageData, corners, outputSize = 900) {
  const destination = [{x:0,y:0}, {x:outputSize-1,y:0},
    {x:outputSize-1,y:outputSize-1}, {x:0,y:outputSize-1}];
  const transform = solveProjection(destination, corners);
  const output = new ImageData(outputSize, outputSize);
  const { width, height, data } = sourceImageData;
  for (let y = 0; y < outputSize; y++) for (let x = 0; x < outputSize; x++) {
    const source = projectPoint(transform, x, y);
    const sx = Math.max(0, Math.min(width - 1, Math.round(source.x)));
    const sy = Math.max(0, Math.min(height - 1, Math.round(source.y)));
    const from = (sy * width + sx) * 4;
    const to = (y * outputSize + x) * 4;
    output.data[to] = data[from]; output.data[to + 1] = data[from + 1];
    output.data[to + 2] = data[from + 2]; output.data[to + 3] = data[from + 3];
  }
  return output;
}

function gaussianSolve(matrix, values) {
  const n = values.length;
  const rows = matrix.map((row, i) => [...row, values[i]]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++)
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    if (Math.abs(rows[pivot][column]) < 1e-10) throw new Error('Degenerate corner selection');
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let j = column; j <= n; j++) rows[column][j] /= divisor;
    for (let row = 0; row < n; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let j = column; j <= n; j++) rows[row][j] -= factor * rows[column][j];
    }
  }
  return rows.map(row => row[n]);
}

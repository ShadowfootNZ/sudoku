// Dependency-free Phase 0 baseline for clean, nearly axis-aligned Sudoku grids.

export function clusterPeaks(values, threshold) {
  const peaks = [];
  let start = -1;
  for (let i = 0; i <= values.length; i++) {
    if (i < values.length && values[i] >= threshold) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      // Use the weighted centre of a thick line. Picking its darkest edge shifts all
      // subsequent cell crops on low-resolution grids with 5–8px outer borders.
      let weighted = 0;
      let weight = 0;
      for (let j = start; j < i; j++) {
        const excess = values[j] - threshold + 1;
        weighted += j * excess;
        weight += excess;
      }
      peaks.push(Math.round(weighted / weight));
      start = -1;
    }
  }
  return peaks;
}

export function findRegularRun(peaks, minSpan) {
  let best = null;
  for (let a = 0; a < peaks.length; a++) {
    for (let b = a + 9; b < peaks.length; b++) {
      const span = peaks[b] - peaks[a];
      if (span < minSpan) continue;
      const step = span / 9;
      const matched = [];
      let error = 0;
      for (let n = 0; n < 10; n++) {
        const target = peaks[a] + n * step;
        let nearest = peaks[a];
        for (const peak of peaks) if (Math.abs(peak - target) < Math.abs(nearest - target)) nearest = peak;
        matched.push(nearest);
        error += Math.abs(nearest - target) / step;
      }
      if (new Set(matched).size !== 10) continue;
      const regularity = Math.max(0, 1 - error / 10);
      const candidate = { start: matched[0], end: matched[9], lines: matched, regularity };
      if (!best || regularity * span > best.regularity * (best.end - best.start)) best = candidate;
    }
  }
  return best;
}

export function detectGrid(imageData) {
  const { width, height, data } = imageData;
  const rowInk = new Float64Array(height);
  const colInk = new Float64Array(width);
  const rowEdge = new Float64Array(height);
  const colEdge = new Float64Array(width);
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const luminance = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      gray[y * width + x] = luminance;
      const ink = luminance < 115 ? 1 : 0;
      rowInk[y] += ink;
      colInk[x] += ink;
    }
  }
  for (let y = 1; y < height; y++) {
    for (let x = 1; x < width; x++) {
      const here = gray[y * width + x];
      rowEdge[y] += Math.abs(here - gray[(y - 1) * width + x]);
      colEdge[x] += Math.abs(here - gray[y * width + x - 1]);
    }
  }
  const rowMax = Math.max(...rowInk);
  const colMax = Math.max(...colInk);
  const rows = clusterPeaks(rowInk, Math.max(width * 0.18, rowMax * 0.35));
  const cols = clusterPeaks(colInk, Math.max(height * 0.18, colMax * 0.35));
  let horizontal = findRegularRun(rows, height * 0.35);
  let vertical = findRegularRun(cols, width * 0.35);
  let method = 'axis-aligned-grid-lines';
  if (!horizontal || !vertical) {
    // Light UI grids may have no dark internal lines. Directional brightness changes still
    // form ten strong, regularly-spaced projections. Smooth them so both edges of a thick
    // line become one peak rather than two competing candidates.
    const smoothRows = smooth(rowEdge, 3);
    const smoothCols = smooth(colEdge, 3);
    horizontal = findRegularRun(clusterPeaks(smoothRows, Math.max(...smoothRows) * 0.22), height * 0.35);
    vertical = findRegularRun(clusterPeaks(smoothCols, Math.max(...smoothCols) * 0.22), width * 0.35);
    method = 'axis-aligned-grid-edges';
  }
  if (!horizontal || !vertical) return null;
  const gridWidth = vertical.end - vertical.start;
  const gridHeight = horizontal.end - horizontal.start;
  const aspect = gridWidth / gridHeight;
  const aspectScore = Math.max(0, 1 - Math.abs(Math.log(aspect)) / Math.log(1.5));
  const confidence = horizontal.regularity * vertical.regularity * aspectScore;
  if (confidence < 0.55) return null;
  return {
    method, x: vertical.start, y: horizontal.start,
    width: gridWidth, height: gridHeight, rows: horizontal.lines, cols: vertical.lines,
    confidence,
  };
}

function smooth(values, radius) {
  const result = new Float64Array(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i - radius - 1 >= 0) sum -= values[i - radius - 1];
    result[Math.max(0, i - Math.floor(radius / 2))] = sum / Math.min(radius + 1, i + 1);
  }
  return result;
}

export function classifyBlank(imageData) {
  const { width, height, data } = imageData;
  const gray = new Float32Array(width * height);
  let mean = 0;
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4;
    gray[i] = data[p] * .299 + data[p + 1] * .587 + data[p + 2] * .114;
    mean += gray[i];
  }
  mean /= gray.length;

  // A broad local mean models uneven lighting and paper texture. Subtracting it leaves
  // compact dark strokes while suppressing gradual shadows and mottled newsprint.
  const background = boxMean(gray, width, height, Math.max(3, Math.round(Math.min(width, height) * .12)));
  const mask = new Uint8Array(width * height);
  let ink = 0;
  const marginX = Math.floor(width * .16);
  const marginY = Math.floor(height * .16);
  for (let y = marginY; y < height - marginY; y++) {
    for (let x = marginX; x < width - marginX; x++) {
      const i = y * width + x;
      // Absolute darkness prevents bright compression noise becoming foreground.
      if (background[i] - gray[i] >= 24 && gray[i] < 205) {
        mask[i] = 1;
        ink++;
      }
    }
  }

  const components = connectedComponents(mask, width, height);
  const plausible = components.filter(component => {
    const componentWidth = component.maxX - component.minX + 1;
    const componentHeight = component.maxY - component.minY + 1;
    const centreX = (component.minX + component.maxX) / 2;
    const centreY = (component.minY + component.maxY) / 2;
    // Newspaper evaluation found texture specks of 16–22px while the smallest genuine
    // 64px-cell digit component was 181px. Keep a generous gap below real strokes.
    return component.area >= Math.max(12, width * height * .025)
      && componentHeight >= height * .18
      && componentWidth >= width * .045
      && centreX > width * .22 && centreX < width * .78
      && centreY > height * .18 && centreY < height * .82;
  });
  const largest = plausible.reduce((best, item) => Math.max(best, item.area), 0);
  const samples = Math.max(1, (width - 2 * marginX) * (height - 2 * marginY));
  const inkRatio = ink / samples;
  // Retain sensible behaviour for uniformly dark/failed crops, which background
  // subtraction intentionally removes. Such a crop is never safe to call blank.
  const darkCrop = mean < 80;
  return {
    blank: !darkCrop && plausible.length === 0,
    inkRatio,
    normalizedInkRatio: inkRatio,
    componentCount: plausible.length,
    largestComponentArea: largest,
    meanLuminance: mean,
  };
}

function boxMean(values, width, height, radius) {
  const integralWidth = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += values[y * width + x];
      integral[(y + 1) * integralWidth + x + 1] = integral[y * integralWidth + x + 1] + row;
    }
  }
  const result = new Float32Array(values.length);
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const sum = integral[(bottom + 1) * integralWidth + right + 1]
        - integral[top * integralWidth + right + 1]
        - integral[(bottom + 1) * integralWidth + left]
        + integral[top * integralWidth + left];
      result[y * width + x] = sum / ((right - left + 1) * (bottom - top + 1));
    }
  }
  return result;
}

function connectedComponents(mask, width, height) {
  const components = [];
  const queue = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1) continue;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    mask[start] = 2;
    let area = 0;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      area++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const neighbour = ny * width + nx;
        if (mask[neighbour] === 1) {
          mask[neighbour] = 2;
          queue[tail++] = neighbour;
        }
      }
    }
    components.push({ area, minX, minY, maxX, maxY });
  }
  return components;
}

export function assessGridQuality(boundary) {
  const pixelsPerCell = Math.min(boundary.width, boundary.height) / 9;
  if (pixelsPerCell < 30) return { level: 'reject', pixelsPerCell,
    message: 'This image is too small or unclear to read reliably. Try a closer, sharper photo.' };
  if (pixelsPerCell < 50) return { level: 'warning', pixelsPerCell,
    message: 'This image may be difficult to read. Review every detected digit carefully.' };
  return { level: 'adequate', pixelsPerCell, message: '' };
}

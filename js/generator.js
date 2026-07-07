// Sudoku generator: backtracking solver + puzzle maker
// Loaded inside a Web Worker — no DOM access.

const EMPTY = 0;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Pre-compute peer indices for all 81 cells
function buildPeers() {
  return Array.from({ length: 81 }, (_, i) => {
    const row = Math.floor(i / 9), col = i % 9;
    const br = Math.floor(row / 3) * 3, bc = Math.floor(col / 3) * 3;
    const s = new Set();
    for (let c = 0; c < 9; c++) s.add(row * 9 + c);
    for (let r = 0; r < 9; r++) s.add(r * 9 + col);
    for (let r = br; r < br + 3; r++)
      for (let c = bc; c < bc + 3; c++)
        s.add(r * 9 + c);
    s.delete(i);
    return [...s];
  });
}

export const PEERS = buildPeers();

export function isValid(board, i, val) {
  return PEERS[i].every(p => board[p] !== val);
}

// 27 units: [0-8]=rows, [9-17]=cols, [18-26]=boxes
const UNITS = (() => {
  const us = [];
  for (let r = 0; r < 9; r++) {
    const u = []; for (let c = 0; c < 9; c++) u.push(r * 9 + c); us.push(u);
  }
  for (let c = 0; c < 9; c++) {
    const u = []; for (let r = 0; r < 9; r++) u.push(r * 9 + c); us.push(u);
  }
  for (let br = 0; br < 3; br++) for (let bc = 0; bc < 3; bc++) {
    const u = [];
    for (let r = br * 3; r < br * 3 + 3; r++)
      for (let c = bc * 3; c < bc * 3 + 3; c++) u.push(r * 9 + c);
    us.push(u);
  }
  return us;
})();

// countSolutions()/solve() only validate digits placed into empty cells during
// backtracking, so a puzzle whose *givens* already conflict (e.g. two 5s in a
// row) would otherwise sail through as "uniquely solvable". Custom puzzle entry
// must run this first.
export function hasConflictingGivens(board) {
  return UNITS.some(unit => {
    const seen = new Set();
    for (const i of unit) {
      const v = board[i];
      if (v === EMPTY) continue;
      if (seen.has(v)) return true;
      seen.add(v);
    }
    return false;
  });
}

const cellRow = i => Math.floor(i / 9);
const cellCol = i => i % 9;
const cellBox = i => Math.floor(Math.floor(i / 9) / 3) * 3 + Math.floor((i % 9) / 3);

// Difficulty ranking shared by the grader and the digger, plus the minimum
// clue count each tier is allowed to dig down to (17 is the proven floor for
// any uniquely-solvable Sudoku).
const GRADE_ORDER = { easy: 0, medium: 1, hard: 2, veryhard: 3 };
const GRADE_NAMES = ['easy', 'medium', 'hard', 'veryhard'];
const CLUE_FLOOR = { easy: 36, medium: 30, hard: 24, veryhard: 17 };

// Fill board with a random valid solution via backtracking
function solveRandom(board) {
  const idx = board.indexOf(EMPTY);
  if (idx === -1) return true;
  for (const d of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
    if (isValid(board, idx, d)) {
      board[idx] = d;
      if (solveRandom(board)) return true;
      board[idx] = EMPTY;
    }
  }
  return false;
}

// Count solutions up to `limit` using MRV heuristic (fast uniqueness check)
export function countSolutions(board, limit = 2) {
  let bestIdx = -1, bestLen = 10;
  for (let i = 0; i < 81; i++) {
    if (board[i] !== EMPTY) continue;
    let len = 0;
    for (let d = 1; d <= 9; d++) {
      if (isValid(board, i, d)) {
        if (++len >= bestLen) break;
      }
    }
    if (len === 0) return 0;
    if (len < bestLen) { bestLen = len; bestIdx = i; }
    if (bestLen === 1) break;
  }
  if (bestIdx === -1) return 1;

  let count = 0;
  for (let d = 1; d <= 9; d++) {
    if (isValid(board, bestIdx, d)) {
      board[bestIdx] = d;
      count += countSolutions(board, limit);
      board[bestIdx] = EMPTY;
      if (count >= limit) return count;
    }
  }
  return count;
}

// Solve deterministically (ordered digits); returns solved board or null
function solveFirst(board) {
  const idx = board.indexOf(EMPTY);
  if (idx === -1) return true;
  for (let d = 1; d <= 9; d++) {
    if (isValid(board, idx, d)) {
      board[idx] = d;
      if (solveFirst(board)) return true;
      board[idx] = EMPTY;
    }
  }
  return false;
}

export function solve(puzzle) {
  const board = [...puzzle];
  return solveFirst(board) ? board : null;
}

export function generateComplete() {
  const board = new Array(81).fill(EMPTY);
  solveRandom(board);
  return board;
}

// Remove cells while maintaining a unique solution, steering toward a target
// difficulty: a removal is only kept if the puzzle still grades at or below
// the target, so digging naturally stops right at the requested tier instead
// of landing wherever random removal happens to end up.
export function createPuzzle(solution, difficulty) {
  const targetRank = GRADE_ORDER[difficulty] ?? GRADE_ORDER.medium;
  const floor = CLUE_FLOOR[difficulty] ?? 30;
  const puzzle = [...solution];
  const positions = shuffle(Array.from({ length: 81 }, (_, i) => i));
  let clues = 81;

  for (const pos of positions) {
    if (clues <= floor) break;
    const saved = puzzle[pos];
    puzzle[pos] = EMPTY;
    if (countSolutions([...puzzle]) !== 1) {
      puzzle[pos] = saved;
      continue;
    }
    const grade = gradePuzzle(puzzle);
    if (grade === null || GRADE_ORDER[grade] > targetRank) {
      puzzle[pos] = saved; // this removal overshoots the target — keep the clue
      continue;
    }
    clues--;
  }

  return puzzle;
}

// ---------------------------------------------------------------------------
// Technique detectors, shared by gradePuzzle and findHint.
//
// Each detector scans a candidate grid (read-only, never mutates) and returns
// the FIRST applicable step in its fixed scan order, or null:
//   { type, cell, patternCells, eliminations: [{cell, digit}, ...] }
//   { type, cell, patternCells, placement: {cell, digit} }
// - `patternCells` are the cells that justify the technique (pair cells,
//   X-Wing corners, XY-Wing pivot+wings, ...).
// - `eliminations` list only candidates actually present (applying them
//   always changes the grid); a step is only returned when non-empty.
// - `cell` is the hint-pointer cell shown to the player (kept identical to
//   the pre-refactor per-technique choice: first pattern cell for most,
//   first elimination cell for Swordfish, the target for Unique Rectangle).
// The drivers apply the step and restart the cascade from the top, so
// detector order in DETECTORS is the difficulty cascade.
// ---------------------------------------------------------------------------

const buildCands = (board) => board.map((v, i) =>
  v !== 0 ? null : new Set([1, 2, 3, 4, 5, 6, 7, 8, 9].filter(d => isValid(board, i, d)))
);

// Naked Single (Easy): cell has exactly one candidate
const findNakedSingle = (cands) => {
  for (let i = 0; i < 81; i++) {
    if (cands[i]?.size !== 1) continue;
    return { type: 'naked-single', cell: i, patternCells: [i], placement: { cell: i, digit: [...cands[i]][0] } };
  }
  return null;
};

// Hidden Single (Medium): digit has only one possible cell in a unit
const findHiddenSingle = (cands) => {
  for (let u = 0; u < 27; u++) {
    for (let d = 1; d <= 9; d++) {
      const cs = UNITS[u].filter(i => cands[i]?.has(d));
      if (cs.length !== 1) continue;
      return { type: 'hidden-single', cell: cs[0], patternCells: [cs[0]], unit: u, placement: { cell: cs[0], digit: d } };
    }
  }
  return null;
};

// Pointing Pair/Triple (Hard): candidate confined to one row/col within a box
const findPointing = (cands) => {
  for (let b = 18; b < 27; b++) {
    const box = UNITS[b];
    for (let d = 1; d <= 9; d++) {
      const cs = box.filter(i => cands[i]?.has(d));
      if (cs.length < 2) continue;
      const elims = [];
      const rows = new Set(cs.map(cellRow));
      if (rows.size === 1) {
        for (const i of UNITS[[...rows][0]]) {
          if (!box.includes(i) && cands[i]?.has(d)) elims.push({ cell: i, digit: d });
        }
      }
      const cols = new Set(cs.map(cellCol));
      if (cols.size === 1) {
        for (const i of UNITS[9 + [...cols][0]]) {
          if (!box.includes(i) && cands[i]?.has(d)) elims.push({ cell: i, digit: d });
        }
      }
      if (elims.length) return { type: 'pointing', cell: cs[0], patternCells: cs, eliminations: elims };
    }
  }
  return null;
};

// Box-Line Reduction (Hard): candidate confined to one box within a row/col
const findBoxLine = (cands) => {
  for (let u = 0; u < 18; u++) {
    const unit = UNITS[u];
    for (let d = 1; d <= 9; d++) {
      const cs = unit.filter(i => cands[i]?.has(d));
      if (cs.length < 2) continue;
      const boxes = new Set(cs.map(cellBox));
      if (boxes.size !== 1) continue;
      const elims = [];
      for (const i of UNITS[18 + [...boxes][0]]) {
        if (!unit.includes(i) && cands[i]?.has(d)) elims.push({ cell: i, digit: d });
      }
      if (elims.length) return { type: 'box-line', cell: cs[0], patternCells: cs, eliminations: elims };
    }
  }
  return null;
};

// Naked Pair (Hard): two cells in a unit share the same two candidates
const findNakedPair = (cands) => {
  for (const unit of UNITS) {
    const twos = unit.filter(i => cands[i]?.size === 2);
    for (let a = 0; a < twos.length - 1; a++) {
      for (let b = a + 1; b < twos.length; b++) {
        const ca = cands[twos[a]], cb = cands[twos[b]];
        if (![...ca].every(v => cb.has(v))) continue;
        const elims = [];
        for (const i of unit) {
          if (i === twos[a] || i === twos[b]) continue;
          for (const v of ca) if (cands[i]?.has(v)) elims.push({ cell: i, digit: v });
        }
        if (elims.length) return { type: 'naked-pair', cell: twos[a], patternCells: [twos[a], twos[b]], eliminations: elims };
      }
    }
  }
  return null;
};

// Hidden Pair (Hard): two digits each confined to the same two cells in a unit
const findHiddenPair = (cands) => {
  for (const unit of UNITS) {
    for (let d1 = 1; d1 <= 8; d1++) {
      const c1 = unit.filter(i => cands[i]?.has(d1));
      if (c1.length !== 2) continue;
      for (let d2 = d1 + 1; d2 <= 9; d2++) {
        const c2 = unit.filter(i => cands[i]?.has(d2));
        if (c2.length !== 2 || c1[0] !== c2[0] || c1[1] !== c2[1]) continue;
        const elims = [];
        for (const i of c1) {
          for (const v of cands[i]) {
            if (v !== d1 && v !== d2) elims.push({ cell: i, digit: v });
          }
        }
        if (elims.length) return { type: 'hidden-pair', cell: c1[0], patternCells: [...c1], eliminations: elims };
      }
    }
  }
  return null;
};

// Naked Triple (Very Hard): three cells share a combined set of exactly three candidates
const findNakedTriple = (cands) => {
  for (const unit of UNITS) {
    const smalls = unit.filter(i => cands[i] && cands[i].size >= 2 && cands[i].size <= 3);
    for (let a = 0; a < smalls.length - 2; a++) {
      for (let b = a + 1; b < smalls.length - 1; b++) {
        for (let c = b + 1; c < smalls.length; c++) {
          const combo = new Set([...cands[smalls[a]], ...cands[smalls[b]], ...cands[smalls[c]]]);
          if (combo.size !== 3) continue;
          const elims = [];
          for (const i of unit) {
            if (i === smalls[a] || i === smalls[b] || i === smalls[c]) continue;
            for (const v of combo) if (cands[i]?.has(v)) elims.push({ cell: i, digit: v });
          }
          if (elims.length) {
            return { type: 'naked-triple', cell: smalls[a], patternCells: [smalls[a], smalls[b], smalls[c]], eliminations: elims };
          }
        }
      }
    }
  }
  return null;
};

// X-Wing (Very Hard): digit in exactly two cells across two rows sharing the
// same two columns (or the transpose)
const findXWing = (cands) => {
  for (let d = 1; d <= 9; d++) {
    // Row-based
    const rowPairs = [];
    for (let r = 0; r < 9; r++) {
      const cols = UNITS[r].filter(i => cands[i]?.has(d)).map(cellCol);
      if (cols.length === 2) rowPairs.push({ r, cols });
    }
    for (let a = 0; a < rowPairs.length - 1; a++) {
      for (let b = a + 1; b < rowPairs.length; b++) {
        const ra = rowPairs[a], rb = rowPairs[b];
        if (ra.cols[0] !== rb.cols[0] || ra.cols[1] !== rb.cols[1]) continue;
        const elims = [];
        for (const col of ra.cols) {
          for (const i of UNITS[9 + col]) {
            if (cellRow(i) !== ra.r && cellRow(i) !== rb.r && cands[i]?.has(d)) elims.push({ cell: i, digit: d });
          }
        }
        if (elims.length) {
          const patternCells = [ra.r * 9 + ra.cols[0], ra.r * 9 + ra.cols[1], rb.r * 9 + rb.cols[0], rb.r * 9 + rb.cols[1]];
          return { type: 'x-wing', cell: patternCells[0], patternCells, eliminations: elims };
        }
      }
    }
    // Col-based
    const colPairs = [];
    for (let c = 0; c < 9; c++) {
      const rows = UNITS[9 + c].filter(i => cands[i]?.has(d)).map(cellRow);
      if (rows.length === 2) colPairs.push({ c, rows });
    }
    for (let a = 0; a < colPairs.length - 1; a++) {
      for (let b = a + 1; b < colPairs.length; b++) {
        const ca = colPairs[a], cb = colPairs[b];
        if (ca.rows[0] !== cb.rows[0] || ca.rows[1] !== cb.rows[1]) continue;
        const elims = [];
        for (const row of ca.rows) {
          for (const i of UNITS[row]) {
            if (cellCol(i) !== ca.c && cellCol(i) !== cb.c && cands[i]?.has(d)) elims.push({ cell: i, digit: d });
          }
        }
        if (elims.length) {
          const patternCells = [ca.rows[0] * 9 + ca.c, ca.rows[0] * 9 + cb.c, ca.rows[1] * 9 + ca.c, ca.rows[1] * 9 + cb.c];
          return { type: 'x-wing', cell: patternCells[0], patternCells, eliminations: elims };
        }
      }
    }
  }
  return null;
};

// Swordfish (Very Hard): digit confined to 2-3 cells per line across three
// rows (or columns) whose candidate columns (or rows) union to just three.
// `lines` are candidate-lines for digit `d` with 2-3 cross positions each.
const findSwordfishIn = (cands, lines, byColumn, d) => {
  for (let a = 0; a < lines.length - 2; a++) {
    for (let b = a + 1; b < lines.length - 1; b++) {
      for (let c = b + 1; c < lines.length; c++) {
        const union = new Set([...lines[a].cross, ...lines[b].cross, ...lines[c].cross]);
        if (union.size !== 3) continue;
        const usedLines = [lines[a].line, lines[b].line, lines[c].line];
        const elims = [];
        for (const cross of union) {
          const unit = byColumn ? UNITS[cross] : UNITS[9 + cross];
          for (const i of unit) {
            const lineOfI = byColumn ? cellCol(i) : cellRow(i);
            if (!usedLines.includes(lineOfI) && cands[i]?.has(d)) elims.push({ cell: i, digit: d });
          }
        }
        if (elims.length) {
          const patternCells = [];
          for (const line of usedLines) {
            const unit = byColumn ? UNITS[9 + line] : UNITS[line];
            for (const i of unit) if (cands[i]?.has(d)) patternCells.push(i);
          }
          return { type: 'swordfish', cell: elims[0].cell, patternCells, eliminations: elims };
        }
      }
    }
  }
  return null;
};

const findSwordfish = (cands) => {
  for (let d = 1; d <= 9; d++) {
    const rowLines = [];
    for (let r = 0; r < 9; r++) {
      const cols = UNITS[r].filter(i => cands[i]?.has(d)).map(cellCol);
      if (cols.length >= 2 && cols.length <= 3) rowLines.push({ line: r, cross: cols });
    }
    let step = findSwordfishIn(cands, rowLines, false, d);
    if (step) return step;

    const colLines = [];
    for (let c = 0; c < 9; c++) {
      const rows = UNITS[9 + c].filter(i => cands[i]?.has(d)).map(cellRow);
      if (rows.length >= 2 && rows.length <= 3) colLines.push({ line: c, cross: rows });
    }
    step = findSwordfishIn(cands, colLines, true, d);
    if (step) return step;
  }
  return null;
};

// XY-Wing (Very Hard): pivot with candidates {x,y}; wings {x,z} and {y,z}
// (each a peer of the pivot) let z be eliminated from any cell seeing both wings
const findXYWing = (cands) => {
  for (let p = 0; p < 81; p++) {
    if (!cands[p] || cands[p].size !== 2) continue;
    const [x, y] = [...cands[p]];
    const peerCells = PEERS[p].filter(i => cands[i]?.size === 2);
    const w1cands = peerCells.filter(i => cands[i].has(x) && !cands[i].has(y));
    const w2cands = peerCells.filter(i => cands[i].has(y) && !cands[i].has(x));

    for (const w1 of w1cands) {
      const z1 = [...cands[w1]].find(v => v !== x);
      for (const w2 of w2cands) {
        if (w2 === w1) continue;
        const z2 = [...cands[w2]].find(v => v !== y);
        if (z1 !== z2) continue;
        const z = z1;
        const elims = PEERS[w1]
          .filter(i => i !== p && PEERS[w2].includes(i) && cands[i]?.has(z))
          .map(i => ({ cell: i, digit: z }));
        if (elims.length) return { type: 'xy-wing', cell: p, patternCells: [p, w1, w2], eliminations: elims };
      }
    }
  }
  return null;
};

// Unique Rectangle Type 1 (Very Hard): three corners of a rectangle spanning
// exactly two boxes hold the same bivalue pair {A,B}; if the fourth corner
// also resolved to A or B, the four corners would form a deadly pattern with
// two interchangeable solutions, contradicting uniqueness — so whichever of
// A/B the fourth corner holds can be eliminated.
const findUniqueRectangle = (cands) => {
  for (let r1 = 0; r1 < 9; r1++) {
    for (let r2 = r1 + 1; r2 < 9; r2++) {
      const sameBand = Math.floor(r1 / 3) === Math.floor(r2 / 3);
      for (let c1 = 0; c1 < 9; c1++) {
        for (let c2 = c1 + 1; c2 < 9; c2++) {
          // UR-legal iff the corners span exactly 2 boxes: rows in the same
          // band XOR columns in the same stack (both → 1 box, neither → 4)
          const sameStack = Math.floor(c1 / 3) === Math.floor(c2 / 3);
          if (sameBand === sameStack) continue;
          const corners = [r1 * 9 + c1, r1 * 9 + c2, r2 * 9 + c1, r2 * 9 + c2];
          if (corners.some(i => !cands[i])) continue; // all four must be unsolved
          // Try each corner as the target; the other three must share the
          // same bivalue pair (the target itself may hold any candidates,
          // including a different bivalue pair)
          for (const target of corners) {
            const floor = corners.filter(i => i !== target);
            if (floor.some(i => cands[i].size !== 2)) continue;
            const [A, B] = [...cands[floor[0]]];
            if (floor.some(i => !cands[i].has(A) || !cands[i].has(B))) continue;
            // The uniqueness argument covers each pair digit independently,
            // so eliminate whichever of A/B is present — but keep at least
            // one other candidate so the cell isn't emptied
            const present = [A, B].filter(d => cands[target].has(d));
            if (present.length === 0 || cands[target].size === present.length) continue;
            return {
              type: 'unique-rectangle', cell: target, patternCells: [...floor, target],
              eliminations: present.map(d => ({ cell: target, digit: d })),
            };
          }
        }
      }
    }
  }
  return null;
};

// Cascade order = difficulty order; drivers restart from the top after every
// applied step, so easier techniques always win when applicable.
const DETECTORS = [
  findNakedSingle, findHiddenSingle, findPointing, findBoxLine, findNakedPair,
  findHiddenPair, findNakedTriple, findXWing, findSwordfish, findXYWing,
  findUniqueRectangle,
];

const TECH_RANK = {
  'naked-single':     GRADE_ORDER.easy,
  'hidden-single':    GRADE_ORDER.medium,
  'pointing':         GRADE_ORDER.hard,
  'box-line':         GRADE_ORDER.hard,
  'naked-pair':       GRADE_ORDER.hard,
  'hidden-pair':      GRADE_ORDER.hard,
  'naked-triple':     GRADE_ORDER.veryhard,
  'x-wing':           GRADE_ORDER.veryhard,
  'swordfish':        GRADE_ORDER.veryhard,
  'xy-wing':          GRADE_ORDER.veryhard,
  'unique-rectangle': GRADE_ORDER.veryhard,
};

const findStep = (cands) => {
  for (const detect of DETECTORS) {
    const step = detect(cands);
    if (step) return step;
  }
  return null;
};

// Technique-based grader.
// Applies human solving techniques in difficulty order; returns the grade of the
// hardest technique needed, or null if the grader gets stuck (puzzle needs guessing).
function gradePuzzle(puzzle) {
  const board = [...puzzle];
  const cands = buildCands(board);
  let hardest = GRADE_ORDER.easy;

  for (;;) {
    const step = findStep(cands);
    if (!step) break; // no technique made progress — grader is stuck
    hardest = Math.max(hardest, TECH_RANK[step.type]);
    if (step.placement) {
      const { cell, digit } = step.placement;
      board[cell] = digit;
      cands[cell] = null;
      for (const p of PEERS[cell]) cands[p]?.delete(digit);
    } else {
      for (const { cell, digit } of step.eliminations) cands[cell].delete(digit);
    }
  }

  if (board.some(v => v === 0)) return null;
  return GRADE_NAMES[hardest];
}

// Technique-based hint finder.
// Runs the same cascade as the grader on a fresh candidate grid (ignoring notes),
// recording every applied step until a single opens up a placement. Returns
// { steps: [...] } — the ordered chain of techniques from the current board to a
// placeable digit, each step { type, cell, patternCells, eliminations } (or
// `placement` on the final step) — or { type: 'error' } if any placed value
// contradicts the solution, or { type: 'stuck' } if no technique applies before
// a placement is reached (partial chains are not surfaced).
export function findHint(board, solution) {
  for (let i = 0; i < 81; i++) {
    if (board[i] !== 0 && board[i] !== solution[i]) return { type: 'error' };
  }

  const cands = buildCands(board);
  const steps = [];

  for (;;) {
    const step = findStep(cands);
    if (!step) return { type: 'stuck' };
    steps.push(step);
    if (step.placement) return { steps };
    for (const { cell, digit } of step.eliminations) cands[cell].delete(digit);
  }
}

// Generate a puzzle matching the target difficulty grade. createPuzzle()
// already digs toward the target (never overshooting it), so this usually
// succeeds on the first solution tried; the small retry budget only covers
// the rare solution where the target grade isn't reachable before the clue
// floor. Falls back to the closest grade achieved (never harder than asked).
export function generateGraded(difficulty) {
  const MAX = 12;
  const targetRank = GRADE_ORDER[difficulty] ?? GRADE_ORDER.medium;
  let best = null;
  let bestRank = -1;

  for (let attempt = 0; attempt < MAX; attempt++) {
    const solution = generateComplete();
    const puzzle = createPuzzle(solution, difficulty);
    const grade = gradePuzzle(puzzle);
    if (grade === difficulty) return { puzzle, solution };
    const rank = grade === null ? -1 : GRADE_ORDER[grade];
    if (rank > bestRank) { bestRank = rank; best = { puzzle, solution }; }
    if (bestRank === targetRank) break;
  }

  if (best) return best;
  const solution = generateComplete();
  return { puzzle: createPuzzle(solution, difficulty), solution };
}

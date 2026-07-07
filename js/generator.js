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

const cellRow = i => Math.floor(i / 9);
const cellCol = i => i % 9;
const cellBox = i => Math.floor(Math.floor(i / 9) / 3) * 3 + Math.floor((i % 9) / 3);

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

// Remove cells while maintaining a unique solution
export function createPuzzle(solution, difficulty) {
  const clues = { easy: 36, medium: 30, hard: 25, veryhard: 22 }[difficulty] ?? 30;
  const toRemove = 81 - clues;
  const puzzle = [...solution];
  const positions = shuffle(Array.from({ length: 81 }, (_, i) => i));
  let removed = 0;

  for (const pos of positions) {
    if (removed >= toRemove) break;
    const saved = puzzle[pos];
    puzzle[pos] = EMPTY;
    if (countSolutions([...puzzle]) === 1) {
      removed++;
    } else {
      puzzle[pos] = saved;
    }
  }

  return puzzle;
}

// Technique-based grader.
// Applies human solving techniques in difficulty order; returns the grade of the
// hardest technique needed, or null if the grader gets stuck (puzzle needs guessing).
function gradePuzzle(puzzle) {
  const board = [...puzzle];
  const cands = board.map((v, i) =>
    v !== 0 ? null : new Set([1, 2, 3, 4, 5, 6, 7, 8, 9].filter(d => isValid(board, i, d)))
  );

  const G = { easy: 0, medium: 1, hard: 2, veryhard: 3 };
  let hardest = G.easy;

  const place = (i, v) => {
    board[i] = v;
    cands[i] = null;
    for (const p of PEERS[i]) cands[p]?.delete(v);
  };

  const elim = (i, v) => {
    if (!cands[i] || !cands[i].has(v)) return false;
    cands[i].delete(v);
    return true;
  };

  outer: while (true) {

    // Naked Single (Easy): cell has exactly one candidate
    for (let i = 0; i < 81; i++) {
      if (!cands[i] || cands[i].size !== 1) continue;
      place(i, [...cands[i]][0]);
      continue outer;
    }

    // Hidden Single (Medium): digit has only one possible cell in a unit
    for (const unit of UNITS) {
      for (let d = 1; d <= 9; d++) {
        const cs = unit.filter(i => cands[i]?.has(d));
        if (cs.length !== 1) continue;
        hardest = Math.max(hardest, G.medium);
        place(cs[0], d);
        continue outer;
      }
    }

    // Pointing Pair/Triple (Hard): candidate confined to one row/col within a box
    for (let b = 18; b < 27; b++) {
      const box = UNITS[b];
      for (let d = 1; d <= 9; d++) {
        const cs = box.filter(i => cands[i]?.has(d));
        if (cs.length < 2) continue;
        let changed = false;
        const rows = new Set(cs.map(cellRow));
        if (rows.size === 1) {
          for (const i of UNITS[[...rows][0]]) {
            if (!box.includes(i)) changed = elim(i, d) || changed;
          }
        }
        const cols = new Set(cs.map(cellCol));
        if (cols.size === 1) {
          for (const i of UNITS[9 + [...cols][0]]) {
            if (!box.includes(i)) changed = elim(i, d) || changed;
          }
        }
        if (changed) { hardest = Math.max(hardest, G.hard); continue outer; }
      }
    }

    // Box-Line Reduction (Hard): candidate confined to one box within a row/col
    for (let u = 0; u < 18; u++) {
      const unit = UNITS[u];
      for (let d = 1; d <= 9; d++) {
        const cs = unit.filter(i => cands[i]?.has(d));
        if (cs.length < 2) continue;
        const boxes = new Set(cs.map(cellBox));
        if (boxes.size !== 1) continue;
        const boxUnit = UNITS[18 + [...boxes][0]];
        let changed = false;
        for (const i of boxUnit) {
          if (!unit.includes(i)) changed = elim(i, d) || changed;
        }
        if (changed) { hardest = Math.max(hardest, G.hard); continue outer; }
      }
    }

    // Naked Pair (Hard): two cells in a unit share the same two candidates
    for (const unit of UNITS) {
      const twos = unit.filter(i => cands[i]?.size === 2);
      for (let a = 0; a < twos.length - 1; a++) {
        for (let b = a + 1; b < twos.length; b++) {
          const ca = cands[twos[a]], cb = cands[twos[b]];
          if (![...ca].every(v => cb.has(v))) continue;
          let changed = false;
          for (const i of unit) {
            if (i === twos[a] || i === twos[b]) continue;
            for (const v of ca) changed = elim(i, v) || changed;
          }
          if (changed) { hardest = Math.max(hardest, G.hard); continue outer; }
        }
      }
    }

    // Hidden Pair (Hard): two digits each confined to the same two cells in a unit
    for (const unit of UNITS) {
      for (let d1 = 1; d1 <= 8; d1++) {
        const c1 = unit.filter(i => cands[i]?.has(d1));
        if (c1.length !== 2) continue;
        for (let d2 = d1 + 1; d2 <= 9; d2++) {
          const c2 = unit.filter(i => cands[i]?.has(d2));
          if (c2.length !== 2 || c1[0] !== c2[0] || c1[1] !== c2[1]) continue;
          let changed = false;
          for (const i of c1) {
            for (const v of [...cands[i]]) {
              if (v !== d1 && v !== d2) changed = elim(i, v) || changed;
            }
          }
          if (changed) { hardest = Math.max(hardest, G.hard); continue outer; }
        }
      }
    }

    // Naked Triple (Very Hard): three cells share a combined set of exactly three candidates
    for (const unit of UNITS) {
      const smalls = unit.filter(i => cands[i] && cands[i].size >= 2 && cands[i].size <= 3);
      for (let a = 0; a < smalls.length - 2; a++) {
        for (let b = a + 1; b < smalls.length - 1; b++) {
          for (let c = b + 1; c < smalls.length; c++) {
            const combo = new Set([...cands[smalls[a]], ...cands[smalls[b]], ...cands[smalls[c]]]);
            if (combo.size !== 3) continue;
            let changed = false;
            for (const i of unit) {
              if (i === smalls[a] || i === smalls[b] || i === smalls[c]) continue;
              for (const v of combo) changed = elim(i, v) || changed;
            }
            if (changed) { hardest = Math.max(hardest, G.veryhard); continue outer; }
          }
        }
      }
    }

    // X-Wing (Very Hard): digit in exactly two cells across two rows sharing the same two columns
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
          let changed = false;
          for (const col of ra.cols) {
            for (const i of UNITS[9 + col]) {
              if (cellRow(i) !== ra.r && cellRow(i) !== rb.r) changed = elim(i, d) || changed;
            }
          }
          if (changed) { hardest = Math.max(hardest, G.veryhard); continue outer; }
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
          let changed = false;
          for (const row of ca.rows) {
            for (const i of UNITS[row]) {
              if (cellCol(i) !== ca.c && cellCol(i) !== cb.c) changed = elim(i, d) || changed;
            }
          }
          if (changed) { hardest = Math.max(hardest, G.veryhard); continue outer; }
        }
      }
    }

    break; // No technique made progress — grader is stuck
  }

  if (board.some(v => v === 0)) return null;
  return ['easy', 'medium', 'hard', 'veryhard'][hardest];
}

// Technique-based hint finder.
// Runs the same cascade as the grader on a fresh candidate grid (ignoring notes).
// Returns { type, cell } where type is the technique used, or { type: 'error' } if
// any placed value contradicts the solution, or { type: 'stuck' } if no technique applies.
// For singles: cell is where the value should be placed.
// For elimination techniques: cell is the first cell involved in the pattern; the
// elimination is applied to the temporary grid and the cascade restarts, so a single
// opening up after the elimination is returned instead.
export function findHint(board, solution) {
  for (let i = 0; i < 81; i++) {
    if (board[i] !== 0 && board[i] !== solution[i]) return { type: 'error' };
  }

  const cands = board.map((v, i) =>
    v !== 0 ? null : new Set([1, 2, 3, 4, 5, 6, 7, 8, 9].filter(d => isValid(board, i, d)))
  );

  const elim = (i, v) => {
    if (!cands[i] || !cands[i].has(v)) return false;
    cands[i].delete(v);
    return true;
  };

  let fallback = null;

  outer: while (true) {

    // Naked Single
    for (let i = 0; i < 81; i++) {
      if (cands[i]?.size === 1) return { type: fallback?.type ?? 'naked-single', cell: i };
    }

    // Hidden Single
    for (const unit of UNITS) {
      for (let d = 1; d <= 9; d++) {
        const cs = unit.filter(i => cands[i]?.has(d));
        if (cs.length === 1) return { type: fallback?.type ?? 'hidden-single', cell: cs[0] };
      }
    }

    // Pointing Pair/Triple
    for (let b = 18; b < 27; b++) {
      const box = UNITS[b];
      for (let d = 1; d <= 9; d++) {
        const cs = box.filter(i => cands[i]?.has(d));
        if (cs.length < 2) continue;
        let changed = false;
        const rows = new Set(cs.map(cellRow));
        if (rows.size === 1) {
          for (const i of UNITS[[...rows][0]]) {
            if (!box.includes(i)) changed = elim(i, d) || changed;
          }
        }
        const cols = new Set(cs.map(cellCol));
        if (cols.size === 1) {
          for (const i of UNITS[9 + [...cols][0]]) {
            if (!box.includes(i)) changed = elim(i, d) || changed;
          }
        }
        if (changed) {
          fallback = { type: 'pointing', cell: cs[0] };
          continue outer;
        }
      }
    }

    // Box-Line Reduction
    for (let u = 0; u < 18; u++) {
      const unit = UNITS[u];
      for (let d = 1; d <= 9; d++) {
        const cs = unit.filter(i => cands[i]?.has(d));
        if (cs.length < 2) continue;
        const boxes = new Set(cs.map(cellBox));
        if (boxes.size !== 1) continue;
        const boxUnit = UNITS[18 + [...boxes][0]];
        let changed = false;
        for (const i of boxUnit) {
          if (!unit.includes(i)) changed = elim(i, d) || changed;
        }
        if (changed) {
          fallback = { type: 'box-line', cell: cs[0] };
          continue outer;
        }
      }
    }

    // Naked Pair
    for (const unit of UNITS) {
      const twos = unit.filter(i => cands[i]?.size === 2);
      for (let a = 0; a < twos.length - 1; a++) {
        for (let b = a + 1; b < twos.length; b++) {
          const ca = cands[twos[a]], cb = cands[twos[b]];
          if (![...ca].every(v => cb.has(v))) continue;
          let changed = false;
          for (const i of unit) {
            if (i === twos[a] || i === twos[b]) continue;
            for (const v of ca) changed = elim(i, v) || changed;
          }
          if (changed) {
            fallback = { type: 'naked-pair', cell: twos[a] };
            continue outer;
          }
        }
      }
    }

    // Hidden Pair
    for (const unit of UNITS) {
      for (let d1 = 1; d1 <= 8; d1++) {
        const c1 = unit.filter(i => cands[i]?.has(d1));
        if (c1.length !== 2) continue;
        for (let d2 = d1 + 1; d2 <= 9; d2++) {
          const c2 = unit.filter(i => cands[i]?.has(d2));
          if (c2.length !== 2 || c1[0] !== c2[0] || c1[1] !== c2[1]) continue;
          let changed = false;
          for (const i of c1) {
            for (const v of [...cands[i]]) {
              if (v !== d1 && v !== d2) changed = elim(i, v) || changed;
            }
          }
          if (changed) {
            fallback = { type: 'hidden-pair', cell: c1[0] };
            continue outer;
          }
        }
      }
    }

    // Naked Triple
    for (const unit of UNITS) {
      const smalls = unit.filter(i => cands[i] && cands[i].size >= 2 && cands[i].size <= 3);
      for (let a = 0; a < smalls.length - 2; a++) {
        for (let b = a + 1; b < smalls.length - 1; b++) {
          for (let c = b + 1; c < smalls.length; c++) {
            const combo = new Set([...cands[smalls[a]], ...cands[smalls[b]], ...cands[smalls[c]]]);
            if (combo.size !== 3) continue;
            let changed = false;
            for (const i of unit) {
              if (i === smalls[a] || i === smalls[b] || i === smalls[c]) continue;
              for (const v of combo) changed = elim(i, v) || changed;
            }
            if (changed) {
              fallback = { type: 'naked-triple', cell: smalls[a] };
              continue outer;
            }
          }
        }
      }
    }

    // X-Wing
    for (let d = 1; d <= 9; d++) {
      const rowPairs = [];
      for (let r = 0; r < 9; r++) {
        const cols = UNITS[r].filter(i => cands[i]?.has(d)).map(cellCol);
        if (cols.length === 2) rowPairs.push({ r, cols });
      }
      for (let a = 0; a < rowPairs.length - 1; a++) {
        for (let b = a + 1; b < rowPairs.length; b++) {
          const ra = rowPairs[a], rb = rowPairs[b];
          if (ra.cols[0] !== rb.cols[0] || ra.cols[1] !== rb.cols[1]) continue;
          let changed = false;
          for (const col of ra.cols) {
            for (const i of UNITS[9 + col]) {
              if (cellRow(i) !== ra.r && cellRow(i) !== rb.r) changed = elim(i, d) || changed;
            }
          }
          if (changed) {
            fallback = { type: 'x-wing', cell: ra.r * 9 + ra.cols[0] };
            continue outer;
          }
        }
      }
      const colPairs = [];
      for (let c = 0; c < 9; c++) {
        const rows = UNITS[9 + c].filter(i => cands[i]?.has(d)).map(cellRow);
        if (rows.length === 2) colPairs.push({ c, rows });
      }
      for (let a = 0; a < colPairs.length - 1; a++) {
        for (let b = a + 1; b < colPairs.length; b++) {
          const ca = colPairs[a], cb = colPairs[b];
          if (ca.rows[0] !== cb.rows[0] || ca.rows[1] !== cb.rows[1]) continue;
          let changed = false;
          for (const row of ca.rows) {
            for (const i of UNITS[row]) {
              if (cellCol(i) !== ca.c && cellCol(i) !== cb.c) changed = elim(i, d) || changed;
            }
          }
          if (changed) {
            fallback = { type: 'x-wing', cell: ca.rows[0] * 9 + ca.c };
            continue outer;
          }
        }
      }
    }

    break;
  }

  return fallback ?? { type: 'stuck' };
}

// Generate a puzzle guaranteed to match the target difficulty grade.
// Retries up to 50 times; falls back to the first non-null grade if exhausted.
export function generateGraded(difficulty) {
  const MAX = 50;
  let fallback = null;

  for (let attempt = 0; attempt < MAX; attempt++) {
    const solution = generateComplete();
    const puzzle = createPuzzle(solution, difficulty);
    const grade = gradePuzzle(puzzle);
    if (grade === difficulty) return { puzzle, solution };
    if (grade !== null && fallback === null) fallback = { puzzle, solution };
  }

  if (fallback) return fallback;
  const solution = generateComplete();
  return { puzzle: createPuzzle(solution, difficulty), solution };
}

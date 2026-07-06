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
function countSolutions(board, limit = 2) {
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

// Technique-based grader.
// Applies human solving techniques in difficulty order; returns the grade of the
// hardest technique needed, or null if the grader gets stuck (puzzle needs guessing).
function gradePuzzle(puzzle) {
  const board = [...puzzle];
  const cands = board.map((v, i) =>
    v !== 0 ? null : new Set([1, 2, 3, 4, 5, 6, 7, 8, 9].filter(d => isValid(board, i, d)))
  );

  const G = GRADE_ORDER;
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

  // Swordfish helper: `lines` are candidate-lines for digit `d` with 2-3 cross
  // positions each; if three of them union to exactly 3 cross positions, `d`
  // can be eliminated from those cross lines outside the three base lines.
  const trySwordfish = (lines, byColumn, d) => {
    for (let a = 0; a < lines.length - 2; a++) {
      for (let b = a + 1; b < lines.length - 1; b++) {
        for (let c = b + 1; c < lines.length; c++) {
          const union = new Set([...lines[a].cross, ...lines[b].cross, ...lines[c].cross]);
          if (union.size !== 3) continue;
          const usedLines = [lines[a].line, lines[b].line, lines[c].line];
          let changed = false;
          for (const cross of union) {
            const unit = byColumn ? UNITS[cross] : UNITS[9 + cross];
            for (const i of unit) {
              const lineOfI = byColumn ? cellCol(i) : cellRow(i);
              if (!usedLines.includes(lineOfI)) changed = elim(i, d) || changed;
            }
          }
          if (changed) return true;
        }
      }
    }
    return false;
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

    // Swordfish (Very Hard): digit confined to 2-3 cells per line across three
    // rows (or columns) whose candidate columns (or rows) union to just three
    for (let d = 1; d <= 9; d++) {
      const rowLines = [];
      for (let r = 0; r < 9; r++) {
        const cols = UNITS[r].filter(i => cands[i]?.has(d)).map(cellCol);
        if (cols.length >= 2 && cols.length <= 3) rowLines.push({ line: r, cross: cols });
      }
      if (trySwordfish(rowLines, false, d)) { hardest = Math.max(hardest, G.veryhard); continue outer; }

      const colLines = [];
      for (let c = 0; c < 9; c++) {
        const rows = UNITS[9 + c].filter(i => cands[i]?.has(d)).map(cellRow);
        if (rows.length >= 2 && rows.length <= 3) colLines.push({ line: c, cross: rows });
      }
      if (trySwordfish(colLines, true, d)) { hardest = Math.max(hardest, G.veryhard); continue outer; }
    }

    // XY-Wing (Very Hard): pivot with candidates {x,y}; wings {x,z} and {y,z}
    // (each a peer of the pivot) let z be eliminated from any cell seeing both wings
    for (let p = 0; p < 81; p++) {
      if (!cands[p] || cands[p].size !== 2) continue;
      const [x, y] = [...cands[p]];
      const peerCells = PEERS[p].filter(i => cands[i]?.size === 2);
      const w1cands = peerCells.filter(i => cands[i].has(x) && !cands[i].has(y));
      const w2cands = peerCells.filter(i => cands[i].has(y) && !cands[i].has(x));

      let progressed = false;
      for (const w1 of w1cands) {
        const z1 = [...cands[w1]].find(v => v !== x);
        for (const w2 of w2cands) {
          if (w2 === w1) continue;
          const z2 = [...cands[w2]].find(v => v !== y);
          if (z1 !== z2) continue;
          const z = z1;
          const targets = PEERS[w1].filter(i => i !== p && PEERS[w2].includes(i) && cands[i]?.has(z));
          let changed = false;
          for (const t of targets) changed = elim(t, z) || changed;
          if (changed) { progressed = true; break; }
        }
        if (progressed) break;
      }
      if (progressed) { hardest = Math.max(hardest, G.veryhard); continue outer; }
    }

    // Unique Rectangle Type 1 (Very Hard): 3 corners of a 2-box rectangle share
    // the same 2 candidates; the 4th corner cannot also be that pair (it would
    // create a second solution), so those 2 candidates can be eliminated there
    for (let r1 = 0; r1 < 9; r1++) {
      for (let r2 = r1 + 1; r2 < 9; r2++) {
        for (let c1 = 0; c1 < 9; c1++) {
          for (let c2 = c1 + 1; c2 < 9; c2++) {
            const i11 = r1 * 9 + c1, i12 = r1 * 9 + c2, i21 = r2 * 9 + c1, i22 = r2 * 9 + c2;
            if (cellBox(i11) === cellBox(i12)) continue;
            if (cellBox(i11) !== cellBox(i21) || cellBox(i12) !== cellBox(i22)) continue;
            const corners = [i11, i12, i21, i22];
            const bivals = corners.filter(i => cands[i]?.size === 2);
            if (bivals.length !== 3) continue;
            const pairKeys = new Set(bivals.map(i => [...cands[i]].sort((a, b) => a - b).join(',')));
            if (pairKeys.size !== 1) continue;
            const [A, B] = [...pairKeys][0].split(',').map(Number);
            const target = corners.find(i => !bivals.includes(i));
            if (!cands[target] || !cands[target].has(A) || !cands[target].has(B) || cands[target].size <= 2) continue;
            let changed = false;
            changed = elim(target, A) || changed;
            changed = elim(target, B) || changed;
            if (changed) { hardest = Math.max(hardest, G.veryhard); continue outer; }
          }
        }
      }
    }

    break; // No technique made progress — grader is stuck
  }

  if (board.some(v => v === 0)) return null;
  return GRADE_NAMES[hardest];
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

  // Swordfish helper: mirrors the one in gradePuzzle, returning the first
  // affected cell (for the hint pointer) instead of a plain boolean.
  const trySwordfish = (lines, byColumn, d) => {
    for (let a = 0; a < lines.length - 2; a++) {
      for (let b = a + 1; b < lines.length - 1; b++) {
        for (let c = b + 1; c < lines.length; c++) {
          const union = new Set([...lines[a].cross, ...lines[b].cross, ...lines[c].cross]);
          if (union.size !== 3) continue;
          const usedLines = [lines[a].line, lines[b].line, lines[c].line];
          let changed = false, firstCell = null;
          for (const cross of union) {
            const unit = byColumn ? UNITS[cross] : UNITS[9 + cross];
            for (const i of unit) {
              const lineOfI = byColumn ? cellCol(i) : cellRow(i);
              if (!usedLines.includes(lineOfI) && elim(i, d)) {
                changed = true;
                if (firstCell === null) firstCell = i;
              }
            }
          }
          if (changed) return firstCell;
        }
      }
    }
    return null;
  };

  let fallback = null;

  outer: while (true) {

    // Naked Single
    for (let i = 0; i < 81; i++) {
      if (cands[i]?.size === 1) return { type: 'naked-single', cell: i };
    }

    // Hidden Single
    for (const unit of UNITS) {
      for (let d = 1; d <= 9; d++) {
        const cs = unit.filter(i => cands[i]?.has(d));
        if (cs.length === 1) return { type: 'hidden-single', cell: cs[0] };
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
          if (!fallback) fallback = { type: 'pointing', cell: cs[0] };
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
          if (!fallback) fallback = { type: 'box-line', cell: cs[0] };
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
            if (!fallback) fallback = { type: 'naked-pair', cell: twos[a] };
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
            if (!fallback) fallback = { type: 'hidden-pair', cell: c1[0] };
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
              if (!fallback) fallback = { type: 'naked-triple', cell: smalls[a] };
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
            if (!fallback) fallback = { type: 'x-wing', cell: ra.r * 9 + ra.cols[0] };
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
            if (!fallback) fallback = { type: 'x-wing', cell: ca.rows[0] * 9 + ca.c };
            continue outer;
          }
        }
      }
    }

    // Swordfish
    for (let d = 1; d <= 9; d++) {
      const rowLines = [];
      for (let r = 0; r < 9; r++) {
        const cols = UNITS[r].filter(i => cands[i]?.has(d)).map(cellCol);
        if (cols.length >= 2 && cols.length <= 3) rowLines.push({ line: r, cross: cols });
      }
      let hit = trySwordfish(rowLines, false, d);
      if (hit !== null) {
        if (!fallback) fallback = { type: 'swordfish', cell: hit };
        continue outer;
      }

      const colLines = [];
      for (let c = 0; c < 9; c++) {
        const rows = UNITS[9 + c].filter(i => cands[i]?.has(d)).map(cellRow);
        if (rows.length >= 2 && rows.length <= 3) colLines.push({ line: c, cross: rows });
      }
      hit = trySwordfish(colLines, true, d);
      if (hit !== null) {
        if (!fallback) fallback = { type: 'swordfish', cell: hit };
        continue outer;
      }
    }

    // XY-Wing
    for (let p = 0; p < 81; p++) {
      if (!cands[p] || cands[p].size !== 2) continue;
      const [x, y] = [...cands[p]];
      const peerCells = PEERS[p].filter(i => cands[i]?.size === 2);
      const w1cands = peerCells.filter(i => cands[i].has(x) && !cands[i].has(y));
      const w2cands = peerCells.filter(i => cands[i].has(y) && !cands[i].has(x));

      let progressed = false;
      for (const w1 of w1cands) {
        const z1 = [...cands[w1]].find(v => v !== x);
        for (const w2 of w2cands) {
          if (w2 === w1) continue;
          const z2 = [...cands[w2]].find(v => v !== y);
          if (z1 !== z2) continue;
          const z = z1;
          const targets = PEERS[w1].filter(i => i !== p && PEERS[w2].includes(i) && cands[i]?.has(z));
          let changed = false;
          for (const t of targets) changed = elim(t, z) || changed;
          if (changed) {
            if (!fallback) fallback = { type: 'xy-wing', cell: p };
            progressed = true;
            break;
          }
        }
        if (progressed) break;
      }
      if (progressed) continue outer;
    }

    // Unique Rectangle Type 1
    for (let r1 = 0; r1 < 9; r1++) {
      for (let r2 = r1 + 1; r2 < 9; r2++) {
        for (let c1 = 0; c1 < 9; c1++) {
          for (let c2 = c1 + 1; c2 < 9; c2++) {
            const i11 = r1 * 9 + c1, i12 = r1 * 9 + c2, i21 = r2 * 9 + c1, i22 = r2 * 9 + c2;
            if (cellBox(i11) === cellBox(i12)) continue;
            if (cellBox(i11) !== cellBox(i21) || cellBox(i12) !== cellBox(i22)) continue;
            const corners = [i11, i12, i21, i22];
            const bivals = corners.filter(i => cands[i]?.size === 2);
            if (bivals.length !== 3) continue;
            const pairKeys = new Set(bivals.map(i => [...cands[i]].sort((a, b) => a - b).join(',')));
            if (pairKeys.size !== 1) continue;
            const [A, B] = [...pairKeys][0].split(',').map(Number);
            const target = corners.find(i => !bivals.includes(i));
            if (!cands[target] || !cands[target].has(A) || !cands[target].has(B) || cands[target].size <= 2) continue;
            let changed = false;
            changed = elim(target, A) || changed;
            changed = elim(target, B) || changed;
            if (changed) {
              if (!fallback) fallback = { type: 'unique-rectangle', cell: target };
              continue outer;
            }
          }
        }
      }
    }

    break;
  }

  return fallback ?? { type: 'stuck' };
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

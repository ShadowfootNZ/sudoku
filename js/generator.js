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
  // Pick empty cell with fewest valid candidates (MRV)
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

// Remove cells while maintaining a unique solution
export function createPuzzle(solution, difficulty) {
  const clues = { easy: 36, medium: 30, hard: 25 }[difficulty] ?? 30;
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

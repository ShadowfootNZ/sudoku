import { generateComplete, createPuzzle } from './generator.js';

self.onmessage = function (e) {
  const { difficulty } = e.data;
  const solution = generateComplete();
  const puzzle = createPuzzle(solution, difficulty);
  self.postMessage({ puzzle, solution });
};

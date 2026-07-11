import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { normalizeGrid } from '../tools/photo-metrics.js';
import { hasConflictingGivens, countSolutions } from '../js/generator.js';

const root = new URL('./fixtures/photo-import/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('fixtures.json', root), 'utf8'));
const truth = JSON.parse(readFileSync(new URL('ground-truth.json', root), 'utf8'));
const files = new Set(readdirSync(root));

assert.equal(manifest.version, 1);
assert.equal(manifest.fixtures.length, 20);
for (const fixture of manifest.fixtures) {
  assert.ok(files.has(fixture.file), `missing fixture: ${fixture.file}`);
  assert.ok(['clean', 'medium', 'hard'].includes(fixture.tier), `bad tier: ${fixture.file}`);
}
for (const [filename, value] of Object.entries(truth)) {
  assert.ok(files.has(filename), `ground truth has no image: ${filename}`);
  const grid = normalizeGrid(value);
  assert.equal(hasConflictingGivens(grid), false, `conflicting transcription: ${filename}`);
  assert.ok(countSolutions([...grid], 2) > 0, `transcription has no solution: ${filename}`);
}

console.log(`ok - ${manifest.fixtures.length} photo fixtures, ${Object.keys(truth).length} scored grids`);

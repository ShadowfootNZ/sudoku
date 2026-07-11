import assert from 'node:assert/strict';
import { solveProjection, projectPoint } from '../tools/perspective.js';

const destination = [{x:0,y:0},{x:99,y:0},{x:99,y:99},{x:0,y:99}];
const source = [{x:10,y:20},{x:110,y:15},{x:120,y:130},{x:5,y:125}];
const transform = solveProjection(destination, source);
destination.forEach((point, index) => {
  const mapped = projectPoint(transform, point.x, point.y);
  assert.ok(Math.abs(mapped.x - source[index].x) < 1e-7);
  assert.ok(Math.abs(mapped.y - source[index].y) < 1e-7);
});

const identity = solveProjection(destination, destination);
const middle = projectPoint(identity, 41, 73);
assert.ok(Math.abs(middle.x - 41) < 1e-8);
assert.ok(Math.abs(middle.y - 73) < 1e-8);
assert.throws(() => solveProjection(destination, new Array(4).fill({x:1,y:1})), /Degenerate/);

console.log('ok - perspective projection');

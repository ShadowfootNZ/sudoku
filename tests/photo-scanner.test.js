import assert from 'node:assert/strict';
import { validCornerSelection } from '../js/photo-scanner.js';

assert.equal(validCornerSelection([{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}]), true);
assert.equal(validCornerSelection([{x:.1,y:.1},{x:.9,y:.9},{x:.9,y:.1},{x:.1,y:.9}]), false);
assert.equal(validCornerSelection([{x:.4,y:.4},{x:.5,y:.4},{x:.5,y:.5},{x:.4,y:.5}]), false);
assert.equal(validCornerSelection([{x:-.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}]), false);

console.log('ok - photo scanner corner validation');

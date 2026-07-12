import assert from 'node:assert/strict';

const requests = [];
globalThis.location = { pathname:'/sudoku/index.html', hostname:'example.com' };
globalThis.document = { referrer:'' };
globalThis.window = { innerWidth:1024 };
globalThis.fetch = async (url, options) => { requests.push({url, options}); return {ok:true}; };

await import('../js/analytics.js');
globalThis.trackAppFeature('photo_import_opened');

assert.equal(requests.length, 2);
const page = JSON.parse(requests[0].options.body);
const feature = JSON.parse(requests[1].options.body);
assert.deepEqual(page, {app_id:'sudoku',referrer:'',viewport_width:1024});
assert.deepEqual(feature, {app_id:'sudoku',referrer:'',viewport_width:1024,event:'photo_import_opened'});
assert.equal(requests.every(request => request.options.keepalive === true), true);

console.log('ok - lightweight feature analytics contract');

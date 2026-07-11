import assert from 'node:assert/strict';

Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
const { scannerCanLoad, loadPhotoScanner, PhotoScannerLoadError } =
  await import('../js/photo-scanner-loader.js');

assert.equal(scannerCanLoad(), false);
await assert.rejects(loadPhotoScanner(), error => {
  assert.ok(error instanceof PhotoScannerLoadError);
  assert.equal(error.reason, 'offline');
  assert.match(error.message, /internet connection/);
  return true;
});

console.log('ok - optional scanner loader offline fallback');

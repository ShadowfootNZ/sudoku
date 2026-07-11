// Optional photo-scanner delivery boundary.
//
// IMPORTANT: Keep this module and every module/model it imports out of sw.js ASSETS. The feature
// is intentionally network-on-demand and HTTP-cache only. Do not add Cache API, IndexedDB,
// localStorage, OPFS, or navigator.storage.persist() calls here.

let scannerPromise = null;

export function scannerCanLoad() {
  return navigator.onLine;
}

export async function loadPhotoScanner() {
  if (!scannerCanLoad()) {
    throw new PhotoScannerLoadError(
      'offline',
      'Photo scanning needs an internet connection. You can still enter the puzzle manually.',
    );
  }
  if (!scannerPromise) {
    // The implementation module will own the lazy OCR runtime/model fetch. Keeping the URL
    // literal here lets bundlers and static hosting retain a clear optional chunk boundary.
    scannerPromise = import('./photo-scanner.js').catch(error => {
      scannerPromise = null; // allow a later retry after a transient network failure
      throw new PhotoScannerLoadError('download', 'The photo scanner could not be loaded.', error);
    });
  }
  return scannerPromise;
}

export class PhotoScannerLoadError extends Error {
  constructor(reason, message, cause) {
    super(message, { cause });
    this.name = 'PhotoScannerLoadError';
    this.reason = reason;
  }
}

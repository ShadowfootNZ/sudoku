# Photo Puzzle Import — Implementation Plan

**Status: Phase 0 harness scaffold complete (2026-07-11).** It can decode/downscale local
images, extract and display 81 cells from a clean centered-square baseline, load filename-keyed
ground truth, measure timings, and export reports. Pure scoring metrics are unit tested. Next:
add the initial clean screenshots and ground truth, run the baseline, then implement/compare
grid detection and OCR candidates against those fixtures.

First occupancy run (2026-07-11): standardized reference and `IMG_2632.jpg` achieved 81/81
blank/nonblank accuracy; `sudoku300.jpg` achieved 62/81 because a thick low-resolution outer
border biased the cell geometry; `IMG_2627.PNG` achieved 42/81 after grid detection fell back
to a centered crop that included app chrome. Median processing remained well below 100ms.
Peak centering and line sensitivity were tuned from these results; rerun pending.

Second occupancy run (2026-07-11): `sudoku300.jpg` improved to 79/81 (97.5%). The full
`IMG_2627.PNG` remained undetected because surrounding application chrome dominates the global
projections, but a user-made crop of the same image was detected by the edge projection at
98.4% confidence in 91ms and produced the visually correct occupancy pattern. This validates
both the light-grid edge detector and the planned mandatory crop-adjustment fallback; automatic
region proposal can improve convenience but cannot replace editable cropping.

OCR comparison scaffold (2026-07-11): added a dependency-free leave-one-fixture-out template
recognizer using the same `{digits, confidence}` contract planned for model adapters. It trains
only from other selected fixtures, reports digit/exact-grid accuracy and recognition time, and
marks incorrect cells visually. This is the baseline for evaluating bundled model runtimes, not
a production recognizer. Combined five-fixture result: 264/405 cells end-to-end (65.2%, zero
exact grids), but the meaningful given-digit score was only 19/142 (13.4%). Excluding the known
bad full-screen crop, it recognized 18/112 digits (16.1%). Runtime was 0–2ms. Conclusion: raw
cross-font templates are rejected for production; they remain a speed/accuracy baseline.

Runtime direction: evaluate a small 10-class CNN exported to ONNX and run through the WASM-only
ONNX Runtime Web entry point. WASM is the compatibility baseline for Safari/iOS, Android, and
desktop; WebGPU is unnecessary for an 81-cell digit model. TensorFlow.js remains the fallback
comparison only if the same model cannot be exported or packaged cleanly. No runtime is selected
finally until measured bundle/model bytes, cold load, warm inference, and five-fixture accuracy
are recorded.

Delivery decision (2026-07-11): scanner code, OCR runtime/WASM, and model are **on-demand,
HTTP-cache only**. Keep them out of `sw.js`'s `ASSETS` precache and do not write them to Cache
Storage, IndexedDB, localStorage, or OPFS. Load the scanner entry module with dynamic `import()`
only after the user chooses photo import; that module then fetches the model/runtime from the same
web host. The browser may retain them in its ordinary HTTP cache and may evict them freely. Normal
Sudoku remains fully offline; first use (or use after HTTP-cache eviction) requires a connection,
with manual entry as the offline fallback. Do not request persistent storage.

**TODO — usage analytics:** before release, consider extending `js/analytics.js` with a small,
failure-safe named-event API and confirm that `track.php` accepts an event field. Candidate
privacy-safe events: `photo_import_opened`, `photo_import_download_started`,
`photo_import_scanned`, `photo_import_completed`, `photo_import_cancelled`, and a coarse
`photo_import_failed` reason (`offline`, `download`, `decode`, `grid`, `ocr`). Do not send image
names/content, recognized digits, confidence arrays, device identifiers, exact timings, or crop
coordinates. Analytics must remain disabled on localhost/LAN, must never block the feature, and
should distinguish “opened” from “completed” so actual usage and abandonment can be measured.

Add photo import as a progressive enhancement to the existing Custom puzzle entry flow. A
photo never starts a game directly: recognition populates the existing editable `entryGrid`,
the player reviews/corrects it, and the current conflict/uniqueness/solve checks remain the
only path to `state.newGame()`. This keeps OCR mistakes recoverable and avoids duplicating
puzzle validation.

## Product flow

1. Choosing **Custom…** still opens manual entry. Add an **Import photo** action beside the
   instructions; manual entry remains available on every device.
2. The import sheet offers **Take photo** and **Choose photo**. Hide/disable only the camera
   option when the browser cannot provide it; never hide the library/file picker.
3. After acquisition, show a large preview with a four-corner crop overlay. Auto-detect the
   Sudoku boundary when possible, but always allow dragging the corners, rotating 90 degrees,
   retaking/reselecting, and cancelling.
4. **Scan puzzle** performs perspective correction, cell segmentation, and digit recognition.
   Show determinate stages (`Preparing image`, `Finding grid`, `Reading 81 cells`) and keep the
   UI responsive.
5. Return to the normal entry grid with recognized clues filled. Mark low-confidence cells and
   select the first one. The message becomes “Review highlighted cells, correct any mistakes,
   then Confirm.” Tapping a highlighted cell and entering/deleting a digit clears its warning.
6. **Confirm** uses the existing complete/conflict/solution-count/solve pipeline. If validation
   fails, keep all imported digits editable; combine the existing error with useful navigation
   (select the first conflict, or retain low-confidence highlights).

## Acquisition strategy across devices

Use two hidden file inputs as the compatibility baseline:

- **Choose photo:** `<input type="file" accept="image/*">`; works as a conventional file
  picker on desktop and exposes the photo library/document providers on mobile.
- **Take photo:** `<input type="file" accept="image/*" capture="environment">`; requests the
  outward camera on supporting mobile browsers. The `capture` hint is not universally honored,
  so label this as a request rather than assuming a particular picker UI.

Optionally add an in-app live camera as a later enhancement using
`navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio:
false })`. It requires HTTPS/localhost, explicit permission handling, stream cleanup on every
exit and visibility change, and a fallback to the file-input camera. Do not make this a phase-1
dependency: native capture is simpler, higher resolution, and more robust in iOS/Android PWAs.

Desktop/tablet devices without a rear camera use their available webcam or file picker. Keyboard,
pointer, touch, and Pencil must all work in the crop/review UI. Do not lock the feature to user-agent
sniffing; branch on APIs and handle failure.

## Recognition architecture

Keep all image processing local in the browser; do not upload photos or add a server requirement.
Introduce modules with narrow contracts:

```text
js/photo-import.js       acquisition lifecycle, dialogs, import state, entryGrid handoff
js/image-preprocess.js   decode/orient/downscale, grid detection, homography, cell crops
js/digit-recognizer.js   model loading/inference and confidence normalization
js/photo-worker.js       CPU-heavy preprocessing/inference message protocol
models/...               versioned, self-hosted digit model assets
```

Recognition result:

```js
{
  digits: Array(81),                 // 0 for an empty or rejected cell
  confidence: Array(81),             // normalized 0..1
  uncertain: Set<number>,            // below tuned threshold or structurally suspicious
  corners: [{ x, y }, ...],          // source-image coordinates for re-editing crop
  diagnostics: { gridScore, rotation }
}
```

Pipeline:

- Decode the selected `File`, honor/correct image orientation, cap working resolution and pixel
  count before allocating canvases, and reject unsupported/corrupt/implausibly large input with a
  recoverable message.
- Convert to grayscale, normalize illumination/contrast, threshold, find long grid lines/contours,
  score quadrilateral candidates, and perspective-warp the chosen boundary to a square.
- Split the rectified square into 81 cells with a small inset so grid lines do not become strokes.
  Classify blank vs digit first, then recognize digits 1–9. Treat weak predictions as uncertain,
  not as trusted givens.
- Run expensive work in a Web Worker. Provide a main-thread Canvas fallback only where required;
  yield between cells if it is used. Revoke object URLs and release ImageBitmaps/canvases promptly.
- Start with a small self-hosted Sudoku-digit model suitable for printed puzzles. Handwriting and
  decorative fonts are out of initial scope. Before selecting a runtime, make a short spike comparing
  bundle size, cold-start time, CSP/service-worker behavior, and accuracy; avoid a CDN dependency.
- Apply cheap Sudoku-aware checks after OCR (duplicate nonzero digits in a unit) only to flag suspect
  cells. Never silently change a prediction or use the solver to invent clues.

## Phased implementation

### Phase 0 — Dataset and recognition spike

- Assemble a legally usable fixture set spanning newspaper/book print, screens, perspective angles,
  shadows, glare, folds, thick/thin grids, light/dark backgrounds, rotated images, and HEIC/JPEG/PNG
  inputs from representative iOS, iPadOS, Android, Windows, and macOS devices.
- Build a developer-only harness that runs the pipeline against fixtures and reports boundary success,
  per-cell blank/digit accuracy, whole-grid exact match, latency, peak working resolution, and model size.
- Compare candidate CV/OCR approaches and record the chosen model/runtime plus licenses. Gate progression
  on measurable targets: ≥95% grid detection on the fixture set, ≥99% per-cell accuracy after a correct
  crop, median processing under 2 seconds on a mid-range phone, and no unreviewed low-confidence digit.

Shippable: no. This prevents committing the UI and cache architecture to an unsuitable OCR stack.

### Phase 1 — Acquisition and editable handoff

- Add the import action/sheet and both file inputs to `index.html`; wire them in `app.js` without changing
  the existing `startNewGame('custom')` behavior.
- Add `photo-import.js` with cancellation-safe state and a temporary stub recognizer that imports fixture
  results into `entryGrid`.
- Refactor the current confirm validation into a named function so manual and photo-populated entry share
  exactly one path. Preserve imported entry when the picker is cancelled or recognition fails.
- Add responsive, safe-area-aware styles, 44px minimum controls, focus trapping/restoration, accessible
  status text, and reduced-motion behavior.

Verify on touch and desktop: take/choose/cancel/replace, background/resume, orientation change, keyboard
navigation, screen-reader names, and manual entry regression. Shippable behind a disabled feature flag.

### Phase 2 — Crop, correction, and grid detection

- Implement preview decoding, rotate controls, automatic boundary detection, draggable corner handles,
  perspective correction, and a “grid not found” path that keeps manual crop available.
- Keep handles operable with touch, mouse/Pencil, and keyboard; constrain/order corners and display the
  resulting 9×9 overlay before scanning.
- Move preprocessing to `photo-worker.js`, use generation/request IDs to discard stale replies, and make
  Cancel terminate work immediately.

Verify with unit fixtures for orientation, transforms, coordinates, and segmentation plus visual browser
tests at phone/tablet/desktop sizes. Stress-test huge images and repeated import/cancel cycles for memory.

### Phase 3 — Digit recognition and review UX

- Integrate the chosen local recognizer and versioned model; populate all 81 digits/confidences atomically.
- Extend entry-only UI state with uncertainty/conflict sets (do not put transient photo data in persisted
  game state). Add visual markers that do not rely on color alone and clear them after manual correction.
- Add “Adjust crop” and “Choose another” routes without losing the previous usable result until a new scan
  succeeds. Announce completion and uncertainty count through an `aria-live` region.
- Keep Confirm enabled: confidence is guidance, while existing Sudoku validation is authoritative.

Verify exact cell mapping and correction flows, conflicting OCR, zero/one/multiple-solution outcomes,
blank grids, already-complete grids, and an OCR failure. Confirm no image bytes enter localStorage,
analytics, logs, or network requests.

### Phase 4 — PWA/offline packaging and release

- Add worker/model assets to `sw.js`, bump the cache version, and verify same-origin module/worker loading.
  Prefer lazy model loading on first import; if full precaching makes install/update fragile, use a separate
  versioned runtime cache and present a clear offline “scanner not downloaded yet” fallback to manual entry.
- Document that processing happens on-device and the selected photo is discarded when the import flow ends.
- Ship behind a local feature flag, collect privacy-safe aggregate events only (opened, grid-found, completed,
  cancelled, failure category, coarse latency bucket), then enable after the device matrix passes.

Acceptance matrix: current Safari/iOS and installed iOS PWA; Safari/iPadOS with touch/Pencil; Chrome Android
and installed PWA; Chrome/Edge desktop; Firefox desktop/Android where supported. For every target test camera
permission denial, no camera, library selection, offline after first successful load, dark/light mode,
portrait/landscape, large text, low-memory recovery, and manual-entry fallback.

## Test structure

- Pure unit tests: transforms, rotation/orientation, cell indexing, confidence thresholds, conflict flags,
  stale-worker reply rejection, and validation refactor.
- Fixture regression tests: committed downscaled/cropped images with expected 81-value arrays; report both
  per-cell and exact-grid accuracy so averages cannot hide a bad puzzle.
- Browser integration tests: mock file selection and worker output for deterministic acquisition/review;
  use real worker/model fixtures in a smaller smoke suite.
- Manual hardware tests: native camera/file-picker behavior cannot be reliably emulated and is a release gate.

## Key decisions and non-goals

- Initial release uses native file/camera capture; live video with an alignment guide is a follow-up only if
  field testing shows native photos are too hard to frame.
- All OCR is local. A cloud OCR fallback would require a separate privacy, consent, retention, cost, and
  offline design decision.
- The scanner assists entry; it does not promise perfect recognition. Review is mandatory by design.
- Multiple puzzles in one photo, handwritten puzzles, solving from an image without review, saving source
  photos, and video-frame continuous recognition are out of scope for the first release.

## Main risks

- OCR accuracy varies more with grid removal, lighting, and fonts than with the classifier alone; the fixture
  corpus and editable confidence review are core functionality, not polish.
- Mobile memory pressure: decode/downscale early, cap dimensions/pixels, avoid duplicate full-resolution
  buffers, and test older devices.
- `capture` is only a browser hint. Always retain the ordinary file picker and manual entry.
- Model/runtime size can undermine this small offline PWA. Set a bundle budget during the spike and measure
  cold/warm load before choosing the library.
- Camera access via `getUserMedia()` needs a secure context and permission; keeping it optional prevents it
  becoming a compatibility blocker.

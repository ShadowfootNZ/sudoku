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

Browser-native MLP spike (2026-07-11): a reproducible Pillow/NumPy synthetic-font trainer produced
a 264,205-byte JSON model (~112,805 bytes gzip) with no inference runtime/WASM. Combined evaluation
reached 318/405 cells (78.5%) and one exact grid. On the four usable crops, given-digit accuracy
rose from the template baseline's 18/112 (16.1%) to 72/112 (64.3%): standardized reference 30/30,
handwritten-style crop 27/30, `IMG_2632.jpg` 7/25, and `sudoku300.jpg` 8/27. Model load was ~19ms
and inference 1–2ms. Conclusion: preserve this as a successful size/architecture spike, but do not
ship it—the strong font variance is unacceptable. Next improve glyph normalization/training diversity;
only add ONNX runtime if a browser-native model cannot reach the accuracy target.

MLP v2 normalization spike (2026-07-11): identical browser/trainer preprocessing crops each glyph
to its ink bounds, scales proportionally into 12×14, and centers it in 16×16. Held-out synthetic
accuracy increased from 75.7% to 99.5% while model size stayed effectively flat (264,033 bytes raw,
~112,840 bytes gzip). Awaiting the five-fixture real-image benchmark before deciding whether v2 is
a commit checkpoint or another training iteration is needed. Real-fixture result: still 72/112
(64.3%) on valid crops—no net improvement. Handwritten crop improved 27→28, `IMG_2632` 7→8,
reference stayed 30/30, and low-resolution `sudoku300` regressed 8→6. Do not commit v2 as a
milestone. Next iteration must add low-resolution/resampling and broader print-style augmentation;
synthetic validation alone is demonstrably insufficient.

MLP v3 augmentation result (2026-07-11): low-resolution resampling, stroke-weight, blur, scale,
and rotation augmentation reached 73/112 valid-crop digits (65.2%), only +1 over v1/v2. Per
fixture: handwritten crop 29/30, reference 30/30, `IMG_2632` 7/25, `sudoku300` 7/27. Model load
was ~27ms and inference 1–2ms. This confirms a plateau for the current synthetic-only two-layer
MLP. Do not commit v3 as a model milestone. Preserve the committed v1 baseline; next compare a
small convolutional model/runtime or acquire more representative training data rather than adding
more synthetic augmentation blindly.

CNN runtime spike (2026-07-11): compact two-convolution model reached 97.5% synthetic validation
and exports to 88,722-byte ONNX, but ONNX Runtime Web's required WASM is ~3.42 MiB compressed
(~3.52 MiB total), above the preferred optional-download budget. A runtime-free JavaScript export
is 452,836 bytes raw / ~197,514 bytes gzip plus a small inference module, and is verified against
PyTorch logits. Five-fixture real-image benchmark pending; prefer this route if accuracy is
competitive because it preserves the HTTP-cache-only download goal without a general ML runtime.

CNN fixture result (2026-07-11): runtime-free CNN reached 78/112 valid-crop digits (69.6%),
beating the MLP plateau's 73/112. Per fixture: handwritten crop 29/30, reference 30/30,
`IMG_2632` 13/25, and `sudoku300` 6/27; the known invalid full-screen crop remained excluded.
Model load was ~16ms, inference 34–43ms, and median total processing 114ms. Preserve as a compact
CNN checkpoint, but accuracy remains below release quality. The next highest-value work is adding
representative real/print-style training samples or improving low-resolution preprocessing—not a
larger runtime. Continue to surface uncertainty and require review in the product design.

Confidence audit: CNN softmax is severely overconfident; a ≥95% threshold retained 75.9% coverage
but only 81.2% precision, with several incorrect digits above 99.9%. Initial product policy must
mark every OCR clue as review-required. Confidence can sort review order only. The Phase 0 harness
now exports labeled normalized cells, grouped by fixture, so the next training comparison can use
representative raster data with leave-one-fixture-out validation rather than more blind synthetic
augmentation.

Representative-cell cross-validation (2026-07-11): exported 112 labeled normalized cells from
four correctly segmented fixtures. Training four independent CNNs on synthetic data plus the
other three fixtures (never the held-out fixture) reached 80/112 (71.4%), only +2 over the
synthetic-only CNN. Results: handwritten crop 29/30, reference 30/30, `IMG_2632` 13/25, and
`sudoku300` 8/27. The small correlated corpus does not solve unseen-style generalization. Phase 0
OCR accuracy work is now input-limited: acquire more independently sourced print/screenshot/photo
fixtures and ground truth before model tuning. Do not train a production model on evaluation
fixtures; maintain fixture-level separation between training and final evaluation sets.

Image-quality policy: use rectified grid resolution, not source file size. Reject below 30 pixels
per cell (<270px on the shorter grid side) with “This image is too small or unclear to read
reliably. Try a closer, sharper photo.” Warn from 30–49px/cell and require careful review; 50+
pixels/cell is adequate subject to detection/focus. The harness enforces these initial thresholds;
tune later from device photos. Ambiguous/internally inconsistent fixtures are stress tests, never
silently corrected or used as labeled training data.

Expanded-cell run (2026-07-11): `f0x7... cropped` passed detection/occupancy 81/81 and added 28
bold paper-print digits. `y4... cropped` failed segmentation at 60/81 and was excluded. The
expanded 140-cell grouped validation scored 96/140 overall; on the original four held-out fixtures
it moved only 80/112→81/112 (handwritten 30/30, reference 30/30, `IMG_2632` 12/25, `sudoku300`
9/27). One additional style is insufficient. Obtain/process `facebook cropped` plus a corrected
crop/rectification for `y4...` before retraining again.

Low-quality Facebook result: 40.4px/cell and 83.1% edge-detector confidence still yielded only
49/81 occupancy and 6/41 digit accuracy. Classify as a stress/rejection fixture, not training.
Fixed labeled export to require exact ground-truth occupancy for every fixture, including automatic
detections. Resolution/confidence alone cannot guarantee cell mapping; production always needs
editable review and a clear “try another photo” route.

Perspective checkpoint: added a dependency-free inverse homography solver and raster warp engine,
with corner-mapping, identity, and degenerate-selection tests. Next wire it to a draggable four-
corner overlay in the harness; default corners come from automatic detection and manual adjustment
must be available whenever detection/fallback segmentation is wrong.

Interactive perspective result (2026-07-12): harness now provides a modal four-handle editor with
mouse/touch/Pencil pointer input, reset/cancel, in-place 900×900 rectification, rescan, and refreshed
report/labeled export. On `y4... cropped`, manual correction improved occupancy from 60/81 to 81/81
at ~100px/cell; total processing was 239ms. OCR remained 7/25, confirming the crop is now valid and
the font/style is useful training data. Perspective checkpoint accepted.

Six-fixture grouped validation (2026-07-12): merging multiple labeled exports produced 165 unique
cells across six styles. Leave-one-fixture-out accuracy was 108/165 (65.5%). On the original four
held-out fixtures it regressed to 79/112, versus 80/112 and 81/112 in earlier runs. Results:
handwritten 27/30, `IMG_2632` 12/25, reference 30/30, low-resolution 10/27; new print styles were
19/28 and 10/25. Stop tuning this synthetic/small-corpus CNN—the evidence shows style overfitting,
not a data-volume trend. Phase 0 now requires a product decision: ship an explicitly review-heavy
OCR assist, or acquire/license a substantially broader digit dataset/model before Phase 1.

Full-folder audit (2026-07-12): 25 images exercised cropped/uncropped, corrected, low-resolution,
and unknown-ground-truth paths. Five were correctly rejected below the 30px/cell floor. Twenty
processed; eight had ground truth and only five achieved exact occupancy for labeled export (138
digits). Low-quality Facebook remained 52/81 even after manual correction and stayed excluded.
Three additional visually unambiguous rectified sources (`7c223...`, `1346524.jpg`, and
`skyscraper.webp`) now have solver-validated ground truth; other ambiguous/watermarked sources
remain stress-only. Next export labeled cells from these three without changing the held-out set.

Real newspaper cohort (2026-07-12): three device photos required manual perspective correction and
processed in 427–475ms after HEIC→JPEG conversion. Added solver-validated ground truth; reserve one
as an unseen newspaper holdout. HEIC policy: attempt native browser decode, but do not bundle a
large converter initially. On decode failure say “This browser cannot read HEIC images. Choose a
JPEG/PNG copy or take another photo.” Verify whether native camera/file pickers transcode on target
iOS/iPadOS devices during Phase 1; revisit an on-demand converter only if analytics show material
failure volume.

Harness export usability: show occupancy per result. Exact 81/81 enables export automatically;
developer-only “Approve cells for training” may override after visual verification of all 81
cell crops. It never changes metrics and must not appear in the product UI.

Real-photo training run (2026-07-12): merged 309 labeled digits across eleven fixture styles.
Leave-one-fixture-out accuracy rose to 223/309 (72.2%); newspaper folds scored 18/32, 19/28,
and the held-out `IMG_0545` 14/26. Representative camera data produces a real improvement but is
still far below automatic-entry quality. Trained CNN-JS v2 on 283 unique real cells plus synthetic
data, explicitly excluding `IMG_0545`; model remains ~453KB raw. Preserve v2 as the Phase 0
candidate and judge it using the untouched holdout below.

Untouched newspaper holdout: CNN-JS v2 recognized 13/26 digits (50%), improving v1's 9/26.
Candidate is worth preserving, but blank detection produced 58 occupied cells for 26 true clues:
32 false positives and roughly 45 required corrections (32 deletes + 13 wrong digits), worse than
manual entry. Product flow is now settled—preflight quality/detection, prompt for corners when
needed, then show an editable review grid—but Phase 1 integration waits for a texture-robust blank
detector. Confidence remains review ordering only; initially highlight every imported clue.

Background-normalized blank detection is implemented using local-mean subtraction and central
connected-component evidence. Automated texture/stroke cases pass. Next acceptance gate: rerun the
newspaper cohort and compare false-positive occupancy and total required edits with the v2 baseline
(32 false-positive blanks; approximately 45 edits).

Evaluation 22 passes the first user-value gate: all 86 newspaper clues were detected, with 14 false
positive blanks and 35 total edits across the three grids versus 86 manual entries. On untouched
`IMG_0545`, false positives fell from 32 to 8 and total edits from ~45 to 22 versus 26 manual
entries. Raise the component-area floor to discard three clearly separated 16–22px specks, rerun
the cohort, then proceed to the editable review-grid integration if no clues regress.

Evaluation 23 passes that regression gate: 86/86 clues retained, false positives reduced from 14
to 6, and 30 edits required across the cohort instead of 86 manual entries. Untouched `IMG_0545`
needs 13 edits versus 26 manual entries. Freeze blank-detection thresholds. Phase 0 is complete;
the next slice integrates on-demand acquisition/scanning with the existing custom-entry grid and
marks imported values for review.

First product slice implemented: custom entry now offers an `image/*` chooser (camera/library as
provided by the device), lazy-loads scanner code and the CNN model, runs automatic grid detection,
and fills the existing editable grid. Every imported clue is highlighted until the user changes
it; existing conflict, solution-count, and uniqueness validation remains unchanged. Scanner code,
support modules, and model remain outside the service-worker cache. Next slice: connect the manual
four-corner editor when automatic detection returns the `corners` outcome.

Manual correction is connected. Failed automatic detection opens a responsive canvas with four
numbered, pointer/touch-draggable markers and a centered-square starting proposal. Corners are kept
as normalized coordinates, the image remains only in memory, and confirmation reruns perspective
correction plus OCR. Crossed, collapsed, or out-of-range selections are rejected before scanning.

Crop-before-corners flow implemented for uncertain automatic detection. The user can resize a
rectangular crop with touch/pointer handles, cancel, or skip directly to corners. `Crop and retry`
creates an in-memory JPEG capped at 1600px and reruns automatic detection once; continued failure
opens the corner editor on that cropped image. Neither original nor crop is persisted.

iPad testing exposed a false-positive geometric detection after cropping: a plausible regular
square passed confidence but produced badly divided OCR cells. Cropped images now always present
the automatically detected corners for user confirmation before accepting OCR. This deliberately
trades one confirmation for protection against silent high-edit imports; markers should already be
near the grid when detection is correct.

Lightweight analytics added using the existing endpoint. The original app-open payload is
unchanged; photo interactions add only one fixed `event` field: `photo_import_opened`,
`photo_import_confirmed`, or `photo_import_cancelled`. Confirm/cancel are emitted only after a scan
has populated the entry grid. No filename, image metadata, pixels, puzzle digits, or cell data is
sent.

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

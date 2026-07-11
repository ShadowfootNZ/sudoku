# Photo-import evaluation harness

This is the Phase 0 developer harness for evaluating image preprocessing and future OCR
adapters before integrating them into the Sudoku UI.

## Run it

Serve the repository over localhost (ES modules do not work reliably by opening the HTML file
directly), then open `/tools/photo-harness.html`. For example, use any existing static server
or run `python -m http.server 8000` from the repository root.

Choose one or more screenshots/photos. The harness automatically loads the repository ground
truth when served from its normal location. Optionally load a different ground-truth JSON whose keys
exactly match image filenames and whose values are either 81 digits (`0` or `.` for empty) or
arrays of 81 numbers. The example is `tools/photo-fixtures.example.json`.

The repository fixture corpus is in `tests/fixtures/photo-import/`. Its `fixtures.json` records
the image type, initial difficulty tier, and notable conditions; `ground-truth.json` contains
the grids transcribed so far. Start with the four clean fixtures, verify their transcription in
the harness, and only then promote medium/hard fixtures into scored OCR evaluation.

The current baseline deliberately performs no digit OCR. It decodes/downscales each image,
detects an axis-aligned grid from ten regularly spaced horizontal and vertical lines (falling
back to the largest centered square), extracts 81 cells, classifies each as blank/nonblank,
displays them, records timings and occupancy accuracy, and exports a JSON report. This validates
orientation, cell mapping, cropping, and performance before selecting an OCR dependency.

When two or more scored images are selected together, the harness also runs a dependency-free
leave-one-fixture-out template recognizer. Each image is recognized only from labeled cells in
the other selected images, preventing self-template leakage. This is a comparison baseline, not
a production OCR proposal: run all five clean scored fixtures together and export one combined
report. A model/runtime candidate must beat its digit accuracy while meeting the size and latency
budgets.

### Current OCR baseline

The first combined run scored 264/405 cells overall, but blank cells dominate that number. The
actual given-digit score was 19/142 (13.4%), or 18/112 (16.1%) when the known failed full-screen
crop is excluded. No grid was exact. Template matching is therefore rejected as a product
recognizer; its 0–2ms recognition time is retained as the lower-bound performance reference.

The next comparison adapter should use a small 10-class ONNX CNN with the WASM-only ONNX Runtime
Web build. Record runtime JavaScript/WASM bytes separately from model bytes, and report cold model
load, warm batch inference, given-digit accuracy, exact grids, and confidence calibration.

Before accepting the ONNX runtime overhead, the harness evaluates a browser-native two-layer MLP
trained solely from synthetic Windows fonts. Its model is `models/sudoku-digits-mlp.json`; the
reproducible trainer is `tools/train-digit-model.py` and requires only Pillow and NumPy. Version 1
is 264,205 bytes uncompressed and reached 75.7% on held-out synthetic renderings. This is a model
spike, not a production selection. The harness uses it when available and falls back to the
leave-one-fixture-out template baseline if model loading fails.

The first real-fixture MLP run scored 72/112 given digits (64.3%) across valid crops, versus
18/112 (16.1%) for templates. It achieved 30/30 on the standardized reference and 27/30 on the
handwritten-style crop, but only 7/25 on `IMG_2632.jpg` and 8/27 on `sudoku300.jpg`. One grid was
exact. Load time was about 19ms and inference 1–2ms. Retain the candidate as a checkpoint, then
improve input glyph normalization and synthetic font/weight/scale diversity before accepting or
rejecting browser-native inference.

Version 2 applies the same ink bounding-box normalization in training and the browser: crop the
glyph at a 10% ink threshold, scale proportionally into 12×14, and center it in 16×16. Synthetic
held-out accuracy increased from 75.7% to 99.5%. The model remains 264,033 bytes raw and about
112,840 bytes gzip. Real-fixture evaluation is required; synthetic accuracy is not an acceptance
metric.

The v2 real-fixture run remained 72/112 given digits (64.3%), exactly equal to v1. Per-fixture
movement was +1 handwritten crop, +1 `IMG_2632`, unchanged reference, and −2 `sudoku300`.
Therefore bounding-box normalization is useful preprocessing structure but not an accuracy win by
itself. Do not use the 99.5% synthetic validation score for model selection. Expand training with
low-resolution rasterization/resampling and print-style variation, then compare on the unchanged
real fixture set.

V3 added low-resolution resampling, stroke-weight, blur, scale, and rotation augmentation. It
scored 73/112 valid-crop digits (65.2%), only one digit above v1/v2: 29/30 handwritten crop,
30/30 reference, 7/25 `IMG_2632`, and 7/27 `sudoku300`. This is a synthetic-only MLP plateau, not
a release candidate. Raw `photo-evaluation*.json` exports are ignored and may be deleted after
their results are summarized here and in the implementation plan.

The compact CNN spike exports both ONNX and a runtime-free JSON weight format. The ONNX model is
88,722 bytes, but ONNX Runtime Web adds approximately 3.42 MiB compressed WASM, putting the total
near 3.52 MiB. The custom JavaScript CNN weights are 452,836 bytes raw and about 197,514 bytes
gzip, with only a small inference module. A stored zero-input logit vector verifies JavaScript
convolution/dense output against PyTorch before fixture evaluation.

The first runtime-free CNN fixture run recognized 78/112 given digits (69.6%) on valid crops,
versus 73/112 for the best MLP. It scored 29/30 on the handwritten-style crop, 30/30 on the
reference, 13/25 on `IMG_2632`, and 6/27 on low-resolution `sudoku300`. Model load was about 16ms,
per-grid inference 34–43ms, and median end-to-end processing 114ms. This justifies preserving the
compact CNN path, but not shipping it: low-resolution/font generalization remains inadequate.

## Production delivery constraint

OCR assets are optional network resources. The scanner entry module, runtime JavaScript/WASM,
and model must not be included in the service-worker precache or written to application-managed
browser storage. They are loaded only after the user opens photo import and may be retained or
evicted by the browser's normal HTTP cache. Test both a cold online load and a cold offline failure;
the latter must return to manual entry without affecting the offline core game.

Record transfer size (compressed response bytes) and decoded resource size separately. The current
targets are under 500 KiB compressed for the model and under 2 MiB compressed for the complete
optional scanner download, with a mandatory design review above 4 MiB.

## Adding committed fixtures

Place downscaled, legally usable test images under `tests/fixtures/photo-import/` and record:

- source/device and permission to use;
- whether it is a screenshot or camera photo;
- the exact 81-cell ground truth;
- notable conditions (rotation, glare, perspective, shadows, grid/font style).

Do not commit personal photo metadata. Strip EXIF/location data and avoid including unrelated
content around the puzzle. Keep an original privately if needed, but commit only the smallest
representative test asset.

## Phase 0 scorecard

The eventual comparison report must include grid-detection success, per-cell accuracy, exact-grid
accuracy, blank accuracy, digit accuracy, decode time, total processing time, model/runtime bytes,
and failure category. The targets in `.claude/photo-puzzle-import-plan.md` remain the release gates.

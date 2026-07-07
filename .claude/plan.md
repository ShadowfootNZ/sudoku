# Sudoku — Project Plan

## Overview
A Sudoku game playable in Safari on iPad with Apple Pencil support. Hosted as a static site on GitHub Pages. No build process — pure vanilla HTML/CSS/ES modules.

**Repo:** https://github.com/ShadowfootNZ/sudoku.git  
**Live:** https://shadowfootnz.github.io/sudoku/  
**Local dev:** Live Server from VS Code → http://127.0.0.1:5500

---

## File Structure

```
sudoku/
├── index.html          # App shell, viewport meta, PWA meta tags
├── manifest.json       # PWA: standalone, portrait, icons
├── sw.js               # Cache-first service worker (currently v38)
├── icons/
│   ├── icon-192.png          # Original sudoku PWA icon (kept for SW cache)
│   ├── icon-512.png          # Original sudoku PWA icon; used as apple-touch-icon
│   ├── apple-touch-icon.png  # Footprint image (NOT used as apple-touch-icon — icon-512.png is)
│   ├── favicon.ico           # Footprint favicon
│   ├── favicon-16x16.png     # Footprint favicon
│   ├── favicon-32x32.png     # Footprint favicon
│   ├── favicon-192x192.png   # Footprint favicon; also used as header logo img
│   └── favicon-512x512.png   # Footprint favicon; used in manifest icons
├── css/
│   └── style.css       # All styles, CSS custom props, dark mode
└── js/
    ├── generator.js    # Backtracking solver + puzzle generator (main thread)
    ├── worker.js       # Unused — kept in repo, do not delete (SW caches it)
    ├── state.js        # All game state, undo/redo, localStorage
    ├── ui.js           # DOM rendering, cell class management
    ├── input.js        # Pointer events, palm rejection, Scribble
    └── app.js          # Entry point: wires modules, button handlers
```

---

## Architecture

### State → UI via Custom Events
`state.js` dispatches `CustomEvent` on `document`. `ui.js` and `app.js` listen.
- `statechange { all: true }` → `renderAll()` (full grid re-render)
- `statechange { cell: N }` → `renderPeersOf(N)` (only affected cells)
- `selectionchange` → `renderAll()` (peer/same-digit highlights depend on selection)
- `complete` → `showComplete()` (completion animation then dialog)
- `hintschanged` → `updateHintsDisplay()` + `updateRevealsDisplay()` + `updateHintBtn()`
- `errorschanged` → `updateErrorsDisplay()`
- `settingschange` → `renderAll()` + `updateHintTechnique()`

### Generator
Runs synchronously on main thread (NOT a Web Worker — module Workers failed silently in Safari and Firefox). Wrapped in double `requestAnimationFrame` in `startNewGame()` so the browser paints the loading screen before the synchronous work blocks the thread.

Difficulty is technique-graded, not just clue-count. `gradePuzzle()` solves a puzzle using only human techniques (Naked/Hidden Single → Pointing/Box-Line → Naked/Hidden Pair → Naked Triple/X-Wing/Swordfish/XY-Wing/Unique Rectangle) and returns the hardest tier actually required: easy/medium/hard/veryhard. Hidden Pair, Naked Triple, X-Wing, Swordfish, XY-Wing, and Unique Rectangle are all grouped into the single "veryhard" tier (originally split into veryhard/expert, but that split was too narrow a band to land on reliably — see below — so it was merged). `createPuzzle()` digs cells one at a time, keeping a removal only if the puzzle still grades at or below the target (never overshoots), down to a per-tier clue floor (easy=36, medium=30, hard=24, veryhard=17). `generateGraded()` retries with a fresh solution (up to 12x) only if a single dig doesn't land exactly on target, and always falls back to the closest grade achieved *below* the target — never silently serving an easier puzzle by more than one tier.
`countSolutions()` uses MRV (Minimum Remaining Values) heuristic, stops at 2 — fast uniqueness check.

**History:** "Very Hard" and "Expert" briefly existed as separate tiers, but Expert's techniques (Swordfish/XY-Wing/Unique Rectangle) kick in so close to Veryhard's (Hidden Pair/Naked Triple/X-Wing) that grids needing more than X-Wing almost always needed Expert-tier techniques too — Veryhard hit its exact target only ~10-15% of the time. Merging them into one wider "veryhard" band raised the hit rate to ~70%+ with the same generation speed. Typical generation time ~60-300ms for hard/veryhard, ~10-20ms for easy/medium.

**Unique Rectangle (2026-07-07 fix):** three detection misses were fixed: vertical rectangles were never matched (guard now `sameBand XOR sameStack` — corners must span exactly two boxes); the target corner needed BOTH pair digits (now whichever of A/B is present is eliminated, since the uniqueness argument covers each independently); and a bivalue target with a different pair was miscounted as a fourth floor corner (the detector tries each corner as target, requiring the other three to share the pair). Result: veryhard hit rate ~63%→~83%, UR firings ~5x more frequent, generation slightly faster.

**Unified technique cascade (2026-07-07, hint-chains phase 1):** the 11 technique blocks previously duplicated across `gradePuzzle` and `findHint` are now one shared table. Each detector (`findNakedSingle` … `findUniqueRectangle`) scans the candidate grid read-only and returns the first applicable step — `{ type, cell, patternCells, eliminations }` for elimination techniques, `{ type, cell, patternCells, placement }` for singles — or null. `DETECTORS` fixes the cascade order, `TECH_RANK` maps type→difficulty rank, `findStep()` returns the first match. `gradePuzzle` is a thin driver that applies the step and restarts the cascade from the top. Refactor verified behaviorally identical (0 mismatches over 101 grade + 5,220 hint comparisons) at unchanged speed.

**Hint Chains (2026-07-07, hint-chains phase 2):** `findHint(board, solution)` now returns `{ steps: [...] }` instead of `{ type, cell }` — the full ordered chain of every technique the cascade applied to reach a placement, not just the final one. Each step is exactly the detector's step object (`type`, `cell`, `patternCells`, and `eliminations` or `placement`); recording stops at the first `placement` step, or returns `{ type: 'stuck' }` if the cascade gets stuck first (partial chains are discarded, not surfaced). `{ type: 'error' }` is unchanged. This replaces the old fallback-tracking logic in `findHint` entirely. Verified: 80 full simulated solves (20/tier) with the chain followed step-by-step, 22,072 assertions (chain well-formedness, elimination soundness against the solution, step reproducibility), 0 errors/stuck.

**Hint Chains state model (2026-07-07, hint-chains phase 3):** `state.js` now stores the chain directly (`hintChain`/`hintStep`) instead of a single cell/technique; see "Hint / Peek System" above for the derived getters, stepper actions, and stricter invalidation rule. Verified with a Node smoke test stubbing the browser globals: 21 assertions covering chain population, stepper clamping, invalidation from every mutator, and undo/redo carrying the chain correctly.

**Hint Chains UI (2026-07-07, hint-chains phase 4 — feature complete):** the pill became a real stepper and the grid gained per-step highlighting; see "Hint Chain Cell Highlights" and "Hint Technique Pill (Stepper)" above for the details. This was the last phase — the hint-chains feature (spec in todo.md) has fully shipped. Verified in a real headless-Chromium browser against a local static server: stepped real 4-step and 7-step Very Hard chains and confirmed highlight sets genuinely differ per step, Prev/Next clamp and re-enable correctly at both boundaries, dismiss hides only the pill (grid highlights + chain persist), filling a cell clears both, both themes render the new purple tones legibly, and zero browser console errors throughout. Phase 5 (chain relevance pruning) remains optional. See `.claude/hint-chains-plan.md`.

### State Schema (localStorage key: `sudoku-save`)
```json
{
  "given":        [0,5,0,...],   // 81 ints, 0=empty
  "answer":       [0,0,3,...],   // user entries
  "notes":        [[],[1,3],...], // candidate sets per cell (serialised as arrays)
  "solution":     [7,5,9,...],
  "difficulty":   "medium",
  "conflictCheck": true,
  "notesMode":    false,
  "hintsUsed":    0,             // peek (answer reveals) count
  "hintsPointed": 0,             // hint (cell highlight) count
  "errors":       0,             // conflicting digit placements (conflictCheck ON only)
  "selected":     -1,
  "fillOrder":    [14,72,3,...]  // cell indices in order they were filled by player
}
```

### Hint / Peek System
Single `🔍 Hint` button with two modes:
- **Hint mode** (`🔍 Hint`): calls `findHint()` in `generator.js`, which returns `{ steps: [...] }` — the ordered chain of every technique applied from the current board to a placement (see "Hint Chains" below). `state.getHint()` stores it as `hintChain` (steps array) + `hintStep` (index, starts at 0), increments `hintsPointed` once per chain, and selects the placement cell. Button label changes to `👁 Peek`.
  - `hintCell`/`hintTechnique` are **derived getters** over the chain (kept for the Peek button flow): `hintCell` = the chain's last step's placement cell (or -1 with no chain); `hintTechnique` = the *current* step's type, i.e. `hintChain[hintStep].type`.
  - `hintStepNext()`/`hintStepPrev()` advance/retreat `hintStep`, clamped to `[0, chain.length-1]`, emitting `hintstepchanged` — consumed by `renderHintStep()` in `ui.js` (full `renderAll()` + pill update, since a step's highlighted cells can be scattered anywhere on the board).
- **Peek mode** (`👁 Peek`): reveals the solution value for the **currently selected cell** (not necessarily `hintCell`), increments `hintsUsed`.
- **Invalidation (stricter than the pre-chain version)**: the whole chain is cleared — via a shared `invalidateHint()` — on *any* board mutation: `setValue`, `clearCell`, `toggleNote`, `fillCandidates`, `fillAllCandidates`, `peekCell`. Previously only clearing the specific hinted cell cleared the hint; now any mutation does, since a recorded chain's eliminations are only valid against the exact candidate state they were computed from.
- Undo/redo carry `hintChain`/`hintStep` in the history snapshot exactly as they carried `hintCell`/`hintTechnique` before — restoring a snapshot naturally restores whatever chain (or lack of one) was active at that point.
- Header shows: `🔍N` (pointer count) · `👁N` (reveal count) — both hidden when 0.

### Hint Chain Cell Highlights
`renderCell()` in `ui.js` reads `state.hintChain[state.hintStep]` on every render:
- The **final step** (always a naked/hidden single — the only two detectors with `.placement`) keeps the pre-chain `.hint-cell` treatment on the placement cell — though in practice that cell is already `.selected` (from `getHint()`'s `selectCell()` call), which takes visual priority.
- **Earlier steps** get two new classes: `.hint-pattern` on every cell in `step.patternCells` (the cells that justify the technique — strong purple, `--hint-pattern-bg`), and `.hint-elim` on every cell targeted by `step.eliminations` (candidates being removed — muted purple/lavender, `--hint-elim-bg`). Both have light/dark custom-property pairs chosen not to collide with peer/match/legal/conflict/hover colors.
- Stretch goal included: a note digit that an elim step removes gets `.note.eliminated` (strike-through, conflict-red) if the player has that candidate noted.
- These three classes are mutually exclusive with `.selected` and the peer/match/legal group in `renderCell()`'s if/else chain — same precedence pattern the old single `.hint-cell` class used.

### Hint Technique Pill (Stepper)
When a hint chain is active, a dismissible pill floats above the controls: `‹ Step 2 of 4 — Hidden Pair ›` when `settings.showStrategyOnHint` is true, or just `‹ Step 2 of 4 ›` when it's false (the step count itself is useful even without technique names — a deliberate change from the pre-chain pill, which hid entirely when the setting was off).
- Element: `#hint-technique` at body level (sibling of `#app`), `position: fixed; bottom: calc(env(safe-area-inset-bottom, 0px) + 184px)` — keeps it above `#controls` on all devices.
- `#hint-step-prev`/`#hint-step-next` (`.hint-step-btn`, 44×44px touch targets) call `state.hintStepPrev()`/`hintStepNext()`; disabled at the chain's boundaries via `updateHintTechnique()` in `ui.js`.
- Close button (`#hint-technique-close`) sets `_techniqueDismissed = true` in `ui.js`; next hint resets the flag. Dismissing only hides the pill text — grid highlights and the chain persist (same precedent as the pre-chain pill).
- Confirmed working on iPad Safari as a plain pill (2026-07-06); the phase-4 stepper controls (Prev/Next sizing/spacing, purple highlight legibility) verified so far only in a desktop headless-Chromium browser — see Potential Issues to Watch in todo.md for the on-device follow-up.

### Header Stats
Three emoji counters, all hidden when zero (using HTML `hidden` attribute set in JS):
- `❌N` — errors (conflicting placements when conflict check ON)
- `🔍N` — hints used (cell highlights)
- `👁N` — peeks used (answer reveals)

### Completion Animation
Triggered from `showComplete()` in `ui.js`:
1. `state.fillOrder` provides cell indices oldest-first; reversed so last-placed flashes first.
2. Each cell in the reversed order gets `.completing` class + staggered `animationDelay`. Total stagger capped at 600ms: `delay = (i / (n-1)) * min(600, (n-1)*30)`.
3. `@keyframes completion-flash` does transparent → gold (`rgba(245,197,24,0.88)`) → transparent over 480ms.
4. Dialog appears via `setTimeout` after stagger + flash duration + 80ms buffer (~1.1s total).
5. `fillOrder[]` is tracked in state: `setValue()` and `peekCell()` remove-then-push the cell; `clearCell()` splices it out; snapshots include it so undo restores the sequence correctly.

### Help Dialog
- `?` button in header triggers `showHelp()` → `showOverlay('help-dialog')`.
- Uses the same overlay/dialog system as resume and complete dialogs.
- `max-width: min(80vw, 800px)` — wider than other dialogs; scrollable content area.
- Six sections: Hint & Peek, Notes Mode, Fill Candidates, Conflict Check, Remaining Count, Apple Pencil.

### Palm Rejection
`penActive` flag + 500ms release window. Touch events debounced 50ms to allow concurrent pen `pointerdown` to arrive first and set `penActive`.

### Scribble (Apple Pencil handwriting)
Hidden `<input id="scribble-input">` — `position: fixed`, repositioned over the hovered/tapped cell. Only focused on `pointerType === 'pen'`; finger taps do NOT focus it (avoids keyboard popup).

**Critical rules (hard-won):**
1. `focusScribble()` must be called during `pointerover` (hover), not only on `pointerdown`. Scribble decides to activate during hover; if the input isn't on-screen at that point it treats the gesture as a tap.
2. In `pointerdown`, capture `cellEl = e.target.closest('[data-cell]')` BEFORE calling `handleCellSelect()`. `handleCellSelect` triggers `renderAll()` which replaces innerHTML of all cells, detaching any child elements (`.digit`, `.note` spans). `getBoundingClientRect()` on a detached element returns `{0,0,0,0}`, silently repositioning the input off-screen.
3. Do NOT call `e.preventDefault()` for pen `pointerdown`. WKWebView may pass that signal to the OS, suppressing Scribble activation. Scroll/zoom are covered by `touch-action:none`; text selection by `user-select:none`.
4. After handling a Scribble `input` event, call `scribble.blur()`. iPadOS marks the handwriting session complete and won't capture another stroke while the input stays focused. The next `pointerover` re-focuses via `focusScribble()`.
5. Track `scribbleCell` (cell index currently under the input). In the `input` and `keydown` handlers, if `scribbleCell !== state.selected`, call `state.selectCell(scribbleCell)` — Scribble may have suppressed `pointerdown`, leaving the wrong cell selected.

**Scribble-ready indicator:** `#scribble-input:focus` has `opacity:1` + green tint/border, overlaying the selected cell. Shows the player that handwriting is being captured. Disappears on blur (after each write), reappears on next hover.

---

## Settings

**Implemented.** ⚙️ button in `#mode-controls` opens a settings dialog using the existing overlay/dialog system. `js/settings.js` holds defaults and persists to `sudoku-settings` localStorage key.

### Current settings schema
```json
{
  "highlightPeers":     false,
  "highlightMatches":   true,
  "highlightLegal":     false,
  "conflictCheck":      true,
  "fontSize":           "medium",
  "showStrategyOnHint": false
}
```

### Defaults note
Changing defaults in `settings.js` only affects fresh installs (no prior `sudoku-settings` in localStorage). Existing users keep their saved values. A "Reset to defaults" button (planned — see todo) will let users clear their saved settings.

### Dialog UI
- **Font Size**: segmented control (Small/Medium/Large), `.seg-btn[data-key][data-value]`
- **Highlights group**: toggle rows for peers, matches, legal, errors — `.toggle-btn[data-key]`
- **Hints group**: toggle row for `showStrategyOnHint`
- `updateSettingsDialog()` in `app.js` syncs button states on open

---

## Key Bugs Fixed (history)

| Bug | Root cause | Fix |
|-----|-----------|-----|
| Spinner never resolved | Module Web Workers fail silently in Safari+Firefox | Moved generator to main thread, double rAF |
| Grid invisible | `min(100cqw - 20px, ...)` invalid CSS | `aspect-ratio:1/1; max-height:100%` |
| Font sizes wrong | `cqmin` units not widely supported | Changed to `vmin` |
| Spinner never hid after generation | `display:flex` in author CSS overrides UA `[hidden]{display:none}` (no `!important`) | Added `[hidden]{display:none!important}` to reset |
| Browser cache serving stale JS | Service worker cached old `app.js` under `sudoku-v1` | Bumped cache version; fixed `skipWaiting`/`clients.claim` order |
| Keyboard popped up on finger tap | `focusScribble()` called for all pointer types | Only call `focusScribble()` for `pointerType === 'pen'` |
| Pinch zoom gets stuck | iOS ignores `user-scalable=no` | Added `touch-action:none` on `html,body` |
| Scribble overlay off-screen | Hidden input at `left:-9999px`; Scribble needs field on-screen | Reposition input over tapped cell using `getBoundingClientRect()` |
| Scribble inconsistent — no ink mark | `focusScribble()` only called on `pointerdown`; Scribble decides during hover | Move `focusScribble()` to `pointerover` handler; keep as fallback in `pointerdown` |
| Scribble input repositioned to 0,0 | `e.target` (a `.digit`/`.note` child) detached by `renderAll()` before `focusScribble()` call | Capture `cellEl` before `handleCellSelect()` in `pointerdown` |
| Scribble suppressed by `preventDefault` | WKWebView passes `preventDefault()` signal to OS, blocking Scribble | Don't call `preventDefault()` for pen `pointerdown` events |
| Second consecutive Scribble write fails | iPadOS treats session as done while input stays focused | Call `scribble.blur()` after each handled input event; hover re-focuses |
| Wrong cell selected for Scribble input | Scribble can suppress `pointerdown`, leaving old cell selected | Guard in `input`/`keydown` handlers: `selectCell(scribbleCell)` if mismatch |
| Help button tap had no effect | `showOverlay()` called directly in app.js without being imported | Added `showHelp()` wrapper to ui.js; imported in app.js |

---

## CSS Notes
- `[hidden] { display: none !important; }` is REQUIRED in the reset — without it, any `display:X` rule in the author stylesheet wins over the HTML `hidden` attribute.
- Grid sizing: `aspect-ratio:1/1; width:100%; max-height:100%` keeps the grid square in its flex container.
- Font sizes use `vmin` not `cqmin` (container query units have limited support).
- Dark mode via `@media (prefers-color-scheme: dark)` overriding CSS custom properties.
- `touch-action: none` on `html, body` — effective zoom prevention (viewport meta `user-scalable=no` is ignored by iOS 10+).
- Numpad buttons: `position: relative`; `.num-digit` centred; `.num-remaining` is `position: absolute; bottom: 4px; right: 6px` — corner badge without affecting digit centering.
- Header stats (`#header-stats`): flex row with `❌N` / `🔍N` / `👁N` spans. Each span uses HTML `hidden` attribute (toggled in JS) to disappear when count is 0.
- Completion animation: `.cell.completing` + `@keyframes completion-flash` (gold rgba); `transition: none` on `.completing` to prevent the cell's normal `transition: background` from interfering.
- Help dialog: `max-width: min(80vw, 800px)`; `#help-content` has `overflow-y: auto; flex: 1; min-height: 0` so title and Got It button stay fixed while content scrolls.
- Hint stepper (`.hint-step-btn`): `min-width/min-height: 44px` for the touch target while keeping the pill's font-size small — the pill's height grows to fit the 44px buttons (flex `align-items: center`), a deliberate tradeoff of pill compactness for iPad touch accessibility.

## PWA / Icons Notes
- Service worker cache name is `sudoku-v38`. Bump this any time cached files need to be force-evicted.
- `sw.js` itself is NOT cached by the SW (intentional) — browser always fetches it fresh on navigation for update checks.
- **Update flow**: install handler does NOT call `skipWaiting()`. New SW installs, then waits. App detects `reg.waiting` (or `updatefound` → `statechange === 'installed'`) and shows "Update available" row in Settings → App group. User taps "Update" → `postMessage('SKIP_WAITING')` → SW activates → `controllerchange` → `location.reload()`. Settings (localStorage) survive the reload.
- `worker.js` IS in the SW's ASSETS list — don't remove the file even though it's unused.
- **Browser favicon**: footprint icons (`favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`).
- **iPad/iPhone home screen** (`apple-touch-icon`): `icons/icon-512.png` — the sudoku image, NOT the footprint.
- **PWA manifest icons**: `favicon-192x192.png` + `favicon-512x512.png` (footprint) for Android/Chrome installs.
- **Header logo**: `favicon-192x192.png` displayed at 28×28px, left of the "Sudoku" h1.

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
├── sw.js               # Cache-first service worker (currently v23)
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

### Generator
Runs synchronously on main thread (NOT a Web Worker — module Workers failed silently in Safari and Firefox). Wrapped in double `requestAnimationFrame` in `startNewGame()` so the browser paints the loading screen before the synchronous work blocks the thread.

Difficulty clue counts: easy=36, medium=30, hard=25, veryhard=22.
`countSolutions()` uses MRV (Minimum Remaining Values) heuristic, stops at 2 — fast uniqueness check.

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
- **Hint mode** (`🔍 Hint`): finds a naked-single or constrained empty cell, highlights it yellow (`hintCell`), increments `hintsPointed`, selects the cell. Button label changes to `👁 Peek`.
- **Peek mode** (`👁 Peek`): reveals the solution value for the **currently selected cell** (not necessarily `hintCell`), increments `hintsUsed`. `hintCell` is cleared only when the hinted cell has a value — so peeking a different cell leaves the hint active.
- `hintCell` is also cleared when the player fills it themselves (in `setValue()`).
- Undo restores `hintCell` (it's in the history snapshot alongside `hintsUsed`).
- Header shows: `🔍N` (pointer count) · `👁N` (reveal count) — both hidden when 0.

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

A ⚙️ button in the header (next to `?`) opens a settings dialog using the existing overlay/dialog system.

### Storage
Settings live in a separate `sudoku-settings` localStorage key so they survive new games:
```json
{
  "conflictCheck":       true,
  "highlightSameDigit":  true,
  "highlightLegalEntry": true,
  "highlightNotes":      true,
  "fontSize":            "medium"
}
```
`conflictCheck` migrates here from the game save (keep reading it from the game save for backwards compat; write it to both during transition, or just move it cleanly).

### Font size
Three steps — Small (0.8×), Medium (1.0×), Large (1.25×) — implemented as a CSS custom property:
```css
:root { --font-scale: 1; }
```
Set on `<html>` via JS on load and on change:
```js
document.documentElement.style.setProperty('--font-scale', scale);
```
Font rules use `calc()`:
```css
.digit { font-size: max(14px, calc(var(--font-scale) * 5cqmin)); }
.note  { font-size: max(9px,  calc(var(--font-scale) * 3cqmin)); }
```

### Highlight toggles
Each highlight toggle (same-digit, legal-entry, note) is a boolean in the settings object. In `renderCell`, pass the settings through to the class/HTML logic — skip adding the CSS class when the toggle is off. No CSS-override tricks needed.

`ui.js` imports a `settings` module (similar pattern to `state.js`) that exposes the current values and a `set(key, value)` method that persists and triggers a `renderAll()`.

### Dialog UI
Reuse the existing overlay/dialog structure. Controls:
- Toggle rows (label + iOS-style checkbox or simple toggle button) for the four on/off settings
- Segmented control or three buttons for font size
- "Done" button closes the dialog

### Header change
- Add `<button id="settings-btn">⚙️</button>` next to `#help-btn`
- Remove `✅ Check` from `#mode-controls` (now a 4-button row: Notes, Undo, Fill, Hint/Peek)

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

## PWA / Icons Notes
- Service worker cache name is `sudoku-v26`. Bump this any time cached files need to be force-evicted.
- `sw.js` itself is NOT cached by the SW (intentional) — browser always fetches it fresh on navigation for update checks.
- `worker.js` IS in the SW's ASSETS list — don't remove the file even though it's unused.
- **Browser favicon**: footprint icons (`favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`).
- **iPad/iPhone home screen** (`apple-touch-icon`): `icons/icon-512.png` — the sudoku image, NOT the footprint.
- **PWA manifest icons**: `favicon-192x192.png` + `favicon-512x512.png` (footprint) for Android/Chrome installs.
- **Header logo**: `favicon-192x192.png` displayed at 28×28px, left of the "Sudoku" h1.

# Code Review — Full Codebase Pass

**Date:** 2026-07-08 · **Scope:** all app source (`js/`, `index.html`, `sw.js`, `manifest.json`, `css/style.css` cross-checks, `tests/`) at commit `f069695`. Follow-up fixes are tracked below; `node tests/generator.test.js` passes 9/9.

**Overall:** The codebase is in good shape. The module boundaries (state / ui / input / generator / settings) are clean, the event-driven rendering is consistent, and the solver/detector code is careful — I specifically checked the XY-Wing self-elimination edge case, Unique Rectangle soundness guards, grader termination, and the `createPuzzle` dig loop, and found no correctness defects in any of them. All previously reported High findings are now fixed and covered by tests. The findings below are mostly robustness and polish items; nothing is game-breaking for generated puzzles.

---

## Resolved since the previous review

1. **Solver helpers now self-guard against conflicting givens** — `countSolutions()` returns 0 and `solve()` returns null when `hasConflictingGivens()` is true (js/generator.js:128–131, 147–151), exactly as recommended. Regression tests cover both (tests/generator.test.js:49–55). ✅
2. **Keyboard input blocked while dialogs are open** — the global keydown handler exits when `#overlay` is visible (js/input.js:166). ✅
3. **Service worker origin check** — same-origin GET filter is now enforced, not just commented (sw.js:48–49). ✅
4. **Notes excluded from undo** — documented as intentional in code (js/state.js:235–237) and stated in commit history. Treated as by-design; no longer tracked here.
5. **Stale `js/worker.js`** — deleted in commit `99f7295`. Main-thread generation itself remains deferred (see Known/Deferred below).

---

## Findings

### 1. Medium — `state.load()` can accept a malformed save and crash the app on first render — **DONE 2026-07-08**

js/state.js:326–350 validates only that `given` and `solution` are arrays. If a save has those but a missing/corrupt `answer` (e.g. from a future format change, partial write, or manual edit), `_s.answer` becomes `undefined`, `load()` still returns `true`, and the first `renderCell()` throws (`s.answer[i]` on undefined) — every load thereafter. Because the crash happens after `load()` succeeds, there is no fallback to a fresh game; the app is bricked until localStorage is cleared manually.

Notably, a missing `notes` field *is* handled (the `.map` throws inside the try/catch → returns false), which shows the intent — `answer` just isn't covered.

**Recommendation:** extend the guard to all three board arrays, including length:

```js
const boardOk = a => Array.isArray(a) && a.length === 81;
if (!boardOk(d.given) || !boardOk(d.solution) || !boardOk(d.answer) || !Array.isArray(d.notes)) return false;
```

This is cheap insurance for a save format that has already evolved several times (`fillOrder`, `hintsPointed`, etc. all use `??` fallbacks — the array fields deserve the same care).

### 2. Medium — Hint button is silently dead when the solver is stuck (custom puzzles) — **DONE 2026-07-08**

js/state.js:261: when `findHint()` returns `{ type: 'stuck' }`, `getHint()` just returns. The `error` case gets UI feedback ("⚠️ Fix errors", js/app.js:148–153); the stuck case gets nothing — the button appears broken.

Generated puzzles can't hit this: `createPuzzle()` only keeps a removal if the puzzle still grades non-null (js/generator.js:178–181), so every generated puzzle is fully solvable by the detector cascade. But **custom puzzles** are only validated for uniqueness, not gradeability — a valid custom puzzle requiring techniques beyond the 11 detectors will make Hint a silent no-op.

**Recommendation:** emit a `hintstuck` event and flash the button (mirroring the `hinterror` pattern), e.g. "🤷 No hint found". Two-line change in state.js plus one listener in app.js.

### 3. Low/Medium — First-ever visit gets an automatic page reload mid-session — **DONE 2026-07-08**

sw.js:43 calls `self.clients.claim()` on activate, and js/app.js:110 reloads on every `controllerchange`. On the very first visit the SW installs, activates, claims the page → `controllerchange` fires → `location.reload()`, likely right around when the first puzzle has just been generated. The user sees the app restart, then (since `newGame()` already saved) a "Resume game?" dialog for a puzzle they never touched. One-time, but it's the worst possible first impression, and it's the standard gotcha with this pattern.

**Recommendation:** only reload when the change was user-initiated — set a flag in the update-button click and check it:

```js
let updating = false;
// in showUpdateAvailable: onclick = () => { updating = true; sw.postMessage('SKIP_WAITING'); }
navigator.serviceWorker.addEventListener('controllerchange', () => { if (updating) location.reload(); });
```

(Alternatively drop `clients.claim()`; the first SW then takes control on the next natural navigation.)

### 4. Low — Analytics fires during LAN testing sessions — **DONE 2026-07-08**

js/analytics.js:30 suppresses tracking only for `localhost`/`127.0.0.1`. Your iPad-testing workflow serves over a LAN IP (`192.168.x.x`), so every debug session on the iPad posts a real hit and pollutes the stats.

**Recommendation:** add a private-range check:

```js
if (/^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname)) return;
```

### 5. Low — Input is not blocked during the completion animation window — **DONE 2026-07-08**

`showComplete()` (js/ui.js:262–300) delays the dialog by up to ~1.16 s (`maxStagger` 600 + flash 480 + 80). During that window the overlay is still hidden, so keyboard and pointer input reach the solved board — the user can clear a cell or hit undo mid-flash, and the "Puzzle Complete!" dialog still appears over a now-incomplete board. Harmless for solo play but visibly wrong when it happens.

**Recommendation:** set a `completing` guard consumed by the input handlers, or show the overlay (transparent) immediately and reveal the dialog after the timeout.

### 6. Low — "New Game" wipes an in-progress custom entry without confirmation — **DONE 2026-07-08**

js/app.js:54–55: with the difficulty select on "Custom…", clicking New Game while already in entry mode calls `enterEntryMode()` again, which resets `entryGrid` to empty (js/app.js:25). Someone 30 givens into transcribing a newspaper puzzle loses everything with one mis-tap. Other destructive paths (Clear all, delete-on-empty) get a confirm dialog; this one doesn't.

**Recommendation:** if `inEntryMode` and the grid is non-empty, route through the existing clear-confirm dialog (or simply make re-entering entry mode preserve the current `entryGrid`).

### 7. Low — Undo refunds peeks but not errors (scoring asymmetry) — **DONE 2026-07-08**

`snapshot()` includes `hintsUsed` (js/state.js:76), so undoing a peek decrements the 👁 reveal counter — but `errors` is not snapshotted, so undoing a conflicting entry leaves ❌ permanently incremented. Also, since the peeked digit is what triggers the completion grading (`flash-peek` when `hintsUsed > 0`, js/ui.js:270), a player can peek, memorize, undo, and retype the digit to get a "no help" completion while `hintsPointed` alone records the hint.

If errors-are-permanent is the intent (reasonable — it's a penalty), consider making `hintsUsed` permanent too for consistency: drop it from `snapshot()`/`restoreSnapshot()`. One-line each.

### 8. Low — Keyboard quirks in the global handler (desktop convenience path) — **DONE 2026-07-08**

js/input.js:161–182:

- **Arrow keys with no selection**: from `selected === -1`, ArrowRight selects cell 0 and ArrowDown selects cell 8 (the arithmetic `-1 + 1` / `-1 + 9` passes the bounds checks). ArrowDown landing on the top-right corner is surprising; either guard `state.selected === -1` or deliberately map "no selection + any arrow" to cell 0.
- **Case-sensitive undo/redo**: `e.key === 'z'` misses `Z` — CapsLock breaks Ctrl+Z, and Ctrl+Shift+Z (the most common redo chord) does nothing. Compare `e.key.toLowerCase()` and treat Ctrl+Shift+Z as redo.
- **No focus check**: digits/Backspace apply to the grid even when another control (e.g. the difficulty select) has focus. Minor on desktop, invisible on iPad.

### 9. Low — Redo is unreachable on the primary platform — **DONE 2026-07-08**

Redo exists only as Ctrl/Cmd+Y (js/input.js:175–177). The primary device is an iPad with no keyboard, so redo is effectively dead code there — and a mis-tapped Undo is unrecoverable. Consider a long-press on Undo, or a second button while `redoStack` is non-empty.

---

## Known / deferred (tracked, not re-argued here)

- **Puzzle generation runs on the main thread** (js/app.js:60–76 double-rAF workaround). Tracked in `.claude/todo.md`; the veryhard path with 12 grading attempts is the worst case. When revisited, a fresh worker should call `generateGraded()` and guard against stale responses.

---

## Cleanups / nits

- **Stale comment:** **DONE 2026-07-08**. js/generator.js now describes itself as pure solver/puzzle logic imported by app code and Node tests.
- **Stale comment:** **DONE 2026-07-08**. js/settings.js no longer marks `showStrategyOnHint` as future work.
- **Duplicated `buildPeers()`:** **DONE 2026-07-08**. state.js now re-exports `PEERS` from generator.js instead of recomputing the same peer list.
- **Entry-mode numpad shows stale remaining-counts:** **DONE 2026-07-08**. Entry mode now counts from `entryGrid` and refreshes badges after entry/delete/clear actions.
- **Hint→Peek no-op:** **DONE 2026-07-08**. Peek now reveals the selected cell when one exists, otherwise it falls back to the hinted cell.
- **Manifest icons:** **DONE 2026-07-08**. Added padded `favicon-192x192-maskable.png` and `favicon-512x512-maskable.png`, split manifest entries into `any` and `maskable`, and cached the new assets in `sudoku-v46`.
- **`analytics.js` is not in the SW asset list:** **DONE 2026-07-08**. Added `js/analytics.js` to `ASSETS`; later icon work bumped the cache to `sudoku-v46`.
- **a11y nit:** **DONE 2026-07-08**. `#scribble-input` no longer uses `aria-hidden="true"` while receiving programmatic focus; it now has `role="presentation"` and `aria-label="Handwriting input"`.

---

## Test gaps

Current coverage (tests/generator.test.js) is solver-plumbing only. Highest-value additions, in order:

1. **Detector unit tests** — **OPEN**. One fixture per technique asserting `findStep()` identifies it with the expected placements/eliminations. The 11 detectors are the most intricate logic in the app and have zero coverage; a refactor there would currently fail silently.
2. **`gradePuzzle` sanity** — **OPEN**. A known-easy and known-hard fixture asserting the returned grade, plus "returns null for a guessing-required puzzle" (protects the Finding 2 invariant that generated puzzles are never stuck).
3. **`state.load()` robustness** — **DONE 2026-07-08**. Added `tests/state-load.test.js` malformed-save fixtures for missing `answer`, wrong board lengths, invalid `notes`, and non-array note entries.
4. **`findHint` chain shape** — **OPEN**. The invariant that a returned chain always ends in a step with `placement` (js/state.js depends on it via `hintCell`).

---

*This review replaces the previous follow-up review. Follow-up implementation status is recorded in the plan below.*

---

## Fix Plan

### Phase 1 — Prevent broken or silent core flows

1. **Harden saved-game loading** (Finding 1) — **DONE 2026-07-08**
   - Added `boardOk()` / `notesOk()` guards in `state.load()` for `given`, `solution`, `answer`, and `notes`.
   - `load()` now validates the saved payload before mutating `_s`, so a malformed save cannot half-load and crash first render.
   - Added `tests/state-load.test.js` coverage for a valid save, missing `answer`, wrong board lengths, invalid `notes`, and non-array note entries.

2. **Show feedback when no hint is available** (Finding 2) — **DONE 2026-07-08**
   - `state.getHint()` now dispatches `hintstuck` when `findHint()` returns `type: 'stuck'`.
   - `app.js` listens for `hintstuck` and temporarily flashes the Hint button as "No hint found", matching the existing `hinterror` pattern.
   - Added a state-level regression in `tests/state-load.test.js` asserting the stuck-hint event is emitted.

3. **Stop first-install service-worker reloads** (Finding 3) — **DONE 2026-07-08**
   - Added an `updateReloadRequested` flag in `app.js`.
   - The Settings Update button sets the flag before posting `SKIP_WAITING`.
   - `controllerchange` now reloads only when that flag is set, so first-install `clients.claim()` no longer restarts the app mid-session.
   - Intentional update reloads call `state.save()` before `location.reload()`.
   - Bumped the service-worker cache; the current cache name is `sudoku-v46`.

### Phase 2 — Protect active user input

4. **Block edits during completion animation** (Finding 5) — **DONE 2026-07-08**
   - Added a `completing` state flag raised by `showComplete()` while the completion flash is pending.
   - State mutators, pointer/keyboard selection, undo/redo, delete, hint, fill, notes, numpad, settings, and help paths now ignore input while the lock is active.
   - `hideOverlay()`, `startNewGame()`, `newGame()`, `resetPuzzle()`, and `load()` clear the lock; delayed completion callbacks now skip stale dialogs.
   - Added a state-level regression for the completion lock.

5. **Avoid wiping custom entry mode** (Finding 6) — **DONE 2026-07-08**
   - Re-entering Custom mode while already transcribing preserves the current `entryGrid`.
   - Explicit clear/reset paths still clear the entry grid.
   - Entry-mode remaining-count badges now reflect `entryGrid` instead of stale puzzle counts.

6. **Fix desktop keyboard quirks** (Finding 8) — **DONE 2026-07-08**
   - Keyboard shortcuts now normalize via `e.key.toLowerCase()`.
   - Ctrl/Cmd+Shift+Z now performs redo, alongside Ctrl/Cmd+Y.
   - Arrow keys with no selection consistently select cell 0 first.
   - Global grid shortcuts are ignored when focus is in normal form controls outside the Scribble input.

### Phase 3 — Align scoring and primary-platform controls

7. **Decide permanent vs undoable penalties** (Finding 7) — **DONE 2026-07-08**
   - Product decision: counters represent information already given to the player, so they are permanent penalties rather than undoable board state.
   - Removed `hintsUsed` from undo snapshots so peeks cannot be refunded.
   - Added a regression asserting peek/undo keeps the reveal counter charged while undoing the revealed digit.

8. **Expose redo on touch devices** (Finding 9) — **DONE 2026-07-08**
   - Added a long-press Undo gesture that reveals a floating Redo target only when redo history exists.
   - Releasing over the floating target runs redo; releasing elsewhere cancels without undoing.
   - Added `state.canRedo` for UI affordances and a regression covering redo availability.

### Phase 4 — Low-risk cleanups

9. **Suppress analytics on private networks** (Finding 4) — **DONE 2026-07-08**
   - Added an `isLocalOrPrivateHost()` guard in `analytics.js`.
   - Analytics is now suppressed for `localhost`, `127.0.0.1`, `10.x.x.x`, `172.16-31.x.x`, and `192.168.x.x`.

10. **Tidy stale comments and duplication** — **DONE 2026-07-08**
    - Reworded the `generator.js` top comment now that the worker is gone.
    - Removed "(future)" from `settings.js`.
    - `state.js` now re-exports `PEERS` from `generator.js` and no longer has a duplicate `buildPeers()`.
    - Added `js/analytics.js` to the service-worker asset list; the current cache name is `sudoku-v46`.

11. **Small UX/a11y nits**
    - Make Hint -> Peek with no selected cell reveal the hinted cell. **DONE 2026-07-08**
    - Replace `aria-hidden="true"` on the focusable Scribble input with a cleaner accessible treatment. **DONE 2026-07-08**
    - Check maskable icon crop; add a padded maskable icon variant if the mark is clipped. **DONE 2026-07-08**

### Verification Status

Automated checks run during follow-up:

- `node tests/generator.test.js`
- `node tests/state-load.test.js`
- Syntax checks for touched modules, including `js/app.js`, `js/state.js`, `js/input.js`, `js/ui.js`, `js/analytics.js`, `js/generator.js`, `js/settings.js`, and `sw.js`
- `manifest.json` parse check

Manual browser smoke tests still recommended:

   - malformed save falls back instead of crashing;
   - custom stuck hint flashes feedback;
   - first SW install does not auto-reload;
   - update button still reloads when intentionally applied;
   - completion animation ignores input;
   - custom entry is not erased by an accidental New Game tap;
   - Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and Ctrl/Cmd+Y behave correctly.

Manual iPad/LAN smoke tests still recommended:

   - analytics is suppressed on `192.168.x.x`;
   - redo affordance is reachable by touch;
   - custom entry and completion-lock behavior feel right with Pencil/finger input.

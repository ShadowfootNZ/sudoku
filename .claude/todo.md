# Sudoku — TODO

## In Progress / Needs Testing
- [ ] **Palm rejection** — 50ms touch debounce + 500ms pen-release window. Needs further iPad testing.
- [~] **Scribble (Apple Pencil handwriting)** — significantly improved across multiple fixes. Latest fix: blur after each write so iPadOS resets the handwriting session for the next stroke. User reports "working much better" — monitor for remaining edge cases.
- [x] **Hint technique pill on iPad Safari** — RESOLVED (2026-07-06): the pill works; earlier "not appearing" reports were user error from testing against a stale cached version, not a code bug.

---

## Bug Fixes — Planned (from 2026-07-06 code review of the generator rewrite)

- [ ] **Generator cleanup follow-ups (non-bugs, same review)** — in priority order:
  1. Early-abort grading: pass `targetRank` into `gradePuzzle()` and return as soon as `hardest > targetRank`; have `createPuzzle()` return its final grade so `generateGraded()` (~line 755) doesn't re-grade the same board.
  2. Drop the redundant copy in `countSolutions([...puzzle])` (~line 129) — `countSolutions` restores the board on every exit path; call it directly and document the restore invariant.
  3. Delete dead code in `generateGraded`: the `if (bestRank === targetRank) break;` (~line 759, unreachable for valid difficulties) and the post-loop ungraded fallback (~lines 762–764, unreachable since createPuzzle output always grades non-null). Normalize unknown difficulty strings to 'medium' once at the top instead.
  4. Collapse `GRADE_ORDER`/`GRADE_NAMES`/`CLUE_FLOOR` (+ the `?? 30` literal at ~line 120) into one `TIERS` table ({name, floor}, rank = index) so adding a tier can't half-succeed.
  5. ~~(Larger, optional) Unify the full 11-technique cascade shared by `gradePuzzle`/`findHint` into one parameterized technique table~~ — **DONE 2026-07-07** as hint-chains phase 1 (see `.claude/hint-chains-plan.md`).

---

## Requested Features (implement when asked)

- [ ] **Build a puzzle catalogue** — write a Node.js script that generates and grades puzzles offline using a human-strategy simulator (technique cascade already in `findHint()`). Output a `puzzles.json` file with pools of ~50–100 puzzles per difficulty level, each entry containing `givens` and `solution` arrays. Grading ensures each difficulty genuinely requires the expected techniques (e.g. Very Hard requires X-Wing or harder). Run the script locally and commit the output; redeploy to update the pool.

- [ ] **Use the puzzle catalogue** — replace the live generator in `startNewGame()` with a random pick from the appropriate difficulty pool in `puzzles.json`. Fetch the file once on startup (or lazily on first new game) and cache it. Fall back to the current live generator if the fetch fails. Add `puzzles.json` to the SW cache assets list and the deploy workflow allowlist.

- [ ] **Hint chains — show the full technique chain, not just the final cell** (big feature; `js/generator.js`, `js/state.js`, `js/ui.js`, `css/style.css`) — **phased implementation plan: `.claude/hint-chains-plan.md`** (created 2026-07-07)

  **Problem.** `findHint()` runs the technique cascade on a temp candidate grid: elimination techniques (pointing, pairs, X-Wing, …) apply their eliminations silently and the cascade restarts; the hint returned to the player is usually just the *final* single that opens up (e.g. "Hidden Single") with one highlighted cell. The chain of techniques that made that single possible — and the cells that form each pattern (the two hidden-pair cells, the four X-Wing corners) — is invisible. The player sees "Hidden Single" on a cell that is not deducible by a hidden single from the visible board state.

  **Goal.** A hint returns the ordered chain of steps from the current board to a placeable digit. Each step names its technique, highlights the pattern cells that justify it, and highlights the cells whose candidates it eliminates. The player steps through the chain in order; the last step is the placement cell (current behavior becomes the final step).

  ### 1. Data model — `findHint()` returns a chain

  ```js
  // findHint(board, solution) →
  {
    steps: [
      { type: 'pointing',      patternCells: [3,4],        eliminations: [{cell:12, digit:7}, ...] },
      { type: 'hidden-pair',   patternCells: [30,32],      eliminations: [{cell:30, digit:1}] },
      { type: 'hidden-single', patternCells: [/* unit */], placement: {cell:40, digit:7} }
    ]
  }
  // plus { type:'error' } / { type:'stuck' } passthroughs as today
  ```

  - Every detector must report its **pattern cells** (today they return one cell): pointing/box-line = the confined candidate cells; naked/hidden pair/triple = the 2-3 defining cells; X-Wing/Swordfish = the 4/6+ line-intersection cells; XY-Wing = pivot + both wings; UR = the three bivalue corners + target. Singles report the target cell (hidden single may also carry its unit for display).
  - Every elimination step records the exact `{cell, digit}` eliminations it applied — these are the "affected" cells to highlight in a second color.
  - Recording stops at the first single that opens up (that step gets `placement`), or at stuck.

  ### 2. Foundation — unify the cascade first (do NOT build this twice)

  This is the same refactor as cleanup follow-up #5 above and should be done as its first phase: convert the 11 technique blocks into a shared table of detector functions, each returning `{ type, patternCells, eliminations }` (or `placement` for singles), consumed by:
  - `gradePuzzle()` → maps type → rank, ignores cells;
  - `findHint()` → records each applied step into the chain.

  Sequencing: **UR bug fixes first** (previous todo item — same code), then cascade unification, then chain recording on top. Doing hint chains against the duplicated cascade would double ~all of this work.

  ### 3. Chain relevance pruning (phase 2, optional)

  The raw chain contains every step the cascade happened to apply, including ones irrelevant to the final placement. Prune backwards: mark the placement's supporting eliminations relevant (eliminations in the placed cell for a naked single; eliminations of the placed digit in the unit for a hidden single); then walk earlier steps and keep any whose eliminations touch a kept step's pattern cells or supporting unit; drop the rest, preserving order. Heuristic, not exact dependency tracking — acceptable. Ship phase 1 with the full chain; add pruning if chains feel noisy in play.

  ### 4. State (`state.js`)

  - Replace `hintCell`/`hintTechnique` with `hintChain` (array of steps or null) and `hintStep` (index). Keep derived getters for backward compatibility where cheap (`hintCell` ≙ placement cell of last step) since the Hint→Peek button flow keys off it.
  - `getHint()`: store the chain, set `hintStep = 0`, increment `hintsPointed` once per chain (not per step), select the placement cell as today.
  - New actions `hintStepNext()` / `hintStepPrev()` → clamp to range, emit `hintstepchanged`.
  - **Invalidation**: clear the whole chain on ANY board mutation (`setValue`, `clearCell`, `peekCell`, note edits that change candidates, undo/redo) — eliminations recorded against the old candidate state may no longer hold. This is stricter than today's "clear when hinted cell filled" and simpler to reason about.
  - Persistence: session-only like today (`hintCell` is already not restored on load); undo snapshots carry `hintChain`/`hintStep` the way they carry `hintCell`/`hintTechnique` now.

  ### 5. UI (`ui.js`, `css/style.css`, `index.html`)

  - **Cell highlights per step**: `.hint-pattern` (the cells that justify the technique — distinct strong color) and `.hint-elim` (cells losing candidates — muted/secondary). Final step keeps the existing selected-cell treatment on the placement cell. Colors need light + dark mode values; must not collide with peer/match/legal/conflict highlights (see CSS custom props).
  - **Stepper in the technique pill**: extend `#hint-technique` to `‹ Step 2 of 3 — Hidden Pair ›` with Prev/Next buttons (44px touch targets for iPad); label from `TECHNIQUE_LABELS`. Dismiss (×) keeps the chain but hides the pill, as today. When `showStrategyOnHint` is off, show the stepper with step numbers but no technique names (or gate the whole stepper on the setting — decide during implementation).
  - If notes are displayed for an elimination cell, optionally bold/strike the eliminated candidate digit inside the note (stretch; ties into the "Enhanced selection highlighting" feature below).
  - New render path `renderHintStep()` driven by `hintstepchanged`; `renderAll()` must reapply the current step's classes (grid rebuilds replace cell innerHTML — see Scribble lessons).

  ### 6. Verification

  1. Node unit checks: on synthetic boards, assert chains are well-formed — non-empty, end in a `placement` step, every elimination is sound (never removes the solution digit of its cell — validate against `solution`), every `patternCells` non-empty, and applying the eliminations in order actually yields the final single.
  2. Simulated solves: follow chains to completion on ~20 generated puzzles per tier; 0 errors, no stuck-with-chain states.
  3. On-device (iPad Safari): stepper touch targets, highlight colors in light/dark, pill placement (`position:fixed` pill confirmed working on iPad as of 2026-07-06).
  4. `node --check`, SW cache bump, plan.md/todo.md updates.

- [ ] **Update checking that preserves the in-progress puzzle** (`js/app.js`, `js/state.js`, `sw.js`)

  **Problem.** Update detection only happens at page load: `navigator.serviceWorker.register()` (app.js ~line 52) triggers the browser's SW update check on navigation, and nothing re-checks afterwards. An installed PWA that stays open or suspended for days never learns a new version exists. And while the apply flow (Settings → Update → `SKIP_WAITING` → `controllerchange` → `location.reload()`) does keep the puzzle via localStorage, the reload (a) discards undo/redo history (`state.load()` resets `history`/`redoStack` — state.js ~line 296) and (b) drops the player into the Resume dialog mid-game instead of back onto the board.

  ### 1. Proactive update checks (detection)

  - Keep the existing user-controlled apply flow — never auto-reload mid-game. This work only makes *detection* proactive.
  - Store the registration: `let swReg` from the `register()` promise.
  - Re-check on foreground: `document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') swReg?.update().catch(() => {}); })` — the main win for an installed PWA, which fires this every time the app is reopened.
  - Re-check on a timer while open: `setInterval(() => swReg?.update().catch(() => {}), 60 * 60 * 1000)` (hourly is plenty; `update()` is a cheap conditional fetch of sw.js, which is intentionally never SW-cached).
  - The existing `updatefound` → `installed` → `showUpdateAvailable()` listener path already handles the result — no changes needed there.
  - **Visibility nudge (optional)**: when an update is waiting, show a small badge/dot on the ⚙️ button so the player notices without opening Settings. Keep it subtle; no toast/modal that interrupts play.

  ### 2. Seamless apply (preservation)

  - **Save explicitly before reload**: in the `controllerchange` handler (app.js ~line 67), call `state.save()` before `location.reload()`. Today's save-on-every-mutation makes this nearly redundant, but it closes the race where the reload lands between a mutation and its save, and it's one line.
  - **Skip the Resume dialog after an update-reload**: before calling `location.reload()`, set `sessionStorage.setItem('sudoku-update-reload', '1')`. At startup (app.js ~line 205), if the flag is present: clear it, `state.load()`, and go straight to the board (skip `showResume()`), leaving selection and notes exactly as saved. sessionStorage survives same-tab reloads (browser and installed PWA) but not a fresh launch, so normal launches keep the Resume dialog.
  - Optionally show a one-line transient confirmation after an update-reload ("Updated to latest version") — could reuse the technique-pill element style; auto-dismiss after a few seconds.

  ### 3. Persist undo history across the reload (phase 2, optional)

  - `history`/`redoStack` are arrays of snapshots (answer + notes + counters each; capped at 200 entries) — full persistence could reach ~1-2 MB of JSON, so cap what's persisted (e.g. last 25 snapshots) or gzip-not-worth-it: decide during implementation whether the undo depth is worth the localStorage weight.
  - Serialize into the existing `sudoku-save` payload (notes Sets → arrays, mirroring the current notes serialization); restore in `load()` instead of resetting to `[]`.
  - This benefits ALL reloads (accidental tab close, browser eviction), not just updates — which is also the argument for doing it: today any reload silently eats the undo stack.

  ### 4. Verification

  1. Local two-version test: serve the app, start a puzzle, make moves + notes; bump the SW cache name and edit a visible string; wait for / trigger the update check (background the tab and re-foreground for `visibilitychange`); confirm the Settings row (and badge if built) appears without a manual reload.
  2. Apply mid-puzzle: tap Update; confirm the app reloads onto the board (no Resume dialog), with answers, notes, selection, counters intact — and undo history too if phase 2 is built.
  3. Confirm the new version is actually live post-reload (changed string visible; new cache name in DevTools → Application → Cache Storage; old cache evicted by the activate handler).
  4. On-device: installed PWA on iPad — suspend/resume the app to verify the `visibilitychange` check fires and the update row appears while a puzzle is open; apply and confirm the puzzle survives.
  5. Regression: normal fresh launch still shows the Resume dialog; declining the update keeps playing on the old version indefinitely; `node --check js/app.js js/state.js`.

- [ ] **Investigate Dancing Links (DLX) for puzzle generation** — Donald Knuth's Algorithm X implemented with Dancing Links is the standard fast approach for exact cover problems, which Sudoku generation/solving maps onto naturally. Current backtracking solver works but DLX may offer faster generation (especially for hard/veryhard) and cleaner architecture. Worth evaluating if generation speed becomes an issue or when tackling technique-based grading.

- [ ] **Fix gold completion animation when hints were used** — the gold flash reward animation plays even when the player used hints or peeks. Consider suppressing or replacing the animation (e.g. no animation, or a muted colour) when `hintsPointed > 0` or `hintsUsed > 0`.

- [x] **Clear settings** — "Reset to defaults" button in Settings dialog; calls `settings.reset()` which restores DEFAULTS and removes `sudoku-settings` from localStorage.

- [ ] **Check for app updates** — let the player check for and download the latest version instead of waiting for the SW to update silently. Register a `sw.controllerchange`/`updatefound` listener and expose a manual "Check for updates" action (e.g. in Settings) that calls `registration.update()`. If a new SW is waiting, show a prompt ("Update available — reload to apply") that calls `skipWaiting()`/`postMessage` then reloads. Useful since the app has no auto-reload today — users on stale cached versions (e.g. old SW cache number) have no way to notice or force-refresh.

- [ ] **Enhanced selection highlighting**  
  When a digit is selected, augment the existing row/column/box peer highlighting with:
  - **Same digit cells**: bold the digit (instead of or in addition to the peer highlight colour)
  - **Legal entry cells**: indicate empty cells where the selected digit is a valid placement
  - **Notes**: bold the matching candidate number within a note cell (no visual change if that candidate isn't present). A cell could therefore show both a "legal entry" indicator and a bolded note simultaneously.

- [ ] **Custom puzzle builder**  
  Let the user enter a puzzle copied from an external source (newspaper, app, website) and solve it in this app. Entry point: a "Custom…" option at the bottom of the difficulty dropdown. UI: a grid entry mode where tapping cells cycles through digits 1–9 (or uses the numpad/pencil), distinct from normal play. On confirm, validate the puzzle:
  - Has exactly one solution (reuse `countSolutions()`)
  - Is not already solved
  If invalid, show an error explaining why. On success, start a normal game with those givens (no difficulty label, or label as "Custom").

- [ ] **Puzzle solver**  
  Needed to support custom puzzles and useful standalone. Given the current puzzle state, solve it using the backtracking solver and fill all empty cells. Should work on both generated and custom puzzles. Could be surfaced as a "Solve" option in the hint/peek system or as a separate button (possibly behind a confirmation since it replaces the challenge).

---

## Potential Issues to Watch
- Scribble: blur-after-write resets iPadOS handwriting session. If the user lifts the pencil very quickly the hover may not re-trigger focusScribble — watch for cases where the green tint doesn't reappear.
- Palm rejection timing may still be imperfect for some writing styles.
- Service worker cache is currently `sudoku-v36`.
- Hint pill technique name (2026-07-07, hint-chains phase 2): now shows the *final* step's technique in the chain rather than the earliest eliminating technique that fired. E.g. a hint reached via Pointing → Hidden Single now labels the pill "Hidden Single" instead of "Pointing". Intentional/temporary per the phase 2 adapter in `state.getHint()` — resolved properly by the phase 4 stepper, which will show every step.

---

## Done ✓
- [x] Puzzle generator (backtracking + MRV, main thread)
- [x] All game state (given/answer/notes/history/undo/redo)
- [x] Auto-prune candidates after every mutation
- [x] Context-sensitive Fill Candidates (single cell or all)
- [x] Conflict highlighting (toggleable)
- [x] Notes mode
- [x] localStorage persistence + resume dialog
- [x] Completion detection + dialog
- [x] PWA (manifest + service worker + icons)
- [x] Dark mode
- [x] Apple Pencil cell selection
- [x] Palm rejection (pen flag + 50ms debounce + 500ms release window)
- [x] No keyboard on finger tap
- [x] Pinch-zoom prevention (`touch-action: none`)
- [x] Handwriting font (Noteworthy/Bradley Hand/cursive on .digit and .note)
- [x] Larger notes font (clamp 9px–14px)
- [x] Numpad buttons disabled when digit placed 9 times
- [x] Scribble: hover pre-positioning, blur reset, detached-element fix, cell-selection guard
- [x] Distinct hover colour (mint green) vs peer highlights (blue)
- [x] Scribble-ready green tint via #scribble-input:focus CSS
- [x] Fixed: spinner never hiding ([hidden] CSS override bug)
- [x] Numpad remaining count — right-aligned corner badge showing how many of each digit still to place
- [x] Very Hard difficulty (22 clues)
- [x] Error counter — ❌N in header, only when conflict check ON, hidden when 0
- [x] Game timer — added then **removed by user decision**: no common puzzle-of-the-day makes times incomparable; app is for pleasure not competition
- [x] Hint/Peek split — 🔍 Hint highlights constrained cell; button changes to 👁 Peek which reveals selected cell; 🔍N and 👁N counters in header, hidden when 0
- [x] Completion animation — reverse solve-order gold flash; `fillOrder[]` in state tracks fill sequence; `showComplete()` staggers `.completing` CSS class, shows dialog after ~1.1s
- [x] Help dialog — ? button in header; scrollable "How to Play" with 6 sections; up to min(80vw, 800px) wide
- [x] Favicon/branding — footprint icons (favicon.ico, 16/32/192/512px PNGs) for browser tabs; apple-touch-icon uses icon-512.png (sudoku image) for iPad home screen; footprint also shown in header next to title
- [x] Header stats as emoji icons — ❌N / 🔍N / 👁N, hidden when zero; all appear as earned
- [x] Button emoji — ✏️ Notes, ↩️ Undo, ✍️ Fill, 🔍 Hint / 👁 Peek, ✅ Check, 🗑️ delete
- [x] Settings panel — ⚙️ button opens dialog; toggles for peer/match/legal/conflict highlights; font size segmented control; "Show technique on hint" toggle; persisted in `sudoku-settings` localStorage key separately from game save
- [x] Hint technique pill — floating `position:fixed` pill above controls shows technique name (Naked Single, Hidden Single, etc.) when hint is used and setting is on; dismissible with ×; auto-clears when hint cell is filled; `hintTechnique` tracked in state and undo snapshots
- [x] Settings defaults updated — highlightPeers: false, highlightLegal: false, showStrategyOnHint: false
- [x] Technique-based difficulty grading — `gradePuzzle()`/`findHint()` now detect Swordfish, XY-Wing, and Unique Rectangle (Type 1) in addition to the existing cascade (Naked/Hidden Single, Pointing/Box-Line, Naked/Hidden Pair, Naked Triple, X-Wing), all folded into the "veryhard" tier. `createPuzzle()` digs cells directly toward the target grade (rejecting any removal that overshoots it) instead of digging to a fixed clue count and hoping; `generateGraded()` retries up to 12x with a fresh solution and falls back to the closest grade below target if the exact tier isn't reached. Fixed a real bug in the process: requesting "Very Hard" previously always exhausted 50 blind retries (~400-800ms) and silently served a Medium-graded puzzle almost every time. An Expert 5th tier was briefly added and then merged back into "veryhard" — its techniques kicked in too close to veryhard's to reliably land on either individually (~10-15% hit rate); merging raised the hit rate to ~70%+ at the same ~60-300ms generation speed.
- [x] Custom puzzle builder — enter a puzzle from an external source, validate it has a unique solution, then solve it in this app. Entry point: "Custom…" option in difficulty dropdown. Entry mode where tapping cells cycles digits 1–9 (or uses numpad). Validation reuses `countSolutions()` and rejects puzzles with 0 or 2+ solutions. Confirmed working end-to-end (2026-07-07).
- [x] Unique Rectangle detector fixed + de-duplicated (2026-07-07, from the 2026-07-06 review) — extracted the duplicated UR block from `gradePuzzle`/`findHint` into one module-level `tryUniqueRectangle(cands, elim)` helper and fixed three misses: (1) vertical rectangles (columns in same stack, rows in different bands) were never detected — replaced the `cellBox` guards with the `sameBand XOR sameStack` two-box test; (2) the fourth corner was required to hold BOTH pair digits — now whichever of A/B is present is eliminated (uniqueness argument covers each digit independently), guarded so the cell is never emptied; (3) found during testing, beyond the review: a bivalue target with a *different* pair (e.g. {1,9} vs pair {1,2}) was counted as a fourth bivalue corner and rejected — restructured to try each corner as target, requiring the other three to share the pair. Verified: 10/10 synthetic unit checks; head-to-head 40-run benchmark: veryhard hit rate 63%→83%, UR firings 16→77, avg gen time 223ms→175ms, 0 invalid puzzles; 25 simulated hint-driven veryhard solves with 0 errors/stuck. SW cache bumped v33→v34.

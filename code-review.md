# Code Review Follow-Up

## Findings

1. High: Custom puzzle validation is fixed in the UI path, but the solver helpers remain unsafe when called directly.

   Status: attempted and mostly addressed for custom entry.

   `js/app.js:275` now calls `hasConflictingGivens(puzzle)` before `countSolutions()` and `solve()`, and `js/generator.js:58` adds the unit-level duplicate check. That closes the user-facing custom puzzle bug reported in the first review.

   Residual risk: `countSolutions()` and `solve()` still accept invalid pre-filled boards if they are called directly. I re-ran the previous reproduction: `hasConflictingGivens` returned `true`, but `countSolutions()` still returned `1` and `solve()` still produced a board beginning `554678912`.

   Recommendation: keep the app-level guard, but also make `countSolutions()` return `0` and `solve()` return `null` when `hasConflictingGivens(board)` is true. That gives future call sites a safer default.

2. High: Keyboard input no longer reaches through modal overlays.

   Status: attempted and appears addressed.

   `js/input.js:160` through `js/input.js:165` now exits the global keyboard handler when `#overlay` is visible. This prevents number entry, delete, undo/redo, and arrow navigation from mutating the puzzle behind resume/settings/clear/help/complete dialogs.

   Recommendation: add a small browser-level regression test or manual checklist item for this, especially for the startup Resume dialog, because this behavior is easy to accidentally break when adding dialog keyboard shortcuts.

3. Medium: Undo intentionally excludes notes and candidate fills.

   Status: documented in code, not fixed.

   `js/state.js:199`, `js/state.js:214`, and `js/state.js:223` now explicitly say note edits and candidate fills do not push history. `js/state.js:235` through `js/state.js:237` explains that undo/redo only cover answer placements.

   This resolves the ambiguity from the previous review, but the product behavior remains the same: users cannot undo note changes or Fill actions. If that is intentional, no code change is required. If Undo is expected to mean "undo my last board edit," this remains a UX gap.

4. Medium: Main-thread puzzle generation is tracked as deferred work.

   Status: todo added, not fixed.

   `.claude/todo.md:23` records that `js/worker.js` is dead/stale and that generation still runs synchronously from `startNewGame()`. That accurately captures the previous finding and also notes that the existing worker should not be reused as-is because it calls `createPuzzle()` instead of `generateGraded()`.

   Recommendation: when this is revisited, either delete the stale worker or replace it with a worker that preserves the current graded-generation behavior and guards against stale responses from older New Game requests.

5. Low: Service worker same-origin mismatch is tracked as deferred work.

   Status: todo added, not fixed.

   `.claude/todo.md:24` records that `sw.js:47` through `sw.js:52` still comments "Only handle GET requests for our own origin" but does not enforce an origin check. The original low-risk finding remains accurate.

   Recommendation: add the origin check before calling `e.respondWith()`, or update the comment if broad fetch handling is intentional.

## New Findings

No new high-confidence defects found in this follow-up pass.

## Test Gaps

- Add regression coverage for conflicting custom givens through both the UI validation path and the exported solver helpers.
- Add a keyboard/modal regression check to confirm digits, Backspace/Delete, Ctrl/Cmd+Z, Ctrl/Cmd+Y, and arrows are ignored while dialogs are open.
- If note undo remains intentionally unsupported, consider a short help/settings note so the behavior is not surprising.

## Notes

- I did not change source code in this pass.
- This document replaces the original review with a follow-up status review of items 1 through 5.

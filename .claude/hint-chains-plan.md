# Hint Chains — Implementation Plan

Feature spec lives in todo.md ("Hint chains — show the full technique chain"). This doc is the
phased execution plan. Phases are strictly sequential; each ends in a working, shippable state.

**Status: not started.** Prerequisite (UR detector fix + de-dup) completed 2026-07-07.

---

## Phase 1 — Unify the technique cascade (generator.js only, pure refactor)

The single riskiest phase, and the foundation everything else stands on. `gradePuzzle`
(~lines 208–470) and `findHint` (~lines 475–777) each contain the same 11 technique blocks
(~170 duplicated lines, including two local `trySwordfish` copies). Convert them to one
module-level table of detector functions consumed by both.

**Detector contract** — detectors *find*, the driver *applies*:

```js
// detector({ board, cands }) → null (no match) or:
//   { type, patternCells, eliminations: [{cell, digit}, ...] }   // elimination techniques
//   { type, patternCells, placement: {cell, digit} }             // singles
const DETECTORS = [findNakedSingle, findHiddenSingle, findPointing, findBoxLine,
                   findNakedPair, findHiddenPair, findNakedTriple, findXWing,
                   findSwordfish, findXYWing, findUniqueRectangle];
const TECH_RANK = { 'naked-single': G.easy, 'hidden-single': G.medium, ... };
```

- Report `patternCells` from day one (cheap while rewriting, required by Phase 2):
  pointing/box-line = the confined candidate cells; naked/hidden pair/triple = the 2–3
  defining cells; X-Wing/Swordfish = the 4/6+ intersection cells; XY-Wing = pivot + both
  wings; UR = the three floor corners + target; singles = the target cell (hidden single
  also carries its unit index for display).
- **Preserve exact cascade semantics**: after every applied step, restart from the top of
  the table (the current `continue outer` behavior). Order of detectors = current block order.
- `gradePuzzle` becomes: loop → first matching detector → apply → `hardest = max(hardest,
  TECH_RANK[type])` → restart; solved → grade, no match → null. Unchanged signature.
- `findHint` keeps its **current** return shape `{type, cell}` this phase, including the
  fallback rule (first elimination technique fired is returned only if later stuck). Pure
  refactor — no caller changes.
- `tryUniqueRectangle` gets absorbed: split into find (returns step) / driver applies.
  Same for the two `trySwordfish` locals → one `findSwordfish`.

**Verify (behavioral equivalence):** keep pre-refactor copy in scratchpad; grade the same
~100 stored puzzles with both — identical grades. 25-run generation benchmark per tier —
hit rates/timings within noise of the 2026-07-07 baseline (easy/medium 25/25, hard 24/25,
veryhard ~83%, 0 invalid). Simulated hint-driven solves — 0 errors/stuck. `node --check`.
Shippable: yes (invisible refactor). SW bump if deployed.

## Phase 2 — Chain recording (generator.js, small once Phase 1 lands)

`findHint(board, solution)` returns the ordered chain:

```js
{ steps: [ { type:'pointing', patternCells:[3,4], eliminations:[{cell:12, digit:7}] },
           ...,
           { type:'hidden-single', patternCells:[40], placement:{cell:40, digit:7} } ] }
// or { type:'error' } / { type:'stuck' } passthroughs exactly as today
```

- Driver records every applied step; recording stops at the first single (gets `placement`).
- Stuck after eliminations → plain `{ type:'stuck' }` (partial chains not surfaced).
- The Phase-1 fallback rule dies here — the chain subsumes it.
- Temporary adapter in `state.getHint()`: treat last step's placement cell / type as
  `hintCell`/`hintTechnique` so the app runs unchanged before Phase 3.

**Verify (Node unit checks):** chains non-empty and end in `placement`; every elimination
sound (never removes `solution[cell]`); every `patternCells` non-empty; replaying the
eliminations in order actually opens the final single. Simulated solves: ~20 puzzles/tier,
0 errors. Shippable: yes (still invisible).

## Phase 3 — State model (state.js)

- Replace `hintCell`/`hintTechnique` internals with `hintChain` (steps array | null) and
  `hintStep` (index). Keep derived getters `hintCell` (last step's placement cell, else -1)
  and `hintTechnique` (current step's type) — the Hint→Peek button flow (state.js ~163,
  ~234–261) and the pill keep working with minimal edits.
- `getHint()`: store chain, `hintStep = 0`, `hintsPointed++` **once per chain**, select the
  placement cell (as today).
- New actions `hintStepNext()`/`hintStepPrev()`: clamp to `[0, steps.length-1]`, emit
  `hintstepchanged`.
- **Invalidation — stricter than today**: clear the whole chain on ANY board mutation
  (`setValue`, `clearCell`, `peekCell`, note edits, undo/redo snapshot restore). Recorded
  eliminations are stale after any change. Replaces the current "clear when hinted cell
  filled" logic.
- Snapshots carry `hintChain`/`hintStep` (as they carry `hintCell`/`hintTechnique` now,
  lines ~74–85). Persistence stays session-only: `load()` resets both (~line 312).

**Verify:** Node smoke test of state transitions (hint → step next/prev → mutate → chain
cleared; undo restores chain). App still plays normally with the old pill UI (getters keep
it alive). Shippable: yes.

## Phase 4 — UI: stepper + highlights (ui.js, css/style.css, index.html)

- **Cell classes** applied by new `renderHintStep()`: `.hint-pattern` (justifying cells —
  strong distinct color) and `.hint-elim` (cells losing candidates — muted). Both need
  light + dark values as CSS custom props; must not collide with peer/match/legal/conflict
  or the Scribble mint-green hover. Final step: placement cell keeps existing selected
  treatment.
- **Stepper pill**: extend `#hint-technique` to `‹ Step 2 of 3 — Hidden Pair ›`. Prev/Next
  are 44px touch targets; labels from `TECHNIQUE_LABELS` (ui.js ~166). Dismiss (×) hides
  pill, keeps chain (existing `_techniqueDismissed` flag). With `showStrategyOnHint` off:
  show step numbers without technique names (decision per spec — revisit in testing).
- `renderHintStep()` driven by `hintstepchanged`; **`renderAll()` must reapply the current
  step's classes** — grid rebuilds replace cell innerHTML (Scribble lesson, plan.md).
- Wire Prev/Next in app.js next to the existing pill close handler.
- Stretch (skip unless trivial): bold/strike the eliminated candidate digit inside
  displayed notes on `.hint-elim` cells.

**Verify:** desktop browser first (Live Server): step through chains on a veryhard puzzle,
check both themes, dismiss/re-hint, fill a cell mid-chain (chain clears), undo. Then
on-device iPad Safari: touch targets, colors, pill position, Scribble still works with the
new classes present. Shippable: yes — this is the user-visible release. SW bump + docs.

## Phase 5 — Chain relevance pruning (optional, only if chains feel noisy in play)

Backwards pass per spec: mark the placement's supporting eliminations relevant; keep earlier
steps whose eliminations touch a kept step's pattern cells or supporting unit; drop the rest,
preserving order. Heuristic, not exact. Decide after living with Phase 4 for a while.

---

## Sequencing rationale

Phases 1–2 are pure generator work, testable entirely in Node with the existing scratchpad
harness pattern (copy module + test-only exports). Phase 3 is small once the chain shape
exists. Phase 4 is the only phase needing on-device testing. Building chains against the
duplicated cascade (skipping Phase 1) would roughly double the generator work and create
permanent grader/hinter drift risk — don't.

## Risks / decisions to make during implementation

- **Perf**: detectors returning step objects instead of mutating in place adds allocation
  per step. Grading runs ~50–60× per dig; benchmark after Phase 1 (budget: stay within the
  current ~60–350ms veryhard band).
- **Hidden-single unit display**: carry `unit` index on the step or just the cell? Decide
  in Phase 2; UI can ignore it initially.
- **`showStrategyOnHint` off**: numbers-only stepper vs no stepper. Leaning numbers-only;
  confirm during Phase 4 testing.
- **Peek interaction**: Peek reveals the *selected* cell, which mid-chain may be a pattern
  cell, not the placement. Current behavior is acceptable (peek follows selection); just
  ensure peek's mutation clears the chain via the Phase 3 invalidation rule.

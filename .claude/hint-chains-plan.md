# Hint Chains — Implementation Plan

Feature spec lives in todo.md ("Hint chains — show the full technique chain"). This doc is the
phased execution plan. Phases are strictly sequential; each ends in a working, shippable state.

**Status: Phase 4 complete (2026-07-07) — the full hint-chains feature has shipped.**
Phases 1-3 also 2026-07-07; prerequisite (UR detector fix + de-dup) also 2026-07-07. Phase 5
(relevance pruning) remains optional, only if chains feel noisy in real play.

Phase 1 results: 11 detectors extracted (`findNakedSingle` … `findUniqueRectangle`), consumed
via `DETECTORS`/`TECH_RANK`/`findStep`; `gradePuzzle` and `findHint` are now ~20-line drivers.
Every detector already reports `cell`, `patternCells`, and exact `eliminations`/`placement`
(hidden single also carries its `unit`) — Phase 2 only needs to record steps in the findHint
driver. Equivalence verified: 101 grade + 5,220 findHint pre/post comparisons across 100
generated puzzles and full simulated solves, 0 mismatches; perf unchanged (veryhard avg
~143ms vs ~146ms, hit rate within noise); UR step-contract unit checks 8/8.

Phase 2 results: `findHint(board, solution)` now returns `{ steps: [...] }` — the ordered
chain of every technique applied from the current board to the placement — replacing the old
`{ type, cell }` fallback-tracking return. The `FALLBACK_OVERWRITERS` quirk from phase 1 is
gone; the chain makes it unnecessary. Verified: 80 full simulated solves (20/tier), 4,166
chains, 22,072 assertions — chains non-empty and end in `placement`; every non-final step
carries eliminations; every `patternCells` non-empty; every elimination provably sound
(`solution[cell] !== digit`, so a hint never removes the correct answer); every step
independently reproducible by replaying prior eliminations into a fresh `findStep` call. 0
errors, 0 stuck across all 80 solves.

Phase 3 results: `state.js` internals replaced `hintCell`/`hintTechnique` with `hintChain`
(the steps array, or null) and `hintStep` (the stepper index). Derived getters keep the old
API alive: `hintCell` = the chain's last step's placement cell (or -1), `hintTechnique` = the
*current* step's type (`hintChain[hintStep].type`) — so the pill now shows the step-0
technique on a fresh hint (the phase-2 temporary "shows the final step" behavior is gone; this
is the real, forward-compatible definition the phase 4 stepper will drive). New
`hintStepNext()`/`hintStepPrev()` clamp to `[0, chain.length-1]` and emit `hintstepchanged`
(unconsumed until phase 4). Invalidation is now unconditional: `setValue`, `clearCell`,
`toggleNote`, `fillCandidates`, `fillAllCandidates`, and `peekCell` all clear the chain via a
shared `invalidateHint()` helper regardless of which cell changed — stricter than the old
"clear only if the hinted cell was filled" rule. `undo`/`redo` are unaffected: `hintChain`/
`hintStep` ride in `snapshot()`/`restoreSnapshot()` exactly as `hintCell`/`hintTechnique` did,
so undo correctly brings back whatever chain (or lack of one) was active at that point in
history. `getHint()` on an already-solved board (or any `stuck`/`error` result) still leaves
`hintChain` null — no chain is ever pinned from a non-`steps` result. Verified with a Node
smoke test (browser globals stubbed): 21 assertions covering hint→chain population, one-hint-
at-a-time guarding, stepper clamping in both directions, `hintTechnique` tracking the current
step, invalidation from all six mutators (including peek on a cell *other* than the hinted
one), undo/redo carrying the chain correctly, and stuck boards never populating a chain. App
still plays unchanged through the existing pill/Peek UI (no ui.js/app.js changes needed).

Phase 4 results: the pill (`ui.js`, `index.html`, `css/style.css`) became a real stepper —
"‹ Step 2 of 4 — Hidden Pair ›" with Prev/Next buttons (44×44px touch targets) that call
`state.hintStepPrev()`/`hintStepNext()`; when `showStrategyOnHint` is off it shows just
"Step 2 of 4" (numbers-only, per the plan's leaning) instead of hiding entirely as the old
pre-chain pill did. `renderCell()` now derives per-step highlights from
`state.hintChain[state.hintStep]`: the final (placement) step keeps the pre-chain
`.hint-cell` treatment, while every earlier step gets two new classes — `.hint-pattern`
(the cells that justify the technique, a strong purple) and `.hint-elim` (cells losing a
candidate, a muted lighter purple/lavender), both with light/dark custom-property pairs
(`--hint-pattern-bg`, `--hint-elim-bg`) chosen not to collide with any existing highlight
color. Stretch goal included: notes displaying a candidate an elim step removes get a
`.note.eliminated` strike-through in the conflict-red color. `renderHintStep()` (new export)
does a full `renderAll()` + pill update on `hintstepchanged`, since a step's cells can be
scattered anywhere on the board, not just around the selected cell. Dismissing the pill (×)
still only hides the pill text — the grid highlights and the chain persist, matching the
pre-chain pill's behavior.

Verified in a real headless-Chromium browser (Playwright, installed fresh into a scratch
directory — no project run-skill existed yet, recommend `/run-skill-generator` next time)
against a local static server: stepped a real 4-step and a real 7-step Very Hard chain,
confirmed pattern/elim highlight counts genuinely differ step-to-step (e.g. step 1
`{pattern:3, elim:1}` → step 2 `{pattern:2, elim:1}` on different cells), confirmed the final
step shows no pattern/elim classes (only the pre-existing `.selected` treatment on the
placement cell, since `getHint()` already selects that cell), confirmed Prev/Next disable at
the chain's boundaries and re-enable correctly when stepping back, confirmed dismiss hides
the pill while grid highlights persist, confirmed filling a cell clears both, and confirmed
both light and dark mode render the new purple tones legibly against the board with zero
browser console errors throughout. Screenshots inspected directly to confirm layout/contrast,
not just DOM class assertions.

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

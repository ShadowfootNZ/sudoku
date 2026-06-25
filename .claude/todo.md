# Sudoku — TODO

## In Progress / Needs Testing
- [ ] **Palm rejection** — 50ms touch debounce + 500ms pen-release window. Needs further iPad testing.
- [~] **Scribble (Apple Pencil handwriting)** — significantly improved across multiple fixes. Latest fix: blur after each write so iPadOS resets the handwriting session for the next stroke. User reports "working much better" — monitor for remaining edge cases.

---

## Requested Features (implement when asked)

- [ ] **Settings panel**  
  A unified settings UI (dialog) to replace the inline ✅ Check button and expose per-preference toggles. Proposed settings:
  - **Conflict check** — move the existing ✅ Check button here (on/off)
  - **Same-digit highlight** — bold/highlight cells containing the same digit as the selected cell (on/off)
  - **Legal entry highlight** — tint empty cells where the selected digit is a valid placement (on/off)
  - **Note highlight** — bold/colour the matching candidate in note cells when a digit is selected (on/off)
  - **Font size** — Small / Medium / Large; scales digits and notes proportionally via a `--font-scale` CSS custom property (0.8 / 1.0 / 1.25)
  - **Show strategy on hint** — display the technique name (e.g. "Naked Single") when a hint cell is highlighted (on by default)
  Settings live in a separate `sudoku-settings` localStorage key (not mixed with game save) so they persist across new games. The ✅ Check button can be removed from the controls bar once this exists. See plan.md § Settings for implementation details.



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

- [ ] **Hint strategy name** *(implement as a setting toggle — on by default)*  
  When the 🔍 Hint button highlights a constrained cell, also display what technique identified it — e.g. "Naked Single", "Hidden Pair", "X-Wing". Surfaced as a "Show strategy on hint" toggle in the Settings panel. Requires the hint logic to return a technique label alongside the cell index. Depends on / complements the technique-based difficulty grading feature.

- [ ] **Technique-based difficulty grading** (big feature)  
  Replace the current clue-count difficulty system with one based on what solving techniques are actually required. The current system (easy=36 clues, medium=30, hard=25, veryhard=22) is a rough proxy — two puzzles with the same clue count can have wildly different solving experiences.

  **How it would work:**  
  Add a `gradePuzzle(puzzle, solution)` function to `generator.js` that attempts to solve the puzzle using only human strategies in order of difficulty, tracking which were needed. The generator runs in a loop: generate → grade → keep if difficulty matches, otherwise discard and retry. Clue counts would become hints to the generator loop to short-circuit obviously wrong puzzles before grading.

  **Techniques in difficulty order:**
  | Level | Techniques required |
  |-------|-------------------|
  | Easy | Naked Single only (one candidate remaining in a cell) |
  | Medium | + Hidden Single (digit can only go in one cell of a unit) |
  | Hard | + Naked Pair, Naked Triple, Pointing Pair/Triple, Box-Line Reduction |
  | Very Hard | + Hidden Pair, Hidden Triple, X-Wing |
  | Expert *(future)* | + Swordfish, XY-Wing, Unique Rectangle |

  **Technique definitions:**
  - **Naked Single** — a cell has only one remaining candidate
  - **Hidden Single** — a digit can only go in one cell within a row, column, or box
  - **Naked Pair** — two cells in the same unit share exactly the same two candidates; those digits can be eliminated from all other cells in the unit
  - **Naked Triple** — same as pair but three cells / three candidates
  - **Hidden Pair** — two digits appear in only two cells within a unit; other candidates in those two cells can be eliminated
  - **Hidden Triple** — same as hidden pair but three digits / three cells
  - **Pointing Pair/Triple** — a candidate within a box is confined to one row or column, so it can be eliminated from that row/column outside the box
  - **Box-Line Reduction** — a candidate within a row or column is confined to one box, so it can be eliminated from the rest of that box
  - **X-Wing** — a digit appears in exactly two cells in each of two rows, and those cells share the same two columns (or vice versa); eliminates that digit from the rest of those columns/rows
  - **Swordfish** — like X-Wing but across three rows/columns
  - **XY-Wing** — three cells, each with two candidates, forming a chain that allows eliminations
  - **Unique Rectangle** — exploits the guarantee of a unique solution to eliminate candidates

  **Implementation notes:**
  - `gradePuzzle()` returns `{ difficulty: 'easy'|'medium'|'hard'|'veryhard', techniques: string[] }`
  - The grader works on candidates (like a human), applying techniques in order until solved or stuck
  - If stuck (no human technique applies), puzzle is unsolvable by logic alone — discard
  - Generation loop may need a retry cap (e.g. 50 attempts) with a fallback to looser grading
  - This is a significant rewrite of the generation pipeline; keep existing clue-count system working in parallel during development

---

## Potential Issues to Watch
- Scribble: blur-after-write resets iPadOS handwriting session. If the user lifts the pencil very quickly the hover may not re-trigger focusScribble — watch for cases where the green tint doesn't reappear.
- Palm rejection timing may still be imperfect for some writing styles.
- Service worker cache is currently `sudoku-v23`.

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

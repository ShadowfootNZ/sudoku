# Saved Games and GitHub Pages Migration Plan

## Purpose

This document is the durable implementation plan for:

1. Adding a nine-position game library to Sudoku.
2. Preserving games independently at the GitHub Pages and Apps origins.
3. Moving a game from the old GitHub Pages origin to the Apps origin without
   overwriting an existing game.
4. Replacing the old GitHub Pages application with a bookmark-update notice.
5. Leaving a clean foundation for later puzzle export, sharing, and import.

The work is intentionally divided into independently deployable phases. Complete
and verify the Apps-side work before publishing the GitHub Pages placeholder.

## Agreed user experience

The Saved Games view is a fixed 3-by-3 grid:

```text
+---------+---------+---------+
| Current | Slot 1  | Slot 2  |
+---------+---------+---------+
| Slot 3  | Slot 4  | Slot 5  |
+---------+---------+---------+
| Slot 6  | Slot 7  | Slot 8  |
+---------+---------+---------+
```

- The top-left position is always the current game.
- The other eight positions are stable. They do not reorder automatically.
- An empty position presents a **Save here** action.
- A player may deliberately replace an occupied position after confirmation.
- Opening a saved game swaps it with Current. The previous current game moves
  into the selected saved position, while the other seven positions do not move.
- Miniature boards show givens and entered answers, but not candidate notes.
- Miniature digits use approximately the same size as notes on the main board.
- Each card shows difficulty, progress, and the best available date.
- The same 3-by-3 layout is used on small screens.

## Storage and domain constraints

The old and new sites have different origins:

- `https://shadowfootnz.github.io`
- `https://apps.shadowfoot.com`

Their `localStorage`, Cache Storage, and service workers are isolated. A normal
redirect cannot copy a saved game between them.

The current application stores:

- The active game in `sudoku-save`.
- Preferences in `sudoku-settings`.

The current save has no creation or modification timestamp. Browsers do not
provide the write time of a `localStorage` entry, so an existing save's original
date must remain unknown.

## Target data model

Use a versioned library rather than exposing the storage layout directly to the
UI or transfer code. The exact key may change during implementation; a suitable
initial key is `sudoku-game-library`.

```js
{
  version: 1,
  current: {
    id: "uuid",
    createdAt: "ISO timestamp or null",
    updatedAt: "ISO timestamp or null",
    importedAt: "ISO timestamp or null",
    source: "local | github-pages | imported",
    game: {
      // Existing resumable game state
    }
  },
  slots: [
    null, // exactly eight stable positions
    null,
    null,
    null,
    null,
    null,
    null,
    null
  ]
}
```

### Date semantics

- `createdAt` is when this installation created the game.
- `updatedAt` is when the player last made a meaningful game change.
- `importedAt` is when a game arrived from another origin.
- A legacy game uses `createdAt: null` and `updatedAt: null`.
- Do not display an import date as though it were the original last-played date.
- Once a legacy game is played, it receives a genuine `updatedAt`.

Entering answers, changing notes, using hints or reveals, and resetting the
puzzle update `updatedAt`. Purely presentational actions should not.

## Import/export architecture

Do not couple a transfer URL directly to the `localStorage` representation.
Introduce three separate concepts:

1. **Game library record** — a complete resumable game, including answers,
   notes, counters, and other play state.
2. **Puzzle definition** — the portable puzzle itself, primarily its givens and
   optional descriptive metadata. This will be used by future share/import
   features and should not need play history.
3. **Transfer envelope** — a versioned wrapper that identifies what is being
   imported.

Suggested envelope:

```js
{
  format: "shadowfoot-sudoku",
  version: 1,
  kind: "saved-game", // later also "puzzle"
  payload: {},
  metadata: {}
}
```

Build these boundaries from the start:

- `serializeTransfer(envelope)`
- `parseTransfer(encoded)`
- `validateSavedGame(payload)`
- `validatePuzzle(payload)`
- `importTransfer(envelope)`
- `exportSavedGame(record)`
- `exportPuzzle(game)`

Transport must be replaceable. The GitHub migration can use base64url-encoded
JSON in a URL fragment, while future features may use a compact share URL,
downloaded file, Web Share API, pasted text, or QR code. None of those transports
should know how the library is stored.

Use a version-dispatching parser so future formats can be upgraded without
refactoring callers:

```js
parsers = {
  "saved-game:1": parseSavedGameV1,
  "puzzle:1": parsePuzzleV1
};
```

A future shared puzzle should normally contain only puzzle data, not the
solution, notes, error count, or other private play state. The app can validate
and solve imported givens using its existing custom-puzzle path.

## Required checkpoint memory

This plan may be completed across different sessions. After **every phase**:

1. Run the phase's tests and record the exact commands and results.
2. Update the checklist in this document.
3. Append an entry to **Implementation Memory** at the end of this document.
4. Record data keys, schema versions, important decisions, files changed,
   compatibility assumptions, and the next safe action.
5. Record any unfinished or deliberately deferred work.
6. Commit the memory update with the phase's code before uploading to GitHub.

Do not rely on chat history as project memory. A later session must be able to
continue using the repository and this document alone.

Use this entry template:

```md
### YYYY-MM-DD — Phase N: title

- Status: complete / partial / blocked
- Commit or working tree: ...
- Files changed: ...
- Storage/schema changes: ...
- Decisions made: ...
- Verification run: ...
- Known issues or deferred work: ...
- Next action: ...
```

## Phase 1 — Extract validation and transfer primitives

- [ ] Move reusable saved-game validation out of UI-specific loading code.
- [ ] Define the versioned transfer envelope.
- [ ] Implement base64url encode/decode independently of game storage.
- [ ] Add version dispatch for `saved-game:1` and reserve `puzzle:1`.
- [ ] Add deterministic fingerprinting for duplicate import detection.
- [ ] Test malformed, unsupported, truncated, and valid payloads.
- [ ] Verify that transfer parsing never mutates storage before validation.
- [ ] Write checkpoint memory.

This phase establishes the future export/share seam before changing storage.

## Phase 2 — Add the versioned game library

- [ ] Add a dedicated storage/library module.
- [ ] Support one Current record and exactly eight stable saved positions.
- [ ] Implement load, validate, atomic write, save-to-slot, delete, replace,
      and swap operations.
- [ ] Add `createdAt`, `updatedAt`, `importedAt`, and `source`.
- [ ] Keep settings outside the library.
- [ ] Add defensive handling for unavailable or full `localStorage`.
- [ ] Test all eight positions and the nine-game limit.
- [ ] Write checkpoint memory.

For safer writes, serialize and validate the complete next library before
replacing the stored library. Never delete the only known valid representation
first.

## Phase 3 — Convert the existing single save

- [ ] Detect the legacy `sudoku-save`.
- [ ] Convert it to Current if no valid library exists.
- [ ] Preserve unknown original dates as `null`.
- [ ] Write and reload the new library successfully before removing or marking
      the legacy entry as converted.
- [ ] Make conversion idempotent.
- [ ] Ensure rollback remains possible if conversion fails.
- [ ] Test valid, invalid, missing, and already-converted saves.
- [ ] Write checkpoint memory.

The old application must remain able to write `sudoku-save` until the new
service worker takes control and reloads the new application.

## Phase 4 — Build the 3-by-3 Saved Games interface

- [ ] Add a Saved Games entry point to the main interface.
- [ ] Add the fixed 3-by-3 dialog.
- [ ] Reserve top-left for Current.
- [ ] Render eight stable saved positions.
- [ ] Render miniature 9-by-9 boards with 3-by-3 box boundaries.
- [ ] Show givens and entered answers, but exclude candidates.
- [ ] Show difficulty, filled-cell progress, and date/source labels.
- [ ] Provide useful accessible names for every card and action.
- [ ] Verify the fixed layout on small and large screens and in both color modes.
- [ ] Write checkpoint memory.

## Phase 5 — Add save, replace, delete, and resume behavior

- [ ] Add a destination-selection mode with **Save here** actions.
- [ ] Save Current into an empty selected position.
- [ ] Show both game summaries before replacing an occupied position.
- [ ] Require explicit confirmation for replacement or deletion.
- [ ] Swap a resumed saved game with Current.
- [ ] Confirm the other seven positions remain unchanged after a swap.
- [ ] Decide how completed records are labelled; do not delete them silently.
- [ ] Test keyboard, pointer, and touch operation.
- [ ] Write checkpoint memory.

## Phase 6 — Integrate New Game

- [ ] When Current is in progress, offer:
  - **Save and start new**
  - **Start new without saving**
  - **Cancel**
- [ ] Route **Save and start new** through destination-selection mode.
- [ ] Create the requested new puzzle as Current only after the save succeeds.
- [ ] Keep all saved positions unchanged when starting without saving.
- [ ] Preserve the current custom-puzzle and completion behavior.
- [ ] Test full-library behavior without automatic eviction.
- [ ] Write checkpoint memory.

## Phase 7 — Add Apps-site migration import

- [ ] Recognize a transfer envelope in the URL fragment.
- [ ] Decode and validate it before changing the library.
- [ ] Remove the fragment with `history.replaceState` after capturing it.
- [ ] If no Apps game exists, make the imported game Current.
- [ ] If Current exists, keep it Current and put the import in the first empty
      saved position (normally Slot 1 during rollout).
- [ ] If all positions are full, ask the player to choose a replacement position.
- [ ] Never replace a position without confirmation.
- [ ] Preserve Apps-site settings without importing old settings over them.
- [ ] Leave the GitHub-origin copy untouched.
- [ ] Detect duplicate imports and explain that the game is already present.
- [ ] Test import with no game, one Current game, partially full positions, and a
      full library.
- [ ] Write checkpoint memory.

## Phase 8 — Deploy and verify the Apps application

- [ ] Increment the service-worker cache version.
- [ ] Ensure all new modules and assets are included in the cache asset list.
- [ ] Ensure the SSH workflow deploys every new runtime file.
- [ ] Deploy the Apps version before the GitHub placeholder.
- [ ] Test upgrade from the currently deployed cached application.
- [ ] Test legacy conversion after accepting the service-worker update.
- [ ] Test a representative transfer payload manually.
- [ ] Confirm the production Apps URL can accept imports.
- [ ] Write checkpoint memory.

### What “Update” does on the Apps site

The current update flow is helpful for this migration:

1. The old application discovers the new waiting service worker.
2. The Settings screen displays **Update**.
3. Clicking it sends `SKIP_WAITING`.
4. Before reload, the old code calls `state.save()`, leaving a fresh
   `sudoku-save`.
5. The new application loads and converts that legacy save into Current.

Keep this sequence covered by a manual upgrade test. Do not remove legacy
conversion until the deployed population has had ample time to update.

## Phase 9 — Build the GitHub Pages placeholder

- [ ] Create redirect-only source files separate from the real application.
- [ ] Explain that Sudoku has moved and display the new address.
- [ ] Ask players to update their bookmarks.
- [ ] Require an explicit button click rather than immediately navigating.
- [ ] If `sudoku-save` is present, label the button
      **Add my old game and open Sudoku**.
- [ ] If no save exists, label it **Open Sudoku**.
- [ ] Encode a versioned `saved-game:1` transfer envelope in the URL fragment.
- [ ] Do not remove or alter the old `sudoku-save`.
- [ ] Provide a normal destination link if encoding fails.
- [ ] Test with valid, invalid, and absent old saves.
- [ ] Write checkpoint memory.

## Phase 10 — Support updates from the cached GitHub application

The redirect deployment should include a minimal retirement service worker at
the same `sw.js` URL as the old application. It should:

- Install as a waiting worker so the old application's existing **Update**
  control can activate it.
- Respond to the existing `SKIP_WAITING` message.
- On activation, remove the old GitHub application caches and claim clients.
- Avoid caching the old application again.
- Allow the subsequent reload to fetch the placeholder from the network.
- Let the placeholder unregister the retirement worker after it loads.

Expected behavior after everything is deployed:

1. A player still using the cached GitHub application is offered **Update**.
2. They click it.
3. The old code saves the current game immediately before reload.
4. The retirement worker activates and removes the obsolete app cache.
5. Reload shows the bookmark-update placeholder.
6. The player clicks **Add my old game and open Sudoku**.
7. The game is added at the Apps origin without replacing Current.

This makes an explicit update reliable while still allowing players who do
nothing to remain on their cached copy during the gradual transition.

- [ ] Implement and test the retirement worker.
- [ ] Confirm the existing update button can activate it.
- [ ] Confirm the final old-origin save is made before reload.
- [ ] Confirm the placeholder can read that save.
- [ ] Confirm the placeholder unregisters the retirement worker.
- [ ] Write checkpoint memory.

## Phase 11 — Separate and publish GitHub Pages

- [ ] Keep the existing SSH workflow responsible for the full Apps application.
- [ ] Add a Pages workflow that publishes only the redirect source.
- [ ] Configure GitHub Pages to use GitHub Actions rather than the root of
      `main`.
- [ ] Verify the GitHub URL serves only the placeholder.
- [ ] Verify the Apps URL continues serving the full application.
- [ ] Test bookmark messaging and transfer end to end in production.
- [ ] Confirm no application update can accidentally republish the full app to
      GitHub Pages.
- [ ] Write final checkpoint memory before pushing the completed deployment
      changes.

## Test matrix

At minimum, cover:

- No existing game at either origin.
- Only an Apps-origin game.
- Only a GitHub-origin legacy game.
- Different games at both origins.
- The same game transferred twice.
- Some saved positions occupied.
- All eight saved positions occupied.
- Replacing an occupied position.
- Cancelling replacement.
- Swapping Current with each saved position.
- A legacy game containing many candidate notes.
- A completed legacy game.
- Invalid or unsupported transfer data.
- Storage quota/write failure.
- Upgrade through the Apps service-worker Update action.
- Upgrade through the cached GitHub application's Update action.
- Reload during each migration stage.

## Definition of done

- The Apps site supports Current plus eight stable saved positions.
- No automatic action overwrites or evicts a game.
- Existing Apps saves convert without losing state.
- A GitHub game can be added without replacing an Apps game.
- Settings remain local to the Apps origin.
- GitHub Pages explains the move and asks players to update bookmarks.
- Explicit Update works safely at both origins.
- Transfer encoding, validation, and storage are sufficiently separated to add
  future puzzle export/share/import without redesigning the game library.
- Every completed phase has a repository-based memory entry.

## Implementation Memory

No implementation phases have been started. Append checkpoint entries here
using the required template after every phase.

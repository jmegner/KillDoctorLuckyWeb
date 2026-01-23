# Kill Doctor Lucky Web App Continuation Spec (Deterministic, 2 Players)

## Goals
- Provide a deterministic, 2-human-player web experience using KdlRust core for rules and state.
- Continue building UI (React + Vite) to display the board, room highlights, and all five playing pieces.
- Support turn planning by allowing players to select moves for their own piece and strangers only, then submit/cancel those moves.
- Provide clear validation feedback for illegal or incomplete moves.

## Scope
- **Players:** 2 human players (P1 and P2).
- **Strangers:** 2 strangers.
- **Doctor:** 1 doctor.
- **Randomness:** none; deterministic variant.
- **Board:** AltDown (alternate downstairs board JSON currently used in the UI).
- **No card draws** or other random game events.

## UX/Interaction Summary
- Players build a **turn plan** by clicking a piece and then a destination room.
- Pieces you can move: **your own player piece** and **either stranger**.
- Pieces you cannot move: **opponent player piece** and **doctor**.
- **Selections are queued and displayed** as a short summary string (e.g., `P1@R7, S2@R8`).
- Clicking a piece already in the plan puts it into “update destination” mode for the next room click.
- **Submit** validates the turn plan with KdlRust core and applies it if valid.
- **Cancel** clears the in-progress selections.
- **Info** opens a lightweight rule/help panel.
- Invalid submissions show **clear errors** (inline and/or toast) and do not mutate the game state.

## Visual Requirements
### Board + Rooms
- Use the existing SVG board background (AltDown) with overlaid, invisible room hit targets.
- Clicking a room selects it as a destination (if a piece is selected in the planner).
- Optional/Recommended: visually darken rooms not reachable in one move step for the currently selected piece.

### Playing Pieces
- Five pieces total, drawn on top of the board.
- **Shapes & colors**:
  - Doctor: **black circle**.
  - Player pieces: **squares**, colored **red** and **green**.
  - Strangers: **hexagons**, colored **orange** and **yellow**.
- **Sizing constraint:** all five pieces must fit within the smallest AltDown room. Target sizes should allow a 5-piece cluster with some spacing. A safe baseline is:
  - piece bounding box: **22–26 px** square/diameter
  - spacing between pieces: **2–4 px**

### Placement
- Each room has a bounding rectangle in `BoardAltDown.json`. Pieces should be placed inside the room rect, using deterministic offsets to avoid overlap.
- Use a stable ordering (doctor, players, strangers) and a layout algorithm to pack the five pieces into a mini grid or ring based on room size.

## Interaction Details
### Turn Planning Model
- A turn plan is a list of **(piece, destination room)** pairs.
- Only the current player’s piece and strangers can be added/edited.
- Each piece can appear **at most once** in the plan. Clicking the same piece again puts it into “waiting for new room” mode; the next room click updates the destination for that piece.

### Click Flow
1. **Click a piece** to choose which piece to move.
2. **Click a room** to set the destination for the selected piece.
3. Repeat to add more moves (0+), subject to KdlRust validation.

### UI States
- **Selected piece** is visually highlighted (outline/glow).
- **Planned moves list** is shown as text (e.g., `P1@R7, S1@R8`).
- **Reachable rooms** (optional) are visually emphasized for the selected piece; unreachable rooms are subtly darkened.

## Validation & Feedback
- Use KdlRust core to validate a full plan on submit.
- Invalid move feedback:
  - Show a clear error message (e.g., “P1 cannot move to R12: blocked by wall”) near the planner and/or as a toast.
  - Keep the plan intact so the player can fix it.
- If the plan is empty, submit should be allowed only if the game rules permit “no move”; otherwise show a warning.

## Required KdlRust Core Support
Expose the following to the wasm/web layer (names are illustrative):

### Read State
- `board_rooms()` → rooms, IDs, and adjacency for pathing.
- `piece_positions()` → room IDs for doctor, both players, and strangers.
- `current_player()` → whose turn it is.

### Validation/Rules
- `reachable_rooms(piece_id, steps=1)` → list of room IDs (for highlighting).
- `validate_turn_plan(turn_plan)` → returns OK or detailed errors.
- `apply_turn_plan(turn_plan)` → mutates state if valid.

### Turn Plan Data Shape
- `piece_id` could be a tagged enum (`Doctor`, `Player1`, `Player2`, `Stranger1`, `Stranger2`).
- `room_id` should be the board room ID used in `BoardAltDown.json`.
- Keep turn plan structure flat for easy JSON/wasm interop.

## UI Architecture Suggestions
- **PlayArea** continues to own the board view and will host:
  - **PieceLayer** (SVG shapes for pieces)
  - **RoomLayer** (hit targets + optional highlight overlay)
  - **TurnPlannerPanel** (summary string + buttons)
- Add a lightweight state machine in UI:
  - `selectedPieceId: PieceId | null`
  - `plannedMoves: Record<PieceId, RoomId>`
  - `validationMessage: string | null`

## Acceptance Criteria
- All five pieces render with correct shapes/colors and **fit the smallest AltDown room**.
- Player can add/update a move plan by clicking piece → room, with visual feedback.
- Submit validates against KdlRust core and either applies changes or surfaces a clear error.
- Cancel clears planned moves and selection.
- Info button opens a short rules/help panel.
- No random card draws or randomized setup.

## Future Extensions (Out of Scope for This Spec)
- AI player support.
- Random card draw mechanics and deck UI.
- Multi-step movement and advanced turn planning.
- Networking/multiplayer across devices.

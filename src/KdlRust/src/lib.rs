use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fmt;
use wasm_bindgen::prelude::*;

pub mod core;
pub mod util;

#[wasm_bindgen]
extern "C" {
    fn alert(s: &str);
}

#[wasm_bindgen]
pub fn greet() {
    alert("Hello from KdlRust.");
}

//#[wasm_bindgen] // with no renaming
#[wasm_bindgen(js_name = "getANumber")]
pub fn get_a_number() -> i32 {
    7
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum PieceId {
    Doctor,
    Player1,
    Player2,
    Stranger1,
    Stranger2,
}

impl PieceId {
    fn display_label(self) -> &'static str {
        match self {
            PieceId::Doctor => "Doctor",
            PieceId::Player1 => "P1",
            PieceId::Player2 => "P2",
            PieceId::Stranger1 => "S1",
            PieceId::Stranger2 => "S2",
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            PieceId::Doctor => "doctor",
            PieceId::Player1 => "player1",
            PieceId::Player2 => "player2",
            PieceId::Stranger1 => "stranger1",
            PieceId::Stranger2 => "stranger2",
        }
    }

    fn parse(input: &str) -> Option<Self> {
        match input.trim().to_ascii_lowercase().as_str() {
            "doctor" => Some(PieceId::Doctor),
            "player1" => Some(PieceId::Player1),
            "player2" => Some(PieceId::Player2),
            "stranger1" => Some(PieceId::Stranger1),
            "stranger2" => Some(PieceId::Stranger2),
            _ => None,
        }
    }

    fn from_player_id(player_id: core::player::PlayerId, has_strangers: bool) -> Option<Self> {
        if has_strangers {
            match player_id.0 {
                0 => Some(PieceId::Player1),
                1 => Some(PieceId::Stranger1),
                2 => Some(PieceId::Player2),
                3 => Some(PieceId::Stranger2),
                _ => None,
            }
        } else {
            match player_id.0 {
                0 => Some(PieceId::Player1),
                1 => Some(PieceId::Player2),
                _ => None,
            }
        }
    }

    fn to_player_id(self) -> Option<core::player::PlayerId> {
        use core::rule_helper;

        match self {
            PieceId::Doctor => None,
            PieceId::Player1 => Some(rule_helper::SIDE_A_NORMAL_PLAYER_ID),
            PieceId::Player2 => Some(rule_helper::SIDE_B_NORMAL_PLAYER_ID),
            PieceId::Stranger1 => Some(rule_helper::STRANGER_PLAYER_ID_FIRST),
            PieceId::Stranger2 => Some(rule_helper::STRANGER_PLAYER_ID_SECOND),
        }
    }
}

impl fmt::Display for PieceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.display_label())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TurnPlanEntry {
    piece_id: PieceId,
    room_id: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardRoomInfo {
    id: usize,
    name: String,
    adjacent: Vec<usize>,
    visible: Vec<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TurnPlanPreview {
    is_valid: bool,
    validation_message: String,
    next_player_piece_id: String,
    attackers: Vec<String>,
    current_player_loots: bool,
    doctor_room_id: usize,
    moved_strangers: Vec<PreviewPieceRoom>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewPieceRoom {
    piece_id: String,
    room_id: usize,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedGameState {
    version: u32,
    board_name: String,
    normal_turns: Vec<core::simple_turn::SimpleTurn>,
}

const PERSISTED_GAME_STATE_VERSION: u32 = 1;

fn normal_piece_id_for_state(state: &core::mutable_game_state::MutableGameState) -> PieceId {
    let normal_id =
        core::rule_helper::to_normal_player_id(state.current_player_id, state.common.num_normal_players);
    if normal_id == core::rule_helper::SIDE_A_NORMAL_PLAYER_ID {
        PieceId::Player1
    } else {
        PieceId::Player2
    }
}

fn to_preview_json(preview: &TurnPlanPreview) -> String {
    serde_json::to_string(preview).unwrap_or_else(|_| {
        "{\"isValid\":false,\"validationMessage\":\"Preview serialization failed.\",\"nextPlayerPieceId\":\"\",\"attackers\":[],\"currentPlayerLoots\":false,\"doctorRoomId\":0,\"movedStrangers\":[]}".to_string()
    })
}

fn invalid_preview_json(message: String) -> String {
    to_preview_json(&TurnPlanPreview {
        is_valid: false,
        validation_message: message,
        next_player_piece_id: String::new(),
        attackers: Vec::new(),
        current_player_loots: false,
        doctor_room_id: 0,
        moved_strangers: Vec::new(),
    })
}

fn current_player_loots_after_turn(
    state: &core::mutable_game_state::MutableGameState,
    turn: &core::simple_turn::SimpleTurn,
) -> bool {
    let mut preview_state = state.copy_state();
    let current_player_id = preview_state.current_player_id;
    let mut moved_stranger_that_saw_doctor = false;

    for mv in &turn.moves {
        let player_idx = mv.player_id.0;
        let current_room_id = preview_state.player_room_ids[player_idx];
        if mv.player_id != current_player_id
            && preview_state.common.board.sight[current_room_id.0][preview_state.doctor_room_id.0]
        {
            moved_stranger_that_saw_doctor = true;
        }
        preview_state.player_room_ids[player_idx] = mv.dest_room_id;
    }

    preview_state.best_action_allowed(moved_stranger_that_saw_doctor) == core::player::PlayerAction::Loot
}

fn collect_normal_turns(state: &core::mutable_game_state::MutableGameState) -> Vec<core::simple_turn::SimpleTurn> {
    let mut states = Vec::new();
    let mut cursor = Some(state);

    while let Some(current) = cursor {
        states.push(current);
        cursor = current.prev_state.as_deref();
    }

    states.reverse();
    states
        .into_iter()
        .skip(1)
        .filter_map(|current| {
            let prev_state = current.prev_state.as_deref()?;
            if prev_state.is_normal_turn() {
                Some(current.prev_turn.clone())
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
}

#[wasm_bindgen]
pub struct GameStateHandle {
    state: core::mutable_game_state::MutableGameState,
}

#[wasm_bindgen]
impl GameStateHandle {
    pub fn summary(&self, indentation_level: usize) -> String {
        self.state.summary(indentation_level)
    }

    #[wasm_bindgen(js_name = "currentPlayerPieceId")]
    pub fn current_player_piece_id(&self) -> String {
        normal_piece_id_for_state(&self.state).as_str().to_string()
    }

    #[wasm_bindgen(js_name = "hasWinner")]
    pub fn has_winner(&self) -> bool {
        self.state.has_winner()
    }

    #[wasm_bindgen(js_name = "winnerPieceId")]
    pub fn winner_piece_id(&self) -> String {
        if !self.state.has_winner() {
            return String::new();
        }

        let normal_id = core::rule_helper::to_normal_player_id(self.state.winner, self.state.common.num_normal_players);
        let piece_id = if normal_id == core::rule_helper::SIDE_A_NORMAL_PLAYER_ID {
            PieceId::Player1
        } else {
            PieceId::Player2
        };
        piece_id.as_str().to_string()
    }

    #[wasm_bindgen(js_name = "piecePositions")]
    pub fn piece_positions(&self) -> Vec<u32> {
        vec![
            self.state.doctor_room_id.0 as u32,
            self.state.player_room_ids[core::rule_helper::SIDE_A_NORMAL_PLAYER_ID.0].0 as u32,
            self.state.player_room_ids[core::rule_helper::SIDE_B_NORMAL_PLAYER_ID.0].0 as u32,
            self.state.player_room_ids[core::rule_helper::STRANGER_PLAYER_ID_FIRST.0].0 as u32,
            self.state.player_room_ids[core::rule_helper::STRANGER_PLAYER_ID_SECOND.0].0 as u32,
        ]
    }

    #[wasm_bindgen(js_name = "boardRoomsJson")]
    pub fn board_rooms_json(&self) -> String {
        let rooms = self
            .state
            .common
            .board
            .room_ids
            .iter()
            .filter_map(|room_id| self.state.common.board.rooms.get(room_id))
            .map(|room| BoardRoomInfo {
                id: room.id.0,
                name: room.name.clone(),
                adjacent: room.adjacent.iter().map(|id| id.0).collect::<Vec<_>>(),
                visible: room.visible.iter().map(|id| id.0).collect::<Vec<_>>(),
            })
            .collect::<Vec<_>>();

        serde_json::to_string(&rooms).unwrap_or_else(|_| "[]".to_string())
    }

    #[wasm_bindgen(js_name = "reachableRooms")]
    pub fn reachable_rooms(&self, piece_id: &str, steps: i32) -> Vec<u32> {
        let Some(piece_id) = PieceId::parse(piece_id) else {
            return Vec::new();
        };
        let steps = steps.max(0);
        let room_id = match piece_id {
            PieceId::Doctor => self.state.doctor_room_id,
            _ => {
                let Some(player_id) = piece_id.to_player_id() else {
                    return Vec::new();
                };
                let Some(room_id) = self.state.player_room_ids.get(player_id.0) else {
                    return Vec::new();
                };
                *room_id
            }
        };

        self.state
            .common
            .board
            .room_ids
            .iter()
            .filter(|dest_room_id| {
                self.state.common.board.distance[room_id.0][dest_room_id.0] <= steps
            })
            .map(|dest_room_id| dest_room_id.0 as u32)
            .collect::<Vec<_>>()
    }

    #[wasm_bindgen(js_name = "undoLastTurn")]
    pub fn undo_last_turn(&mut self) -> bool {
        loop {
            let prev_state = self
                .state
                .prev_state
                .as_ref()
                .map(|state| state.as_ref().clone());

            let Some(prev_state) = prev_state else {
                return false;
            };

            self.state = prev_state;

            if self.state.is_normal_turn() {
                return true;
            }
        }
    }

    #[wasm_bindgen(js_name = "resetGame")]
    pub fn reset_game(&mut self) {
        let common = self.state.common.clone();
        self.state = core::mutable_game_state::MutableGameState::at_start(common);
    }

    #[wasm_bindgen(js_name = "normalTurnHistory")]
    pub fn normal_turn_history(&self) -> String {
        self.state.normal_turn_hist()
    }

    #[wasm_bindgen(js_name = "prevTurnSummaryVerbose")]
    pub fn prev_turn_summary_verbose(&self) -> String {
        self.state.prev_turn_summaries_since_normal(true)
    }

    #[wasm_bindgen(js_name = "animationFrames")]
    pub fn animation_frames(&self) -> Vec<u32> {
        let frames = self.state.animation_frames_since_normal();
        let mut flat = Vec::with_capacity(frames.len() * 5);

        for frame in frames {
            flat.push(frame[0].0 as u32);
            flat.push(frame[1].0 as u32);
            flat.push(frame[2].0 as u32);
            flat.push(frame[3].0 as u32);
            flat.push(frame[4].0 as u32);
        }

        flat
    }

    #[wasm_bindgen(js_name = "validateTurnPlan")]
    pub fn validate_turn_plan(&self, turn_plan_json: &str) -> String {
        let turn = match parse_turn_plan(turn_plan_json) {
            Ok(turn) => turn,
            Err(message) => return message,
        };

        match self.state.check_normal_turn(&turn) {
            Ok(()) => String::new(),
            Err(message) => message,
        }
    }

    #[wasm_bindgen(js_name = "applyTurnPlan")]
    pub fn apply_turn_plan(&mut self, turn_plan_json: &str) -> String {
        let turn = match parse_turn_plan(turn_plan_json) {
            Ok(turn) => turn,
            Err(message) => return message,
        };

        if let Err(message) = self.state.check_normal_turn(&turn) {
            return message;
        }

        self.state.after_normal_turn(turn, true);
        String::new()
    }

    #[wasm_bindgen(js_name = "previewTurnPlan")]
    pub fn preview_turn_plan(&self, turn_plan_json: &str) -> String {
        let turn = match parse_turn_plan(turn_plan_json) {
            Ok(turn) => turn,
            Err(message) => return invalid_preview_json(message),
        };

        if let Err(message) = self.state.check_normal_turn(&turn) {
            return invalid_preview_json(message);
        }

        let current_player_loots = current_player_loots_after_turn(&self.state, &turn);
        let prior_attack_count = self.state.attacker_hist.len();
        let mut preview_state = self.state.copy_state();
        preview_state.after_normal_turn(turn, false);

        let mut seen_attackers = HashSet::new();
        let mut attackers = Vec::new();
        let has_strangers = preview_state.common.has_strangers();
        for player_id in preview_state.attacker_hist.iter().skip(prior_attack_count) {
            let Some(piece_id) = PieceId::from_player_id(*player_id, has_strangers) else {
                continue;
            };
            let piece_id = piece_id.as_str().to_string();
            if seen_attackers.insert(piece_id.clone()) {
                attackers.push(piece_id);
            }
        }

        let mut moved_strangers = Vec::new();
        if preview_state.common.has_strangers() {
            let stranger_rooms = [
                (core::rule_helper::STRANGER_PLAYER_ID_FIRST, PieceId::Stranger1),
                (core::rule_helper::STRANGER_PLAYER_ID_SECOND, PieceId::Stranger2),
            ];
            for (player_id, piece_id) in stranger_rooms {
                let current_room_id = self.state.player_room_ids[player_id.0].0;
                let preview_room_id = preview_state.player_room_ids[player_id.0].0;
                if current_room_id != preview_room_id {
                    moved_strangers.push(PreviewPieceRoom {
                        piece_id: piece_id.as_str().to_string(),
                        room_id: preview_room_id,
                    });
                }
            }
        }

        to_preview_json(&TurnPlanPreview {
            is_valid: true,
            validation_message: String::new(),
            next_player_piece_id: normal_piece_id_for_state(&preview_state).as_str().to_string(),
            attackers,
            current_player_loots,
            doctor_room_id: preview_state.doctor_room_id.0,
            moved_strangers,
        })
    }

    #[wasm_bindgen(js_name = "exportStateJson")]
    pub fn export_state_json(&self) -> String {
        let snapshot = PersistedGameState {
            version: PERSISTED_GAME_STATE_VERSION,
            board_name: self.state.common.board.name.clone(),
            normal_turns: collect_normal_turns(&self.state),
        };

        serde_json::to_string(&snapshot).unwrap_or_else(|_| {
            "{\"version\":1,\"boardName\":\"\",\"normalTurns\":[]}".to_string()
        })
    }

    #[wasm_bindgen(js_name = "importStateJson")]
    pub fn import_state_json(&mut self, state_json: &str) -> String {
        let snapshot = match serde_json::from_str::<PersistedGameState>(state_json) {
            Ok(snapshot) => snapshot,
            Err(err) => return format!("Invalid saved game JSON: {err}"),
        };

        if snapshot.version != PERSISTED_GAME_STATE_VERSION {
            return format!(
                "Unsupported saved game version {}.",
                snapshot.version
            );
        }

        if snapshot.board_name != self.state.common.board.name {
            return format!(
                "Saved game board '{}' does not match current board '{}'.",
                snapshot.board_name, self.state.common.board.name
            );
        }

        let common = self.state.common.clone();
        let mut restored = core::mutable_game_state::MutableGameState::at_start(common);

        for (turn_idx, turn) in snapshot.normal_turns.into_iter().enumerate() {
            if let Err(message) = restored.check_normal_turn(&turn) {
                return format!(
                    "Saved game turn {} is invalid: {message}",
                    turn_idx + 1
                );
            }
            restored.after_normal_turn(turn, true);
        }

        self.state = restored;
        String::new()
    }
}

#[wasm_bindgen(js_name = "newDefaultGameState")]
pub fn new_default_game_state() -> Result<GameStateHandle, JsValue> {
    let board = core::board::Board::from_embedded_json("BoardAltDown")
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let common = core::common_game_state::CommonGameState::from_num_normal_players(true, board, 2);
    let state = core::mutable_game_state::MutableGameState::at_start(common);
    Ok(GameStateHandle { state })
}

fn parse_turn_plan(turn_plan_json: &str) -> Result<core::simple_turn::SimpleTurn, String> {
    let trimmed = turn_plan_json.trim();
    let entries = if trimmed.is_empty() {
        Vec::new()
    } else {
        serde_json::from_str::<Vec<TurnPlanEntry>>(trimmed)
            .map_err(|err| format!("Invalid turn plan JSON: {err}"))?
    };

    let mut seen = HashSet::new();
    let moves = entries
        .into_iter()
        .map(|entry| {
            if !seen.insert(entry.piece_id) {
                return Err(format!(
                    "{} appears more than once in the turn plan.",
                    entry.piece_id
                ));
            }

            let Some(player_id) = entry.piece_id.to_player_id() else {
                return Err("Doctor cannot be moved.".to_string());
            };

            Ok(core::player::PlayerMove::new(
                player_id,
                core::room::RoomId(entry.room_id),
            ))
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(core::simple_turn::SimpleTurn::new(moves))
}

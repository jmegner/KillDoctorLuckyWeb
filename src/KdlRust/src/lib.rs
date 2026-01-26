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
        let normal_id = core::rule_helper::to_normal_player_id(
            self.state.current_player_id,
            self.state.common.num_normal_players,
        );
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

    #[wasm_bindgen(js_name = "normalTurnHistory")]
    pub fn normal_turn_history(&self) -> String {
        self.state.normal_turn_hist()
    }

    #[wasm_bindgen(js_name = "prevTurnSummaryVerbose")]
    pub fn prev_turn_summary_verbose(&self) -> String {
        self.state.prev_turn_summaries_since_normal(true)
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

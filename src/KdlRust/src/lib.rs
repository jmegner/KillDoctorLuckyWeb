use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::core::{
    player::{PlayerId, PlayerType},
    room::RoomId,
    simple_turn::SimpleTurn,
};

pub mod core;
pub mod util;

#[wasm_bindgen]
extern "C" {
    fn alert(s: &str);
}

#[wasm_bindgen]
pub fn greet() {
    alert("Hello from KillDoctorLuckyRust.");
}

//#[wasm_bindgen] // with no renaming
#[wasm_bindgen(js_name = "getANumber")]
pub fn get_a_number() -> i32 {
    7
}

#[wasm_bindgen]
pub struct GameStateHandle {
    state: core::mutable_game_state::MutableGameState,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlannedMove {
    piece_id: String,
    room_id: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PiecePosition {
    piece_id: String,
    kind: String,
    room_id: usize,
}

#[wasm_bindgen]
impl GameStateHandle {
    pub fn summary(&self, indentation_level: usize) -> String {
        self.state.summary(indentation_level)
    }

    #[wasm_bindgen(js_name = "currentPlayerPieceId")]
    pub fn current_player_piece_id(&self) -> String {
        player_piece_id(self.state.current_player_id)
    }

    #[wasm_bindgen(js_name = "piecePositions")]
    pub fn piece_positions(&self) -> Result<JsValue, JsValue> {
        let mut pieces = Vec::new();
        pieces.push(PiecePosition {
            piece_id: "Doctor".to_string(),
            kind: "doctor".to_string(),
            room_id: self.state.doctor_room_id.0,
        });

        for player_id in self.state.common.player_ids() {
            let kind = match self.state.common.get_player_type(player_id) {
                PlayerType::Normal => "player",
                PlayerType::Stranger => "stranger",
            };
            pieces.push(PiecePosition {
                piece_id: player_piece_id(player_id),
                kind: kind.to_string(),
                room_id: self.state.player_room_ids[player_id.0].0,
            });
        }

        serde_wasm_bindgen::to_value(&pieces)
            .map_err(|err| JsValue::from_str(&err.to_string()))
    }

    #[wasm_bindgen(js_name = "reachableRooms")]
    pub fn reachable_rooms(&self, piece_id: String, steps: i32) -> Result<JsValue, JsValue> {
        if steps < 0 {
            return Err(JsValue::from_str("steps must be non-negative"));
        }
        let max_steps = steps as i32;
        let start_room = match piece_id.as_str() {
            "Doctor" => self.state.doctor_room_id,
            _ => room_for_piece(&self.state, &piece_id)?,
        };
        let distances = &self.state.common.board.distance[start_room.0];
        let reachable = self
            .state
            .common
            .board
            .room_ids
            .iter()
            .copied()
            .filter(|room_id| distances[room_id.0] <= max_steps)
            .map(|room_id| room_id.0)
            .collect::<Vec<_>>();
        serde_wasm_bindgen::to_value(&reachable)
            .map_err(|err| JsValue::from_str(&err.to_string()))
    }

    #[wasm_bindgen(js_name = "validateTurnPlan")]
    pub fn validate_turn_plan(&self, plan: JsValue) -> Result<(), JsValue> {
        let moves = parse_planned_moves(&self.state, plan)?;
        let turn = SimpleTurn::new(moves);
        self.state
            .check_normal_turn(&turn)
            .map_err(JsValue::from_str)
    }

    #[wasm_bindgen(js_name = "applyTurnPlan")]
    pub fn apply_turn_plan(&mut self, plan: JsValue) -> Result<(), JsValue> {
        let moves = parse_planned_moves(&self.state, plan)?;
        let turn = SimpleTurn::new(moves);
        self.state
            .check_normal_turn(&turn)
            .map_err(JsValue::from_str)?;
        self.state.after_normal_turn(turn, false);
        Ok(())
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

fn player_piece_id(player_id: PlayerId) -> String {
    if player_id.0 % 2 == 0 {
        format!("P{}", player_id.0 / 2 + 1)
    } else {
        format!("S{}", player_id.0 / 2 + 1)
    }
}

fn player_id_for_piece(piece_id: &str) -> Result<PlayerId, JsValue> {
    match piece_id {
        "P1" => Ok(PlayerId(0)),
        "P2" => Ok(PlayerId(2)),
        "S1" => Ok(PlayerId(1)),
        "S2" => Ok(PlayerId(3)),
        "Doctor" => Err(JsValue::from_str("doctor cannot be moved")),
        _ => Err(JsValue::from_str("unknown piece id")),
    }
}

fn room_for_piece(
    state: &core::mutable_game_state::MutableGameState,
    piece_id: &str,
) -> Result<RoomId, JsValue> {
    let player_id = player_id_for_piece(piece_id)?;
    state
        .player_room_ids
        .get(player_id.0)
        .copied()
        .ok_or_else(|| JsValue::from_str("player id out of range"))
}

fn parse_planned_moves(
    state: &core::mutable_game_state::MutableGameState,
    plan: JsValue,
) -> Result<Vec<core::player::PlayerMove>, JsValue> {
    let planned_moves: Vec<PlannedMove> =
        serde_wasm_bindgen::from_value(plan).map_err(|err| JsValue::from_str(&err.to_string()))?;
    let moves = planned_moves
        .into_iter()
        .map(|mv| {
            let player_id = player_id_for_piece(&mv.piece_id)?;
            Ok(core::player::PlayerMove::new(player_id, RoomId(mv.room_id)))
        })
        .collect::<Result<Vec<_>, JsValue>>()?;
    Ok(moves)
}

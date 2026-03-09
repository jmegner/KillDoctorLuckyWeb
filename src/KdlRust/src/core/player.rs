use crate::core::{mutable_game_state::MutableGameState, room::RoomId, simple_turn::SimpleTurn};
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(transparent)]
pub struct PlayerId(pub usize);

impl PlayerId {
    pub const INVALID: Self = Self(999);
}

impl fmt::Display for PlayerId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub enum PlayerAction {
    None,
    Loot,
    Attack,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub enum PlayerType {
    Normal,
    Stranger,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "PascalCase")]
#[readonly::make]
pub struct PieceMove {
    pub player_id: PlayerId,
    pub dest_room_id: RoomId,
}

impl PieceMove {
    pub fn new(player_id: PlayerId, dest_room_id: RoomId) -> Self {
        Self {
            player_id,
            dest_room_id,
        }
    }
}

impl fmt::Display for PieceMove {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}@{}", self.player_id.0 + 1, self.dest_room_id)
    }
}

pub fn player_moves_to_nice_string(moves: impl IntoIterator<Item = PieceMove>) -> String {
    let joined = moves
        .into_iter()
        .map(|player_move| player_move.to_string())
        .collect::<Vec<_>>()
        .join(" ");
    format!("{joined};")
}

pub struct AppraisedPlayerTurn {
    pub appraisal: f64,
    pub turn: SimpleTurn,
    pub ending_state: MutableGameState,
}

impl AppraisedPlayerTurn {
    pub fn new(appraisal: f64, turn: SimpleTurn, ending_state: MutableGameState) -> Self {
        Self {
            appraisal,
            turn,
            ending_state,
        }
    }

    pub fn from_state(analysis_player_id: PlayerId, state: MutableGameState) -> Self {
        let appraisal = state.heuristic_score(analysis_player_id);
        let turn = state.prev_turn.clone();
        Self {
            appraisal,
            turn,
            ending_state: state,
        }
    }

    pub fn empty_minimum(ending_state: MutableGameState) -> Self {
        Self {
            appraisal: f64::NEG_INFINITY,
            turn: SimpleTurn::default(),
            ending_state,
        }
    }

    pub fn empty_maximum(ending_state: MutableGameState) -> Self {
        Self {
            appraisal: f64::INFINITY,
            turn: SimpleTurn::default(),
            ending_state,
        }
    }
}

impl fmt::Display for AppraisedPlayerTurn {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}{}", self.turn, self.appraisal)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{board::Board, common_game_state::CommonGameState, room::Room};

    #[test]
    fn player_move_display_matches_csharp() {
        let player_move = PieceMove::new(PlayerId(0), RoomId(7));
        assert_eq!(player_move.to_string(), "1@7");
    }

    #[test]
    fn player_moves_to_nice_string_matches_extension_method() {
        let moves = vec![
            PieceMove::new(PlayerId(0), RoomId(4)),
            PieceMove::new(PlayerId(2), RoomId(9)),
        ];
        assert_eq!(player_moves_to_nice_string(moves), "1@4 3@9;");
    }

    fn sample_state() -> MutableGameState {
        let board = Board::new(
            "tiny",
            [
                Room::new(RoomId(1), "A", [RoomId(2)], [RoomId(2)]),
                Room::new(RoomId(2), "B", [RoomId(1)], [RoomId(1)]),
            ],
            RoomId(1),
            RoomId(1),
            RoomId(1),
            RoomId(1),
            None,
        );
        let common = CommonGameState::from_num_normal_players(true, board, 3);
        MutableGameState::at_start(common)
    }

    #[test]
    fn appraised_player_turn_from_state_uses_state_data() {
        let mut state = sample_state();
        state.player_move_cards[0] = 1.5;
        state.prev_turn = SimpleTurn::from_move(PieceMove::new(PlayerId(1), RoomId(2)));
        let expected_appraisal = state.heuristic_score(PlayerId(2));

        let appraised = AppraisedPlayerTurn::from_state(PlayerId(2), state);

        assert_eq!(appraised.appraisal, expected_appraisal);
        assert_eq!(
            appraised.turn,
            SimpleTurn::from_move(PieceMove::new(PlayerId(1), RoomId(2)))
        );
        assert_eq!(appraised.ending_state.player_move_cards[0], 1.5);
    }

    #[test]
    fn empty_minimum_and_maximum_mimic_static_defaults() {
        let state = sample_state();
        let empty_min = AppraisedPlayerTurn::empty_minimum(state.clone());
        assert_eq!(empty_min.appraisal, f64::NEG_INFINITY);
        assert_eq!(empty_min.turn, SimpleTurn::default());
        assert_eq!(empty_min.ending_state, state);

        let empty_max = AppraisedPlayerTurn::empty_maximum(state.clone());
        assert_eq!(empty_max.appraisal, f64::INFINITY);
        assert_eq!(empty_max.turn, SimpleTurn::default());
        assert_eq!(empty_max.ending_state, state);
    }
}

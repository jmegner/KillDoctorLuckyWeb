use crate::core::room::RoomId;
use serde::{Deserialize, Serialize};
use std::fmt;

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
pub struct PlayerMove {
    pub player_id: i32,
    pub dest_room_id: RoomId,
}

impl PlayerMove {
    pub fn new(player_id: i32, dest_room_id: RoomId) -> Self {
        Self {
            player_id,
            dest_room_id,
        }
    }
}

impl fmt::Display for PlayerMove {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}@{}", self.player_id + 1, self.dest_room_id)
    }
}

pub fn player_moves_to_nice_string(moves: impl IntoIterator<Item = PlayerMove>) -> String {
    let joined = moves
        .into_iter()
        .map(|player_move| player_move.to_string())
        .collect::<Vec<_>>()
        .join(" ");
    format!("{joined};")
}

pub trait AppraisalState<TTurn> {
    fn heuristic_score(&self, analysis_player_id: i32) -> f64;
    fn prev_turn(&self) -> Option<TTurn>;
}

pub struct AppraisedPlayerTurn<TTurn, TGameState> {
    pub appraisal: f64,
    pub turn: Option<TTurn>,
    pub ending_state: Option<TGameState>,
}

impl<TTurn, TGameState> AppraisedPlayerTurn<TTurn, TGameState> {
    pub fn new(appraisal: f64, turn: TTurn, ending_state: TGameState) -> Self {
        Self {
            appraisal,
            turn: Some(turn),
            ending_state: Some(ending_state),
        }
    }

    pub fn from_state(analysis_player_id: i32, state: TGameState) -> Self
    where
        TGameState: AppraisalState<TTurn>,
    {
        let appraisal = state.heuristic_score(analysis_player_id);
        let turn = state.prev_turn();
        Self {
            appraisal,
            turn,
            ending_state: Some(state),
        }
    }

    pub fn empty_minimum() -> Self {
        Self {
            appraisal: f64::NEG_INFINITY,
            turn: None,
            ending_state: None,
        }
    }

    pub fn empty_maximum() -> Self {
        Self {
            appraisal: f64::INFINITY,
            turn: None,
            ending_state: None,
        }
    }
}

impl<TTurn, TGameState> fmt::Display for AppraisedPlayerTurn<TTurn, TGameState>
where
    TTurn: fmt::Display,
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let turn_text = self
            .turn
            .as_ref()
            .map(|turn| turn.to_string())
            .unwrap_or_default();
        write!(f, "{}{}", turn_text, self.appraisal)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn player_move_display_matches_csharp() {
        let player_move = PlayerMove::new(0, RoomId(7));
        assert_eq!(player_move.to_string(), "1@7");
    }

    #[test]
    fn player_moves_to_nice_string_matches_extension_method() {
        let moves = vec![PlayerMove::new(0, RoomId(4)), PlayerMove::new(2, RoomId(9))];
        assert_eq!(player_moves_to_nice_string(moves), "1@4 3@9;");
    }

    #[derive(Clone)]
    struct DummyState {
        score: f64,
        turn: Option<PlayerMove>,
    }

    impl AppraisalState<PlayerMove> for DummyState {
        fn heuristic_score(&self, analysis_player_id: i32) -> f64 {
            self.score + analysis_player_id as f64
        }

        fn prev_turn(&self) -> Option<PlayerMove> {
            self.turn
        }
    }

    #[test]
    fn appraised_player_turn_from_state_uses_state_data() {
        let state = DummyState {
            score: 1.5,
            turn: Some(PlayerMove::new(1, RoomId(5))),
        };

        let appraised = AppraisedPlayerTurn::from_state(2, state);

        assert_eq!(appraised.appraisal, 3.5);
        assert_eq!(appraised.turn, Some(PlayerMove::new(1, RoomId(5))));
        let ending_state = appraised
            .ending_state
            .expect("ending state should be present");
        assert_eq!(ending_state.score, 1.5);
    }

    #[test]
    fn empty_minimum_and_maximum_mimic_static_defaults() {
        let empty_min: AppraisedPlayerTurn<PlayerMove, DummyState> =
            AppraisedPlayerTurn::empty_minimum();
        assert_eq!(empty_min.appraisal, f64::NEG_INFINITY);
        assert!(empty_min.turn.is_none());
        assert!(empty_min.ending_state.is_none());

        let empty_max: AppraisedPlayerTurn<PlayerMove, DummyState> =
            AppraisedPlayerTurn::empty_maximum();
        assert_eq!(empty_max.appraisal, f64::INFINITY);
        assert!(empty_max.turn.is_none());
        assert!(empty_max.ending_state.is_none());
    }
}

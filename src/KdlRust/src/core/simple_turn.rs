use crate::core::{
    player::{PlayerId, PlayerMove, player_moves_to_nice_string},
    room::RoomId,
};
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "PascalCase")]
#[readonly::make]
pub struct SimpleTurn {
    pub moves: Vec<PlayerMove>,
}

impl SimpleTurn {
    pub fn new(moves: impl IntoIterator<Item = PlayerMove>) -> Self {
        Self {
            moves: moves.into_iter().collect(),
        }
    }

    pub fn single(player_id: PlayerId, dest_room_id: RoomId) -> Self {
        Self::new([PlayerMove::new(player_id, dest_room_id)])
    }

    pub fn from_move(player_move: PlayerMove) -> Self {
        Self::new([player_move])
    }

    pub fn invalid_default() -> Self {
        Self::new([PlayerMove::new(PlayerId::INVALID, RoomId(0))])
    }
}

impl Default for SimpleTurn {
    fn default() -> Self {
        Self::invalid_default()
    }
}

impl From<SimpleTurn> for Vec<PlayerMove> {
    fn from(simple_turn: SimpleTurn) -> Self {
        simple_turn.moves
    }
}

impl fmt::Display for SimpleTurn {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}",
            player_moves_to_nice_string(self.moves.iter().copied())
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_turn_uses_invalid_player() {
        let default_turn = SimpleTurn::default();
        assert_eq!(
            default_turn.moves,
            vec![PlayerMove::new(PlayerId::INVALID, RoomId(0))]
        );
    }

    #[test]
    fn single_constructor_creates_one_move() {
        let turn = SimpleTurn::single(PlayerId(2), RoomId(5));
        assert_eq!(turn.moves, vec![PlayerMove::new(PlayerId(2), RoomId(5))]);
    }

    #[test]
    fn from_move_wraps_move() {
        let mv = PlayerMove::new(PlayerId(1), RoomId(3));
        let turn = SimpleTurn::from_move(mv);
        assert_eq!(turn.moves, vec![mv]);
    }

    #[test]
    fn display_matches_csharp_format() {
        let turn = SimpleTurn::new([
            PlayerMove::new(PlayerId(0), RoomId(2)),
            PlayerMove::new(PlayerId(1), RoomId(7)),
        ]);
        assert_eq!(turn.to_string(), "1@2 2@7;");
    }

    #[test]
    fn into_vec_matches_implicit_conversion() {
        let turn = SimpleTurn::new([
            PlayerMove::new(PlayerId(0), RoomId(4)),
            PlayerMove::new(PlayerId(3), RoomId(8)),
        ]);
        let moves: Vec<PlayerMove> = turn.into();
        assert_eq!(
            moves,
            vec![
                PlayerMove::new(PlayerId(0), RoomId(4)),
                PlayerMove::new(PlayerId(3), RoomId(8))
            ]
        );
    }
}

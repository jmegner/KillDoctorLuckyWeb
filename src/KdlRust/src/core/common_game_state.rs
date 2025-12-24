use crate::core::{
    board::Board,
    player::{PlayerId, PlayerType},
    rule_helper,
};
use std::hash::{Hash, Hasher};

#[derive(Clone, Debug)]
#[readonly::make]
pub struct CommonGameState {
    pub is_log_enabled: bool,
    pub board: Board,
    pub num_normal_players: usize,
    pub num_all_players: usize,
}

impl CommonGameState {
    pub fn new(
        is_log_enabled: bool,
        board: Board,
        num_normal_players: usize,
        num_all_players: usize,
    ) -> Self {
        Self {
            is_log_enabled,
            board,
            num_normal_players,
            num_all_players,
        }
    }

    pub fn from_num_normal_players(
        is_log_enabled: bool,
        board: Board,
        num_normal_players: usize,
    ) -> Self {
        let num_all_players = rule_helper::num_all_players(num_normal_players);
        Self::new(is_log_enabled, board, num_normal_players, num_all_players)
    }

    pub fn has_strangers(&self) -> bool {
        self.num_normal_players == rule_helper::NUM_NORMAL_PLAYERS_WHEN_HAVE_STRANGERS
    }

    pub fn get_player_type(&self, player_id: PlayerId) -> PlayerType {
        if self.has_strangers() && player_id.0 % 2 == 1 {
            PlayerType::Stranger
        } else {
            PlayerType::Normal
        }
    }

    pub fn to_player_id(player_display_num: usize) -> PlayerId {
        PlayerId(player_display_num - 1)
    }

    pub fn to_player_display_num(player_id: PlayerId) -> usize {
        player_id.0 + 1
    }

    pub fn player_text(&self, player_id: PlayerId) -> String {
        let prefix = if self.get_player_type(player_id) == PlayerType::Normal {
            "P"
        } else {
            "p"
        };

        format!("{prefix}{}", Self::to_player_display_num(player_id))
    }

    pub fn player_ids(&self) -> impl Iterator<Item = PlayerId> {
        (0..self.num_all_players).map(PlayerId)
    }

    pub fn to_normal_player_id(&self, player_id: PlayerId) -> PlayerId {
        rule_helper::to_normal_player_id(player_id, self.num_normal_players)
    }
}

impl PartialEq for CommonGameState {
    fn eq(&self, other: &Self) -> bool {
        self.board.name == other.board.name
            && self.num_normal_players == other.num_normal_players
            && self.num_all_players == other.num_all_players
    }
}

impl Eq for CommonGameState {}

impl Hash for CommonGameState {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.board.name.hash(state);
        self.num_normal_players.hash(state);
        self.num_all_players.hash(state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::room::{Room, RoomId};

    fn sample_board() -> Board {
        let rooms = vec![
            Room::new(RoomId(1), "A", [RoomId(2)], [RoomId(2)]),
            Room::new(RoomId(2), "B", [RoomId(1)], [RoomId(1)]),
        ];

        Board::new(
            "tiny",
            rooms,
            RoomId(1),
            RoomId(1),
            RoomId(1),
            RoomId(1),
            None,
        )
    }

    #[test]
    fn constructors_match_csharp_overloads() {
        let board = sample_board();
        let from_all_players = CommonGameState::new(true, board.clone(), 2, 4);
        let from_normal_players = CommonGameState::from_num_normal_players(true, board, 2);
        assert_eq!(from_all_players, from_normal_players);
    }

    #[test]
    fn has_strangers_and_player_type_match_rules() {
        let game_state = CommonGameState::from_num_normal_players(true, sample_board(), 2);
        assert!(game_state.has_strangers());
        assert_eq!(game_state.get_player_type(PlayerId(0)), PlayerType::Normal);
        assert_eq!(
            game_state.get_player_type(PlayerId(1)),
            PlayerType::Stranger
        );

        let no_strangers_state = CommonGameState::new(true, sample_board(), 3, 3);
        assert!(!no_strangers_state.has_strangers());
        assert_eq!(
            no_strangers_state.get_player_type(PlayerId(1)),
            PlayerType::Normal
        );
    }

    #[test]
    fn player_text_matches_expected_formatting() {
        let game_state = CommonGameState::from_num_normal_players(true, sample_board(), 2);
        assert_eq!(game_state.player_text(PlayerId(0)), "P1");
        assert_eq!(game_state.player_text(PlayerId(1)), "p2");
    }

    #[test]
    fn player_ids_iterate_over_all_players() {
        let game_state = CommonGameState::from_num_normal_players(true, sample_board(), 2);
        let ids = game_state.player_ids().collect::<Vec<_>>();
        assert_eq!(
            ids,
            vec![PlayerId(0), PlayerId(1), PlayerId(2), PlayerId(3)]
        );
    }

    #[test]
    fn equality_ignores_log_flag_but_considers_counts() {
        let board = sample_board();
        let a = CommonGameState::from_num_normal_players(true, board.clone(), 2);
        let b = CommonGameState::from_num_normal_players(false, board.clone(), 2);
        let c = CommonGameState::new(true, board, 3, 3);

        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn to_normal_player_id_maps_strangers_to_normal_player_ids() {
        let game_state = CommonGameState::from_num_normal_players(true, sample_board(), 2);
        assert_eq!(game_state.to_normal_player_id(PlayerId(1)), PlayerId(2));
        assert_eq!(game_state.to_normal_player_id(PlayerId(3)), PlayerId(0));

        let no_strangers_state = CommonGameState::new(true, sample_board(), 3, 3);
        assert_eq!(
            no_strangers_state.to_normal_player_id(PlayerId(1)),
            PlayerId(1)
        );
    }
}

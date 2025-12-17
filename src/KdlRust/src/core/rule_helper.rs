use crate::core::player::PlayerId;

pub mod simple {
    pub const JUST_OVER_ONE_THIRD: f64 = 11.0 / 32.0;

    pub const PLAYER_STARTING_MOVE_CARDS: f64 = 2.0;
    pub const MOVE_CARDS_PER_LOOT: f64 = JUST_OVER_ONE_THIRD;
    pub const CLOVERS_PER_MOVE_CARD: f64 = 1.0;

    pub const PLAYER_STARTING_WEAPONS: f64 = 2.0;
    pub const WEAPONS_PER_LOOT: f64 = JUST_OVER_ONE_THIRD;
    pub const STRENGTH_PER_WEAPON: f64 = 53.0 / 24.0;
    pub const CLOVERS_PER_WEAPON: f64 = 1.0;

    pub const PLAYER_STARTING_FAILURES: f64 = 4.0;
    pub const FAILURES_PER_LOOT: f64 = JUST_OVER_ONE_THIRD;
    pub const CLOVERS_PER_FAILURE: f64 = 50.0 / 24.0;

    pub const CLOVERS_CONTRIBUTED_PER_STRANGER: f64 = 1.0;

    pub const STRANGERS_ARE_NOSY: bool = false;
}

pub const PLAYER_STARTING_STRENGTH: i32 = 1;
pub const NORMAL_PLAYER_NUM_STARTING_CARDS: i32 = 6;
pub const NUM_NORMAL_PLAYERS_WHEN_HAVE_STRANGERS: i32 = 2;
pub const NUM_ALL_PLAYERS_WHEN_HAVE_STRANGERS: i32 = 4;

pub const INVALID_PLAYER_ID: PlayerId = PlayerId(-1);

pub const NORMAL_PLAYER_ID_FIRST: PlayerId = PlayerId(0);
pub const STRANGER_PLAYER_ID_FIRST: PlayerId = PlayerId(1);
pub const NORMAL_PLAYER_ID_SECOND: PlayerId = PlayerId(2);
pub const STRANGER_PLAYER_ID_SECOND: PlayerId = PlayerId(3);

pub const SIDE_A_NORMAL_PLAYER_ID: PlayerId = PlayerId(0);
pub const SIDE_B_STRANGER_PLAYER_ID: PlayerId = PlayerId(1);
pub const SIDE_B_NORMAL_PLAYER_ID: PlayerId = PlayerId(2);
pub const SIDE_A_STRANGER_PLAYER_ID: PlayerId = PlayerId(3);

pub const HEURISTIC_SCORE_WIN: f64 = f64::MAX;
pub const HEURISTIC_SCORE_LOSS: f64 = f64::MIN;

pub fn num_all_players(num_normal_players: i32) -> i32 {
    if num_normal_players == NUM_NORMAL_PLAYERS_WHEN_HAVE_STRANGERS {
        NUM_ALL_PLAYERS_WHEN_HAVE_STRANGERS
    } else {
        num_normal_players
    }
}

pub fn to_normal_player_id(player_id: PlayerId, num_normal_players: i32) -> PlayerId {
    if num_normal_players != NUM_NORMAL_PLAYERS_WHEN_HAVE_STRANGERS {
        return player_id;
    }

    if player_id == SIDE_A_NORMAL_PLAYER_ID || player_id == SIDE_A_STRANGER_PLAYER_ID {
        SIDE_A_NORMAL_PLAYER_ID
    } else {
        SIDE_B_NORMAL_PLAYER_ID
    }
}

pub fn allied_stranger(player_id: PlayerId) -> PlayerId {
    match player_id {
        SIDE_A_NORMAL_PLAYER_ID | SIDE_A_STRANGER_PLAYER_ID => SIDE_A_STRANGER_PLAYER_ID,
        SIDE_B_NORMAL_PLAYER_ID | SIDE_B_STRANGER_PLAYER_ID => SIDE_B_STRANGER_PLAYER_ID,
        _ => INVALID_PLAYER_ID,
    }
}

pub fn opposing_normal_player(player_id: PlayerId) -> PlayerId {
    if player_id == SIDE_A_NORMAL_PLAYER_ID || player_id == SIDE_A_STRANGER_PLAYER_ID {
        SIDE_B_NORMAL_PLAYER_ID
    } else {
        SIDE_A_NORMAL_PLAYER_ID
    }
}

pub fn opposing_stranger(player_id: PlayerId) -> PlayerId {
    allied_stranger(opposing_normal_player(player_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn num_all_players_adds_strangers_when_needed() {
        assert_eq!(num_all_players(2), 4);
        assert_eq!(num_all_players(3), 3);
    }

    #[test]
    fn to_normal_player_id_maps_strangers_to_allies() {
        assert_eq!(
            to_normal_player_id(STRANGER_PLAYER_ID_FIRST, NUM_NORMAL_PLAYERS_WHEN_HAVE_STRANGERS),
            SIDE_B_NORMAL_PLAYER_ID
        );
        assert_eq!(
            to_normal_player_id(STRANGER_PLAYER_ID_SECOND, NUM_NORMAL_PLAYERS_WHEN_HAVE_STRANGERS),
            SIDE_A_NORMAL_PLAYER_ID
        );
        assert_eq!(
            to_normal_player_id(STRANGER_PLAYER_ID_FIRST, 3),
            STRANGER_PLAYER_ID_FIRST
        );
    }

    #[test]
    fn allied_and_opposing_player_helpers_match_switch_logic() {
        assert_eq!(allied_stranger(SIDE_A_NORMAL_PLAYER_ID), SIDE_A_STRANGER_PLAYER_ID);
        assert_eq!(allied_stranger(SIDE_B_NORMAL_PLAYER_ID), SIDE_B_STRANGER_PLAYER_ID);
        assert_eq!(
            opposing_normal_player(SIDE_A_NORMAL_PLAYER_ID),
            SIDE_B_NORMAL_PLAYER_ID
        );
        assert_eq!(
            opposing_normal_player(SIDE_B_STRANGER_PLAYER_ID),
            SIDE_A_NORMAL_PLAYER_ID
        );
        assert_eq!(
            opposing_stranger(SIDE_B_NORMAL_PLAYER_ID),
            SIDE_A_STRANGER_PLAYER_ID
        );
    }
}

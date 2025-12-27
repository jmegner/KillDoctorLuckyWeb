use crate::core::player::{AppraisalState, PlayerId};

pub trait GameState<TTurn>: AppraisalState<TTurn> + Clone {
    fn current_player_id(&self) -> PlayerId;
    fn num_players(&self) -> usize;
    fn has_winner(&self) -> bool;
    fn winner(&self) -> PlayerId;
    fn possible_turns(&self) -> Vec<TTurn>;
    fn after_turn(&self, turn: TTurn, must_return_new_object: bool) -> Self;
}

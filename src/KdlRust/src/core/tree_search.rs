use crate::core::mutable_game_state::MutableGameState;
use crate::core::player::{AppraisalState, AppraisedPlayerTurn, PlayerId};
use crate::core::rule_helper;
use crate::core::simple_turn::SimpleTurn;
use crate::util::cancellation::CancellationToken;
use std::cmp::Ordering;
use std::marker::PhantomData;

pub trait GameState<TTurn>: AppraisalState<TTurn> + Clone {
    fn current_player_id(&self) -> PlayerId;
    fn num_players(&self) -> usize;
    fn has_winner(&self) -> bool;
    fn winner(&self) -> PlayerId;
    fn possible_turns(&self) -> Vec<TTurn>;
    fn after_turn(&self, turn: TTurn, must_return_new_object: bool) -> Self;
}

pub struct TreeSearch<TTurn, TGameState> {
    _phantom: PhantomData<(TTurn, TGameState)>,
}

impl<TTurn, TGameState> TreeSearch<TTurn, TGameState>
where
    TGameState: GameState<TTurn>,
{
    pub const ALPHA_INITIAL: f64 = rule_helper::HEURISTIC_SCORE_LOSS;
    pub const BETA_INITIAL: f64 = rule_helper::HEURISTIC_SCORE_WIN;

    pub fn find_best_turn(
        state: &TGameState,
        analysis_level: i32,
        cancellation_token: &impl CancellationToken,
        num_states_visited: &mut usize,
    ) -> AppraisedPlayerTurn<TTurn, TGameState> {
        *num_states_visited = 0;

        if state.num_players() == 2 {
            Self::find_best_turn_two_players(
                state.clone(),
                analysis_level,
                cancellation_token,
                num_states_visited,
                Self::ALPHA_INITIAL,
                Self::BETA_INITIAL,
            )
        } else {
            Self::find_best_turn_many_players(
                state.clone(),
                state.current_player_id(),
                analysis_level,
                cancellation_token,
                num_states_visited,
            )
        }
    }

    fn find_best_turn_many_players(
        curr_state: TGameState,
        analysis_player_id: PlayerId,
        analysis_level: i32,
        cancellation_token: &impl CancellationToken,
        num_states_visited: &mut usize,
    ) -> AppraisedPlayerTurn<TTurn, TGameState> {
        *num_states_visited += 1;

        if curr_state.has_winner() || analysis_level == 0 {
            return AppraisedPlayerTurn::from_state(analysis_player_id, curr_state);
        }

        let curr_player_id = curr_state.current_player_id();
        let mut best_turn = AppraisedPlayerTurn::empty_minimum();
        let child_states = curr_state
            .possible_turns()
            .into_iter()
            .map(|turn| curr_state.after_turn(turn, true))
            .collect::<Vec<_>>();

        for child_state in child_states {
            let child_player_id = child_state.current_player_id();
            let child_turn = child_state.prev_turn();
            let mut hypo_appraised_turn = Self::find_best_turn_many_players(
                child_state,
                curr_player_id,
                analysis_level - 1,
                cancellation_token,
                num_states_visited,
            );

            if curr_player_id != child_player_id {
                if let Some(ending_state) = hypo_appraised_turn.ending_state.as_ref() {
                    hypo_appraised_turn.appraisal = ending_state.heuristic_score(curr_player_id);
                }
            }

            if best_turn.appraisal < hypo_appraised_turn.appraisal {
                best_turn = hypo_appraised_turn;
                best_turn.turn = child_turn;

                if let Some(ending_state) = best_turn.ending_state.as_ref() {
                    if ending_state.winner() == analysis_player_id {
                        break;
                    }
                }
            }

            if cancellation_token.is_cancellation_requested() {
                return best_turn;
            }
        }

        best_turn
    }

    fn find_best_turn_two_players(
        curr_state: TGameState,
        analysis_level: i32,
        cancellation_token: &impl CancellationToken,
        num_states_visited: &mut usize,
        alpha: f64,
        beta: f64,
    ) -> AppraisedPlayerTurn<TTurn, TGameState> {
        *num_states_visited += 1;

        if curr_state.has_winner() || analysis_level == 0 {
            return AppraisedPlayerTurn::from_state(curr_state.current_player_id(), curr_state);
        }

        let curr_player_id = curr_state.current_player_id();
        let mut child_states = curr_state
            .possible_turns()
            .into_iter()
            .map(|turn| curr_state.after_turn(turn, true))
            .collect::<Vec<_>>();

        if analysis_level > 1 {
            child_states.sort_by(|a, b| {
                compare_scores(
                    a.heuristic_score(curr_player_id),
                    b.heuristic_score(curr_player_id),
                    false,
                )
            });
        }

        let mut best_turn = AppraisedPlayerTurn::empty_minimum();
        let mut alpha = alpha;
        let beta = beta;

        for child_state in child_states {
            let child_player_id = child_state.current_player_id();
            let child_turn = child_state.prev_turn();
            let child_is_us = curr_player_id == child_player_id;
            let child_alpha = if child_is_us { alpha } else { -beta };
            let child_beta = if child_is_us { beta } else { -alpha };
            let mut hypo_turn = Self::find_best_turn_two_players(
                child_state,
                analysis_level - 1,
                cancellation_token,
                num_states_visited,
                child_alpha,
                child_beta,
            );

            if !child_is_us {
                hypo_turn.appraisal *= -1.0;
            }

            if best_turn.appraisal < hypo_turn.appraisal {
                best_turn = hypo_turn;
                best_turn.turn = child_turn;

                if best_turn.appraisal > alpha {
                    alpha = best_turn.appraisal;

                    if alpha >= beta {
                        break;
                    }
                }
            }

            if cancellation_token.is_cancellation_requested() {
                break;
            }
        }

        best_turn
    }
}

fn compare_scores(a: f64, b: f64, sort_ascending: bool) -> Ordering {
    if sort_ascending {
        compare_f64(a, b)
    } else {
        compare_f64(b, a)
    }
}

fn compare_f64(a: f64, b: f64) -> Ordering {
    a.partial_cmp(&b).unwrap_or(Ordering::Equal)
}

impl AppraisalState<SimpleTurn> for MutableGameState {
    fn heuristic_score(&self, analysis_player_id: PlayerId) -> f64 {
        MutableGameState::heuristic_score(self, analysis_player_id)
    }

    fn prev_turn(&self) -> Option<SimpleTurn> {
        Some(self.prev_turn.clone())
    }
}

impl GameState<SimpleTurn> for MutableGameState {
    fn current_player_id(&self) -> PlayerId {
        self.current_player_id
    }

    fn num_players(&self) -> usize {
        MutableGameState::num_players(self)
    }

    fn has_winner(&self) -> bool {
        MutableGameState::has_winner(self)
    }

    fn winner(&self) -> PlayerId {
        self.winner
    }

    fn possible_turns(&self) -> Vec<SimpleTurn> {
        MutableGameState::possible_turns(self)
    }

    fn after_turn(&self, turn: SimpleTurn, must_return_new_object: bool) -> Self {
        let mut new_state = self.clone();
        let _ = must_return_new_object;
        new_state.after_normal_turn(turn, false);
        new_state
    }
}

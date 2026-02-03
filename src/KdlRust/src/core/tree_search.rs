use crate::core::game_state::GameState;
use crate::core::player::{AppraisedPlayerTurn, PlayerId};
use crate::core::rule_helper;
use crate::util::cancellation::CancellationToken;
use std::cmp::Ordering;
use std::marker::PhantomData;

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
        let possible_turns = curr_state.possible_turns();

        for turn in possible_turns {
            if cancellation_token.is_cancellation_requested() {
                return best_turn;
            }
            let child_state = curr_state.after_turn(turn, true);
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
        let possible_turns = curr_state.possible_turns();

        let mut best_turn = AppraisedPlayerTurn::empty_minimum();
        let mut alpha = alpha;
        let beta = beta;

        if analysis_level > 1 {
            let mut scored_states = possible_turns
                .into_iter()
                .map(|turn| {
                    let child_state = curr_state.after_turn(turn, true);
                    let score = child_state.heuristic_score(curr_player_id);
                    (score, child_state)
                })
                .collect::<Vec<_>>();
            scored_states.sort_by(|(score_a, _), (score_b, _)| {
                compare_scores(*score_a, *score_b, false)
            });
            for (_, child_state) in scored_states {
                if cancellation_token.is_cancellation_requested() {
                    break;
                }
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
            }
        } else {
            for turn in possible_turns {
                if cancellation_token.is_cancellation_requested() {
                    break;
                }
                let child_state = curr_state.after_turn(turn, true);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{board::Board, common_game_state::CommonGameState, mutable_game_state::MutableGameState};
    use crate::util::cancellation::NeverCancelToken;
    use std::time::Instant;

    #[test]
    fn tree_search_snapshot_start_state_level2() {
        let board =
            Board::from_embedded_json("BoardAltDown").expect("BoardAltDown should be available");
        let common = CommonGameState::from_num_normal_players(true, board, 2);
        let state = MutableGameState::at_start(common);
        let token = NeverCancelToken;
        let analysis_level = 2;
        let mut num_states_visited = 0usize;
        let started = Instant::now();
        let appraised_turn =
            TreeSearch::find_best_turn(&state, analysis_level, &token, &mut num_states_visited);
        let elapsed = started.elapsed();
        let best_turn_text = appraised_turn
            .turn
            .as_ref()
            .map(|turn| turn.to_string())
            .unwrap_or_default();

        eprintln!(
            "tree_search_snapshot level={} bestTurn={} appraisal={:+0.6} states={} timeSec={:.4}",
            analysis_level,
            best_turn_text,
            appraised_turn.appraisal,
            num_states_visited,
            elapsed.as_secs_f64()
        );
        assert_eq!(best_turn_text, "1@13;");
        assert_eq!(num_states_visited, 2167);
        let expected_appraisal = 0.647815;
        let diff = (appraised_turn.appraisal - expected_appraisal).abs();
        assert!(
            diff < 1e-6,
            "expected appraisal {expected_appraisal}, got {}",
            appraised_turn.appraisal
        );
    }
}


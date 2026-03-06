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
                state,
                analysis_level,
                cancellation_token,
                num_states_visited,
                Self::ALPHA_INITIAL,
                Self::BETA_INITIAL,
            )
        } else {
            Self::find_best_turn_many_players(
                state,
                state.current_player_id(),
                analysis_level,
                cancellation_token,
                num_states_visited,
            )
        }
    }

    fn find_best_turn_many_players(
        curr_state: &TGameState,
        analysis_player_id: PlayerId,
        analysis_level: i32,
        cancellation_token: &impl CancellationToken,
        num_states_visited: &mut usize,
    ) -> AppraisedPlayerTurn<TTurn, TGameState> {
        *num_states_visited += 1;

        if curr_state.has_winner() || analysis_level == 0 {
            return AppraisedPlayerTurn::from_state(analysis_player_id, curr_state.clone());
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
                &child_state,
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
        curr_state: &TGameState,
        analysis_level: i32,
        cancellation_token: &impl CancellationToken,
        num_states_visited: &mut usize,
        alpha: f64,
        beta: f64,
    ) -> AppraisedPlayerTurn<TTurn, TGameState> {
        *num_states_visited += 1;

        if curr_state.has_winner() || analysis_level == 0 {
            return AppraisedPlayerTurn::from_state(
                curr_state.current_player_id(),
                curr_state.clone(),
            );
        }

        let curr_player_id = curr_state.current_player_id();
        let possible_turns = curr_state.possible_turns();

        let mut best_turn = AppraisedPlayerTurn::empty_minimum();
        let mut alpha = alpha;
        let beta = beta;

        if analysis_level > 1 {
            let mut scored_states = Vec::with_capacity(possible_turns.len());
            for turn in possible_turns {
                let child_state = curr_state.after_turn(turn, true);
                let score = child_state.heuristic_score(curr_player_id);
                scored_states.push((score, child_state));
            }
            scored_states
                .sort_by(|(score_a, _), (score_b, _)| compare_scores(*score_a, *score_b, false));
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
                    &child_state,
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
                    &child_state,
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

    pub fn find_full_control_cycles(
        begin_state: &TGameState,
        cancellation_token: &impl CancellationToken,
    ) -> Vec<AppraisedPlayerTurn<TTurn, TGameState>>
    where
        TTurn: Clone,
    {
        let mut cycles = Vec::new();
        if begin_state.has_winner() {
            return cycles;
        }

        Self::add_full_control_cycles(begin_state, cancellation_token, &mut cycles);
        cycles
    }

    pub fn add_full_control_cycles(
        begin_state: &TGameState,
        cancellation_token: &impl CancellationToken,
        cycles: &mut Vec<AppraisedPlayerTurn<TTurn, TGameState>>,
    ) where
        TTurn: Clone,
    {
        let begin_player_id = begin_state.current_player_id();
        let begin_doctor_room_id = begin_state.doctor_room_id();

        for turn in begin_state.possible_turns() {
            if cancellation_token.is_cancellation_requested() {
                break;
            }

            let child_state = begin_state.after_turn(turn.clone(), true);
            if child_state.current_player_id() != begin_player_id {
                continue;
            }

            if child_state.doctor_room_id() == begin_doctor_room_id
                || child_state.winner() == begin_player_id
            {
                cycles.push(AppraisedPlayerTurn::new(
                    child_state.heuristic_score(begin_player_id),
                    turn,
                    child_state,
                ));
                continue;
            }

            Self::add_full_control_cycles(&child_state, cancellation_token, cycles);
        }
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
    use crate::core::player::AppraisalState;
    use crate::core::{
        board::Board, common_game_state::CommonGameState, game_state::GameState,
        mutable_game_state::MutableGameState, room::RoomId,
    };
    use crate::util::cancellation::{AtomicCancellationToken, CancellationToken, NeverCancelToken};

    fn alt_down_two_player_start() -> MutableGameState {
        let board =
            Board::from_embedded_json("BoardAltDown").expect("BoardAltDown should be available");
        let common = CommonGameState::from_num_normal_players(true, board, 2);
        MutableGameState::at_start(common)
    }

    fn tiny_three_player_start() -> MutableGameState {
        let board = Board::from_embedded_json("Tiny").expect("Tiny should be available");
        let common = CommonGameState::from_num_normal_players(true, board, 3);
        MutableGameState::at_start(common)
    }

    #[derive(Clone)]
    struct DummyCycleState {
        node_id: usize,
        prev_turn: Option<&'static str>,
    }

    impl DummyCycleState {
        fn begin() -> Self {
            Self {
                node_id: 0,
                prev_turn: None,
            }
        }

        fn current_player_for(node_id: usize) -> PlayerId {
            match node_id {
                0 | 1 | 3 | 4 | 5 | 7 => PlayerId(0),
                2 | 6 => PlayerId(1),
                _ => panic!("unexpected node id {node_id}"),
            }
        }

        fn doctor_room_for(node_id: usize) -> RoomId {
            match node_id {
                0 | 3 | 4 | 6 | 7 => RoomId(1),
                1 | 2 => RoomId(2),
                5 => RoomId(3),
                _ => panic!("unexpected node id {node_id}"),
            }
        }

        fn turns_for(node_id: usize) -> Vec<&'static str> {
            match node_id {
                0 => vec!["A", "B", "C"],
                1 => vec!["D", "E"],
                5 => vec!["F", "G"],
                _ => Vec::new(),
            }
        }

        fn next_node(node_id: usize, turn: &str) -> usize {
            match (node_id, turn) {
                (0, "A") => 1,
                (0, "B") => 2,
                (0, "C") => 3,
                (1, "D") => 4,
                (1, "E") => 5,
                (5, "F") => 6,
                (5, "G") => 7,
                _ => panic!("unexpected edge {turn} from node {node_id}"),
            }
        }
    }

    impl AppraisalState<&'static str> for DummyCycleState {
        fn heuristic_score(&self, analysis_player_id: PlayerId) -> f64 {
            self.node_id as f64 + analysis_player_id.0 as f64 * 0.01
        }

        fn prev_turn(&self) -> Option<&'static str> {
            self.prev_turn
        }
    }

    impl GameState<&'static str> for DummyCycleState {
        fn current_player_id(&self) -> PlayerId {
            Self::current_player_for(self.node_id)
        }

        fn doctor_room_id(&self) -> RoomId {
            Self::doctor_room_for(self.node_id)
        }

        fn num_players(&self) -> usize {
            2
        }

        fn has_winner(&self) -> bool {
            false
        }

        fn winner(&self) -> PlayerId {
            PlayerId::INVALID
        }

        fn possible_turns(&self) -> Vec<&'static str> {
            Self::turns_for(self.node_id)
        }

        fn after_turn(&self, turn: &'static str, _must_return_new_object: bool) -> Self {
            Self {
                node_id: Self::next_node(self.node_id, turn),
                prev_turn: Some(turn),
            }
        }
    }

    fn run_snapshot_line(
        state: &MutableGameState,
        analysis_level: i32,
        cancellation_token: &impl CancellationToken,
    ) -> String {
        let mut num_states_visited = 0usize;
        let appraised_turn = TreeSearch::find_best_turn(
            state,
            analysis_level,
            cancellation_token,
            &mut num_states_visited,
        );
        let best_turn_text = appraised_turn
            .turn
            .as_ref()
            .map(|turn| turn.to_string())
            .unwrap_or_else(|| "<none>".to_string());
        format!(
            "L{analysis_level}|turn={best_turn_text}|appraisal={:+0.6}|states={num_states_visited}",
            appraised_turn.appraisal
        )
    }

    #[test]
    fn tree_search_snapshot_alt_down_start_levels_0_to_3() {
        let state = alt_down_two_player_start();
        let token = NeverCancelToken;
        let snapshot = (0..=3)
            .map(|analysis_level| run_snapshot_line(&state, analysis_level, &token))
            .collect::<Vec<_>>()
            .join("\n");

        assert_eq!(
            snapshot,
            concat!(
                "L0|turn=1000@0;|appraisal=+1.433623|states=1\n",
                "L1|turn=1@1;|appraisal=-0.953516|states=391\n",
                "L2|turn=1@13;|appraisal=+0.647815|states=2167\n",
                "L3|turn=1@13;|appraisal=-0.104624|states=14933"
            )
        );
    }

    #[test]
    fn tree_search_snapshot_alt_down_after_opening_levels_1_to_3() {
        let mut state = alt_down_two_player_start();
        let opening_turn = state
            .possible_turns()
            .into_iter()
            .find(|turn| turn.to_string() == "1@13;")
            .expect("expected to find opening turn 1@13;");
        state.after_normal_turn(opening_turn, false);

        let token = NeverCancelToken;
        let snapshot = (1..=3)
            .map(|analysis_level| run_snapshot_line(&state, analysis_level, &token))
            .collect::<Vec<_>>()
            .join("\n");

        assert_eq!(
            snapshot,
            concat!(
                "L1|turn=2@14;|appraisal=-0.647815|states=517\n",
                "L2|turn=3@14 2@2;|appraisal=+0.104624|states=6214\n",
                "L3|turn=3@15 2@4;|appraisal=-0.034230|states=10820"
            )
        );
    }

    #[test]
    fn tree_search_snapshot_tiny_three_player_start_levels_0_to_3() {
        let state = tiny_three_player_start();
        let token = NeverCancelToken;
        let snapshot = (0..=3)
            .map(|analysis_level| run_snapshot_line(&state, analysis_level, &token))
            .collect::<Vec<_>>()
            .join("\n");

        assert_eq!(
            snapshot,
            concat!(
                "L0|turn=1000@0;|appraisal=+0.475000|states=1\n",
                "L1|turn=1@2;|appraisal=+0.149219|states=5\n",
                "L2|turn=1@2;|appraisal=+0.149219|states=21\n",
                "L3|turn=1@2;|appraisal=+0.725000|states=85"
            )
        );
    }

    #[cfg(any())]
    #[test]
    fn find_full_control_cycles_returns_only_controlled_cycles() {
        let begin = DummyCycleState::begin();
        let token = NeverCancelToken;
        let begin_player_id = begin.current_player_id();
        let cycles = TreeSearch::find_full_control_cycles(&begin, &token);

        let lines = cycles
            .iter()
            .map(|cycle| {
                let ending_state = cycle
                    .ending_state
                    .as_ref()
                    .expect("expected ending_state on cycle");
                format!(
                    "{}->{}",
                    cycle.turn.expect("expected cycle to keep first turn"),
                    ending_state.node_id
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(lines, vec!["A->4", "A->7", "C->3"]);

        for cycle in &cycles {
            let ending_state = cycle
                .ending_state
                .as_ref()
                .expect("expected ending_state on cycle");
            assert_eq!(ending_state.current_player_id(), begin_player_id);
            assert_eq!(
                ending_state.doctor_room_id(),
                begin.doctor_room_id(),
                "doctor room should complete one full loop"
            );
            assert_eq!(
                cycle.appraisal,
                ending_state.heuristic_score(begin_player_id),
                "appraisal should reflect the ending state for the begin player"
            );
            assert_ne!(
                ending_state.node_id, 6,
                "node 6 changes active player, so that branch must be pruned"
            );
        }
    }

    #[test]
    fn find_full_control_cycles_honors_cancellation() {
        let begin = DummyCycleState::begin();
        let token = AtomicCancellationToken::new();
        token.cancel();

        let cycles = TreeSearch::find_full_control_cycles(&begin, &token);
        assert!(cycles.is_empty());
    }

    #[test]
    fn tree_search_cancelled_token_returns_empty_minimum() {
        let state = alt_down_two_player_start();
        let token = AtomicCancellationToken::new();
        token.cancel();

        let mut num_states_visited = 123usize;
        let appraised_turn = TreeSearch::find_best_turn(&state, 4, &token, &mut num_states_visited);

        assert!(appraised_turn.turn.is_none());
        assert_eq!(appraised_turn.appraisal, f64::NEG_INFINITY);
        assert_eq!(num_states_visited, 1);
    }
}

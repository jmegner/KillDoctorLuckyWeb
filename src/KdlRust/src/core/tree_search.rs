use crate::core::mutable_game_state::MutableGameState;
use crate::core::player::{AppraisalState, AppraisedPlayerTurn, PlayerId};
use crate::core::rule_helper;
use crate::core::simple_turn::SimpleTurn;
use std::cmp::Ordering;
use std::collections::VecDeque;
use std::fmt;
use std::marker::PhantomData;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::time::{SystemTime, UNIX_EPOCH};

pub trait CancellationToken {
    fn is_cancellation_requested(&self) -> bool;
}

pub struct NeverCancelToken;

impl CancellationToken for NeverCancelToken {
    fn is_cancellation_requested(&self) -> bool {
        false
    }
}

pub struct AtomicCancellationToken {
    cancelled: AtomicBool,
}

impl AtomicCancellationToken {
    pub fn new() -> Self {
        Self {
            cancelled: AtomicBool::new(false),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, AtomicOrdering::SeqCst);
    }
}

impl CancellationToken for AtomicCancellationToken {
    fn is_cancellation_requested(&self) -> bool {
        self.cancelled.load(AtomicOrdering::SeqCst)
    }
}

pub trait GameState<TTurn>: AppraisalState<TTurn> + Clone {
    fn current_player_id(&self) -> PlayerId;
    fn num_players(&self) -> usize;
    fn has_winner(&self) -> bool;
    fn winner(&self) -> PlayerId;
    fn possible_turns(&self) -> Vec<TTurn>;
    fn after_turn(&self, turn: TTurn, must_return_new_object: bool) -> Self;
}

pub struct SpinLockedAlpha {
    alpha: Mutex<f64>,
}

impl SpinLockedAlpha {
    pub fn new(alpha: f64) -> Self {
        Self {
            alpha: Mutex::new(alpha),
        }
    }

    pub fn get_alpha(&self) -> f64 {
        *self
            .alpha
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn update(&self, val: f64) -> f64 {
        let mut alpha = self
            .alpha
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if val > *alpha {
            *alpha = val;
        }
        *alpha
    }
}

impl Default for SpinLockedAlpha {
    fn default() -> Self {
        Self::new(rule_helper::HEURISTIC_SCORE_LOSS)
    }
}

impl fmt::Display for SpinLockedAlpha {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.get_alpha())
    }
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
        parallelization: usize,
    ) -> AppraisedPlayerTurn<TTurn, TGameState> {
        *num_states_visited = 0;

        if state.num_players() == 2 {
            if parallelization == 1 {
                Self::find_best_turn_two_players(
                    state.clone(),
                    analysis_level,
                    cancellation_token,
                    num_states_visited,
                    Self::ALPHA_INITIAL,
                    Self::BETA_INITIAL,
                )
            } else {
                Self::find_best_turn_two_players_parallel_prioritized(
                    state.clone(),
                    analysis_level,
                    cancellation_token,
                )
            }
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

    pub fn find_best_turn_two_players_parallel(
        curr_state: TGameState,
        analysis_level: i32,
        cancellation_token: &impl CancellationToken,
        parallelization: usize,
    ) -> AppraisedPlayerTurn<TTurn, TGameState> {
        let analysis_player_id = curr_state.current_player_id();

        if analysis_level == 0 {
            return appraised_without_turn(
                curr_state.heuristic_score(analysis_player_id),
                curr_state,
            );
        }

        let subroot_states = sorted_next_states(&curr_state, false);
        let parallelization = parallelization.max(1);
        let mut subroots_for_each_task = vec![Vec::new(); parallelization];

        for (idx, subroot_state) in subroot_states.into_iter().enumerate() {
            subroots_for_each_task[idx % parallelization].push(subroot_state);
        }

        let locked_alpha = SpinLockedAlpha::default();
        println!("{} before start tasks", timestamp_text());
        let mut results = Vec::with_capacity(subroots_for_each_task.len());

        for (task_idx, subroots) in subroots_for_each_task.into_iter().enumerate() {
            results.push(Self::find_best_turn_two_players_parallel_subroots(
                task_idx,
                subroots,
                analysis_player_id,
                analysis_level - 1,
                cancellation_token,
                &locked_alpha,
            ));
        }

        println!("{} before WaitAll", timestamp_text());
        println!("{} after WaitAll", timestamp_text());
        let best_turn = results
            .into_iter()
            .max_by(|a, b| compare_f64(a.appraisal, b.appraisal))
            .unwrap_or_else(AppraisedPlayerTurn::empty_minimum);
        println!("{} after tasks.MaxElementBy", timestamp_text());
        best_turn
    }

    fn find_best_turn_two_players_parallel_subroots(
        task_idx: usize,
        subroots: Vec<TGameState>,
        analysis_player_id: PlayerId,
        analysis_level: i32,
        cancellation_token: &impl CancellationToken,
        locked_alpha: &SpinLockedAlpha,
    ) -> AppraisedPlayerTurn<TTurn, TGameState> {
        println!("{} start ParallelSubroots {}", timestamp_text(), task_idx);
        let mut best_turn = AppraisedPlayerTurn::empty_minimum();

        let subroot_count = subroots.len();
        for (subroot_idx, subroot) in subroots.into_iter().enumerate() {
            let subroot_turn = subroot.prev_turn();
            let subroot_best_turn = Self::find_best_turn_two_players_parallel_recursive(
                subroot,
                analysis_player_id,
                analysis_level,
                cancellation_token,
                locked_alpha,
                Self::ALPHA_INITIAL,
                Self::BETA_INITIAL,
            );

            if best_turn.appraisal < subroot_best_turn.appraisal {
                best_turn = subroot_best_turn;
                best_turn.turn = subroot_turn;
                let new_alpha = locked_alpha.update(best_turn.appraisal);

                if new_alpha == best_turn.appraisal {
                    println!(
                        "task {} subroot {}/{} updated alpha to {}",
                        task_idx, subroot_idx, subroot_count, new_alpha
                    );
                }

                if new_alpha >= Self::BETA_INITIAL {
                    break;
                }
            }
        }

        println!("{} end ParallelSubroots {}", timestamp_text(), task_idx);
        best_turn
    }

    fn find_best_turn_two_players_parallel_recursive(
        curr_state: TGameState,
        root_analysis_player_id: PlayerId,
        analysis_level: i32,
        cancellation_token: &impl CancellationToken,
        shared_alpha: &SpinLockedAlpha,
        mut local_alpha: f64,
        mut local_beta: f64,
    ) -> AppraisedPlayerTurn<TTurn, TGameState> {
        if curr_state.has_winner() || analysis_level == 0 {
            return AppraisedPlayerTurn::from_state(root_analysis_player_id, curr_state);
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

        let mut best_turn = if curr_player_id == root_analysis_player_id {
            AppraisedPlayerTurn::empty_minimum()
        } else {
            AppraisedPlayerTurn::empty_maximum()
        };

        for child_state in child_states {
            let child_turn = child_state.prev_turn();
            let hypo_appraised_turn = Self::find_best_turn_two_players_parallel_recursive(
                child_state,
                root_analysis_player_id,
                analysis_level - 1,
                cancellation_token,
                shared_alpha,
                local_alpha,
                local_beta,
            );

            if curr_player_id == root_analysis_player_id {
                if hypo_appraised_turn.appraisal > best_turn.appraisal {
                    best_turn = hypo_appraised_turn;
                    best_turn.turn = child_turn;

                    if best_turn.appraisal > local_alpha {
                        local_alpha = best_turn.appraisal;
                    }

                    if local_alpha >= local_beta || shared_alpha.get_alpha() >= local_beta {
                        break;
                    }
                }
            } else if hypo_appraised_turn.appraisal < best_turn.appraisal {
                best_turn = hypo_appraised_turn;
                best_turn.turn = child_turn;

                if best_turn.appraisal < local_beta {
                    local_beta = best_turn.appraisal;
                }

                if local_alpha >= local_beta || shared_alpha.get_alpha() >= local_beta {
                    break;
                }
            }

            if cancellation_token.is_cancellation_requested() {
                break;
            }
        }

        best_turn
    }

    pub fn find_best_turn_two_players_parallel_prioritized(
        curr_state: TGameState,
        analysis_level: i32,
        cancellation_token: &impl CancellationToken,
    ) -> AppraisedPlayerTurn<TTurn, TGameState> {
        Self::find_best_turn_two_players_parallel_prioritized_bounds(
            curr_state,
            analysis_level,
            cancellation_token,
            Self::ALPHA_INITIAL,
            Self::BETA_INITIAL,
        )
    }

    fn find_best_turn_two_players_parallel_prioritized_bounds(
        curr_state: TGameState,
        analysis_level: i32,
        cancellation_token: &impl CancellationToken,
        alpha: f64,
        beta: f64,
    ) -> AppraisedPlayerTurn<TTurn, TGameState> {
        const ANALYSIS_LEVEL_TO_PARALLELIZE: i32 = 4;

        let child_states = sorted_next_states(&curr_state, false);

        if analysis_level <= ANALYSIS_LEVEL_TO_PARALLELIZE {
            let child_state_queue = VecDeque::from(child_states);
            let shared_alpha = SpinLockedAlpha::new(alpha);

            Self::find_best_turn_two_players_parallel_queue(
                curr_state.current_player_id(),
                child_state_queue,
                analysis_level - 1,
                cancellation_token,
                &shared_alpha,
                beta,
            )
        } else {
            let mut best_turn = AppraisedPlayerTurn::empty_minimum();
            let mut alpha = alpha;

            for child_state in child_states {
                let child_turn = child_state.prev_turn();
                let child_player_id = child_state.current_player_id();
                let child_is_us = curr_state.current_player_id() == child_player_id;
                let child_alpha = if child_is_us { alpha } else { -beta };
                let child_beta = if child_is_us { beta } else { -alpha };
                let mut hypo_turn = Self::find_best_turn_two_players_parallel_prioritized_bounds(
                    child_state,
                    analysis_level - 1,
                    cancellation_token,
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

    fn find_best_turn_two_players_parallel_queue(
        analysis_player_id: PlayerId,
        mut child_state_queue: VecDeque<TGameState>,
        analysis_level: i32,
        cancellation_token: &impl CancellationToken,
        shared_alpha: &SpinLockedAlpha,
        beta: f64,
    ) -> AppraisedPlayerTurn<TTurn, TGameState> {
        let mut best_turn = AppraisedPlayerTurn::empty_minimum();

        while !cancellation_token.is_cancellation_requested() {
            let Some(child_state) = child_state_queue.pop_front() else {
                break;
            };

            let alpha = shared_alpha.get_alpha();
            if alpha >= beta {
                break;
            }

            let child_turn = child_state.prev_turn();
            let hypo_turn = Self::find_best_turn_two_players_parallel_recursive(
                child_state,
                analysis_player_id,
                analysis_level,
                cancellation_token,
                shared_alpha,
                alpha,
                beta,
            );

            if best_turn.appraisal < hypo_turn.appraisal {
                best_turn.appraisal = hypo_turn.appraisal;
                best_turn.ending_state = hypo_turn.ending_state;
                best_turn.turn = child_turn;

                shared_alpha.update(best_turn.appraisal);
            }
        }

        best_turn
    }
}

fn appraised_without_turn<TTurn, TGameState>(
    appraisal: f64,
    ending_state: TGameState,
) -> AppraisedPlayerTurn<TTurn, TGameState> {
    AppraisedPlayerTurn {
        appraisal,
        turn: None,
        ending_state: Some(ending_state),
    }
}

fn sorted_next_states<TTurn, TGameState>(
    game_state: &TGameState,
    sort_ascending: bool,
) -> Vec<TGameState>
where
    TGameState: GameState<TTurn>,
{
    let current_player_id = game_state.current_player_id();
    let mut next_states = game_state
        .possible_turns()
        .into_iter()
        .map(|turn| game_state.after_turn(turn, true))
        .collect::<Vec<_>>();
    next_states.sort_by(|a, b| {
        compare_scores(
            a.heuristic_score(current_player_id),
            b.heuristic_score(current_player_id),
            sort_ascending,
        )
    });
    next_states
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

fn timestamp_text() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let total_seconds = now.as_secs() % 86_400;
    let hours = total_seconds / 3_600;
    let minutes = (total_seconds % 3_600) / 60;
    let seconds = total_seconds % 60;
    format!(
        "{hours:02}:{minutes:02}:{seconds:02}.{:06}",
        now.subsec_micros()
    )
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

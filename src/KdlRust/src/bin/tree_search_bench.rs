use kill_doctor_lucky_rust::core::{
    board::Board,
    common_game_state::CommonGameState,
    mutable_game_state::MutableGameState,
    tree_search::TreeSearch,
};
use kill_doctor_lucky_rust::util::cancellation::NeverCancelToken;
use std::time::Instant;

fn main() {
    let board = Board::from_embedded_json("BoardAltDown")
        .expect("BoardAltDown should be available");
    let common = CommonGameState::from_num_normal_players(true, board, 2);
    let state = MutableGameState::at_start(common);
    let analysis_level = 3;
    let token = NeverCancelToken;
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

    println!(
        "bestTurn={:<10} level={} appraisal={:+0.6} states={} timeSec={:.4}",
        best_turn_text,
        analysis_level,
        appraised_turn.appraisal,
        num_states_visited,
        elapsed.as_secs_f64()
    );
}

use kill_doctor_lucky_rust::core::{
    board::Board, common_game_state::CommonGameState, mutable_game_state::MutableGameState,
    tree_search::TreeSearch,
};
use kill_doctor_lucky_rust::util::cancellation::NeverCancelToken;
use std::env;
use std::hint::black_box;
use std::time::Instant;

#[derive(Clone, Copy)]
enum Scenario {
    AltDownStart,
    AltDownAfterOpening,
}

impl Scenario {
    fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "alt_down_start" => Ok(Self::AltDownStart),
            "alt_down_after_opening" => Ok(Self::AltDownAfterOpening),
            _ => Err(format!("unknown scenario '{raw}'")),
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::AltDownStart => "alt_down_start",
            Self::AltDownAfterOpening => "alt_down_after_opening",
        }
    }
}

struct Config {
    analysis_level: i32,
    min_iterations: usize,
    min_seconds: f64,
    warmup_iterations: usize,
    scenario: Scenario,
}

fn main() {
    let config = parse_args(env::args().skip(1)).unwrap_or_else(|message| {
        eprintln!("{message}");
        std::process::exit(2);
    });
    let state = state_for_scenario(config.scenario);
    let token = NeverCancelToken;

    for _ in 0..config.warmup_iterations {
        let mut warmup_states_visited = 0usize;
        let warmup_turn = TreeSearch::find_best_turn(
            &state,
            config.analysis_level,
            &token,
            &mut warmup_states_visited,
        );
        black_box((warmup_turn, warmup_states_visited));
    }

    let started = Instant::now();
    let mut iterations = 0usize;
    let mut total_states_visited = 0usize;
    let mut last_states_visited = 0usize;
    let mut best_turn_text = String::new();
    let mut best_turn_appraisal = 0.0;

    while iterations < config.min_iterations || started.elapsed().as_secs_f64() < config.min_seconds
    {
        let mut num_states_visited = 0usize;
        let appraised_turn = TreeSearch::find_best_turn(
            &state,
            config.analysis_level,
            &token,
            &mut num_states_visited,
        );

        total_states_visited += num_states_visited;
        last_states_visited = num_states_visited;
        best_turn_text = appraised_turn.turn.to_string();
        best_turn_appraisal = appraised_turn.appraisal;
        black_box((&best_turn_text, best_turn_appraisal, num_states_visited));
        iterations += 1;
    }

    let elapsed = started.elapsed();
    let avg_iteration_millis = elapsed.as_secs_f64() * 1000.0 / iterations as f64;
    let avg_states_visited = total_states_visited as f64 / iterations as f64;

    println!(
        concat!(
            "scenario={} bestTurn={:<10} level={} appraisal={:+0.6} ",
            "iterations={} lastStates={} avgStates={:.1} avgIterationMs={:.3} timeSec={:.4}"
        ),
        config.scenario.name(),
        best_turn_text,
        config.analysis_level,
        best_turn_appraisal,
        iterations,
        last_states_visited,
        avg_states_visited,
        avg_iteration_millis,
        elapsed.as_secs_f64()
    );
}

fn parse_args(args: impl IntoIterator<Item = String>) -> Result<Config, String> {
    let mut analysis_level = 3;
    let mut min_iterations = 1usize;
    let mut min_seconds = 0.0;
    let mut warmup_iterations = 0usize;
    let mut scenario = Scenario::AltDownStart;
    let mut pending_flag = None::<String>;

    for arg in args {
        if let Some(flag) = pending_flag.take() {
            match flag.as_str() {
                "--analysis-level" => {
                    analysis_level = arg
                        .parse::<i32>()
                        .map_err(|_| format!("invalid integer for {flag}: {arg}"))?;
                }
                "--min-iterations" => {
                    min_iterations = arg
                        .parse::<usize>()
                        .map_err(|_| format!("invalid integer for {flag}: {arg}"))?;
                }
                "--min-seconds" => {
                    min_seconds = arg
                        .parse::<f64>()
                        .map_err(|_| format!("invalid number for {flag}: {arg}"))?;
                }
                "--warmup-iterations" => {
                    warmup_iterations = arg
                        .parse::<usize>()
                        .map_err(|_| format!("invalid integer for {flag}: {arg}"))?;
                }
                "--scenario" => {
                    scenario = Scenario::parse(&arg)?;
                }
                _ => return Err(format!("unsupported flag {flag}")),
            }
            continue;
        }

        match arg.as_str() {
            "--analysis-level"
            | "--min-iterations"
            | "--min-seconds"
            | "--warmup-iterations"
            | "--scenario" => pending_flag = Some(arg),
            "--help" | "-h" => return Err(help_text().to_owned()),
            _ => return Err(format!("unrecognized argument '{arg}'\n\n{}", help_text())),
        }
    }

    if let Some(flag) = pending_flag {
        return Err(format!("missing value for {flag}\n\n{}", help_text()));
    }

    if analysis_level < 0 {
        return Err("--analysis-level must be >= 0".to_owned());
    }

    if min_iterations == 0 && min_seconds <= 0.0 {
        return Err("either --min-iterations or --min-seconds must require work".to_owned());
    }

    if min_seconds < 0.0 {
        return Err("--min-seconds must be >= 0".to_owned());
    }

    Ok(Config {
        analysis_level,
        min_iterations,
        min_seconds,
        warmup_iterations,
        scenario,
    })
}

fn state_for_scenario(scenario: Scenario) -> MutableGameState {
    let board =
        Board::from_embedded_json("BoardAltDown").expect("BoardAltDown should be available");
    let common = CommonGameState::from_num_normal_players(true, board, 2);
    let mut state = MutableGameState::at_start(common);

    match scenario {
        Scenario::AltDownStart => state,
        Scenario::AltDownAfterOpening => {
            let opening_turn = state
                .possible_turns()
                .into_iter()
                .find(|turn| turn.to_string() == "1@13;")
                .expect("expected to find opening turn 1@13;");
            state.apply_turn(opening_turn);
            state
        }
    }
}

fn help_text() -> &'static str {
    concat!(
        "tree_search_bench options:\n",
        "  --analysis-level <n>      Search depth. Default: 3\n",
        "  --min-iterations <n>      Run at least this many measured iterations. Default: 1\n",
        "  --min-seconds <n>         Run measured iterations until this duration is reached. Default: 0\n",
        "  --warmup-iterations <n>   Run warmup iterations before measurement. Default: 0\n",
        "  --scenario <name>         One of: alt_down_start, alt_down_after_opening\n"
    )
}

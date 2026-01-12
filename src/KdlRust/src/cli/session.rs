use kill_doctor_lucky_rust::core::{
    board::Board,
    common_game_state::CommonGameState,
    mutable_game_state::MutableGameState,
    player::{PlayerId, PlayerMove},
    room::RoomId,
    rule_helper,
    simple_turn::SimpleTurn,
    tree_search::TreeSearch,
};
use kill_doctor_lucky_rust::util::cancellation::NeverCancelToken;
use std::io::{self, Write};
use std::time::Instant;

pub struct Session {
    num_normal_players: usize,
    num_normal_players_old: usize,
    deck_name: String,
    deck_name_old: String,
    board_name: String,
    board_name_old: String,
    closed_wing_names: Vec<String>,
    closed_wing_names_old: Vec<String>,
    game_common: Option<CommonGameState>,
    game: Option<MutableGameState>,
    should_quit: bool,
    analysis_level: f64,
    recent_analyzed_turn: Option<SimpleTurn>,
}

impl Session {
    pub fn new(_cli_args: impl IntoIterator<Item = String>) -> Self {
        Self {
            num_normal_players: 2,
            num_normal_players_old: 0,
            deck_name: "DeckStandard".to_string(),
            deck_name_old: String::new(),
            board_name: "BoardAltDown".to_string(),
            board_name_old: String::new(),
            closed_wing_names: Vec::new(),
            closed_wing_names_old: Vec::new(),
            game_common: None,
            game: None,
            should_quit: false,
            analysis_level: 1.0,
            recent_analyzed_turn: None,
        }
    }

    pub fn start(&mut self) {
        self.fiddle(None);
        self.reset_game();
        self.interpretation_loop();
    }

    fn interpretation_loop(&mut self) {
        let stdin = io::stdin();

        loop {
            let prompt = self.user_prompt_text();
            print!("{prompt}");
            let _ = io::stdout().flush();

            let mut line = String::new();
            match stdin.read_line(&mut line) {
                Ok(0) => return,
                Ok(_) => {
                    let line = line.trim_end_matches(['\r', '\n']).to_string();
                    let sublines = line.split(';').collect::<Vec<_>>();
                    for subline in sublines {
                        self.interpret_directive(subline);
                        if self.should_quit {
                            return;
                        }
                    }
                }
                Err(_) => return,
            }
        }
    }

    fn without_comments(&self, directive: &str) -> String {
        let mut working = directive.to_string();
        while let Some(start_idx) = working.find('(') {
            if let Some(end_rel) = working[start_idx..].find(')') {
                let end_idx = start_idx + end_rel;
                working.replace_range(start_idx..=end_idx, "");
            } else {
                working.truncate(start_idx);
                break;
            }
        }
        working
    }

    fn interpret_directive(&mut self, directive: &str) {
        const TAG_FIDDLE: &str = "f";
        const TAG_QUIT: &str = "q";
        const TAG_DISPLAY: &str = "d";
        const TAG_RESET: &str = "r";
        const TAG_REPEAT: &str = "x";
        const TAG_HISTORY: &str = "h";
        const TAG_UNDO: &str = "u";
        const TAG_ANALYZE: &str = "a";
        const TAG_ANALYZE_ASCENDING: &str = "aa";
        const TAG_EXECUTE_ANALYSIS: &str = "e";
        const TAG_EXECUTE_PREVIOUS_ANALYSIS: &str = "ep";
        const TAG_BOARD: &str = "b";
        const TAG_BOARD_LONG: &str = "board";
        const TAG_PLAYERS: &str = "p";
        const TAG_PLAYERS_LONG: &str = "numplayers";
        const TAG_CLOSED_WINGS: &str = "w";
        const TAG_CLOSED_WINGS_LONG: &str = "closedwings";
        const TAG_SET_VALUE: &str = "sv";
        const TAG_SET_VALUE_LONG: &str = "setvalue";

        let directive = self.without_comments(directive);
        let tokens = directive
            .split_whitespace()
            .map(|token| token.to_string())
            .collect::<Vec<_>>();
        let directive_tag = tokens
            .get(0)
            .map(|token| token.to_lowercase())
            .unwrap_or_default();

        if directive.trim().is_empty() {
            return;
        }

        if directive_tag == TAG_QUIT {
            self.should_quit = true;
        } else if directive_tag == TAG_FIDDLE {
            self.fiddle(Some(&tokens));
        } else if directive_tag == TAG_DISPLAY {
            self.print_game_settings();
            if let Some(game) = self.game.as_ref() {
                println!("{}", game.summary(1));
            }
        } else if directive_tag == TAG_RESET {
            println!("(RESET)");
            self.reset_game();
        } else if directive_tag == TAG_UNDO {
            println!("(UNDO)");
            loop {
                let prev_state = self
                    .game
                    .as_ref()
                    .and_then(|game| game.prev_state.as_ref())
                    .map(|state| state.as_ref().clone());
                let Some(prev_state) = prev_state else {
                    break;
                };
                self.game = Some(prev_state);
                if self
                    .game
                    .as_ref()
                    .map(|game| game.is_normal_turn())
                    .unwrap_or(true)
                {
                    break;
                }
            }

            if let Some(game) = self.game.as_ref() {
                println!("{}", game.summary(1));
            }
        } else if directive_tag == TAG_REPEAT {
            if tokens.len() > 1 {
                if let Ok(num_repeats) = tokens[1].parse::<usize>() {
                    let directive_to_repeat = tokens.iter().skip(2).cloned().collect::<Vec<_>>();
                    let directive_text = directive_to_repeat.join(" ");
                    println!("(REPEAT {num_repeats}: {directive_text})");
                    for _ in 0..num_repeats {
                        self.interpret_directive(&directive_text);
                    }
                } else {
                    println!("directive {directive_tag} needs repetition count and directive to repeat");
                }
            } else {
                println!("directive {directive_tag} needs repetition count and directive to repeat");
            }
        } else if directive_tag == TAG_HISTORY {
            println!("{TAG_PLAYERS} {};", self.num_normal_players_old);
            println!("{TAG_BOARD} {};", self.board_name_old);
            println!(
                "{TAG_CLOSED_WINGS} {};",
                self.closed_wing_names_old.join(" ")
            );
            print!("{TAG_RESET}; ");

            let _ = tokens.get(1).and_then(|token| token.parse::<bool>().ok());
            if let Some(game) = self.game.as_ref() {
                println!("{}", game.normal_turn_hist());
            }
        } else if directive_tag == TAG_ANALYZE
            || directive_tag == TAG_ANALYZE_ASCENDING
            || directive_tag == TAG_EXECUTE_ANALYSIS
        {
            if let Some(token) = tokens.get(1) {
                if let Ok(level) = token.parse::<f64>() {
                    self.analysis_level = level;
                }
            }

            let do_suggested_move = directive_tag == TAG_EXECUTE_ANALYSIS;

            let start_level = if directive_tag == TAG_ANALYZE_ASCENDING {
                1
            } else {
                self.analysis_level as i32
            };

            let mut level = start_level;
            while (level as f64) <= self.analysis_level {
                self.analyze(do_suggested_move, level, 1);
                level += 1;
            }
        } else if directive_tag == "m" {
            println!("mcts analysis is not supported");
        } else if directive_tag == TAG_EXECUTE_PREVIOUS_ANALYSIS {
            if let Some(turn) = self.recent_analyzed_turn.clone() {
                self.do_moves_turn(turn);
            } else {
                println!("no recent analyzed move");
            }
        } else if directive_tag == TAG_BOARD || directive_tag == TAG_BOARD_LONG {
            if tokens.len() != 2 {
                println!("  board directive needs two tokens");
            } else {
                self.board_name = tokens[1].clone();
                if !self.board_name.to_lowercase().contains("board") {
                    self.board_name = format!("Board{}", self.board_name);
                }
            }

            self.print_game_settings();
        } else if directive_tag == TAG_CLOSED_WINGS || directive_tag == TAG_CLOSED_WINGS_LONG {
            self.closed_wing_names = tokens.iter().skip(1).cloned().collect::<Vec<_>>();
            self.print_game_settings();
        } else if directive_tag == TAG_PLAYERS || directive_tag == TAG_PLAYERS_LONG {
            if tokens.len() != 2 {
                println!("  {TAG_PLAYERS_LONG} directive needs one integer token");
            } else if let Ok(new_val) = tokens[1].parse::<usize>() {
                self.num_normal_players = new_val;
            } else {
                println!("  {TAG_PLAYERS_LONG} directive needs one integer token");
            }

            self.print_game_settings();
        } else if directive_tag == TAG_SET_VALUE || directive_tag == TAG_SET_VALUE_LONG {
            self.handle_set_value(&tokens);
        } else if directive_tag
            .chars()
            .next()
            .map(|ch| ch.is_ascii_digit())
            .unwrap_or(false)
        {
            self.do_moves_tokens(&tokens);
        } else {
            let mut explanations = vec![
                "a [int] | analyze next move [int] deep",
                "aa [int] | analyze levels 1..[int]",
                "b/board [boardName] | set board (prefixes Board if missing)",
                "closedwings/w [wing1] [wing2] [...] | set closed wings",
                "d       | display game state",
                "e [int] | analyze then execute suggested move",
                "ep      | execute last analyzed move",
                "f       | fiddle (dev hook)",
                "h [bool] | display user-turn history",
                "m       | mcts analysis (not supported)",
                "numplayers/p [int] | set number of normal players",
                "q       | quit",
                "r       | reset game",
                "sv/setvalue playerNum attributeName attributeValue | set r/s/m/w/f/t",
                "u       | undo to previous normal turn",
                "x [n] [cmd] | repeat [cmd] n times",
                "[playerNum@destRoomId] [destRoomIdForCurrentPlayer] submit turn of those moves",
            ];
            explanations.sort();
            println!("  unrecognized directive '{directive}'");
            for explanation in explanations {
                println!("  {explanation}");
            }
        }
    }

    fn fiddle(&mut self, _tokens: Option<&[String]>) {}

    fn print_game_settings(&self) {
        println!("  NormalPlayers(p): {}", self.num_normal_players);
        println!("  Board(b):         {}", self.board_name);
        println!(
            "  ClosedWings(w):   {}",
            self.closed_wing_names.join(", ")
        );
        println!("  AnalysisLevel(a): {}", self.analysis_level);
    }

    fn analyze(&mut self, do_suggested_move: bool, analysis_level: i32, _parallelization: i32) {
        let Some(game) = self.game.as_ref() else {
            return;
        };

        let mut num_states_visited = 0usize;
        let watch = Instant::now();
        let appraised_turn = TreeSearch::find_best_turn(
            game,
            analysis_level,
            &NeverCancelToken,
            &mut num_states_visited,
        );
        let elapsed = watch.elapsed();

        if let Some(turn) = appraised_turn.turn.clone() {
            self.recent_analyzed_turn = Some(turn);
        }

        let score_text = if appraised_turn.appraisal == rule_helper::HEURISTIC_SCORE_WIN {
            "WIN".to_string()
        } else if appraised_turn.appraisal == rule_helper::HEURISTIC_SCORE_LOSS {
            "LOSE".to_string()
        } else {
            format!("{:+0.4}", appraised_turn.appraisal)
        };

        let best_turn_text = appraised_turn
            .turn
            .as_ref()
            .map(|turn| turn.to_string())
            .unwrap_or_default();

        println!(
            "bestTurn={:<10} level={} appraisal={} states={} timeSec={:.2}",
            best_turn_text,
            analysis_level,
            score_text,
            num_states_visited,
            elapsed.as_secs_f64()
        );

        if do_suggested_move {
            if let Some(turn) = appraised_turn.turn {
                self.do_moves_turn(turn);
            }
        }
    }

    fn do_moves_tokens(&mut self, tokens: &[String]) {
        let Some(game) = self.game.as_ref() else {
            return;
        };

        if game.has_winner() {
            println!("{} won already.  Moves not accepted.", game.player_text_for(game.winner));
            return;
        }

        let mut moves = Vec::new();
        let mut has_parse_errors = false;
        let default_player_display_num = game.current_player_id.0 + 1;

        for token in tokens {
            let subtokens = token
                .split(|ch| ch == ',' || ch == '@')
                .collect::<Vec<_>>();
            let dest_room_subtoken = if subtokens.len() == 1 {
                subtokens[0]
            } else {
                subtokens[1]
            };

            if let Ok(dest_room_id) = dest_room_subtoken.parse::<usize>() {
                let mut player_display_num = default_player_display_num;
                if subtokens.len() >= 2 {
                    if let Ok(parsed_num) = subtokens[0].parse::<usize>() {
                        player_display_num = parsed_num;
                    } else {
                        println!(
                            "  failed parse for room id from '{}' subtoken of '{}'",
                            subtokens[0], token
                        );
                        has_parse_errors = true;
                        continue;
                    }
                }

                if player_display_num == 0 {
                    println!("  failed parse for room id from '{token}'");
                    has_parse_errors = true;
                    continue;
                }

                let player_id = PlayerId(player_display_num - 1);
                moves.push(PlayerMove::new(player_id, RoomId(dest_room_id)));
            } else {
                println!("  failed parse for room id from '{token}'");
                has_parse_errors = true;
            }
        }

        if !has_parse_errors {
            self.do_moves_turn(SimpleTurn::new(moves));
        }
    }

    fn do_moves_turn(&mut self, turn: SimpleTurn) {
        self.recent_analyzed_turn = None;

        let is_valid = self
            .game
            .as_ref()
            .map(|game| game.check_normal_turn(&turn))
            .unwrap_or_else(|| Err("game not initialized".to_string()));

        if let Err(error_msg) = is_valid {
            println!("  invalid turn: {error_msg}");
            return;
        }

        if let Some(game) = self.game.as_ref() {
            let mut new_state = game.clone();
            new_state.after_normal_turn(turn, true);
            self.game = Some(new_state);
        }
    }

    fn handle_set_value(&mut self, tokens: &[String]) {
        const DOCTOR_PLAYER_NUM: i32 = 0;

        let Some(game) = self.game.as_mut() else {
            return;
        };

        if tokens.len() <= 3 {
            println!("  setvalue directive needs following tokens: playerNum attributeName attributeValue");
            return;
        }

        let player_num = match tokens[1].parse::<i32>() {
            Ok(value) => value,
            Err(_) => {
                println!("  setvalue directive needs following tokens: playerNum attributeName attributeValue");
                return;
            }
        };

        let attribute_value = match tokens[3].parse::<f64>() {
            Ok(value) => value,
            Err(_) => {
                println!("  setvalue directive needs following tokens: playerNum attributeName attributeValue");
                return;
            }
        };

        if player_num < 0 || player_num > game.common.num_all_players as i32 {
            println!("  setvalue directive needs following tokens: playerNum attributeName attributeValue");
            return;
        }

        let attribute_name = tokens[2].as_str();
        let player_id = player_num - 1;

        if attribute_name == "r" || attribute_name == "room" {
            let dest_room_id = RoomId(attribute_value as usize);
            if !game.common.board.room_ids.contains(&dest_room_id) {
                println!("  invalid room id {}", attribute_value);
                return;
            }

            if player_num == DOCTOR_PLAYER_NUM {
                game.doctor_room_id = dest_room_id;
            } else if player_id >= 0 {
                game.player_room_ids[player_id as usize] = dest_room_id;
            }
        } else if player_id < 0 {
            println!("  setvalue directive needs following tokens: playerNum attributeName attributeValue");
            return;
        } else if attribute_name == "s" || attribute_name == "strength" {
            game.player_strengths[player_id as usize] = attribute_value as i32;
        } else if attribute_name == "m" || attribute_name == "moves" {
            game.player_move_cards[player_id as usize] = attribute_value;
        } else if attribute_name == "w" || attribute_name == "weapons" {
            game.player_weapons[player_id as usize] = attribute_value;
        } else if attribute_name == "f" || attribute_name == "failures" {
            game.player_failures[player_id as usize] = attribute_value;
        } else if attribute_name == "t" || attribute_name == "turn" {
            game.turn_id = attribute_value as i32;
            game.current_player_id = PlayerId(player_id as usize);
        }

        self.recent_analyzed_turn = None;
        println!("{}", game.summary(1));
    }

    fn reset_game_with_problems(&mut self) -> Result<(), Vec<String>> {
        let board = Board::from_embedded_json_with_options(
            &self.board_name,
            self.closed_wing_names.iter().map(String::as_str),
            "",
        )
        .map_err(|err| {
            println!("exception while constructing GameState: {err:?}");
            vec![format!("{err:?}")]
        })?;

        if let Err(mistakes) = board.is_valid() {
            return Err(mistakes);
        }

        let common = CommonGameState::from_num_normal_players(true, board, self.num_normal_players);
        self.game = Some(MutableGameState::at_start(common.clone()));
        self.game_common = Some(common);
        self.board_name_old = self.board_name.clone();
        self.deck_name_old = self.deck_name.clone();
        self.num_normal_players_old = self.num_normal_players;
        self.closed_wing_names_old = self.closed_wing_names.clone();

        Ok(())
    }

    fn reset_game(&mut self) -> bool {
        let result = self.reset_game_with_problems();
        match result {
            Ok(()) => {
                self.print_game_settings();
                if let Some(game) = self.game.as_ref() {
                    println!("{}", game.summary(1));
                }
                true
            }
            Err(problems) => {
                println!("problems resetting game");
                for problem in problems {
                    println!("  {problem}");
                }
                false
            }
        }
    }

    fn user_prompt_text(&self) -> String {
        let Some(game) = self.game.as_ref() else {
            return "> ".to_string();
        };

        if game.has_winner() {
            format!("{} WON> ", game.player_text_for(game.winner))
        } else {
            format!("{}> ", game.player_text())
        }
    }
}

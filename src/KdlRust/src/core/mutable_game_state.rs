use crate::core::{
    board::Board,
    common_game_state::CommonGameState,
    game_state::GameState,
    player::{AppraisalState, PlayerAction, PlayerId, PlayerMove, PlayerType},
    room::RoomId,
    rule_helper,
    simple_turn::SimpleTurn,
};
use std::fmt;
use std::hash::{Hash, Hasher};
use std::rc::Rc;

#[derive(Clone, Debug)]
pub struct MutableGameState {
    pub common: CommonGameState,
    pub turn_id: i32,
    pub current_player_id: PlayerId,
    pub doctor_room_id: RoomId,
    pub player_room_ids: Vec<RoomId>,
    pub player_move_cards: Vec<f64>,
    pub player_weapons: Vec<f64>,
    pub player_failures: Vec<f64>,
    pub player_strengths: Vec<i32>,
    pub attacker_hist: Vec<PlayerId>,
    pub winner: PlayerId,
    pub prev_turn: SimpleTurn,
    pub prev_state: Option<Rc<MutableGameState>>,
}

impl MutableGameState {
    pub fn at_start(common: CommonGameState) -> Self {
        let num_players = common.num_all_players as usize;
        let player_start_room_id = common.board.player_start_room_id;
        let doctor_room_id = common.board.doctor_start_room_id;
        let player_room_ids = vec![player_start_room_id; num_players];
        let player_move_cards = vec![rule_helper::simple::PLAYER_STARTING_MOVE_CARDS; num_players];
        let player_weapons = vec![rule_helper::simple::PLAYER_STARTING_WEAPONS; num_players];
        let player_failures = vec![rule_helper::simple::PLAYER_STARTING_FAILURES; num_players];
        let player_strengths = vec![rule_helper::PLAYER_STARTING_STRENGTH; num_players];

        MutableGameState {
            common,
            turn_id: 1,
            current_player_id: PlayerId(0),
            doctor_room_id,
            player_room_ids,
            player_move_cards,
            player_weapons,
            player_failures,
            player_strengths,
            attacker_hist: Vec::new(),
            winner: PlayerId::INVALID,
            prev_turn: SimpleTurn::invalid_default(),
            prev_state: None,
        }
    }

    pub fn copy_state(&self) -> Self {
        Self {
            common: self.common.clone(),
            turn_id: self.turn_id,
            current_player_id: self.current_player_id,
            doctor_room_id: self.doctor_room_id,
            player_room_ids: self.player_room_ids.clone(),
            player_move_cards: self.player_move_cards.clone(),
            player_weapons: self.player_weapons.clone(),
            player_failures: self.player_failures.clone(),
            player_strengths: self.player_strengths.clone(),
            attacker_hist: self.attacker_hist.clone(),
            winner: self.winner,
            prev_turn: self.prev_turn.clone(),
            prev_state: self.prev_state.clone(),
        }
    }

    pub fn is_mutable(&self) -> bool {
        true
    }

    pub fn num_players(&self) -> usize {
        self.common.num_normal_players
    }

    pub fn has_winner(&self) -> bool {
        self.winner != PlayerId::INVALID
    }

    pub fn is_normal_turn(&self) -> bool {
        self.common.get_player_type(self.current_player_id) == PlayerType::Normal
    }

    pub fn ply(&self) -> i32 {
        let mut ply = 0;
        let mut state = self.prev_state.as_deref();

        while let Some(prev) = state {
            if prev.is_normal_turn() {
                ply += 1;
            }

            state = prev.prev_state.as_deref();
        }

        ply
    }

    pub fn current_player_type(&self) -> PlayerType {
        self.common.get_player_type(self.current_player_id)
    }

    pub fn player_text(&self) -> String {
        self.player_text_for(self.current_player_id)
    }

    pub fn player_text_for(&self, player_id: PlayerId) -> String {
        self.common.player_text(player_id)
    }

    pub fn doctor_moves_until_room(&self, room_id: RoomId) -> i32 {
        let room_ids = &self.common.board.room_ids;
        let room_count = room_ids.len();
        if room_count == 0 {
            return 0;
        }

        let doctor_idx = room_ids
            .binary_search_by_key(&self.doctor_room_id.0, |candidate| candidate.0)
            .expect("doctor room id not found in board room ids");
        let target_idx = room_ids
            .binary_search_by_key(&room_id.0, |candidate| candidate.0)
            .expect("target room id not found in board room ids");

        let distance = if target_idx >= doctor_idx {
            target_idx - doctor_idx
        } else {
            room_count - (doctor_idx - target_idx)
        };

        distance as i32
    }

    pub fn doctor_moves_until_player_room(&self, player_id: PlayerId) -> i32 {
        self.doctor_moves_until_room(self.player_room_ids[player_id.0])
    }

    pub fn player_equivalent_clovers(&self, player_id: PlayerId) -> f64 {
        let idx = player_id.0;
        self.player_failures[idx] * rule_helper::simple::CLOVERS_PER_FAILURE
            + self.player_weapons[idx] * rule_helper::simple::CLOVERS_PER_WEAPON
            + self.player_move_cards[idx] * rule_helper::simple::CLOVERS_PER_MOVE_CARD
    }

    pub fn player_text_long(&self, player_id: PlayerId) -> String {
        let idx = player_id.0;
        let mut text = format!(
            "{}(R{:02},S{}",
            self.player_text_for(player_id),
            self.player_room_ids[idx].0,
            self.player_strengths[idx],
        );

        if self.common.get_player_type(player_id) == PlayerType::Normal {
            let clovers = self.player_equivalent_clovers(player_id);
            text.push_str(&format!(
                ",M{:.1},W{:.1},F{:.1},C{:.1}",
                self.player_move_cards[idx],
                self.player_weapons[idx],
                self.player_failures[idx],
                clovers
            ));
        }

        text.push(')');
        text
    }

    pub fn player_sees_player(&self, player_id1: PlayerId, player_id2: PlayerId) -> bool {
        let room1 = self.player_room_ids[player_id1.0];
        let room2 = self.player_room_ids[player_id2.0];
        self.common.board.sight[room1.0][room2.0]
    }

    pub fn num_defensive_clovers(&self) -> f64 {
        let mut clovers = 0.0;
        let attacking_side = rule_helper::to_normal_player_id(
            self.current_player_id,
            self.common.num_normal_players,
        );

        for pid in 0..self.common.num_normal_players {
            let pid = PlayerId(pid as usize);
            if pid != self.current_player_id {
                if self.common.get_player_type(pid) == PlayerType::Normal {
                    if pid != attacking_side {
                        clovers += self.player_failures[pid.0]
                            * rule_helper::simple::CLOVERS_PER_FAILURE
                            + self.player_weapons[pid.0] * rule_helper::simple::CLOVERS_PER_WEAPON
                            + self.player_move_cards[pid.0]
                                * rule_helper::simple::CLOVERS_PER_MOVE_CARD;
                    }
                }
            }
        }

        clovers
    }

    pub fn summary(&self, indentation_level: usize) -> String {
        self.state_summary(&" ".repeat(indentation_level))
    }

    pub fn state_summary(&self, leading_text: &str) -> String {
        let mut sb = String::new();
        let heuristic_score = self.heuristic_score(self.current_player_id);
        let heuristic_score_text = if heuristic_score == rule_helper::HEURISTIC_SCORE_WIN {
            "WIN".to_string()
        } else if heuristic_score == rule_helper::HEURISTIC_SCORE_LOSS {
            "LOSS".to_string()
        } else {
            format!("{:+0.2}", heuristic_score)
        };
        sb.push_str(&format!(
            "{leading_text}Turn {}, {}, HeuScore={}",
            self.turn_id,
            self.player_text(),
            heuristic_score_text,
        ));

        let attacker_hist = self
            .attacker_hist
            .iter()
            .map(|player_id| CommonGameState::to_player_display_num(*player_id))
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(",");
        sb.push_str(&format!("\n{leading_text}  AttackHist={{{attacker_hist}}}"));
        sb.push_str(&format!("\n{leading_text}  Dr@R{}", self.doctor_room_id.0));

        let players_who_can_see_doctor = self
            .common
            .player_ids()
            .zip(self.player_room_ids.iter().copied())
            .filter(|(_, room_id)| self.common.board.sight[room_id.0][self.doctor_room_id.0])
            .map(|(pid, _)| CommonGameState::to_player_display_num(pid))
            .collect::<Vec<_>>();

        if players_who_can_see_doctor.is_empty() {
            sb.push_str(", unseen by players");
        } else {
            let text = players_who_can_see_doctor
                .iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(",");
            sb.push_str(&format!(", seen by players{{{text}}}"));
        }

        for player_id in self.common.player_ids() {
            sb.push_str(&format!(
                "\n{leading_text}  {}",
                self.player_text_long(player_id)
            ));

            if player_id == self.current_player_id {
                sb.push_str(" *");
            }

            if self.player_room_ids[player_id.0 as usize] == self.doctor_room_id {
                sb.push_str(" D");
            }
        }

        sb
    }

    pub fn check_normal_turn(&self, turn: &SimpleTurn) -> Result<(), String> {
        for mv in &turn.moves {
            if mv.player_id.0 >= self.common.num_all_players {
                return Err(format!(
                    "invalid playerId {} (displayed {})",
                    mv.player_id.0,
                    self.player_text_for(mv.player_id)
                ));
            } else if !self.common.board.room_ids.contains(&mv.dest_room_id) {
                return Err(format!("invalid roomId {}", mv.dest_room_id.0));
            }
        }

        let total_dist: i32 = turn
            .moves
            .iter()
            .map(|mv| {
                self.common.board.distance[self.player_room_ids[mv.player_id.0 as usize].0]
                    [mv.dest_room_id.0]
            })
            .sum();

        if self.player_move_cards[self.current_player_id.0 as usize]
            < (total_dist - 1).max(0) as f64
        {
            return Err(format!(
                "player {} used too many move points ({total_dist})",
                self.player_text()
            ));
        }

        for mv in &turn.moves {
            if mv.player_id.0 >= self.player_room_ids.len() {
                return Err(format!(
                    "invalid player ({}) in move",
                    self.player_text_for(mv.player_id)
                ));
            }

            if mv.player_id != self.current_player_id
                && self.common.get_player_type(mv.player_id) != PlayerType::Stranger
            {
                return Err(format!(
                    "player {} tried to move non-stranger {}",
                    self.player_text(),
                    self.player_text_for(mv.player_id)
                ));
            }
        }

        Ok(())
    }

    pub fn after_turn(
        &mut self,
        turn: SimpleTurn,
        must_return_new_object: bool,
    ) -> MutableGameState {
        if must_return_new_object {
            let mut new_state = self.copy_state();
            new_state.after_normal_turn(turn, false);
            new_state
        } else {
            self.after_normal_turn(turn, false);
            self.clone()
        }
    }

    pub fn after_normal_turn(&mut self, turn: SimpleTurn, want_log: bool) -> &mut Self {
        if want_log {
            self.prev_state = Some(Rc::new(self.copy_state()));
        }

        let total_dist: i32 = turn
            .moves
            .iter()
            .map(|mv| {
                self.common.board.distance[self.player_room_ids[mv.player_id.0 as usize].0]
                    [mv.dest_room_id.0]
            })
            .sum();
        let move_cards_used = (total_dist - 1).max(0) as f64;
        let current_idx = self.current_player_id.0 as usize;
        self.player_move_cards[current_idx] -= move_cards_used;

        let mut moved_stranger_that_saw_doctor = false;

        for mv in &turn.moves {
            let player_idx = mv.player_id.0 as usize;
            let room_id = self.player_room_ids[player_idx];
            if mv.player_id != self.current_player_id
                && self.common.board.sight[room_id.0][self.doctor_room_id.0]
            {
                moved_stranger_that_saw_doctor = true;
            }

            self.player_room_ids[player_idx] = mv.dest_room_id;
        }

        self.prev_turn = turn;

        let action = self.best_action_allowed(moved_stranger_that_saw_doctor);

        if action == PlayerAction::Attack {
            if self.process_attack() {
                self.winner = self.current_player_id;
            }
        } else if action == PlayerAction::Loot {
            self.player_move_cards[current_idx] += rule_helper::simple::MOVE_CARDS_PER_LOOT;
            self.player_weapons[current_idx] += rule_helper::simple::WEAPONS_PER_LOOT;
            self.player_failures[current_idx] += rule_helper::simple::FAILURES_PER_LOOT;
        }

        if !self.has_winner() {
            self.do_doctor_phase();
        }

        self.turn_id += 1;

        if want_log {
            println!("{}", self.prev_turn_summary(true));
        }

        if !self.has_winner() && !self.is_normal_turn() {
            return self.after_stranger_turn(want_log);
        }

        self
    }

    pub fn after_stranger_turn(&mut self, want_log: bool) -> &mut Self {
        if want_log {
            self.prev_state = Some(Rc::new(self.copy_state()));
        }

        let mut best_action = self.best_action_allowed(false);

        let current_player_idx = self.current_player_id.0 as usize;
        let current_room = self.player_room_ids[current_player_idx];
        let new_room_id = if best_action == PlayerAction::Attack {
            current_room
        } else {
            Board::next_room_id(current_room, -1, &self.common.board.room_ids)
        };
        self.player_room_ids[current_player_idx] = new_room_id;

        if best_action != PlayerAction::Attack {
            best_action = self.best_action_allowed(false);
        }

        if best_action == PlayerAction::Attack {
            if self.process_attack() {
                self.current_player_id = rule_helper::to_normal_player_id(
                    self.current_player_id,
                    self.common.num_normal_players,
                );
                self.winner = self.current_player_id;
            }
        }

        if !self.has_winner() {
            self.do_doctor_phase();
        }

        self.turn_id += 1;

        if want_log {
            println!("{}", self.prev_turn_summary(true));
        }

        if !self.has_winner() && !self.is_normal_turn() {
            return self.after_stranger_turn(want_log);
        }

        self
    }

    pub fn best_action_allowed(&self, moved_stranger_that_saw_doctor: bool) -> PlayerAction {
        let mut seen_by_other_players = false;
        let current_room_id = self.player_room_ids[self.current_player_id.0 as usize];

        for player_id in self.common.player_ids() {
            if player_id != self.current_player_id
                && self.common.board.sight[current_room_id.0]
                    [self.player_room_ids[player_id.0 as usize].0]
            {
                seen_by_other_players = true;
                break;
            }
        }

        if seen_by_other_players {
            return PlayerAction::None;
        }

        if current_room_id == self.doctor_room_id
            && (!rule_helper::simple::STRANGERS_ARE_NOSY || !moved_stranger_that_saw_doctor)
        {
            return PlayerAction::Attack;
        }

        if self.common.board.sight[current_room_id.0][self.doctor_room_id.0] {
            PlayerAction::None
        } else {
            PlayerAction::Loot
        }
    }

    pub fn normal_turn_hist(&self) -> String {
        let mut states = Vec::new();
        let mut state_for_traversal = Some(self);

        while let Some(state) = state_for_traversal {
            states.push(state);
            state_for_traversal = state.prev_state.as_deref();
        }

        states.reverse();
        let mut text = String::new();

        for state in states.iter().skip(1) {
            if let Some(prev_state) = state.prev_state.as_deref() {
                if !prev_state.is_normal_turn() {
                    continue;
                }
            }

            text.push_str(&state.prev_turn_summary(false));
            text.push(' ');
        }

        text
    }
}

impl MutableGameState {
    pub fn heuristic_score(&self, analysis_player_id: PlayerId) -> f64 {
        if self.has_winner() {
            return if analysis_player_id
                == rule_helper::to_normal_player_id(self.winner, self.common.num_normal_players)
            {
                rule_helper::HEURISTIC_SCORE_WIN
            } else {
                rule_helper::HEURISTIC_SCORE_LOSS
            };
        }

        let misc_score = |player_id: PlayerId,
                          allied_strength: i32,
                          is_allied_turn: bool,
                          allied_doctor_advantage: f64|
         -> f64 {
            let allied_strength = allied_strength as f64;
            allied_strength
                + 0.5
                    * allied_strength
                    * (self.player_move_cards[player_id.0 as usize]
                        + if is_allied_turn { 0.95 } else { 0.0 }
                        + allied_doctor_advantage * 0.9)
                + 0.5 * self.player_weapons[player_id.0 as usize]
                + 0.125 * self.player_failures[player_id.0 as usize]
        };

        if self.common.has_strangers() {
            let stranger_ally = rule_helper::allied_stranger(analysis_player_id);
            let normal_opponent = rule_helper::opposing_normal_player(analysis_player_id);
            let stranger_opponent = rule_helper::allied_stranger(normal_opponent);
            let allied_strength = self.player_strengths[analysis_player_id.0 as usize]
                + self.player_strengths[stranger_ally.0 as usize];
            let opponent_strength = self.player_strengths[normal_opponent.0 as usize]
                + self.player_strengths[stranger_opponent.0 as usize];
            let is_my_turn = analysis_player_id == self.current_player_id;
            let allied_doctor_advantage = self.doctor_score_with_rooms(
                self.player_room_ids[if is_my_turn {
                    analysis_player_id.0
                } else {
                    normal_opponent.0
                } as usize],
                self.player_room_ids[if is_my_turn {
                    stranger_ally.0
                } else {
                    stranger_opponent.0
                } as usize],
                self.player_room_ids[if is_my_turn {
                    normal_opponent.0
                } else {
                    analysis_player_id.0
                } as usize],
                self.player_room_ids[if is_my_turn {
                    stranger_opponent.0
                } else {
                    stranger_ally.0
                } as usize],
            ) * if is_my_turn { 1.0 } else { -1.0 };

            misc_score(
                analysis_player_id,
                allied_strength,
                is_my_turn,
                allied_doctor_advantage,
            ) - misc_score(
                normal_opponent,
                opponent_strength,
                !is_my_turn,
                -allied_doctor_advantage,
            )
        } else {
            let mut score = 0.0;
            for pid in 0..self.common.num_all_players as usize {
                let pid = PlayerId(pid);
                let weight =
                    if rule_helper::to_normal_player_id(pid, self.common.num_normal_players)
                        == analysis_player_id
                    {
                        1.0
                    } else {
                        -1.0 / ((self.common.num_normal_players - 1) as f64)
                    };
                score += weight
                    * misc_score(
                        pid,
                        self.player_strengths[pid.0 as usize],
                        pid == self.current_player_id,
                        0.0,
                    );
            }
            score
        }
    }

    pub fn doctor_score(&self) -> f64 {
        self.doctor_score_with_rooms(
            self.player_room_ids[self.current_player_id.0 as usize],
            self.player_room_ids[rule_helper::allied_stranger(self.current_player_id).0 as usize],
            self.player_room_ids
                [rule_helper::opposing_normal_player(self.current_player_id).0 as usize],
            self.player_room_ids[rule_helper::opposing_stranger(self.current_player_id).0 as usize],
        )
    }

    pub fn doctor_score_with_rooms(
        &self,
        my_room: RoomId,
        stranger_ally_room: RoomId,
        normal_enemy_room: RoomId,
        stranger_enemy_room: RoomId,
    ) -> f64 {
        const DECAY_FACTOR_NORMAL: f64 = 0.9;
        const DECAY_FACTOR_STRANGER: f64 = 0.5;

        let num_players_not_had_turn = self.common.num_all_players as i32 - self.turn_id;
        let doctor_delta_for_activation = (num_players_not_had_turn + 1).max(1);
        let next_doctor_room_id = Board::next_room_id(
            self.doctor_room_id,
            doctor_delta_for_activation,
            &self.common.board.room_ids,
        );

        let mut doctor_rooms = self
            .common
            .board
            .room_ids_in_doctor_visit_order(next_doctor_room_id);
        doctor_rooms.insert(0, self.doctor_room_id);

        let my_starting_search_idx = if num_players_not_had_turn > 0 { 1 } else { 0 };
        let mut my_doctor_dist = 999;

        for i in my_starting_search_idx..doctor_rooms.len() {
            if doctor_rooms[i] == my_room {
                my_doctor_dist = i as i32;
                break;
            } else if i > 0 && self.common.board.distance[my_room.0][doctor_rooms[i].0] <= 1 {
                my_doctor_dist = i as i32;
                break;
            }
        }

        let stranger_ally_doctor_dist =
            find_index_from(&doctor_rooms, stranger_ally_room, 1).unwrap_or(-1) as f64;
        let normal_enemy_doctor_dist =
            find_index_from(&doctor_rooms, normal_enemy_room, 1).unwrap_or(-1) as f64;
        let stranger_enemy_doctor_dist =
            find_index_from(&doctor_rooms, stranger_enemy_room, 1).unwrap_or(-1) as f64;

        DECAY_FACTOR_NORMAL.powi(my_doctor_dist)
            + DECAY_FACTOR_STRANGER.powf(stranger_ally_doctor_dist)
            - DECAY_FACTOR_NORMAL.powf(normal_enemy_doctor_dist)
            - DECAY_FACTOR_STRANGER.powf(stranger_enemy_doctor_dist)
    }

    pub fn possible_turns(&self) -> Vec<SimpleTurn> {
        if self.has_winner() {
            return Vec::new();
        }
        let dist_allowed = self.player_move_cards[self.current_player_id.0 as usize] as i32 + 1;
        let mut turns = self.possible_turns_single(dist_allowed, self.current_player_id);

        if self.common.has_strangers() {
            let allied_stranger = rule_helper::allied_stranger(self.current_player_id);
            let opposing_stranger = rule_helper::opposing_stranger(self.current_player_id);

            turns.extend(self.possible_turns_single(dist_allowed, allied_stranger));
            turns.extend(self.possible_turns_single(dist_allowed, opposing_stranger));

            if self.player_move_cards[self.current_player_id.0 as usize] > 0.0 {
                turns.extend(self.possible_turns_dual(
                    dist_allowed,
                    self.current_player_id,
                    allied_stranger,
                ));
                turns.extend(self.possible_turns_dual(
                    dist_allowed,
                    self.current_player_id,
                    opposing_stranger,
                ));
                turns.extend(self.possible_turns_dual(
                    dist_allowed,
                    allied_stranger,
                    opposing_stranger,
                ));
            }
        }

        turns
    }

    pub fn prev_player_heuristic_score(&self) -> f64 {
        let prev_player_id = self.prev_player_id();
        if prev_player_id == PlayerId::INVALID {
            f64::NAN
        } else {
            self.heuristic_score(prev_player_id)
        }
    }

    pub fn prev_player_id(&self) -> PlayerId {
        let mut state = self.prev_state.as_deref();

        while let Some(prev) = state {
            if prev.is_normal_turn() {
                return prev.current_player_id;
            }
            state = prev.prev_state.as_deref();
        }

        PlayerId::INVALID
    }

    fn possible_turns_single(
        &self,
        dist_allowed: i32,
        movable_player: PlayerId,
    ) -> Vec<SimpleTurn> {
        let movable_room = self.player_room_ids[movable_player.0 as usize];
        let room_ids = &self.common.board.room_ids;
        let distance = &self.common.board.distance[movable_room.0];
        let mut turns = Vec::with_capacity(room_ids.len());

        for dest_room in room_ids {
            if distance[dest_room.0] <= dist_allowed {
                turns.push(SimpleTurn::single(movable_player, *dest_room));
            }
        }

        turns
    }

    fn possible_turns_dual(
        &self,
        dist_allowed: i32,
        movable_player_a: PlayerId,
        movable_player_b: PlayerId,
    ) -> Vec<SimpleTurn> {
        let src_room_a = self.player_room_ids[movable_player_a.0 as usize];
        let src_room_b = self.player_room_ids[movable_player_b.0 as usize];
        let room_ids = &self.common.board.room_ids;
        let distance = &self.common.board.distance;
        let mut turns = Vec::with_capacity(room_ids.len() * room_ids.len());

        for dst_room_a in room_ids {
            let dist_remaining = dist_allowed - distance[src_room_a.0][dst_room_a.0];

            if dist_remaining <= 0 || src_room_a == *dst_room_a {
                continue;
            }

            let move_a = PlayerMove::new(movable_player_a, *dst_room_a);

            for dst_room_b in room_ids {
                if distance[src_room_b.0][dst_room_b.0] > dist_remaining || src_room_b == *dst_room_b {
                    continue;
                }

                let move_b = PlayerMove::new(movable_player_b, *dst_room_b);
                turns.push(SimpleTurn::new([move_a, move_b]));
            }
        }

        turns
    }

    fn process_attack(&mut self) -> bool {
        let current_idx = self.current_player_id.0 as usize;
        let mut attack_strength = self.player_strengths[current_idx] as f64;
        self.player_strengths[current_idx] += 1;
        self.attacker_hist.push(self.current_player_id);

        if self.common.has_strangers() {
            if attack_strength < 0.0 {
                return false;
            }

            if self.is_normal_turn() {
                use_weapon(&mut self.player_weapons, current_idx, &mut attack_strength);
            }

            let defender = rule_helper::opposing_normal_player(self.current_player_id);
            let defender_idx = defender.0 as usize;

            defend_with_card_type(
                defender_idx,
                &mut attack_strength,
                &mut self.player_failures,
                rule_helper::simple::CLOVERS_PER_FAILURE,
            );
            defend_with_card_type(
                defender_idx,
                &mut attack_strength,
                &mut self.player_weapons,
                rule_helper::simple::CLOVERS_PER_WEAPON,
            );
            defend_with_card_type(
                defender_idx,
                &mut attack_strength,
                &mut self.player_move_cards,
                rule_helper::simple::CLOVERS_PER_MOVE_CARD,
            );

            attack_strength > 0.0
        } else {
            let num_defensive_clovers = self.num_defensive_clovers();

            if num_defensive_clovers <= 2.0 * attack_strength {
                use_weapon(&mut self.player_weapons, current_idx, &mut attack_strength);
            }

            if num_defensive_clovers < attack_strength {
                return true;
            }

            let mut defender = self.current_player_id;

            while attack_strength > 0.0 {
                defender = PlayerId(positive_remainder(
                    defender.0 as i32 - 1,
                    self.common.num_all_players as usize,
                ));

                if defender == self.current_player_id {
                    return true;
                }

                let defender_idx = defender.0 as usize;
                defend_with_card_type(
                    defender_idx,
                    &mut attack_strength,
                    &mut self.player_failures,
                    rule_helper::simple::CLOVERS_PER_FAILURE,
                );
                defend_with_card_type(
                    defender_idx,
                    &mut attack_strength,
                    &mut self.player_weapons,
                    rule_helper::simple::CLOVERS_PER_WEAPON,
                );
                defend_with_card_type(
                    defender_idx,
                    &mut attack_strength,
                    &mut self.player_move_cards,
                    rule_helper::simple::CLOVERS_PER_MOVE_CARD,
                );
            }

            false
        }
    }

    fn do_doctor_phase(&mut self) {
        self.doctor_room_id =
            Board::next_room_id(self.doctor_room_id, 1, &self.common.board.room_ids);

        self.current_player_id = PlayerId(
            (self.current_player_id.0 + 1).rem_euclid(self.common.num_all_players as usize),
        );

        if self.turn_id >= self.common.num_all_players as i32 {
            for player_offset in 0..self.common.num_all_players {
                let player_id = PlayerId(
                    (self.current_player_id.0 + player_offset)
                        .rem_euclid(self.common.num_all_players as usize),
                );
                if self.player_room_ids[player_id.0 as usize] == self.doctor_room_id {
                    self.current_player_id = player_id;
                    break;
                }
            }
        }
    }

    pub fn prev_turn_summary(&self, verbose: bool) -> String {
        let Some(prev_state) = self.prev_state.as_deref() else {
            return "PrevStateNull".to_string();
        };

        let prev_player = prev_state.current_player_id;
        let mut verbose_move_texts = Vec::new();
        let mut short_move_texts = Vec::new();
        let mut total_dist = 0;

        for player_id in self.common.player_ids() {
            let prev_room_id = prev_state.player_room_ids[player_id.0 as usize];
            let room_id = self.player_room_ids[player_id.0 as usize];

            if prev_room_id != room_id {
                let dist = self.common.board.distance[prev_room_id.0][room_id.0];
                let dist_text = if dist == 0 {
                    String::new()
                } else {
                    format!(" ({dist}mp)")
                };

                total_dist += dist;
                short_move_texts.push(format!(
                    "{}@{}←{}",
                    CommonGameState::to_player_display_num(player_id),
                    room_id.0,
                    prev_room_id.0
                ));
                verbose_move_texts.push(format!(
                    "    MOVE {}: R{} to R{}{}",
                    self.player_text_for(player_id),
                    prev_room_id.0,
                    room_id.0,
                    dist_text
                ));
            }
        }

        if short_move_texts.is_empty() {
            let room_id = self.player_room_ids[prev_player.0 as usize];
            short_move_texts.push(format!(
                "{}@{}({})",
                CommonGameState::to_player_display_num(prev_player),
                room_id.0,
                room_id.0
            ));
            verbose_move_texts.push(format!(
                "    MOVE {}: stayed at R{}",
                self.player_text_for(prev_player),
                room_id.0
            ));
        }

        let action = if prev_state.attacker_hist.len() != self.attacker_hist.len() {
            PlayerAction::Attack
        } else if prev_state.player_move_cards[prev_player.0 as usize] % 1.0
            != self.player_move_cards[prev_player.0 as usize] % 1.0
        {
            PlayerAction::Loot
        } else {
            PlayerAction::None
        };

        let move_signifier = if prev_state.is_normal_turn() {
            "M".repeat((total_dist - 1).max(0) as usize)
        } else {
            String::new()
        };
        let action_signifier = match action {
            PlayerAction::Attack => "A",
            PlayerAction::Loot => "L",
            PlayerAction::None => "",
        };
        let win_text = if self.has_winner() {
            format!("({} won)", self.player_text_for(self.winner))
        } else {
            String::new()
        };

        let short_summary = format!(
            "({}{}{action_signifier}){}{win_text};",
            self.player_text_for(prev_player),
            move_signifier,
            short_move_texts.join(" ")
        );

        if !verbose {
            return short_summary;
        }

        let mut sb = String::new();
        let ply_text = if prev_state.is_normal_turn() {
            format!("/{}", prev_state.ply())
        } else {
            String::new()
        };
        sb.push_str(&format!(
            "  Turn{}{}, {}",
            prev_state.turn_id, ply_text, short_summary
        ));

        for text in verbose_move_texts {
            sb.push('\n');
            sb.push_str(&text);
        }

        match action {
            PlayerAction::Loot => {
                sb.push('\n');
                sb.push_str(&format!(
                    "    LOOT {}: now {}",
                    self.player_text_for(prev_player),
                    self.player_text_long(prev_player)
                ));
            }
            PlayerAction::Attack => {
                let weapon_bonus = if prev_state.player_weapons[prev_player.0 as usize]
                    == self.player_weapons[prev_player.0 as usize]
                {
                    0.0
                } else {
                    rule_helper::simple::STRENGTH_PER_WEAPON
                };
                let attack_strength =
                    prev_state.player_strengths[prev_player.0 as usize] as f64 + weapon_bonus;
                let hist_text = self
                    .attacker_hist
                    .iter()
                    .map(|player_id| CommonGameState::to_player_display_num(*player_id))
                    .map(|id| id.to_string())
                    .collect::<Vec<_>>()
                    .join(",");
                sb.push('\n');
                sb.push_str(&format!(
                    "    ATTACK: strength={attack_strength:.1} hist={hist_text}"
                ));
            }
            PlayerAction::None => {}
        }

        if self.has_winner() {
            sb.push('\n');
            sb.push_str(&format!(
                "    WINNER: {}",
                self.player_text_for(self.winner)
            ));
        } else {
            sb.push('\n');
            sb.push_str(&format!(
                "    DR MOVE: R{} to R{}",
                prev_state.doctor_room_id.0, self.doctor_room_id.0
            ));

            if self.doctor_room_id == self.player_room_ids[self.current_player_id.0 as usize] {
                let other_players_in_room = self
                    .common
                    .player_ids()
                    .filter(|pid| *pid != self.current_player_id)
                    .filter(|pid| self.player_room_ids[(*pid).0 as usize] == self.doctor_room_id)
                    .map(CommonGameState::to_player_display_num)
                    .collect::<Vec<_>>();

                let unactivated_players_text = if other_players_in_room.is_empty() {
                    String::new()
                } else {
                    format!(
                        ", unactivated players{{{}}}",
                        other_players_in_room
                            .iter()
                            .map(|id| id.to_string())
                            .collect::<Vec<_>>()
                            .join(",")
                    )
                };

                sb.push('\n');
                sb.push_str(&format!(
                    "    DR ACTIVATE: {}{}",
                    self.player_text(),
                    unactivated_players_text
                ));
            }

            sb.push('\n');
            sb.push_str("    start of next turn...\n");
            sb.push_str(&self.state_summary("   "));
        }

        sb
    }

    pub fn prev_turn_summaries_since_normal(&self, verbose: bool) -> String {
        let mut summaries = Vec::new();
        let mut state = self;

        while let Some(prev_state) = state.prev_state.as_deref() {
            summaries.push(state.prev_turn_summary(verbose));
            if prev_state.is_normal_turn() {
                break;
            }
            state = prev_state;
        }

        summaries.into_iter().rev().collect::<Vec<_>>().join("\n")
    }

    pub fn animation_frames_since_normal(&self) -> Vec<[RoomId; 5]> {
        let mut states = Vec::new();
        let mut state = self;

        while let Some(prev_state) = state.prev_state.as_deref() {
            states.push(state);
            if prev_state.is_normal_turn() {
                break;
            }
            state = prev_state;
        }

        if states.is_empty() {
            return Vec::new();
        }

        states.reverse();
        let earliest_state = states[0];
        let Some(prev_state) = earliest_state.prev_state.as_deref() else {
            return Vec::new();
        };

        let mut baseline_player_rooms = prev_state.player_room_ids.clone();
        for mv in &earliest_state.prev_turn.moves {
            if mv.player_id.0 < baseline_player_rooms.len() {
                baseline_player_rooms[mv.player_id.0] = mv.dest_room_id;
            }
        }

        let mut frames = Vec::with_capacity(states.len() + 1);
        frames.push(Self::frame_from_positions(
            prev_state.doctor_room_id,
            &baseline_player_rooms,
        ));

        for state in states {
            frames.push(Self::frame_from_positions(
                state.doctor_room_id,
                &state.player_room_ids,
            ));
        }

        frames
    }

    fn frame_from_positions(doctor_room_id: RoomId, player_room_ids: &[RoomId]) -> [RoomId; 5] {
        [
            doctor_room_id,
            player_room_ids
                .get(rule_helper::SIDE_A_NORMAL_PLAYER_ID.0)
                .copied()
                .unwrap_or(RoomId(0)),
            player_room_ids
                .get(rule_helper::SIDE_B_NORMAL_PLAYER_ID.0)
                .copied()
                .unwrap_or(RoomId(0)),
            player_room_ids
                .get(rule_helper::STRANGER_PLAYER_ID_FIRST.0)
                .copied()
                .unwrap_or(RoomId(0)),
            player_room_ids
                .get(rule_helper::STRANGER_PLAYER_ID_SECOND.0)
                .copied()
                .unwrap_or(RoomId(0)),
        ]
    }
}

fn use_weapon(player_weapons: &mut [f64], idx: usize, attack_strength: &mut f64) {
    if player_weapons[idx] >= 1.0 {
        *attack_strength += rule_helper::simple::STRENGTH_PER_WEAPON;
        player_weapons[idx] -= 1.0;
    }
}

fn defend_with_card_type(
    idx: usize,
    attack_strength: &mut f64,
    player_cards: &mut [f64],
    clovers_per_card: f64,
) {
    if *attack_strength > 0.0 && player_cards[idx] > 0.0 {
        let num_used_cards = player_cards[idx].min(*attack_strength / clovers_per_card);
        player_cards[idx] -= num_used_cards;
        *attack_strength -= num_used_cards * clovers_per_card;
    }
}

impl PartialEq for MutableGameState {
    fn eq(&self, other: &Self) -> bool {
        self.common == other.common
            && self.current_player_id == other.current_player_id
            && self.doctor_room_id == other.doctor_room_id
            && self.player_room_ids == other.player_room_ids
            && self.player_move_cards == other.player_move_cards
            && self.player_weapons == other.player_weapons
            && self.player_failures == other.player_failures
            && self.player_strengths == other.player_strengths
            && self.winner == other.winner
    }
}

impl Eq for MutableGameState {}

impl fmt::Display for MutableGameState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let rooms_text = self
            .player_room_ids
            .iter()
            .map(|room_id| room_id.0.to_string())
            .collect::<Vec<_>>()
            .join(",");
        write!(
            f,
            "T{},{},[{},{}],{}",
            self.turn_id,
            self.player_text(),
            self.doctor_room_id.0,
            rooms_text,
            self.prev_turn
        )
    }
}

impl Hash for MutableGameState {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.common.hash(state);
        self.current_player_id.hash(state);
        (self.doctor_room_id.0 << 3).hash(state);
        (self.winner.0 << 8).hash(state);
        self.player_room_ids.hash(state);
    }
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

fn positive_remainder(x: i32, modulus: usize) -> usize {
    let modulus = modulus as i32;
    let remainder = x % modulus;
    if remainder >= 0 {
        remainder as usize
    } else {
        (remainder + modulus) as usize
    }
}

fn find_index_from(room_ids: &[RoomId], target: RoomId, start: usize) -> Option<i32> {
    room_ids
        .iter()
        .enumerate()
        .skip(start)
        .find_map(|(idx, room_id)| {
            if *room_id == target {
                Some(idx as i32)
            } else {
                None
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::room::Room;

    fn sample_board() -> Board {
        let rooms = vec![
            Room::new(RoomId(1), "A", [RoomId(2)], [RoomId(2)]),
            Room::new(RoomId(2), "B", [RoomId(1), RoomId(3)], [RoomId(1)]),
            Room::new(RoomId(3), "C", [RoomId(2)], [RoomId(2)]),
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

    fn sample_game_state() -> MutableGameState {
        let common = CommonGameState::from_num_normal_players(true, sample_board(), 3);
        MutableGameState::at_start(common)
    }

    fn tiny_two_player_game_state() -> MutableGameState {
        let board = Board::from_embedded_json("Tiny").expect("Tiny board should be available");
        let common = CommonGameState::from_num_normal_players(true, board, 2);
        MutableGameState::at_start(common)
    }

    fn turn_by_text(state: &MutableGameState, turn_text: &str) -> SimpleTurn {
        state
            .possible_turns()
            .into_iter()
            .find(|turn| turn.to_string() == turn_text)
            .unwrap_or_else(|| {
                panic!(
                    "expected to find turn '{turn_text}', current player {}",
                    state.player_text()
                )
            })
    }

    #[test]
    fn at_start_initializes_arrays() {
        let game = sample_game_state();
        assert_eq!(game.turn_id, 1);
        assert_eq!(game.current_player_id, PlayerId(0));
        assert_eq!(
            game.player_room_ids.len(),
            game.common.num_all_players as usize
        );
        assert!(game.attacker_hist.is_empty());
        assert_eq!(game.winner, PlayerId::INVALID);
        assert_eq!(
            game.player_move_cards,
            vec![rule_helper::simple::PLAYER_STARTING_MOVE_CARDS; 3]
        );
    }

    #[test]
    fn check_normal_turn_catches_invalid_ids() {
        let game = sample_game_state();
        let invalid_player_turn = SimpleTurn::single(PlayerId(4), RoomId(2));
        assert!(game.check_normal_turn(&invalid_player_turn).is_err());

        let invalid_room_turn = SimpleTurn::single(PlayerId(0), RoomId(99));
        assert!(game.check_normal_turn(&invalid_room_turn).is_err());
    }

    #[test]
    fn after_normal_turn_loots_when_doctor_unseen() {
        let mut game = sample_game_state();
        game.doctor_room_id = RoomId(3);
        game.player_room_ids = vec![RoomId(1), RoomId(3), RoomId(3)];
        let turn = SimpleTurn::single(PlayerId(0), RoomId(2));
        let starting_move_cards = game.player_move_cards[0];
        game.after_normal_turn(turn.clone(), false);

        assert_eq!(game.player_room_ids[0], RoomId(2));
        assert!(
            game.player_move_cards[0] > starting_move_cards,
            "player should have looted and gained move cards"
        );
        assert_eq!(game.prev_turn, turn);
    }

    #[test]
    fn best_action_detects_being_seen() {
        let mut game = sample_game_state();
        game.player_room_ids[1] = RoomId(2);
        game.current_player_id = PlayerId(1);
        let action = game.best_action_allowed(false);
        assert_eq!(action, PlayerAction::None);
    }

    #[test]
    fn doctor_moves_until_room_wraps_in_visit_order() {
        let mut game = sample_game_state();
        game.doctor_room_id = RoomId(2);
        assert_eq!(game.doctor_moves_until_room(RoomId(2)), 0);
        assert_eq!(game.doctor_moves_until_room(RoomId(3)), 1);
        assert_eq!(game.doctor_moves_until_room(RoomId(1)), 2);
    }

    #[test]
    fn possible_turns_snapshot_tiny_two_player_start() {
        let game = tiny_two_player_game_state();
        let turn_texts = game
            .possible_turns()
            .into_iter()
            .map(|turn| turn.to_string())
            .collect::<Vec<_>>();
        let snapshot = format!("count={}\n{}", turn_texts.len(), turn_texts.join("\n"));

        assert_eq!(
            snapshot,
            concat!(
                "count=21\n",
                "1@1;\n",
                "1@2;\n",
                "1@3;\n",
                "1@4;\n",
                "4@1;\n",
                "4@2;\n",
                "4@3;\n",
                "4@4;\n",
                "2@1;\n",
                "2@2;\n",
                "2@3;\n",
                "2@4;\n",
                "1@2 4@2;\n",
                "1@2 4@3;\n",
                "1@3 4@2;\n",
                "1@2 2@2;\n",
                "1@2 2@3;\n",
                "1@3 2@2;\n",
                "4@2 2@2;\n",
                "4@2 2@3;\n",
                "4@3 2@2;"
            )
        );
    }

    #[test]
    fn after_turn_respects_must_return_new_object() {
        let mut game = tiny_two_player_game_state();
        let turn = turn_by_text(&game, "1@2;");
        let before = game.clone();

        let returned_new_state = MutableGameState::after_turn(&mut game, turn.clone(), true);
        assert_eq!(game, before, "state should not mutate when cloning is requested");
        assert_ne!(returned_new_state, before);

        let _ = MutableGameState::after_turn(&mut game, turn, false);
        assert_ne!(game, before, "state should mutate when cloning is not requested");
    }

    #[test]
    fn tiny_two_player_state_snapshots_after_two_normal_turns() {
        let mut game = tiny_two_player_game_state();
        let turn_1 = turn_by_text(&game, "1@2;");
        game.after_normal_turn(turn_1, true);
        let turn_2 = turn_by_text(&game, "3@2;");
        game.after_normal_turn(turn_2, true);

        let frames = game
            .animation_frames_since_normal()
            .into_iter()
            .map(|frame| {
                format!(
                    "[{}, {}, {}, {}, {}]",
                    frame[0].0, frame[1].0, frame[2].0, frame[3].0, frame[4].0
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        let snapshot = format!(
            "turnId={}\ncurrent={}\ndoctorRoom={}\nnormalTurnHist={}\nrecentConciseSummaries={}\nframes=\n{}",
            game.turn_id,
            game.player_text(),
            game.doctor_room_id.0,
            game.normal_turn_hist(),
            game.prev_turn_summaries_since_normal(false),
            frames
        );

        assert_eq!(
            snapshot,
            concat!(
                "turnId=5\n",
                "current=P1\n",
                "doctorRoom=1\n",
                "normalTurnHist=(P1L)1@2←1; (P3)3@2←1; \n",
                "recentConciseSummaries=(P3)3@2←1;\n",
                "(p4)4@4←1;\n",
                "frames=\n",
                "[3, 2, 2, 4, 1]\n",
                "[4, 2, 2, 4, 1]\n",
                "[1, 2, 2, 4, 4]"
            )
        );
    }

    #[test]
    fn possible_turns_snapshot_tiny_two_player_after_opening() {
        let mut game = tiny_two_player_game_state();
        let opening_turn = turn_by_text(&game, "1@2;");
        game.after_normal_turn(opening_turn, true);

        let turn_texts = game
            .possible_turns()
            .into_iter()
            .map(|turn| turn.to_string())
            .collect::<Vec<_>>();
        let head = turn_texts.iter().take(8).cloned().collect::<Vec<_>>();
        let tail = turn_texts
            .iter()
            .rev()
            .take(8)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>();

        let snapshot = format!(
            "count={}\nhead={}\ntail={}",
            turn_texts.len(),
            head.join("|"),
            tail.join("|")
        );

        assert_eq!(
            snapshot,
            concat!(
                "count=21\n",
                "head=3@1;|3@2;|3@3;|3@4;|2@1;|2@2;|2@3;|2@4;\n",
                "tail=3@2 2@3;|3@3 2@3;|3@2 4@2;|3@2 4@3;|3@3 4@2;|2@2 4@2;|2@3 4@2;|2@3 4@3;"
            )
        );
    }
}

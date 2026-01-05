use crate::core::{
    room::{Room, RoomId, room_ids},
    wing::Wing,
};
use itertools::Itertools;
use serde::Deserialize;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "PascalCase")]
#[readonly::make]
pub struct BoardSpecification {
    pub name: String,
    pub player_start_room_ids: Vec<RoomId>,
    pub doctor_start_room_ids: Vec<RoomId>,
    pub cat_start_room_ids: Vec<RoomId>,
    pub dog_start_room_ids: Vec<RoomId>,
    pub wings: Vec<Wing>,
    pub rooms: Vec<Room>,
}

impl BoardSpecification {
    pub fn from_json_str(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

#[derive(Clone, Debug, PartialEq)]
#[readonly::make]
pub struct Board {
    pub name: String,
    pub rooms: HashMap<RoomId, Room>, // key is room id
    pub room_ids: Vec<RoomId>,        // sorted
    pub adjacency: Vec<Vec<bool>>,    // double-indexed by room id
    pub sight: Vec<Vec<bool>>,        // double-indexed by room id
    pub distance: Vec<Vec<i32>>,      // double-indexed by room id
    pub adjacency_count: Vec<usize>,  // indexed by room id
    pub stranger_loop_room_ids: HashMap<RoomId, HashSet<RoomId>>, // enemy room id -> allied stranger room ids
    pub player_start_room_id: RoomId,
    pub doctor_start_room_id: RoomId,
    pub cat_start_room_id: RoomId,
    pub dog_start_room_id: RoomId,
    pub spec: Option<BoardSpecification>,
}

impl Board {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        name: impl Into<String>,
        rooms: impl IntoIterator<Item = Room>,
        player_start_room_id: RoomId,
        doctor_start_room_id: RoomId,
        cat_start_room_id: RoomId,
        dog_start_room_id: RoomId,
        spec: Option<BoardSpecification>,
    ) -> Self {
        let rooms_vec = rooms.into_iter().collect::<Vec<_>>();
        let rooms = rooms_vec
            .into_iter()
            .map(|room| (room.id, room))
            .collect::<HashMap<_, _>>();

        let mut room_ids = rooms.keys().copied().collect::<Vec<_>>();
        room_ids.sort_by_key(|room_id| room_id.0);

        let matrix_dim = rooms
            .keys()
            .map(|room_id| room_id.0)
            .max()
            .unwrap_or(0)
            .saturating_add(1);

        let mut adjacency = vec![vec![false; matrix_dim]; matrix_dim];
        let mut sight = vec![vec![false; matrix_dim]; matrix_dim];
        let mut adjacency_count = vec![0usize; matrix_dim];

        for room in rooms.values() {
            let id = room.id.0;
            adjacency[id][id] = true;
            sight[id][id] = true;
            adjacency_count[id] = room.adjacent.len();

            for adjacent_room_id in &room.adjacent {
                adjacency[id][adjacent_room_id.0] = true;
            }

            for visible_room_id in &room.visible {
                let idx = visible_room_id.0;
                sight[id][idx] = true;
            }
        }

        let distance = adjacency_to_distance(&adjacency);
        let stranger_loop_room_ids = distance_to_stranger_loop_info(&room_ids, &distance, &sight);

        Board {
            name: name.into(),
            rooms,
            room_ids,
            adjacency,
            sight,
            distance,
            adjacency_count,
            stranger_loop_room_ids,
            player_start_room_id,
            doctor_start_room_id,
            cat_start_room_id,
            dog_start_room_id,
            spec,
        }
    }

    pub fn from_json_file<P: AsRef<Path>>(board_path: P) -> Result<Self, BoardLoadError> {
        Self::from_json_file_with_options(board_path, std::iter::empty::<String>(), "")
    }

    pub fn from_json_file_with_options<P, S>(
        board_path: P,
        closed_wing_names: impl IntoIterator<Item = S>,
        board_name_suffix: &str,
    ) -> Result<Self, BoardLoadError>
    where
        P: AsRef<Path>,
        S: AsRef<str>,
    {
        let board_path = board_path.as_ref().to_path_buf();
        let board_text = fs::read_to_string(&board_path).map_err(|err| BoardLoadError::Io {
            board_path: board_path.clone(),
            source: err,
        })?;
        let spec = BoardSpecification::from_json_str(&board_text).map_err(|err| {
            BoardLoadError::Json {
                board_path: board_path.clone(),
                source: err,
            }
        })?;
        Self::from_spec(spec, closed_wing_names, board_name_suffix, board_path)
    }

    fn from_spec<S>(
        spec: BoardSpecification,
        closed_wing_names: impl IntoIterator<Item = S>,
        board_name_suffix: &str,
        board_path: PathBuf,
    ) -> Result<Self, BoardLoadError>
    where
        S: AsRef<str>,
    {
        let closed_wing_name_set = closed_wing_names
            .into_iter()
            .map(|name| name.as_ref().to_lowercase())
            .collect::<HashSet<_>>();

        let closed_room_ids = spec
            .wings
            .iter()
            .filter(|wing| closed_wing_name_set.contains(&wing.name.to_lowercase()))
            .flat_map(|wing| wing.room_ids.iter().copied())
            .collect::<HashSet<_>>();

        let closed_room_ids_vec = closed_room_ids.iter().copied().collect::<Vec<_>>();

        let open_rooms = spec
            .rooms
            .iter()
            .filter(|room| !closed_room_ids.contains(&room.id))
            .map(|room| room.without_closed(&closed_room_ids_vec))
            .collect::<Vec<_>>();

        let open_room_id_set = room_ids(&open_rooms).collect::<HashSet<_>>();

        let choose_first_open =
            |desired_room_ids: &[RoomId], role: &'static str| -> Result<RoomId, BoardLoadError> {
                desired_room_ids
                    .iter()
                    .copied()
                    .find(|room_id| open_room_id_set.contains(room_id))
                    .ok_or(BoardLoadError::MissingStartRoom {
                        board_path: board_path.clone(),
                        role,
                    })
            };

        let board = Board::new(
            format!("{}{}", spec.name, board_name_suffix),
            open_rooms,
            choose_first_open(&spec.player_start_room_ids, "player")?,
            choose_first_open(&spec.doctor_start_room_ids, "doctor")?,
            choose_first_open(&spec.cat_start_room_ids, "cat")?,
            choose_first_open(&spec.dog_start_room_ids, "dog")?,
            Some(spec),
        );

        Ok(board)
    }

    pub fn is_valid(&self) -> Result<(), Vec<String>> {
        let mut mistakes = Vec::new();

        if self.player_start_room_id.0 <= 0
            || self.doctor_start_room_id.0 <= 0
            || self.cat_start_room_id.0 <= 0
            || self.dog_start_room_id.0 <= 0
        {
            mistakes.push("bad start room id".to_string());
        }

        let all_rooms = self.rooms.keys().copied().collect::<HashSet<_>>();

        for room in self.rooms.values() {
            if room.adjacent.contains(&room.id) {
                mistakes.push(format!("room {} is in own adjacent list", room.id.0));
            }
            if room.visible.contains(&room.id) {
                mistakes.push(format!("room {} is in own visible list", room.id.0));
            }

            let adjacent = room.adjacent.iter().copied().collect::<HashSet<_>>();
            let nonexistent_adjacent = &adjacent - &all_rooms;
            if !nonexistent_adjacent.is_empty() {
                mistakes.push(format!(
                    "room {} lists nonexistent adjacent rooms {}",
                    room.id.0,
                    nonexistent_adjacent.iter().join(", ")
                ));
            }

            let visible = room.visible.iter().copied().collect::<HashSet<_>>();
            let nonexistent_visible = &visible - &all_rooms;
            if !nonexistent_visible.is_empty() {
                mistakes.push(format!(
                    "room {} lists nonexistent visible rooms {}",
                    room.id.0,
                    nonexistent_visible.iter().join(", ")
                ));
            }
        }

        let max_room_id = self.adjacency.len();
        for r1 in 0..max_room_id {
            for r2 in 0..max_room_id {
                if self.adjacency[r1][r2] != self.adjacency[r2][r1] {
                    mistakes.push(format!("Adjacency[{},{}] contradiction", r1, r2));
                }
                if self.sight[r1][r2] != self.sight[r2][r1] {
                    mistakes.push(format!("Visibility[{},{}] contradiction", r1, r2));
                }
            }
        }

        if mistakes.is_empty() {
            Ok(())
        } else {
            Err(mistakes)
        }
    }

    pub fn room_is_seen_by(
        &self,
        room_of_concern: RoomId,
        rooms_with_other_people: impl IntoIterator<Item = RoomId>,
    ) -> bool {
        rooms_with_other_people
            .into_iter()
            .any(|room_id| self.sight[room_of_concern.0][room_id.0])
    }

    pub fn next_room_id(room_id: RoomId, delta: i32, room_ids: &[RoomId]) -> RoomId {
        let idx = room_ids
            .iter()
            .position(|room| *room == room_id)
            .expect("room id not found in room_ids");
        let next_idx = positive_remainder(idx as i32 + delta, room_ids.len());
        room_ids[next_idx]
    }

    pub fn room_ids_in_doctor_visit_order(&self, start_room_id: RoomId) -> Vec<RoomId> {
        let start_idx = self
            .room_ids
            .iter()
            .position(|room_id| *room_id == start_room_id)
            .expect("start room not found in room_ids");

        (0..self.room_ids.len())
            .map(|i| self.room_ids[(start_idx + i) % self.room_ids.len()])
            .collect()
    }
}

#[derive(Debug)]
pub enum BoardLoadError {
    Io {
        board_path: PathBuf,
        source: std::io::Error,
    },
    Json {
        board_path: PathBuf,
        source: serde_json::Error,
    },
    MissingStartRoom {
        board_path: PathBuf,
        role: &'static str,
    },
}

impl std::fmt::Display for BoardLoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BoardLoadError::Io { board_path, source } => write!(
                f,
                "board load failed for '{}': {}",
                board_path.display(),
                source
            ),
            BoardLoadError::Json { board_path, source } => write!(
                f,
                "board parse failed for '{}': {}",
                board_path.display(),
                source
            ),
            BoardLoadError::MissingStartRoom { board_path, role } => write!(
                f,
                "board '{}' missing start room for {}",
                board_path.display(),
                role
            ),
        }
    }
}

impl std::error::Error for BoardLoadError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            BoardLoadError::Io { source, .. } => Some(source),
            BoardLoadError::Json { source, .. } => Some(source),
            BoardLoadError::MissingStartRoom { .. } => None,
        }
    }
}

fn distance_to_stranger_loop_info(
    room_ids: &[RoomId],
    dist: &[Vec<i32>],
    sight: &[Vec<bool>],
) -> HashMap<RoomId, HashSet<RoomId>> {
    let mut enemy_rooms = HashSet::new();
    let mut ally_rooms = HashSet::new();

    for room_id in room_ids {
        let plus1 = Board::next_room_id(*room_id, 1, room_ids);
        let plus2 = Board::next_room_id(*room_id, 2, room_ids);
        let plus3 = Board::next_room_id(*room_id, 3, room_ids);

        if dist[room_id.0][plus2.0] <= 1 {
            enemy_rooms.insert(plus1);
        }

        if dist[room_id.0][plus3.0] <= 1 && !sight[plus1.0][plus3.0] {
            ally_rooms.insert(plus1);
        }
    }

    let mut info = HashMap::new();

    for enemy_room in enemy_rooms {
        let enemy_minus1 = Board::next_room_id(enemy_room, -1, room_ids);
        let enemy_minus2 = Board::next_room_id(enemy_room, -2, room_ids);
        let mut working_ally_rooms = HashSet::new();

        for ally_room in &ally_rooms {
            if !sight[ally_room.0][enemy_room.0]
                && !sight[ally_room.0][enemy_minus1.0]
                && *ally_room != enemy_minus2
            {
                working_ally_rooms.insert(*ally_room);
            }
        }

        if !working_ally_rooms.is_empty() {
            info.insert(enemy_room, working_ally_rooms);
        }
    }

    info
}

fn adjacency_to_distance(adjacency: &[Vec<bool>]) -> Vec<Vec<i32>> {
    let dim = adjacency.len();
    let mut distance = vec![vec![0; dim]; dim];

    for r in 0..dim {
        for c in 0..dim {
            let initial_dist = if r == c {
                0
            } else if adjacency[r][c] {
                1
            } else {
                999
            };

            distance[r][c] = initial_dist;
        }
    }

    let mut is_improving_distance = true;
    while is_improving_distance {
        is_improving_distance = false;

        for source in 1..dim {
            for destination in 1..dim {
                if source == destination {
                    continue;
                }

                for intermediate in 1..dim {
                    let distance_via_intermediate =
                        distance[source][intermediate] + distance[intermediate][destination];

                    if distance_via_intermediate < distance[source][destination] {
                        distance[source][destination] = distance_via_intermediate;
                        is_improving_distance = true;
                    }
                }
            }
        }
    }

    distance
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

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_rooms() -> Vec<Room> {
        vec![
            Room::new(RoomId(1), "A", [RoomId(2)], [RoomId(2)]),
            Room::new(
                RoomId(2),
                "B",
                [RoomId(1), RoomId(3)],
                [RoomId(1), RoomId(3)],
            ),
            Room::new(
                RoomId(3),
                "C",
                [RoomId(2), RoomId(4)],
                [RoomId(2), RoomId(4)],
            ),
            Room::new(RoomId(4), "D", [RoomId(3)], [RoomId(3)]),
        ]
    }

    #[test]
    fn adjacency_and_distance_are_populated() {
        let rooms = sample_rooms();
        let board = Board::new(
            "test",
            rooms,
            RoomId(1),
            RoomId(1),
            RoomId(1),
            RoomId(1),
            None,
        );

        assert!(board.adjacency[1][2]);
        assert!(board.adjacency[2][1]);
        assert_eq!(board.adjacency_count[2], 2);
        assert_eq!(board.distance[1][4], 3);
    }

    #[test]
    fn room_ids_in_doctor_visit_order_wraps() {
        let rooms = sample_rooms();
        let board = Board::new(
            "test",
            rooms,
            RoomId(1),
            RoomId(1),
            RoomId(1),
            RoomId(1),
            None,
        );

        let visit_order = board.room_ids_in_doctor_visit_order(RoomId(2));
        assert_eq!(
            visit_order,
            vec![RoomId(2), RoomId(3), RoomId(4), RoomId(1)]
        );
    }

    #[test]
    fn next_room_id_handles_negative_delta() {
        let ids = vec![RoomId(1), RoomId(2), RoomId(3)];
        assert_eq!(Board::next_room_id(RoomId(1), -1, &ids), RoomId(3));
        assert_eq!(Board::next_room_id(RoomId(1), -2, &ids), RoomId(2));
    }

    #[test]
    fn board_spec_from_json_parses_pascal_case() {
        let json = r#"{
            "Name": "tiny",
            "PlayerStartRoomIds": [1],
            "DoctorStartRoomIds": [1],
            "CatStartRoomIds": [1],
            "DogStartRoomIds": [1],
            "Wings": [],
            "Rooms": [
                { "Id": 1, "Name": "one", "Adjacent": [2], "Visible": [] },
                { "Id": 2, "Name": "two", "Adjacent": [1], "Visible": [] }
            ]
        }"#;

        let spec = BoardSpecification::from_json_str(json).unwrap();
        assert_eq!(spec.name, "tiny");
        assert_eq!(spec.rooms.len(), 2);
        assert_eq!(spec.rooms[0].id, RoomId(1));
    }
}

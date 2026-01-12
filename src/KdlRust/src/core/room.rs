use serde::{Deserialize, Deserializer, Serialize};
use serde::de::{self, Visitor};
use std::fmt;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct RoomId(pub usize);

impl<'de> Deserialize<'de> for RoomId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct RoomIdVisitor;

        impl<'de> Visitor<'de> for RoomIdVisitor {
            type Value = RoomId;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a room id as a number or numeric string")
            }

            fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                usize::try_from(value)
                    .map(RoomId)
                    .map_err(|_| E::custom("room id out of range for usize"))
            }

            fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                if value < 0 {
                    return Err(E::custom("room id must be non-negative"));
                }

                usize::try_from(value as u64)
                    .map(RoomId)
                    .map_err(|_| E::custom("room id out of range for usize"))
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                value
                    .trim()
                    .parse::<usize>()
                    .map(RoomId)
                    .map_err(E::custom)
            }

            fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                self.visit_str(&value)
            }
        }

        deserializer.deserialize_any(RoomIdVisitor)
    }
}

impl fmt::Display for RoomId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "PascalCase")]
#[readonly::make]
pub struct Room {
    pub id: RoomId,
    pub name: String,
    pub adjacent: Vec<RoomId>,
    pub visible: Vec<RoomId>,
}

impl Room {
    pub fn new(
        id: RoomId,
        name: impl Into<String>,
        adjacent: impl IntoIterator<Item = RoomId>,
        visible: impl IntoIterator<Item = RoomId>,
    ) -> Self {
        Self {
            id,
            name: name.into(),
            adjacent: adjacent.into_iter().collect(),
            visible: visible.into_iter().collect(),
        }
    }

    pub fn without_closed(&self, closed_room_ids: &[RoomId]) -> Self {
        let adjacent = self
            .adjacent
            .iter()
            .filter(|room_id| !closed_room_ids.contains(room_id))
            .copied()
            .collect::<Vec<_>>();
        let visible = self
            .visible
            .iter()
            .filter(|room_id| !closed_room_ids.contains(room_id))
            .copied()
            .collect::<Vec<_>>();
        Room::new(self.id, self.name.clone(), adjacent, visible)
    }
}

impl fmt::Display for Room {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let adjacent_text = self
            .adjacent
            .iter()
            .map(|room_id| room_id.to_string())
            .collect::<Vec<_>>()
            .join(",");

        let visible_text = self
            .visible
            .iter()
            .map(|room_id| room_id.to_string())
            .collect::<Vec<_>>()
            .join(",");

        write!(
            f,
            "{};{};A:{};V:{}",
            self.id, self.name, adjacent_text, visible_text
        )
    }
}

pub fn room_ids(rooms: &[Room]) -> impl Iterator<Item = RoomId> + '_ {
    rooms.iter().map(|room| room.id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_matches_csharp_format() {
        let room = Room {
            id: RoomId(1),
            name: "Hall".into(),
            adjacent: vec![RoomId(2), RoomId(3)],
            visible: vec![RoomId(4), RoomId(5)],
        };

        assert_eq!(room.to_string(), "1;Hall;A:2,3;V:4,5");
    }

    #[test]
    fn without_closed_filters_lists() {
        let room = Room {
            id: RoomId(7),
            name: "Parlor".into(),
            adjacent: vec![RoomId(1), RoomId(2), RoomId(3)],
            visible: vec![RoomId(3), RoomId(4), RoomId(5)],
        };

        let filtered = room.without_closed(&[RoomId(2), RoomId(4)]);

        assert_eq!(filtered.id, RoomId(7));
        assert_eq!(filtered.name, "Parlor");
        assert_eq!(filtered.adjacent, vec![RoomId(1), RoomId(3)]);
        assert_eq!(filtered.visible, vec![RoomId(3), RoomId(5)]);
    }

    #[test]
    fn room_ids_iterates_over_rooms() {
        let rooms = vec![
            Room::new(
                RoomId(10),
                "A".to_string(),
                Vec::<RoomId>::new(),
                Vec::<RoomId>::new(),
            ),
            Room::new(
                RoomId(11),
                "B".to_string(),
                Vec::<RoomId>::new(),
                Vec::<RoomId>::new(),
            ),
        ];

        let ids = room_ids(&rooms).collect::<Vec<_>>();
        assert_eq!(ids, vec![RoomId(10), RoomId(11)]);
    }
}

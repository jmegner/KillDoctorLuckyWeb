use crate::core::room::RoomId;
use std::fmt;

#[derive(Clone, Debug, PartialEq, Eq)]
#[readonly::make]
pub struct Wing {
    pub name: String,
    pub room_ids: Vec<RoomId>,
}

impl Wing {
    pub fn new(name: impl Into<String>, room_ids: impl IntoIterator<Item = RoomId>) -> Self {
        Self {
            name: name.into(),
            room_ids: room_ids.into_iter().collect(),
        }
    }
}

impl fmt::Display for Wing {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let room_ids_text = self
            .room_ids
            .iter()
            .map(|room_id| room_id.to_string())
            .collect::<Vec<_>>()
            .join(",");

        write!(f, "{};{}", self.name, room_ids_text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_matches_csharp_format() {
        let wing = Wing::new("East Wing", [RoomId(1), RoomId(2), RoomId(3)]);

        assert_eq!(wing.to_string(), "East Wing;1,2,3");
    }

    #[test]
    fn constructor_collects_room_ids() {
        let ids = vec![RoomId(4), RoomId(5)];
        let wing = Wing::new("West Wing", ids.clone());

        assert_eq!(wing.name, "West Wing");
        assert_eq!(wing.room_ids, ids);
    }
}

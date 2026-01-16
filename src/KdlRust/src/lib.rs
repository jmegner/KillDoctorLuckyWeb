use wasm_bindgen::prelude::*;

pub mod core;
pub mod util;

#[wasm_bindgen]
extern "C" {
    fn alert(s: &str);
}

#[wasm_bindgen]
pub fn greet() {
    alert("Hello from KillDoctorLuckyRust.");
}

//#[wasm_bindgen] // with no renaming
#[wasm_bindgen(js_name = "getANumber")]
pub fn get_a_number() -> i32 {
    7
}

#[wasm_bindgen]
pub struct GameStateHandle {
    state: core::mutable_game_state::MutableGameState,
}

#[wasm_bindgen]
impl GameStateHandle {
    pub fn summary(&self, indentation_level: usize) -> String {
        self.state.summary(indentation_level)
    }
}

#[wasm_bindgen(js_name = "newDefaultGameState")]
pub fn new_default_game_state() -> Result<GameStateHandle, JsValue> {
    let board = core::board::Board::from_embedded_json("BoardAltDown")
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let common = core::common_game_state::CommonGameState::from_num_normal_players(true, board, 2);
    let state = core::mutable_game_state::MutableGameState::at_start(common);
    Ok(GameStateHandle { state })
}

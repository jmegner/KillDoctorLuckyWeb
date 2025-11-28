use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    fn alert(s: &str);
}

#[wasm_bindgen]
pub fn greet() {
    alert("Hello from KillDoctorLuckyRust.");
}

#[wasm_bindgen]
pub fn get_a_number() -> i32 {
    7
}

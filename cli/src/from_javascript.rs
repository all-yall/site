use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    pub fn log(s: &JsValue);

    #[wasm_bindgen(js_namespace = self)]
    pub async fn sleep(s: u32);

    #[wasm_bindgen(js_namespace = self)]
    pub fn shutdown();
}


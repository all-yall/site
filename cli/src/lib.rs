use std::borrow::Cow;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    // Use `js_namespace` here to bind `console.log(..)` instead of just
    // `log(..)`
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &JsValue);

    // The `console.log` is quite polymorphic, so we can bind it with multiple
    // signatures. Note that we need to use `js_name` to ensure we always call
    // `log` in JS.
    #[wasm_bindgen(js_namespace = console, js_name = log)]
    fn log_u32(a: u32);

    // Multiple arguments too!
    #[wasm_bindgen(js_namespace = console, js_name = log)]
    fn log_many(a: &str, b: &str);
}

struct Stdout<'a> {
  context: &'a JsValue,
  stdout_func: &'a js_sys::Function
}

impl<'a> Stdout<'a> {
  fn wrap(context: &'a JsValue, stdout_func: &'a js_sys::Function) -> Self {
    Self { context, stdout_func }
  }

  fn print<'b, S: Into<Cow<'static, str>>>(&self, string: S) {
    match self.stdout_func.call1(self.context, &JsValue::from(string.into().as_ref())) {
        Ok(js_value) => {},
        Err(message) => log(&message),
    }
  }
}


#[wasm_bindgen]
pub struct Cli {

}

#[wasm_bindgen]
pub fn get_cli() -> Cli {
  Cli { }
}

#[wasm_bindgen]
pub fn event(cli: &mut Cli, string: String, stdout_func: &js_sys::Function, context: &JsValue) {
  let stdout = Stdout::wrap(&context, stdout_func);

  stdout.print(string);
}




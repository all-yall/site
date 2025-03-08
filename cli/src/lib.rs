use std::{str, borrow::Cow, io::Write};

use wasm_bindgen::prelude::*;


const LOGO: &str = include_str!("../ascii/logo.ascii");

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

struct JsOut<'a> {
  context: &'a JsValue,
  stdout_func: &'a js_sys::Function
}

impl<'a> JsOut<'a> {
  fn wrap(context: &'a JsValue, stdout_func: &'a js_sys::Function) -> Self {
    Self { context, stdout_func }
  }

  fn print<'b, S: Into<Cow<'static, str>>>(&self, string: S) {
    match self.stdout_func.call1(self.context, &JsValue::from(string.into().as_ref())) {
        Err(message) => log(&message),
        Ok(_) => {},
    }
  }
}

impl<'a> Write for JsOut<'a> {
  fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
    match str::from_utf8(buf) {
      Ok(message) => {
        self.print(message.to_string());
        Ok(buf.len())
      }
      Err(err) => {
        log(&JsValue::from(err.to_string()));
        Err(std::io::Error::new(std::io::ErrorKind::Other, err))
      }
    }
  }

    fn flush(&mut self) -> std::io::Result<()> {
      Ok(())
    }
}


#[wasm_bindgen]
pub struct Cli {
  booting: bool,
  line: String
}

#[wasm_bindgen]
pub fn get_cli() -> Cli {
  Cli {
    booting: true,
    line: String::new()
  }
}

struct Term<'a> {
  cli: &'a Cli,
  out: JsOut<'a>,
}

impl<'a> Term<'a> {
  fn new(cli: &'a mut Cli, stdout_func: &'a js_sys::Function, context: &'a JsValue) -> Self {
    Self {
      cli,
      out: JsOut::wrap(context, &stdout_func)
    }
  }

  fn handle_event(&mut self, string: String) {
    match &string[..] {
      "startup" => {
        self.logo();
        self.prompt();
      }
      "\r" => { // newline
        self.newline();
        self.prompt();
      }
      "\x7f" => self.backspace(), // backspace
      "\x03" => self.out.print("^C\r\n"), // Ctrl+C

      _ => self.out.print(string)
    }
  }

  fn newline(&self) {
    self.out.print("\r\n")
  }

  fn backspace(&self) {
    self.out.print("\x08 \x08")
  }

  fn prompt(&self) {
    self.out.print("/// >")
  }

  fn logo(&self) {
    for line in LOGO.lines() {
      self.out.print(line);
      self.newline();
    }
  }
}


#[wasm_bindgen]
pub fn event(cli: &mut Cli, string: String, stdout_func: &js_sys::Function, context: &JsValue) {
  let mut term = Term::new(cli, stdout_func, context);
  term.handle_event(string);
}



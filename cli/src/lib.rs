use std::{borrow::Cow, io::Write, mem, str, thread::sleep, time::Duration};

use wasm_bindgen::prelude::*;

const LOGO: &str = include_str!("../ascii/logo.ascii");
const CHAR_TIME: Duration = Duration::from_millis(10);

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

  fn print(&self, string: &str) {
    for chr in (&string).chars() {
      self.print_immediate(&chr.to_string());
    }
  }

  fn print_immediate(&self, string: &str) {
    match self.stdout_func.call1(self.context, &JsValue::from(string)) {
        Err(message) => log(&message),
        Ok(_) => {},
    }
  }
}

impl<'a> Write for JsOut<'a> {
  fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
    match str::from_utf8(buf) {
      Ok(message) => {
        self.print(message);
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
  line: String
}

#[wasm_bindgen]
pub fn get_cli() -> Cli {
  console_error_panic_hook::set_once();
  Cli {
    line: String::new()
  }
}

struct Term<'a> {
  cli: &'a mut Cli,
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
        self.out.print("Loading Initial Filesystem..."); self.newline();
        self.newline();
        self.out.print("HARD DRIVE Status:  'ABSENT'"); self.newline();
        self.out.print("Operating Mode:     'NON-PERSISTANT'"); self.newline();
        self.out.print("User:               'ADMIN'"); self.newline();
        self.newline();
        self.logo();
        self.prompt();
      }
      "\r" => { // newline
        let line = self.cli.line.clone();
        self.command(line);
        self.prompt();
      }
      "\x7f" => self.backspace(), // backspace
      "\x03" => {  // Ctrl+C
        self.out.print("^C");
        self.prompt();
      }
      x => {
        if x.chars().nth(0).is_some_and(|ch| !ch.is_control()) {
          self.cli.line.push_str(&string);
          self.out.print(&string)
        }
      }
    }
  }

  fn newline(&self) {
    self.out.print("\r\n")
  }

  fn backspace(&mut self) {
    if self.cli.line.pop().is_some() {
      self.out.print("\x08 \x08")
    }
  }

  fn prompt(&mut self) {
    self.cli.line.clear();
    self.newline();
    self.out.print("//ADMIN// > ")
  }

  fn logo(&self) {
    for line in LOGO.lines() {
      self.out.print(line);
      self.newline();
    }
  }

  fn command(&mut self, line: String) {

    let toks: Vec<&str> = line.split(" ").filter(|tok| !tok.is_empty()).collect();

    if toks.len() == 0 {
      return
    }

    self.newline();
    match toks.get(0).unwrap() {
      &"help" => {
        self.out.print("No help yet");
      }
      &"ls" | &"cd" | &"mkdir" | &"rm" => {
        self.out.print("Install 'HARD DRIVE' to activate 'FILE' module");
      }

      tok => {
        write!(self.out, "'{}' is not a recognized command. See 'help'.", tok).unwrap();
      }
    }
  }
}


#[wasm_bindgen]
pub fn event(cli: &mut Cli, string: String, stdout_func: &js_sys::Function, context: &JsValue) {
  let mut term = Term::new(cli, stdout_func, context);
  term.handle_event(string);
}



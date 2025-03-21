use std::{io::Write, str};

use wasm_bindgen::prelude::*;
use kanal::{AsyncSender, AsyncReceiver, bounded_async};

const LOGO: &str = include_str!("../ascii/logo.ascii");
const HELP: &str = include_str!("../ascii/help.ascii");

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &JsValue);

    #[wasm_bindgen(js_namespace = self)]
    async fn sleep(s: u32);
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
  line: String,
  send: Option<AsyncSender<String>>,
  recv: AsyncReceiver<String>,
}

#[wasm_bindgen]
pub fn get_cli() -> Cli {
  console_error_panic_hook::set_once();
  let (send, recv) = bounded_async(10); // idk, 10 is good right?
  let send = Some(send);
  Cli {
    line: String::new(),
    send,
    recv
  }
}

#[wasm_bindgen]
pub struct JsSender(AsyncSender<String>);

#[wasm_bindgen]
impl JsSender {
  pub async fn send(&mut self, message: String) {
    let _ = self.0.send(message).await;
  }
}
#[wasm_bindgen]
impl Cli {
  pub fn take_sender(&mut self) -> JsSender {
    JsSender(self.send.take().expect("Can't take twice!"))
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

  async fn run(&mut self) {
    loop {
      let event = self.cli.recv.recv().await.unwrap();
      self.handle_event(event).await;
    }
  }

  async fn handle_event(&mut self, string: String) {
    match &string[..] {
      "startup" => {
        self.cat(LOGO).await;
        self.prompt();
      }
      "\r" => { // newline
        let line = self.cli.line.clone();
        self.command(line).await;
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
    self.out.print("[ADMIN] > ")
  }

  async fn cat(&mut self, msg: &str) {
    for line in msg.lines() {
      for char in line.chars() {
        // if its an hour glass emoji, then wait for a bit instead of printing it.
        if char == '⌛' {
          sleep(130).await;
        } else if char == '←'  {
          self.out.print("\x08")
        } else if char == ' ' {
          // no wait on spacec
          self.out.print(&char.to_string());
        } else {
          self.out.print(&char.to_string());
          sleep(3).await;
        }
      }
      self.newline();
    }
  }

  async fn command(&mut self, line: String) {

    let toks: Vec<&str> = line.split(" ").filter(|tok| !tok.is_empty()).collect();

    if toks.len() == 0 {
      return
    }

    self.newline();
    match toks.get(0).unwrap() {
      &"help" => {
        self.cat(HELP).await;
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
pub async fn run(cli: &mut Cli, stdout_func: &js_sys::Function, context: &JsValue) {
  let mut term = Term::new(cli, stdout_func, context);
  term.run().await
}

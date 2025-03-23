use crate::{
  conway::conway, from_javascript::*, wasmio::WasmIO
};


const LOGO: &str = include_str!("../ascii/logo.ascii");
const HELP: &str = include_str!("../ascii/help.ascii");

pub struct VM<'a> {
  line: String,
  io: WasmIO<'a>,
  char_time: u32,
}

impl<'a> VM<'a> {
  pub fn new(io: WasmIO<'a>) -> Self {
    Self {
      io,
      char_time: 3,
      line: String::new(),
    }
  }

  pub async fn run(&mut self) {
    loop {
      let event = self.io.read().await;
      self.handle_event(event).await;
    }
  }

  async fn handle_event(&mut self, string: String) {
    match &string[..] {
      "startup" => {
        self.delay_print(LOGO).await;
        self.prompt();
      }
      "\r" => { // newline
        let line = self.line.clone();
        self.command(line).await;
        self.prompt();
      }
      "\x7f" => self.backspace(), // backspace
      "\x03" => {  // Ctrl+C
        self.io.print("^C");
        self.prompt();
      }
      x => {
        if x.chars().nth(0).is_some_and(|ch| !ch.is_control()) {
          self.line.push_str(&string);
          self.io.print(&string)
        }
      }
    }
  }

  fn newline(&self) {
    self.io.print("\r\n")
  }

  fn backspace(&mut self) {
    if self.line.pop().is_some() {
      self.io.print("\x08 \x08")
    }
  }

  fn prompt(&mut self) {
    self.line.clear();
    self.newline();
    self.io.print("[ADMIN] > ")
  }

  async fn delay_print(&mut self, msg: &str) {
    for line in msg.lines() {
      for char in line.chars() {
        // if its an hour glass emoji, then wait for a bit instead of printing it.
        if char == '⌛' {
          sleep(130).await;
        } else if char == '←'  {
          self.io.print("\x08")
        } else if char == '🔼'  {
          self.char_time -= 3;
        } else if char == '🔽'  {
          self.char_time += 3;
        } else if char == ' ' {
          // no wait on spacec
          self.io.print(&char.to_string());
        } else {
          self.io.print(&char.to_string());
          sleep(self.char_time).await;
        }
      }
      self.newline();
      if self.io.try_read().is_some_and(|m| m == "") {
        break;
      }
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
        self.delay_print(HELP).await;
      }

      &"conway" => {
        conway(&mut self.io).await;
      }

      &"ls" | &"cd" | &"mkdir" | &"rm" => {
        self.delay_print("Install 'HARD DRIVE' to activate 'FILE' module").await;
      }

      &"boomslang" => {
        self.delay_print("'PRODUCTIVITY' module still in development").await;
      }

      tok => {
        self.delay_print(&format!("'{}' is not a recognized command. See 'help'.", tok)).await
      }
    }
  }
}

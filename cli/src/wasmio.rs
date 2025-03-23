use std::io::Write;

use crate::from_javascript::*;
use kanal::AsyncReceiver;
use wasm_bindgen::prelude::*;

pub struct WasmIO<'a> {
  context: &'a JsValue,
  stdout_func: &'a js_sys::Function,
  stdin_channel: AsyncReceiver<String>,
}

impl<'a> WasmIO<'a> {
  pub fn wrap(context: &'a JsValue, stdout_func: &'a js_sys::Function, stdin_channel: AsyncReceiver<String>) -> Self {
    Self { context, stdout_func, stdin_channel}
  }

  pub fn print(&self, string: &str) {
    match self.stdout_func.call1(self.context, &JsValue::from(string)) {
        Err(error) => log(&error),
        Ok(_) => {},
    }
  }

  pub async fn read(&self) -> String {
    match self.stdin_channel.recv().await {
      Err(error) => {
        log(&JsValue::from(error.to_string()));
        String::new()
      }
      Ok(msg) => msg,
    }
  }

  pub fn try_read(&self) -> Option<String> {
    self.stdin_channel.try_recv().unwrap()
  }

  pub async fn clear(&mut self) {
    while self.has_input() {
      self.read().await;
    }
  }

  pub fn has_input(&self) -> bool {
    self.stdin_channel.len() != 0
  }
}

impl<'a> Write for WasmIO<'a> {
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

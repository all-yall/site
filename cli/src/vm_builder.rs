use wasm_bindgen::prelude::*;
use kanal::{AsyncSender, AsyncReceiver, bounded_async};

#[wasm_bindgen]
pub struct VMBuilder {
  send: Option<AsyncSender<String>>,
  recv: Option<AsyncReceiver<String>>,
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
impl VMBuilder {
  pub fn take_sender(&mut self) -> JsSender {
    JsSender(self.send.take().expect("Can't take twice!"))
  }
}

pub fn take_reciever(vm_builder: &mut VMBuilder) -> AsyncReceiver<String> {
  vm_builder.recv.take().expect("Can't take twice!")
}

#[wasm_bindgen]
pub fn get_vm_builder() -> VMBuilder {
  console_error_panic_hook::set_once();
  let (send, recv) = bounded_async(10); // idk, 10 is good right?
  let send = Some(send);
  let recv = Some(recv);
  VMBuilder {
    send,
    recv
  }
}

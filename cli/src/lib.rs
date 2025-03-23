pub mod from_javascript;
pub mod wasmio;
pub mod vm_builder;
pub mod vm;

use js_sys::Function;
use vm::VM;
use vm_builder::{take_reciever, VMBuilder};
use wasm_bindgen::prelude::*;
use wasmio::WasmIO;


#[wasm_bindgen]
pub async fn run(vm_builder: &mut VMBuilder, stdout_func: &Function, context: &JsValue) {
  let io = WasmIO::wrap(context, stdout_func, take_reciever(vm_builder));
  let mut vm = VM::new(io);
  vm.run().await
}

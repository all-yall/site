// greetingWorker.js
import * as cli from "cli"

const cliInstance = cli.get_cli();
const jsToRustChannel = cli.get_channel();
const jsSender = jsToRustChannel.take_sender();

console.log("Test");

self.onmessage = async (data) => {
  console.log("Recieved messsage; '" + data.data + "'");
  await jsSender.send(data.data);
}

self.postMessage("done loading")

await cli.run(jsToRustChannel, cliInstance, self.postMessage, this);

// greetingWorker.js
import * as amethyst from "cli"

const cli = amethyst.get_cli();
const jsSender = cli.take_sender();

// functions to export to rust
self.sleep = async function(time) {
  await (
    new Promise(resolve => setTimeout(resolve, time))
  );
}


self.onmessage = async (data) => {
  await jsSender.send(data.data);
}
// required as it marks the completion of the handler setup from the worker's end
self.postMessage("done loading")

await amethyst.run(cli, self.postMessage, this);

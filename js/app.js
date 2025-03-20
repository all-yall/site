import { Terminal } from "@xterm/xterm"
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';

require("@xterm/xterm/css/xterm.css")

import * as cli from "cli"


let options = {
  "theme" : {
    "background" : "#080A4A",
    "foreground" : "#d8c2f7",
  },
  "cursorBlink": true,
  "scrollback": 0,
  "fontSize": 18,
  "fontFamily": "PetMeY",
}

var term = new Terminal(options);
term.loadAddon(new WebglAddon());
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);


// hacky bit to make sure font is loaded before creating terminal
await document.fonts.load("10px PetMeY");

term.open(document.getElementById('terminal'));
const worker = new Worker(new URL("./worker.js", import.meta.url));

worker.onmessage = function(_) {
  worker.onmessage = function(data) {
    term.write(data.data);
  }
  worker.postMessage("startup")

  term.onData(function (key) {
    worker.postMessage(key)
  })
}

window.onresize=function() {
  fitAddon.fit();
}
fitAddon.fit();

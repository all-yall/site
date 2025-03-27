import { Terminal } from "@xterm/xterm"
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';

require("@xterm/xterm/css/xterm.css")

import * as cli from "cli"


let options = {
  "theme" : {
    "background" : "#180A4A",
    "foreground" : "#d8c2f7",
  },
  "cursorBlink": true,
  "scrollback": 0,
  "fontSize": 18,
  "fontFamily": "PetMeY",
}

var term = new Terminal(options);
const webGlAddon = new WebglAddon()
term.loadAddon(webGlAddon);
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);


// hacky bit to make sure font is loaded before creating terminal
await document.fonts.load("10px PetMeY");

term.open(document.getElementById('terminal'));
const worker = new Worker(new URL("./worker.js", import.meta.url));

function special_command(cmd) {
  console.log("Special command escape sequence recieved; " + cmd)
  if (cmd == "SHUTDOWN") {
    worker.terminate();
    term.options.theme = {
      background: "#111",
      foreground: "#111",
      cursor: "#111",
      selectionForeground: "#111",
      selectionBackground: "#111"
    };
    term.options.cursorBlink = false;
    term.clear();
  }
}

worker.onmessage = function(_) {
  worker.onmessage = function(data) {
    if (data.data[0] == '') {
      special_command(data.data)
    } else {
      term.write(data.data);
    }
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

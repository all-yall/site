import { Terminal } from "@xterm/xterm/lib/xterm.js"
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

var myCli = cli.get_cli()
term.onData(function (key) {
  cli.event(myCli, key, term.write, term)
})
cli.event(myCli, "startup", term.write, term)

window.onresize=function() {
  fitAddon.fit();
}
fitAddon.fit();

console.log("Done loading")

import { Terminal } from "@xterm/xterm/lib/xterm.js"
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';

require("@xterm/xterm/css/xterm.css")

import * as cli from "cli"

let options = {
  "theme" : {
    "background" : "#040525",
    "foreground" : "#d8c2f7",
  },
  "cursorBlink": true,
  "scrollback": 0,
  "fontSize": 20,
}
var term = new Terminal(options);
term.loadAddon(new WebglAddon());
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

term.open(document.getElementById('terminal'));

var myCli = cli.get_cli()
term.onData(function (key) {
  cli.event(myCli, key, term.write, term)
})
cli.event(myCli, "startup", term.write, term)

		//passes: [
    //  new PP.EffectPass(null, new PP.ScanlineEffect({"density": 1.0, "scrollSpeed": 0.001})),
    //  new PP.EffectPass(null, new PP.BloomEffect()),
		//]

window.onresize=function() {
  fitAddon.fit();
}

console.log("Done loading")

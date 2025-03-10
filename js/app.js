import { Terminal } from "@xterm/xterm/lib/xterm.js"
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';

import XTermEffect from './XTermEffect';
import * as cli from "cli"
import * as THREE from "three"
import * as PP from "postprocessing"

/*
 * I do not really like writing javascript, so I used as many libraries as
 * I could to minimize what I had to write.
 *
 * The XTermEffect file is taken from this
 * https://github.com/slammayjammay/hyper-postprocessing/tree/master
 * awesome hyper plugin, so the only javascript I've written is the
 * remainder of this file
 */

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

let theme = term.options.theme;
term.open(document.getElementById('terminal'));

var myCli = cli.get_cli()
term.onData(function (key) {
  cli.event(myCli, key, term.write, term)
})
cli.event(myCli, "startup", term.write, term)


XTermEffect.THREE = THREE
XTermEffect.PP = PP
let xTermEffect = new XTermEffect({
		passes: [
      new PP.EffectPass(null, new PP.ScanlineEffect({"density": 1.0, "scrollSpeed": 0.001})),
      new PP.EffectPass(null, new PP.BloomEffect()),
		]
});

window.onresize=function() {
  fitAddon.fit();
  xTermEffect.attach(term, true);
}

fitAddon.fit();
xTermEffect.attach(term, true);
xTermEffect.startAnimationLoop();

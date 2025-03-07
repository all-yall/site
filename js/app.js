import { Terminal } from "@xterm/xterm/lib/xterm.js"
import * as cli from "cli"
var term = new Terminal();
term.open(document.getElementById('terminal'));
term.write('Hello from \x1B[1;3;31mxterm.js\x1B[0m $ ')

var myCli = cli.get_cli()

term.onKey(function (evnt) {
  var key = evnt.key;
  if (key == '"\u007f') {
    key = '\b'
  }
  console.log(key)
  cli.event(myCli, key, term.write, term)
})


import { Terminal } from "@xterm/xterm/lib/xterm.js"
import * as cli from "cli"

var term = new Terminal();
term.open(document.getElementById('terminal'));

var myCli = cli.get_cli()

term.onData(function (key) {
  cli.event(myCli, key, term.write, term)
})

  cli.event(myCli, "startup", term.write, term)

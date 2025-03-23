# vim: set noexpandtab:

.PHONY:
build: dist

.PHONY:
build-addon: xterm.js/addons/addon-webgl/lib/addon-webgl.mjs

./xterm.js/addons/addon-webgl/src/AmethystModel.ts: model/amethyst.obj model/obj_to_js.rb
	./model/obj_to_js.rb $< $@

cli/pkg: cli/src/**rs ./cli/ascii/**
	cd cli && ~/.cargo/bin/wasm-pack build --target bundler

xterm.js/addons/addon-webgl/lib/addon-webgl.mjs: xterm.js/addons/addon-webgl/src/**ts ./xterm.js/addons/addon-webgl/src/AmethystModel.ts
	cd xterm.js && npm run esbuild

dist: index.html css/**  js/** xterm.js/addons/addon-webgl/lib/addon-webgl.mjs cli/pkg
	npm run build

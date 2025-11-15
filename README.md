# KillDoctorLuckyWeb
Like https://github.com/jmegner/KillDoctorLuckyGame but a web app instead of CLI.

## dev stuff

- You'll need to install [NodeJS+npm](https://nodejs.org/en/) for building and running.
- FUTURE RUST/WASM stuff not needed right now
  - Install [rust](https://www.rust-lang.org/tools/install) and [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) to build rust into wasm.
  - Might have to do `rustup target add wasm32-unknown-unknown` as well.
- For debugging and otherwise having a nice experience, this project is set up for vscode as the IDE.
- Initially, you'll have to do a `npm ci` to install npm packages with exact versions of previous development.
- Do a `npm run dev` to build the TypeScript stuff and run for dev purposes, not prod purposes.
- Open a browser to http://localhost:5173 .
- For debugging non-tests with vscode, be sure to do `npm run dev` before launching the debugger.
- For production stuff, `npm run build` will build to `dist/` folder.  I think `npm run preview` will run a
  http://localhost:5173 server based on the production build.

- If you are touching the main KDL web app, you should run `npm run build && npm run test` to make sure things compile and tests pass. If you are messing with scripts, image tools, or doing things like making random files that are not directly hooked up to the web app, you don't have to run the build & test stuff.
- If you are altering the web app, you should probably use Playwright to test out what you have done.
- The human often has a "npm run dev" already going and looking at the app at localhost:5173; feel free to piggyback on that.

When doing Rust code, look at AGENTS_RUST.md. When doing the TypeScript+React side, look at AGENTS_WEB.md.

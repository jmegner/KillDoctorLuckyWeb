When doing almost anything...

- You should run `npm run build && npm run test` to make sure things compile and tests pass.
- If your work affects the web app, you should probably use Playwright to test things out.
- The human almost always has a "npm run dev" already going and looking at the app at localhost:5173; feel free to piggyback on that.

When writing Rust code...

- When using the newtype idiom, do not implement `From<OldType> for NewType`.
- When porting a IEnumerable<T> method argument from C#, the Rust argument
  should usually be a `impl IntoIterator<Item = T>`, rather than something more
  fancy.
- When porting something immutable (like a C# record member), consider using
  `#[readonly::make]` to make Rust struct members read-only outside of the module.
- Prefer `let x = something.collect::<Vec<_>>();` over
  `let x: Vec<_> = something.collect();`, and not just for Vec, but anything you
  can `collect` into.
- It is okay to use and add crates like itertools, readonly, serde, and others.
  If you are doing something generic, take the time to ponder and search for a
  crate that would help.
- When asked to port Something.cs to something.rs, it is okay to make more rs
  files for further concepts you needed to bring over.
- You can build the cli with `npm run build:cli` and run the cli with
  `npm run cli`. Notice that the cli is a local executable. KdlRust\core gets
  compiled to wasm for the web app and gets compiled differently for the
  KdlRust\cli executable.

When writing the TypeScript+React side...

- @src/main.tsx does a `wasmBindgenInit().then(...)`, which makes sure that wasm is ready before anything else happens. Thus, you don't have to do anything more to make sure wasm is ready.
- Do not use useEffect; useEffect is synchronizing a React component with external systems (anything outside of React's state and props). We have no external systems. Everything is contained within our state and props.
- Most of the time you do not need useMemo. Most functions from KdlRust are very fast and you should not use useMemo to avoid these KdlRust functions. The one time where you can use useMemo is TreeSearch functions that explore potential game states to return good moves. If you think something else should use useMemo, skip the useMemo but tell me about it when you are summarizing your work to me in our chat, and you can do code comments like "//JME_LOOK_HERE: maybe useMemo this calc" in the code.

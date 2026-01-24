When doing almost anything...

- You should run `npm run build && npm run test:wasm` to make sure things compile and tests pass.

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

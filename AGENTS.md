When writing Rust code...

- When using the newtype idiom, do not implement `From<OldType> for NewType`.
- When porting a IEnumerable<T> method argument from C#, the Rust argument should usually be a `impl IntoIterator<Item = T>`, rather than something more fancy.
- When porting something immutable (like a C# record member), consider using `#[readonly::make]` to make Rust struct members read-only outside of the module.
- Prefer `let x = something.collect::<Vec<_>>();` over `let x: Vec<_> = something.collect();`, and not just for Vec, but anything you can `collect` into.
- It is okay to use and add crates like itertools, readonly, serde, and others. If you are doing something generic, take the time to ponder and search for a crate that would help.

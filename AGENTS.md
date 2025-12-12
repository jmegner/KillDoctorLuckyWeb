When writing Rust code...

- When using the newtype idiom, do not implement `From<OldType> for NewType`.
- When porting a IEnumerable<T> method argument from C#, the Rust argument should usually be a `impl IntoIterator<Item = T>`, rather than something more fancy.
- When porting something immutable (like a C# record member), consider using `#[readonly::make]` to make Rust struct members read-only outside of the module.

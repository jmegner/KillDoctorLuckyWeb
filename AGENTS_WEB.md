When writing the TypeScript+React side...

- @src/main.tsx does a `wasmBindgenInit().then(...)`, which makes sure that wasm is ready before anything else happens. Thus, you don't have to do anything more to make sure wasm is ready.
- Do not use useEffect; useEffect is synchronizing a React component with external systems (anything outside of React's state and props). We have no external systems. Everything is contained within our state and props.
- Most of the time you do not need useMemo. Most functions from KdlRust are very fast and you should not use useMemo to avoid these KdlRust functions. The one time where you can use useMemo is TreeSearch functions that explore potential game states to return good moves. If you think something else should use useMemo, skip the useMemo but tell me about it when you are summarizing your work to me in our chat, and you can do code comments like "//JME_LOOK_HERE: maybe useMemo this calc" in the code.

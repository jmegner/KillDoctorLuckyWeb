# Tree Search Profiling

This repo has a native profiling path for `TreeSearch::find_best_turn` that is set up for Windows Performance Toolkit.

## Why use the native bench

`tree_search_bench` calls the Rust implementation directly, so WPA can show native Rust frames and line information from the generated PDB. Profiling the browser build is still useful for end-to-end UX, but it is a worse first tool when the goal is to understand `TreeSearch::find_best_turn`.

## Build a profiling binary

From the repo root:

```powershell
./scripts/build-tree-search-profile.ps1
```

That builds:

- `src/KdlRust/target/x86_64-pc-windows-msvc/profiling/tree_search_bench.exe`
- `src/KdlRust/target/x86_64-pc-windows-msvc/profiling/tree_search_bench.pdb`

The build uses:

- Cargo `profiling` profile: optimized, debug info kept, symbols not stripped
- `RUSTFLAGS=-C force-frame-pointers=yes`: better stack walking for sampling

## Capture a trace

```powershell
./scripts/profile-tree-search.ps1
```

Default behavior:

- builds the profiling binary
- records a CPU sampling trace with `xperf`
- runs `tree_search_bench` for at least 15 seconds at analysis level 4
- writes artifacts under `src/KdlRust/target/profiling-traces`
- emits a text summary with symbolized CPU samples

Run it from an elevated PowerShell window. `xperf` CPU sampling needs administrator rights.

For manual convenience, the script can relaunch itself through UAC:

```powershell
./scripts/profile-tree-search.ps1 -SelfElevate
```

Useful options:

```powershell
./scripts/profile-tree-search.ps1 -AnalysisLevel 3 -MinSeconds 10
./scripts/profile-tree-search.ps1 -Scenario alt_down_after_opening -MinSeconds 20
./scripts/profile-tree-search.ps1 -OpenWpa
./scripts/profile-tree-search.ps1 -SelfElevate -OpenWpa
```

## Read the trace in WPA

Open the generated `.etl` in WPA.

Recommended tables:

- `Computation > CPU Usage (Sampled) > By Process, Thread, Stack`
- `Computation > CPU Usage (Sampled) > Flame by Process, Stack`

Focus on `tree_search_bench.exe`, then expand stacks until you reach `kill_doctor_lucky_rust::core::tree_search::TreeSearch::find_best_turn`.

## Symbol notes

The profiling script sets:

- `_NT_SYMBOL_PATH` to the local Rust output directory plus Microsoft public symbols
- `_NT_SYMCACHE_PATH` to `C:\SymCache`

If WPA opens without symbols, check:

1. the `.pdb` still sits next to `tree_search_bench.exe`
2. the trace came from the same machine that built the binary
3. the WPA symbol path includes `src/KdlRust/target/x86_64-pc-windows-msvc/profiling`

## Bench arguments

You can also run the target directly:

```powershell
cd src/KdlRust
cargo run --profile profiling --bin tree_search_bench --target x86_64-pc-windows-msvc -- --analysis-level 4 --min-seconds 10
```

Supported arguments:

- `--analysis-level <n>`
- `--scenario alt_down_start|alt_down_after_opening`
- `--min-iterations <n>`
- `--min-seconds <n>`
- `--warmup-iterations <n>`

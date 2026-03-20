[CmdletBinding()]
param(
    [string]$Target = "x86_64-pc-windows-msvc"
)

$ErrorActionPreference = "Stop"

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [Parameter()]
        [string[]]$ArgumentList = @()
    )

    & $FilePath @ArgumentList
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        $renderedArgs = $ArgumentList -join " "
        throw ("Command failed with exit code {0}: {1} {2}" -f $exitCode, $FilePath, $renderedArgs)
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$crateDir = Join-Path $repoRoot "src\KdlRust"
$manifestPath = Join-Path $crateDir "Cargo.toml"
$originalRustFlags = $env:RUSTFLAGS

try {
    $env:RUSTFLAGS = "-C force-frame-pointers=yes"
    Invoke-NativeCommand -FilePath "cargo" -ArgumentList @(
        "build",
        "--profile",
        "profiling",
        "--bin",
        "tree_search_bench",
        "--target",
        $Target,
        "--manifest-path",
        $manifestPath
    )
}
finally {
    $env:RUSTFLAGS = $originalRustFlags
}

$binaryDir = Join-Path $crateDir "target\$Target\profiling"
$exePath = Join-Path $binaryDir "tree_search_bench.exe"
$pdbPath = Join-Path $binaryDir "tree_search_bench.pdb"

if (-not (Test-Path $exePath)) {
    throw "Expected profiling executable at $exePath"
}

if (-not (Test-Path $pdbPath)) {
    throw "Expected profiling PDB at $pdbPath"
}

Write-Host "Built profiling target:"
Write-Host "  exe: $exePath"
Write-Host "  pdb: $pdbPath"

[CmdletBinding()]
param(
    [int]$AnalysisLevel = 4,
    [string]$Scenario = "alt_down_start",
    [int]$MinIterations = 1,
    [double]$MinSeconds = 15,
    [int]$WarmupIterations = 1,
    [string]$Target = "x86_64-pc-windows-msvc",
    [string]$TraceName,
    [switch]$OpenWpa,
    [switch]$SelfElevate
)

$ErrorActionPreference = "Stop"

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [Parameter()]
        [string[]]$ArgumentList = @(),

        [switch]$AllowNonZeroExit
    )

    & $FilePath @ArgumentList
    $exitCode = $LASTEXITCODE
    if (-not $AllowNonZeroExit -and $exitCode -ne 0) {
        $renderedArgs = $ArgumentList -join " "
        throw ("Command failed with exit code {0}: {1} {2}" -f $exitCode, $FilePath, $renderedArgs)
    }
}

function Test-KernelLoggerRunning {
    param(
        [Parameter(Mandatory = $true)]
        [string]$XperfPath
    )

    & $XperfPath -loggers "NT Kernel Logger" 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
}

function ConvertTo-SingleQuotedPowerShellLiteral {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Value
    )

    return "'" + $Value.Replace("'", "''") + "'"
}

function Get-SelfElevationEncodedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptPath,

        [Parameter(Mandatory = $true)]
        [hashtable]$BoundParameters
    )

    $segments = @("&", (ConvertTo-SingleQuotedPowerShellLiteral -Value $ScriptPath))

    foreach ($entry in $BoundParameters.GetEnumerator() | Sort-Object Key) {
        if ($entry.Key -eq "SelfElevate") {
            continue
        }

        $segments += "-$($entry.Key)"

        if ($entry.Value -is [switch]) {
            if (-not $entry.Value.IsPresent) {
                $segments = $segments[0..($segments.Count - 2)]
            }
            continue
        }

        if ($entry.Value -is [string]) {
            $segments += ConvertTo-SingleQuotedPowerShellLiteral -Value $entry.Value
            continue
        }

        if ($entry.Value -is [double]) {
            $segments += $entry.Value.ToString([System.Globalization.CultureInfo]::InvariantCulture)
            continue
        }

        $segments += $entry.Value.ToString()
    }

    $commandText = $segments -join " "
    $bytes = [System.Text.Encoding]::Unicode.GetBytes($commandText)
    return [Convert]::ToBase64String($bytes)
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    if ($SelfElevate) {
        $encodedCommand = Get-SelfElevationEncodedCommand -ScriptPath $PSCommandPath -BoundParameters $PSBoundParameters
        $process = Start-Process `
            -FilePath "powershell.exe" `
            -Verb RunAs `
            -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encodedCommand) `
            -Wait `
            -PassThru
        exit $process.ExitCode
    }

    throw "Run profile-tree-search.ps1 from an elevated PowerShell window. Windows CPU sampling traces require administrator rights."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$crateDir = Join-Path $repoRoot "src\KdlRust"
$buildScriptPath = Join-Path $PSScriptRoot "build-tree-search-profile.ps1"
$binaryDir = Join-Path $crateDir "target\$Target\profiling"
$exePath = Join-Path $binaryDir "tree_search_bench.exe"
$traceDir = Join-Path $crateDir "target\profiling-traces"
$symbolsDir = $binaryDir
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

if ([string]::IsNullOrWhiteSpace($TraceName)) {
    $TraceName = "tree-search-$timestamp"
}

$etlPath = Join-Path $traceDir "$TraceName.etl"
$summaryPath = Join-Path $traceDir "$TraceName-profile.txt"
$oldNtSymbolPath = $env:_NT_SYMBOL_PATH
$oldNtSymCachePath = $env:_NT_SYMCACHE_PATH
$symbolCacheDir = Join-Path $env:SystemDrive "SymCache"
$publicSymbolCacheDir = Join-Path $env:SystemDrive "symbols"

New-Item -ItemType Directory -Force -Path $traceDir | Out-Null
New-Item -ItemType Directory -Force -Path $symbolCacheDir | Out-Null
New-Item -ItemType Directory -Force -Path $publicSymbolCacheDir | Out-Null

& $buildScriptPath -Target $Target
if ($LASTEXITCODE -ne 0) {
    throw "Profiling build script failed."
}

$env:_NT_SYMBOL_PATH = "srv*$publicSymbolCacheDir*http://msdl.microsoft.com/download/symbols;$symbolsDir"
$env:_NT_SYMCACHE_PATH = $symbolCacheDir

$xperf = (Get-Command xperf.exe).Source
$wpa = (Get-Command wpa.exe).Source

$traceStarted = $false
$traceDumped = $false

if (Test-KernelLoggerRunning -XperfPath $xperf) {
    Invoke-NativeCommand -FilePath $xperf -ArgumentList @("-stop")
}

try {
    Invoke-NativeCommand -FilePath $xperf -ArgumentList @(
        "-on",
        "SysProf",
        "-stackwalk",
        "Profile",
        "-BufferSize",
        "1024",
        "-MinBuffers",
        "256",
        "-MaxBuffers",
        "1024"
    )
    $traceStarted = $true

    Invoke-NativeCommand -FilePath $exePath -ArgumentList @(
        "--analysis-level",
        $AnalysisLevel.ToString(),
        "--scenario",
        $Scenario,
        "--min-iterations",
        $MinIterations.ToString(),
        "--min-seconds",
        $MinSeconds.ToString([System.Globalization.CultureInfo]::InvariantCulture),
        "--warmup-iterations",
        $WarmupIterations.ToString()
    )

    Invoke-NativeCommand -FilePath $xperf -ArgumentList @("-d", $etlPath)
    $traceDumped = $true
    Invoke-NativeCommand -FilePath $xperf -ArgumentList @(
        "-i",
        $etlPath,
        "-o",
        $summaryPath,
        "-symbols",
        "-a",
        "profile",
        "-detail"
    )
}
finally {
    if ($traceStarted -and -not $traceDumped -and (Test-KernelLoggerRunning -XperfPath $xperf)) {
        Invoke-NativeCommand -FilePath $xperf -ArgumentList @("-stop")
    }

    $env:_NT_SYMBOL_PATH = $oldNtSymbolPath
    $env:_NT_SYMCACHE_PATH = $oldNtSymCachePath
}

Write-Host "Captured trace:"
Write-Host "  etl: $etlPath"
Write-Host "  summary: $summaryPath"
Write-Host "  symbols: $symbolsDir"

if ($OpenWpa) {
    Start-Process -FilePath $wpa -ArgumentList @($etlPath)
}

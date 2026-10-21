<#
.SYNOPSIS
    Spine asset pipeline for Windows, locally or on a Windows CI runner.

.DESCRIPTION
    Wraps the three gates this Power provides: lint exported data, run visual
    regression, and (with a licensed editor) batch export.

    Design notes that matter:
      * -Update pins the Spine editor build. The launcher updates itself, so
        without this the same commit produces different output over time.
      * Export requires a licensed Spine. The trial cannot save, pack or
        export, and the tooling reports that rather than failing obscurely.
      * Close the Spine editor before exporting. A running editor absorbs
        the CLI request and the command never returns.
      * Image and video export need a windowing system and OpenGL, so this
        script never attempts them; visual checks go through the headless
        renderer.

.PARAMETER Action
    lint, regression, export, or all.

.PARAMETER ExportDir
    Directory holding exported skeleton data and atlases.

.PARAMETER ProjectsDir
    Directory holding .spine projects. Only needed for -Action export.

.PARAMETER BaselineDir
    Parent directory of the per-animation visual regression baselines.

.PARAMETER Update
    Spine editor version to pin, e.g. 4.2.xx.

.PARAMETER FailOn
    Lint severity that fails the run: error (default), warning, or info.

.PARAMETER DryRun
    Print what would run without invoking anything.

.EXAMPLE
    ./Invoke-SpineCi.ps1 -Action lint -ExportDir export

.EXAMPLE
    ./Invoke-SpineCi.ps1 -Action all -ProjectsDir art -ExportDir export -Update 4.2.xx
#>

[CmdletBinding()]
param(
    [ValidateSet('lint', 'regression', 'export', 'all')]
    [string]$Action = 'lint',

    [string]$ExportDir = 'export',
    [string]$ProjectsDir = 'art',
    [string]$BaselineDir = 'baseline',
    [string]$DiffDir = 'regression-diff',
    [string]$Settings = 'templates/export-settings/ci-batch.export.json',
    [string]$Update = '4.2.xx',

    [ValidateSet('error', 'warning', 'info')]
    [string]$FailOn = 'error',

    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$script:ExitCode = 0

function Write-Step {
    param([string]$Message)
    Write-Host ''
    Write-Host "== $Message" -ForegroundColor Cyan
}

function Invoke-Ci {
    param([string[]]$Arguments)

    $display = "node dist/ci-cli.js $($Arguments -join ' ')"
    if ($DryRun) {
        Write-Host "[dry-run] $display" -ForegroundColor DarkGray
        return 0
    }

    Write-Host $display -ForegroundColor DarkGray
    & node 'dist/ci-cli.js' @Arguments
    return $LASTEXITCODE
}

function Assert-Built {
    if (-not (Test-Path 'dist/server.js')) {
        Write-Step 'Building the execution layer'
        if (-not $DryRun) {
            & npm run build
            if ($LASTEXITCODE -ne 0) { throw 'npm run build failed.' }
        }
    }
}

function Test-SpineLicensed {
    <#
        Reports whether a licensed editor is present. The probe is read-only
        and works on a trial, which is the point: it answers the licensing
        question before anything tries to write.
    #>
    if ($DryRun) { return $true }

    $probe = & node -e @'
const { createNodeHost } = require("./dist/host");
const { probeWithHost } = require("./dist/tools/env-tools");
const result = probeWithHost(createNodeHost());
process.stdout.write(JSON.stringify(result.ok ? result.data : { edition: "unknown" }));
'@

    try {
        $parsed = $probe | ConvertFrom-Json
        Write-Host "Spine edition: $($parsed.edition)" -ForegroundColor DarkGray
        return $parsed.edition -eq 'licensed'
    }
    catch {
        Write-Warning 'Could not determine the Spine edition.'
        return $false
    }
}

Assert-Built

if ($Action -in @('export', 'all')) {
    Write-Step 'Export'

    if (-not (Test-SpineLicensed)) {
        Write-Warning @'
Export needs a licensed Spine editor. The trial cannot save projects, pack
texture atlases, or export data. Skipping the export step; the lint and
regression gates still run against the committed artifacts.
'@
    }
    else {
        $code = Invoke-Ci @(
            'export',
            '--projects-dir', $ProjectsDir,
            '--out-dir', $ExportDir,
            '--settings', $Settings,
            '--update', $Update
        )
        if ($code -ne 0) {
            Write-Error "Export failed with exit code $code."
            $script:ExitCode = $code
        }
    }
}

if ($Action -in @('lint', 'all')) {
    Write-Step "Lint (failing on $FailOn)"
    $code = Invoke-Ci @(
        'lint',
        '--export-dir', $ExportDir,
        '--rules', 'templates/lint-rules/naming.json',
        '--rules', 'templates/lint-rules/budgets.json',
        '--fail-on', $FailOn
    )
    if ($code -ne 0) {
        Write-Host 'Lint gate failed.' -ForegroundColor Red
        $script:ExitCode = $code
    }
}

if ($Action -in @('regression', 'all')) {
    Write-Step 'Visual regression'
    $code = Invoke-Ci @(
        'regression',
        '--export-dir', $ExportDir,
        '--baseline-dir', $BaselineDir,
        '--diff-dir', $DiffDir
    )
    if ($code -ne 0) {
        Write-Host "Visual regression failed. Diff images: $DiffDir" -ForegroundColor Red
        $script:ExitCode = $code
    }
}

Write-Host ''
if ($script:ExitCode -eq 0) {
    Write-Host 'All requested gates passed.' -ForegroundColor Green
}
else {
    Write-Host "One or more gates failed (exit $($script:ExitCode))." -ForegroundColor Red
}

exit $script:ExitCode

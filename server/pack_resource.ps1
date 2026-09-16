#requires -Version 5.1
<#
.SYNOPSIS
    Pack the "resource" folder into resource.tar.gz next to it.

.DESCRIPTION
    Default: source  = <script folder>\resource
             output  = <script folder>\resource.tar.gz
    Uses tar.exe (built into Windows 10 1803+) when available,
    otherwise falls back to 7-Zip.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\pack_resource.ps1
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\pack_resource.ps1 -Source D:\Project\astrbot_plugin_dailycarddraw\server\resource
#>
[CmdletBinding()]
param(
    [string]$Source = (Join-Path $PSScriptRoot 'resource'),
    [string]$Output = (Join-Path $PSScriptRoot 'resource.tar.gz')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    throw "Source folder not found: $Source"
}

$sourceItem = Get-Item -LiteralPath $Source
$parentDir  = $sourceItem.Parent.FullName
$folderName = $sourceItem.Name

$outputFull = [System.IO.Path]::GetFullPath($Output)
$outputDir  = [System.IO.Path]::GetDirectoryName($outputFull)
if (-not (Test-Path -LiteralPath $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}
if (Test-Path -LiteralPath $outputFull) {
    Remove-Item -LiteralPath $outputFull -Force
}

$tarCmd = Get-Command tar -ErrorAction SilentlyContinue
if ($tarCmd) {
    Write-Host "Using tar: $($tarCmd.Source)"
    & $tarCmd.Source -czf $outputFull -C $parentDir $folderName
    if ($LASTEXITCODE -ne 0) {
        throw "tar failed with exit code $LASTEXITCODE"
    }
}
else {
    $sevenZip = @(
        'C:\Program Files\7-Zip\7z.exe',
        'C:\Program Files (x86)\7-Zip\7z.exe'
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

    if (-not $sevenZip) {
        throw "Neither tar.exe nor 7-Zip was found. Install 7-Zip or run on Windows 10 1803+."
    }

    Write-Host "tar.exe not found, using 7-Zip: $sevenZip"
    $tmpTar = [System.IO.Path]::ChangeExtension($outputFull, '.tar')
    if (Test-Path -LiteralPath $tmpTar) {
        Remove-Item -LiteralPath $tmpTar -Force
    }

    & $sevenZip a -ttar $tmpTar $Source | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "7-Zip (tar) failed with exit code $LASTEXITCODE"
    }

    & $sevenZip a -tgzip $outputFull $tmpTar | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "7-Zip (gzip) failed with exit code $LASTEXITCODE"
    }

    Remove-Item -LiteralPath $tmpTar -Force
}

$info = Get-Item -LiteralPath $outputFull
Write-Host ("Created: {0} ({1:N2} MB)" -f $info.FullName, ($info.Length / 1MB))

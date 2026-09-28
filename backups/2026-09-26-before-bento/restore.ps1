$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$savePath = Join-Path $repoRoot ('backups/before-restore-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
$files = @('index.html', 'assets/js/main.js', 'assets/js/ui-sounds.js')
foreach ($relative in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $relative))) { throw "Snapshot file missing: $relative" }
}
foreach ($relative in $files) {
    $savedFile = Join-Path $savePath $relative
    New-Item -ItemType Directory -Force -Path (Split-Path $savedFile) | Out-Null
    Copy-Item -LiteralPath (Join-Path $repoRoot $relative) -Destination $savedFile
}
foreach ($relative in $files) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $relative) -Destination (Join-Path $repoRoot $relative)
}
Write-Output "Previous homepage restored. The outgoing version is saved at $savePath"

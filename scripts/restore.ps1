# Restores a dump: pg_restore --clean --if-exists. Usage: scripts\restore.ps1 [backup\opshub-<timestamp>.dump]
param([string]$File)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$url = $env:DATABASE_ADMIN_URL
if (-not $url -and (Test-Path .env)) {
  $line = Select-String -Path .env -Pattern '^DATABASE_ADMIN_URL=' | Select-Object -First 1
  if ($line) { $url = $line.Line.Substring($line.Line.IndexOf('=') + 1) }
}
if (-not $url) { throw "DATABASE_ADMIN_URL is not set (env or .env)" }
if (-not (Get-Command pg_restore -ErrorAction SilentlyContinue)) { throw "pg_restore not found. Install PostgreSQL client tools." }
if (-not $File) { $File = (Get-ChildItem backup\opshub-*.dump -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName }
if (-not $File -or -not (Test-Path $File)) { throw "No dump file found. Pass one as the first argument." }

Write-Host "Restoring $File (existing objects are dropped first)..."
pg_restore --clean --if-exists --no-owner --exit-on-error --dbname="$url" "$File"
if ($LASTEXITCODE -ne 0) { throw "pg_restore failed" }
Write-Host "Restore complete."

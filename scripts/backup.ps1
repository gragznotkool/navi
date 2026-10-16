# Creates backup\opshub-<timestamp>.dump with `pg_dump -Fc` using DATABASE_ADMIN_URL (env or repo .env).
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$url = $env:DATABASE_ADMIN_URL
if (-not $url -and (Test-Path .env)) {
  $line = Select-String -Path .env -Pattern '^DATABASE_ADMIN_URL=' | Select-Object -First 1
  if ($line) { $url = $line.Line.Substring($line.Line.IndexOf('=') + 1) }
}
if (-not $url) { throw "DATABASE_ADMIN_URL is not set (env or .env)" }
if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) { throw "pg_dump not found. Install PostgreSQL client tools." }

New-Item -ItemType Directory -Force backup | Out-Null
$out = "backup\opshub-$(Get-Date -Format 'yyyyMMdd-HHmmss').dump"
pg_dump -Fc --no-owner --dbname="$url" --file="$out"
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
Write-Host "Backup written to $out ($((Get-Item $out).Length) bytes)"

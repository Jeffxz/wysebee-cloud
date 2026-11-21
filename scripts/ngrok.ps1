# Expose the local wysebee-cloud (localhost:$WEB_PORT, default 8000) through ngrok on
# Windows, at the public URL it is configured for. ASCII only (Windows PowerShell 5.1).
#
#   .\scripts\ngrok.ps1         # ngrok http 8000 --url $CLOUD_PUBLIC_URL
#
# The Windows twin of scripts/ngrok.sh. The URL comes from CLOUD_PUBLIC_URL - in the
# environment, or else in .env (git-ignored, so the domain stays out of the repository),
# e.g. https://<your-tunnel>.ngrok.dev. Sign-in needs no tunnel: Auth0 is hosted. Its
# applications must list this URL's callbacks (README, "Sign-in (Auth0)"). Extra
# arguments go to ngrok.
#
# Needs: ngrok v3, signed in once (`ngrok config add-authtoken <token>`), with the domain
# reserved in that account.
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

# Read one variable from .env without running the file: the last KEY=value, quotes off.
function Get-EnvFileValue([string]$Name) {
    $envFile = Join-Path $repoRoot ".env"
    if (-not (Test-Path $envFile)) { return "" }
    $value = ""
    foreach ($line in Get-Content $envFile) {
        if ($line -match "^\s*$([regex]::Escape($Name))=(.*)$") { $value = $Matches[1] }
    }
    return $value.Trim().Trim('"', "'")
}
function Get-Setting([string]$Name, [string]$Default = "") {
    $value = [Environment]::GetEnvironmentVariable($Name)
    if (-not $value) { $value = Get-EnvFileValue $Name }
    if (-not $value) { $value = $Default }
    return $value
}

$extra = @($args)
if ($extra.Count -gt 0 -and $extra[0] -in @("-h", "--help", "-Help")) {
    Get-Content $PSCommandPath | Where-Object { $_ -match "^#" } | Select-Object -First 13 |
        ForEach-Object { $_ -replace "^# ?", "" }
    exit 0
}

if (-not (Get-Command ngrok -ErrorAction SilentlyContinue)) {
    [Console]::Error.WriteLine("ngrok is not installed: https://ngrok.com/download")
    exit 1
}

$url = Get-Setting "CLOUD_PUBLIC_URL"
$port = Get-Setting "WEB_PORT" "8000"
if (-not $url) {
    [Console]::Error.WriteLine("CLOUD_PUBLIC_URL is not set: add it to .env (see .env.example).")
    exit 1
}
try {
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://localhost:$port/api/health" | Out-Null
}
catch {
    [Console]::Error.WriteLine("warning: nothing answering on localhost:$port yet (.\scripts\dev_up.ps1).")
}
Write-Host "Tunnelling $url -> http://localhost:$port"
& ngrok http $port --url $url @extra
exit $LASTEXITCODE

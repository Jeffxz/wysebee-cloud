# Start the local stack on Windows - PostgreSQL and the web app - with docker compose.
# Sign-in is Auth0, hosted (WYSEBEE_AUTH_* in .env), or the local mock
# (WYSEBEE_AUTH_MOCK=true). ASCII only (Windows PowerShell 5.1).
#
#   .\scripts\dev_up.ps1            # build, start in the background, wait until healthy
#   .\scripts\dev_up.ps1 -Ngrok     # ...then run the ngrok tunnel (scripts\ngrok.ps1)
#   .\scripts\dev_up.ps1 -Logs      # ...then follow the web app's logs
#   .\scripts\dev_up.ps1 -Down      # stop everything (data is kept in the volumes)
#
# The Windows twin of scripts/dev_up.sh. Not to be confused with scripts/start.sh, the
# container's own entrypoint. Settings come from .env (copied from .env.example the
# first time).
param(
    [switch]$Ngrok,
    [switch]$Logs,
    [switch]$Down,
    [switch]$Help
)
$ErrorActionPreference = "Stop"

function Say([string]$Message) { Write-Host "[dev] $Message" }
function Die([string]$Message) { [Console]::Error.WriteLine("error: $Message"); exit 1 }

# True when a native command exits 0. Its output is dropped, and stderr does not turn
# into an error (Windows PowerShell 5.1 does that under "Stop").
function Test-Native([scriptblock]$Block) {
    $saved = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { & $Block *> $null; return ($LASTEXITCODE -eq 0) } catch { return $false }
    finally { $ErrorActionPreference = $saved }
}

# Read one variable from .env without running the file: the last KEY=value, quotes off.
function Get-EnvFileValue([string]$Name) {
    if (-not (Test-Path ".env")) { return "" }
    $value = ""
    foreach ($line in Get-Content ".env") {
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

if ($Help) {
    Get-Content $PSCommandPath | Where-Object { $_ -match "^#" } | Select-Object -First 12 |
        ForEach-Object { $_ -replace "^# ?", "" }
    exit 0
}

Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Die "Docker is not installed." }
    if ($Down) {
        & docker compose down
        exit $LASTEXITCODE
    }
    if (-not (Test-Native { docker info })) {
        Die "Docker is not running. Start Docker Desktop, then try again."
    }

    if (-not (Test-Path ".env")) {
        Copy-Item ".env.example" ".env"
        Say "created .env from .env.example"
    }

    Say "building and starting (this waits until every service is healthy)"
    & docker compose up -d --build --wait --remove-orphans
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $webPort = Get-Setting "WEB_PORT" "8000"
    $authIssuer = Get-Setting "WYSEBEE_AUTH_ISSUER"
    $authMock = Get-Setting "WYSEBEE_AUTH_MOCK"
    if ($authMock -eq "true" -and -not $authIssuer) {
        $authIssuer = "http://localhost:$webPort/mock-auth/ (mock: no Auth0 account)"
    }
    if (-not $authIssuer) { $authIssuer = "off - set WYSEBEE_AUTH_* in .env (see .env.example)" }

    Write-Host ""
    Say "up:"
    Write-Host "  web app    http://localhost:$webPort   (your agents: /app/)"
    Write-Host "  sign-in    $authIssuer"
    Write-Host "  logs       docker compose logs -f web"
    Write-Host "  stop       .\scripts\dev_up.ps1 -Down"

    if ($Ngrok) {
        Write-Host ""
        & (Join-Path $PSScriptRoot "ngrok.ps1")
        exit $LASTEXITCODE
    }
    if ($Logs) {
        & docker compose logs -f web
        exit $LASTEXITCODE
    }
}
finally {
    Pop-Location
}

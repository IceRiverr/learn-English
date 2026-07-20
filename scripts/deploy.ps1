$ErrorActionPreference = "Stop"

$projectDirectory = Split-Path -Parent $PSScriptRoot
$bundledPnpm = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue

if ($pnpmCommand) {
    $pnpm = $pnpmCommand.Source
} elseif (Test-Path -LiteralPath $bundledPnpm) {
    $pnpm = $bundledPnpm
} else {
    throw "pnpm was not found. Install Node.js and pnpm first."
}

$ssh = "C:\Windows\System32\OpenSSH\ssh.exe"
$scp = "C:\Windows\System32\OpenSSH\scp.exe"
$remote = "root@8.210.175.90"
$remoteDirectory = "/var/www/learn.iceriver.cc"

if (-not (Test-Path -LiteralPath $ssh) -or -not (Test-Path -LiteralPath $scp)) {
    throw "Windows OpenSSH client was not found."
}

Push-Location $projectDirectory
try {
    & $pnpm build
    if ($LASTEXITCODE -ne 0) {
        throw "Build failed. Deployment stopped."
    }

    & $ssh -o BatchMode=yes $remote "install -d -m 755 $remoteDirectory"
    if ($LASTEXITCODE -ne 0) {
        throw "Could not connect to the server or create the deployment directory."
    }

    & $scp -o BatchMode=yes -r "dist/." "${remote}:${remoteDirectory}/"
    if ($LASTEXITCODE -ne 0) {
        throw "Upload failed."
    }

    Write-Host "Deployment complete: https://learn.iceriver.cc" -ForegroundColor Green
} finally {
    Pop-Location
}

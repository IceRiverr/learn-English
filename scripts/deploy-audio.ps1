$ErrorActionPreference = "Stop"

$projectDirectory = Split-Path -Parent $PSScriptRoot
$audioDirectory = Join-Path $projectDirectory "audio"
$bundledPnpm = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
$bundledNodeDirectory = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue

if (Test-Path -LiteralPath $bundledPnpm) {
    $pnpm = $bundledPnpm
} elseif ($pnpmCommand) {
    $pnpm = $pnpmCommand.Source
} else {
    throw "pnpm was not found. Install Node.js and pnpm first."
}
$ssh = "C:\Windows\System32\OpenSSH\ssh.exe"
$scp = "C:\Windows\System32\OpenSSH\scp.exe"
$remote = "root@8.210.175.90"
$remoteDirectory = "/var/www/learn.iceriver.cc"
$remoteManifestPath = "$remoteDirectory/.audio-manifest.sha256"
$stagingDirectory = Join-Path $projectDirectory ".deploy-audio-staging-$([Guid]::NewGuid().ToString('N'))"

if (-not (Test-Path -LiteralPath $ssh) -or -not (Test-Path -LiteralPath $scp)) {
    throw "Windows OpenSSH client was not found."
}

$originalProcessPath = $env:Path
if (Test-Path -LiteralPath (Join-Path $bundledNodeDirectory "node.exe")) {
    $env:Path = "$bundledNodeDirectory;$originalProcessPath"
}
Push-Location $projectDirectory
try {
    & $pnpm exec node scripts/validate-content.mjs --require-audio
    if ($LASTEXITCODE -ne 0) {
        throw "Content or audio validation failed. Deployment stopped."
    }
} finally {
    Pop-Location
    $env:Path = $originalProcessPath
}

$audioFiles = @(Get-ChildItem -LiteralPath $audioDirectory -Recurse -File -Filter "*.mp3" | Sort-Object FullName)
if ($audioFiles.Count -eq 0) {
    throw "No MP3 files were found under $audioDirectory."
}

& $ssh -o BatchMode=yes $remote "install -d -m 755 $remoteDirectory"
if ($LASTEXITCODE -ne 0) {
    throw "Could not connect to the server or create the deployment directory."
}

$inventoryCommand = "cd $remoteDirectory && { if test -f $remoteManifestPath; then cat $remoteManifestPath; else find . -type f -name '*.mp3' -exec sha256sum {} \;; fi; } | base64 -w0"
$encodedInventory = (@(& $ssh -o BatchMode=yes $remote $inventoryCommand) -join "").Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Could not read the remote audio inventory."
}
$remoteInventory = if ($encodedInventory) {
    [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encodedInventory)) -split "`r?`n"
} else {
    @()
}

$remoteHashes = @{}
foreach ($line in $remoteInventory) {
    if ($line -match "^(?<hash>[0-9a-fA-F]{64})(?:`t|  )(?<path>.+)$") {
        $relativePath = $Matches.path.Trim().TrimStart("*")
        if ($relativePath.StartsWith("./")) {
            $relativePath = $relativePath.Substring(2)
        }
        $remoteHashes[$relativePath] = $Matches.hash.ToUpperInvariant()
    }
}

$localManifest = [System.Collections.Generic.List[string]]::new()
$changedFiles = [System.Collections.Generic.List[object]]::new()
foreach ($audioFile in $audioFiles) {
    $relativePath = "audio/" + [IO.Path]::GetRelativePath($audioDirectory, $audioFile.FullName).Replace("\", "/")
    $hash = (Get-FileHash -LiteralPath $audioFile.FullName -Algorithm SHA256).Hash.ToUpperInvariant()
    $localManifest.Add("$hash`t$relativePath")
    if (-not $remoteHashes.ContainsKey($relativePath) -or $remoteHashes[$relativePath] -ne $hash) {
        $changedFiles.Add([pscustomobject]@{
            File = $audioFile
            RelativePath = $relativePath
        })
    }
}

$projectRoot = [IO.Path]::GetFullPath($projectDirectory).TrimEnd("\") + "\"
$stagingRoot = [IO.Path]::GetFullPath($stagingDirectory)
if (-not $stagingRoot.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase) -or
    -not (Split-Path -Leaf $stagingRoot).StartsWith(".deploy-audio-staging-")) {
    throw "Refusing to use an unsafe staging directory: $stagingRoot"
}

try {
    if ($changedFiles.Count -gt 0) {
        New-Item -ItemType Directory -Path $stagingDirectory | Out-Null
        foreach ($item in $changedFiles) {
            $destination = Join-Path $stagingDirectory $item.RelativePath.Replace("/", "\")
            $destinationParent = Split-Path -Parent $destination
            New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
            try {
                New-Item -ItemType HardLink -Path $destination -Target $item.File.FullName | Out-Null
            } catch {
                Copy-Item -LiteralPath $item.File.FullName -Destination $destination
            }
            Write-Host "Changed: $($item.RelativePath)"
        }

        & $scp -o BatchMode=yes -r "$stagingDirectory/." "${remote}:${remoteDirectory}/"
        if ($LASTEXITCODE -ne 0) {
            throw "Audio upload failed. The remote manifest was not updated."
        }
    }

    if (-not (Test-Path -LiteralPath $stagingDirectory)) {
        New-Item -ItemType Directory -Path $stagingDirectory | Out-Null
    }
    $manifestPath = Join-Path $stagingDirectory ".audio-manifest.sha256"
    [IO.File]::WriteAllLines($manifestPath, $localManifest, [Text.UTF8Encoding]::new($false))
    & $scp -o BatchMode=yes $manifestPath "${remote}:${remoteManifestPath}"
    if ($LASTEXITCODE -ne 0) {
        throw "Audio files were uploaded, but the remote manifest could not be updated."
    }

    Write-Host "Incremental audio deployment complete: $($changedFiles.Count) of $($audioFiles.Count) MP3 files uploaded." -ForegroundColor Green
} finally {
    if (Test-Path -LiteralPath $stagingDirectory) {
        $resolvedStaging = [IO.Path]::GetFullPath($stagingDirectory)
        if ($resolvedStaging.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase) -and
            (Split-Path -Leaf $resolvedStaging).StartsWith(".deploy-audio-staging-")) {
            Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
        }
    }
}

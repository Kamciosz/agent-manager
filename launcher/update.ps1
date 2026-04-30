$ErrorActionPreference = 'Stop'

# Skrypt leży w launcher/, ale działamy na głównym katalogu repo.
$RootDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$UpdateZipUrl = if ($env:AGENT_MANAGER_UPDATE_ZIP_URL) { $env:AGENT_MANAGER_UPDATE_ZIP_URL } else { 'https://github.com/Kamciosz/agent-manager/archive/refs/heads/main.zip' }

function Write-UpdateLog([string] $Message) { Write-Host "[update] $Message" }
function Write-UpdateWarn([string] $Message) { Write-Host "[warn] $Message" -ForegroundColor Yellow }

function Invoke-RobocopyChecked([string[]] $Args) {
  & robocopy @Args | Out-Host
  $code = $LASTEXITCODE
  if ($code -gt 7) { throw "robocopy failed with exit code $code" }
  $global:LASTEXITCODE = 0
}

function Invoke-GitUpdateIfPossible {
  $git = Get-Command git -ErrorAction SilentlyContinue
  if (-not $git) { return $false }

  & git -C $RootDir rev-parse --is-inside-work-tree > $null 2>&1
  if ($LASTEXITCODE -ne 0) { return $false }

  $status = & git -C $RootDir status --porcelain
  if ($status) {
    Write-UpdateWarn 'Git update skipped: local changes exist. Commit/stash them or update manually.'
    return $true
  }

  $branch = (& git -C $RootDir rev-parse --abbrev-ref HEAD).Trim()
  if ($branch -eq 'HEAD') {
    Write-UpdateWarn 'Git update skipped: repository is in detached HEAD.'
    return $true
  }

  Write-UpdateLog 'Running git pull --ff-only.'
  & git -C $RootDir pull --ff-only
  if ($LASTEXITCODE -eq 0) {
    Write-UpdateLog 'Git repository updated.'
  } else {
    Write-UpdateWarn 'git pull --ff-only failed. Local files were not changed.'
  }
  return $true
}

function Invoke-ZipUpdate {
  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("agent-manager-update-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  try {
    $zipFile = Join-Path $tempRoot 'main.zip'
    Write-UpdateLog 'This is not a git repository, downloading the latest code from GitHub.'
    Invoke-WebRequest -Uri $UpdateZipUrl -OutFile $zipFile -UseBasicParsing
    Expand-Archive -Path $zipFile -DestinationPath $tempRoot -Force

    $sourceRoot = Get-ChildItem -Path $tempRoot -Directory | Where-Object { $_.Name -ne '__MACOSX' } | Select-Object -First 1
    if (-not $sourceRoot) { throw 'Downloaded archive did not contain a source directory.' }

    Invoke-RobocopyChecked @(
      $sourceRoot.FullName,
      $RootDir,
      '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP',
      '/XD', '.git', 'local-ai-proxy'
    )

    $sourceProxy = Join-Path $sourceRoot.FullName 'local-ai-proxy'
    $targetProxy = Join-Path $RootDir 'local-ai-proxy'
    if (Test-Path $sourceProxy) {
      Invoke-RobocopyChecked @(
        $sourceProxy,
        $targetProxy,
        '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP',
        '/XD', 'bin', 'models', 'logs',
        '/XF', 'config.json'
      )
    }

    Write-UpdateLog 'ZIP update finished. Preserved config.json, models, binaries and logs.'
  } finally {
    Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Set-Location $RootDir
if (-not (Invoke-GitUpdateIfPossible)) {
  Invoke-ZipUpdate
}

exit 0

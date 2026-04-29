# ============================================================================
#  start.ps1 - Windows local AI runtime for Agent Manager
#  Real launcher logic lives here; start.bat is only a small wrapper.
# ============================================================================

param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $ScriptArgs
)

$ErrorActionPreference = 'Stop'

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ScriptPath = $MyInvocation.MyCommand.Path
$ProxyDir = Join-Path $RootDir 'local-ai-proxy'
$BinDir = Join-Path $ProxyDir 'bin'
$ModelsDir = Join-Path $ProxyDir 'models'
$LogsDir = Join-Path $ProxyDir 'logs'
$ConfigFile = Join-Path $ProxyDir 'config.json'

$LlamaPort = 8080
$ProxyPort = 3001
$DefaultSupabaseUrl = ''
$DefaultSupabaseKey = ''
$DefaultAppOrigin = 'https://kamciosz.github.io'
$PortableNodeVersion = '22.11.0'
$NodeExecutable = ''

$ChangeModel = $false
$AdvancedConfig = $false
$ConfigMode = $false
$ScheduleConfig = $false
$NoPull = $false
$UpdateNow = $false
$ShowHelp = $false
$DoctorMode = $false
$TranscriptStarted = $false

foreach ($arg in $ScriptArgs) {
  switch -Regex ($arg) {
    '^--change-model$' { $ChangeModel = $true; break }
    '^--advanced$' { $AdvancedConfig = $true; $ScheduleConfig = $true; break }
    '^--config$' { $ConfigMode = $true; $AdvancedConfig = $true; $ScheduleConfig = $true; break }
    '^--schedule$' { $ScheduleConfig = $true; break }
    '^--doctor$' { $DoctorMode = $true; break }
    '^--update$' { $UpdateNow = $true; break }
    '^--reset$' { if (Test-Path $ConfigFile) { Remove-Item -LiteralPath $ConfigFile -Force }; Write-Host '[start] Removed config.json.'; break }
    '^--no-pull$' { $NoPull = $true; break }
    '^-h$|^--help$' { $ShowHelp = $true; break }
  }
}

function Write-StartLog([string] $Message) { Write-Host "[start] $Message" -ForegroundColor Cyan }
function Write-StartWarn([string] $Message) { Write-Host "[warn] $Message" -ForegroundColor Yellow }
function Write-StartErr([string] $Message) { Write-Host "[err] $Message" -ForegroundColor Red }

function Show-Help {
  @'
Agent Manager local AI runtime for Windows

Usage:
  start.bat [flags]
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 [flags]

Flags:
  --change-model   ask for a GGUF model again
  --advanced       configure parallel slots, experimental SD and schedule
  --config         open terminal workstation/runtime configuration
  --schedule       configure only runtime schedule
  --doctor         run safe diagnostics without downloads, prompts or services
  --update         run safe git pull --ff-only before startup
  --reset          remove local-ai-proxy\config.json and ask again
  --no-pull        skip downloads, useful for offline tests
  --no-pause       consumed by start.bat wrapper
'@ | Write-Host
}

if ($ShowHelp) {
  Show-Help
  exit 0
}

function Ensure-WorkspaceDirs {
  New-Item -ItemType Directory -Force -Path $BinDir, $ModelsDir, $LogsDir | Out-Null
}

function Start-LauncherTranscript {
  Start-Transcript -Path (Join-Path $LogsDir 'start-windows.log') -Append | Out-Null
  $script:TranscriptStarted = $true
}

function Assert-Command([string] $Name, [string] $Hint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name. $Hint"
  }
}

function Get-NodeMajorVersion([string] $NodePath) {
  try {
    $version = (& $NodePath --version 2>$null | Select-Object -First 1)
    if ($version -match '^v(\d+)\.') { return [int] $matches[1] }
  } catch {}
  return 0
}

function Use-NodeExecutable([string] $NodePath, [string] $SourceLabel) {
  $script:NodeExecutable = $NodePath
  $nodeDir = Split-Path -Parent $NodePath
  $pathParts = @($env:PATH -split ';' | Where-Object { $_ })
  if ($pathParts -notcontains $nodeDir) {
    $env:PATH = "$nodeDir;$env:PATH"
  }
  $version = (& $NodePath --version 2>$null | Select-Object -First 1)
  Write-StartLog "Node.js ready: $version ($SourceLabel)"
}

function Get-PortableNodeArch {
  $arch = $env:PROCESSOR_ARCHITEW6432
  if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
  if ($arch -eq 'ARM64') { return 'arm64' }
  return 'x64'
}

function Get-LocalNodeExecutable {
  if (-not (Test-Path -LiteralPath $BinDir)) { return $null }
  $known = Join-Path $BinDir ("node-v{0}-win-{1}\node.exe" -f $PortableNodeVersion, (Get-PortableNodeArch))
  if (Test-Path -LiteralPath $known) { return $known }
  $found = Get-ChildItem -LiteralPath $BinDir -Recurse -File -Filter 'node.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\node-v\d+\.\d+\.\d+-win-' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($found) { return $found.FullName }
  return $null
}

function Install-PortableNode {
  if ($NoPull) {
    throw 'Node.js was not found and --no-pull prevents downloading portable Node. Install Node.js 18+ or run start.bat without --no-pull once.'
  }
  $arch = Get-PortableNodeArch
  $version = $PortableNodeVersion
  $folderName = "node-v$version-win-$arch"
  $targetDir = Join-Path $BinDir $folderName
  $targetExe = Join-Path $targetDir 'node.exe'
  if (Test-Path -LiteralPath $targetExe) { return $targetExe }

  $zip = Join-Path $BinDir ("_node-$version-win-$arch.zip")
  $url = "https://nodejs.org/dist/v$version/$folderName.zip"
  if ($env:AGENT_MANAGER_NODE_ZIP_URI) { $url = $env:AGENT_MANAGER_NODE_ZIP_URI }

  Write-StartWarn 'Node.js 18+ was not found in PATH. Downloading portable Node.js locally; administrator rights are not needed.'
  Write-StartLog "Downloading Node.js: $url"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  Expand-Archive -LiteralPath $zip -DestinationPath $BinDir -Force
  Remove-Item -LiteralPath $zip -Force

  if (Test-Path -LiteralPath $targetExe) { return $targetExe }
  $found = Get-ChildItem -LiteralPath $BinDir -Recurse -File -Filter 'node.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { return $found.FullName }
  throw "Portable Node.js was extracted, but node.exe was not found under $BinDir"
}

function Ensure-NodeRuntime {
  $systemNode = Get-Command node -ErrorAction SilentlyContinue
  if ($systemNode) {
    $systemPath = $systemNode.Source
    if ((Get-NodeMajorVersion $systemPath) -ge 18) {
      Use-NodeExecutable $systemPath 'system PATH'
      return
    }
    Write-StartWarn "System Node.js is older than 18: $systemPath. A portable Node.js will be used instead."
  }

  $localNode = Get-LocalNodeExecutable
  if ($localNode -and (Get-NodeMajorVersion $localNode) -ge 18) {
    Use-NodeExecutable $localNode 'portable local-ai-proxy\bin'
    return
  }

  $installedNode = Install-PortableNode
  if ((Get-NodeMajorVersion $installedNode) -lt 18) {
    throw "Downloaded Node.js is too old or cannot run: $installedNode"
  }
  Use-NodeExecutable $installedNode 'portable local-ai-proxy\bin'
}

function Get-NodeExecutable {
  if ($script:NodeExecutable) { return $script:NodeExecutable }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) { return $node.Source }
  return 'node'
}

function Read-Config {
  if (-not (Test-Path -LiteralPath $ConfigFile)) {
    return [pscustomobject]@{}
  }
  $raw = Get-Content -LiteralPath $ConfigFile -Raw
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return [pscustomobject]@{}
  }
  return $raw | ConvertFrom-Json
}

function Set-ConfigValue([object] $Config, [string] $Name, $Value) {
  if ($null -eq $Config.PSObject.Properties[$Name]) {
    $Config | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
  } else {
    $Config.$Name = $Value
  }
}

function Save-Config([object] $Config) {
  $Config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ConfigFile -Encoding UTF8
}

function Get-ConfigString([object] $Config, [string] $Name, [string] $Fallback = '') {
  if ($null -eq $Config.PSObject.Properties[$Name] -or $null -eq $Config.$Name) { return $Fallback }
  return [string] $Config.$Name
}

function Get-ConfigBool([object] $Config, [string] $Name, [bool] $Fallback = $false) {
  if ($null -eq $Config.PSObject.Properties[$Name] -or $null -eq $Config.$Name) { return $Fallback }
  $value = $Config.$Name
  if ($value -is [bool]) { return $value }
  $raw = ([string] $value).Trim().ToLowerInvariant()
  if ($raw -in @('true', '1', 'yes', 'y', 'tak', 't')) { return $true }
  if ($raw -in @('false', '0', 'no', 'n', 'nie', '')) { return $false }
  return $Fallback
}

function Get-ConfigInt([object] $Config, [string] $Name, [int] $Fallback, [int] $Min, [int] $Max) {
  if ($null -eq $Config.PSObject.Properties[$Name] -or $null -eq $Config.$Name) { return $Fallback }
  $parsed = 0
  if (-not [int]::TryParse([string] $Config.$Name, [ref] $parsed)) { return $Fallback }
  return [Math]::Max($Min, [Math]::Min($Max, $parsed))
}

function Convert-TokenCount([object] $Value, [int] $Fallback = 262144) {
  if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string] $Value)) { return $Fallback }
  $raw = ([string] $Value).Trim().ToLowerInvariant()
  if ($raw -eq 'native' -or $raw -eq 'natywny') { return 0 }
  $match = [regex]::Match($raw, '^(\d+)\s*k$')
  if ($match.Success) { return [int] $match.Groups[1].Value * 1024 }
  $parsed = 0
  if ([int]::TryParse($raw, [ref] $parsed)) { return $parsed }
  return $Fallback
}

function Get-NormalizedContextMode([object] $Value) {
  $raw = ([string] $Value).Trim().ToLowerInvariant()
  if ($raw -eq 'native' -or $raw -eq 'natywny' -or [string]::IsNullOrWhiteSpace($raw)) { return 'native' }
  return 'extended'
}

function Get-NormalizedKvCache([object] $Value) {
  $raw = ([string] $Value).Trim().ToLowerInvariant()
  if ($raw -in @('auto', 'f16', 'q8_0', 'q4_0')) { return $raw }
  return 'auto'
}

function Get-EffectiveContextSize([object] $Config) {
  $mode = Get-NormalizedContextMode (Get-ConfigString $Config 'contextMode' 'native')
  if ($mode -eq 'native') { return 0 }
  $tokens = Convert-TokenCount (Get-ConfigString $Config 'contextSizeTokens' '262144') 262144
  return [Math]::Max(1024, [Math]::Min(262144, $tokens))
}

function Get-EffectiveKvCache([object] $Config) {
  $kv = Get-NormalizedKvCache (Get-ConfigString $Config 'kvCacheQuantization' 'auto')
  if ($kv -ne 'auto') { return $kv }
  if ((Get-EffectiveContextSize $Config) -gt 32768) { return 'q8_0' }
  return 'f16'
}

function Invoke-SafeGitUpdate([string] $Reason) {
  $git = Get-Command git -ErrorAction SilentlyContinue
  if (-not $git) { Write-StartWarn "Update $Reason skipped: git is not available in PATH."; return }

  & git -C $RootDir rev-parse --is-inside-work-tree > $null 2>&1
  if ($LASTEXITCODE -ne 0) { Write-StartWarn "Update $Reason skipped: this folder is not a git repository."; return }

  & git -C $RootDir diff --quiet --ignore-submodules --
  $dirtyWorktree = $LASTEXITCODE -ne 0
  & git -C $RootDir diff --cached --quiet --ignore-submodules --
  $dirtyIndex = $LASTEXITCODE -ne 0
  if ($dirtyWorktree -or $dirtyIndex) {
    Write-StartWarn "Update $Reason skipped: local changes exist. Commit/stash them or run git pull manually."
    return
  }

  $branch = (& git -C $RootDir rev-parse --abbrev-ref HEAD 2>$null | Select-Object -First 1)
  if (-not $branch -or $branch -eq 'HEAD') { Write-StartWarn "Update $Reason skipped: repository is not on a normal branch."; return }

  Write-StartLog "Checking launcher updates ($Reason)."
  & git -C $RootDir fetch --quiet origin $branch
  if ($LASTEXITCODE -ne 0) { Write-StartWarn "Could not fetch origin/$branch. Starting local version."; return }

  $localHash = (& git -C $RootDir rev-parse HEAD).Trim()
  $remoteRef = "origin/$branch"
  $remoteHash = (& git -C $RootDir rev-parse $remoteRef 2>$null | Select-Object -First 1)
  if (-not $remoteHash) { Write-StartWarn "Remote branch $remoteRef not found. Update skipped."; return }
  $remoteHash = $remoteHash.Trim()
  if ($localHash -eq $remoteHash) { Write-StartLog 'Launcher is up to date.'; return }

  $mergeBase = (& git -C $RootDir merge-base HEAD $remoteRef 2>$null | Select-Object -First 1)
  if (-not $mergeBase -or $mergeBase.Trim() -ne $localHash) {
    Write-StartWarn "Update $Reason skipped: local history diverged from $remoteRef. Use git pull manually."
    return
  }

  & git -C $RootDir pull --ff-only --quiet origin $branch
  if ($LASTEXITCODE -eq 0) {
    Write-StartLog "Repository updated to $remoteRef. This session continues; restart later to run the newest script body."
  } else {
    Write-StartWarn 'git pull --ff-only failed. Starting local version.'
  }
}

function Sync-RuntimeConfig {
  $cfg = Read-Config
  Set-ConfigValue $cfg 'proxyPort' ([int] $ProxyPort)
  Set-ConfigValue $cfg 'llamaPort' ([int] $LlamaPort)
  Set-ConfigValue $cfg 'llamaUrl' "http://127.0.0.1:$LlamaPort"
  if ((Get-ConfigString $cfg 'modelPath') -and -not (Get-ConfigString $cfg 'modelName')) {
    Set-ConfigValue $cfg 'modelName' ([IO.Path]::GetFileName((Get-ConfigString $cfg 'modelPath')))
  }
  Set-ConfigValue $cfg 'parallelSlots' (Get-ConfigInt $cfg 'parallelSlots' 1 1 4)
  Set-ConfigValue $cfg 'sdEnabled' (Get-ConfigBool $cfg 'sdEnabled' $false)
  if ($null -eq $cfg.PSObject.Properties['draftModelPath']) { Set-ConfigValue $cfg 'draftModelPath' '' }
  if ($null -eq $cfg.PSObject.Properties['draftModelName']) { Set-ConfigValue $cfg 'draftModelName' '' }
  if ((Get-ConfigString $cfg 'draftModelPath') -and -not (Get-ConfigString $cfg 'draftModelName')) {
    Set-ConfigValue $cfg 'draftModelName' ([IO.Path]::GetFileName((Get-ConfigString $cfg 'draftModelPath')))
  }
  Set-ConfigValue $cfg 'speculativeTokens' (Get-ConfigInt $cfg 'speculativeTokens' 4 1 16)
  $contextMode = Get-NormalizedContextMode (Get-ConfigString $cfg 'contextMode' 'native')
  Set-ConfigValue $cfg 'contextMode' $contextMode
  $contextSize = if ($contextMode -eq 'native') { 0 } else { Get-EffectiveContextSize $cfg }
  Set-ConfigValue $cfg 'contextSizeTokens' $contextSize
  Set-ConfigValue $cfg 'kvCacheQuantization' (Get-NormalizedKvCache (Get-ConfigString $cfg 'kvCacheQuantization' 'auto'))
  Set-ConfigValue $cfg 'effectiveContextSizeTokens' $contextSize
  Set-ConfigValue $cfg 'effectiveKvCacheQuantization' (Get-EffectiveKvCache $cfg)
  if ($null -eq $cfg.PSObject.Properties['autoUpdate']) { Set-ConfigValue $cfg 'autoUpdate' $false }
  Set-ConfigValue $cfg 'optimizationMode' ($(if (Get-ConfigBool $cfg 'sdEnabled') { 'sd-experimental' } elseif ((Get-ConfigInt $cfg 'parallelSlots' 1 1 4) -gt 1) { 'parallel' } else { 'standard' }))
  if ($null -eq $cfg.PSObject.Properties['acceptsJobs']) { Set-ConfigValue $cfg 'acceptsJobs' $true }
  if ($null -eq $cfg.PSObject.Properties['scheduleEnabled']) { Set-ConfigValue $cfg 'scheduleEnabled' $false }
  if ($null -eq $cfg.PSObject.Properties['scheduleStart']) { Set-ConfigValue $cfg 'scheduleStart' $null }
  if ($null -eq $cfg.PSObject.Properties['scheduleEnd']) { Set-ConfigValue $cfg 'scheduleEnd' $null }
  if ($null -eq $cfg.PSObject.Properties['scheduleOutsideAction']) { Set-ConfigValue $cfg 'scheduleOutsideAction' 'wait' }
  if ($null -eq $cfg.PSObject.Properties['scheduleEndAction']) { Set-ConfigValue $cfg 'scheduleEndAction' 'finish-current' }
  if ($null -eq $cfg.PSObject.Properties['scheduleDumpOnStop']) { Set-ConfigValue $cfg 'scheduleDumpOnStop' $false }
  Save-Config $cfg
}

function Prompt-WithDefault([string] $Label, [string] $Default = '') {
  if ($Default) {
    $value = Read-Host "$Label [$Default]"
    if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
    return $value
  }
  return (Read-Host $Label)
}

function Prompt-Secret([string] $Label) {
  $secure = Read-Host $Label -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Test-TimeValue([string] $Value) {
  return $Value -match '^([01][0-9]|2[0-3]):[0-5][0-9]$'
}

function Convert-TimeToMinutes([string] $Value) {
  $parts = $Value.Split(':')
  return ([int] $parts[0]) * 60 + ([int] $parts[1])
}

function Test-InScheduleWindow([int] $NowMinutes, [int] $StartMinutes, [int] $EndMinutes) {
  if ($StartMinutes -eq $EndMinutes) { return $true }
  if ($StartMinutes -lt $EndMinutes) { return $NowMinutes -ge $StartMinutes -and $NowMinutes -le $EndMinutes }
  return $NowMinutes -ge $StartMinutes -or $NowMinutes -le $EndMinutes
}

function Get-ScheduleState([object] $Config) {
  $enabled = Get-ConfigBool $Config 'scheduleEnabled' $false
  $start = Get-ConfigString $Config 'scheduleStart'
  $end = Get-ConfigString $Config 'scheduleEnd'
  $outsideAction = Get-ConfigString $Config 'scheduleOutsideAction' 'wait'
  if ($outsideAction -notin @('wait', 'exit')) { $outsideAction = 'wait' }
  $endAction = Get-ConfigString $Config 'scheduleEndAction' 'finish-current'
  if ($endAction -notin @('finish-current', 'stop-now')) { $endAction = 'finish-current' }

  if (-not $enabled) {
    return [pscustomobject]@{ Enabled = $false; Inside = $true; OutsideAction = $outsideAction; EndAction = $endAction; WindowLabel = 'disabled'; SecondsUntilStart = 0 }
  }
  if (-not (Test-TimeValue $start) -or -not (Test-TimeValue $end)) {
    Write-StartWarn "Invalid schedule in config.json ($start-$end). Schedule is ignored for this session."
    return [pscustomobject]@{ Enabled = $false; Inside = $true; OutsideAction = $outsideAction; EndAction = $endAction; WindowLabel = 'invalid'; SecondsUntilStart = 0 }
  }

  $now = Get-Date
  $minutes = $now.Hour * 60 + $now.Minute
  $startMinutes = Convert-TimeToMinutes $start
  $endMinutes = Convert-TimeToMinutes $end
  $inside = Test-InScheduleWindow $minutes $startMinutes $endMinutes
  $waitMinutes = if ($inside) { 0 } elseif ($minutes -le $startMinutes) { $startMinutes - $minutes } else { 1440 - $minutes + $startMinutes }
  return [pscustomobject]@{ Enabled = $true; Inside = $inside; OutsideAction = $outsideAction; EndAction = $endAction; WindowLabel = "$start-$end"; SecondsUntilStart = $waitMinutes * 60 }
}

function Format-Duration([int] $Seconds) {
  $safe = [Math]::Max(0, $Seconds)
  $hours = [Math]::Floor($safe / 3600)
  $minutes = [Math]::Floor(($safe % 3600) / 60)
  if ($hours -gt 0) { return "${hours}h ${minutes}m" }
  return "${minutes}m"
}

function Wait-ForScheduleWindow {
  while ($true) {
    $cfg = Read-Config
    $state = Get-ScheduleState $cfg
    if (-not $state.Enabled -or $state.Inside) { return }
    if ($state.OutsideAction -eq 'exit') {
      Write-StartWarn "Outside configured schedule ($($state.WindowLabel)). Launcher exits without loading the model."
      exit 0
    }
    Write-StartWarn "Outside configured schedule ($($state.WindowLabel)). Lightweight wait: $(Format-Duration $state.SecondsUntilStart). Model is not loaded yet."
    $sleepSeconds = [Math]::Min(60, [Math]::Max(10, [int] $state.SecondsUntilStart))
    Start-Sleep -Seconds $sleepSeconds
  }
}

function Configure-Schedule {
  $cfg = Read-Config
  Write-Host ''
  Write-Host '=========================================================='
  Write-Host '  Schedule - when this workstation may accept work'
  Write-Host '=========================================================='
  Write-Host '  Default: disabled. Example window: 18:00-08:00.'
  Write-Host '  No time is hardcoded; blank answer keeps schedule disabled.'
  Write-Host ''

  $answer = Prompt-WithDefault 'Configure schedule now? (y/N)' 'N'
  if ($answer.ToLowerInvariant() -notin @('y', 'yes', 't', 'tak')) {
    Set-ConfigValue $cfg 'scheduleEnabled' $false
    Set-ConfigValue $cfg 'scheduleStart' $null
    Set-ConfigValue $cfg 'scheduleEnd' $null
    Set-ConfigValue $cfg 'scheduleOutsideAction' 'wait'
    Set-ConfigValue $cfg 'scheduleEndAction' 'finish-current'
    Set-ConfigValue $cfg 'scheduleDumpOnStop' $false
    Save-Config $cfg
    Write-StartLog 'Schedule disabled.'
    return
  }

  $start = Prompt-WithDefault 'Start time HH:MM (example 18:00)' (Get-ConfigString $cfg 'scheduleStart')
  $end = Prompt-WithDefault 'End time HH:MM (example 08:00)' (Get-ConfigString $cfg 'scheduleEnd')
  if (-not (Test-TimeValue $start) -or -not (Test-TimeValue $end)) {
    throw 'Invalid schedule time. Use HH:MM, for example 18:00 or 08:00.'
  }

  $outside = Prompt-WithDefault 'Outside schedule before startup: wait or exit' (Get-ConfigString $cfg 'scheduleOutsideAction' 'wait')
  if ($outside -notin @('wait', 'exit')) { $outside = 'wait' }
  $endAction = Prompt-WithDefault 'At end of window: finish-current or stop-now' (Get-ConfigString $cfg 'scheduleEndAction' 'finish-current')
  if ($endAction -notin @('finish-current', 'stop-now')) { $endAction = 'finish-current' }
  $dumpAnswer = Prompt-WithDefault 'Write diagnostic dump on schedule stop? (y/N)' ($(if (Get-ConfigBool $cfg 'scheduleDumpOnStop') { 'y' } else { 'N' }))
  $dump = $dumpAnswer.ToLowerInvariant() -in @('y', 'yes', 't', 'tak')

  Set-ConfigValue $cfg 'scheduleEnabled' $true
  Set-ConfigValue $cfg 'scheduleStart' $start
  Set-ConfigValue $cfg 'scheduleEnd' $end
  Set-ConfigValue $cfg 'scheduleOutsideAction' $outside
  Set-ConfigValue $cfg 'scheduleEndAction' $endAction
  Set-ConfigValue $cfg 'scheduleDumpOnStop' $dump
  Save-Config $cfg
  Write-StartLog "Schedule saved: $start-$end, outside=$outside, end=$endAction, dump=$dump"
  if ($dump) {
    Write-StartWarn 'Diagnostic dumps are not generation checkpoints. stop-now can still lose in-progress work.'
  }
}

function Detect-Backend {
  if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    try { & nvidia-smi 1>$null 2>$null; return 'cuda' } catch {}
  }
  if (Get-Command vulkaninfo -ErrorAction SilentlyContinue) {
    try { & vulkaninfo 1>$null 2>$null; return 'vulkan' } catch {}
  }
  return 'cpu'
}

function Get-LlamaBinaryPath {
  return (Join-Path $BinDir 'llama-server.exe')
}

function Select-AssetTokenGroups([string] $Backend) {
  if ($Backend -eq 'cuda') {
    return @(
      'llama,bin,win,cuda,x64',
      'bin,win,cuda,x64',
      'llama,bin,win-vulkan,x64',
      'llama,bin,win,cpu,x64',
      'bin,win,cpu,x64'
    )
  }
  if ($Backend -eq 'vulkan') {
    return @(
      'llama,bin,win-vulkan,x64',
      'llama,bin,win,vulkan,x64',
      'llama,bin,win,cpu,x64',
      'bin,win,cpu,x64'
    )
  }
  return @(
    'llama,bin,win,cpu,x64',
    'bin,win,cpu,x64',
    'llama,bin,win,x64'
  )
}

function Test-AssetNameMatches([string] $Name, [string] $TokenGroup) {
  foreach ($token in ($TokenGroup -split ',')) {
    if (-not $Name.Contains($token)) { return $false }
  }
  return $true
}

function Find-LlamaReleaseAsset([object[]] $Assets, [string[]] $TokenGroups) {
  foreach ($tokenGroup in $TokenGroups) {
    $matches = @($Assets | Where-Object {
      $name = $_.name.ToLowerInvariant()
      ($_.browser_download_url -match '\.zip$') -and (-not $name.StartsWith('cudart-')) -and (Test-AssetNameMatches $name $tokenGroup)
    })
    if ($matches.Count -gt 0) { return $matches[0] }
  }
  return $null
}

function Get-BackendFromAssetName([string] $AssetName, [string] $FallbackBackend) {
  $name = $AssetName.ToLowerInvariant()
  if ($name.Contains('cuda')) { return 'cuda' }
  if ($name.Contains('vulkan')) { return 'vulkan' }
  if ($name.Contains('hip') -or $name.Contains('radeon')) { return 'vulkan' }
  if ($name.Contains('cpu')) { return 'cpu' }
  return $FallbackBackend
}

function Download-LlamaBinary([string] $Backend) {
  $target = Get-LlamaBinaryPath
  if ((Test-Path -LiteralPath $target) -and -not $NoPull) {
    Write-StartLog "llama-server already exists: $target"
    return $Backend
  }
  if ($NoPull) {
    Write-StartLog '[--no-pull] Skipping llama-server download.'
    return $Backend
  }

  $tokenGroups = @(Select-AssetTokenGroups $Backend)
  Write-StartLog "Looking for llama.cpp release asset: $($tokenGroups -join ' -> ')"
  $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/ggerganov/llama.cpp/releases/latest' -Headers @{ 'User-Agent' = 'AgentManagerLauncher' }
  $asset = Find-LlamaReleaseAsset $release.assets $tokenGroups

  if (-not $asset) {
    $available = (($release.assets | Where-Object { $_.name -match 'bin-win.*\.zip$' -and $_.name -notmatch '^cudart-' } | ForEach-Object { $_.name }) -join ', ')
    throw "Could not find a llama.cpp Windows zip. Tried: $($tokenGroups -join ' | '). Available: $available. Download manually from https://github.com/ggerganov/llama.cpp/releases and use --no-pull."
  }

  $selectedBackend = Get-BackendFromAssetName $asset.name $Backend
  if ($selectedBackend -ne $Backend) {
    Write-StartWarn "No exact $Backend asset matched; using $selectedBackend package: $($asset.name)"
  } else {
    Write-StartLog "Selected package: $($asset.name)"
  }

  $zip = Join-Path $BinDir '_llama.zip'
  Write-StartLog "Downloading: $($asset.browser_download_url)"
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip
  Expand-Archive -LiteralPath $zip -DestinationPath $BinDir -Force
  Remove-Item -LiteralPath $zip -Force

  $found = Get-ChildItem -LiteralPath $BinDir -Recurse -File -Filter 'llama-server.exe' | Select-Object -First 1
  if (-not $found) { throw "After extracting the release, llama-server.exe was not found under $BinDir" }
  if ($found.Directory.FullName -ne $BinDir) {
    Copy-Item -Path (Join-Path $found.Directory.FullName '*') -Destination $BinDir -Recurse -Force
  }
  if ($found.FullName -ne $target) {
    Copy-Item -LiteralPath $found.FullName -Destination $target -Force
  }
  Write-StartLog "Binary ready: $target"
  return $selectedBackend
}

function Convert-HfInfoUrl([string] $InputValue) {
  if ($InputValue -notmatch '^https://huggingface\.co/.+\?show_file_info=.+\.gguf') { return $InputValue }
  $parts = $InputValue.Split('?')
  $fileName = [Uri]::UnescapeDataString(($InputValue -split 'show_file_info=')[-1])
  return "$($parts[0])/resolve/main/$fileName"
}

function Test-GgufFile([string] $Path) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "Model file does not exist: $Path" }
  if ((Get-Item -LiteralPath $Path).Length -lt 4) { throw "Downloaded model is empty: $Path" }
  $bytes = [byte[]]::new(4)
  $stream = [IO.File]::OpenRead($Path)
  try { [void] $stream.Read($bytes, 0, 4) }
  finally { $stream.Dispose() }
  $magic = [Text.Encoding]::ASCII.GetString($bytes)
  if ($magic -ne 'GGUF') {
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    throw "Downloaded file is not GGUF. It may be an HTML page. Use a direct .gguf URL."
  }
}

function Prompt-Model {
  Write-Host ''
  Write-Host '=========================================================='
  Write-Host '  Choose GGUF model'
  Write-Host '=========================================================='
  Write-Host '  Paste a direct HuggingFace .gguf URL or a local .gguf path.'
  Write-Host ''

  $inputValue = Read-Host 'Your choice'
  if ([string]::IsNullOrWhiteSpace($inputValue)) { throw 'Empty model choice.' }
  if ($inputValue -match '^ollama(\s|$)') { throw 'This looks like an Ollama command. Paste a direct .gguf URL or local .gguf path.' }
  $inputValue = Convert-HfInfoUrl $inputValue

  if ($inputValue -match '^https?://') {
    $uri = [Uri] $inputValue
    $fileName = [IO.Path]::GetFileName($uri.AbsolutePath)
    if (-not $fileName.EndsWith('.gguf', [StringComparison]::OrdinalIgnoreCase)) {
      throw 'URL must point directly to a .gguf file.'
    }
    $modelPath = Join-Path $ModelsDir $fileName
    if ((Test-Path -LiteralPath $modelPath) -and -not $NoPull) {
      Write-StartLog "Model already exists: $modelPath"
    } elseif ($NoPull) {
      Write-StartLog '[--no-pull] Skipping model download.'
    } else {
      Write-StartLog "Downloading model to $modelPath"
      Invoke-WebRequest -Uri $inputValue -OutFile $modelPath
      Test-GgufFile $modelPath
    }
    return $modelPath
  }

  if (-not (Test-Path -LiteralPath $inputValue)) { throw "File does not exist: $inputValue" }
  $target = Join-Path $ModelsDir ([IO.Path]::GetFileName($inputValue))
  Copy-Item -LiteralPath $inputValue -Destination $target -Force
  Write-StartLog "Copied model to: $target"
  return $target
}

function Write-ModelConfig([string] $ModelPath, [string] $Backend) {
  $cfg = Read-Config
  Set-ConfigValue $cfg 'proxyPort' ([int] $ProxyPort)
  Set-ConfigValue $cfg 'llamaPort' ([int] $LlamaPort)
  Set-ConfigValue $cfg 'llamaUrl' "http://127.0.0.1:$LlamaPort"
  Set-ConfigValue $cfg 'modelPath' $ModelPath
  Set-ConfigValue $cfg 'modelName' ([IO.Path]::GetFileName($ModelPath))
  Set-ConfigValue $cfg 'backend' $Backend
  Save-Config $cfg
}

function Ensure-WorkstationConfig {
  $cfg = Read-Config
  $name = Get-ConfigString $cfg 'workstationName'
  $url = Get-ConfigString $cfg 'supabaseUrl'
  $key = Get-ConfigString $cfg 'supabaseAnonKey'
  $enrollmentToken = Get-ConfigString $cfg 'enrollmentToken'
  $stationRefreshToken = Get-ConfigString $cfg 'stationRefreshToken'
  $stationAccessToken = Get-ConfigString $cfg 'stationAccessToken'
  $email = Get-ConfigString $cfg 'workstationEmail'
  $password = Get-ConfigString $cfg 'workstationPassword'
  $appOrigin = Get-ConfigString $cfg 'appOrigin' $DefaultAppOrigin

  if ($name -and $url -and $key -and ($stationRefreshToken -or $stationAccessToken -or $enrollmentToken)) {
    Write-StartLog 'Using saved workstation station-token config.'
    return
  }

  if ($name -and $url -and $key -and $email -and $password) {
    Write-StartWarn 'Using legacy operator password config. Generate a station token in the dashboard and run start.bat --config to remove operator password from config.json.'
    return
  }

  Write-Host ''
  Write-Host '=========================================================='
  Write-Host '  Workstation config'
  Write-Host '=========================================================='
  Write-Host '  Copy Supabase URL and publishable key from your own Supabase project.'
  Write-Host '  Paste a station enrollment token from Dashboard -> Workstations.'
  Write-Host '  Do not type the operator password here; it is not stored by this launcher.'
  $name = Prompt-WithDefault 'Workstation name' ($(if ($name) { $name } else { $env:COMPUTERNAME }))
  $url = Prompt-WithDefault 'Supabase URL' ($(if ($url) { $url } else { $DefaultSupabaseUrl }))
  $key = Prompt-WithDefault 'Supabase publishable key' ($(if ($key) { $key } else { $DefaultSupabaseKey }))
  $enrollmentToken = Prompt-WithDefault 'Station enrollment token' $enrollmentToken
  if (-not $enrollmentToken) { throw 'Missing station enrollment token. Generate it in Dashboard -> Workstations -> installation tokens.' }
  $appOrigin = Prompt-WithDefault 'GitHub Pages app origin, without path' $appOrigin

  Set-ConfigValue $cfg 'workstationName' $name
  Set-ConfigValue $cfg 'supabaseUrl' $url
  Set-ConfigValue $cfg 'supabaseAnonKey' $key
  Set-ConfigValue $cfg 'enrollmentToken' $enrollmentToken
  if ($enrollmentToken) {
    if ($null -ne $cfg.PSObject.Properties['workstationEmail']) { $cfg.PSObject.Properties.Remove('workstationEmail') }
    if ($null -ne $cfg.PSObject.Properties['workstationPassword']) { $cfg.PSObject.Properties.Remove('workstationPassword') }
  }
  Set-ConfigValue $cfg 'appOrigin' (($appOrigin.Trim()).TrimEnd('/'))
  $origins = New-Object System.Collections.Generic.List[string]
  foreach ($origin in @('http://localhost', 'http://127.0.0.1', (($appOrigin.Trim()).TrimEnd('/')))) {
    if ($origin -and -not $origins.Contains($origin)) { $origins.Add($origin) }
  }
  Set-ConfigValue $cfg 'allowedOrigins' $origins.ToArray()
  if ($null -eq $cfg.PSObject.Properties['acceptsJobs']) { Set-ConfigValue $cfg 'acceptsJobs' $true }
  Save-Config $cfg
  Write-StartLog 'Saved workstation config. The enrollment token will be exchanged for a restricted station session at startup.'
}

function Configure-Advanced {
  $cfg = Read-Config
  Write-Host ''
  Write-Host '=========================================================='
  Write-Host '  Advanced runtime options'
  Write-Host '=========================================================='
  Write-Host '  Default: parallelSlots=1, context=native, KV=auto, SD disabled.'
  Write-Host '  Preset 256k is available, but may need a lot of RAM/VRAM.'
  Write-Host ''

  $answer = Prompt-WithDefault 'Configure Advanced now? (y/N)' 'N'
  if ($answer.ToLowerInvariant() -notin @('y', 'yes', 't', 'tak')) {
    Sync-RuntimeConfig
    Write-StartLog 'Advanced remains at safe defaults.'
    return
  }

  $parallel = Prompt-WithDefault 'parallelSlots (1-4)' ([string] (Get-ConfigInt $cfg 'parallelSlots' 1 1 4))
  $contextDefault = if ((Get-NormalizedContextMode (Get-ConfigString $cfg 'contextMode' 'native')) -eq 'native') { 'native' } else { [string] (Get-EffectiveContextSize $cfg) }
  $contextChoice = Prompt-WithDefault 'Context: native, 32k, 64k, 128k, 256k or token count' $contextDefault
  switch (($contextChoice.Trim()).ToLowerInvariant()) {
    'native' { $contextMode = 'native'; $contextSize = 0; break }
    'natywny' { $contextMode = 'native'; $contextSize = 0; break }
    '32k' { $contextMode = 'extended'; $contextSize = 32768; break }
    '32768' { $contextMode = 'extended'; $contextSize = 32768; break }
    '64k' { $contextMode = 'extended'; $contextSize = 65536; break }
    '65536' { $contextMode = 'extended'; $contextSize = 65536; break }
    '128k' { $contextMode = 'extended'; $contextSize = 131072; break }
    '131072' { $contextMode = 'extended'; $contextSize = 131072; break }
    '256k' { $contextMode = 'extended'; $contextSize = 262144; break }
    '262144' { $contextMode = 'extended'; $contextSize = 262144; break }
    default { $contextMode = 'extended'; $contextSize = Convert-TokenCount $contextChoice 262144; break }
  }
  $contextSize = if ($contextMode -eq 'native') { 0 } else { [Math]::Max(1024, [Math]::Min(262144, $contextSize)) }
  $kvCache = Get-NormalizedKvCache (Prompt-WithDefault 'KV cache compression (auto/f16/q8_0/q4_0)' (Get-ConfigString $cfg 'kvCacheQuantization' 'auto'))
  $autoDefault = if (Get-ConfigBool $cfg 'autoUpdate' $false) { 'y' } else { 'N' }
  $autoAnswer = Prompt-WithDefault 'Automatically update launcher on startup? (y/N)' $autoDefault
  $autoUpdate = $autoAnswer.ToLowerInvariant() -in @('y', 'yes', 't', 'tak')
  $sdAnswer = Prompt-WithDefault 'Enable SD / speculative decoding? (y/N)' 'N'
  $sdEnabled = $sdAnswer.ToLowerInvariant() -in @('y', 'yes', 't', 'tak')
  $draftModelPath = ''
  $speculativeTokens = [string] (Get-ConfigInt $cfg 'speculativeTokens' 4 1 16)

  if ($sdEnabled) {
    $draftModelPath = Prompt-WithDefault 'Draft GGUF model path for SD' (Get-ConfigString $cfg 'draftModelPath')
    $speculativeTokens = Prompt-WithDefault 'Speculative tokens / draft window (1-16)' $speculativeTokens
    if (-not $draftModelPath -or -not (Test-Path -LiteralPath $draftModelPath)) {
      Write-StartWarn 'SD needs an existing draft model. SD will stay disabled.'
      $sdEnabled = $false
      $draftModelPath = ''
    }
  }

  Set-ConfigValue $cfg 'parallelSlots' (Get-ConfigInt ([pscustomobject]@{ parallelSlots = $parallel }) 'parallelSlots' 1 1 4)
  Set-ConfigValue $cfg 'sdEnabled' $sdEnabled
  Set-ConfigValue $cfg 'draftModelPath' $draftModelPath
  Set-ConfigValue $cfg 'draftModelName' ($(if ($draftModelPath) { [IO.Path]::GetFileName($draftModelPath) } else { '' }))
  Set-ConfigValue $cfg 'speculativeTokens' (Get-ConfigInt ([pscustomobject]@{ speculativeTokens = $speculativeTokens }) 'speculativeTokens' 4 1 16)
  Set-ConfigValue $cfg 'contextMode' $contextMode
  Set-ConfigValue $cfg 'contextSizeTokens' $contextSize
  Set-ConfigValue $cfg 'kvCacheQuantization' $kvCache
  Set-ConfigValue $cfg 'autoUpdate' $autoUpdate
  Save-Config $cfg
  Sync-RuntimeConfig
  $saved = Read-Config
  Write-StartLog "Saved Advanced: parallelSlots=$(Get-ConfigInt $saved 'parallelSlots' 1 1 4), context=$(Get-ConfigString $saved 'contextMode' 'native')/$((Get-ConfigInt $saved 'effectiveContextSizeTokens' 0 0 262144)), KV=$(Get-ConfigString $saved 'effectiveKvCacheQuantization' 'f16'), SD=$(Get-ConfigBool $saved 'sdEnabled'), autoUpdate=$(Get-ConfigBool $saved 'autoUpdate')."
}

function Ensure-Config([string] $Backend) {
  $cfg = Read-Config
  $savedModel = Get-ConfigString $cfg 'modelPath'
  $askedModel = $false
  if ($ChangeModel -or -not (Test-Path -LiteralPath $ConfigFile) -or -not $savedModel) {
    if ((Test-Path -LiteralPath $ConfigFile) -and -not $savedModel) {
      Write-StartWarn 'config.json has no modelPath. Choose a model again.'
    }
    $modelPath = Prompt-Model
    Write-ModelConfig $modelPath $Backend
    $askedModel = $true
  } else {
    Write-StartLog 'Using saved model from config.json (change with --change-model).'
  }

  Sync-RuntimeConfig
  Ensure-WorkstationConfig
  if ($AdvancedConfig -or $askedModel) { Configure-Advanced }
  if ($ScheduleConfig) { Configure-Schedule } else { Sync-RuntimeConfig }
}

function Test-LlamaServerOn([int] $Port) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 1
    return $response.Content -match 'llama|slots_idle|ok'
  } catch { return $false }
}

function Test-PortFree([int] $Port) {
  $listener = $null
  try {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse('127.0.0.1'), $Port)
    $listener.Start()
    return $true
  } catch { return $false }
  finally { if ($listener) { $listener.Stop() } }
}

function Get-PortState([int] $Port) {
  if (Test-LlamaServerOn $Port) { return 'llama' }
  if (Test-PortFree $Port) { return 'free' }
  return 'other'
}

function Find-FreePort([int] $StartPort) {
  for ($port = $StartPort; $port -lt ($StartPort + 50); $port++) {
    if ((Get-PortState $port) -eq 'free') { return $port }
  }
  return 0
}

$ReuseLlama = $false
function Resolve-LlamaPort {
  $state = Get-PortState $script:LlamaPort
  if ($state -eq 'free') {
    Write-StartLog "Port $script:LlamaPort is free."
  } elseif ($state -eq 'llama') {
    Write-StartWarn "llama-server already runs on port $script:LlamaPort. Reusing it."
    $script:ReuseLlama = $true
  } else {
    Write-StartWarn "Port $script:LlamaPort is busy. Looking for another llama-server port."
    $alt = Find-FreePort 8090
    if (-not $alt) { throw 'No free llama-server port found in 8090-8139.' }
    $script:LlamaPort = $alt
    Write-StartLog "llama-server will use port $script:LlamaPort"
  }
}

function Resolve-ProxyPort {
  if ((Get-PortState $script:ProxyPort) -ne 'free') {
    Write-StartWarn "Port $script:ProxyPort is busy. Looking for another proxy port."
    $alt = Find-FreePort 3002
    if (-not $alt) { throw 'No free proxy port found in 3002-3051.' }
    $script:ProxyPort = $alt
    Write-StartWarn "Frontend expects 127.0.0.1:3001. Free that port if the badge stays online-only."
  }
}

function Ensure-RuntimeFiles([string] $ModelPath) {
  if (-not (Test-Path -LiteralPath $ModelPath)) { throw "Model file not found: $ModelPath" }
  $bin = Get-LlamaBinaryPath
  if (-not (Test-Path -LiteralPath $bin)) { throw "Missing llama-server.exe: $bin. Run without --no-pull or install it manually." }
}

function Test-LlamaFlag([string] $Flag) {
  $bin = Get-LlamaBinaryPath
  try {
    $help = & $bin --help 2>&1 | Out-String
    return $help.Contains($Flag)
  } catch { return $false }
}

function Quote-NativeArgument([string] $Argument) {
  if ($Argument -eq '') { return '""' }
  if ($Argument -notmatch '[\s"&|<>^]') { return $Argument }

  $result = '"'
  $backslashes = 0
  foreach ($char in $Argument.ToCharArray()) {
    if ($char -eq [char]92) {
      $backslashes += 1
      continue
    }
    if ($char -eq [char]34) {
      if ($backslashes -gt 0) {
        $result += ('\' * ($backslashes * 2))
        $backslashes = 0
      }
      $result += '\"'
      continue
    }
    if ($backslashes -gt 0) {
      $result += ('\' * $backslashes)
      $backslashes = 0
    }
    $result += [string] $char
  }
  if ($backslashes -gt 0) {
    $result += ('\' * ($backslashes * 2))
  }
  return $result + '"'
}

function Join-NativeArguments([string[]] $Items) {
  $quoted = foreach ($item in $Items) { Quote-NativeArgument ([string] $item) }
  return ($quoted -join ' ')
}

$StartedProcesses = @()
function Write-ProcessLogTail([string] $Label, [string] $LogPath, [int] $Lines = 25) {
  if (-not $LogPath -or -not (Test-Path -LiteralPath $LogPath)) { return }
  $items = Get-Content -LiteralPath $LogPath -Tail $Lines -ErrorAction SilentlyContinue
  if (-not $items) { return }
  Write-Host ''
  Write-StartWarn "$Label ($LogPath)"
  foreach ($item in $items) { Write-Host "  $item" }
}

function Start-LoggedProcess([string] $Name, [string] $FilePath, [string[]] $Arguments, [string] $WorkingDirectory, [string] $StdoutLog, [string] $StderrLog) {
  "[$Name] starting at $(Get-Date -Format o)" | Set-Content -LiteralPath $StdoutLog -Encoding UTF8
  "[$Name] errors at $(Get-Date -Format o)" | Set-Content -LiteralPath $StderrLog -Encoding UTF8
  $argumentLine = Join-NativeArguments $Arguments
  Write-StartLog "Starting $Name"
  $process = Start-Process -FilePath $FilePath -ArgumentList $argumentLine -WorkingDirectory $WorkingDirectory -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog -PassThru -NoNewWindow
  $script:StartedProcesses += [pscustomobject]@{ Name = $Name; Process = $process; StdoutLog = $StdoutLog; StderrLog = $StderrLog }
  return $process
}

function Start-Llama([string] $ModelPath, [string] $Backend) {
  $cfg = Read-Config
  $contextSize = Get-EffectiveContextSize $cfg
  $args = @('--model', $ModelPath, '--host', '127.0.0.1', '--port', [string] $script:LlamaPort, '--ctx-size', [string] $contextSize)
  if ($contextSize -eq 0) {
    Write-StartLog 'Context: native (llama.cpp --ctx-size 0).'
  } elseif ($contextSize -ge 131072) {
    Write-StartWarn "Context $contextSize tokens may need a lot of RAM/VRAM. If startup fails, run start.bat --config and choose native."
  } else {
    Write-StartLog "Context: $contextSize tokens."
  }

  $kvEffective = Get-EffectiveKvCache $cfg
  $kvRequested = Get-NormalizedKvCache (Get-ConfigString $cfg 'kvCacheQuantization' 'auto')
  if ($kvEffective -ne 'f16') {
    if ((Test-LlamaFlag '--cache-type-k') -and (Test-LlamaFlag '--cache-type-v')) {
      $args += @('--cache-type-k', $kvEffective, '--cache-type-v', $kvEffective)
      Write-StartLog "KV cache compression: $kvEffective (requested=$kvRequested)."
    } else {
      Write-StartWarn "config.json requests KV=$kvEffective, but llama-server does not advertise --cache-type-k/--cache-type-v. Starting without KV compression."
    }
  }
  if ($Backend -in @('cuda', 'vulkan')) { $args += @('--n-gpu-layers', '999') }

  $parallel = Get-ConfigInt $cfg 'parallelSlots' 1 1 4
  if ($parallel -gt 1) {
    if (Test-LlamaFlag '--parallel') { $args += @('--parallel', [string] $parallel) }
    else { Write-StartWarn 'llama-server does not advertise --parallel; station config still reports parallelSlots.' }
  }

  if (Get-ConfigBool $cfg 'sdEnabled') {
    $draft = Get-ConfigString $cfg 'draftModelPath'
    $tokens = Get-ConfigInt $cfg 'speculativeTokens' 4 1 16
    if (-not $draft -or -not (Test-Path -LiteralPath $draft)) {
      Write-StartWarn 'SD enabled but draft model does not exist. Starting without SD.'
    } elseif (Test-LlamaFlag '--model-draft') {
      $args += @('--model-draft', $draft)
      if (Test-LlamaFlag '--draft-max') { $args += @('--draft-max', [string] $tokens) }
    } else {
      Write-StartWarn 'This llama-server does not advertise --model-draft. Starting without SD.'
    }
  }

  return Start-LoggedProcess 'llama-server' (Get-LlamaBinaryPath) $args $ProxyDir (Join-Path $LogsDir 'llama-server.log') (Join-Path $LogsDir 'llama-server.err.log')
}

function Start-Proxy {
  return Start-LoggedProcess 'proxy' (Get-NodeExecutable) @((Join-Path $ProxyDir 'proxy.js')) $ProxyDir (Join-Path $LogsDir 'proxy.log') (Join-Path $LogsDir 'proxy.err.log')
}

function Start-WorkstationAgent {
  return Start-LoggedProcess 'workstation-agent' (Get-NodeExecutable) @((Join-Path $ProxyDir 'workstation-agent.js')) $ProxyDir (Join-Path $LogsDir 'workstation-agent.log') (Join-Path $LogsDir 'workstation-agent.err.log')
}

function Wait-Health([string] $Url, [string] $Name, [int] $MaxSeconds) {
  Write-StartLog "Waiting for $Name at $Url (max ${MaxSeconds}s)"
  for ($i = 0; $i -lt $MaxSeconds; $i++) {
    try {
      Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 1 | Out-Null
      Write-StartLog "$Name ready."
      return
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  throw "$Name did not become healthy in ${MaxSeconds}s. Check logs in $LogsDir."
}

function Stop-StartedProcesses {
  foreach ($entry in $script:StartedProcesses) {
    try {
      $proc = $entry.Process
      if ($proc -and -not $proc.HasExited) {
        Write-StartLog "Stopping $($entry.Name) (pid $($proc.Id))"
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }
}

function Wait-ManagedProcesses {
  $cfg = Read-Config
  Write-Host ''
  Write-Host '============================================================'
  Write-Host '  Local AI runtime started.'
  Write-Host "  llama-server   http://127.0.0.1:$script:LlamaPort"
  Write-Host "  proxy          http://127.0.0.1:$script:ProxyPort"
  Write-Host "  logs           $LogsDir"
  Write-Host "  context        $(Get-ConfigString $cfg 'contextMode' 'native') / $(Get-ConfigString $cfg 'effectiveContextSizeTokens' '0') tokens"
  Write-Host "  KV cache       $(Get-ConfigString $cfg 'effectiveKvCacheQuantization' 'f16')"
  Write-Host "  autoUpdate     $(Get-ConfigBool $cfg 'autoUpdate' $false)"
  Write-Host '  Press Ctrl+C to stop.'
  Write-Host '============================================================'
  Write-Host ''

  while ($true) {
    Start-Sleep -Seconds 5
    foreach ($entry in $script:StartedProcesses) {
      $proc = $entry.Process
      if ($proc.HasExited) {
        try { $proc.WaitForExit(1000) | Out-Null; $proc.Refresh() } catch {}
        $exitCode = if ($null -ne $proc.ExitCode) { [string] $proc.ExitCode } else { 'unknown' }
        Write-StartWarn "$($entry.Name) exited with code $exitCode. Stopping remaining runtime processes."
        Write-ProcessLogTail "$($entry.Name) stdout tail" $entry.StdoutLog
        Write-ProcessLogTail "$($entry.Name) stderr tail" $entry.StderrLog
        return
      }
    }
  }
}

function Print-Banner {
  Write-Host ''
  Write-Host '============================================================' -ForegroundColor Cyan
  Write-Host '  Agent Manager - LOCAL AI RUNTIME (Windows)' -ForegroundColor Cyan
  Write-Host '============================================================' -ForegroundColor Cyan
  Write-Host "  Script:    start.ps1 (called by start.bat)"
  Write-Host "  Platform:  Windows $([Environment]::OSVersion.VersionString)"
  Write-Host "  Help:      start.bat --help"
  Write-Host '============================================================' -ForegroundColor Cyan
  Write-Host ''
}

function Write-DoctorResult([string] $Status, [string] $Name, [string] $Message) {
  $color = 'Gray'
  if ($Status -eq 'OK') { $color = 'Green' }
  if ($Status -eq 'WARN') { $color = 'Yellow' }
  if ($Status -eq 'INFO') { $color = 'Cyan' }
  Write-Host ('[{0}] {1}: {2}' -f $Status, $Name, $Message) -ForegroundColor $color
}

function Test-ScriptZoneIdentifier {
  try {
    $stream = Get-Item -LiteralPath $ScriptPath -Stream Zone.Identifier -ErrorAction SilentlyContinue
    return $null -ne $stream
  } catch {
    return $false
  }
}

function Invoke-Doctor {
  Print-Banner
  Write-Host 'Safe diagnostics only: no downloads, prompts or runtime services are started.'
  Write-Host ''

  Write-DoctorResult 'OK' 'Repository' $RootDir
  if (Test-Path -LiteralPath (Join-Path $ProxyDir 'proxy.js')) {
    Write-DoctorResult 'OK' 'proxy.js' 'found'
  } else {
    Write-DoctorResult 'WARN' 'proxy.js' 'missing local-ai-proxy\proxy.js'
  }
  if (Test-Path -LiteralPath (Join-Path $ProxyDir 'workstation-agent.js')) {
    Write-DoctorResult 'OK' 'workstation-agent.js' 'found'
  } else {
    Write-DoctorResult 'WARN' 'workstation-agent.js' 'missing local-ai-proxy\workstation-agent.js'
  }

  if (Test-ScriptZoneIdentifier) {
    Write-DoctorResult 'WARN' 'PowerShell unblock' 'this downloaded script has Zone.Identifier; run: Unblock-File .\start.ps1'
  } else {
    Write-DoctorResult 'OK' 'PowerShell unblock' 'no Zone.Identifier prompt expected for start.ps1'
  }

  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    $nodeVersion = (& $node.Source --version 2>$null | Select-Object -First 1)
    Write-DoctorResult 'OK' 'Node.js' "$nodeVersion at $($node.Source)"
  } else {
    $localNode = Get-LocalNodeExecutable
    if ($localNode) {
      $nodeVersion = (& $localNode --version 2>$null | Select-Object -First 1)
      Write-DoctorResult 'OK' 'Node.js' "$nodeVersion portable at $localNode"
    } else {
      Write-DoctorResult 'WARN' 'Node.js' 'not found in PATH; full start will download portable Node.js into local-ai-proxy\bin'
    }
  }

  Write-DoctorResult 'INFO' 'Port 8080' (Get-PortState 8080)
  Write-DoctorResult 'INFO' 'Port 3001' (Get-PortState 3001)

  $backend = Detect-Backend
  Write-DoctorResult 'INFO' 'Detected backend' $backend
  try {
    $tokenGroups = @(Select-AssetTokenGroups $backend)
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/ggerganov/llama.cpp/releases/latest' -Headers @{ 'User-Agent' = 'AgentManagerLauncher' }
    $asset = Find-LlamaReleaseAsset $release.assets $tokenGroups
    if ($asset) {
      Write-DoctorResult 'OK' 'llama.cpp asset' $asset.name
    } else {
      Write-DoctorResult 'WARN' 'llama.cpp asset' "no matching asset for: $($tokenGroups -join ' | ')"
    }
  } catch {
    Write-DoctorResult 'WARN' 'llama.cpp asset' "release lookup failed: $($_.Exception.Message)"
  }

  $bin = Get-LlamaBinaryPath
  if (Test-Path -LiteralPath $bin) {
    Write-DoctorResult 'OK' 'llama-server.exe' $bin
  } else {
    Write-DoctorResult 'INFO' 'llama-server.exe' 'not downloaded yet; full start will download it'
  }

  if (Test-Path -LiteralPath $ConfigFile) {
    $cfg = Read-Config
    $modelPath = Get-ConfigString $cfg 'modelPath'
    if ($modelPath -and (Test-Path -LiteralPath $modelPath)) {
      Write-DoctorResult 'OK' 'config.json modelPath' $modelPath
    } elseif ($modelPath) {
      Write-DoctorResult 'WARN' 'config.json modelPath' "configured path does not exist: $modelPath"
    } else {
      Write-DoctorResult 'INFO' 'config.json modelPath' 'missing; full start will ask for a GGUF model'
    }

    $enrollmentToken = Get-ConfigString $cfg 'enrollmentToken'
    $stationRefreshToken = Get-ConfigString $cfg 'stationRefreshToken'
    $stationAccessToken = Get-ConfigString $cfg 'stationAccessToken'
    $email = Get-ConfigString $cfg 'workstationEmail'
    if ($stationRefreshToken -or $stationAccessToken) {
      Write-DoctorResult 'OK' 'station auth' 'restricted station session configured'
    } elseif ($enrollmentToken) {
      Write-DoctorResult 'INFO' 'station auth' 'enrollment token saved; full start will redeem it'
    } elseif ($email) {
      Write-DoctorResult 'WARN' 'station auth' "legacy operator password config: $email"
    } else {
      Write-DoctorResult 'INFO' 'station auth' 'missing; full start will ask for dashboard enrollment token'
    }
    Write-DoctorResult 'INFO' 'context' "mode=$(Get-ConfigString $cfg 'contextMode' 'native'), tokens=$(Get-ConfigString $cfg 'contextSizeTokens' '0'), KV=$(Get-ConfigString $cfg 'kvCacheQuantization' 'auto')"
    Write-DoctorResult 'INFO' 'autoUpdate' "$(Get-ConfigBool $cfg 'autoUpdate' $false)"
  } else {
    Write-DoctorResult 'INFO' 'config.json' 'missing; full start will enter first-run configuration'
  }

  Write-Host ''
  Write-DoctorResult 'OK' 'Doctor' 'finished without starting services'
}

try {
  if ($DoctorMode) {
    Invoke-Doctor
    exit 0
  }

  Print-Banner
  Ensure-WorkspaceDirs
  Start-LauncherTranscript
  if ($UpdateNow) {
    Invoke-SafeGitUpdate '--update'
  } elseif (Get-ConfigBool (Read-Config) 'autoUpdate' $false) {
    Invoke-SafeGitUpdate 'autoUpdate'
  }
  Ensure-NodeRuntime
  Resolve-LlamaPort
  Resolve-ProxyPort

  $backend = Detect-Backend
  Write-StartLog "Detected backend: $backend"
  if (-not $ReuseLlama) { $backend = Download-LlamaBinary $backend }

  Ensure-Config $backend
  Sync-RuntimeConfig
  Wait-ForScheduleWindow

  $cfg = Read-Config
  $modelPath = Get-ConfigString $cfg 'modelPath'
  if (-not $modelPath) { throw 'Missing modelPath in config.json.' }

  if ($ReuseLlama) {
    Write-StartLog "Reusing llama-server on port $LlamaPort."
  } else {
    Ensure-RuntimeFiles $modelPath
    [void] (Start-Llama $modelPath $backend)
    Wait-Health "http://127.0.0.1:$LlamaPort/health" 'llama-server' 90
  }

  Sync-RuntimeConfig
  [void] (Start-Proxy)
  Wait-Health "http://127.0.0.1:$ProxyPort/health" 'proxy' 15
  [void] (Start-WorkstationAgent)
  Wait-ManagedProcesses
  exit 0
} catch {
  Write-StartErr $_.Exception.Message
  Write-StartWarn "See log: $(Join-Path $LogsDir 'start-windows.log')"
  exit 1
} finally {
  Stop-StartedProcesses
  try { if ($TranscriptStarted) { Stop-Transcript | Out-Null } } catch {}
}

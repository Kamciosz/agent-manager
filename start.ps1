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
$ProxyDir = Join-Path $RootDir 'local-ai-proxy'
$BinDir = Join-Path $ProxyDir 'bin'
$ModelsDir = Join-Path $ProxyDir 'models'
$LogsDir = Join-Path $ProxyDir 'logs'
$ConfigFile = Join-Path $ProxyDir 'config.json'

$LlamaPort = 8080
$ProxyPort = 3001
$DefaultSupabaseUrl = 'https://xaaalkbygdtjlsnhipwa.supabase.co'
$DefaultSupabaseKey = 'sb_publishable_y0GUJCxdmltSN8qAtmSmAA_ovM9Dxrc'

$ChangeModel = $false
$AdvancedConfig = $false
$ScheduleConfig = $false
$NoPull = $false
$ShowHelp = $false

foreach ($arg in $ScriptArgs) {
  switch -Regex ($arg) {
    '^--change-model$' { $ChangeModel = $true; break }
    '^--advanced$' { $AdvancedConfig = $true; $ScheduleConfig = $true; break }
    '^--schedule$' { $ScheduleConfig = $true; break }
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
  --schedule       configure only runtime schedule
  --reset          remove local-ai-proxy\config.json and ask again
  --no-pull        skip downloads, useful for offline tests
  --no-pause       consumed by start.bat wrapper
'@ | Write-Host
}

if ($ShowHelp) {
  Show-Help
  exit 0
}

New-Item -ItemType Directory -Force -Path $BinDir, $ModelsDir, $LogsDir | Out-Null
Start-Transcript -Path (Join-Path $LogsDir 'start-windows.log') -Append | Out-Null

function Assert-Command([string] $Name, [string] $Hint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name. $Hint"
  }
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
  return [bool] $Config.$Name
}

function Get-ConfigInt([object] $Config, [string] $Name, [int] $Fallback, [int] $Min, [int] $Max) {
  if ($null -eq $Config.PSObject.Properties[$Name] -or $null -eq $Config.$Name) { return $Fallback }
  $parsed = 0
  if (-not [int]::TryParse([string] $Config.$Name, [ref] $parsed)) { return $Fallback }
  return [Math]::Max($Min, [Math]::Min($Max, $parsed))
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
  $email = Get-ConfigString $cfg 'workstationEmail'
  $password = Get-ConfigString $cfg 'workstationPassword'

  if ($name -and $url -and $key -and $email -and $password) {
    Write-StartLog 'Using saved workstation config.'
    return
  }

  Write-Host ''
  Write-Host '=========================================================='
  Write-Host '  Workstation config'
  Write-Host '=========================================================='
  $name = Prompt-WithDefault 'Workstation name' ($(if ($name) { $name } else { $env:COMPUTERNAME }))
  $url = Prompt-WithDefault 'Supabase URL' ($(if ($url) { $url } else { $DefaultSupabaseUrl }))
  $key = Prompt-WithDefault 'Supabase publishable key' ($(if ($key) { $key } else { $DefaultSupabaseKey }))
  $email = Prompt-WithDefault 'Operator email' $email
  if (-not $password) { $password = Prompt-Secret 'Operator password' }

  Set-ConfigValue $cfg 'workstationName' $name
  Set-ConfigValue $cfg 'supabaseUrl' $url
  Set-ConfigValue $cfg 'supabaseAnonKey' $key
  Set-ConfigValue $cfg 'workstationEmail' $email
  Set-ConfigValue $cfg 'workstationPassword' $password
  if ($null -eq $cfg.PSObject.Properties['acceptsJobs']) { Set-ConfigValue $cfg 'acceptsJobs' $true }
  Save-Config $cfg
  Write-StartLog 'Saved workstation config.'
}

function Configure-Advanced {
  $cfg = Read-Config
  Write-Host ''
  Write-Host '=========================================================='
  Write-Host '  Advanced runtime options'
  Write-Host '=========================================================='
  Write-Host '  Default: parallelSlots=1, SD disabled.'
  Write-Host ''

  $answer = Prompt-WithDefault 'Configure Advanced now? (y/N)' 'N'
  if ($answer.ToLowerInvariant() -notin @('y', 'yes', 't', 'tak')) {
    Sync-RuntimeConfig
    Write-StartLog 'Advanced remains at safe defaults.'
    return
  }

  $parallel = Prompt-WithDefault 'parallelSlots (1-4)' ([string] (Get-ConfigInt $cfg 'parallelSlots' 1 1 4))
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
  Save-Config $cfg
  Sync-RuntimeConfig
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
function Start-LoggedProcess([string] $Name, [string] $FilePath, [string[]] $Arguments, [string] $WorkingDirectory, [string] $StdoutLog, [string] $StderrLog) {
  "[$Name] starting at $(Get-Date -Format o)" | Set-Content -LiteralPath $StdoutLog -Encoding UTF8
  "[$Name] errors at $(Get-Date -Format o)" | Set-Content -LiteralPath $StderrLog -Encoding UTF8
  $argumentLine = Join-NativeArguments $Arguments
  Write-StartLog "Starting $Name"
  $process = Start-Process -FilePath $FilePath -ArgumentList $argumentLine -WorkingDirectory $WorkingDirectory -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog -PassThru -NoNewWindow
  $script:StartedProcesses += [pscustomobject]@{ Name = $Name; Process = $process }
  return $process
}

function Start-Llama([string] $ModelPath, [string] $Backend) {
  $args = @('--model', $ModelPath, '--host', '127.0.0.1', '--port', [string] $script:LlamaPort, '--ctx-size', '4096')
  if ($Backend -in @('cuda', 'vulkan')) { $args += @('--n-gpu-layers', '999') }

  $cfg = Read-Config
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
  return Start-LoggedProcess 'proxy' 'node' @((Join-Path $ProxyDir 'proxy.js')) $ProxyDir (Join-Path $LogsDir 'proxy.log') (Join-Path $LogsDir 'proxy.err.log')
}

function Start-WorkstationAgent {
  return Start-LoggedProcess 'workstation-agent' 'node' @((Join-Path $ProxyDir 'workstation-agent.js')) $ProxyDir (Join-Path $LogsDir 'workstation-agent.log') (Join-Path $LogsDir 'workstation-agent.err.log')
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
  Write-Host ''
  Write-Host '============================================================'
  Write-Host '  Local AI runtime started.'
  Write-Host "  llama-server   http://127.0.0.1:$script:LlamaPort"
  Write-Host "  proxy          http://127.0.0.1:$script:ProxyPort"
  Write-Host "  logs           $LogsDir"
  Write-Host '  Press Ctrl+C to stop.'
  Write-Host '============================================================'
  Write-Host ''

  while ($true) {
    Start-Sleep -Seconds 5
    foreach ($entry in $script:StartedProcesses) {
      $proc = $entry.Process
      if ($proc.HasExited) {
        Write-StartWarn "$($entry.Name) exited with code $($proc.ExitCode). Stopping remaining runtime processes."
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

try {
  Print-Banner
  Assert-Command 'node' 'Install Node.js 18+: https://nodejs.org'
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
  try { Stop-Transcript | Out-Null } catch {}
}

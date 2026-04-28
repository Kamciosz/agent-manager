@echo off
REM ============================================================================
REM  start.bat  --  LOKALNY RUNTIME AI dla Agent Manager
REM  -------------------------------------------------------------------------
REM  PLATFORMA:   Windows 10 / 11        (NIE uruchamiaj na macOS / Linux!)
REM  ODPOWIEDNIK: start.sh               (<- ten sam skrypt dla macOS/Linux)
REM  WYMAGANIA:   PowerShell, Node.js 18+
REM  -------------------------------------------------------------------------
REM  Co robi:
REM    1. Wykrywa GPU (NVIDIA / Vulkan / CPU).
REM    2. Pobiera binary llama-server z GitHub Releases llama.cpp.
REM    3. Pyta o model (URL HF lub sciezka lokalna) tylko przy pierwszym starcie.
REM    4. Uruchamia llama-server na :8080 i Node proxy na :3001.
REM
REM  Flagi:
REM    --change-model    wymusza ponowne pytanie o model
REM    --advanced        otwiera konfiguracje parallelSlots i eksperymentalnego SD
REM    --reset           usuwa config.json
REM    --no-pull         pomija pobieranie binary i modelu
REM    --no-pause        nie zatrzymuje okna na koncu (do testow/automatyzacji)
REM  Advanced:
REM    parallelSlots=1 i sdEnabled=false sa zapisywane domyslnie w config.json
REM ============================================================================

setlocal EnableDelayedExpansion
set "EXIT_CODE=0"
set "NO_PAUSE=0"

REM --- Banner startowy (widoczny dla uzytkownika) ----------------------------
echo.
echo ============================================================
echo   Agent Manager  --  LOKALNY RUNTIME AI
echo ------------------------------------------------------------
echo   Skrypt:    start.bat   (na macOS/Linux uzyj: ./start.sh)
echo   Platforma: Windows
echo   Zatrzymanie: zamknij okno + taskkill (zobacz README)
echo ============================================================
echo.

set "ROOT_DIR=%~dp0"
set "PROXY_DIR=%ROOT_DIR%local-ai-proxy"
set "BIN_DIR=%PROXY_DIR%\bin"
set "MODELS_DIR=%PROXY_DIR%\models"
set "LOGS_DIR=%PROXY_DIR%\logs"
set "CONFIG_FILE=%PROXY_DIR%\config.json"

set "LLAMA_PORT=8080"
set "PROXY_PORT=3001"
set "DEFAULT_SUPABASE_URL=https://xaaalkbygdtjlsnhipwa.supabase.co"
set "DEFAULT_SUPABASE_KEY=sb_publishable_y0GUJCxdmltSN8qAtmSmAA_ovM9Dxrc"

if not exist "%BIN_DIR%"    mkdir "%BIN_DIR%"
if not exist "%MODELS_DIR%" mkdir "%MODELS_DIR%"
if not exist "%LOGS_DIR%"   mkdir "%LOGS_DIR%"

REM --- Flagi -----------------------------------------------------------------
set "CHANGE_MODEL=0"
set "ADVANCED_CONFIG=0"
set "NO_PULL=0"
:parse
if "%~1"=="" goto parsed
if /I "%~1"=="--change-model" set "CHANGE_MODEL=1"
if /I "%~1"=="--advanced"     set "ADVANCED_CONFIG=1"
if /I "%~1"=="--reset"        del /q "%CONFIG_FILE%" 2>nul & echo [start] Usunieto config.json.
if /I "%~1"=="--no-pull"      set "NO_PULL=1"
if /I "%~1"=="--no-pause"     set "NO_PAUSE=1"
shift
goto parse
:parsed

REM --- Wymagania -------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo [err] Brak Node.js w PATH. Zainstaluj Node 18+ ze strony https://nodejs.org
  goto fail
)
where powershell >nul 2>nul
if errorlevel 1 (
  echo [err] Brak powershell.exe (potrzebny do pobrania binary).
  goto fail
)

REM --- Detekcja GPU ----------------------------------------------------------
set "GPU=cpu"
where nvidia-smi >nul 2>nul
if not errorlevel 1 (
  nvidia-smi >nul 2>nul
  if not errorlevel 1 set "GPU=cuda"
)
if "%GPU%"=="cpu" (
  where vulkaninfo >nul 2>nul
  if not errorlevel 1 set "GPU=vulkan"
)
echo [start] Wykryto GPU: %GPU%

REM --- Pobranie binary -------------------------------------------------------
set "LLAMA_BIN=%BIN_DIR%\llama-server.exe"
if exist "%LLAMA_BIN%" (
  if not "%NO_PULL%"=="1" echo [start] llama-server.exe juz jest w bin\ — pomijam pobieranie.
) else (
  if "%NO_PULL%"=="1" (
    echo [start] [--no-pull] Pomijam pobieranie binary.
  ) else (
    REM Wybór tokenów dla nazwy assetu
    set "TOKENS=win x64"
    if /I "%GPU%"=="cuda"   set "TOKENS=win x64 cuda"
    if /I "%GPU%"=="vulkan" set "TOKENS=win x64 vulkan"
    echo [start] Szukam assetu llama.cpp pasujacego do: !TOKENS!
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$ErrorActionPreference='Stop';" ^
      "$tokens = '!TOKENS!'.Split(' ');" ^
      "$rel = Invoke-RestMethod -UseBasicParsing 'https://api.github.com/repos/ggerganov/llama.cpp/releases/latest';" ^
      "$asset = $rel.assets | Where-Object { $_.name -like '*.zip' -and ($tokens | ForEach-Object { $_ } | Where-Object { $asset_name = $_; $true }) -and ($tokens.ForEach({ $_ }) | ForEach-Object { $true }) } | Where-Object { $name = $_.name.ToLower(); ($tokens | ForEach-Object { $name.Contains($_.ToLower()) }) -notcontains $false } | Select-Object -First 1;" ^
      "if (-not $asset) { Write-Error 'Nie znaleziono assetu'; exit 1 };" ^
      "Write-Host ('[start] Pobieram: ' + $asset.browser_download_url);" ^
      "Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile '%BIN_DIR%\_llama.zip';" ^
      "Expand-Archive -Force -Path '%BIN_DIR%\_llama.zip' -DestinationPath '%BIN_DIR%';" ^
      "Remove-Item '%BIN_DIR%\_llama.zip';" ^
      "$exe = Get-ChildItem -Recurse '%BIN_DIR%' -Filter 'llama-server.exe' | Select-Object -First 1;" ^
      "if (-not $exe) { Write-Error 'Brak llama-server.exe po rozpakowaniu'; exit 1 };" ^
      "if ($exe.FullName -ne '%LLAMA_BIN%') { Copy-Item -Force $exe.FullName '%LLAMA_BIN%' }"
    if errorlevel 1 (
      echo [err] Pobieranie binary nieudane. Sprawdz https://github.com/ggerganov/llama.cpp/releases
      goto fail
    )
  )
)

REM --- Konfiguracja modelu ---------------------------------------------------
if "%CHANGE_MODEL%"=="1" del /q "%CONFIG_FILE%" 2>nul

if not exist "%CONFIG_FILE%" (
  echo.
  echo ==========================================================
  echo   Wybierz model GGUF do uruchomienia
  echo ==========================================================
  echo   Opcja A: wklej URL .gguf z HuggingFace
  echo   Opcja B: wklej sciezke do lokalnego pliku .gguf
  echo.
  set /p "MODEL_INPUT=Twoj wybor: "
  if "!MODEL_INPUT!"=="" (
    echo [err] Pusty wybor.
    goto fail
  )
  set "MODEL_PATH="
  set "MODEL_URL=!MODEL_INPUT!"
  if /I "!MODEL_INPUT:~0,4!"=="http" (
    REM URL — pobierz
    if not "!MODEL_INPUT:?show_file_info=!"=="!MODEL_INPUT!" (
      for /f "tokens=1,* delims=?" %%A in ("!MODEL_INPUT!") do (
        set "HF_REPO=%%A"
        set "HF_QUERY=%%B"
      )
      for /f "tokens=1,* delims==" %%A in ("!HF_QUERY!") do set "GGUF_NAME=%%B"
      if not "!GGUF_NAME!"=="" (
        set "MODEL_URL=!HF_REPO!/resolve/main/!GGUF_NAME!"
        echo [start] Zamieniam link Hugging Face na bezposredni URL do pliku: !GGUF_NAME!
      )
    )
    for /f "delims=" %%F in ('powershell -NoProfile -Command "$u=$env:MODEL_URL; try { [Uri]::UnescapeDataString([IO.Path]::GetFileName(([Uri]$u).AbsolutePath)) } catch { [IO.Path]::GetFileName(($u -split '\?')[0]) }"') do set "MODEL_FILENAME=%%F"
    if "!MODEL_FILENAME!"=="" (
      echo [err] Nie udalo sie odczytac nazwy pliku modelu z URL.
      goto fail
    )
    if /I not "!MODEL_FILENAME:~-5!"==".gguf" (
      echo [err] URL musi wskazywac bezposrednio na plik .gguf, nie na strone modelu.
      goto fail
    )
    set "MODEL_PATH=%MODELS_DIR%\!MODEL_FILENAME!"
    if not exist "!MODEL_PATH!" (
      if "%NO_PULL%"=="1" (
        echo [start] [--no-pull] Pomijam pobieranie modelu.
      ) else (
        echo [start] Pobieram model do !MODEL_PATH!
        powershell -NoProfile -ExecutionPolicy Bypass -Command ^
          "Invoke-WebRequest -UseBasicParsing -Uri $env:MODEL_URL -OutFile $env:MODEL_PATH"
        if errorlevel 1 ( echo [err] Pobieranie modelu nieudane. & goto fail )
        powershell -NoProfile -ExecutionPolicy Bypass -Command ^
          "$p=$env:MODEL_PATH; if (-not (Test-Path -LiteralPath $p)) { exit 1 }; $fs=[IO.File]::OpenRead($p); try { if ($fs.Length -lt 4) { exit 1 }; $buf=New-Object byte[] 4; [void]$fs.Read($buf,0,4); if ([Text.Encoding]::ASCII.GetString($buf) -ne 'GGUF') { exit 2 } } finally { $fs.Dispose() }"
        if errorlevel 1 ( del /q "!MODEL_PATH!" 2>nul & echo [err] Pobrany plik nie wyglada jak GGUF. Wklej bezposredni URL do pliku .gguf. & goto fail )
      )
    )
  ) else (
    if not exist "!MODEL_INPUT!" (
      echo [err] Plik nie istnieje: !MODEL_INPUT!
      goto fail
    )
    if /I not "!MODEL_INPUT:~-5!"==".gguf" echo [warn] Plik nie ma rozszerzenia .gguf — kontynuuje mimo to.
    for %%F in ("!MODEL_INPUT!") do set "MODEL_FILENAME=%%~nxF"
    set "MODEL_PATH=%MODELS_DIR%\!MODEL_FILENAME!"
    copy /Y "!MODEL_INPUT!" "!MODEL_PATH!" >nul
    if errorlevel 1 ( echo [err] Nie udalo sie skopiowac modelu do local-ai-proxy\models. & goto fail )
  )
  REM Zapis config.json (escape backslashy do JSON)
  set "MP_JSON=!MODEL_PATH:\=\\!"
  set "MN=!MODEL_FILENAME!"
  >"%CONFIG_FILE%" echo {
  >>"%CONFIG_FILE%" echo   "proxyPort": %PROXY_PORT%,
  >>"%CONFIG_FILE%" echo   "llamaPort": %LLAMA_PORT%,
  >>"%CONFIG_FILE%" echo   "llamaUrl": "http://127.0.0.1:%LLAMA_PORT%",
  >>"%CONFIG_FILE%" echo   "modelPath": "!MP_JSON!",
  >>"%CONFIG_FILE%" echo   "modelName": "!MN!",
  >>"%CONFIG_FILE%" echo   "backend": "%GPU%",
  >>"%CONFIG_FILE%" echo   "parallelSlots": 1,
  >>"%CONFIG_FILE%" echo   "sdEnabled": false,
  >>"%CONFIG_FILE%" echo   "draftModelPath": "",
  >>"%CONFIG_FILE%" echo   "draftModelName": "",
  >>"%CONFIG_FILE%" echo   "speculativeTokens": 4,
  >>"%CONFIG_FILE%" echo   "optimizationMode": "standard"
  >>"%CONFIG_FILE%" echo }
  echo [start] Zapisano config.json
) else (
  echo [start] Uzywam modelu z config.json (zmien: start.bat --change-model)
)

REM Utrzymaj domyslne Advanced takze dla starszego config.json.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$file='%CONFIG_FILE%';" ^
  "$cfg = Get-Content $file -Raw | ConvertFrom-Json;" ^
  "if (-not ($cfg.PSObject.Properties.Name -contains 'parallelSlots')) { $cfg | Add-Member -NotePropertyName parallelSlots -NotePropertyValue 1 };" ^
  "if (-not ($cfg.PSObject.Properties.Name -contains 'sdEnabled')) { $cfg | Add-Member -NotePropertyName sdEnabled -NotePropertyValue $false };" ^
  "if (-not ($cfg.PSObject.Properties.Name -contains 'draftModelPath')) { $cfg | Add-Member -NotePropertyName draftModelPath -NotePropertyValue '' };" ^
  "if (-not ($cfg.PSObject.Properties.Name -contains 'draftModelName')) { $cfg | Add-Member -NotePropertyName draftModelName -NotePropertyValue '' };" ^
  "if (-not ($cfg.PSObject.Properties.Name -contains 'speculativeTokens')) { $cfg | Add-Member -NotePropertyName speculativeTokens -NotePropertyValue 4 };" ^
  "if (-not ($cfg.PSObject.Properties.Name -contains 'optimizationMode')) { $cfg | Add-Member -NotePropertyName optimizationMode -NotePropertyValue 'standard' };" ^
  "$cfg | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $file"
if errorlevel 1 (
  echo [err] Nie udalo sie zaktualizowac config.json.
  goto fail
)

if "%ADVANCED_CONFIG%"=="1" (
  call :configure_advanced
  if errorlevel 1 goto fail
)

call :ensure_workstation_config
if errorlevel 1 goto fail

REM Wczytaj modelPath z config.json przez powershell
for /f "delims=" %%V in ('powershell -NoProfile -Command "(Get-Content '%CONFIG_FILE%' -Raw | ConvertFrom-Json).modelPath"') do set "MODEL_PATH=%%V"
if "%MODEL_PATH%"=="" ( echo [err] Brak modelPath w config.json & goto fail )
if not exist "%LLAMA_BIN%" (
  echo [err] Brak llama-server.exe: %LLAMA_BIN%
  echo [err] Uruchom bez --no-pull albo pobierz binary recznie do local-ai-proxy\bin.
  goto fail
)
if not exist "%MODEL_PATH%" (
  echo [err] Brak pliku modelu: %MODEL_PATH%
  echo [err] Uruchom start.bat --change-model i wybierz istniejacy plik GGUF.
  goto fail
)

REM --- Start llama-server ----------------------------------------------------
set "GPU_ARGS="
if /I not "%GPU%"=="cpu" set "GPU_ARGS=--n-gpu-layers 999"
set "EXTRA_ARGS=%GPU_ARGS%"
for /f "delims=" %%V in ('powershell -NoProfile -Command "$cfg=Get-Content '%CONFIG_FILE%' -Raw ^| ConvertFrom-Json; [int]$v=1; [void][int]::TryParse([string]$cfg.parallelSlots, [ref]$v); if ($v -lt 1) { $v=1 }; if ($v -gt 4) { $v=4 }; $v"') do set "PARALLEL_SLOTS=%%V"
if "%PARALLEL_SLOTS%"=="" set "PARALLEL_SLOTS=1"
if %PARALLEL_SLOTS% GTR 1 (
  "%LLAMA_BIN%" --help 2>&1 | findstr /C:"--parallel" >nul
  if not errorlevel 1 (
    set "EXTRA_ARGS=!EXTRA_ARGS! --parallel %PARALLEL_SLOTS%"
    echo [start] Advanced parallelSlots=%PARALLEL_SLOTS% aktywne w llama-server.
  ) else (
    echo [warn] Ten llama-server nie pokazuje flagi --parallel w --help. Stacja nadal zglosi parallelSlots=%PARALLEL_SLOTS%, ale serwer modelu zostaje bez tej flagi.
  )
)
for /f "tokens=1,* delims==" %%A in ('powershell -NoProfile -Command "$cfg=Get-Content '%CONFIG_FILE%' -Raw ^| ConvertFrom-Json; 'SD_ENABLED_CFG=' + ($(if ($cfg.sdEnabled -eq $true) { 'true' } else { 'false' })); 'DRAFT_MODEL_PATH_CFG=' + $cfg.draftModelPath; 'SPECULATIVE_TOKENS_CFG=' + ($(if ($cfg.speculativeTokens) { $cfg.speculativeTokens } else { 4 }))"') do set "%%A=%%B"
if /I "%SD_ENABLED_CFG%"=="true" (
  if "%DRAFT_MODEL_PATH_CFG%"=="" (
    echo [warn] SD wlaczone w config.json, ale brak draft modelu. Startuje bez SD.
  ) else if not exist "%DRAFT_MODEL_PATH_CFG%" (
    echo [warn] SD wlaczone w config.json, ale draft model nie istnieje: %DRAFT_MODEL_PATH_CFG%. Startuje bez SD.
  ) else (
    "%LLAMA_BIN%" --help 2>&1 | findstr /C:"--model-draft" >nul
    if not errorlevel 1 (
      set "EXTRA_ARGS=!EXTRA_ARGS! --model-draft "%DRAFT_MODEL_PATH_CFG%""
      "%LLAMA_BIN%" --help 2>&1 | findstr /C:"--draft-max" >nul
      if not errorlevel 1 set "EXTRA_ARGS=!EXTRA_ARGS! --draft-max %SPECULATIVE_TOKENS_CFG%"
      echo [start] Advanced SD eksperymentalne aktywne: %DRAFT_MODEL_PATH_CFG%
    ) else (
      echo [warn] SD zapisane w config.json, ale ten llama-server nie pokazuje --model-draft w --help. Startuje bez SD.
    )
  )
)
echo [start] Uruchamiam llama-server na porcie %LLAMA_PORT%
start "llama-server" /b cmd /c ""%LLAMA_BIN%" --model "%MODEL_PATH%" --host 127.0.0.1 --port %LLAMA_PORT% --ctx-size 4096 %EXTRA_ARGS% > "%LOGS_DIR%\llama-server.log" 2>&1"
if errorlevel 1 (
  echo [err] Nie udalo sie uruchomic llama-server. Sprawdz quote'y i log: %LOGS_DIR%\llama-server.log
  goto fail
)

REM Czekaj na health
echo [start] Czekam na llama-server (max 90s)...
set /a TRIES=0
:wait_llama
set /a TRIES+=1
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%LLAMA_PORT%/health' -TimeoutSec 1).StatusCode } catch { 0 }" | findstr "200" >nul
if not errorlevel 1 goto llama_ok
if !TRIES! GEQ 90 (
  echo [err] llama-server nie wystartowal w czasie. Sprawdz %LOGS_DIR%\llama-server.log
  goto fail
)
timeout /t 1 /nobreak >nul
goto wait_llama
:llama_ok
echo [start] llama-server gotowy.

REM --- Start proxy -----------------------------------------------------------
echo [start] Uruchamiam proxy na porcie %PROXY_PORT%
start "ai-proxy" /b cmd /c ""node" "%PROXY_DIR%\proxy.js" > "%LOGS_DIR%\proxy.log" 2>&1"
if errorlevel 1 (
  echo [err] Nie udalo sie uruchomic proxy. Sprawdz log: %LOGS_DIR%\proxy.log
  goto fail
)

set /a TRIES=0
:wait_proxy
set /a TRIES+=1
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%PROXY_PORT%/health' -TimeoutSec 1).StatusCode } catch { 0 }" | findstr "200" >nul
if not errorlevel 1 goto proxy_ok
if !TRIES! GEQ 15 (
  echo [err] proxy nie wystartowal w czasie. Sprawdz %LOGS_DIR%\proxy.log
  goto fail
)
timeout /t 1 /nobreak >nul
goto wait_proxy
:proxy_ok

REM --- Start agent stacji roboczej ------------------------------------------
echo [start] Uruchamiam agenta stacji roboczej
start "workstation-agent" /b cmd /c ""node" "%PROXY_DIR%\workstation-agent.js" > "%LOGS_DIR%\workstation-agent.log" 2>&1"
if errorlevel 1 (
  echo [err] Nie udalo sie uruchomic agenta stacji. Sprawdz log: %LOGS_DIR%\workstation-agent.log
  goto fail
)

echo.
echo ============================================================
echo   Lokalny runtime AI uruchomiony.
echo.
echo   llama-server   http://127.0.0.1:%LLAMA_PORT%
echo   proxy          http://127.0.0.1:%PROXY_PORT%
echo   station agent  %LOGS_DIR%\workstation-agent.log
echo   backend        %GPU%
echo.
echo   Otworz aplikacje (GitHub Pages) — frontend automatycznie
echo   wykryje proxy i przelaczy sie w tryb AI.
echo.
echo   Aby zatrzymac procesy: zamknij okno cmd, a nastepnie:
echo     taskkill /F /IM llama-server.exe
echo     taskkill /F /IM node.exe
echo ============================================================
echo.

goto finish

:configure_advanced
echo.
echo ============================================================
echo   Advanced -- opcje wydajnosci lokalnej stacji
echo ============================================================
echo   Domyslnie: parallelSlots=1, SD wylaczone.
echo   Zwiekszaj sloty tylko gdy masz zapas RAM/VRAM.
echo   SD jest eksperymentalne i wymaga osobnego draft modelu GGUF.
echo.
for /f "delims=" %%V in ('powershell -NoProfile -Command "$cfg=Get-Content '%CONFIG_FILE%' -Raw ^| ConvertFrom-Json; if ($cfg.parallelSlots) { $cfg.parallelSlots } else { 1 }"') do set "CURRENT_PARALLEL=%%V"
for /f "delims=" %%V in ('powershell -NoProfile -Command "$cfg=Get-Content '%CONFIG_FILE%' -Raw ^| ConvertFrom-Json; if ($cfg.speculativeTokens) { $cfg.speculativeTokens } else { 4 }"') do set "CURRENT_SPEC=%%V"
set /p "PARALLEL_INPUT=parallelSlots - ile jobow naraz (1-4) [!CURRENT_PARALLEL!]: "
if "!PARALLEL_INPUT!"=="" set "PARALLEL_INPUT=!CURRENT_PARALLEL!"
set /p "SD_INPUT=Wlaczyc SD / speculative decoding? (y/N): "
set "SD_ENABLED=false"
set "DRAFT_MODEL_PATH="
set "SPECULATIVE_TOKENS=!CURRENT_SPEC!"
if /I "!SD_INPUT!"=="y" set "SD_ENABLED=true"
if /I "!SD_INPUT!"=="yes" set "SD_ENABLED=true"
if /I "!SD_INPUT!"=="t" set "SD_ENABLED=true"
if /I "!SD_INPUT!"=="tak" set "SD_ENABLED=true"
if "!SD_ENABLED!"=="true" (
  set /p "DRAFT_MODEL_PATH=Sciezka do draft modelu GGUF dla SD: "
  set /p "SPECULATIVE_TOKENS=Speculative tokens / draft window (1-16) [!CURRENT_SPEC!]: "
  if "!SPECULATIVE_TOKENS!"=="" set "SPECULATIVE_TOKENS=!CURRENT_SPEC!"
  if "!DRAFT_MODEL_PATH!"=="" (
    echo [warn] SD wymaga draft modelu. Zostawiam SD wylaczone.
    set "SD_ENABLED=false"
  ) else if not exist "!DRAFT_MODEL_PATH!" (
    echo [warn] Draft model nie istnieje: !DRAFT_MODEL_PATH!. Zostawiam SD wylaczone.
    set "SD_ENABLED=false"
    set "DRAFT_MODEL_PATH="
  )
)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$file=$env:CONFIG_FILE; $cfg=Get-Content $file -Raw ^| ConvertFrom-Json;" ^
  "function Set-Prop($name,$value) { if ($cfg.PSObject.Properties.Name -contains $name) { $cfg.$name=$value } else { $cfg ^| Add-Member -NotePropertyName $name -NotePropertyValue $value } };" ^
  "[int]$parallel=1; [void][int]::TryParse($env:PARALLEL_INPUT, [ref]$parallel); if ($parallel -lt 1) { $parallel=1 }; if ($parallel -gt 4) { $parallel=4 };" ^
  "[int]$spec=4; [void][int]::TryParse($env:SPECULATIVE_TOKENS, [ref]$spec); if ($spec -lt 1) { $spec=1 }; if ($spec -gt 16) { $spec=16 };" ^
  "$sd=$env:SD_ENABLED -eq 'true'; $draft=if ($sd) { $env:DRAFT_MODEL_PATH } else { '' };" ^
  "Set-Prop 'parallelSlots' $parallel; Set-Prop 'sdEnabled' $sd; Set-Prop 'draftModelPath' $draft; Set-Prop 'draftModelName' $(if ($draft) { [IO.Path]::GetFileName($draft) } else { '' }); Set-Prop 'speculativeTokens' $spec; Set-Prop 'optimizationMode' $(if ($sd) { 'sd-experimental' } elseif ($parallel -gt 1) { 'parallel' } else { 'standard' });" ^
  "$cfg ^| ConvertTo-Json -Depth 8 ^| Set-Content -Encoding UTF8 $file"
if errorlevel 1 (
  echo [err] Nie udalo sie zapisac konfiguracji Advanced.
  exit /b 1
)
echo [start] Zapisano Advanced.
exit /b 0

:ensure_workstation_config
for /f "tokens=1,* delims==" %%A in ('powershell -NoProfile -Command "$cfg=Get-Content '%CONFIG_FILE%' -Raw ^| ConvertFrom-Json; 'WORKSTATION_NAME=' + $cfg.workstationName; 'SUPABASE_URL=' + $cfg.supabaseUrl; 'SUPABASE_KEY=' + $cfg.supabaseAnonKey; 'WORKSTATION_EMAIL=' + $cfg.workstationEmail; 'WORKSTATION_PASSWORD=' + $cfg.workstationPassword"') do set "%%A=%%B"
if not "!WORKSTATION_NAME!"=="" if not "!SUPABASE_URL!"=="" if not "!SUPABASE_KEY!"=="" if not "!WORKSTATION_EMAIL!"=="" if not "!WORKSTATION_PASSWORD!"=="" (
  echo [start] Uzywam zapisanej konfiguracji stacji roboczej.
  exit /b 0
)
echo.
echo ============================================================
echo   Konfiguracja stacji roboczej (jednorazowo)
echo ============================================================
echo   Ta stacja zaloguje sie do Supabase i bedzie odbierac joby
echo   wysylane z aplikacji w przegladarce.
echo.
if "!WORKSTATION_NAME!"=="" set "WORKSTATION_NAME=%COMPUTERNAME%"
set /p "WORKSTATION_NAME_INPUT=Nazwa stacji [!WORKSTATION_NAME!]: "
if not "!WORKSTATION_NAME_INPUT!"=="" set "WORKSTATION_NAME=!WORKSTATION_NAME_INPUT!"
if "!SUPABASE_URL!"=="" set "SUPABASE_URL=%DEFAULT_SUPABASE_URL%"
set /p "SUPABASE_URL_INPUT=Supabase URL [!SUPABASE_URL!]: "
if not "!SUPABASE_URL_INPUT!"=="" set "SUPABASE_URL=!SUPABASE_URL_INPUT!"
if "!SUPABASE_KEY!"=="" set "SUPABASE_KEY=%DEFAULT_SUPABASE_KEY%"
set /p "SUPABASE_KEY_INPUT=Supabase publishable key [!SUPABASE_KEY!]: "
if not "!SUPABASE_KEY_INPUT!"=="" set "SUPABASE_KEY=!SUPABASE_KEY_INPUT!"
set /p "WORKSTATION_EMAIL_INPUT=Email operatora stacji [!WORKSTATION_EMAIL!]: "
if not "!WORKSTATION_EMAIL_INPUT!"=="" set "WORKSTATION_EMAIL=!WORKSTATION_EMAIL_INPUT!"
if "!WORKSTATION_PASSWORD!"=="" (
  for /f "delims=" %%V in ('powershell -NoProfile -Command "$s=Read-Host 'Haslo operatora stacji' -AsSecureString; $b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }"') do set "WORKSTATION_PASSWORD=%%V"
)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$file=$env:CONFIG_FILE; $cfg=Get-Content $file -Raw ^| ConvertFrom-Json;" ^
  "function Set-Prop($name,$value) { if ($cfg.PSObject.Properties.Name -contains $name) { $cfg.$name=$value } else { $cfg ^| Add-Member -NotePropertyName $name -NotePropertyValue $value } };" ^
  "Set-Prop 'workstationName' $env:WORKSTATION_NAME; Set-Prop 'supabaseUrl' $env:SUPABASE_URL; Set-Prop 'supabaseAnonKey' $env:SUPABASE_KEY; Set-Prop 'workstationEmail' $env:WORKSTATION_EMAIL; Set-Prop 'workstationPassword' $env:WORKSTATION_PASSWORD;" ^
  "Set-Prop 'acceptsJobs' $true; Set-Prop 'scheduleEnabled' $false; Set-Prop 'scheduleStart' $null; Set-Prop 'scheduleEnd' $null;" ^
  "$cfg ^| ConvertTo-Json -Depth 8 ^| Set-Content -Encoding UTF8 $file"
if errorlevel 1 (
  echo [err] Nie udalo sie zapisac konfiguracji stacji roboczej.
  exit /b 1
)
echo [start] Zapisano konfiguracje stacji roboczej w config.json
exit /b 0

:fail
set "EXIT_CODE=1"
echo.
echo ============================================================
echo   start.bat zatrzymal sie z bledem.
echo.
echo   Najczestsze przyczyny:
echo   - brak Node.js 18+ w PATH,
echo   - niepobrany local-ai-proxy\bin\llama-server.exe,
echo   - zly albo przeniesiony plik modelu GGUF,
echo   - port 8080 lub 3001 zajety przez inny proces.
echo.
echo   Logi:
echo   %LOGS_DIR%\llama-server.log
echo   %LOGS_DIR%\proxy.log
echo   %LOGS_DIR%\workstation-agent.log
echo ============================================================
echo.

:finish
if "%NO_PAUSE%"=="1" goto exit_now
if "%EXIT_CODE%"=="0" goto keep_alive
echo Nacisnij dowolny klawisz, aby zamknac to okno...
pause >nul
goto exit_now

:keep_alive
echo Runtime dziala. Zostaw to okno otwarte, zeby procesy lokalnego AI nie zniknely.
echo Aby zatrzymac runtime: zamknij to okno, a potem uzyj taskkill z instrukcji powyzej.
echo.
:keep_alive_loop
timeout /t 3600 /nobreak >nul
goto keep_alive_loop

:exit_now

endlocal & exit /b %EXIT_CODE%

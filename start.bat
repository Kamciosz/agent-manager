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
REM    --reset           usuwa config.json
REM    --no-pull         pomija pobieranie binary i modelu
REM ============================================================================

setlocal EnableDelayedExpansion

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

if not exist "%BIN_DIR%"    mkdir "%BIN_DIR%"
if not exist "%MODELS_DIR%" mkdir "%MODELS_DIR%"
if not exist "%LOGS_DIR%"   mkdir "%LOGS_DIR%"

REM --- Flagi -----------------------------------------------------------------
set "CHANGE_MODEL=0"
set "NO_PULL=0"
:parse
if "%~1"=="" goto parsed
if /I "%~1"=="--change-model" set "CHANGE_MODEL=1"
if /I "%~1"=="--reset"        del /q "%CONFIG_FILE%" 2>nul & echo [start] Usunieto config.json.
if /I "%~1"=="--no-pull"      set "NO_PULL=1"
shift
goto parse
:parsed

REM --- Wymagania -------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo [err] Brak Node.js w PATH. Zainstaluj Node 18+ ze strony https://nodejs.org
  exit /b 1
)
where powershell >nul 2>nul
if errorlevel 1 (
  echo [err] Brak powershell.exe (potrzebny do pobrania binary).
  exit /b 1
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
      exit /b 1
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
    exit /b 1
  )
  set "MODEL_PATH="
  echo !MODEL_INPUT! | findstr /R "^http" >nul
  if not errorlevel 1 (
    REM URL — pobierz
    for %%F in ("!MODEL_INPUT!") do set "MODEL_FILENAME=%%~nxF"
    set "MODEL_PATH=%MODELS_DIR%\!MODEL_FILENAME!"
    if not exist "!MODEL_PATH!" (
      if "%NO_PULL%"=="1" (
        echo [start] [--no-pull] Pomijam pobieranie modelu.
      ) else (
        echo [start] Pobieram model do !MODEL_PATH!
        powershell -NoProfile -Command ^
          "Invoke-WebRequest -UseBasicParsing -Uri '!MODEL_INPUT!' -OutFile '!MODEL_PATH!'"
        if errorlevel 1 ( echo [err] Pobieranie modelu nieudane. & exit /b 1 )
      )
    )
  ) else (
    if not exist "!MODEL_INPUT!" (
      echo [err] Plik nie istnieje: !MODEL_INPUT!
      exit /b 1
    )
    for %%F in ("!MODEL_INPUT!") do set "MODEL_FILENAME=%%~nxF"
    set "MODEL_PATH=%MODELS_DIR%\!MODEL_FILENAME!"
    copy /Y "!MODEL_INPUT!" "!MODEL_PATH!" >nul
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
  >>"%CONFIG_FILE%" echo   "backend": "%GPU%"
  >>"%CONFIG_FILE%" echo }
  echo [start] Zapisano config.json
) else (
  echo [start] Uzywam modelu z config.json (zmien: start.bat --change-model)
)

REM Wczytaj modelPath z config.json przez powershell
for /f "delims=" %%V in ('powershell -NoProfile -Command "(Get-Content '%CONFIG_FILE%' -Raw | ConvertFrom-Json).modelPath"') do set "MODEL_PATH=%%V"
if "%MODEL_PATH%"=="" ( echo [err] Brak modelPath w config.json & exit /b 1 )

REM --- Start llama-server ----------------------------------------------------
set "GPU_ARGS="
if /I not "%GPU%"=="cpu" set "GPU_ARGS=--n-gpu-layers 999"
echo [start] Uruchamiam llama-server na porcie %LLAMA_PORT%
start "llama-server" /b cmd /c ""%LLAMA_BIN%" --model "%MODEL_PATH%" --host 127.0.0.1 --port %LLAMA_PORT% --ctx-size 4096 %GPU_ARGS% > "%LOGS_DIR%\llama-server.log" 2>&1"

REM Czekaj na health
echo [start] Czekam na llama-server (max 90s)...
set /a TRIES=0
:wait_llama
set /a TRIES+=1
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%LLAMA_PORT%/health' -TimeoutSec 1).StatusCode } catch { 0 }" | findstr "200" >nul
if not errorlevel 1 goto llama_ok
if !TRIES! GEQ 90 (
  echo [err] llama-server nie wystartowal w czasie. Sprawdz %LOGS_DIR%\llama-server.log
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait_llama
:llama_ok
echo [start] llama-server gotowy.

REM --- Start proxy -----------------------------------------------------------
echo [start] Uruchamiam proxy na porcie %PROXY_PORT%
start "ai-proxy" /b cmd /c "node "%PROXY_DIR%\proxy.js" > "%LOGS_DIR%\proxy.log" 2>&1"

set /a TRIES=0
:wait_proxy
set /a TRIES+=1
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%PROXY_PORT%/health' -TimeoutSec 1).StatusCode } catch { 0 }" | findstr "200" >nul
if not errorlevel 1 goto proxy_ok
if !TRIES! GEQ 15 (
  echo [err] proxy nie wystartowal w czasie. Sprawdz %LOGS_DIR%\proxy.log
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait_proxy
:proxy_ok

echo.
echo ============================================================
echo   Lokalny runtime AI uruchomiony.
echo.
echo   llama-server   http://127.0.0.1:%LLAMA_PORT%
echo   proxy          http://127.0.0.1:%PROXY_PORT%
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

endlocal

# Agent Manager

System zarządzania agentami AI — AI kierownik przyjmuje zadania od użytkownika, rozkłada je na części, rozdziela między agenty wykonawcze, monitoruje postęp i raportuje wyniki. Wszystko działa przez przeglądarkę, bez instalacji czegokolwiek.

## Jak to działa (prosto)

1. Otwierasz aplikację w przeglądarce
2. Wpisujesz zadanie (np. „Zrób mi stronę logowania")
3. AI kierownik sam decyduje ilu agentów wykonawczych potrzeba i co każdy ma robić
4. Agenty wykonawcze realizują zadanie i komunikują się ze sobą na bieżąco
5. Widzisz postęp w czasie rzeczywistym — bez odświeżania strony
6. Gotowe zadanie wraca do Ciebie

Nie ma żadnej instalacji, terminala, ani serwera do uruchamiania. Każdy komputer z przeglądarką i internetem może być agentem — działa na szkolnym WiFi.

## Szybki start (dla użytkownika)

1. Wejdź na link aplikacji (GitHub Pages — link w zakładce „About" repozytorium)
2. Zarejestruj się emailem i hasłem
3. Manager przypisze Ci rolę
4. Gotowe

## Szybki start (dla właściciela projektu — jednorazowy setup)

Zobacz [FORK_GUIDE.md](FORK_GUIDE.md) — ~10 minut klikania, zero kodu.

## Technologia

| Warstwa | Rozwiązanie | Koszt |
|---------|------------|-------|
| Interfejs webowy | GitHub Pages | Darmowy |
| Baza zadań i historia | Supabase (PostgreSQL) | Darmowy |
| Komunikacja w czasie rzeczywistym | Supabase Realtime (WebSocket) | Darmowy |
| Logowanie i konta | Supabase Auth | Darmowy |
| Automatyczny deploy | GitHub Actions | Darmowy |

Wszystkie połączenia przez port 443 (HTTPS) — działa na szkolnym i firmowym WiFi.

## Lokalny AI (opcjonalnie)

Domyślnie aplikacja działa w **trybie demo** — manager i executor używają sztywnych odpowiedzi. Możesz włączyć **prawdziwy lokalny model językowy** (llama.cpp + GGUF) jednym poleceniem — wybierz skrypt **odpowiedni dla swojego systemu**:

| System operacyjny | Polecenie | Plik |
|-------------------|-----------|------|
| 🍎 **macOS** (Intel + Apple Silicon) | `./start.sh` | [start.sh](start.sh) |
| 🐧 **Linux** (Ubuntu, Debian, Fedora, Arch…) | `./start.sh` | [start.sh](start.sh) |
| 🪟 **Windows 10 / 11** | `start.bat` | [start.bat](start.bat) |

> ⚠️ Nie uruchamiaj `start.sh` na Windowsie ani `start.bat` na macOS/Linux — każdy skrypt sam wykrywa OS i odmówi startu na niewłaściwym systemie.

Skrypt sam pobierze binary `llama-server`, wykryje GPU (Apple Metal / NVIDIA CUDA / AMD ROCm / Vulkan / CPU), zapyta o model GGUF (URL HuggingFace lub plik lokalny) i uruchomi lokalne proxy. Frontend automatycznie wykryje proxy i przełączy się w tryb AI — w headerze pojawi się zielony badge **„AI lokalny”**. Wszystko offline, bez kosztów, bez kont.

Szczegóły, flagi i troubleshooting: [local-ai-proxy/README.md](local-ai-proxy/README.md).

Szczegóły, flagi i troubleshooting: [local-ai-proxy/README.md](local-ai-proxy/README.md).

## Dokumentacja

| Sekcja | Plik |
|--------|------|
| **Nawigacja po docs** | [docs/index.md](docs/index.md) |
| Wizja i założenia | [docs/concept/vision.md](docs/concept/vision.md) |
| Role w systemie | [docs/concept/roles.md](docs/concept/roles.md) |
| Architektura — przegląd | [docs/architecture/overview.md](docs/architecture/overview.md) |
| Komunikacja AI↔AI | [docs/architecture/communication.md](docs/architecture/communication.md) |
| Profile agentów | [docs/architecture/agent-profiles.md](docs/architecture/agent-profiles.md) |
| Ustawienia repo i autodebug | [docs/architecture/repo-settings.md](docs/architecture/repo-settings.md) |
| Zakres MVP 1.0.0 | [docs/product/mvp-scope.md](docs/product/mvp-scope.md) |
| Specyfikacja UI/UX | [docs/product/ui-spec.md](docs/product/ui-spec.md) |
| Struktura projektu | [docs/dev/repo-map.md](docs/dev/repo-map.md) |
| Supabase — jak używać | [docs/dev/api-reference.md](docs/dev/api-reference.md) |
| Testy i weryfikacja | [docs/dev/testing.md](docs/dev/testing.md) |
| Jak forknąć i uruchomić | [FORK_GUIDE.md](FORK_GUIDE.md) |

# FORK_GUIDE — własna kopia Agent Manager

Ten przewodnik prowadzi przez uruchomienie własnego forka: GitHub Pages jako UI i Supabase jako backend. Terminal nie jest potrzebny do samego deployu UI, ale migracje bazy trzeba zastosować jawnie w Supabase.

## Co dostajesz

```
GitHub Pages                 Supabase
statyczny panel UI   <->     Auth + Postgres + Realtime
```

Nie hostujesz własnego serwera. GitHub Actions publikuje pliki z `ui/`, a Supabase trzyma dane, logowanie i realtime.

## Krok 1 — fork repozytorium

1. Otwórz repozytorium na GitHub.
2. Kliknij **Fork**.
3. Wybierz swoje konto i utwórz kopię.

## Krok 2 — utwórz projekt Supabase

1. Wejdź na https://supabase.com.
2. Kliknij **New project**.
3. Wybierz organizację, nazwę i region.
4. Poczekaj, aż projekt będzie gotowy.

## Krok 3 — zastosuj migracje SQL

Workflow GitHub Pages **nie stosuje migracji bazy danych**. Zrób to ręcznie jedną z dwóch metod.

Metoda bez terminala:

1. W Supabase otwórz **SQL Editor**.
2. Otwórz pliki z [supabase/migrations](supabase/migrations) w kolejności nazw.
3. Wklej zawartość każdego pliku i kliknij **Run**.
4. Jeśli plik jest już zastosowany, większość poleceń jest idempotentna (`if not exists`, `drop policy if exists`).

Metoda dla osób technicznych:

1. Użyj Supabase CLI albo narzędzi MCP Supabase.
2. Zastosuj migracje z [supabase/migrations](supabase/migrations).
3. Po zmianach uruchom security/performance advisors.

## Krok 4 — skopiuj wartości API

W Supabase przejdź do **Settings → API** i skopiuj:

- Project URL, np. `https://twoj-projekt.supabase.co`
- publishable/anon key

Publishable/anon key może być użyty publicznie w frontendzie, ale bezpieczeństwo danych zależy od RLS. Nie używaj service-role key w tym repozytorium.

## Krok 5 — wdróż Edge Functions dla tokenów stacji

Tokeny instalacyjne stacji wymagają zaufanej funkcji po stronie Supabase. Wdróż funkcje z [supabase/functions](supabase/functions):

- `create-workstation-enrollment`,
- `redeem-workstation-enrollment`.

W Supabase ustaw sekret `SUPABASE_SERVICE_ROLE_KEY` wyłącznie dla Edge Functions. Nie dodawaj go do GitHub Secrets Pages, kodu UI, launchera ani `config.json`.

Przykład przez Supabase CLI:

```bash
supabase link --project-ref TWOJ_PROJECT_REF
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=WKLEJ_SERVICE_ROLE_KEY_Z_PANELU_SUPABASE
supabase functions deploy create-workstation-enrollment
supabase functions deploy redeem-workstation-enrollment --no-verify-jwt
```

`SUPABASE_URL` i `SUPABASE_ANON_KEY` są dostępne dla Edge Functions z runtime Supabase; service-role key ustawiasz osobno, tylko jako sekret funkcji.
`redeem-workstation-enrollment` ma wyłączone JWT verification, bo stacja nie ma jeszcze sesji użytkownika; sekretem wejściowym jest jednorazowy token instalacyjny.

## Krok 6 — dodaj GitHub Secrets

W swoim forku GitHub:

1. Wejdź w **Settings → Secrets and variables → Actions**.
2. Dodaj sekret `SUPABASE_URL` z Project URL.
3. Dodaj sekret `SUPABASE_ANON_KEY` z publishable/anon key.

## Krok 7 — włącz GitHub Pages

1. Wejdź w **Settings → Pages**.
2. W sekcji **Source** wybierz **GitHub Actions**.
3. Zapisz ustawienie.

## Krok 8 — uruchom deploy

1. Wejdź w **Actions**.
2. Wybierz workflow **Deploy to GitHub Pages**.
3. Kliknij **Run workflow**.
4. Po zakończeniu otwórz link z **Settings → Pages**.

Deploy robi tylko dwie rzeczy:

- podmienia placeholdery Supabase w [ui/app.js](ui/app.js),
- publikuje folder `ui/` na GitHub Pages.

Nie dotyka schematu Supabase.

## Krok 9 — pierwsze konto

1. Otwórz swoją aplikację Pages.
2. Zarejestruj konto.
3. W widoku **Stacje robocze** wygeneruj token instalacyjny.
4. Dodaj pierwsze polecenie albo podłącz stację roboczą.

## Krok 10 — lokalna stacja robocza

Na komputerze, który ma uruchamiać lokalny model GGUF:

- Windows: dwuklik [start.bat](start.bat)
- macOS: dwuklik [start.command](start.command)
- Linux: `./start.sh`

Pierwszy start zapyta o:

- model GGUF,
- nazwę stacji,
- Supabase URL,
- publishable/anon key,
- token instalacyjny z dashboardu,
- origin aplikacji Pages, np. `https://twoj-login.github.io`.

Origin jest potrzebny, bo lokalny proxy nie przyjmuje już requestów z dowolnej strony.
Hasło operatora nie jest wpisywane na stacji i nie powinno pojawić się w `local-ai-proxy/config.json`.

## Aktualizacje

Dla nietechnicznego użytkownika:

- Windows: dwuklik [Aktualizuj.bat](Aktualizuj.bat)
- macOS/Linux: dwuklik [Aktualizuj.command](Aktualizuj.command)

Dla terminala:

```bash
./start.sh --update
```

```cmd
start.bat --update
```

Update jest bezpieczny: jeśli katalog ma lokalne zmiany, launcher pominie `git pull` i pokaże ostrzeżenie.

## Najczęstsze problemy

| Objaw | Co zrobić |
|-------|-----------|
| Aplikacja nie ładuje danych | Sprawdź GitHub Secrets i czy migracje Supabase zostały zastosowane |
| Rejestracja działa, ale tabele puste/błędy RLS | Zastosuj migracje z [supabase/migrations](supabase/migrations) jeszcze raz w kolejności |
| Lokalny AI nie łączy się z aplikacją | Uruchom `--doctor`, sprawdź `allowedOrigins` w `local-ai-proxy/config.json` |
| Windows okno znika | Uruchom `start.bat --doctor --no-pause` z `cmd.exe` |
| Update nic nie zmienia | Repo ma lokalne zmiany albo nie jest klonem git; to bezpieczne zachowanie |

## Czego nie robić

- Nie commituj `local-ai-proxy/config.json`.
- Nie wpisuj service-role key do repozytorium ani do GitHub Pages.
- Nie ustawiaj lokalnego proxy na publiczny adres sieciowy.
- Nie zakładaj, że deploy Pages zmieni bazę danych. Migracje stosuj jawnie.

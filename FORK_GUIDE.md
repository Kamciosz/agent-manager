# FORK_GUIDE — własna kopia Agent Manager

Ten przewodnik jest tylko dla osoby, która zakłada własną kopię. Jeśli chcesz po prostu korzystać z gotowej aplikacji, wróć do [README.md](README.md).

Większość kroków da się wykonać klikaniem w przeglądarce. Terminal jest potrzebny tylko w opcjonalnym wariancie technicznym dla migracji i funkcji Edge.

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

## Krok 3 — zastosuj migracje SQL bez terminala

Workflow GitHub Pages **nie stosuje migracji bazy danych**. Zrób to ręcznie jedną z dwóch metod.

Metoda bez terminala:

1. W Supabase otwórz **SQL Editor**.
2. Jeśli to **nowy projekt od zera**, otwórz plik [supabase/setup_from_zero.sql](supabase/setup_from_zero.sql).
3. Wklej całą zawartość i kliknij **Run**.
4. Jeśli aktualizujesz **już istniejącą kopię**, używaj tylko nowych plików z [supabase/migrations](supabase/migrations) w kolejności nazw. Stary łańcuch krok po kroku został schowany do [supabase/migrations/archive](supabase/migrations/archive), żeby główny katalog był prosty.

Opcjonalnie dla osób technicznych:

1. Użyj Supabase CLI albo narzędzi MCP Supabase.
2. Dla nowego projektu od zera zastosuj [supabase/setup_from_zero.sql](supabase/setup_from_zero.sql), a dla istniejącego projektu tylko brakujące pliki z [supabase/migrations](supabase/migrations). Starsze pliki referencyjne są w [supabase/migrations/archive](supabase/migrations/archive).
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
supabase secrets set ALLOWED_APP_ORIGINS=https://TWOJ_LOGIN.github.io
supabase functions deploy create-workstation-enrollment
supabase functions deploy redeem-workstation-enrollment --no-verify-jwt
```

`SUPABASE_URL` i `SUPABASE_ANON_KEY` są dostępne dla Edge Functions z runtime Supabase; service-role key ustawiasz osobno, tylko jako sekret funkcji.
`ALLOWED_APP_ORIGINS` to lista originów oddzielonych przecinkami, które mogą wywoływać tokenowe Edge Functions z przeglądarki. Domyślnie funkcje dopuszczają Twój własny adres GitHub Pages, `http://localhost` i `http://127.0.0.1`; fork powinien dopisać własny origin.
`redeem-workstation-enrollment` ma wyłączone JWT verification, bo stacja nie ma jeszcze sesji użytkownika; sekretem wejściowym jest jednorazowy token instalacyjny.

Jeśli nie chcesz używać terminala, poproś osobę techniczną o wykonanie tego kroku albo zrób tylko konfigurację UI i bazy, a stacje dołącz później.

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

## Po deployu — pierwsze konto i rola panelu

1. Otwórz swoją aplikację Pages.
2. Zarejestruj konto.
3. W Supabase otwórz **Authentication → Users**, wybierz konto i w **Raw app meta data** ustaw rolę panelu, np.:

```json
{ "role": "operator" }
```

4. Wyloguj się i zaloguj ponownie w aplikacji Pages, żeby token JWT dostał nową rolę.
5. W widoku **Stacje robocze** wygeneruj token instalacyjny.
6. Dodaj pierwsze polecenie albo podłącz stację roboczą.

Konta bez roli panelowej mogą się uwierzytelnić w Supabase, ale RLS nie pozwoli im czytać ani zmieniać danych aplikacji. To chroni panel, jeśli uczeń otworzy publiczny adres Pages i spróbuje samodzielnie utworzyć konto.

## Po deployu — lokalna stacja robocza

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
| Rejestracja działa, ale tabele puste/błędy RLS | Dla nowego projektu uruchom ponownie [supabase/setup_from_zero.sql](supabase/setup_from_zero.sql); dla istniejącej kopii dołóż brakujące pliki z [supabase/migrations](supabase/migrations) |
| Lokalny AI nie łączy się z aplikacją | Uruchom `--doctor`, sprawdź `allowedOrigins` w `local-ai-proxy/config.json` |
| Windows okno znika | Uruchom `start.bat --doctor --no-pause` z `cmd.exe` |
| Update nic nie zmienia | Repo ma lokalne zmiany albo nie jest klonem git; to bezpieczne zachowanie |

## Czego nie robić

- Nie commituj `local-ai-proxy/config.json`.
- Nie wpisuj service-role key do repozytorium ani do GitHub Pages.
- Nie ustawiaj lokalnego proxy na publiczny adres sieciowy.
- Nie zakładaj, że deploy Pages zmieni bazę danych. Migracje stosuj jawnie.

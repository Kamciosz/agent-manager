# Krytyczny QA alpha

Ten dokument zapisuje test w dwóch rolach: bardzo surowy tester oraz nietechniczny użytkownik. Ma być listą tarć, które realnie blokują alpha, a nie marketingowym opisem.

## Tester w złym humorze

| Problem | Ryzyko | Status po tej rundzie |
|---------|--------|------------------------|
| Launcher miał prawdziwy domyślny URL/key Supabase | Forki mogły przypadkiem podpinać się pod cudzy projekt | Naprawione: launchery wymagają własnych danych |
| Lokalny proxy miał CORS `*` | Dowolna strona mogła próbować wołać lokalny LLM użytkownika | Naprawione: allowlista originów |
| `config.json` zawierał hasło operatora w legacy flow | Uczeń z dostępem do pliku mógłby próbować wejść do panelu | Naprawione kierunkowo: nowy flow używa tokenu instalacyjnego i ograniczonej sesji stacji; legacy pokazuje ostrzeżenie migracyjne |
| Brak jawnego RLS enable dla bazowych tabel w aktualnych migracjach | Polityki bez RLS nie bronią danych | Naprawione migracją jawnie włączającą RLS |
| FORK_GUIDE obiecywał automatyczne migracje | Użytkownik kończył z pustą/niedziałającą bazą | Naprawione: deploy UI i migracje są rozdzielone |
| Windows/macOS/Linux nie miały symetrycznych smoke testów | Poprawka jednej platformy mogła psuć drugą | Ograniczone: dodany unix smoke, Windows smoke już istnieje |
| Brak paczki instalacyjnej, repo wyglądało zbyt technicznie | Nietech użytkownik nie wie, co kliknąć | Ograniczone: workflow pakuje launchery do ZIP |
| `app.js` nadal jest duży | Ryzyko regresji przy kolejnych zmianach UI | Częściowo: wydzielono `settings.js`; dalszy refaktor zostaje |

## Nietech użytkownik w złym humorze

| Co widzę | Co myślę | Status po tej rundzie |
|----------|----------|------------------------|
| „Dodaj zadanie”, „Tytuł”, „Opis” | Nie wiem, czy to zadanie dla mnie czy dla AI | Naprawione: formularz mówi „polecenie dla AI” |
| `Kontekst (JSON lub tekst)` | Nie wiem co to JSON i boję się zepsuć | Naprawione: zastąpione linkami, wymaganiami i zakazami |
| `parallelSlots`, SD, kontekst przy dodawaniu polecenia | To wygląda jak konfiguracja komputera, nie polecenie | Naprawione: przeniesione do widoku stacji |
| Wybór stacji | Nie wiem, czy można wybrać kilka | Naprawione: domyślnie „Automatycznie” albo jedna stacja |
| Repozytorium opcjonalne | Nie wiem, jaki format wpisać | Ograniczone: placeholder, tooltip i ostatnie sugestie |
| Nie widzę języka ani koloru | Nie wiem, gdzie zmienić UI | Naprawione: dodany widok Ustawienia |
| Aktualizacja przez terminal | Nie wiem, jaka flaga | Naprawione: `Aktualizuj.bat` i `Aktualizuj.command` |
| Okno launchera się zamyka | Nie wiem, co się stało | Ograniczone wcześniejszym `--doctor`, logami i wrapperem BAT |

## Co zostało świadomie odłożone

| Temat | Powód |
|-------|-------|
| Pełne tłumaczenie całego UI PL/EN | Wymaga szerszego i18n wszystkich stringów dynamicznych; ustawienie języka jest już widoczne i zapisywane |
| Pełna aplikacja desktopowa | To zmienia stack i koszt utrzymania; alpha zostaje przy GitHub Pages + launcherach |
| Podpisywanie paczek Windows/macOS | Wymaga certyfikatów i procesu release; obecnie są smoke-tested artifacts |
| Prawdziwe organizacje/workspaces w RLS | Obecny MVP działa jako team-space authenticated; multi-tenant to większa zmiana produktu |

## Checklist przed wydaniem alpha

- [ ] GitHub Actions: deploy, security scan, Windows smoke, unix smoke, package launchers przechodzą.
- [ ] Supabase migrations zastosowane w testowym projekcie.
- [ ] Bez sesji nie da się czytać `tasks`, `assignments`, `messages`, `agents`.
- [ ] Użytkownik potrafi dodać polecenie bez znajomości JSON.
- [ ] Stacja pokazuje się po uruchomieniu launchera i `--doctor` daje czytelny raport.
- [ ] Paczka ZIP ma launcher na wierzchu i krótki `README-START.txt`.

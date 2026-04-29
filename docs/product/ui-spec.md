# UI Spec — interfejs Agent Manager

Data: 27 kwietnia 2026

Maksymalnie prosty interfejs dla użytkowników nietechnicznych. Każdy kluczowy flow ma jedną dominującą akcję; opcje zaawansowane są zwinięte, a domyślne ustawienia minimalizują liczbę decyzji.

## Persony

| Persona | Rola |
|---------|------|
| Manager | Tworzy zadania, przydziela, uruchamia debug, przegląda raporty |
| Executor | Odbiera zadania, aktualizuje status, wysyła raporty |
| Viewer | Przegląda zadania i raporty (readonly) |

## Główne zasady UX

- Jeden ekran = jedna główna akcja (np. „Dodaj polecenie").
- Wizard / formularz krokowy dla `submitTask` (3 kroki).
- Duże, czytelne przyciski i krótki tekst CTA: „Dodaj polecenie", „Przypisz", „Uruchom diagnostykę".
- „Advanced" ukryte pod accordeonem — domyślnie wyłączone.
- Onboarding: jednorazowy tour + dane demo.
- Błyskawiczny feedback: toast + link do utworzonego zasobu.
- Mobile-friendly, keyboard accessible, aria labels.

## Ekrany

### 1. Dashboard

- Duże CTA: `Dodaj polecenie`, `Moje polecenia`, `Kolejka`, `Raporty`.
- Panel stanu: liczba zadań (pending/in_progress/done), health gateway (Connected / Limited / No internet).
- Szybkie akcje: „Szybki szablon" (one-click create) i wyszukiwarka.

### 2. Submit Task (wizard — 3 kroki)

**Krok 1 — Wybierz szablon:** Bug / Refactor / Tests / Custom / Hermes Labyrinth.

**Krok 2 — Dane minimalne:**
- `Title`* (wymagane)
- `Short description`* (wymagane)
- `Priority` (domyślnie: Medium)
- `Repo` (opcjonalne)
- `Stacja robocza` (opcjonalne, lista online/offline)
- `Model` (opcjonalne; aktywuje się po wyborze stacji)
- Linki/pliki pomocnicze, wymagania i zakazy jako proste pola tekstowe.
- Hermes Labyrinth pokazuje mapę bram i zapisuje workflow w `tasks.context.raw.workflow`.

**Krok 3 — Przegląd i wyślij.** Przyciski: `Wyślij` (primary), `Zapisz jako szkic`.

Advanced (zwinięte): przypisanie, termin, środowisko, retry policy.

Szablon Hermes Labyrinth nie pokazuje JSON użytkownikowi. Wypełnia domyślny opis, wymagania i zakazy, a AI kierownik używa ról Navigator/Scout/Builder/Verifier/Scribe jako kontekstu orkiestracji.

Po wysłaniu: toast + przycisk `Przejdź do zadania`.

### 3. Task List

- Tabela: ID | Polecenie | Status | Priorytet | Data | Akcje
- Filtry górne: status, priorytet, przypisane/nieprzypisane, search.
- Akcje w wierszu: klik wiersza pokazuje szczegóły; `Usuń` usuwa polecenie po potwierdzeniu.

### 4. Task Detail

- Nagłówek z tytułem i statusem, timeline statusów, log preview, debug summary.
- Przycisk `Usuń polecenie` w nagłówku usuwa bieżące zadanie po potwierdzeniu.
- Duży przycisk `Uruchom diagnostykę` (jeśli dostępny) i `Przypisz` (jeśli brak przypisania).
- Sekcja `Komunikacja ze stacją` z przyciskiem `Wyślij wiadomość do stacji`.
- Meta pola: przypisana `Stacja` i `Model`.

### 4a. Słownik pojęć

- Przycisk `Co to znaczy?` w górnym pasku otwiera modal wyjaśniający pojęcia: polecenie/zadanie, stacja robocza, model, panel online.
- Ten sam modal wyjaśnia statusy techniczne: `pending`, `analyzing`, `in_progress`, `done`, `failed`.
- Słownik ma być krótki i operacyjny; bez marketingowego onboardingu.

### 5. Assign modal

- Rekomendacje (1–3 sugestie) z krótkim uzasadnieniem (np. „skills match: python, wolny").
- Prosta lista i „Potwierdź".

### 6. Autodebug flow

`Uruchom diagnostykę` → spinner → karta wyników z 3 głównymi wnioskami + `Pobierz raport` + `Utwórz zgłoszenie`.

### 7. Agent Profiles

Lista profili + `Dodaj profil` modal: name, role, skills (tagi), concurrencyLimit. Pola zaawansowane ukryte domyślnie.

### 8. Settings (minimal)

- **Połączenie:** auto-detect gateway (domyślnie ON) — nie wymaga konfiguracji sieciowej od użytkownika.
- **Admin** (tylko managerzy): advanced network, export/import config.

### 9. Stacje robocze

- Tabela: Nazwa | Typ | Sala / pozycja | Platforma | Model | Status | Advanced | Ostatnio widziana | Akcje.
- Główne akcje w wierszu: `Edytuj`, `Wyślij wiadomość`, `Aktualizuj`, `Wstrzymaj`, `Wznów`, `Odśwież`.
- Widok ma charakter operacyjny: pokazuje komputery uruchomione przez `start.command` / `start.sh`, a nie ręcznie tworzone rekordy.
- MacBook operatora ma typ `operator`, nie trafia na plan sali i nie jest wybierany do jobów. Stacje szkolne mają typ `classroom` i pochodzą z tokenów wygenerowanych przez operatora.
- Kolumna `Advanced` pokazuje `activeJobs/parallelSlots`, kontekst, KV cache oraz stan SD.
- Panel `Plan sali` zapisuje siatkę sali nawet wtedy, gdy część pól jest pusta, np. `226`, 4 rzędy po 6 komputerów, z podpisami `226_2_5`. Pozycje można zmieniać przez edycję stacji albo przeciąganie kafelków.

### 10. Monitor

- Karty: aktywne zadania, wolne sloty stacji, stacje bez świeżego heartbeat.
- Lista `Zadania w ruchu` pozwala wejść bezpośrednio do Task Detail.
- Lista `Stacje robocze` pokazuje status, sloty i ostrzeżenie `Może stać`, gdy heartbeat jest stary.
- Panel `Monitor stacji` pokazuje szczegóły wybranej stacji: sloty, kontekst, KV, SD, harmonogram, platformę, heartbeat, modele i porty runtime. Te same komendy stacji, które są w tabeli stacji, są dostępne także tutaj, bo operator często reaguje podczas obserwacji monitora.
- `Live log` zbiera ostatnie wpisy z `messages` i `workstation_messages`, w tym postęp jobów ze stacji.

### 11. Advanced runtime

- Widok `Advanced` pokazuje `parallelSlots`, aktywne joby, kontekst, KV cache, SD, harmonogram, porty, timeout, tryb optymalizacji i draft model raportowane przez stacje.
- Formularz dodawania polecenia nie pokazuje `parallelSlots`, SD ani JSON. Te ustawienia należą do konfiguracji stacji roboczej.
- Widok `Stacje robocze` zawiera konfigurator pól lokalnego runtime: tryb operator/classroom, przyjmowanie jobów, porty, origin aplikacji, ścieżkę modelu, równoległe zadania, kontekst modelu, KV cache, SD, draft model, timeout, harmonogram start/koniec, zachowanie poza oknem pracy, dump diagnostyczny i auto-update. UI generuje instrukcję oraz podgląd `config.json`, ale nie zapisuje lokalnego pliku przez przeglądarkę.
- Siatki sal można tworzyć, zmieniać i usuwać bez kasowania rekordów stacji; usunięcie siatki zdejmuje przypisanie sali/pozycji z komputerów tej sali.
- Stacja w poleceniu ma tryb `Automatycznie - AI wybierze stację`, dokładnie jedną wskazaną stację z listy albo wybór kafelkiem.
- `parallelSlots` jest ustawieniem lokalnego runtime; domyślnie `1`, zakres `1-4`.
- Kontekst jest ustawieniem lokalnego runtime; domyślnie `64k` z `q8_0` KV cache (~50% pamięci KV), opcjonalnie `native` i presety do `256k`.
- KV cache ma tryby stock llama.cpp (`auto`, `f16`, `q8_0`, `q4_0` i pokrewne) oraz zaawansowane typy RotorQuant/Planar/Iso/Turbo (`iso3/iso3`, `planar3/f16`, `planar3`, `iso3`, `planar4`, `iso4`, `turbo3`, `turbo4`) dla kompatybilnych buildów.
- SD jest domyślnie wyłączone i opisane jako eksperymentalne; wymaga draft modelu oraz kompatybilnego `llama-server` z aktualnymi flagami speculative decoding.
- Frontend tylko pokazuje te ustawienia. Zapis odbywa się lokalnie przez `start.sh --config`, `start.bat --config`, `--advanced` albo domyślne wartości w launcherze.

### 12. Wiadomość do stacji

- Mały modal z nazwą celu i jednym polem tekstowym.
- Użycie: doprecyzowanie zadania, wymuszenie konkretnego modelu, prośba o raport.
- Po wysłaniu: toast `Wiadomość wysłana do stacji` i dopisanie do sekcji komunikacji w Task Detail.

## Copy & Tone

- Zwięzłe polecenia: „Dodaj polecenie", „Pokaż polecenie", „Uruchom diagnostykę".

## Ustawienia użytkownika

- Widok `Ustawienia` jest dostępny z lewego menu.
- Preferencje są lokalne dla przeglądarki i zapisują się w `localStorage`.
- Zakres alpha: motyw `system/jasny/ciemny`, język `pl/en`, domyślne repozytorium i domyślna stacja.
- Pełne tłumaczenie wszystkich stringów dynamicznych jest odłożone; widoczny przełącznik języka przygotowuje UX i strukturę preferencji.
- Unikaj skrótów technicznych; podpowiedzi inline w miejscu akcji.

## Dostępność i błędy

- Komunikaty błędów: jasna informacja co poszło nie tak + co zrobić dalej.
- Retry / fallback przy błędach sieciowych.
- Automatyczny zapis szkicu przy utracie połączenia.

## Kryteria akceptacji UI

- Użytkownik nietechniczny tworzy zadanie w ≤ 3 kliknięciach i ≤ 2 polach wymaganych.
- Manager przypisuje zadanie w ≤ 2 kliknięciach (wiersz → rekomendowany → potwierdź).
- Debug dostępny na stronie zadania i zwraca raport z `logs`, `traces`, `suggested_fix`.
- Interfejs nie wymaga ręcznej konfiguracji sieciowej (auto-detect, NAT ok).

## Rekomendacja techniczna

- **Szybki prototyp:** Appsmith / Retool / Budibase (formularze + tabele + akcje HTTP).
- **Produkcja:** prosty React/Preact app z komponentami formularza i serwerem API.

## Kolejne deliverables

- `user-flows.md` — szczegółowe flowy krok po kroku
- `wireframes/submit-task.md` — minimalistyczne wireframe'y (ASCII lub PNG)
- `ui-copy.md` — końcowe teksty przycisków i komunikatów

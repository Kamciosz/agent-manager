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

- Jeden ekran = jedna główna akcja (np. „Dodaj zadanie").
- Wizard / formularz krokowy dla `submitTask` (3 kroki).
- Duże, czytelne przyciski i krótki tekst CTA: „Dodaj zadanie", „Przypisz", „Uruchom diagnostykę".
- „Advanced" ukryte pod accordeonem — domyślnie wyłączone.
- Onboarding: jednorazowy tour + dane demo.
- Błyskawiczny feedback: toast + link do utworzonego zasobu.
- Mobile-friendly, keyboard accessible, aria labels.

## Ekrany

### 1. Dashboard

- Duże CTA: `Dodaj zadanie`, `Moje zadania`, `Kolejka`, `Raporty`.
- Panel stanu: liczba zadań (pending/in_progress/done), health gateway (Connected / Limited / No internet).
- Szybkie akcje: „Szybki szablon" (one-click create) i wyszukiwarka.

### 2. Submit Task (wizard — 3 kroki)

**Krok 1 — Wybierz szablon:** Bug / Refactor / Tests / Custom.

**Krok 2 — Dane minimalne:**
- `Title`* (wymagane)
- `Short description`* (wymagane)
- `Priority` (domyślnie: Medium)
- `Repo` (opcjonalne)
- `Stacja robocza` (opcjonalne, lista online/offline)
- `Model` (opcjonalne; aktywuje się po wyborze stacji)
- `Context` (lista klucz:wartość, dynamiczna)

**Krok 3 — Przegląd i wyślij.** Przyciski: `Wyślij` (primary), `Zapisz jako szkic`.

Advanced (zwinięte): przypisanie, termin, środowisko, retry policy.

Po wysłaniu: toast + przycisk `Przejdź do zadania`.

### 3. Task List

- Tabela: ID | Tytuł | Status | Osoba | Priorytet | Akcje
- Filtry górne: status, priorytet, przypisane/nieprzypisane, search.
- Akcje w wierszu: `Pokaż`, `Przypisz`, `Debug`.

### 4. Task Detail

- Nagłówek z tytułem i statusem, timeline statusów, log preview, debug summary.
- Duży przycisk `Uruchom diagnostykę` (jeśli dostępny) i `Przypisz` (jeśli brak przypisania).
- Sekcja `Komunikacja ze stacją` z przyciskiem `Wyślij wiadomość do stacji`.
- Meta pola: przypisana `Stacja` i `Model`.

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

- Tabela: Nazwa | Platforma | Model | Status | Ostatnio widziana | Akcje.
- Główna akcja w wierszu: `Wyślij wiadomość`.
- Widok ma charakter operacyjny: pokazuje komputery uruchomione przez `start.command` / `start.sh`, a nie ręcznie tworzone rekordy.

### 10. Wiadomość do stacji

- Mały modal z nazwą celu i jednym polem tekstowym.
- Użycie: doprecyzowanie zadania, wymuszenie konkretnego modelu, prośba o raport.
- Po wysłaniu: toast `Wiadomość wysłana do stacji` i dopisanie do sekcji komunikacji w Task Detail.

## Copy & Tone

- Zwięzłe polecenia: „Dodaj zadanie", „Pokaż zadanie", „Uruchom diagnostykę".
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

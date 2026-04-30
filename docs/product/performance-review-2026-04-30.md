# Wywiad środowiskowy wydajności — 2026-04-30

## Środowisko

- Aplikacja produkcyjna: `https://kamciosz.github.io/agent-manager/`.
- Frontend: statyczne ES modules, bez npm, bundlera i `package.json`.
- Runtime lokalny operatora: `./start.sh --doctor --no-pull` przechodzi bez startowania usług; port proxy 3001 jest wolny, model i 256k context są skonfigurowane.
- Aktualny dashboard po zalogowaniu pokazuje 2 zadania, 0 aktywnych stacji sali i brak błędów konsoli.

## Metryki live

- `DOMContentLoaded`: około 700 ms przy aktualnym cache przeglądarki.
- Zasoby strony: 26 wpisów resource timing, głównie skrypty ES modules.
- Największy moduł produkcyjny po kompresji transportowej w Pages: `app.js` około 37 KB transferu.
- DOM po starcie dashboardu: około 900 elementów, 8 sekcji widoków, 7 ukrytych.
- Supabase snapshot: `tasks=2`, `messages=9`, `task_events=14`, `workstations=2`, `workstation_jobs=4`, `workstation_messages=11`.

## Wnioski

- Największy koszt bez przebudowy architektury nie jest w bazie, tylko w renderowaniu ukrytych paneli po odświeżeniach Realtime.
- `refreshTasks()` nie powinien renderować Monitora, gdy operator jest na liście poleceń albo w szczegółach zadania.
- `refreshWorkstations()` nie powinien za każdym razem renderować tabeli stacji, planu sali, Monitora, Advanced i Ustawień, jeśli te widoki są ukryte.
- Agenci, tokeny instalacyjne i live log monitora nie muszą być pobierane przy starcie dashboardu; wystarczy lazy load przy wejściu w odpowiedni widok.
- Supabase performance advisor zgłasza wyłącznie `unused_index` INFO przy świeżym, małym ruchu. Nie usuwać tych indeksów bez realnego ruchu i `EXPLAIN`, bo są pod przyszłe RLS/routing/cancel/retry.

## Wdrożona decyzja

- Renderuj ciężkie widoki dopiero po wejściu w dany panel.
- Zachowaj lekkie globalne odświeżanie stanu `tasks` i `workstations`, bo dashboard i routing muszą mieć aktualne dane.
- Deleguj kliknięcia w dynamicznych tabelach/listach zamiast podpinać nowe handlery po każdym renderze.

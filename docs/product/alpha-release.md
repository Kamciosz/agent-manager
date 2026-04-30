# Alpha release — Agent Manager

Data: 2026-04-28
Status: alpha

## Zakres alpha

Alpha obejmuje działający panel webowy na GitHub Pages, logowanie Supabase Auth, zadania, usuwanie poleceń, profile agentów, komunikację AI↔AI przez `messages`, Realtime timeline, słownik pojęć/statusów oraz eksperymentalną pulę stacji roboczych.

Architektura pozostaje prosta:
- UI: statyczne `ui/` na GitHub Pages
- Backend: Supabase Auth, Postgres i Realtime
- Lokalny AI: opcjonalny `start.command` / `start.sh`, `llama-server`, `proxy.js`, `workstation-agent.js`

## Co nie jest w alpha

- brak własnego backendu Node.js
- brak zdalnego terminala live
- brak bezpośredniego LAN między komputerami
- brak automatycznego stosowania migracji bazy w GitHub Actions

## Znane ograniczenia

- Model bezpieczeństwa jest team-space dla jawnych ról panelu: `admin`, `manager`, `operator`, `teacher`, `executor`, `viewer`. Samo założenie konta Supabase nie daje dostępu do danych aplikacji.
- Migracje z `supabase/migrations/` trzeba stosować jawnie przez Supabase tools lub SQL editor.
- Ochrona Supabase Auth przed leaked passwords nie jest dostępna w darmowym planie; w alpha jest świadomie zaakceptowanym ograniczeniem planu, a nie blockerem kodu.
- Stacje robocze używają jednorazowego tokenu instalacyjnego i ograniczonej sesji technicznej; hasło operatora nie jest zapisywane w `local-ai-proxy/config.json`.
- Local AI zależy od modelu GGUF i wydajności komputera; ciężkie modele mogą startować długo.
- Usunięcie polecenia usuwa rekord zadania oraz rozmowy AI przypięte do tego zadania. Historia jobów i wiadomości stacji roboczych zostaje zachowana, ale bez linku do usuniętego zadania.
- Supabase Performance Advisor może pokazywać `unused_index` jako INFO przy świeżych indeksach i małym ruchu; nie jest to blokada wdrożenia.

## Checklist alpha smoke test

- GitHub Pages odpowiada HTTP 200.
- Deployed `app.js` nie zawiera placeholderów `__SUPABASE_URL__` ani `__SUPABASE_ANON_KEY__`.
- Supabase ma tabele `tasks`, `assignments`, `agents`, `messages`, `workstations`, `workstation_models`, `workstation_messages`, `workstation_jobs`, `task_feedback`, `task_events`.
- Supabase ma startowe profile agentów: `AI Kierownik`, `Executor Kodujący`, `Tester Weryfikator`.
- Utworzenie zadania w UI zapisuje rekord w `tasks`.
- Usunięcie zadania z listy lub szczegółów usuwa rekord z `tasks` i odświeża widok bez błędów RLS.
- Przycisk `Co to znaczy?` pokazuje słownik pojęć oraz znaczenie statusów `pending`, `analyzing`, `in_progress`, `done`, `failed`.
- Manager przejmuje zadanie `pending` i ustawia `analyzing`, potem `in_progress`.
- Executor tworzy przepływ wiadomości: question → answer → report.
- Task Detail pokazuje timeline i wiadomości bez odświeżania.
- `start.command` przechodzi przez konfigurację modelu i stacji bez cichego zakończenia.
- Stacja robocza publikuje heartbeat i model w UI.
- Job skierowany do stacji kończy się wpisem result albo error w `workstation_messages`.
- Supabase Security Advisor poza `auth_leaked_password_protection` nie zgłasza ostrzeżeń security; ten alert wynika z ograniczeń darmowego planu.
- Supabase Performance Advisor nie zgłasza WARN/ERROR po stronie RLS i brakujących indeksów FK; pozostałe wpisy `unused_index` są informacyjne.

## Kryterium wyjścia z alpha

Projekt może przejść z alpha do beta, gdy testy z `todo.md` 6.2, 6.3 i 6.4 są wykonane na deployu GitHub Pages, a ograniczenia team-space/RLS oraz ograniczenia darmowego planu Supabase są świadomie zaakceptowane albo zastąpione mocniejszą konfiguracją.

## Weryfikacja deployu 2026-04-30

- Konto panelu `kamciosz4you@gmail.com` zalogowało się na publicznym Pages i widziało dashboard `Połączono`.
- Zadanie `Acceptance smoke dashboard 2026-04-30` utworzone przez UI zakończyło się statusem `done`.
- Task Detail pokazał 5 kroków timeline, 4 wiadomości AI, 4 wpisy audit logu i scalony `Run trace`.
- Test RBAC z `window.supabase.from('tasks').select(...)` zwrócił tylko zadania bieżącego użytkownika w aktualnym zestawie danych.
- Stary rekord `2 + 2` został anulowany i ponowiony z UI; zakończył się statusem `done`, `retry_count=1`, 5 wiadomościami i 5 wpisami historii.
# Alpha release — Agent Manager

Data: 2026-04-28
Status: alpha

## Zakres alpha

Alpha obejmuje działający panel webowy na GitHub Pages, logowanie Supabase Auth, zadania, profile agentów, komunikację AI↔AI przez `messages`, Realtime timeline oraz eksperymentalną pulę stacji roboczych.

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

- Model bezpieczeństwa jest team-space: zalogowani użytkownicy współdzielą zadania i stacje robocze.
- Migracje z `supabase/migrations/` trzeba stosować jawnie przez Supabase tools lub SQL editor.
- Ochronę Supabase Auth przed leaked passwords trzeba włączyć w panelu Supabase.
- Stacje robocze wymagają lokalnego konta operatora Supabase zapisanego w `local-ai-proxy/config.json`.
- Local AI zależy od modelu GGUF i wydajności komputera; ciężkie modele mogą startować długo.

## Checklist alpha smoke test

- GitHub Pages odpowiada HTTP 200.
- Deployed `app.js` nie zawiera placeholderów `__SUPABASE_URL__` ani `__SUPABASE_ANON_KEY__`.
- Supabase ma tabele `tasks`, `assignments`, `agents`, `messages`, `workstations`, `workstation_models`, `workstation_messages`, `workstation_jobs`.
- Utworzenie zadania w UI zapisuje rekord w `tasks`.
- Manager przejmuje zadanie `pending` i ustawia `analyzing`, potem `in_progress`.
- Executor tworzy przepływ wiadomości: question → answer → report.
- Task Detail pokazuje timeline i wiadomości bez odświeżania.
- `start.command` przechodzi przez konfigurację modelu i stacji bez cichego zakończenia.
- Stacja robocza publikuje heartbeat i model w UI.
- Job skierowany do stacji kończy się wpisem result albo error w `workstation_messages`.

## Kryterium wyjścia z alpha

Projekt może przejść z alpha do beta, gdy testy z `todo.md` 6.2, 6.3 i 6.4 są wykonane na deployu GitHub Pages, a ograniczenia team-space/RLS są świadomie zaakceptowane albo zastąpione izolacją per użytkownik.
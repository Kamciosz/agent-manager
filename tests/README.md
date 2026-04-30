# tests/

Testy jednostkowe i integracyjne projektu.

## Struktura

```
tests/
  runtime-schedule.test.js — node:test dla harmonogramu runtime
  data/regression-prompts.json — ręczny dataset oceny jakości wyników
  acceptance/
    run.sh               — skrypt testów akceptacyjnych dla CI
    data/
      submitTask_payload.json
      failing_task_payload.json
```

## Uruchomienie

```bash
node --test tests/*.test.js
bash tests/acceptance/run.sh
PAGES_URL=https://twoj-login.github.io/agent-manager bash tests/acceptance/run.sh
SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_TEST_EMAIL=... SUPABASE_TEST_PASSWORD=... bash tests/acceptance/run.sh
```

Testy używają wbudowanego `node:test`, więc nie wymagają `npm install`, `package.json` ani bundlera.

## Scenariusze akceptacyjne

`tests/acceptance/run.sh` sprawdza brak `package.json`, składnię modułów UI, testy `node:test`, statyczne serwowanie `ui/` i krytyczne elementy Task Detail. Jeśli ustawione jest `PAGES_URL`, sprawdza publiczny deploy Pages, brak placeholderów Supabase i dostępność nowych modułów. Jeśli ustawione są `SUPABASE_URL` i `SUPABASE_ANON_KEY`, dodatkowo sprawdza, że anonimowy request REST nie widzi rekordów z tabel `tasks`, `assignments`, `messages`, `agents` i `task_events`. Jeśli podasz też `SUPABASE_TEST_EMAIL` i `SUPABASE_TEST_PASSWORD`, skrypt loguje konto z rolą panelu, tworzy zadanie, czeka na `task.created` w audit logu i usuwa rekord.

Szczegółowe scenariusze ręczne: [docs/dev/testing.md](../docs/dev/testing.md)

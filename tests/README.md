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
```

Testy używają wbudowanego `node:test`, więc nie wymagają `npm install`, `package.json` ani bundlera.

## Scenariusze akceptacyjne

Szczegółowe scenariusze curl z asercjami: [docs/dev/testing.md](../docs/dev/testing.md)

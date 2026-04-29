# tests/

Testy jednostkowe i integracyjne projektu.

## Struktura

```
tests/
  runtime-schedule.test.js — node:test dla harmonogramu runtime
  acceptance/
    run.sh               — skrypt testów akceptacyjnych dla CI
    data/
      submitTask_payload.json
      failing_task_payload.json
```

## Uruchomienie

```bash
npm test
```

Testy używają wbudowanego `node:test`, więc nie wymagają instalowania zależności npm.

## Scenariusze akceptacyjne

Szczegółowe scenariusze curl z asercjami: [docs/dev/testing.md](../docs/dev/testing.md)

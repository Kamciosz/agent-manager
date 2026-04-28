# tests/

Testy jednostkowe i integracyjne projektu.

## Struktura (planowana)

```
tests/
  unit/                  — testy jednostkowe (config, log, auth)
  integration/           — testy integracyjne (WS roundtrip, Redis queue)
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

## Scenariusze akceptacyjne

Szczegółowe scenariusze curl z asercjami: [docs/dev/testing.md](../docs/dev/testing.md)

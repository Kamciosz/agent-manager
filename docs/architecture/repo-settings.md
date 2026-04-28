# Ustawienia repozytorium i autodebugowanie

## Ustawienia repozytorium

Każde repozytorium powiązane z zadaniem posiada własny zestaw opcji konfiguracyjnych dostępny po synchronizacji projektu.

| Pole | Typ | Domyślnie | Opis |
|------|-----|-----------|------|
| `repo_url` | string | — | URL repozytorium Git |
| `main_branch` | string | `main` | Główna gałąź projektu |
| `extra_branches` | string[] | `[]` | Dodatkowe gałęzie do monitorowania |
| `debug_mode` | boolean | `false` | Czy debugowanie jest włączone |
| `autodebug_options.analyze_tests` | boolean | `false` | Analiza wyników testów przy autodebug |
| `autodebug_options.analyze_logs` | boolean | `false` | Analiza logów przy autodebug |

> Debugowanie repozytorium jest **domyślnie wyłączone**. Musi być włączone ręcznie przez użytkownika.

## Powiązanie zadania z repozytorium

- Każde zadanie jest powiązane z dokładnie jednym repozytorium Git (multi-repo poza MVP).
- Repozytorium dostarcza kontekst kodu — agent wykonawczy pracuje na lokalnej kopii.
- Zadanie może zawierać informację o branchu i zakresie pracy.

## Workflow autodebugowania

Autodebugowanie może być uruchamiane automatycznie (po `status=failed`) lub ręcznie przez managera.

```
1. Użytkownik (lub system) zgłasza problem w kontekście repozytorium.
2. AI kierownik przypisuje zadanie debug i dostarcza kontekst repo.
3. Agent wykonawczy analizuje testy i logi z repo.
4. Agent proponuje lub wprowadza poprawki w lokalnej kopii.
5. System uruchamia ponownie testy i raportuje wynik.
```

Raport diagnostyczny (JSON) zawiera pola: `logs`, `traces`, `suggested_fix`.

Dostęp: `GET /api/v1/tasks/{id}/debug/{debugReportId}`

## Kontekst branch/commit

- Podstawowy kontekst w MVP: URL repozytorium + główny branch.
- Śledzenie konkretnego commita — możliwe do dodania w MVP jeśli nie opóźni wdrożenia, lub jako pierwsza aktualizacja po MVP.

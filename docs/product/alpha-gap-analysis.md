# Alpha gap analysis — Agent Manager

Data: 2026-04-30
Status: aktualne po kolejnej rundzie stabilizacji alpha-plus

## Dodane w tej iteracji

| Brak | Ryzyko | Decyzja |
|------|--------|---------|
| Brak usuwania poleceń | Kolejka szybko robi się nieczytelna, a błędnie wysłane zadania zostają w systemie | Dodano usuwanie z listy i widoku szczegółów oraz politykę RLS DELETE dla `tasks` |
| Niejasne pojęcia i statusy | Użytkownik nie wie czym różni się polecenie, stacja, model, panel online i statusy techniczne | Dodano modal `Co to znaczy?` z krótkim słownikiem |
| Ostrzeżenia performance RLS | Stare polityki per-role nakładały się z team-space alpha, a wybrane FK nie miały indeksów | Dodano indeksy FK i uproszczono polityki do jednej polityki per operacja/tabela |
| Pusta lista profili agentów | Widok `Profile agentów` wyglądał jak niedokończony, bo tabela `agents` nie miała rekordów | Dodano seed startowych profili: kierownik, executor i tester |
| Edycja polecenia | Literówka albo zła stacja wymagały kasowania i tworzenia nowego rekordu | Dodano edycję oczekujących, anulowanych i błędnych poleceń w tym samym wizardzie |
| Anulowanie / ponowienie | Usunięcie porządkowało listę, ale nie dawało kontroli procesu | Dodano `Anuluj`, `Ponów` i `Ponów auto` z bezpiecznym lifecycle jobów stacji |
| Filtrowanie listy | Przy większej liczbie poleceń tabela była za wolna operacyjnie | Dodano filtry po statusie, priorytecie i tekście dla listy oraz kafelków |
| Historia zmian | Przy team-space brakowało odpowiedzi kto zmienił status albo edytował polecenie | Dodano tabelę `task_events`, trigger auditowy i panel `Historia zmian` w Task Detail |
| Modularyzacja historii | `ui/app.js` rósł po dodaniu trace i historii zmian | Wydzielono renderowanie historii zmian do modułu `ui/task-events.js` |

## Nadal brakujące elementy przed beta

| Obszar | Co jest potrzebne | Dlaczego |
|--------|-------------------|----------|
| Izolacja danych | Decyzja: team-space zostaje albo przejście na widoczność per użytkownik/zespół | Obecne RLS jest zoptymalizowane pod alpha team-space, ale wymaga świadomej decyzji przed beta |
| Testy E2E | Test logowania, tworzenia, usuwania, komunikacji ze stacją i statusów na deployu | Ręczna walidacja jest za słaba dla wydania beta |
| Modularyzacja UI | Dalsze rozbicie `ui/app.js` po stabilizacji P0/P1 | Pierwszy fragment (`task-events.js`) jest wydzielony; większy refaktor nadal powinien iść małymi krokami po pełnych testach E2E |

## Znaczenie historii zmian

`task_events` zapisuje zdarzenia z triggera bazy, a nie z zaufania do klienta. Dzięki temu zmiana statusu wykonana przez panel, fallback executora albo stację zostawia wspólny ślad: typ aktora, typ zdarzenia, krótki opis i metadane. Panel pokazuje te wpisy w Task Detail oraz dokłada je do osi `Run trace`.

## Znaczenie edycji polecenia

Edycja jest celowo ograniczona do statusów `pending`, `failed` i `cancelled`. Aktywnie wykonywane polecenie nie zmienia stacji, modelu ani treści pod nogami executora lub stacji roboczej. Jeśli zadanie było po błędzie albo anulowane, operator może poprawić treść i dopiero potem użyć `Ponów`.

## Znaczenie usunięcia polecenia

Usunięcie polecenia usuwa rekord z `tasks`. `assignments` i `messages` są usuwane kaskadowo, bo bez zadania nie mają kontekstu. `workstation_jobs` i `workstation_messages` zostają w bazie, ale ich `task_id` jest ustawiane na `null`, żeby nie tracić historii pracy stacji roboczej.

# Alpha gap analysis — Agent Manager

Data: 2026-04-28
Status: aktualne po przejściu z MVP do alpha

## Dodane w tej iteracji

| Brak | Ryzyko | Decyzja |
|------|--------|---------|
| Brak usuwania poleceń | Kolejka szybko robi się nieczytelna, a błędnie wysłane zadania zostają w systemie | Dodano usuwanie z listy i widoku szczegółów oraz politykę RLS DELETE dla `tasks` |
| Niejasne pojęcia i statusy | Użytkownik nie wie czym różni się polecenie, stacja, model, tryb demo i statusy techniczne | Dodano modal `Co to znaczy?` z krótkim słownikiem |

## Nadal brakujące elementy przed beta

| Obszar | Co jest potrzebne | Dlaczego |
|--------|-------------------|----------|
| Edycja polecenia | Możliwość poprawienia tytułu, opisu, priorytetu i stacji przed wykonaniem | Literówki i źle dobrany model nie powinny wymagać tworzenia nowego zadania |
| Anulowanie / ponowienie | Akcje `Anuluj` i `Ponów` dla zadań i jobów stacji | Usunięcie jest dobre do porządkowania, ale nie zastępuje kontroli procesu |
| Filtrowanie listy | Filtry po statusie, priorytecie, stacji i tekście | Przy większej liczbie poleceń tabela bez filtrów przestaje być operacyjna |
| Historia zmian | Audit log: kto utworzył, usunął, zmienił status, wysłał wiadomość | Potrzebne przy współdzielonym team-space i wielu komputerach |
| Izolacja danych | Decyzja: team-space zostaje albo przejście na widoczność per użytkownik/zespół | Obecne RLS jest proste i dobre dla alpha, ale wymaga świadomej decyzji przed beta |
| Testy E2E | Test logowania, tworzenia, usuwania, komunikacji ze stacją i statusów na deployu | Ręczna walidacja jest za słaba dla wydania beta |

## Znaczenie usunięcia polecenia

Usunięcie polecenia usuwa rekord z `tasks`. `assignments` i `messages` są usuwane kaskadowo, bo bez zadania nie mają kontekstu. `workstation_jobs` i `workstation_messages` zostają w bazie, ale ich `task_id` jest ustawiane na `null`, żeby nie tracić historii pracy stacji roboczej.

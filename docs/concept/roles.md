# Role w systemie

## AI kierownik (Agent szef)

Centralny węzeł zarządzający. Uruchamiany na jednej, dedykowanej maszynie.

**Odpowiedzialności:**
- Przyjmuje i analizuje zadania od użytkownika.
- Dekomponuje zadanie na kroki i tworzy plan.
- Decyduje, ilu agentów potrzeba i jakie profile ma przydzielić (bez ręcznej interwencji użytkownika).
- Przydziela etapy do agentów wykonawczych.
- Monitoruje postęp, koryguje plan w razie potrzeby.
- Agreguje wyniki i raportuje użytkownikowi.
- Aktywuje team leadera, gdy spełnione są warunki (patrz niżej).

## Agent wykonawczy

Uruchamiany na dowolnej stacji roboczej w sieci. Może działać wiele instancji jednocześnie.

**Odpowiedzialności:**
- Wykonuje przydzielone zadanie zgodnie z przypisanym profilem.
- Raportuje postęp i wyniki do AI kierownika.
- Może poprosić o dodatkowe informacje lub się odwołać.
- Pracuje na kodzie repozytorium Git powiązanym z zadaniem.

**Agent wykonawczy MVP** — agent programista: tworzy i utrzymuje kod, implementuje funkcje, rozwiązuje problemy techniczne.

## Team leader (opcjonalny)

Pośrednik między AI kierownikiem a grupą wykonawców przy większych projektach.

**Kiedy jest aktywowany:** gdy jednocześnie realizowane są ≥ 2 projekty i każdy ma ≥ 2 agentów.

| Przykład | Team leader? |
|----------|-------------|
| 1 projekt, 10 agentów | Nie |
| 2 projekty × 2 agentów | Tak — po jednym na projekt |
| 3 projekty: dwa po 2 agentów, jeden z 1 | Tak — dla projektów 2-agentowych |

**Odpowiedzialności:**
- Zarządza grupą agentów wykonawczych w ramach jednego projektu.
- Agreguje raporty i przyspiesza koordynację.
- Redukuje obciążenie AI kierownika.

## Użytkownik końcowy

**Odpowiedzialności:**
- Zgłasza zadania przez web, terminal lub API.
- Śledzi postęp w czasie rzeczywistym.
- Zatwierdza kluczowe decyzje w trybie półautonomicznym.
- Odbiera raporty i wyniki końcowe.

## Przyszłe integracje zewnętrzne

Slack, Discord, Telegram i inne platformy — zaplanowane jako rozszerzenie po MVP.

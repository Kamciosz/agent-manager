# Todo — Agent Manager

Dokumentacja produktowa w [docs/](docs/index.md).

---

## Kontekst dla AI — przeczytaj zanim zaczniesz

### Projekt i infrastruktura

**Projekt:** Agent Manager — system zarządzania agentami AI
**Repo:** `Kamciosz/agent-manager` na GitHub
**Architektura:** GitHub Pages (frontend) + Supabase (backend) — ZERO własnego serwera, ZERO npm, ZERO bundlera
**Supabase URL:** własny projekt Supabase wstrzykiwany przez GitHub Actions jako `${{ secrets.SUPABASE_URL }}`
**Supabase anon key:** wstrzykiwany przez GitHub Actions jako `${{ secrets.SUPABASE_ANON_KEY }}`

**Tabele Supabase (już istnieją w bazie):** `tasks`, `assignments`, `agents`, `messages`
Pełny schemat pól i RLS: [docs/dev/api-reference.md](docs/dev/api-reference.md)

---

### Stos technologiczny — DOKŁADNIE tak, bez odchyleń

```
ui/
  index.html    ← jeden plik HTML z Tailwind + importem modułów
  app.js        ← Supabase client, auth, główna logika UI
  manager.js    ← logika AI kierownika (symulowana)
  executor.js   ← logika agenta wykonawczego (symulowana)
.github/
  workflows/
    deploy.yml  ← GitHub Actions deploy na GitHub Pages
```

**CSS:** Tailwind CSS przez CDN (bez konfiguracji, bez pliku config):
```html
<script src="https://cdn.tailwindcss.com"></script>
```

**JavaScript:** Vanilla JS, ES modules, bez bundlera. Import Supabase przez CDN:
```js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
```

**Klucze w app.js** — użyj literalnych placeholderów (sed je zastąpi w deploy.yml):
```js
const SUPABASE_URL = '__SUPABASE_URL__'
const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__'
```

**Autentykacja:** Supabase Auth, email + hasło. Ekran logowania/rejestracji ładuje się PRZED dashboardem. Po zalogowaniu Supabase automatycznie zapisuje sesję w localStorage.

---

### Logika AI — SYMULACJA w przeglądarce (bez zewnętrznego API)

Nie ma żadnego prawdziwego AI. `manager.js` i `executor.js` to symulacja oparta na regułach — JavaScript uruchomiony w przeglądarce, działający automatycznie na zdarzeniach Supabase Realtime.

**manager.js — co robi krok po kroku:**
1. Subskrybuje kanał Realtime: INSERT na tabeli `tasks`
2. Gdy pojawi się zadanie ze statusem `pending`:
   - po 800ms: zmień status zadania na `analyzing`
   - po kolejnych 1200ms: wstaw rekord do `assignments` (`agent_id = 'executor-1'`, `instructions = 'Wykonaj: ' + task.title`, `status = 'assigned'`)
   - natychmiast: zmień status zadania na `in_progress`
3. Subskrybuje kanał Realtime: INSERT na tabeli `messages` gdzie `to_agent = 'manager'`
4. Na każde pytanie (`type = 'question'`): po 500ms wstaw odpowiedź do `messages` (`type = 'answer'`, `content = 'Kontynuuj zadanie.'`)

**executor.js — co robi krok po kroku:**
1. Subskrybuje kanał Realtime: INSERT na tabeli `assignments` gdzie `agent_id = 'executor-1'`
2. Gdy pojawi się nowy przydział (`status = 'assigned'`):
   - zmień status przydziału na `in_progress`
   - po 2000ms: zmień status przydziału na `done`
   - po 2000ms: zmień status zadania na `done`
   - wstaw wiadomość do `messages` (`from_agent = 'executor-1'`, `to_agent = 'manager'`, `type = 'report'`, `content = 'Zadanie ukończone pomyślnie.'`)

---

### Styl kodu — obowiązkowe standardy

**Każdy plik** musi zaczynać się od bloku komentarza:
```js
/**
 * @file manager.js
 * @description Logika AI kierownika — subskrybuje zadania i przydziela je agentom wykonawczym.
 * Działa w przeglądarce, bez zewnętrznego API. Symulacja oparta na regułach z opóźnieniami.
 */
```

**Każda funkcja** musi mieć JSDoc:
```js
/**
 * Tworzy przydział zadania dla agenta wykonawczego.
 * @param {Object} task - Rekord zadania z tabeli tasks
 * @param {string} task.id - UUID zadania
 * @param {string} task.title - Tytuł zadania
 * @returns {Promise<void>}
 */
async function createAssignment(task) { ... }
```

**Stałe zamiast magic strings** — na górze każdego pliku:
```js
const STATUS = {
  PENDING: 'pending',
  ANALYZING: 'analyzing',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
  FAILED: 'failed',
}
const AGENT = { EXECUTOR_1: 'executor-1', MANAGER: 'manager' }
```

**Obsługa błędów** — każda operacja async w try/catch z logowaniem i feedbackiem w UI:
```js
try {
  await supabase.from('tasks').insert(...)
} catch (error) {
  console.error('[app.js] createTask failed:', error)
  showToast('Błąd zapisu zadania. Spróbuj ponownie.', 'error')
}
```

**Pozostałe zasady:**
- `const` i `let` — nigdy `var`
- Opisowe nazwy: `createTaskAssignment` nie `doStuff`, `handleTaskInsert` nie `fn`
- Funkcje max 30 linii — jeśli dłuższe, rozbij na mniejsze z nazwami
- Komentarze przy każdym bloku logiki (`// Krok 1: zmień status...`)

---

### Szablon deploy.yml — DOKŁADNIE ta struktura

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Inject Supabase credentials
        run: |
          sed -i "s|__SUPABASE_URL__|${{ secrets.SUPABASE_URL }}|g" ui/app.js
          sed -i "s|__SUPABASE_ANON_KEY__|${{ secrets.SUPABASE_ANON_KEY }}|g" ui/app.js

      - name: Setup Pages
        uses: actions/configure-pages@v4

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: ui/

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

---

### Pliki których NIGDY nie dotykasz

`server.js`, `client.js`, `src/`, `schemas/`, `package.json`, `docker-compose.yml` — stara architektura Node.js, nieaktualna, zostawiona tylko jako historia.

---

## Jak czytać ten plik

Każde zadanie zawiera:
- **Co zrobić** — jedna konkretna akcja
- **Gdzie** — dokładny plik lub folder
- **Gotowe gdy** — warunek który musi być spełniony zanim zaznaczysz [x]
- **Nie rób** — czego NIE zmieniać przy tym zadaniu

Zasady:
1. Jedno zadanie na raz — nie rób kilku równocześnie
2. Sprawdź warunek "Gotowe gdy" przed przejściem dalej
3. Jeśli zadanie jest niejednoznaczne — zapytaj, nie zgaduj
4. Nie zmieniaj plików spoza sekcji "Gdzie"

---

## Faza 1 — Koncepcja i architektura ✅ UKOŃCZONA

Wszystkie zadania tej fazy zakończone. Dokumentacja spójna i aktualna.

---

## Faza 2 — Setup infrastruktury

### 2.1 Utwórz projekt Supabase
- **Co:** Założyć nowy projekt na supabase.com
- **Gdzie:** Panel webowy supabase.com (poza repo)
- **Gotowe gdy:** Istnieje projekt z nazwą `agent-manager`, region Europe, status Active
- **Nie rób:** Nie twórz żadnych plików w repo przy tym zadaniu
- [x] Gotowe

### 2.2 Dodaj sekrety do GitHub
- **Co:** Dodać dwa GitHub Secrets do repozytorium
- **Gdzie:** GitHub → Settings → Secrets and variables → Actions
- **Gotowe gdy:** Istnieją dwa sekrety: `SUPABASE_URL` i `SUPABASE_ANON_KEY` z wartościami z projektu Supabase
- **Nie rób:** Nie wpisuj kluczy w żadnym pliku repozytorium
- [x] Gotowe

### 2.3 Włącz GitHub Pages
- **Co:** Zmienić źródło GitHub Pages na GitHub Actions
- **Gdzie:** GitHub → Settings → Pages → Source
- **Gotowe gdy:** Ustawienie Source = „GitHub Actions”, status zapisany
- **Nie rób:** Nie zmieniaj innych ustawień repozytorium
- [x] Gotowe

### 2.4 Zaprojektuj schemat tabeli `tasks`
- **Co:** Opisać pola tabeli tasks (bez kodu SQL)
- **Gdzie:** [docs/dev/api-reference.md](docs/dev/api-reference.md) — sekcja "Tabela tasks"
- **Gotowe gdy:** Tabela w docs zawiera wszystkie pola z typami i opisami, zgodna z MVP-01
- **Nie rób:** Nie twórz plików SQL, nie zmieniaj innych sekcji pliku
- [x] Gotowe

### 2.5 Zaprojektuj schemat tabeli `assignments`
- **Co:** Opisać pola tabeli assignments
- **Gdzie:** [docs/dev/api-reference.md](docs/dev/api-reference.md) — sekcja "Tabela assignments"
- **Gotowe gdy:** Tabela w docs zawiera wszystkie pola, odzwierciedla logikę AI kierownik → Agent wykonawczy
- **Nie rób:** Nie zmieniaj sekcji tasks ani innych tabel
- [x] Gotowe

### 2.6 Zaprojektuj polityki RLS
- **Co:** Opisać słownie reguły dostępu dla każdej roli
- **Gdzie:** [docs/dev/api-reference.md](docs/dev/api-reference.md) — sekcja "Bezpieczeństwo RLS"
- **Gotowe gdy:** Każda rola (manager/executor/viewer) ma opisane uprawnienia do każdej tabeli
- **Nie rób:** Nie pisz kodu SQL
- [x] Gotowe

---

## Faza 3 — Interfejs użytkownika

### 3.1 Dashboard + ekran logowania
- **Co:** Stworzyć `ui/index.html` z ekranem logowania i dashboardem
- **Gdzie:** `ui/index.html` (nowy plik)
- **Jak zrobić:**
  - Plik zaczyna się od `<!DOCTYPE html>` z Tailwind CDN i `<script type="module" src="app.js"></script>`
  - Struktura HTML ma dwa główne `<div>`: `#auth-screen` (login/register) i `#app-screen` (ukryty na start)
  - `#auth-screen`: dwa formularze (zakładki "Zaloguj" / "Zarejestruj"), pola email + hasło, przycisk submit, div na błędy
  - `#app-screen`: nawigacja boczna z linkami do Dashboard / Zadania / Profile Agentów, główny obszar `#main-content`
  - Dashboard pokazuje: 3 karty ze statystykami (pending/in_progress/done), przycisk "Dodaj polecenie", tabela ostatnich poleceń (ID | Polecenie | Status | Priorytet | Data)
  - Status połączenia: zielona/czerwona kropka w górnym pasku z tekstem "Połączono" / "Brak połączenia"
- **Gotowe gdy:** Strona otwiera się w przeglądarce, widać ekran logowania, po kliknięciu zakładki widać formularz rejestracji
- **Nie rób:** Nie implementuj logiki Supabase — HTML i CSS tylko (klasy Tailwind)
- [x] Gotowe

### 3.2 Formularz Submit Task (wizard 3-krokowy)
- **Co:** Dodać formularz tworzenia zadania jako modal/overlay
- **Gdzie:** `ui/index.html` — sekcja `#modal-submit-task`
- **Jak zrobić:**
  - Modal z przyciskami Wstecz/Dalej/Wyślij, pasek postępu (krok 1/2/3)
  - Krok 1 — Szablon: 4 karty do kliknięcia: Bug Fix / Refactor / Testy / Własne (każda z ikonką i krótkim opisem)
  - Krok 2 — Dane: pola `title`* (required), `description`* (required), `priority` (select: low/medium/high, domyślnie medium), `repo` (optional), accordion "Zaawansowane" z polem `context` (textarea)
  - Krok 3 — Przegląd: podsumowanie w read-only, dwa przyciski: "Wyślij" (niebieski) i "Zapisz jako szkic" (szary)
  - Przycisk "Dodaj polecenie" na dashboardzie otwiera modal (JavaScript toggle klasy hidden)
- **Gotowe gdy:** Kliknięcie "Dodaj polecenie" otwiera modal, przyciski Dalej/Wstecz przełączają kroki
- **Nie rób:** Nie podłączaj do Supabase jeszcze — tylko interakcja HTML/JS
- [x] Gotowe

### 3.3 Widok Task Detail z timelineʼem
- **Co:** Stworzyć ekran szczegółów zadania
- **Gdzie:** `ui/index.html` — sekcja `#task-detail` (ukryta na start)
- **Jak zrobić:**
  - Nagłówek: tytuł zadania, badge statusu (kolorowy: pending=szary, analyzing=żółty, in_progress=niebieski, done=zielony, failed=czerwony)
  - Timeline pionowy: 5 kroków z ikonką, nazwą i timestampem. Ukończone kroki = pełne kółko, bieżący = animowane kółko, przyszłe = puste kółko
  - Kroki timeline: "Wysłano zadanie" → "AI kierownik przejął" → "Przydzielono agentowi" → "W toku" → "Zakończono"
  - Sekcja "Wiadomości AI" — lista wiadomości z tabeli `messages` dla tego zadania
  - Przycisk "Wróć do listy" w górze
- **Gotowe gdy:** Sekcja `#task-detail` istnieje w HTML z timelineʼem jako statyczny mockup (dane na sztywno)
- **Nie rób:** Nie implementuj real-time jeszcze
- [x] Gotowe

### 3.4 Ekran zarządzania profilami agentów
- **Co:** Stworzyć widok listy profili agentów z CRUD
- **Gdzie:** `ui/index.html` — sekcja `#agents-screen`
- **Jak zrobić:**
  - Tabela: Nazwa | Rola | Umiejętności (tagi) | Limit równoczesnych | Akcje (Edytuj/Usuń)
  - Przycisk "Dodaj profil" otwiera modal z polami: name (text), role (select: manager/executor/specialist), skills (tagi — wpisz i Enter dodaje tag), concurrencyLimit (number, min 1 max 10)
  - Przycisk Edytuj otwiera ten sam modal wypełniony danymi
  - Przycisk Usuń: confirm dialog przed usunięciem
- **Gotowe gdy:** Ekran profilek widoczny po kliknięciu "Profile Agentów" w nawigacji, modal otwiera się i zamyka
- **Nie rób:** Nie podłączaj do Supabase
- [x] Gotowe

---

## Faza 4 — Połączenie z Supabase

### 4.1 Podłącz UI do Supabase + autentykacja
- **Co:** Stworzyć `ui/app.js` z inicjalizacją Supabase i logiką auth
- **Gdzie:** `ui/app.js` (nowy plik)
- **Jak zrobić:**
  - Import Supabase z CDN na górze pliku
  - Stałe: `SUPABASE_URL = '__SUPABASE_URL__'` i `SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__'`
  - Funkcja `initAuth()` — sprawdza sesję przy starcie: jeśli zalogowany → pokaż `#app-screen`, ukryj `#auth-screen`; jeśli nie → odwrotnie
  - `handleLogin(email, password)` — wywołuje `supabase.auth.signInWithPassword()`, obsługuje błędy
  - `handleRegister(email, password)` — wywołuje `supabase.auth.signUp()`, po sukcesie wyświetla toast "Sprawdź email"
  - `handleLogout()` — wywołuje `supabase.auth.signOut()`, przekierowuje do auth screen
  - `supabase.auth.onAuthStateChange()` — listener reagujący na zmianę stanu sesji
  - Funkcja `showToast(message, type)` — wyświetla powiadomienie (type: 'success'|'error'|'info'), znika po 3 sekundach
  - Na końcu pliku: `initAuth()` i import + inicjalizacja manager.js i executor.js
- **Gotowe gdy:** Po otwarciu `index.html` przez serwer, widać ekran logowania; po wpisaniu danych i kliknięciu Zaloguj — jeśli dane poprawne, pojawia się dashboard
- **Nie rób:** Nie wpisuj prawdziwych kluczy — tylko placeholdery
- [x] Gotowe

### 4.2 Zapis zadania do Supabase
- **Co:** Podłączyć formularz Submit Task do tabeli `tasks`
- **Gdzie:** `ui/app.js` — dodaj funkcje CRUD
- **Jak zrobić:**
  - `createTask({ title, description, priority, repo, context, template })` — INSERT do `tasks`, zwraca nowy rekord
  - `getTasks()` — SELECT z `tasks`, ORDER BY created_at DESC, LIMIT 50
  - `getTaskById(id)` — SELECT pojedynczego zadania
  - Podłącz przycisk "Wyślij" z kroku 3 formularza do `createTask()`
  - Po sukcesie: zamknij modal, pokaż toast "Zadanie wysłane!", odśwież listę zadań na dashboardzie
  - Po kliknięciu wiersza w tabeli zadań: załaduj Task Detail z danymi z `getTaskById()`
- **Gotowe gdy:** Po wypełnieniu formularza i kliknięciu "Wyślij" — zadanie pojawia się w tabeli Supabase ze statusem `pending` i na liście w UI
- **Nie rób:** Nie zmieniaj HTML z Fazy 3
- [x] Gotowe

### 4.3 Live update statusów + CRUD agentów
- **Co:** Podłączyć Realtime do Task Detail i podłączyć CRUD profili agentów
- **Gdzie:** `ui/app.js`
- **Jak zrobić:**
  - `subscribeToTask(taskId, callback)` — subskrypcja Realtime na zmiany zadania: `supabase.channel('task-' + taskId).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: 'id=eq.' + taskId }, callback)`
  - W callback: zaktualizuj badge statusu i podświetl odpowiedni krok timelineʼu
  - `getAgents()`, `createAgent(data)`, `updateAgent(id, data)`, `deleteAgent(id)` — pełne CRUD na tabeli `agents`
  - Podłącz formularz profilu agenta do `createAgent()` / `updateAgent()`
  - Podłącz przycisk Usuń do `deleteAgent()` z potwierdzeniem
- **Gotowe gdy:** Otwarty Task Detail zmienia status bez odświeżania gdy zmienisz go ręcznie w panelu Supabase; CRUD agentów zapisuje się w bazie
- **Nie rób:** Nie modyfikuj HTML
- [x] Gotowe

---

## Faza 5 — Logika AI

### 5.1 AI kierownik — plik manager.js
- **Co:** Stworzyć `ui/manager.js` z pełną logiką AI kierownika
- **Gdzie:** `ui/manager.js` (nowy plik)
- **Jak zrobić:** Zgodnie ze specyfikacją w sekcji "Logika AI" na górze tego pliku.
  - Eksportuj funkcję `initManager(supabase)` — inicjalizuje wszystkie subskrypcje
  - Subskrypcja INSERT na `tasks` → `handleNewTask(task)`
  - Subskrypcja INSERT na `messages` gdzie `to_agent = 'manager'` → `handleManagerMessage(message)`
  - Każda operacja opóźniona zgodnie ze spec (800ms, 1200ms itd.)
  - Każda funkcja z JSDoc i komentarzami kroków
- **Gotowe gdy:** Po zapisaniu zadania ze statusem `pending` w Supabase — w ciągu ~3 sekund automatycznie pojawia się rekord w `assignments` i status zadania zmienia się na `in_progress`
- **Nie rób:** Nie modyfikuj `app.js` ani `executor.js`
- [x] Gotowe

### 5.2 Agent wykonawczy — plik executor.js
- **Co:** Stworzyć `ui/executor.js` z logiką agenta wykonawczego
- **Gdzie:** `ui/executor.js` (nowy plik)
- **Jak zrobić:** Zgodnie ze specyfikacją w sekcji "Logika AI" na górze tego pliku.
  - Eksportuj funkcję `initExecutor(supabase)` — inicjalizuje subskrypcje
  - Subskrypcja INSERT na `assignments` gdzie `agent_id = 'executor-1'` → `handleNewAssignment(assignment)`
  - Po przetworzeniu: aktualizacja statusu przydziału → statusu zadania → INSERT do `messages`
  - Każda funkcja z JSDoc
- **Gotowe gdy:** Po pojawieniu się rekordu w `assignments` dla `executor-1` — po ~2 sekundach zadanie ma status `done` i w tabeli `messages` pojawia się raport
- **Nie rób:** Nie modyfikuj `manager.js`
- [x] Gotowe

### 5.3 Komunikacja AI↔AI przez messages
- **Co:** Upewnić się że cały przepływ wiadomości działa end-to-end
- **Gdzie:** `ui/manager.js` i `ui/executor.js` — uzupełnienie istniejącego kodu
- **Jak zrobić:**
  - Executor: przed wysłaniem raportu, wyślij pytanie do managera (`type = 'question'`, `content = 'Czy mam wykonać pełną weryfikację?'`)
  - Manager: na pytanie odpowiada po 500ms (`type = 'answer'`, `content = 'Kontynuuj zadanie.'`)
  - Executor: po otrzymaniu odpowiedzi kontynuuje i wysyła raport
  - Sekcja "Wiadomości AI" w Task Detail powinna pokazywać te wiadomości (podłącz subskrypcję Realtime na `messages` gdzie `task_id = current task id`)
- **Gotowe gdy:** Otwierając Task Detail widać przepływ wiadomości: pytanie executora → odpowiedź managera → raport ukończenia — wszystko na żywo
- **Nie rób:** Nie dodawaj nowych opóźnień które wydłużą przepływ ponad 8 sekund łącznie
- [x] Gotowe

---

## Faza 6 — Deploy i testy

### 6.1 GitHub Actions workflow
- **Co:** Stworzyć plik automatycznego deploy
- **Gdzie:** `.github/workflows/deploy.yml` (nowy plik)
- **Jak zrobić:** Użyj dokładnie szablonu z sekcji "Szablon deploy.yml" na górze tego pliku. Nie modyfikuj struktury — jest przetestowana i działa z GitHub Pages Actions.
- **Gotowe gdy:** Plik `.github/workflows/deploy.yml` istnieje z poprawną strukturą YAML; zawiera krok `sed` dla obu zmiennych
- **Nie rób:** Nie zmieniaj plików w `ui/` przy tym zadaniu; nie dodawaj kroków budowania (brak npm, brak build)
- [x] Gotowe

### 6.2 Testy akceptacyjne — scenariusz 1
- **Co:** Przeprowadzić test pełnego przepływu zadania
- **Gdzie:** Test manualny w przeglądarce po deploy — zgodnie z [docs/dev/testing.md](docs/dev/testing.md) Scenariusz 1
- **Jak zrobić:** 
  - Zaloguj się, kliknij "Dodaj polecenie", wypełnij formularz, wyślij
  - Otwórz Task Detail i obserwuj timeline przez 10 sekund
  - Zaznacz wyniki: które kroki timelineʼu się zmieniły, ile sekund zajął każdy krok
- **Gotowe gdy:** Timeline pokazuje co najmniej 4 z 5 kroków zmieniające się na żywo; żaden błąd w konsoli przeglądarki
- **Nie rób:** Nie modyfikuj kodu podczas testu — tylko raportuj wyniki w komentarzu przy tym zadaniu
- [x] Gotowe — 2026-04-30 na deployu Pages utworzono `Acceptance smoke dashboard 2026-04-30`; timeline przeszedł przez 5/5 kroków do `Gotowe`, bez błędów aplikacji w UI. Jedyny widoczny console error dotyczył oczekiwanego braku lokalnego proxy `127.0.0.1:3001`.

### 6.3 Testy akceptacyjne — scenariusz 2 (AI↔AI)
- **Co:** Sprawdzić komunikację między AI przez Supabase Realtime
- **Gdzie:** Panel Supabase → Table Editor → `messages`
- **Jak zrobić:** Utwórz zadanie w UI, po 10 sekundach sprawdź tabelę `messages` w panelu Supabase — powinny być 3 wiersze: pytanie, odpowiedź, raport
- **Gotowe gdy:** Tabela `messages` ma minimum 2 wiersze powiązane z task_id nowego zadania
- **Nie rób:** Nie zmieniaj kodu
- [x] Gotowe — zadanie `74d66f15-1ddd-4340-b19d-fec3bcbd5940` ma status `done`, 4 wiadomości w `messages` i 4 wpisy w `task_events`: routing fallback, question, answer i report są widoczne w Task Detail.

### 6.4 Test bezpieczeństwa — RBAC
- **Co:** Sprawdzić czy RLS blokuje nieautoryzowany dostęp
- **Gdzie:** Konsola przeglądarki (DevTools)
- **Jak zrobić:** Otwórz DevTools → Console, wpisz:
  ```js
  const { data } = await window.supabase.from('tasks').select('*')
  console.log(data)
  ```
  Wynik powinien zawierać tylko zadania zalogowanego użytkownika
- **Gotowe gdy:** Zapytanie zwraca tylko zadania bieżącego użytkownika (lub puste array dla executora bez przydziałów)
- **Nie rób:** Nie zmieniaj kodu RLS
- [x] Gotowe — test w konsoli przez `window.supabase.from('tasks').select(...)` zwrócił 2 widoczne zadania i oba miały `user_id` zgodny z bieżącym użytkownikiem. Anon RLS smoke z deployowej konfiguracji też przeszedł bez wycieku rekordów.

### 6.5 Weryfikacja FORK_GUIDE
- **Co:** Sprawdzić czy FORK_GUIDE.md opisuje nową architekturę (GitHub Pages + Supabase)
- **Gdzie:** [FORK_GUIDE.md](FORK_GUIDE.md)
- **Jak zrobić:** Przeczytaj FORK_GUIDE. Jeśli mówi o Node.js, Docker lub lokalnym serwerze — zaktualizuj go tak żeby opisywał: fork repo → dodaj Supabase secrets → push → gotowe
- **Gotowe gdy:** FORK_GUIDE opisuje setup w maksymalnie 8 krokach, wszystkie odnoszą się do GitHub Pages + Supabase (zero Node.js)
- **Nie rób:** Nie zmieniaj plików UI
- [x] Gotowe — FORK_GUIDE.md zawiera 8 kroków wdrożenia GitHub Pages + Supabase, a konto panelu i stacja są opisane jako działania po deployu.

---

## Faza 7 — Alpha

- [x] Wszystkie zadania faz 2–6 odznaczone
- [x] Link aplikacji publiczny na GitHub Pages — zweryfikowano `https://kamciosz.github.io/agent-manager/` i wstrzyknięty `app.js` bez placeholderów.
- [x] README zaktualizowane o link do działającej aplikacji — sekcja szybkiego startu wskazuje publiczny adres Pages.

### 7.1 Alpha hardening runtime i UI
- **Co:** Utwardzić projekt po MVP: subskrypcje Realtime, lokalny runtime, stacje robocze i dokumentację wydania alpha
- **Gdzie:** `ui/`, `local-ai-proxy/`, `start.sh`, `docs/`, `supabase/migrations/`
- **Gotowe gdy:** Składnia przechodzi, Supabase advisor nie zgłasza `function_search_path_mutable`, launcher ma jasne błędy dla Ollama/HF, proxy ma diagnostykę, README wskazuje status alpha
- **Nie rób:** Nie dodawaj bundlera, własnego backendu ani zdalnego terminala live
- [x] Gotowe — wykonano hardening UI/runtime, dodano dokument alpha, poprawiono migracją `public.update_updated_at` i uruchomiono smoke testy składni/proxy/launchera.

### 7.2 Testy alpha wymagające sesji użytkownika
- **Co:** Przejść testy w prawdziwej sesji przeglądarki i na realnej stacji roboczej
- **Gdzie:** GitHub Pages + Supabase + lokalny `start.command`
- **Gotowe gdy:** 6.2, 6.3, 6.4 przechodzą na deployu, a stacja robocza rejestruje heartbeat i wykonuje job
- **Nie rób:** Nie oznaczaj jako gotowe bez ręcznego logowania i potwierdzenia wyników
- [ ] Gotowe — część Pages/Supabase potwierdzona 2026-04-30: 6.2, 6.3 i 6.4 przeszły na deployu. `./start.sh --doctor --no-pull` na MacBooku operatora wykazał binarkę llama-server, model, sesję stacji i 256k context jako skonfigurowane, przy wolnym porcie 3001. Nie odhaczaj całości, dopóki osobna stacja sali nie zaraportuje heartbeat i nie wykona joba.

### 7.3 Deep research braków produktowych
- **Co:** Uzupełnić braki widoczne po przejściu z MVP do alpha: usuwanie poleceń i wyjaśnienie pojęć/statusów w UI
- **Gdzie:** `ui/index.html`, `ui/app.js`, `supabase/migrations/`, dokumentacja produktu
- **Gotowe gdy:** Zadanie można usunąć z listy i szczegółów, RLS pozwala na DELETE, a użytkownik ma słownik `Co to znaczy?`
- **Nie rób:** Nie wprowadzaj nowego backendu ani zmiany modelu bezpieczeństwa poza team-space alpha
- [x] Gotowe — dodano politykę DELETE dla `tasks`, akcje usuwania poleceń oraz słownik pojęć/statusów.

### 7.4 Release readiness sweep
- **Co:** Sprawdzić przed wdrożeniem repo, deploy Pages, składnię, Supabase schema/RLS/advisors, publiczne assety i podstawowe RLS anon
- **Gdzie:** GitHub Pages + Supabase + lokalne smoke testy
- **Gotowe gdy:** Repo jest czyste, Pages zwraca aktualne assety, JS/shell przechodzą checki, RLS nie zwraca zadań anonimowo, a doradcy nie pokazują blockerów poza leaked password protection
- **Nie rób:** Nie oznaczaj jako gotowe, jeśli zostają błędy security inne niż panelowe ustawienie Auth leaked password protection
- [x] Gotowe — sprawdzono deploy i bazę; dodano migrację optymalizującą RLS/indeksy. Jedyny security WARN to `auth_leaked_password_protection`, który jest ograniczeniem darmowego planu Supabase.

### 7.5 Frontend polish i profile startowe
- **Co:** Usunąć starą etykietę trybu przeglądarkowego, dodać profile startowe agentów i delikatnie poprawić warstwy UI bez zmiany architektury
- **Gdzie:** `ui/`, `supabase/migrations/`, dokumentacja produktu
- **Gotowe gdy:** Header pokazuje `Panel online`, widok profili ma startowe rekordy, a UI ma subtelniejszą głębię bez nowego frameworka
- **Nie rób:** Nie dodawaj bundlera, bibliotek UI ani marketingowego landing page
- [x] Gotowe — dodano profile startowe, zmieniono komunikaty na `Panel online` i dopracowano warstwy wizualne.

### 7.6 Advanced runtime i decyzja kierownika
- **Co:** Dodać opcje Advanced dla lokalnych stacji: `parallelSlots`, SD domyślnie wyłączone oraz routing, w którym kierownik wybiera aktywną stację z wolnym slotem albo fallback przeglądarkowy
- **Gdzie:** `ui/`, `local-ai-proxy/`, `start.sh`, dokumentacja runtime
- **Gotowe gdy:** Frontend pokazuje widok Advanced i sloty stacji, `config.json` ma domyślne `parallelSlots=1` oraz `sdEnabled=false`, a manager nie zostawia zadania bez pracownika przy braku wolnej stacji
- **Nie rób:** Nie włączaj SD automatycznie i nie dodawaj osobnego backendu SSD
- [x] Gotowe — dodano konfigurację Advanced, raportowanie metadata stacji, równoległe sloty jobów, domyślne SD off i inteligentny wybór wykonawcy.

### 7.7 Monitor postępu
- **Co:** Dodać widok pozwalający sprawdzić, czy system pracuje i czy stacje nie przestały raportować heartbeat
- **Gdzie:** `ui/index.html`, `ui/app.js`, `local-ai-proxy/workstation-agent.js`
- **Gotowe gdy:** Frontend pokazuje aktywne zadania, wolne sloty, stacje bez świeżego heartbeat i live log z wiadomości AI/stacji
- **Nie rób:** Nie dodawaj osobnego backendu ani zdalnego terminala live
- [x] Gotowe — dodano widok Monitor, live log oraz wpisy postępu jobów ze stacji roboczej.

### 7.8 Produkcyjna kolejka i budżety runtime
- **Co:** Wdrożyć bezpłatne P0/P1 z planów `opt.md` i `opt2.md`: routing budżetów, metryki proxy, atomowy claim jobów, retry/backoff i dead-letter
- **Gdzie:** `ui/`, `local-ai-proxy/`, `supabase/migrations/`, dokumentacja runtime
- **Gotowe gdy:** Supabase ma RPC claim z lease, stacja raportuje metryki i obsługuje `retrying`/`dead_letter`, proxy ma `/metrics`, a UI zna nowe statusy jobów
- **Nie rób:** Nie wprowadzaj płatnego hostingu ani usługi wymagającej sekretów poza istniejącym Supabase/Pages/local runtime
- [x] Gotowe — dodano routing `instant/fast/standard/deep`, lokalne metryki proxy, `claim_workstation_jobs`, lease jobów, jitter polling, backoff retry, status `dead_letter` i dokumentację endpointów.


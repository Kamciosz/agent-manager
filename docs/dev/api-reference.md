# Supabase — opis integracji

Data: 2026-04-28

Opis tego co aplikacja robi z Supabase i jakie dane przechowuje. Bez kodu — to jest plan koncepcyjny.

---

## Połączenie z Supabase

Aplikacja łączy się z Supabase przy starcie, używając dwóch wartości konfiguracyjnych: adresu projektu i publicznego klucza `anon key`. Obie wartości są wstrzykiwane automatycznie przez GitHub Actions z GitHub Secrets — użytkownik końcowy nic nie konfiguruje.

---

## Tabele w bazie danych

### Tabela `tasks` — zadania

Przechowuje wszystkie zadania zgłoszone przez użytkowników.

| Pole | Typ | Opis |
|------|-----|------|
| `id` | UUID | Unikalny identyfikator — generowany automatycznie |
| `title` | tekst | Tytuł zadania |
| `description` | tekst | Opis zadania |
| `priority` | tekst | `low` / `medium` / `high` |
| `status` | tekst | `pending` / `analyzing` / `in_progress` / `done` / `failed` / `cancelled` |
| `user_id` | UUID | ID użytkownika który zgłosił zadanie |
| `git_repo` | tekst | Opcjonalnie: powiązane repozytorium Git |
| `context` | JSON | Dodatkowe informacje; UI zapisuje `{ template, raw }`, a Hermes Labyrinth używa `raw.workflow` |
| `requested_workstation_id` | UUID | Opcjonalnie: jedna wskazana stacja robocza |
| `requested_model_name` | tekst | Opcjonalnie: model wybrany dla wskazanej stacji |
| `retry_count` | liczba | Ile razy zadanie było ponawiane |
| `max_attempts` | liczba | Limit prób; domyślnie `3` |
| `last_error` | tekst | Ostatni błąd wysokiego poziomu dla zadania |
| `cancel_requested_at` | timestamp | Kiedy poproszono o anulowanie |
| `cancelled_by_user_id` | UUID | Kto poprosił o anulowanie |
| `created_at` | timestamp | Data utworzenia — generowana automatycznie |

Nowa migracja P0 ogranicza zwykłego użytkownika do 3 aktywnych zadań (`pending`, `analyzing`, `in_progress`). Role `admin`, `manager`, `operator` i `teacher` są traktowane jako operatorzy i nie mają tego limitu.

### Tabela `task_feedback` — oceny wyników

Przechowuje ręczną ocenę wyniku pojedynczego zadania. To lekki odpowiednik ewaluacji z narzędzi trace/eval: operator może oznaczyć wynik jako dobry albo zły i dopisać krótką notatkę do późniejszej regresji.

| Pole | Typ | Opis |
|------|-----|------|
| `id` | UUID | Unikalny identyfikator |
| `task_id` | UUID | Powiązane zadanie; usuwane kaskadowo razem z zadaniem |
| `user_id` | UUID | Użytkownik, który wystawił ocenę |
| `rating` | tekst | `good` albo `bad` |
| `comment` | tekst | Opcjonalna notatka jakościowa |
| `created_at` | timestamp | Data pierwszej oceny |
| `updated_at` | timestamp | Data ostatniej zmiany oceny |

Na parę `task_id + user_id` przypada jedna ocena. RLS pozwala użytkownikom aplikacji czytać feedback i zarządzać własnym wpisem; techniczne konta stacji nie mają dostępu do tej tabeli.

### Tabela `assignments` — przydziały

Przechowuje informacje o tym który agent wykonawczy dostał które zadanie.

| Pole | Typ | Opis |
|------|-----|------|
| `id` | UUID | Unikalny identyfikator |
| `task_id` | UUID | Powiązane zadanie |
| `agent_id` | tekst | Identyfikator agenta wykonawczego |
| `instructions` | tekst | Co dokładnie ma zrobić |
| `profile` | tekst | Profil agenta (np. `programista`, `tester`) |
| `created_at` | timestamp | Kiedy AI kierownik przydzielił zadanie |

### Tabela `agents` — profile agentów

Przechowuje profile agentów wykonawczych — kto jest dostępny i jakie ma umiejętności.

| Pole | Typ | Opis |
|------|-----|------|
| `id` | UUID | Unikalny identyfikator |
| `name` | tekst | Nazwa agenta |
| `role` | tekst | Rola (executor, specialist itp.) |
| `skills` | tablica | Lista umiejętności (np. `["python", "html", "css"]`) |
| `concurrency_limit` | liczba | Ile zadań może mieć jednocześnie |

### Tabela `messages` — wiadomości między AI

Przechowuje wiadomości wymieniane między AI kierownikiem a agentami wykonawczymi (pytania, odpowiedzi, raporty).

| Pole | Typ | Opis |
|------|-----|------|
| `id` | UUID | Unikalny identyfikator |
| `from_agent` | tekst | Nadawca (`manager` lub `agent-X`) |
| `to_agent` | tekst | Odbiorca |
| `type` | tekst | `question` / `answer` / `report` / `correction` |
| `content` | tekst | Treść wiadomości |
| `task_id` | UUID | Powiązane zadanie |
| `created_at` | timestamp | Kiedy wysłano |

---

## Kanały Realtime (pub/sub)

Supabase Realtime pozwala AI-om komunikować się na żywo przez kanały. Każdy kanał to jak oddzielny czat — AI subskrybuje te które go dotyczą.

| Kanał | Kto subskrybuje | Co przepływa |
|-------|----------------|-------------|
| `tasks` | AI kierownik | Nowe zadania od użytkowników |
| `assignments` | Agenty wykonawcze | Przydziały od AI kierownika |
| `sync` | Agenty wykonawcze między sobą | Synchronizacja (np. „skończyłem moduł X”) |
| `questions` | AI kierownik | Pytania agentów wykonawczych do AI kierownika |
| `answers` | Agenty wykonawcze | Odpowiedzi AI kierownika |
| `reports` | AI kierownik, użytkownik | Raporty ukończenia od agentów wykonawczych |

---

## Logowanie i role

Supabase Auth zarządza kontami użytkowników i agentów wykonawczych. Role są zapisane w metadanych konta.

| Rola | Kto ma | Co może |
|------|--------|---------|
| `manager` | Właściciel projektu | Wszystko: zadania, przydziały, profile, raporty |
| `executor` | Agent wykonawczy / użytkownik-wykonawca | Tylko swoje przydziały i aktualizacje statusu |
| `viewer` | Obserwator | Tylko odczyt zadań |

Role są przypisywane przez managera w UI — żadnego kodu, żadnego terminala.

---

## Bezpieczeństwo — Row Level Security (RLS)

Każda tabela ma polityki RLS ustawione w panelu Supabase. Działają automatycznie — baza sama filtruje dane przy każdym zapytaniu.

| Tabela | Reguła |
|--------|--------|
| `tasks` | Manager widzi wszystkie; executor tylko swoje przydzielone; viewer tylko do odczytu |
| `assignments` | Agent wykonawczy widzi tylko swoje przydziały |
| `messages` | AI widzi tylko wiadomości do siebie lub od siebie |
| `agents` | Manager może edytować; executor widzi listę |

## Konfiguracja połączenia

Na początku każdego pliku JS który potrzebuje Supabase:

```js
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,       // z GitHub Secrets → GitHub Actions → wbudowane w build
  process.env.SUPABASE_ANON_KEY   // bezpieczny klucz publiczny
)
```

---

## Zadania (tabela `tasks`)

### Utwórz zadanie

```js
const { data, error } = await supabase
  .from('tasks')
  .insert({
    title: 'Zrób stronę logowania',
    description: 'Z walidacją emaila i hasła',
    priority: 'high',
    repo: 'owner/repo',
    status: 'pending'
  })
  .select()
  .single()

// data.id — wygenerowane automatycznie ID zadania
```

### Pobierz zadania użytkownika

```js
const { data: tasks } = await supabase
  .from('tasks')
  .select('*')
  .order('created_at', { ascending: false })
```

### Zaktualizuj status zadania

```js
await supabase
  .from('tasks')
  .update({ status: 'in_progress', progress: 40 })
  .eq('id', taskId)
```

Dopuszczalne wartości `status`: `pending`, `analyzing`, `in_progress`, `done`, `failed`, `cancelled`.

### Edytuj polecenie przed wykonaniem

UI pozwala poprawić tytuł, opis, priorytet, repo, kontekst, stację i model tylko wtedy, gdy zadanie jest jeszcze bezpieczne do zmiany: `pending`, `failed` albo `cancelled`.

```js
await supabase
  .from('tasks')
  .update({
    title: 'Popraw formularz logowania',
    description: 'Dodaj walidację emaila i czytelny błąd.',
    priority: 'high',
    git_repo: 'owner/repo',
    requested_workstation_id: workstationId || null,
    requested_model_name: modelName || null,
  })
  .eq('id', taskId)
  .in('status', ['pending', 'failed', 'cancelled'])
```

### Anuluj i ponów zadanie

Panel anuluje aktywne zadanie przez ustawienie `tasks.status = 'cancelled'` oraz anulowanie aktywnych `workstation_jobs` dla tego `task_id`. Spóźniony wynik stacji albo fallbackowego executora nie powinien nadpisać statusu `cancelled`.

```js
await supabase
  .from('tasks')
  .update({ status: 'cancelled', cancel_requested_at: new Date().toISOString() })
  .eq('id', taskId)
  .in('status', ['pending', 'analyzing', 'in_progress'])
```

Ponowienie działa na tym samym rekordzie: UI zwiększa `retry_count`, czyści pola anulowania i ustawia `status = 'pending'`. AI kierownik subskrybuje też aktualizacje `tasks`, więc traktuje taki rekord jak powrót do kolejki.

### Usuń zadanie

```js
await supabase
  .from('tasks')
  .delete()
  .eq('id', taskId)
```

W obecnym modelu alpha zalogowany użytkownik zespołu może usunąć zadanie. Relacje w bazie zachowują się następująco:

| Dane powiązane | Zachowanie po usunięciu zadania |
|----------------|----------------------------------|
| `assignments` | usuwane kaskadowo |
| `messages` | usuwane kaskadowo |
| `workstation_jobs` | zostają, ale `task_id` jest ustawiane na `null` |
| `workstation_messages` | zostają, ale `task_id` jest ustawiane na `null` |

### Oceń wynik zadania

```js
await supabase
  .from('task_feedback')
  .upsert({
    task_id: taskId,
    user_id: user.id,
    rating: 'good',
    comment: 'Wynik spełnia oczekiwania smoke testu.'
  }, { onConflict: 'task_id,user_id' })
```

Prosty dataset regresyjny dla ręcznych porównań znajduje się w `tests/data/regression-prompts.json`.

---

## Komunikacja AI↔AI w czasie rzeczywistym (Supabase Realtime)

Agenci komunikują się przez kanały pub/sub — każdy AI subskrybuje te kanały których potrzebuje.

### AI kierownik — subskrybuj nowe zadania

```js
const channel = supabase
  .channel('tasks')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'tasks'
  }, (payload) => {
    if (payload.new?.status === 'pending') {
      console.log('Zadanie do obsługi:', payload.new)
      // AI kierownik analizuje i przydziela albo obsługuje retry
    }
  })
  .subscribe()
```

### AI kierownik — wyślij przydział do agenta wykonawczego

```js
await supabase
  .from('assignments')
  .insert({
    task_id: taskId,
    agent_id: 'agent-42',
    instructions: 'Zrób HTML strukturę strony',
    profile: 'programista'
  })
```

### Agent wykonawczy — odbierz swoje przydziały

```js
supabase
  .channel('assignments')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'assignments',
    filter: `agent_id=eq.${myAgentId}`
  }, (payload) => {
    console.log('Nowe zadanie dla mnie:', payload.new)
    // agent wykonawczy zaczyna pracę
  })
  .subscribe()
```

### Agenty wykonawcze synchronizują się między sobą

```js
// Agent-A wysyła wiadomość do wszystkich w kanale 'sync'
supabase
  .channel('sync')
  .send({
    type: 'broadcast',
    event: 'task_done',
    payload: { module: 'login.html', agent: 'agent-A', message: 'Gotowe, możesz zacząć integrację' }
  })

// Agent-B subskrybuje i odbiera
supabase
  .channel('sync')
  .on('broadcast', { event: 'task_done' }, (payload) => {
    console.log('Synchronizacja:', payload)
  })
  .subscribe()
```

### Agent wykonawczy pyta AI kierownika o wyjaśnienie

```js
// Agent wykonawczy wysyła pytanie
await supabase
  .from('messages')
  .insert({
    from_agent: 'agent-42',
    to_agent: 'manager',
    type: 'question',
    content: 'Czy mam użyć React czy czysty HTML?'
  })

// Szef odbiera w czasie rzeczywistym
supabase
  .channel('messages')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'messages',
    filter: `to_agent=eq.manager`
  }, handleQuestion)
  .subscribe()
```

---

## Logowanie i sesje (Supabase Auth)

### Rejestracja

```js
const { data, error } = await supabase.auth.signUp({
  email: 'user@example.com',
  password: 'haslo123'
})
```

### Logowanie

```js
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'haslo123'
})
```

### Wylogowanie

```js
await supabase.auth.signOut()
```

### Pobierz aktualnego użytkownika

```js
const { data: { user } } = await supabase.auth.getUser()
// user.id, user.email, user.app_metadata.role
```

---

## Role i bezpieczeństwo (Row Level Security)

Każdy użytkownik widzi tylko to co powinien — kontrolowane przez polityki RLS w bazie danych Supabase. Nie trzeba nic robić w kodzie aplikacji — Supabase automatycznie filtruje dane na podstawie zalogowanego użytkownika.

| Rola | Co widzi |
|------|---------|
| `manager` | Wszystkie zadania, wszyscy agenci, pełne raporty |
| `executor` | Tylko swoje przydziały i zadania do których jest przypisany |
| `viewer` | Zadania tylko do odczytu (bez możliwości edycji) |

Role są przypisywane przez managera w UI — nie przez kod.


---

## 4. agentProfiles — zarządzanie profilami

**POST** `/api/v1/agents/profiles` _(token managera)_

```bash
curl -s -X POST "$API_URL/api/v1/agents/profiles" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "python-worker",
    "role": "executor",
    "skills": ["python", "tests"],
    "concurrencyLimit": 1
  }'
```

**201 Created** — zwraca `id` utworzonego profilu.

Pozostałe operacje CRUD: `GET /api/v1/agents/profiles`, `GET /{id}`, `PUT /{id}`, `DELETE /{id}`.

---

## 5. autodebug — uruchom diagnostykę

**POST** `/api/v1/tasks/{id}/debug` _(token managera)_

```bash
curl -s -X POST "$API_URL/api/v1/tasks/task-0001/debug" \
  -H "Authorization: Bearer $MANAGER_TOKEN"
```

**202 Accepted:**
```json
{ "debugReportId": "dbg-0001" }
```

**GET** `/api/v1/tasks/{id}/debug/{debugReportId}`:
```json
{
  "debugReportId": "dbg-0001",
  "logs": [...],
  "traces": [...],
  "suggested_fix": "..."
}
```

Automatyczne uruchomienie: po ustawieniu `status=failed` przez agenta.

---

## 6. accessControl — weryfikacja ról

Brak tokena → **401**:
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/v1/tasks" -d '{}'
# → 401
```

Token z rolą `viewer` próbuje przypisać → **403**:
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$API_URL/api/v1/tasks/task-0001/assign" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -d '{"assignee":"agent-1"}'
# → 403
```

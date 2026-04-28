# Architektura — przegląd

## Założenia sieciowe

| Wymaganie | Status |
|-----------|--------|
| Bez LAN | ✅ |
| Bez uprawnień administratora | ✅ |
| Działa na szkolnym/firmowym WiFi | ✅ (tylko port 443 wychodzący) |
| Darmowe | ✅ |
| Bezpieczne | ✅ (HTTPS + JWT Supabase) |
| Bez własnego serwera | ✅ backend to Supabase — usługa zewnętrzna |
| Aplikacja na GitHub | ✅ UI hostowany na GitHub Pages |

## Kluczowa decyzja: nie ma własnego serwera

Aplikacja żyje na **GitHub** i korzysta z **Supabase** jako gotowego backendu.

- GitHub Pages hostuje interfejs webowy (statyczne pliki HTML/JS) — darmowe, bez serwera
- Supabase dostarcza: bazę danych, autentykację, kanały real-time (WebSocket) — darmowe, bez konfiguracji serwera
- Agenci i użytkownicy łączą się do Supabase przez zwykły HTTPS/WebSocket na porcie 443

Nikt nigdy nie uruchamia żadnego serwera. Każdy otwiera tylko przeglądarkę.

## Czy Supabase trzeba ustawić ręcznie?

**Jednorazowo: tak — 5 minut klikania. Potem: w pełni automatyczne.**

### Jednorazowy setup (robi tylko właściciel projektu, raz na zawsze)

1. Wejdź na [supabase.com](https://supabase.com) → utwórz darmowe konto → kliknij „New project" → nadaj nazwę → kliknij „Create".
2. Skopiuj dwie wartości z panelu Supabase (`Project URL` i `anon key`) i wklej je jako **GitHub Secrets** w ustawieniach repozytorium.
3. Gotowe — od tej chwili wszystko działa automatycznie.

Łącznie: ~5 minut, zero kodu, zero terminala.

### Co dzieje się automatycznie po każdym push do repozytorium

```
git push → GitHub Actions uruchamia się automatycznie
    │
    ├─ supabase db push   ← aplikuje tabele i polityki bezpieczeństwa z plików SQL w repo
    └─ deploy na GitHub Pages ← publikuje nową wersję UI
```

Schemat bazy danych (tabele, RLS, kanały) jest przechowywany jako pliki SQL w repozytorium. GitHub Actions stosuje je automatycznie — nie trzeba ręcznie klikać w panelu Supabase przy każdej zmianie.

### Co robią nowi użytkownicy / agenci (zero konfiguracji)

1. Otwierają link aplikacji (GitHub Pages).
2. Rejestrują się emailem i hasłem — Supabase Auth obsługuje to automatycznie.
3. Manager przypisuje im rolę w UI.
4. Gotowe — mogą korzystać z systemu.

Nikt poza właścicielem projektu nie widzi żadnego panelu Supabase ani nie dotyka żadnych kluczy API.

## Główne komponenty

```
┌──────────────────────────────────────────────────────────────┐
│                  GitHub Pages                                │
│              (UI aplikacji — statyczny)                      │
│  github.com/user/agent-manager  →  user.github.io/agent-...  │
└────────────────────────────┬─────────────────────────────────┘
                             │  HTTPS port 443
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                     Supabase (darmowy)                       │
│                                                              │
│  ┌─────────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │  Realtime       │  │  Database    │  │  Auth (JWT)    │  │
│  │  (WebSocket)    │  │  (zadania,   │  │  (konta        │  │
│  │  pub/sub        │  │   agenci,    │  │   użytkowników)│  │
│  │  channels       │  │   statusy)   │  │                │  │
│  └─────────────────┘  └──────────────┘  └────────────────┘  │
└────────────────────────────┬─────────────────────────────────┘
                             │  WSS port 443
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
  │ Użytkownik     │ │ Agent A        │ │ Agent B        │
  │ (przeglądarka) │ │ szkolne WiFi ✅│ │ domowe WiFi ✅ │
  └────────────────┘ └────────────────┘ └────────────────┘
```

> Szkolne WiFi zawsze przepuszcza wychodzący HTTPS/WSS na port 443. Blokuje tylko połączenia przychodzące i inne porty — tego nie używamy.

## Dlaczego szkolne WiFi działa

Szkolne/firmowe sieci blokują:
- połączenia **przychodzące** do komputerów uczniów ← nie używamy tego
- porty inne niż 80/443 ← nie używamy tego

Szkolne sieci **zawsze** przepuszczają:
- wychodzący HTTPS port 443 ← **jedyne co używamy**

Każdy komputer (agent, użytkownik) nawiązuje połączenie **wychodzące** do serwera w chmurze na port 443. Zero konfiguracji sieci.

## Stos technologiczny

| Komponent | Wybór | Koszt | Konfiguracja |
|-----------|-------|-------|--------------|
| UI aplikacji | GitHub Pages | Darmowy | Push do repo = deploy |
| Real-time / WebSocket | Supabase Realtime | Darmowy (free tier) | Kliknięcia w panelu |
| Baza danych (zadania, agenci) | Supabase Database (Postgres) | Darmowy (500 MB) | Kliknięcia w panelu |
| Autentykacja (konta) | Supabase Auth | Darmowy | Kliknięcia w panelu |
| TLS / HTTPS | Automatyczny w Supabase | Darmowy | Zero konfiguracji |

**Łączny koszt dla małego zespołu (MVP): 0 zł / miesiąc.**

Free tier Supabase wystarcza dla MVP: 50 000 wiadomości real-time/mies., 500 MB DB, nieograniczona liczba użytkowników.

## Bezpieczeństwo

- Całość przez HTTPS/WSS — ruch szyfrowany, certyfikat zarządzany przez Supabase.
- Każdy użytkownik i agent loguje się przez Supabase Auth — konto email/hasło lub OAuth.
- Row Level Security (RLS) w bazie — każdy widzi tylko dane swojego tenantu.
- Tokeny JWT generowane i weryfikowane przez Supabase — nie trzeba tego pisać.
- Klucz API (`anon key`) jest publiczny i bezpieczny — można go commitować do repozytorium; dostęp do danych kontroluje RLS, nie klucz.

## Przepływ wiadomości

1. Użytkownik otwiera web UI → wysyła zadanie do gateway w chmurze.
2. AI Kierownik (jeden z agentów) odbiera zadanie, planuje, przydziela.
3. Agenci wykonawczy (na dowolnych komputerach) odbierają swoje podzadania przez WSS.
4. Agenci raportują postęp → gateway → AI Kierownik → użytkownik widzi w UI.

## Kolejkowanie offline

Gdy agent jest niedostępny, zadanie trafia do kolejki Upstash Redis. Gdy agent wróci online, gateway automatycznie dostarcza zaległe wiadomości.

| Gateway (WebSocket server) | Uwierzytelnia agentów, routuje wiadomości |
| Redis | Pub/sub + kolejki dla offline delivery |
| nginx/Caddy | TLS termination, reverse proxy |
| Admin panel | Wystawianie tokenów, zarządzanie tenantami _(nie zaimplementowane w prototypie)_ |

## Lokalny runtime AI (opcjonalny)

Domyślnie agenci (`ui/manager.js`, `ui/executor.js`) generują odpowiedzi z hardcoded tekstów (tryb demo). Można jednak podpiąć **lokalny model językowy** (llama.cpp + GGUF), który działa w tle na komputerze użytkownika i zastępuje symulację prawdziwymi odpowiedziami.

```
┌──────────────────────────────┐
│  Przeglądarka (GitHub Pages) │
│  ui/ai-client.js             │
└──────────────┬───────────────┘
               │  HTTP fetch /generate
               ▼  (127.0.0.1 = secure context, brak mixed-content)
┌──────────────────────────────┐
│  http://127.0.0.1:3001       │
│  Node proxy (proxy.js)       │  ← bez zależności, czysty Node 18+
└──────────────┬───────────────┘
               │  HTTP /completion
               ▼
┌──────────────────────────────┐
│  http://127.0.0.1:8080       │
│  llama-server (binary)       │  ← Metal / CUDA / ROCm / Vulkan / CPU
└──────────────┬───────────────┘
               │
               ▼
        plik .gguf w models/
```

### Komponenty

| Element | Plik / źródło | Rola |
|---------|---------------|------|
| `ai-client.js` | `ui/ai-client.js` | Health-check co 30 s, `generate()`, badge statusu w UI. Rzuca `AiUnavailableError` ⇒ manager/executor wpadają w fallback. |
| Proxy HTTP | `local-ai-proxy/proxy.js` | Endpoints `GET /health`, `POST /generate`. CORS `*`. Bind `127.0.0.1`. |
| `llama-server` | binary z [llama.cpp Releases](https://github.com/ggerganov/llama.cpp/releases) | Wnioskowanie GGUF z akceleracją GPU. |
| Launchery | `start.sh`, `start.bat` | Detekcja OS / arch / GPU, pobranie binary, dialog o model, start obu procesów, cleanup. |
| Konfiguracja | `local-ai-proxy/config.json` | Ścieżka modelu, porty, backend (gitignored). |

### Decyzje projektowe

- **Brak mixed-content workaround** — `127.0.0.1` to secure context wg W3C, więc HTTPS Pages może wołać `http://127.0.0.1:3001` bezpośrednio.
- **Zero zależności w proxy** — tylko `node:http`, `node:fs`, `node:path`. Nie wymaga `npm install`, działa na każdej instalacji Node 18+.
- **Fallback to symulacja, nie błąd** — gdy proxy padnie, UI dalej działa (tryb demo). Migracja AI ↔ symulacja jest płynna i widoczna w badge.
- **Model wybiera użytkownik raz** — pierwsze uruchomienie pyta o URL HF lub ścieżkę. Kolejne starty są ciche; `--change-model` resetuje.
- **Tylko lokalnie** — proxy nasłuchuje wyłącznie na `127.0.0.1`, nie jest udostępniane w sieci.

Szczegóły uruchomienia, flagi i troubleshooting: [local-ai-proxy/README.md](../../local-ai-proxy/README.md).

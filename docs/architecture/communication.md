# Komunikacja i architektura rozproszona

## Dlaczego port 443?

Port 443 (HTTPS/WSS) to jedyny port **gwarantowanie otwarty wszędzie**:

| Sieć | Port 443 wychodząco |
|------|---------------------|
| Szkolne WiFi | ✅ zawsze (to zwykły HTTPS) |
| Firmowa sieć | ✅ zawsze |
| Domowe WiFi | ✅ zawsze |
| Mobilny internet | ✅ zawsze |

Szkolne sieci blokują połączenia **przychodzące** i inne porty — ale **nigdy nie blokują wychodzącego HTTPS**, bo wtedy uczniowie nie mogliby przeglądać stron. To właśnie port 443 i jedynie połączenia **wychodzące** — dokładnie to co robi Supabase.

---

## Rozwiązanie: Supabase jako backend

Supabase to darmowa platforma Backend-as-a-Service (BaaS). Dostarcza wszystko czego potrzebuje Agent Manager bez stawiania jakiegokolwiek serwera:

| Potrzeba | Co daje Supabase | Jak to skonfigurować |
|----------|-----------------|---------------------|
| Real-time messaging między agentami | Supabase Realtime (WebSocket, port 443) | Klikanie w panelu webowym |
| Przechowywanie zadań i statusów | Supabase Database (PostgreSQL) | Klikanie w panelu webowym |
| Logowanie użytkowników i agentów | Supabase Auth (email, OAuth) | Klikanie w panelu webowym |
| Bezpieczeństwo danych | Row Level Security (RLS) | Klikanie w panelu webowym |
| TLS / szyfrowanie | Automatyczne | Zero konfiguracji |

**Nikt nie instaluje serwera. Nikt nie otwiera portów. Każdy tylko otwiera przeglądarkę.**

## Jak wygląda połączenie

```
Komputer A (szkolne WiFi)            Komputer B (inne WiFi)
┌──────────────────────┐             ┌──────────────────────┐
│  Przeglądarka        │             │  Przeglądarka        │
│  (UI agenta)         │             │  (UI agenta)         │
└──────────┬───────────┘             └──────────┬───────────┘
           │ HTTPS port 443 →                   │ HTTPS port 443 →
           ▼                                    ▼
┌──────────────────────────────────────────────────────────┐
│                   Supabase (chmura)                       │
│  ┌────────────────┐  ┌───────────┐  ┌──────────────────┐ │
│  │   Realtime     │  │ Database  │  │  Auth            │ │
│  │ (pub/sub WSS)  │  │ (zadania) │  │  (konta/tokeny)  │ │
│  └────────────────┘  └───────────┘  └──────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

Oba komputery łączą się **wychodzącym** połączeniem na port 443 do Supabase. Nigdy ze sobą bezpośrednio — przez co NAT, firewalle i szkolne WiFi nie stanowią żadnego problemu.

## Komunikacja AI ↔ AI

Agenci aktywnie komunikują się ze sobą w obie strony przez Supabase Realtime. Supabase nie jest tu "pośrednikiem który spowalnia" — to **szyna komunikacyjna** przez którą AI-e rozmawiają w czasie rzeczywistym, tak samo jak chat.

Każdy AI subskrybuje kilka kanałów jednocześnie i może wysyłać wiadomości do dowolnego innego AI w dowolnym momencie:

```
                    SUPABASE REALTIME
                  (kanały pub/sub WSS)
                         │
     ┌───────────────────┼───────────────────┐
     │                   │                   │
     ▼                   ▼                   ▼
  AI kierownik       Agent-A             Agent-B
  (kierownik)       (executor)          (executor)
     │                   │                   │
     │ ◄── raport ───────┤                   │
     │ ◄── pytanie ──────┤                   │
     │ ──── odpowiedź ──►│                   │
     │ ◄────────────────────── raport ───────┤
     │ ──── korekta ────────────────────────►│
     │                   │◄─── sync ──────►│  ← agenty wykonawcze koordynują się wzajemnie
     │ ──── nowe zadanie►│                   │
```

### Przykładowe scenariusze komunikacji AI ↔ AI

**Agent wykonawczy pyta AI kierownika o wyjaśnienie:**
```
Agent-A → kanał "questions"  → AI kierownik
AI kierownik  → kanał "answers"   → Agent-A   (odpowiedź w sekundy)
```

**Agent wykonawczy zgłasza problem AI kierownikowi:**
```
Agent-B → kanał "issues"     → AI kierownik
AI kierownik → analizuje → może:
           - odpowiedzieć Agentowi-B
           - przepiąć zadanie do Agenta-A
           - podzielić zadanie inaczej
           - poprosić użytkownika o decyzję
```

**Agenty wykonawcze synchronizują się między sobą:**
```
Agent-A → kanał "sync"       → Agent-B
"Skończyłem moduł X, możesz zacząć integrację"
Agent-B odbiera → zaczyna kolejny krok bez czekania na AI kierownika
```

**AI kierownik koryguje w trakcie pracy:**
```
AI kierownik monitoruje postęp → widzi że Agent-A jedzie w złą stronę
AI kierownik → kanał "corrections" → Agent-A
"Stop — zmień podejście, użyj metody Y"
Agent-A odbiera natychmiast → koryguje kurs
```

## Przepływ głównego zadania

```
Użytkownik
    │  wstawia zadanie
    ▼
Supabase DB → kanał "tasks" → AI kierownik
    │
    │  AI kierownik analizuje, dekomponuje, przydziela
    │
    ├──► kanał "assignments" → Agent-A  ┐
    └──► kanał "assignments" → Agent-B  ┘ pracują równolegle
              │                    │
              │  komunikują się    │
              └────────────────────┘
              kanał "sync" (AI ↔ AI)
              │
              ▼
    Raporty → kanał "reports" → AI kierownik
              │
              │  agreguje, sprawdza jakość
              ▼
    kanał "done" → Użytkownik widzi wynik
```

Jeżeli agent jest offline: zadanie czeka w bazie danych. Przy reconnect agent pobiera zaległe zadania z bazy — Supabase nie gubi niczego.

## Jak agent się łączy — dla użytkownika

1. Otwierasz aplikację w przeglądarce (link na GitHub Pages).
2. Logujesz się emailem i hasłem (Supabase Auth).
3. Gotowe — przeglądarka automatycznie subskrybuje kanał real-time Supabase.
4. Zadania i statusy aktualizują się na żywo bez odświeżania strony.

Nie ma żadnego terminala, żadnych zmiennych środowiskowych, żadnych plików konfiguracyjnych dla użytkownika końcowego.

## Skalowanie

- Nowy agent = nowe konto w aplikacji, nowa rola przypisana przez managera.
- Każde urządzenie z przeglądarką i internetem może być agentem.
- Supabase obsługuje tysiące połączeń jednocześnie na free tierze.

## Odporność

- Utrata połączenia agenta — zadanie czeka w bazie, agent pobiera je po reconnect.
- Supabase ma SLA 99.9% uptime — sprawdzone w produkcji przez dziesiątki tysięcy projektów.
- Dane w PostgreSQL — trwałe, nie giną przy reconnect ani restarcie.

## Bezpieczeństwo

- Każdy użytkownik ma własne konto — Supabase Auth generuje JWT automatycznie.
- Row Level Security (RLS): agent widzi tylko swoje zadania, manager widzi wszystkie.
- Klucz `anon key` (publiczny) bezpiecznie można trzymać w kodzie — RLS kontroluje dostęp, nie klucz.
- Całość przez TLS — szyfrowane end-to-end.
- Nie ma żadnego własnego serwera który można "zhakować" — Supabase zarządza bezpieczeństwem infrastruktury.

## Limity darmowego planu Supabase

| Zasób | Free tier | Wystarczy dla MVP? |
|-------|-----------|-------------------|
| Baza danych | 500 MB | ✅ (tysiące zadań) |
| Realtime wiadomości | 2 mln/mies. | ✅ |
| Użytkownicy Auth | Nieograniczone | ✅ |
| Bandwidth | 5 GB/mies. | ✅ |
| Projekty | 2 aktywne | ✅ |


Komputery z agentami mogą znajdować się w różnych sieciach (różne NAT, firewalle, mobilny internet). Wymagane jest rozwiązanie działające:
- **bez LAN** (różne sieci, internet publiczny),
- **bez uprawnień administratora** (żadnych zmian w systemie, firewallu, VPN-ie),
- tylko z ruchem **wychodzącym na porcie 443** (działa wszędzie).

### Rozwiązanie: Cloudflare Tunnel + Upstash Redis

```
┌─────────────────────┐        Cloudflare Edge        ┌──────────────────────┐
│  AI Kierownik       │◄──── wss://xxx.cfargotunnel ───►│  Agent wykonawczy    │
│  (dowolna sieć)     │       (internet publiczny)     │  (inna sieć/kraj)    │
│                     │                                │                      │
│  [cloudflared]      │  outbound 443 ──► CF Edge      │  outbound 443 ──► CF │
│  (binary, bez root) │                                │  (zero konfiguracji) │
└─────────────────────┘                                └──────────────────────┘
          │                                                       │
          └──────────── Upstash Redis (TLS, internet) ───────────┘
                        (zastępuje lokalny Redis)
```

#### Cloudflare Tunnel (`cloudflared`)

| Właściwość | Wartość |
|-----------|---------|
| Instalacja | Jeden binarny plik (~30 MB), bez root, bez usługi systemowej |
| Działanie | Uruchamia się jako zwykły proces użytkownika |
| Wymagania sieciowe | Tylko ruch wychodzący na port 443 |
| Wynik | Publiczny adres `wss://xxxx.trycloudflare.com` gotowy w kilka sekund |
| Konto | Nie wymagane (quick tunnel); opcjonalnie konto Cloudflare dla stałego URL |

**Uruchomienie na maszynie z AI Kierownikiem:**
```bash
# pobierz binary (bez sudo)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared

# uruchom tunel wskazując na lokalny gateway (port 3000)
./cloudflared tunnel --url http://localhost:3000
# → wyświetla: https://xxxx.trycloudflare.com  (to jest publiczny WSS URL)
```

**Konfiguracja agentów wykonawczych:**
```
GATEWAY_URL=wss://xxxx.trycloudflare.com
```
Agenci łączą się wychodzącym połączeniem na port 443 — bez żadnych uprawnień.

#### Upstash Redis

Zastępuje lokalny Redis instancją w chmurze dostępną przez TLS z każdej sieci.

| Właściwość | Wartość |
|-----------|---------|
| Darmowy tier | 10 000 poleceń/dzień |
| Połączenie | `rediss://xxx.upstash.io:6379` (TLS, standardowe `ioredis`) |
| Wymagania | Tylko internet, zero konfiguracji lokalnej |
| Alternatywa | Redis Cloud (free 30 MB), Railway Redis |

---

## Po co API/broker?

- Umożliwia komunikację między rozproszonymi komponentami (różne maszyny, sieci).
- Agenty wykonawcze łączą się wychodzącym połączeniem `wss://` — nie wymagają otwartych portów inbound.
- Stanowi podstawę automatyzacji: tworzenie zadań, pobieranie statusów, integracje zewnętrzne.
- Pozwala na późniejsze rozszerzenie (webhooks, event streaming, multi-tenant).

## Protokół połączenia agenta

```
Agent → Gateway: wss://xxxx.trycloudflare.com (TLS/443, przez Cloudflare Tunnel)
  połączenie outbound — agent inicjuje, gateway pasywnie akceptuje
  JWT w nagłówku Upgrade (tenant + agent identity)
```

## Przepływ danych w systemie rozproszonym

```
Użytkownik
    │ HTTP POST /api/v1/tasks
    ▼
AI Kierownik (lokalny gateway)
    │ publish → Upstash Redis channel "task.assigned" (TLS)
    ▼
Cloudflare Tunnel → Cloudflare Edge → Agent wykonawczy
    │ WebSocket message przez publiczny WSS URL
    ▼
Agent wykonawczy ─── przetwarza zadanie
    │ POST /api/v1/tasks/{id}/status → przez CF Tunnel
    ▼
AI Kierownik ─── agreguje + raportuje użytkownikowi
```

Jeżeli agent jest offline: wiadomość trafia do kolejki Upstash Redis; przy reconnect gateway opróżnia kolejkę.

## Lokalne vs chmurowe AI

| Aspekt | Lokalne AI | Chmurowe AI |
|--------|-----------|-------------|
| Lokalizacja | Dowolna stacja robocza z internetem | API w chmurze |
| Zastosowanie | Szybkie zadania, praca na kodzie lokalnym | Zaawansowana analiza, modele wymagające GPU |
| Komunikacja | Przez Cloudflare Tunnel (port 443 outbound) | Przez API call z agenta |
| Latencja | CF edge ~20–50 ms overhead | Zależna od dostawcy |

## Skalowanie poziome

- Do systemu można dodawać kolejne stacje robocze jako agentów wykonawczych.
- Nowy agent ustawia `GATEWAY_URL` na publiczny URL tunelu i łączy się — zero konfiguracji.
- AI kierownik przydziela zadania według profilu i bieżącego obciążenia.

### Procedura dodawania nowej jednostki

1. Na nowej stacji ustaw zmienną środowiskową: `GATEWAY_URL=wss://xxxx.trycloudflare.com`
2. Ustaw `TOKEN` (JWT wystawiony przez managera).
3. Uruchom agenta — łączy się wychodzącym połączeniem port 443.
4. AI kierownik może natychmiast przypisywać mu zadania.

Nie wymaga: otwierania portów, VPN, konfiguracji sieci, uprawnień admina.

## Odporność na awarie

- Awaria tunelu Cloudflare — cloudflared automatycznie reconnectuje (wbudowane retry).
- Awaria agenta wykonawczego — AI kierownik lub team leader przekierowuje zadania do innego agenta.
- Utrata połączenia agenta — wiadomości kolejkowane w Upstash Redis do czasu reconnect.
- Upstash Redis offline — gateway buforuje lokalnie i synchronizuje po przywróceniu połączenia.

## Porównanie opcji tunelowania

| Opcja | Admin? | Konto? | Stały URL? | Uwagi |
|-------|--------|--------|-----------|-------|
| **Cloudflare Tunnel** | Nie | Opcjonalne | Z kontem | Najlepsza niezawodność, duży free tier |
| Ngrok | Nie | Tak (free) | Nie (free) | URL zmienia się przy restarcie |
| Tailscale | Nie* | Tak | Tak (IP) | *userspace mode; wymaga konta |
| Bore / frp | Nie | Własny serwer | Tak | Wymaga własnego VPS |

Rekomendacja: **Cloudflare Tunnel** jako rozwiązanie domyślne.

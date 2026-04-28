# FORK_GUIDE — jak uruchomić własną kopię projektu

Przewodnik dla osoby, która chce forknąć to repozytorium i postawić własny działający Agent Manager. Czas: ~10–15 minut. Wymagania: konto GitHub i konto Supabase (oba darmowe).

Żaden terminal nie jest potrzebny — wszystko przez przeglądarkę.

---

## Co to jest i jak działa

Agent Manager to aplikacja webowa (GitHub Pages) połączona z Supabase jako backendem.

```
GitHub Pages                Supabase
(twoja strona)    ←→       (baza danych + real-time + logowanie)
      ▲                          ▲
      │                          │
użytkownicy               automatycznie zarządzane
i agenci                  przez Supabase — Ty nic nie hostujesz
```

Ty nie masz żadnego własnego serwera. Supabase jest usługą zewnętrzną którą konfigurujesz raz przez panel webowy.

---

## Krok 1 — Forkuj repozytorium

1. Wejdź na stronę tego repozytorium na GitHub.
2. Kliknij przycisk **Fork** (prawy górny róg).
3. Wybierz swoje konto → kliknij **Create fork**.

Masz teraz własną kopię projektu na swoim koncie GitHub.

---

## Krok 2 — Utwórz projekt Supabase

1. Wejdź na [supabase.com](https://supabase.com) → kliknij **Start for free**.
2. Zarejestruj się (może być GitHub login).
3. Kliknij **New project**.
4. Wybierz organizację, nadaj nazwę (np. `agent-manager`), wybierz region (Europe — Frankfurt).
5. Kliknij **Create new project**. Poczekaj ~1 minutę na setup.

---

## Krok 3 — Skopiuj klucze Supabase

W panelu swojego projektu Supabase:

1. Przejdź do **Settings → API**.
2. Skopiuj dwie wartości:
   - **Project URL** — wygląda jak `https://xxxxxxxxxxxx.supabase.co`
   - **anon public key** — długi ciąg znaków zaczynający się od `eyJ...`

Te klucze są **bezpieczne do użycia publicznie** — Supabase kontroluje dostęp przez Row Level Security (RLS), nie przez ukrywanie kluczy.

---

## Krok 4 — Dodaj klucze do GitHub Secrets

W swoim sforkowanym repozytorium na GitHub:

1. Wejdź w **Settings → Secrets and variables → Actions**.
2. Kliknij **New repository secret**.
3. Dodaj:
   - Nazwa: `SUPABASE_URL` / Wartość: twój Project URL
4. Kliknij **New repository secret** ponownie.
   - Nazwa: `SUPABASE_ANON_KEY` / Wartość: twój anon key

GitHub Actions będzie używał tych wartości automatycznie przy każdym deploy.

---

## Krok 5 — Włącz GitHub Pages

W swoim sforkowanym repozytorium:

1. Wejdź w **Settings → Pages**.
2. W sekcji **Source** wybierz **GitHub Actions**.
3. Kliknij **Save**.

---

## Krok 6 — Uruchom pierwszy deploy

1. W repozytorium wejdź w **Actions**.
2. Wybierz workflow **Deploy** z listy po lewej.
3. Kliknij **Run workflow** → **Run workflow** (zielony przycisk).

GitHub Actions automatycznie:
- Zastosuje schemat bazy danych w Supabase (tabele, polityki bezpieczeństwa)
- Zbuduje i opublikuje aplikację na GitHub Pages

Poczekaj ~2 minuty. Gotowe.

---

## Krok 7 — Znajdź link do aplikacji

Po zakończeniu deploy:

1. Wejdź w **Settings → Pages**.
2. Zobaczysz link do swojej aplikacji — wygląda jak `https://twojlogin.github.io/agent-manager`.
3. Otwórz go w przeglądarce.

---

## Krok 8 — Utwórz pierwsze konto managera

1. Na stronie aplikacji kliknij **Zarejestruj się**.
2. Wpisz email i hasło.
3. Pierwsze konto automatycznie otrzymuje rolę **manager**.
4. Możesz teraz zapraszać innych użytkowników i agentów.

---

## Krok 9 — (opcjonalnie) Włącz lokalny AI

Domyślnie manager i executor działają w trybie przeglądarkowym ze stałymi tekstami operacyjnymi. Aby włączyć **prawdziwy lokalny model** (llama.cpp + GGUF) na swoim komputerze:

1. Sklonuj swojego forka lokalnie (`git clone …`).
2. Uruchom skrypt **właściwy dla Twojego systemu**:
   - 🍎 **macOS** — dwuklik na `start.command` (lub `./start.sh` z terminala)
   - 🐧 **Linux** — `./start.sh`
   - 🪟 **Windows** — dwuklik na `start.bat`

   Skrypt sam pobierze binary, zapyta o model GGUF i uruchomi proxy na `127.0.0.1:3001`.
3. Otwórz aplikację — w headerze zobaczysz zielony badge **„AI lokalny"**. Bez uruchomienia proxy aplikacja działa dalej w trybie demo.

Pełna dokumentacja: [local-ai-proxy/README.md](local-ai-proxy/README.md).

---

## Co dzieje się potem automatycznie

Każde `git push` do głównej gałęzi repozytorium:
- Uruchamia GitHub Actions
- Aktualizuje aplikację na GitHub Pages
- Stosuje ewentualne zmiany schematu bazy Supabase

Nie musisz niczego robić ręcznie po zakończeniu setupu.

---

## Jak zapraszać nowych agentów / użytkowników

Nie ma żadnych tokenów do generowania ani konfiguracji po stronie użytkownika.

1. Powiedz im link do aplikacji.
2. Niech się zarejestrują.
3. W panelu managera przydziel im rolę (executor / viewer).
4. Mogą zacząć pracę.

---

## Limity darmowego planu Supabase

| Zasób | Limit | Wystarczy na |
|-------|-------|-------------|
| Baza danych | 500 MB | Tysiące zadań |
| Real-time wiadomości | 2 mln/miesiąc | Dziesiątki aktywnych agentów |
| Użytkownicy | Bez limitu | Wszystkich |
| Projekty | 2 aktywne | MVP + backup |

Dla większego projektu: płatny plan Supabase zaczyna się od $25/miesiąc.

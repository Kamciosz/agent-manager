# infra/

Zasoby infrastrukturalne dla środowisk innych niż lokalny dev.

## Zawartość (planowana)

| Plik | Opis |
|------|------|
| `nginx.conf` | Konfiguracja nginx — TLS termination, reverse proxy → gateway port 3000 |
| `certbot/` | Skrypty odnowienia certyfikatu Let's Encrypt |
| `docker-compose.prod.yml` | Override compose dla środowiska produkcyjnego |

## Lokalny dev

Do lokalnego uruchomienia wystarczy `docker-compose.yml` z katalogu głównego:

```bash
docker compose up -d
```

Produkcyjny nginx powinien terminować TLS na porcie 443 i proxować do `http://localhost:3000`.

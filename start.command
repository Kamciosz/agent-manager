#!/usr/bin/env bash
# ============================================================================
#  start.command  —  wrapper dla macOS (dwuklik w Finderze)
#  ---------------------------------------------------------------------------
#  Finder na macOS NIE uruchamia plików .sh dwuklikiem (otwiera je w edytorze).
#  Pliki .command są otwierane w Terminalu — dlatego ten plik istnieje.
#  Logika startowa jest w start.sh; tu tylko przełączamy katalog i wywołujemy.
# ============================================================================

set -e

# Przejdź do katalogu w którym leży ten skrypt (działa też przy dwukliku)
cd "$(dirname "${BASH_SOURCE[0]}")"

# Uruchom właściwy launcher (przekazujemy wszystkie argumenty)
./start.sh "$@"

# Trzymaj okno otwarte po zakończeniu, żeby użytkownik zobaczył komunikaty
echo
echo "============================================================"
echo "  Skrypt zakończył działanie. Wciśnij Enter aby zamknąć okno."
echo "============================================================"
read -r _

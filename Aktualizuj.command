#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
./start.sh --update "$@"
printf '\nAktualizacja zakonczona albo pominieta bezpiecznie. Mozesz zamknac to okno.\n'
read -r -p "Nacisnij Enter, aby zamknac... " _

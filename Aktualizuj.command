#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
./update.sh "$@"
exit_code=$?
printf '\n'
if [ "$exit_code" -eq 0 ]; then
	printf 'Aktualizacja zakonczona albo pominieta bezpiecznie. Uruchom start.command ponownie, jesli byl otwarty wczesniej.\n'
else
	printf 'Aktualizacja nie powiodla sie (kod %s). Sprawdz komunikaty powyzej.\n' "$exit_code"
fi
read -r -p "Nacisnij Enter, aby zamknac... " _
exit "$exit_code"

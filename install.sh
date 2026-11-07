#!/usr/bin/env bash
# Install or update Krohnkite (Smart) and force KWin to reload it.
# Usage: ./install.sh [path/to/krohnkite-*.kwinscript]
set -euo pipefail

pkg="${1:-$(ls -t "$(dirname "$0")"/krohnkite-*.kwinscript 2>/dev/null | head -1)}"
[ -f "$pkg" ] || { echo "no .kwinscript found" >&2; exit 1; }

if kpackagetool6 -t KWin/Script -s krohnkite >/dev/null 2>&1; then
  kpackagetool6 -t KWin/Script -u "$pkg"
else
  kpackagetool6 -t KWin/Script -i "$pkg"
fi

kwin_call() {
  dbus-send --session --print-reply --dest=org.kde.KWin "$@" >/dev/null 2>&1 || true
}

# a running script is not replaced by kpackagetool, unload + reload it
kwriteconfig6 --file kwinrc --group Plugins --key krohnkiteEnabled false
kwin_call /Scripting org.kde.kwin.Scripting.unloadScript string:krohnkite
kwin_call /KWin org.kde.KWin.reconfigure
sleep 1
kwriteconfig6 --file kwinrc --group Plugins --key krohnkiteEnabled true
kwin_call /KWin org.kde.KWin.reconfigure
sleep 1

if journalctl --user -b --since "-30s" 2>/dev/null | grep -q "Krohnkite Smart"; then
  journalctl --user -b --since "-30s" | grep "Krohnkite Smart" | tail -1
else
  echo "Installed. Check: journalctl --user -b | grep 'Krohnkite Smart'"
fi

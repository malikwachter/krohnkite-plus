#!/usr/bin/env bash
# Install or update Krohnkite (Smart).
# Usage: ./install.sh [path/to/krohnkite-*.kwinscript]
set -euo pipefail

pkg="${1:-$(ls -t "$(dirname "$0")"/krohnkite-*.kwinscript 2>/dev/null | head -1)}"
[ -f "$pkg" ] || { echo "no .kwinscript found" >&2; exit 1; }

user_dir="$HOME/.local/share/kwin/scripts/krohnkite"

# another Krohnkite (distro package) can shadow the user installation
for d in /usr/share/kwin/scripts/krohnkite /usr/local/share/kwin/scripts/krohnkite; do
  if [ -d "$d" ]; then
    echo "NOTE: a system-wide Krohnkite exists in $d"
    command -v pacman >/dev/null && pacman -Qo "$d" 2>/dev/null || true
    echo "      If the Smart tab does not show up, remove that package."
  fi
done

if [ -d "$user_dir" ]; then
  kpackagetool6 -t KWin/Script -u "$pkg"
else
  kpackagetool6 -t KWin/Script -i "$pkg"
fi

# drop cached compiled QML/JS of the old version
find "$HOME/.cache" -path "*qmlcache*" -type f -print0 2>/dev/null |
  xargs -0 -r grep -l -s -a "krohnkite" 2>/dev/null | xargs -r rm -f || true

kwriteconfig6 --file kwinrc --group Plugins --key krohnkiteEnabled true

if grep -q "KROHNKITE_SMART_VERSION" "$user_dir/contents/code/script.js"; then
  ver="$(grep -o 'KROHNKITE_SMART_VERSION = "[^"]*"' "$user_dir/contents/code/script.js" | head -1)"
  echo "Installed: $ver"
else
  echo "ERROR: installed files are not the Smart version" >&2
  exit 1
fi

cat <<'MSG'

KWin keeps running the old script until it is restarted.
Please LOG OUT and back in now (most reliable).

Afterwards check:
  journalctl --user -b -o cat | grep "Krohnkite Smart"
and the "Smart" tab in System Settings > Window Management > KWin Scripts > Krohnkite.
MSG

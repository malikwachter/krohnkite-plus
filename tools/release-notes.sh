#!/usr/bin/env bash
# Print the release notes for a Kröhnkite-Plus release.
# Usage: tools/release-notes.sh <version> [<previous release tag>] [<upstream ref>...]
#   Without a previous tag, everything the fork adds on top of upstream is listed.
#   Upstream refs (default: upstream/master origin/master) mark commits that come
#   from Kröhnkite itself; they are left out and summed up as one "based on" line.
set -euo pipefail

version="$1"
prev="${2:-}"
shift $(($# < 2 ? $# : 2))
upstream=("$@")
[ ${#upstream[@]} -gt 0 ] || upstream=(upstream/master origin/master)

range="HEAD"
[ -n "$prev" ] && range="$prev..HEAD"

exclude=()
for ref in "${upstream[@]}"; do
  if git rev-parse -q --verify "$ref^{commit}" >/dev/null; then exclude+=("^$ref"); fi
done

base="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)"
prev_base=""
[ -n "$prev" ] && prev_base="$(git show "$prev:package.json" 2>/dev/null |
  sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -1)"

echo "Kröhnkite-Plus $version, based on [Kröhnkite](https://codeberg.org/anametologin/Krohnkite) $base."
echo
echo "> [!CAUTION]"
echo "> Written entirely with AI for my own workflow. No support, no warranty, features can change at any time."
echo "> Please use the [original Kröhnkite](https://codeberg.org/anametologin/Krohnkite) instead."
echo
echo "## Changes"
echo
if [ -n "$prev_base" ] && [ "$prev_base" != "$base" ]; then
  echo "- Updated to upstream Kröhnkite $base (was $prev_base)"
fi
changes="$(git log "$range" "${exclude[@]}" --no-merges --reverse --format='- %s')"
if [ -n "$changes" ]; then
  echo "$changes"
elif [ -z "$prev_base" ] || [ "$prev_base" = "$base" ]; then
  echo "- No changes of its own"
fi
echo
echo "## Install"
echo
echo "Download \`krohnkite-$version.kwinscript\`, \`krohnkite-smooth-$version.zip\` and \`install.sh\` into one folder, then run:"
echo
echo '```bash'
echo 'bash install.sh'
echo '```'
echo
echo "This installs or updates the script and the animation effect and enables both."

#!/usr/bin/env bash
#
# Regenerate the translation template from res/config.ui, merge it into the
# existing translations, and compile the .mo files used by the KWin package.
#
# New or changed source strings are intentionally left untranslated (no fuzzy
# matching) so they can be reviewed by a human instead of silently inheriting
# a wrong translation.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$ROOT/translations/translations.po"
LOCALE_DIR="$ROOT/translations/locale"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

for tool in lupdate ts2po msgmerge msgattrib msgfmt; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "error: $tool is not installed" >&2
        exit 1
    fi
done

cp "$ROOT/res/config.ui" "$TMP_DIR/config.ui"
printf 'SOURCES = config.ui\n' > "$TMP_DIR/temp.pro"

(
    cd "$TMP_DIR"
    lupdate -no-obsolete temp.pro -ts translations.ts >/dev/null
    ts2po -i translations.ts -o translations.po
)

cp "$TMP_DIR/translations.po" "$TEMPLATE"

for pair in ru:russian zh:chinese; do
    lang="${pair%%:*}"
    name="${pair##*:}"
    pofile="$ROOT/translations/$name.po"

    msgmerge --no-fuzzy-matching --no-wrap --backup=none --update \
        "$pofile" "$TEMPLATE"
    msgattrib --no-obsolete --no-wrap "$pofile" -o "$TMP_DIR/$name.po"
    mv "$TMP_DIR/$name.po" "$pofile"

    mkdir -p "$LOCALE_DIR/$lang/LC_MESSAGES"
    msgfmt --check --statistics \
        -o "$LOCALE_DIR/$lang/LC_MESSAGES/krohnkite.mo" "$pofile"
done

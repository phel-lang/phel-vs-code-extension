#!/usr/bin/env bash
# Regenerate the body of src/phelCoreSymbols.ts from a phel-lang checkout.
#
# Usage:
#   scripts/regen-core-symbols.sh /path/to/phel-lang
#
# Prints the three arrays (SPECIAL_FORMS, MACROS, CORE_FNS) to stdout so the
# author can review and paste them into src/phelCoreSymbols.ts. The script does
# not edit the file in place — manual review keeps surprises out of the public
# completion surface.

set -euo pipefail

PHEL_LANG_ROOT=${1:-}
if [[ -z "$PHEL_LANG_ROOT" ]]; then
    echo "usage: $0 /path/to/phel-lang" >&2
    exit 1
fi

SYMBOL_PHP="$PHEL_LANG_ROOT/src/php/Lang/Symbol.php"
PHEL_SRC="$PHEL_LANG_ROOT/src/phel"

if [[ ! -f "$SYMBOL_PHP" ]]; then
    echo "Symbol.php not found at $SYMBOL_PHP" >&2
    exit 1
fi

if [[ ! -d "$PHEL_SRC" ]]; then
    echo "Phel source dir not found at $PHEL_SRC" >&2
    exit 1
fi

format_array() {
    local label="$1"
    printf "// %s\n[\n" "$label"
    while IFS= read -r value; do
        printf "    '%s',\n" "$value"
    done
    printf "]\n\n"
}

extract_special_forms() {
    grep -E "NAME_[A-Z_]+ = '" "$SYMBOL_PHP" |
        sed -E "s/.*= '([^']+)'.*/\1/" |
        sort -u
}

extract_macros() {
    find "$PHEL_SRC" -name '*.phel' -exec grep -hE '^\(defmacro ' {} + |
        awk '{print $2}' |
        sort -u
}

extract_core_fns() {
    find "$PHEL_SRC" -name '*.phel' -exec grep -hE '^\(defn ' {} + |
        awk '{print $2}' |
        sort -u
}

extract_special_forms | format_array "SPECIAL_FORMS"
extract_macros | format_array "MACROS"
extract_core_fns | format_array "CORE_FNS"

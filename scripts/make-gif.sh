#!/usr/bin/env bash
# Assemble a directory of captured PNG frames into an optimised GIF.
#
#   scripts/make-gif.sh [--fps <n>] [--width <px>] [--loop <n>] <frames dir> <out.gif>
#
# The frames come from a screen recorder or from ffmpeg itself (see
# docs/media/README.md); this only does the part that is easy to get wrong.
# ffmpeg's default GIF encoder quantises each frame against the web-safe
# palette, which turns an editor screenshot into banded mud at several megabytes.
# Two passes fix both: `palettegen` reads every frame and derives one 256-colour
# palette for the whole clip, `paletteuse` then maps the frames onto it with
# Sierra-2-4a dithering. A 1280px, 8 fps, 10 second capture lands around 900 KB
# instead of 6 MB, and the text stays legible.
#
# Defaults are chosen for a UI recording, not for video: 8 fps is enough for a
# cursor and a popup, and `-loop 0` means loop forever, which is what a
# Marketplace reader expects.
set -euo pipefail

fps=8
width=1280
loop=0
frames=''
out=''

while [ $# -gt 0 ]; do
    case "$1" in
        --fps)
            fps="$2"
            shift 2
            ;;
        --width)
            width="$2"
            shift 2
            ;;
        --loop)
            loop="$2"
            shift 2
            ;;
        -h|--help)
            sed -n '2,17p' "$0"
            exit 0
            ;;
        *)
            if [ -z "$frames" ]; then
                frames="$1"
            else
                out="$1"
            fi
            shift
            ;;
    esac
done

if [ -z "$frames" ] || [ -z "$out" ]; then
    echo "usage: scripts/make-gif.sh [--fps n] [--width px] [--loop n] <frames dir> <out.gif>" >&2
    exit 1
fi
if [ ! -d "$frames" ]; then
    echo "no such frames directory: $frames" >&2
    exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "ffmpeg is not on PATH (brew install ffmpeg / apt install ffmpeg)" >&2
    exit 1
fi

# `-pattern_type glob` needs the frames named so they sort lexicographically;
# every recorder writes `frame-0001.png` or similar, and a `*.png` glob that
# matched nothing would otherwise reach ffmpeg as a literal.
frames="$(cd "$frames" && pwd)"
count="$(find "$frames" -maxdepth 1 -name '*.png' | wc -l | tr -d ' ')"
if [ "$count" -eq 0 ]; then
    echo "no *.png frames in $frames" >&2
    exit 1
fi

palette="$(mktemp "${TMPDIR:-/tmp}/phel-gif-palette.XXXXXX.png")"
trap 'rm -f "$palette"' EXIT

# `scale=...:flags=lanczos` before the palette work, so both passes see the same
# pixels; `-1` keeps the aspect ratio, and `:-1` rounding to an even height is
# irrelevant for GIF (unlike h264), so no `-2` here.
filters="fps=${fps},scale=${width}:-1:flags=lanczos"

ffmpeg -hide_banner -loglevel error -y \
    -pattern_type glob -i "$frames/*.png" \
    -vf "${filters},palettegen=stats_mode=diff" \
    "$palette"

# `stats_mode=diff` above weights the palette towards what changes between
# frames — the popup and the cursor — rather than the static chrome that fills
# most of the pixels. `dither=sierra2_4a` is the least noisy of the error
# diffusions on flat UI colours.
ffmpeg -hide_banner -loglevel error -y \
    -pattern_type glob -i "$frames/*.png" \
    -i "$palette" \
    -lavfi "${filters}[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle" \
    -loop "$loop" \
    "$out"

# macOS `du -h` pads the size to a fixed width; the padding is not part of it.
size="$(du -h "$out" | cut -f1 | tr -d ' ')"
echo "$out ($size, $count frames at ${fps} fps, ${width}px wide)"

#!/usr/bin/env bash
# Weather line for hyprlock. On any network failure, fall back to the last
# successful result so the label keeps displaying something usable offline.

cache="${XDG_CACHE_HOME:-$HOME/.cache}/hyprlock-weather"

emit_cache_or_nothing() {
    [ -s "$cache" ] && cat "$cache"
    exit 0
}

location_info=$(curl --max-time 5 --connect-timeout 3 -fsS ipinfo.io 2>/dev/null) || emit_cache_or_nothing
city=$(echo "$location_info" | jq -r '.city // empty')
region=$(echo "$location_info" | jq -r '.region // empty')
[ -z "$city" ] && emit_cache_or_nothing

result=$(curl --max-time 5 --connect-timeout 3 -fsS \
    "https://wttr.in/${city// /+},${region// /+}?u&format=%c+%t+%C+%E2%80%A2+%h+%E2%80%A2+%w" 2>/dev/null) \
    || emit_cache_or_nothing

mkdir -p "$(dirname "$cache")"
printf '%s' "$result" | tee "$cache"

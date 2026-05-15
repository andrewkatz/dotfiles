#!/usr/bin/env bash

# Ensure standard file descriptors are valid — sketchybar may close them,
# which causes Python (gcalcli) to crash during stream initialization.
[[ -t 0 ]] || exec 0</dev/null
[[ -t 1 ]] || exec 1>/dev/null
[[ -t 2 ]] || exec 2>/dev/null

data="$(~/.config/scripts/calendar.sh)"

title=$(printf '%s' "$data" | jq -r '.title')

sketchybar --set "$NAME" label="$title" click_script="~/.config/scripts/open_calendar_event.sh"

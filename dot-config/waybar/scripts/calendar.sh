#!/usr/bin/env bash

data="$(~/.config/scripts/calendar.sh)"
title=$(echo "$data" | jq -r '.title')
tooltip=$(echo "$data" | jq -r '.tooltip')

# strip < and > from the title
title=$(echo "$title" | sed 's/[<>]//g')

# change & to &amp;
title=$(echo "$title" | sed 's/&/\&amp;/g')

# Use jq to properly encode the JSON output (handles newlines correctly) - compact output
jq -nc --arg text "$title" --arg tooltip "$tooltip" '{"text":$text,"tooltip":$tooltip}'

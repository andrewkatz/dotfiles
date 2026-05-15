#!/usr/bin/env bash

# Get location info from ipinfo.io
location_info="$(curl -s ipinfo.io)"
city="$(echo "$location_info" | jq -r '.city')"
region="$(echo "$location_info" | jq -r '.region')"

# Use city,region format which is more reliable than coordinates
location="$city,$region"
weather=$(curl -s "https://wttr.in/$location?u&format=%c%t")
tooltip=$(curl -s "https://wttr.in/$location?1TdFu")

echo "$weather" | jq -R -s --arg tooltip "$tooltip" --arg weather "$weather" \
    '{
        "text": $weather,
        "tooltip": $tooltip
    }' | jq -c .

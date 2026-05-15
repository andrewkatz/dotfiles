#!/usr/bin/env bash

# Get the count of running and stopped containers
running=$(docker ps -q | wc -l)
stopped=$(docker ps -aq | wc -l)

# Create the JSON output for Waybar
json_output=$(jq -n \
    --arg count "$running" \
    --arg running "$running" \
    --arg stopped "$stopped" \
    '{
        "text": "\($count)",
        "tooltip": "Running: \($running)\nStopped: \($stopped)",
        "alt": if ($running | tonumber) > 0 then "running" else "stopped" end
    }')

# Output the JSON to stdout
echo "$json_output" | jq -c .

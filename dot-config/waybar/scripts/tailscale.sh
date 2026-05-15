#!/usr/bin/env bash

network="$(tailscale status --json | jq -r '.CurrentTailnet.Name')"

echo "$network" | jq -R -s --arg network "$network" \
    '{
        "text": $network,
        "tooltip": "Tailscale VPN\nConnected as: \($network)"
    }' | jq -c .

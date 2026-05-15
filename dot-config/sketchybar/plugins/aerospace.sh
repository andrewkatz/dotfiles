#!/usr/bin/env bash

FOCUSED_WORKSPACE=${FOCUSED_WORKSPACE:-$(aerospace list-workspaces --focused)}

windows=$(aerospace list-windows --all --format "%{workspace},%{window-id}")
mapfile -t sids < <(sketchybar --query aerospace | jq -r '.bracket[]')

commands=()
for sid in "${sids[@]}"; do
  sid=${sid#space.}
  window_count=$(echo "$windows" | grep -c "^$sid,")

  if [ "$window_count" -eq 0 ] && [ "$FOCUSED_WORKSPACE" != "$sid" ]; then
    commands+=(--set "space.$sid" drawing=off)
  else
    # linear, quadratic, tanh, sin, exp, circ
    if [ "$FOCUSED_WORKSPACE" = "$sid" ]; then
      commands+=(--set "space.$sid" drawing=on background.color=0xFF89B4FA label.color=0xFF1E1E2E)
    else
      commands+=(--set "space.$sid" drawing=on background.color=0x00000000 label.color=0x99cdd6f4)
    fi
  fi
done

[ "${#commands[@]}" -gt 0 ] && sketchybar "${commands[@]}"

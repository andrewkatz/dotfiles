#!/usr/bin/env bash

# Triggered by flashspace_workspace_change event.
# Env from sketchybar/flashspace:
#   $WORKSPACE - name of the currently-active workspace
#   $DISPLAY   - display index containing the active workspace

mapfile -t sids < <(sketchybar --query flashspace | jq -r '.bracket[]')

commands=()
for sid in "${sids[@]}"; do
  # sid looks like "space.Browser" or "space.Workspace_4"
  workspace_slug=${sid#space.}
  workspace=$(echo "$workspace_slug" | tr '_' ' ')

  if [ "$WORKSPACE" = "$workspace" ]; then
    commands+=(--set "$sid" background.color=0xFF89B4FA label.color=0xFF1E1E2E)
  else
    commands+=(--set "$sid" background.color=0x00000000 label.color=0x99cdd6f4)
  fi
done

[ "${#commands[@]}" -gt 0 ] && sketchybar "${commands[@]}"

#!/bin/sh

if [ "$SENDER" = "volume_change" ]; then
  VOLUME="$INFO"
  sketchybar --set "$NAME" label="$VOLUME%"
fi

if [ "$SENDER" = "microphone_status_change" ]; then
  muted="$MUTED"
else
  muted="$(cat ~/.local/state/hush/muted)"
fi

if [ "$muted" = "true" ]; then
  sketchybar --set "$NAME" icon="󰖁"
else
  sketchybar --set "$NAME" icon="󰕾"
fi

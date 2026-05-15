#!/usr/bin/env bash

PID=$(pgrep -f "/usr/bin/caffeinate")
if [ -n "$PID" ]; then
  for pid in $(pgrep -f "/usr/bin/caffeinate"); do
    kill "$pid"
  done
else
  /usr/bin/caffeinate -dmi &
fi

sketchybar --trigger coffee_changed

#!/usr/bin/env bash

if (pgrep -qf "/usr/bin/caffeinate"); then
  sketchybar --set $NAME icon=󰅶
else
  sketchybar --set $NAME icon=󰛊
fi

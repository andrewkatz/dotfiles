#!/bin/sh

PERCENTAGE="$(pmset -g batt | grep -Eo "\d+%" | cut -d% -f1)"
CHARGING="$(pmset -g batt | grep 'AC Power')"

if [ "$PERCENTAGE" = "" ]; then
  exit 0
fi

case "${PERCENTAGE}" in
  9[0-9]|100)
    ICON=""
    COLOR=0xFF25be6a
  ;;
  [6-8][0-9])
    ICON=""
    COLOR=0xFF08bdba
  ;;
  [3-5][0-9])
    ICON=""
    COLOR=0xFFff7eb6
  ;;
  [1-2][0-9])
    ICON=""
    COLOR=0xFFee5396
  ;;
  *)
    ICON=""
    COLOR=0xFF6f6f6f
esac

if [[ "$CHARGING" != "" ]]; then
  ICON=""
  COLOR=0xFF08bdba
fi

# The item invoking this script (name $NAME) will get its icon and label
# updated with the current battery status
sketchybar --set "$NAME" icon="$ICON" icon.color="$COLOR" label="$PERCENTAGE%"

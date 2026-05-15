#!/usr/bin/env bash

# Ensure standard file descriptors are valid — sketchybar may close them,
# which causes Python (gcalcli) to crash during stream initialization.
[[ -t 0 ]] || exec 0</dev/null
[[ -t 1 ]] || exec 1>/dev/null
[[ -t 2 ]] || exec 2>/dev/null

FONT_FAMILY="CaskaydiaCove Nerd Font"

# Get data from shared script
eval "$(bash "$HOME/.config/scripts/project_time.sh")"

if [[ $TOTAL_MINUTES -eq 0 ]]; then
  sketchybar --set "$NAME" label="0h0m"
  exit 0
fi

# Update main bar item
sketchybar --set "$NAME" label="$TOTAL_FORMATTED"

# Remove existing popup project items
existing_items=$(sketchybar --query bar | jq -r '.items[]' | grep "project_time.popup" || true)
for item in $existing_items; do
  sketchybar --remove "$item" 2>/dev/null || true
done

# Find the longest project name for alignment
max_project_length=0
for ((i=0; i<PROJECT_COUNT; i++)); do
  project_name_var="PROJECT_${i}_NAME"
  project_name="${!project_name_var}"
  if [[ ${#project_name} -gt $max_project_length ]]; then
    max_project_length=${#project_name}
  fi
done

# Add popup items for each project with aligned times
for ((i=0; i<PROJECT_COUNT; i++)); do
  project_name_var="PROJECT_${i}_NAME"
  project_formatted_var="PROJECT_${i}_FORMATTED"
  
  project_name="${!project_name_var}"
  project_formatted="${!project_formatted_var}"
  
  # Calculate padding to align times on the right
  padding_needed=$((max_project_length - ${#project_name}))
  padding=$(printf "%*s" "$padding_needed" "")
  
  aligned_label="${project_name}${padding}  ${project_formatted}"
  
  item_name="project_time.popup.project.$i"
  
  sketchybar --add item "$item_name" popup.project_time.today \
             --set "$item_name" label="$aligned_label" \
                                icon="󰓹" \
                                icon.color=0xffffffff \
                                label.color=0xffffffff \
                                label.font="$FONT_FAMILY:Mono:13.0" \
                                background.drawing=on \
                                background.color=0xdd24273a \
                                background.corner_radius=6 \
                                background.height=28 \
                                background.border_width=1 \
                                background.border_color=0x44ffffff \
                                label.padding_left=12 \
                                label.padding_right=12 \
                                icon.padding_left=8 \
                                icon.padding_right=4
done

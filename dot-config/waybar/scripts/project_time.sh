#!/usr/bin/env bash

# Get data from shared script
eval "$(bash "$HOME/.config/scripts/project_time.sh")"

# If no time logged, show 0
if [[ $TOTAL_MINUTES -eq 0 ]]; then
  echo '{"text": "0h0m", "tooltip": "No project time logged this week", "class": "project-time"}'
  exit 0
fi

tooltip=""

# Find the longest project name for alignment
max_project_length=0
for ((i=0; i<PROJECT_COUNT; i++)); do
  project_name_var="PROJECT_${i}_NAME"
  project_name="${!project_name_var}"
  if [[ ${#project_name} -gt $max_project_length ]]; then
    max_project_length=${#project_name}
  fi
done

# Add each project with aligned times
for ((i=0; i<PROJECT_COUNT; i++)); do
  project_name_var="PROJECT_${i}_NAME"
  project_formatted_var="PROJECT_${i}_FORMATTED"
  
  project_name="${!project_name_var}"
  project_formatted="${!project_formatted_var}"
  
  # Calculate padding to align times on the right
  padding_needed=$((max_project_length - ${#project_name}))
  padding=$(printf "%*s" "$padding_needed" "")
  
  tooltip+="󰓹 ${project_name}${padding}  ${project_formatted}\\n"
done

# Remove trailing newline escape sequence
tooltip=$(echo "$tooltip" | sed 's/\\n$//')

# Output JSON format for waybar
echo "{\"text\": \"$TOTAL_FORMATTED\", \"tooltip\": \"$tooltip\", \"class\": \"project-time\"}"

#!/usr/bin/env bash

source "$HOME/.config/scripts/utils.sh"

# Get current time in ISO format
current_time=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
current_time_epoch=$(date_from_string "$current_time")

# Get agenda from gcalcli
agenda=$(gcalcli --nocolor agenda "$current_time" --tsv --nodeclined --calendar "Blocks")

# Process agenda to get the next event
IFS=$'\n' read -d '' -ra lines <<< "$agenda"

# Skip the header line and find the first event
event_found=false
for ((i=1; i<${#lines[@]}; i++)); do
  line="${lines[i]}"
  
  # Split the line by tabs
  IFS=$'\t' read -ra event_data <<< "$line"

  start_date="${event_data[0]}"
  start_time="${event_data[1]}"
  end_time="${event_data[3]}"
  title="${event_data[4]}"

  start_time_epoch=$(date_from_string "$start_date $start_time")
  if [[ $start_time_epoch -lt $current_time_epoch ]]; then
    event_found=true
    break
  fi
done

if [[ "$event_found" == true ]]; then
  # Get amount of time left in the event
  end_time_epoch=$(date_from_string "$start_date $end_time")
  time_left_seconds=$((end_time_epoch - current_time_epoch))
  time_left_minutes=$((time_left_seconds / 60))
  title=$(truncate "$title" 25)

  echo '{"title": "'$title' ('$time_left_minutes'm)"}'
else
  echo '{"title": "Free time"}'
fi

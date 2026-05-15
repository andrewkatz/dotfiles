#!/usr/bin/env bash

# Ensure standard file descriptors are valid — sketchybar may close them,
# which causes Python (gcalcli) to crash during stream initialization.
[[ -t 0 ]] || exec 0</dev/null
[[ -t 1 ]] || exec 1>/dev/null
[[ -t 2 ]] || exec 2>/dev/null

# Get current time in ISO format
current_time=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

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

  start_time_epoch=$(date -j -f "%Y-%m-%d %H:%M" "$start_date $start_time" +%s 2>/dev/null)
  current_time_epoch=$(date -u +%s)
  if [[ $start_time_epoch -lt $current_time_epoch ]]; then
    event_found=true
    break
  fi
done

if [[ "$event_found" == true ]]; then
  # Get amount of time left in the event
  current_time_epoch=$(date -u +%s)
  end_time_epoch=$(date -j -f "%Y-%m-%d %H:%M" "$start_date $end_time" +%s 2>/dev/null)
  time_left_seconds=$((end_time_epoch - current_time_epoch))
  time_left_minutes=$((time_left_seconds / 60))

  # truncate title to 15 characters
  if [[ "${#title}" -gt 25 ]]; then
    title="${title:0:25}..."
  fi

  # Update sketchybar
  sketchybar --set "$NAME" label="$title (${time_left_minutes}m)"
else
  # No event found
  sketchybar --set "$NAME" label="Free time"
fi


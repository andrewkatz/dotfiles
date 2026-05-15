#!/usr/bin/env bash

source "$HOME/.config/scripts/utils.sh"

beginning_of_week=$(get_beginning_of_week "$(date +"%Y-%m-%d")")
current_time=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
current_time_epoch=$(date +"%s")

# Get agenda from gcalcli
agenda=$(gcalcli --nocolor agenda "$beginning_of_week" "$current_time" --tsv --nodeclined --calendar "Blocks")

# Function to calculate time difference in minutes
# Uses the earlier of current time or event end time to avoid counting future time
time_diff_minutes() {
  local start_date="$1"
  local start_time="$2"
  local end_date="$3"
  local end_time="$4"
  local current_time_epoch="$5"
  
  # Convert to epoch seconds
  local start_datetime="${start_date}T${start_time}:00"
  local end_datetime="${end_date}T${end_time}:00"
  
  if [[ "$OSTYPE" == "darwin"* ]]; then
    local start_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$start_datetime" "+%s")
    local end_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$end_datetime" "+%s")
  else
    local start_epoch=$(date -d "$start_datetime" "+%s")
    local end_epoch=$(date -d "$end_datetime" "+%s")
  fi
  
  # Use the earlier of current time or event end time
  if [[ $end_epoch -gt $current_time_epoch ]]; then
    end_epoch=$current_time_epoch
  fi
  
  # Only count time if the event has started
  if [[ $start_epoch -gt $current_time_epoch ]]; then
    echo 0
  else
    # Calculate difference in minutes
    echo $(( (end_epoch - start_epoch) / 60 ))
  fi
}

# Function to format minutes as "XhYm"
format_time() {
  local total_minutes="$1"
  local hours=$((total_minutes / 60))
  local minutes=$((total_minutes % 60))
  
  if [[ $hours -gt 0 && $minutes -gt 0 ]]; then
    echo "${hours}h${minutes}m"
  elif [[ $hours -gt 0 ]]; then
    echo "${hours}h"
  else
    echo "${minutes}m"
  fi
}

# Parse agenda and calculate project times
declare -A project_times

# Skip the header line and process each event using process substitution to preserve variables
while IFS=$'\t' read -r start_date start_time end_date end_time title; do
  if [[ -n "$title" && -n "$start_date" && -n "$start_time" && -n "$end_date" && -n "$end_time" ]]; then
    duration=$(time_diff_minutes "$start_date" "$start_time" "$end_date" "$end_time" "$current_time_epoch")
    if [[ -n "${project_times[$title]}" ]]; then
      project_times["$title"]=$((project_times["$title"] + duration))
    else
      project_times["$title"]=$duration
    fi
  fi
done < <(echo "$agenda" | tail -n +2)

# Calculate total time
total_minutes=0
for project in "${!project_times[@]}"; do
  total_minutes=$((total_minutes + project_times["$project"]))
done

# Create output string, sorted by time (most to least)
# Use process substitution to sort projects by time in descending order
sorted_projects=()
while IFS=':' read -r minutes project; do
  sorted_projects+=("$project:$minutes")
done < <(for project in "${!project_times[@]}"; do
  echo "${project_times[$project]}:$project"
done | sort -nr)

# Output structured format for consumption by bar plugins
echo "TOTAL_MINUTES=$total_minutes"
echo "TOTAL_FORMATTED=$(format_time "$total_minutes")"
echo "PROJECT_COUNT=${#sorted_projects[@]}"

for i in "${!sorted_projects[@]}"; do
  IFS=':' read -r project minutes <<< "${sorted_projects[$i]}"
  formatted_time=$(format_time "$minutes")
  echo "PROJECT_${i}_NAME=$project"
  echo "PROJECT_${i}_MINUTES=$minutes"
  echo "PROJECT_${i}_FORMATTED=$formatted_time"
done

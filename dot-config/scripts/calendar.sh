#!/usr/bin/env bash

source "$HOME/.config/scripts/utils.sh"

# Get current time in ISO format
current_time=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Get today's date for filtering
today=$(date +"%Y-%m-%d")
# Get end of today
end_of_today=$(get_end_of_day "$today")

# Get agenda from gcalcli (only for today)
agenda=$(gcalcli --nocolor agenda "$current_time" "$end_of_today" --tsv --details conference --details location --details description --nodeclined --calendar "Caity & Andrew Shared" --calendar "andrewkatz00@gmail.com" --calendar "andrew@comfort.ly" --calendar "andrew@giantpartners.com")

# Process agenda to get the next 3 events
IFS=$'\n' read -d '' -ra lines <<< "$agenda"

# Arrays to store event information
declare -a event_titles
declare -a event_times
declare -a event_dates
declare -a event_urls

# Skip the header line and find the first 4 events (1 for title + 3 for tooltip)
events_found=0
next_event_url=""

for ((i=1; i<${#lines[@]} && events_found<4; i++)); do
  line="${lines[i]}"

  # Split the line by tabs
  IFS=$'\t' read -ra event_data <<< "$line"

  # Check if there's a start time and the event is today
  if [[ "${event_data[1]}" =~ ^[0-9]{2}:[0-9]{2}$ ]] && [[ "${event_data[0]}" == "$today" ]]; then
    start_date="${event_data[0]}"
    start_time="${event_data[1]}"

    if [[ "${event_data[4]}" == "video" ]]; then
      title="${event_data[6]}"
    else
      title="${event_data[4]}"
    fi

    if [[ "${event_data[5]}" =~ ^https?:// ]]; then
      conference_url="${event_data[5]}"
    else
      if [[ "${event_data[6]}" =~ https?://.*\.zoom\.us ]]; then # description contains zoom link
        conference_url=$(echo "${event_data[6]}" | sed -En 's/.*(https:\/\/([a-z0-9]*\.)?zoom\.us\/[\/a-zA-Z0-9]+).*/\1/p')
      else
        conference_url=""
      fi
    fi

    # If the start time is more than 15 minutes in the past, skip it
    fifteen_minutes_ago=$(date_from_string "15 minutes ago")
    start_time_epoch=$(date_from_string "$start_date $start_time")
    if [[ $fifteen_minutes_ago -lt $start_time_epoch ]] && [[ "$title" != "busy" ]]; then
      # Store the first event's URL for the main output
      if [[ $events_found -eq 0 ]]; then
        next_event_url="$conference_url"
      fi

      # Store event information
      event_titles[$events_found]="$title"
      event_times[$events_found]="$start_time"
      event_dates[$events_found]="$start_date"
      event_urls[$events_found]="$conference_url"

      events_found=$((events_found + 1))
    fi
  fi
done

if [[ $events_found -gt 0 ]]; then
  # Format the first event for the main title
  formatted_time=$(date_from_string "${event_dates[0]} ${event_times[0]}" "+%I:%M %p")
  main_title=$(truncate "${event_titles[0]}" 25)

  # Build tooltip with the next 3 events after the first one
  tooltip=""
  if [[ $events_found -gt 1 ]]; then
    for ((i=1; i<events_found; i++)); do
      event_formatted_time=$(date_from_string "${event_dates[i]} ${event_times[i]}" "+%I:%M %p")
      if [[ $i -gt 1 ]]; then
        tooltip+="\\n"
      fi
      tooltip+="$event_formatted_time - ${event_titles[i]}"
    done
  else
    tooltip="No more events today"
  fi

  echo '{"title":"'$formatted_time' - '$main_title'", "conference_url":"'$next_event_url'", "tooltip":"'$tooltip'"}'
else
  echo '{"title":"No upcoming events", "conference_url":"", "tooltip":"No upcoming events"}'
fi

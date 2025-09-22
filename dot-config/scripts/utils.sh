date_from_string() {
  date_string="$1"
  format="${2:-+%s}"

  # Try GNU date first (Linux)
  if date -d "$date_string" "$format" 2> /dev/null; then
    return 0
  fi

  # For macOS, handle different date string types
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # Try relative time strings (like "15 minutes ago", "1 hour ago", etc.)
    if echo "$date_string" | grep -E "(ago|from now)" > /dev/null; then
      # Use a different approach for relative times on macOS
      if echo "$date_string" | grep "ago" > /dev/null; then
        # Parse "X minutes ago", "X hours ago", etc.
        if echo "$date_string" | grep -E "[0-9]+ minutes? ago" > /dev/null; then
          minutes=$(echo "$date_string" | sed -E 's/([0-9]+) minutes? ago/\1/')
          date -v-${minutes}M "$format" 2> /dev/null
        elif echo "$date_string" | grep -E "[0-9]+ hours? ago" > /dev/null; then
          hours=$(echo "$date_string" | sed -E 's/([0-9]+) hours? ago/\1/')
          date -v-${hours}H "$format" 2> /dev/null
        elif echo "$date_string" | grep -E "[0-9]+ days? ago" > /dev/null; then
          days=$(echo "$date_string" | sed -E 's/([0-9]+) days? ago/\1/')
          date -v-${days}d "$format" 2> /dev/null
        else
          return 1
        fi
      else
        return 1
      fi
    else
      # Try parsing as a specific format for non-relative dates
      date -j -f "%Y-%m-%d %H:%M" "$date_string" "$format" 2> /dev/null ||
      date -j -f "%Y-%m-%d" "$date_string" "$format" 2> /dev/null
    fi
  else
    return 1
  fi
}

get_end_of_day() {
  local date_input="$1"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    date -j -f "%Y-%m-%d" "$date_input" "+%Y-%m-%dT23:59:59Z"
  else
    date -d "$date_input 23:59:59" +"%Y-%m-%d %H:%M"
  fi
}

get_beginning_of_week() {
  local date_input="$1"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    local epoch=$(date -j -f "%Y-%m-%d" "$date_input" "+%s")
    local day_of_week=$(date -j -f "%Y-%m-%d" "$date_input" "+%u")
    local days_to_subtract=$((day_of_week % 7))
    local adjusted_epoch=$((epoch - days_to_subtract*24*3600))
    date -r "$adjusted_epoch" "+%Y-%m-%dT00:00:00Z"
  else
    local day_of_week=$(date -d "$date_input" +%u)
    local days_to_subtract=$((day_of_week % 7))
    date -d "$date_input -${days_to_subtract} days" +"%Y-%m-%dT00:00:00Z"
  fi
}

truncate() {
  input="$1"
  length="$2"
  if [[ ${#input} -gt $length ]]; then
    echo "${input:0:length}..."
  else
    echo "$input"
  fi
}

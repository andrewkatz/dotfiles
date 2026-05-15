#!/usr/bin/env bash
# Writes the developerly TUI's per-session agent state file. Hook into
# claude via ~/.claude/settings.json so each event fires this script with
# a single argument indicating what just happened:
#
#   pre_tool_use       → working   (claude is actively doing things)
#   post_tool_use      → working   (claude is still in an active turn)
#   post_tool_failure  → working   (claude is still in an active turn)
#   user_prompt_submit → working   (the user answered; claude can resume)
#   permission_request → awaiting  (claude is blocked on user input)
#   stop/session_end   → idle      (turn/session finished)
#   notification       → awaiting only for explicit prompt notifications
#
# This follows Superset's lifecycle model: user prompts start work,
# permission/question prompts block, and generic idle notifications do not
# imply that an agent is awaiting user input.
#
# The state file is written atomically to
# $XDG_CACHE_HOME/developerly/status/<session> (defaults to
# ~/.cache/developerly/status/<session>). Filename mirrors the TUI's
# sanitize(): `/` in the tmux session name is replaced with `_`.
#
# No-op when not inside a tmux session — we have no way to identify
# which TUI task this run belongs to.

set -euo pipefail

dir="${XDG_CACHE_HOME:-$HOME/.cache}/developerly/status"
mkdir -p "$dir"
log="$dir/hook.log"

event="${1:-}"
pane="${TMUX_PANE:-}"
session=""
if [ -n "$pane" ]; then
    session=$(tmux display-message -p -t "$pane" '#{session_name}' 2>/dev/null || true)
fi

# Drain stdin so we can both log it and (later) inspect what claude
# sent. Hook payloads are typically a small JSON blob describing the
# event. Read non-blocking so a fork without stdin doesn't hang us.
stdin_payload=""
if [ ! -t 0 ]; then
    stdin_payload=$(cat 2>/dev/null || true)
fi

# Every invocation appends one line. Useful for debugging "why didn't
# my Notification fire?" — tail -f this file while interacting with
# claude. Format: ts \t event \t session \t stdin (newlines stripped).
ts=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
flat_payload=$(printf '%s' "$stdin_payload" | tr '\n' ' ' | tr -s ' ')
printf '%s\tevent=%s\tsession=%s\tpane=%s\tstdin=%s\n' \
    "$ts" "$event" "$session" "$pane" "$flat_payload" >> "$log"

json_string_field() {
    key="$1"
    printf '%s' "$stdin_payload" | grep -oE '"'"$key"'"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | grep -oE '"[^"]*"$' | tr -d '"' || true
}

case "$event" in
    pre_tool_use|post_tool_use|post_tool_failure|user_prompt_submit)
        state="working"
        ;;
    permission_request)
        state="awaiting"
        ;;
    stop|session_end)
        state="idle"
        ;;
    notification)
        notification_type=$(json_string_field "notification_type")
        case "$notification_type" in
            permission_prompt|question_prompt|input_prompt|user_input)
                state="awaiting"
                ;;
            *)
                exit 0
                ;;
        esac
        ;;
    *) exit 0 ;;
esac

[ -z "$session" ] && exit 0

# Mirror cli/internal/tui/status.sanitize(): only `/` is escaped.
file=$(printf '%s' "$session" | tr '/' '_')
printf '%s' "$state" > "$dir/$file.tmp"
mv "$dir/$file.tmp" "$dir/$file"

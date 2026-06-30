#!/usr/bin/env bash
# Writes the developerly TUI's per-session agent state file. Hook into
# claude via ~/.claude/settings.json so each event fires this script with
# a single argument indicating what just happened:
#
#   pre_tool_use       → working   (claude is actively doing things)
#                        awaiting when the tool is AskUserQuestion — the
#                        raw payload is also saved to <session>.prompt so
#                        the mobile web view can render the options
#   post_tool_use      → working   (claude is still in an active turn)
#   post_tool_failure  → working   (claude is still in an active turn)
#   user_prompt_submit → working   (the user answered; claude can resume)
#   permission_request → awaiting  (claude is blocked on user input)
#   stop               → idle      (turn finished)
#   session_end        → idle      (session finished; clears markers)
#   notification       → awaiting only for explicit prompt notifications
#
# Background-work markers (so a parked agent doesn't read as idle):
#
#   pre_tool_use Agent/Task  → touch <session>.subagents.d/<tool_use_id>
#   subagent_stop            → rm    <session>.subagents.d/<tool_use_id>
#   post_tool_use Bash w/    → touch <session>.shells.d/<backgroundTaskId>
#     run_in_background:true
#   task_completed           → rm    <session>.shells.d/<task id>
#
# A non-empty <session>.subagents.d overlays idle/unknown as working; a
# non-empty <session>.shells.d overlays it as the distinct "shell" state
# (a background shell — maybe a server — is still alive). See
# cli/internal/tui/status/status.go readStateFromDir. Marker files are keyed
# by unique ids and only ever touched/removed, so concurrent hook processes
# (parallel tool calls) never race.
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

# json_string_field returns the FIRST string value for key. Good for
# tool_name, which precedes the (potentially huge) tool_input.
json_string_field() {
    key="$1"
    printf '%s' "$stdin_payload" | grep -oE '"'"$key"'"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | grep -oE '"[^"]*"$' | tr -d '"' || true
}

# json_last_string_field returns the LAST string value for key. Used for
# ids (tool_use_id, backgroundTaskId) that trail tool_input — a subagent
# prompt inside tool_input can contain a literal "tool_use_id":"…", so the
# real top-level id is the last match, not the first.
json_last_string_field() {
    key="$1"
    printf '%s' "$stdin_payload" | grep -oE '"'"$key"'"[[:space:]]*:[[:space:]]*"[^"]*"' | tail -n 1 | grep -oE '"[^"]*"$' | tr -d '"' || true
}

# json_bool_true is true when key is set to the JSON boolean true.
json_bool_true() {
    printf '%s' "$stdin_payload" | grep -qE '"'"$1"'"[[:space:]]*:[[:space:]]*true'
}

# Marker directories live next to the state file. Resolved only when we
# know the session (otherwise this run is a no-op anyway).
file=""
subagents_dir=""
shells_dir=""
if [ -n "$session" ]; then
    file=$(printf '%s' "$session" | tr '/' '_')
    subagents_dir="$dir/$file.subagents.d"
    shells_dir="$dir/$file.shells.d"
fi

# prompt_action manages the sibling <session>.prompt file the mobile web
# view renders as a structured question card. AskUserQuestion's payload
# carries the full question/options JSON, so we dump the raw stdin for the
# daemon to parse (no nested-JSON parsing in bash). Claude surfaces
# AskUserQuestion through BOTH PreToolUse and PermissionRequest (fired
# together), so both write the prompt file; any transition away from the
# question — or a non-question permission prompt — clears it. "keep" leaves
# it untouched (marker-only events).
prompt_action="clear"
# state="" means this event maps to no base state — we only manage markers.
state=""
case "$event" in
    pre_tool_use|post_tool_use|post_tool_failure|user_prompt_submit)
        state="working"
        # A new user turn means any prior async subagents have finished and
        # re-invoked us — drop their markers so a missed subagent_stop can't
        # pin the row to working. Background shells are left alone: a server
        # legitimately outlives the turn that launched it.
        if [ "$event" = "user_prompt_submit" ] && [ -n "$subagents_dir" ]; then
            rm -rf "$subagents_dir"
        fi
        tool_name=$(json_string_field "tool_name")
        if [ "$event" = "pre_tool_use" ] && [ "$tool_name" = "AskUserQuestion" ]; then
            state="awaiting"
            prompt_action="write"
        fi
        # Subagent launch — track it as outstanding until subagent_stop so
        # the row stays working through gaps in the subagent's activity.
        if [ "$event" = "pre_tool_use" ] && { [ "$tool_name" = "Agent" ] || [ "$tool_name" = "Task" ]; }; then
            id=$(json_last_string_field "tool_use_id")
            if [ -n "$subagents_dir" ] && [ -n "$id" ]; then
                mkdir -p "$subagents_dir"
                : > "$subagents_dir/$id"
            fi
        fi
        # Background shell — track it once it has actually launched
        # (post_tool_use carries tool_response.backgroundTaskId).
        if [ "$event" = "post_tool_use" ] && [ "$tool_name" = "Bash" ] && json_bool_true "run_in_background"; then
            task_id=$(json_last_string_field "backgroundTaskId")
            if [ -n "$shells_dir" ] && [ -n "$task_id" ]; then
                mkdir -p "$shells_dir"
                : > "$shells_dir/$task_id"
            fi
        fi
        ;;
    permission_request)
        state="awaiting"
        if [ "$(json_string_field "tool_name")" = "AskUserQuestion" ]; then
            prompt_action="write"
        fi
        ;;
    subagent_stop)
        prompt_action="keep"
        id=$(json_last_string_field "tool_use_id")
        if [ -n "$subagents_dir" ] && [ -n "$id" ]; then
            rm -f "$subagents_dir/$id"
        fi
        ;;
    task_completed)
        prompt_action="keep"
        task_id=$(json_last_string_field "backgroundTaskId")
        [ -z "$task_id" ] && task_id=$(json_last_string_field "task_id")
        [ -z "$task_id" ] && task_id=$(json_last_string_field "id")
        if [ -n "$shells_dir" ] && [ -n "$task_id" ]; then
            rm -f "$shells_dir/$task_id"
        fi
        ;;
    stop)
        state="idle"
        ;;
    session_end)
        state="idle"
        if [ -n "$file" ]; then
            rm -rf "$subagents_dir" "$shells_dir"
        fi
        ;;
    notification)
        notification_type=$(json_string_field "notification_type")
        case "$notification_type" in
            permission_prompt|question_prompt|input_prompt|user_input)
                state="awaiting"
                prompt_action="keep"
                ;;
            *)
                exit 0
                ;;
        esac
        ;;
    *) exit 0 ;;
esac

[ -z "$session" ] && exit 0

# Tmp names carry $$ — concurrent invocations (parallel tool calls fire
# concurrent PreToolUse hooks) must not race each other's rename source.
case "$prompt_action" in
    write)
        printf '%s' "$stdin_payload" > "$dir/$file.prompt.tmp.$$"
        mv "$dir/$file.prompt.tmp.$$" "$dir/$file.prompt"
        ;;
    clear)
        rm -f "$dir/$file.prompt"
        ;;
    keep)
        :
        ;;
esac

# Marker-only events (subagent_stop, task_completed) leave the base state
# alone — they don't imply the agent is working or idle.
if [ -n "$state" ]; then
    printf '%s' "$state" > "$dir/$file.tmp.$$"
    mv "$dir/$file.tmp.$$" "$dir/$file"
fi

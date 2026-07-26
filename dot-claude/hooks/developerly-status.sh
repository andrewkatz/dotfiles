#!/usr/bin/env bash
# Writes the developerly TUI's per-session agent state file. Hook into
# claude via ~/.claude/settings.json so each event fires this script with
# a single argument indicating what just happened:
#
#   pre_tool_use         → working   (claude is actively doing things)
#                          awaiting when the tool is AskUserQuestion — the
#                          raw payload is also saved to <session>.prompt so
#                          the mobile web view can render the options
#   post_tool_use        → working   (claude is still in an active turn)
#   post_tool_failure    → working   (claude is still in an active turn)
#   user_prompt_submit   → working   (the user answered; claude can resume)
#   permission_request   → awaiting  (claude is blocked on user input)
#   stop                 → idle      (turn finished)
#   session_end          → idle      (session finished; clears markers)
#   notification_awaiting→ awaiting  (a permission/needs-input prompt fired)
#   notification_idle    → (no state change; reconciles background markers)
#
# The notification kind is selected by the settings.json *matcher*, not a
# payload field: hooks.go registers Notification with matcher permission_prompt
# / agent_needs_input → notification_awaiting and idle_prompt / agent_completed
# → notification_idle. (The old notification_type payload field does not exist.)
#
# Sticky awaiting (so a parallel tool's post_tool_use can't clobber a real
# block): AskUserQuestion / permission_request / notification_awaiting also
# touch <session>.awaiting.d/<key> (keyed by tool_name, or "notification").
# post_tool_use / post_tool_failure clear the completing tool's key; a new turn
# (user_prompt_submit) or turn/session end (stop/session_end) wipe the dir. A
# non-empty <session>.awaiting.d overlays any working/idle base as awaiting.
#
# Background-work markers (so a parked agent doesn't read as idle):
#
#   post_tool_use Agent/Task → touch <session>.subagents.d/<agentId>
#     (isAsync launch only)     the async launch's tool_response carries
#                               "isAsync":true and "agentId":"…"
#   post_tool_use Bash w/    → touch <session>.shells.d/<backgroundTaskId>
#     run_in_background:true
#   post_tool_use TaskStop   → rm    <session>.shells.d/<task_id>  (fast-path)
#
# Claude Code fires NO hook when a background shell/subagent exits, so markers
# are reconciled against the session transcript on `stop` and idle
# notifications (subagents also on subagent_stop) — the transcript is the
# source of truth. Both a shell and an async subagent are done once the
# transcript carries a <task-notification> for the id (<task-id>ID</task-id>,
# any terminal status — completed/failed/killed/stopped); <task-id> equals the
# subagent's launch agentId. The user_prompt_submit wipe of
# <session>.subagents.d and session start/end clearing remain backstops.
#
# A non-empty <session>.subagents.d overlays idle/unknown as working; a
# non-empty <session>.shells.d overlays it as the distinct "shell" state
# (a background shell — maybe a server — is still alive). See
# cli/internal/tui/status/status.go readStateFromDir. Marker files are keyed
# by unique ids and only ever touched/removed, so concurrent hook processes
# (parallel tool calls) never race.
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
# The payload is truncated and the file is capped so a busy session can't
# grow it without bound (single tool inputs/outputs can be megabytes). The
# truncation is log-only — parsing below always uses the full $stdin_payload.
# The cap is 4000 (not a few hundred): the session_id + transcript_path + cwd
# prefix alone is ~300 chars, so a smaller cap hides every discriminating field
# (tool_name, agentId, notification message) and makes this log useless for
# diagnosis. Set DEVELOPERLY_HOOK_DEBUG=1 to also append untruncated payloads to
# hook.debug.log for a one-off deep dive.
ts=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
flat_payload=$(printf '%s' "$stdin_payload" | tr '\n' ' ' | tr -s ' ' | cut -c1-4000)
if [ "${DEVELOPERLY_HOOK_DEBUG:-}" = "1" ]; then
    printf '%s\tevent=%s\tsession=%s\tstdin=%s\n' \
        "$ts" "$event" "$session" "$stdin_payload" >> "$dir/hook.debug.log"
fi
printf '%s\tevent=%s\tsession=%s\tpane=%s\tstdin=%s\n' \
    "$ts" "$event" "$session" "$pane" "$flat_payload" >> "$log"
# Cap the log: once it passes ~5 MB, keep only the last 1000 lines.
log_bytes=$(wc -c < "$log" 2>/dev/null | tr -dc '0-9')
[ -n "$log_bytes" ] || log_bytes=0
if [ "$log_bytes" -gt 5242880 ]; then
    tail -n 1000 "$log" > "$log.tmp.$$" 2>/dev/null && mv "$log.tmp.$$" "$log" || rm -f "$log.tmp.$$"
fi

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

# prune_completed_markers removes marker files in marker_dir whose id no longer
# corresponds to live background work, using the session transcript as the
# source of truth (Claude Code fires no hook when a background shell exits). A
# marker is stale once the transcript contains needle_prefix<id>needle_suffix:
# for shells the <task-notification> tag <task-id>ID</task-id> (matches any
# terminal status), for subagents the completing tool_result's
# "tool_use_id":"ID". The transcript is read only when the dir has markers.
prune_completed_markers() {
    marker_dir="$1"
    transcript="$2"
    needle_prefix="$3"
    needle_suffix="$4"
    [ -n "$marker_dir" ] && [ -d "$marker_dir" ] || return 0
    [ -n "$transcript" ] && [ -f "$transcript" ] || return 0
    for marker in "$marker_dir"/*; do
        [ -e "$marker" ] || continue
        id=$(basename "$marker")
        if grep -Fq "$needle_prefix$id$needle_suffix" "$transcript"; then
            rm -f "$marker"
        fi
    done
}

# awaiting_key sanitizes a tool name into a marker filename (strip slashes so
# an MCP-style name can't escape the awaiting.d directory).
awaiting_key() {
    printf '%s' "$1" | tr '/' '_'
}

# set_awaiting / clear_awaiting manage sticky awaiting markers. A non-empty
# <session>.awaiting.d overlays the base state as awaiting (see status.go
# readStateFromDir), so a parallel tool's post_tool_use → working can't clobber
# a genuine block while the prompt is still up.
set_awaiting() {
    key=$(awaiting_key "$1")
    [ -n "$awaiting_dir" ] && [ -n "$key" ] || return 0
    mkdir -p "$awaiting_dir"
    : > "$awaiting_dir/$key"
}
clear_awaiting() {
    key=$(awaiting_key "$1")
    [ -n "$awaiting_dir" ] && [ -n "$key" ] || return 0
    rm -f "$awaiting_dir/$key"
}

# Marker directories live next to the state file. Resolved only when we
# know the session (otherwise this run is a no-op anyway).
file=""
subagents_dir=""
shells_dir=""
awaiting_dir=""
if [ -n "$session" ]; then
    file=$(printf '%s' "$session" | tr '/' '_')
    subagents_dir="$dir/$file.subagents.d"
    shells_dir="$dir/$file.shells.d"
    awaiting_dir="$dir/$file.awaiting.d"
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
        # pin the row to working, and drop any awaiting markers (the user just
        # answered). Background shells are left alone: a server legitimately
        # outlives the turn that launched it.
        if [ "$event" = "user_prompt_submit" ]; then
            [ -n "$subagents_dir" ] && rm -rf "$subagents_dir"
            [ -n "$awaiting_dir" ] && rm -rf "$awaiting_dir"
        fi
        tool_name=$(json_string_field "tool_name")
        if [ "$event" = "pre_tool_use" ] && [ "$tool_name" = "AskUserQuestion" ]; then
            state="awaiting"
            prompt_action="write"
            set_awaiting "$tool_name"
        fi
        # Async subagent launch — the Agent/Task tool payload has no top-level
        # tool_use_id, but the async launch's tool_response carries
        # "isAsync":true and "agentId":"…". Key the marker by agentId (the same
        # id that appears as <task-id> in the completion task-notification) so
        # an async subagent keeps the row working after the launching turn ends.
        # Synchronous subagents block the turn, so they need no marker.
        if [ "$event" = "post_tool_use" ] && { [ "$tool_name" = "Agent" ] || [ "$tool_name" = "Task" ]; } && json_bool_true "isAsync"; then
            id=$(json_last_string_field "agentId")
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
        # Background shell killed — TaskStop stops a background task by id, and
        # task_id equals the backgroundTaskId we keyed the marker by. Drop it
        # immediately rather than waiting for the next idle's transcript sweep.
        if [ "$event" = "post_tool_use" ] && [ "$tool_name" = "TaskStop" ]; then
            stop_id=$(json_last_string_field "task_id")
            if [ -n "$shells_dir" ] && [ -n "$stop_id" ]; then
                rm -f "$shells_dir/$stop_id"
            fi
        fi
        # A tool completing (or failing) resolves any awaiting prompt it raised.
        # Claude emits the generic needs-input notification alongside the
        # tool-specific prompt, but does not emit user_prompt_submit when an
        # AskUserQuestion answer is selected. Clear both markers together once
        # that same tool resumes; leave them sticky for unrelated parallel tools.
        if [ "$event" = "post_tool_use" ] || [ "$event" = "post_tool_failure" ]; then
            awaiting_tool_key=$(awaiting_key "$tool_name")
            if [ -n "$awaiting_dir" ] && [ -n "$awaiting_tool_key" ] && [ -f "$awaiting_dir/$awaiting_tool_key" ]; then
                clear_awaiting "$tool_name"
                clear_awaiting "notification"
            fi
        fi
        ;;
    permission_request)
        state="awaiting"
        tool_name=$(json_string_field "tool_name")
        set_awaiting "$tool_name"
        if [ "$tool_name" = "AskUserQuestion" ]; then
            prompt_action="write"
        fi
        ;;
    subagent_stop)
        prompt_action="keep"
        # SubagentStop carries no launch id, so prune against the transcript:
        # a finished subagent has a <task-notification> whose <task-id> equals
        # the launch agentId we keyed the marker by.
        transcript=$(json_string_field "transcript_path")
        prune_completed_markers "$subagents_dir" "$transcript" '<task-id>' '</task-id>'
        ;;
    stop)
        state="idle"
        # The agent has parked. Reconcile background-work markers against the
        # transcript so a shell/subagent that already finished doesn't pin the
        # row to shell/working. Claude fires no hook on background-shell exit,
        # so this stop-time sweep — always reached after a completion
        # re-invokes the agent — is the authoritative cleanup. The turn ended,
        # so any awaiting prompt is resolved too.
        transcript=$(json_string_field "transcript_path")
        prune_completed_markers "$shells_dir" "$transcript" '<task-id>' '</task-id>'
        prune_completed_markers "$subagents_dir" "$transcript" '<task-id>' '</task-id>'
        [ -n "$awaiting_dir" ] && rm -rf "$awaiting_dir"
        ;;
    session_end)
        state="idle"
        if [ -n "$file" ]; then
            rm -rf "$subagents_dir" "$shells_dir" "$awaiting_dir"
        fi
        ;;
    notification_awaiting|notification_idle)
        # Which kind of notification this is comes from the settings.json
        # matcher (permission_prompt / agent_needs_input vs idle_prompt /
        # agent_completed), passed to us as the event arg — the payload has no
        # notification_type field. Either kind can be the only event after async
        # work finishes, so reconcile markers first.
        transcript=$(json_string_field "transcript_path")
        prune_completed_markers "$shells_dir" "$transcript" '<task-id>' '</task-id>'
        prune_completed_markers "$subagents_dir" "$transcript" '<task-id>' '</task-id>'
        if [ "$event" = "notification_awaiting" ]; then
            state="awaiting"
            prompt_action="keep"
            # Sticky: hold awaiting until the user answers (user_prompt_submit)
            # or the turn ends, so a background subagent's post_tool_use can't
            # flip an input-waiting row back to working.
            set_awaiting "notification"
        else
            # idle_prompt / agent_completed: markers reconciled, no state change.
            exit 0
        fi
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

# Marker-only events (subagent_stop) leave the base state alone — they don't
# imply the agent is working or idle.
if [ -n "$state" ]; then
    printf '%s' "$state" > "$dir/$file.tmp.$$"
    mv "$dir/$file.tmp.$$" "$dir/$file"
fi

#!/bin/bash
[ -n "$TMUX" ] || exit 0

# Find the window containing this pane, so it works even when unfocused
WINDOW=$(tmux display-message -t "$TMUX_PANE" -p '#{window_id}')
ICON="$1"

# Hook events pipe JSON on stdin. For PreToolUse, override the icon when the
# tool is one that waits for user input (AskUserQuestion, ExitPlanMode).
if [ ! -t 0 ]; then
  PAYLOAD=$(cat)
  TOOL=$(printf '%s' "$PAYLOAD" | jq -r '.tool_name // empty' 2>/dev/null)
  case "$TOOL" in
    AskUserQuestion|ExitPlanMode)
      ICON=$(printf '\xef\x81\xb5')
      ;;
  esac
fi
BASE=$(tmux display-message -t "$WINDOW" -p '#{window_name}' | sed -E 's/ (|)$//')
if [ -n "$ICON" ]; then
  tmux rename-window -t "$WINDOW" "$BASE $ICON"
else
  tmux rename-window -t "$WINDOW" "$BASE"
fi

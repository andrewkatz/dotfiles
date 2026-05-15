function wtc() {
  local use_tmux=false
  local use_plan=false
  local win_name=""
  local prompt_file=""
  local base_branch=""
  local args=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tmux)  use_tmux=true; shift ;;
      --plan)  use_plan=true; shift ;;
      --name)  win_name="$2"; shift 2 ;;
      --base)  base_branch="$2"; shift 2 ;;
      -f)      prompt_file="$2"; shift 2 ;;
      *)       args+=("$1"); shift ;;
    esac
  done

  local branch_name="${args[1]}"
  if [ -z "$branch_name" ]; then
    echo "Usage: wtc [--tmux [--name <win>]] [--plan] [--base <branch>] [-f <file>] <branch> [prompt]"
    return 1
  fi

  # Resolve prompt: positional arg > -f file > stdin
  local prompt="${args[2]}"
  if [ -z "$prompt" ] && [ -n "$prompt_file" ]; then
    prompt=$(<"$prompt_file")
  elif [ -z "$prompt" ] && [ ! -t 0 ]; then
    prompt=$(cat)
  fi

  # Branch existence check
  local is_pr=false
  local create_flag=""
  if [[ "$branch_name" =~ ^pr:([0-9]+)$ ]]; then
    is_pr=true
  fi
  if [ "$is_pr" = false ]; then
    local branch_exists=$(git branch --list "$branch_name" || \
      git ls-remote --heads origin "$branch_name")
    if [ -z "$branch_exists" ]; then
      create_flag="--create"
    fi
  fi

  local -a base_flag
  if [ -n "$base_branch" ]; then
    base_flag=(--base "$base_branch")
  fi

  local -a claude_flags
  if [ "$use_plan" = true ]; then
    claude_flags=(--allow-dangerously-skip-permissions --permission-mode plan --effort max --model 'opus')
  else
    claude_flags=(--dangerously-skip-permissions --effort max --model 'opus')
  fi

  if [ "$use_tmux" = true ]; then
    # --- tmux mode: spawn in a detached window ---
    if [ -z "$win_name" ]; then
      win_name="${branch_name}"
    fi

    local tmpfile=$(mktemp "${TMPDIR:-/tmp}/wtc.XXXXXX")
    printf '%s' "$prompt" > "$tmpfile"

    if tmux list-windows -F '#{window_name}' 2>/dev/null | grep -qx "$win_name"; then
      echo "Error: tmux window '$win_name' already exists. Use --name to specify a different name."
      return 1
    fi
    tmux new-window -dn "$win_name"

    local prompt_arg=""
    if [ -n "$prompt" ]; then
      prompt_arg="\"\$WTC_PROMPT\""
    fi

    tmux send-keys -t ":$win_name" \
      "WTC_PROMPT=\$(cat $tmpfile) && rm $tmpfile && wt switch $create_flag ${base_flag[*]} \"$branch_name\" -x claude -- ${claude_flags[*]} $prompt_arg" Enter

    echo "Spawned in tmux window '$win_name' on branch '$branch_name'"
    echo "Connect: tmux select-window -t \":$win_name\""
  else
    # --- normal mode: run in current shell ---
    if [ -n "$prompt" ]; then
      wt switch $create_flag "${base_flag[@]}" "$branch_name" -x claude -- "${claude_flags[@]}" "$prompt"
    else
      wt switch $create_flag "${base_flag[@]}" "$branch_name" -x claude -- "${claude_flags[@]}"
    fi
  fi
}

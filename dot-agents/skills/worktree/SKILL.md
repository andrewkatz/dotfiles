---
name: worktree
description: Manage git worktrees with Worktrunk and tmux window integration. Create worktrees with dedicated tmux windows, clean up merged branches, open dev servers in the browser, and spawn parallel AI agents in separate worktrees.
---

# Worktree Management

Manage git worktrees using [Worktrunk](https://worktrunk.dev/) (`wt`) with tmux window integration. Worktrunk handles worktree creation, environment setup (via project hooks), and lifecycle management. This skill adds tmux window orchestration and parallel agent spawning on top.

## Prerequisites

- `wt` (Worktrunk) is installed with shell integration
- `tmux` is running (check with `$TMUX` env var)
- Project hooks in `.config/wt.toml` handle environment setup automatically (dependency installation, port assignment, database provisioning)

## CRITICAL RULES

**Before spawning a worktree, you MUST verify ALL of the following:**

1. **Build mode required.** You must be in build mode (not plan mode) before spawning a worktree. If you are in plan mode, ask the user to switch you to build mode first. Spawning worktrees creates branches and filesystem changes — this is not a read-only operation.

2. **Must be on the root worktree.** Run `wt list --format=json | jq '.[] | select(.is_main == true and .is_current == true)'` to confirm you are on the main/root worktree. If you are inside a child worktree, do NOT spawn new worktrees from there.

3. **ONLY use `wcc --tmux` to spawn agents.** Never manually run `wt switch`, `tmux new-window`, `tmux send-keys`, or any other combination of commands to create worktrees or tmux panes. The `wcc` tool handles ALL of this — branch creation, worktree setup, tmux window creation, and claude session launch. Using anything else will break the workflow.

## Key Concepts

- **Worktree paths** follow the pattern `<repo>.<branch>` as siblings of the main repo directory
- **Ports** are deterministic per branch via `hash_port` (range 10000-19999) -- no collisions, stable across machines
- **`wt list --format=json`** is the authoritative source for worktree paths, URLs, and status
- The agent (you) should **stay in your current working directory** -- operate on remote tmux windows via `tmux send-keys`, never `cd` into a different worktree

## Operations

### 1. Create Worktree + Tmux Window

Create a new worktree and open a dedicated tmux window for it. Worktrunk hooks handle all environment setup (copy-ignored files, mise.local.toml generation, bundle/yarn install, bin/setup).

**Preferred: Use `wcc --tmux`** to create a worktree with a claude session in a detached tmux window without affecting your current shell:

```bash
wcc --tmux "<branch>"
```

This handles branch existence checks, `--create` flag, tmux window creation, and opencode launch automatically. See [Spawn Parallel AI Agent](#4-spawn-parallel-ai-agent-in-a-worktree) for full usage.

**Manual alternative** (ONLY when you need a worktree without claude, e.g., for the user to work in directly — never use this to spawn AI agents):

> **WARNING:** Do NOT use `wt switch` to create worktrees for AI agents. It changes the current shell's working directory and renames the tmux window, contaminating your session. Always use `wcc --tmux` for agent spawning.

```bash
# Check if the branch already exists (local or remote)
branch_exists=$(git branch --list "<branch>" || git ls-remote --heads origin "<branch>")

# Create the worktree (--create only if branch is new)
if [ -z "$branch_exists" ]; then
  wt switch --create "<branch>"
else
  wt switch "<branch>"
fi
```

After the worktree is created, return to your original branch:

```bash
wt switch main  # or whatever branch you were on
```

### 2. Clean Up Worktrees

#### Remove a single worktree

Close the tmux window and remove the worktree + branch:

```bash
# Kill the tmux window (suppressing errors if it doesn't exist)
tmux kill-window -t ":<branch>" 2>/dev/null || true

# Remove the worktree and delete the branch
wt remove "<branch>" -D
```

The `-D` flag force-deletes the local branch even if it has unmerged changes.

#### Merge a PR and clean up (the `wmm` pattern)

For a branch with an open PR that's ready to merge:

```bash
# From the worktree's directory (or via tmux send-keys)
gh pr merge --admin
wt remove -D
git pull
```

#### Bulk prune merged worktrees

Remove all worktrees whose branches are already merged into the default branch:

```bash
wt step prune --dry-run  # preview first
wt step prune            # remove them
```

### 3. Open Worktree in Browser

Look up the worktree's dev server URL and open it:

```bash
# Get the URL from wt list
url=$(wt list --format=json | jq -r '.[] | select(.branch == "<branch>") | .url')

# Open in the default browser (macOS)
open "$url"
```

The URL pattern for Portal projects is `http://huntress.localhost:<hash_port>`. The port is deterministic per branch name.

### 4. Spawn Parallel AI Agent in a Worktree

Use the `wcc --tmux` command to create a worktree with a dedicated tmux window and launch an independent claude session in it. This lets you delegate a task to a parallel agent while continuing your own work.

**IMPORTANT — `wcc --tmux` is the ONLY way to spawn agents:**

- **NEVER** run `wt switch` to create agent worktrees — it contaminates your current shell
- **NEVER** manually run `tmux new-window` or `tmux send-keys` — `wcc` handles all tmux operations
- **NEVER** try to piece together worktree creation + tmux + claude yourself — `wcc --tmux` does it all in one atomic operation
- **ALWAYS** verify you are in build mode and on the root worktree before calling `wcc --tmux`

#### Writing the prompt

**Always use `-f` (file) for prompts longer than a single sentence.** Write the prompt to a temp file first, then pass it via `-f`. This keeps long prompts safe from shell quoting issues and is easier to review before spawning.

```bash
# 1. Write prompt to a temp file (use branch name for clarity)
cat > /tmp/<branch>-prompt.txt <<'EOF'
Your detailed task description here.
Any "quotes", $variables, `backticks`, and special chars are safe.
EOF

# 2. Spawn with -f
wcc --tmux --name <window-name> <branch> -f /tmp/<branch>-prompt.txt
```

For very short prompts (one sentence), a positional argument is fine:

```bash
wcc --tmux --name auth fix-auth-bug "Fix the auth bug in the login controller"
```

#### Prompt sources

`wcc` accepts prompts from three sources (in priority order):

1. **Positional argument** (short prompts only): `wcc --tmux <branch> "Fix the auth bug"`
2. **File** (`-f`) **(preferred for anything detailed)**: `wcc --tmux <branch> -f /path/to/prompt.txt`
3. **Stdin / heredoc** (avoid — can crash on long prompts due to shell quoting)

#### Options

- `--tmux` — spawn in a detached tmux window (required for parallel agents)
- `--plan` — start claude in plan permission mode (uses `--permission-mode plan` instead of full `--dangerously-skip-permissions`)
- `--name <win>` — custom tmux window name. **Always provide this** when spawning multiple agents — the default (last segment of branch name) causes collisions for branches with shared suffixes
- `-f <file>` — read prompt from a file **(preferred for detailed prompts)**

#### Examples

```bash
# Short prompt — positional argument is fine
wcc --tmux --name auth fix-auth-bug "Fix the auth bug in the login controller"

# Detailed prompt — write to file first, then use -f
cat > /tmp/esql-sort-prompt.txt <<'EOF'
Implement the SORT command for the ES|QL parser.
Only support SORT on aggregation (STATS) queries.

Key files:
- lib/esql/parser.rb
- lib/esql/ast.rb
EOF
wcc --tmux --name sort sc-new-story-esql-sort-command -f /tmp/esql-sort-prompt.txt
```

> **Note:** Use `wcc --plan` to start the agent in plan permission mode. This uses `--permission-mode plan` so the agent can read and explore but must ask before making changes.

After spawning, `wcc` prints the tmux window name and how to connect:

```
Spawned in tmux window 'auth' on branch 'feature-branch'
Connect: tmux select-window -t ":auth"
```

The agent runs independently. You do not need to wait for it to finish.

#### Spawning multiple parallel agents

Call `wcc --tmux` once per agent. Each call is independent and does not affect your current shell. **Always use `-f` and `--name`** when spawning multiple agents:

```bash
# Write each prompt to its own temp file
cat > /tmp/sort-prompt.txt <<'EOF'
Implement SORT command for the ES|QL parser...
EOF

cat > /tmp/bypass-prompt.txt <<'EOF'
Detect raw ES|QL in AI search and bypass the LLM...
EOF

cat > /tmp/timerange-prompt.txt <<'EOF'
Add TIME_RANGE extraction to NaturalLanguageQuery...
EOF

# Spawn each agent with a unique --name and -f
wcc --tmux --name sort sc-new-story-esql-sort-command -f /tmp/sort-prompt.txt
wcc --tmux --name bypass sc-new-story-ai-search-esql-bypass -f /tmp/bypass-prompt.txt
wcc --tmux --name timerange sc-new-story-nlq-time-range -f /tmp/timerange-prompt.txt
```

## Querying Worktree Status

Use `wt list --format=json` to get structured data about all worktrees. Each entry includes:

| Field | Description |
|-------|-------------|
| `branch` | Branch name |
| `path` | Absolute filesystem path |
| `url` | Dev server URL (from project `[list]` config) |
| `url_active` | Whether the dev server is responding |
| `is_current` | Whether this is the current worktree |
| `is_main` | Whether this is the main/primary worktree |
| `working_tree.staged` | Has staged changes |
| `working_tree.modified` | Has unstaged modifications |
| `working_tree.untracked` | Has untracked files |
| `main_state` | Relationship to main: `is_main`, `ahead`, `behind`, `diverged` |
| `remote.ahead` / `remote.behind` | Commits ahead/behind remote tracking branch |

## Troubleshooting

### Window name collision (second agent errors out)

Branch names with shared suffixes (e.g., `fix-foo-errors` and `fix-bar-errors`) both default to window name `errors`. `wcc` will now error if the window already exists. Always pass `--name` explicitly with a unique name per agent.

## When to Use This Skill

- User asks to create a worktree, branch environment, or parallel workspace
- User asks to spin up or launch a parallel agent/task
- User asks to clean up, remove, or prune worktrees
- User asks to open a worktree's dev server in the browser
- User asks to list or check the status of active worktrees
- User asks about worktree ports or URLs

---
name: developerly
description: |
  Manage Developerly work items and epics from local coding agents such as Claude Code
  or Pi. Use this skill whenever the user mentions Developerly, work items, epics,
  shared backlog tickets, or asks to create/update tasks for local agents. The
  skill drives the `developerly` CLI, which talks to the Developerly sync API on the
  user's behalf.
---

# Developerly skill

The `developerly` CLI is a Go binary that manages projects, epics, work items, and
their dependencies in Developerly. Use it whenever the user wants to:

- See shared or local work items
- Create a new feature, bug fix, or follow-up work item
- Open or close an epic
- Wire up dependencies between work items

## Setup (one-time)

1. Sign in at <https://developerly.comfort.ly>
2. Visit **Access Tokens** and click **Create token**
3. Copy the token (it starts with `dvly_`) and run:

   ```bash
   developerly auth login --token dvly_xxx
   ```

   The token is stored at `~/.config/developerly/credentials.toml`. Re-running
   `auth login` replaces it. Shared preferences live in
   `~/.config/developerly/config.toml`, and machine-local projects live in
   `~/.config/developerly/projects.toml`. `developerly auth status` shows whether
   you're signed in.

If `developerly` is not installed:

```sh
curl -sSL https://developerly.comfort.ly/install.sh | sh
```

Go users can also run `go install github.com/getcomfortly/developerly/cli@latest`.

To upgrade an existing install to the latest release:

```sh
developerly upgrade           # downloads and replaces the current binary
developerly upgrade --check   # report the latest release without installing
```

## Common commands

| Intent | Command |
|---|---|
| Auth status | `developerly auth status` |
| List local configured projects | `developerly projects list` |
| List server projects too | `developerly projects list --sync` |
| List work items | `developerly work-items list --project=NAME_OR_ID --sync` |
| Show one work item | `developerly work-items get ID` |
| Create a work item | `developerly work-items create --project=NAME_OR_ID --kind=feature --title='...' --description='...' --sync` |
| Update a work item | `developerly work-items update ID --title='...' --description='...'` |
| Delete a draft/local work item | `developerly work-items delete ID` |
| List epics | `developerly epics list --project=NAME_OR_ID` |
| Create an epic | `developerly epics create --project=NAME_OR_ID --title='...' --description='...'` |
| Add dependency | `developerly deps add WORK_ITEM_ID DEPENDENCY_ID` |
| Remove dependency | `developerly deps remove WORK_ITEM_ID DEPENDENCY_ID` |

Add `--json` when you need machine-readable output. Epic descriptions are supported for both local and synced epics.

## Project identifiers

Most commands accept either:

- configured local project name (for example `inn_management`), or
- linked Developerly project id.

If the current directory is inside a configured project, some local-task commands
can infer the project, but explicit `--project` is safer.

## Local/server sync model

`developerly work-items create` creates a local TUI task first; with `--sync`,
linked projects also get a Developerly draft work item. Draft work items are the
shared backlog. When someone starts work in the TUI, the item goes directly to
`in_progress` and is assigned to that user.

## Work item kinds

`feature`, `bug_fix`, `pr_feedback`, `pr_assist`, `slack_prompt`. Default to
`feature` when the user describes a new piece of product work. Some legacy kind
names remain for compatibility even though the server no longer receives Slack or
PR webhooks.

## Work item states

`draft → in_progress → in_review → completed`. `blocked` is derived from incomplete
dependencies and is not stored as a state.

## Examples

User: *"Add a work item to inn_management to add CSV export to the reservations page."*

```bash
developerly work-items create --project=inn_management --kind=feature \
  --title='Add CSV export to reservations' \
  --description='Add a CSV export button to the reservations index page.' \
  --sync --json
```

User: *"What's blocked on the inn_management board right now?"*

```bash
developerly work-items list --project=inn_management --state=blocked --sync --json
```

## When NOT to use this skill

- Implementation work itself — the CLI manages tickets, it doesn't write code.
- Repository operations (branches, PRs) — those happen in the local TUI/worktree workflow.
- Anything outside Developerly (GitHub directly, Linear, Jira, etc).

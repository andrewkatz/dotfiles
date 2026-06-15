# sentry-to-developerly

Creates a local Developerly task for each unassigned, unresolved Sentry issue, then assigns the Sentry issue so it isn't picked up again.

- Polls one or more Sentry projects for `is:unresolved` issues that have no assignee.
- For each new issue, creates a Developerly task (via the `developerly` CLI) with a rich Markdown body: exception, stack trace, request, user, tags, context, and recent breadcrumbs (sensitive keys redacted).
- Titles are prefixed `[Sentry]`, or `[Sentry] [BETA]` when the issue's environment is `beta`.
- Only after the task is created is the Sentry issue assigned (`SENTRY_ASSIGNEE`, default `me`), which marks it processed on the Sentry side. A local state file (`~/.cache/sentry-to-developerly/processed.json`) also dedupes across runs.
- A lock file prevents overlapping runs.

## Setup

```bash
cp ~/.config/scripts/sentry-to-developerly/env.example ~/.config/sentry-to-developerly.env
chmod 600 ~/.config/sentry-to-developerly.env
```

Create a Sentry **internal integration** / auth token with scopes `event:read`, `event:write`, `project:read`, `org:read`, then fill in `~/.config/sentry-to-developerly.env`:

```bash
SENTRY_AUTH_TOKEN="..."
SENTRY_ORG_SLUG="your-org"
SENTRY_PROJECT_SLUG="your-project"      # or SENTRY_PROJECT_SLUGS="a,b,c"
DEVELOPERLY_PROJECT="VIA"               # local Developerly project from ~/.config/developerly/config.toml
```

The remaining keys (query, paging limits, assignee, description size, base URL, lock/state file overrides) have sensible defaults documented in `env.example`.

The `developerly` CLI must be installed and configured (`~/.config/developerly/config.toml`). `bin/install` installs it; `DEVELOPERLY_CLI` defaults to `~/.local/bin/developerly`.

## Test

```bash
~/.config/scripts/sentry-to-developerly/sync --env ~/.config/sentry-to-developerly.env --dry-run
~/.config/scripts/sentry-to-developerly/sync --env ~/.config/sentry-to-developerly.env
```

## Schedule (macOS launchd)

```bash
~/.config/scripts/sentry-to-developerly/install-launchagent
```

The default interval is five minutes. Override with `SENTRY_TO_DEVELOPERLY_INTERVAL` (seconds) before installing.

Logs: `~/Library/Logs/sentry-to-developerly.log` / `.err.log`

## Uninstall

```bash
~/.config/scripts/sentry-to-developerly/install-launchagent --uninstall
```

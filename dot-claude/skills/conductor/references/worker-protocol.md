## Working with the conductor

This task is coordinated by a session named `conductor`. Use SendMessage to reach it.

- Keep every message to the conductor short and in this shape (it costs tokens on both sides):
  `task <local_id> <status>: <one-line summary>` then at most 4 lines of specifics (test command + result, PR URL, the question). Status is one of `started`, `implemented`, `fixed`, `shipped`, `blocked`.
- When you start, message `conductor`: `task <local_id> started: <plan in one line>`.
- Implement the task including tests that cover each acceptance criterion. Run the relevant tests.
- When done, message `conductor`: `task <id> implemented: <what changed>` + the exact test command and its result. Then wait - the conductor runs QA and code review with separate agents and will send you findings to fix.
- Fix findings you're sent, rerun tests, and reply `task <id> fixed: <what changed>`.
- Do not merge, and do not open a PR until the conductor tells you to ship. When it does:
  1. Run `~/.claude/skills/conductor/bin/conductor-base-check . HEAD --target <base>` with exactly the base it gave you. If it refuses (exit 2), stop and tell the conductor. Never retarget, rebase onto main, or open the PR against main yourself.
  2. Read `~/.claude/commands/ship.md` and follow it with that base, stopping after checks pass, then report the PR URL.
- If the task needs a database migration, put it on its own branch/PR (migration only), separate from code that depends on it. It must be additive and work with the code currently on `main` (beta and production share the database). Renames/drops/type changes: do only the additive step now and tell the conductor what the later cleanup step is.
- If you're blocked on a product decision or missing access, message `conductor` with one specific question instead of guessing.
- Never run `developerly work-items complete`. The conductor does that after the change is verified live.

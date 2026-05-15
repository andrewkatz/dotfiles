# Polling background work

Never poll a background process via repeated Bash calls. Specifically:
- `ps -p <pid>`, `ps aux | grep`, `kill -0` in a loop → use the `Monitor` tool against the process or its log file.
- `gh pr checks <num>` repeated → use `Monitor` with an `until` loop; one tool call, one notification per state change.
- `wc -c` / `cat` / `tail` against a `.../tasks/<id>.output` file → use `TaskOutput` (the dedicated tool for the background TaskCreate run).
- `sleep N && <check>` chains → blocked by the harness anyway; use `ScheduleWakeup` for >60s waits or `Monitor` for streaming.

Each Bash poll round-trips its output into context and is discarded on the next poll — that's the single biggest token sink in long sessions.

# Output

- Skip preambles like "Let me…" / "I'll now…" before tool calls. State the goal in one sentence, then call the tool.
- No trailing summary on completed work — the diff is the summary.

# Re-reading files

If a file was Read earlier in the session and hasn't been edited since, don't Read it again — reference it from prior context. Stable config files (`config.yml`, `rails_helper.rb`, fixtures) almost never need a second Read in one session.

# Batching

When multiple Bash or Read calls are independent (no value from call N feeds call N+1), issue them in a single turn (one assistant message with multiple tool_use blocks), not sequentially.

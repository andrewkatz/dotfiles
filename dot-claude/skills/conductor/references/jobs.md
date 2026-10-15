# Conductor jobs

The dispatcher (main session) never does pipeline work itself. It spawns one subagent per job with the Agent tool, `subagent_type: general-purpose`, the model below, and a prompt that is exactly:

```
You are a conductor job: <kind><, task N><, stage S>.
Read ~/.claude/skills/conductor/references/policy.md and the "<kind>" section of ~/.claude/skills/conductor/references/jobs.md, then any other reference that section names. Do only this job.
Ledger: ~/.claude/skills/conductor/bin/conductor-ledger (never edit the JSON files directly).
Input: <events / worker messages / Andrew's words, verbatim>
Return ONLY the result block described in jobs.md "Result block" - no other prose.
```

## Result block (every job returns this and nothing else, ≤8 lines)

```
done: <one line per task that changed: "2110 qa→review (QA pass 6/6)">
ask: Q31,Q32            (questions queued for Andrew; omit if none)
push: <one line>        (only for something broken or a new blocking question; omit otherwise)
monitor: <name> | <command>   (dispatcher arms it; omit if none) - the command MUST print exactly one line and exit; every line wakes the dispatcher. For deploy/CI runs use only `~/.claude/skills/conductor/bin/conductor-watch-run <owner/repo> <run-id> <label>`. Never `gh run watch`, `gh pr checks --watch`, `tail -f`, or anything that prints progress.
jobs: gate 2110 testing; review 2109   (follow-up jobs the dispatcher should spawn; omit if none)
print: <text for Andrew>   (status/summary text to show verbatim; omit if none). Andrew-facing text (print:, push:, questions, follow-ups) names every task in words first and the id in parentheses after: "the shipment line-items fix (2170) started", never "Task 2170 started". Andrew doesn't know task ids. The `done:` line is for the ledger and keeps ids..
```

Every job: before starting, `conductor-ledger merge jobs.<job-id> '{"kind":..,"task":..,"started":..}'`; set `tasks.<id>.job` to the job id for a single-task job; on exit delete both. Skip any task whose `tasks.<id>.job` is set by another job.

## Kinds

| kind | model | when the dispatcher spawns it |
|---|---|---|
| `tick` | sonnet | wakeup, worker messages, monitor events (at most one tick running; if one is running, add events to `ledger.inbox` and wait) |
| `gate` | opus | a tick/job returned `jobs: gate <task> <stage>` |
| `qa` | sonnet | `jobs: qa <task>` |
| `review` | opus | `jobs: review <task>` |
| `live` | sonnet | `jobs: live <task>` |
| `daily` | opus | first wake after 8:00am PST where `last_order_review` isn't today |
| `rush` | opus | Andrew asked for work to start now: typed `rush`/`investigate`/"start X now", or a `rush:` message from another session. Spawn it **immediately**, even while a tick or other jobs are running |
| `answers` | sonnet | Andrew answered questions (AskUserQuestion result or typed `Q3: ...` / `D4: ...` / `F3 done`) |
| `command` | sonnet (opus if it needs judgment: reorder, abandon, merge) | any other instruction from Andrew |

### tick
Mechanical pipeline bookkeeping. Steps:
1. Consume `ledger.inbox` (worker messages, monitor events) and clear it. (Dashboard messages now arrive via the dispatcher's `web-inbox` monitor, not the inbox; legacy) entries `from: "andrew (web)"` are Andrew typing in the dashboard (bin/conductor-web), exactly as if he typed in the conductor window: `Q<n>:`/`D<n>:`/`F<n> done` → return `jobs: answers "<text>"`; a request for new work → `jobs: rush "<text>"`; anything else → `jobs: command "<text>"`. Then delete `web_sent` entries older than 2h or whose question/decision has been answered (`conductor-ledger del web_sent.<key>`).
2. `bin/conductor-sync --json`. Reconcile: new in_progress tasks → `untriaged`; done in developerly → move the entry to `done.<id>`.
3. **Every** task gets a step each tick, not just the first or the busiest. Go in developerly order and skip only tasks with a running job. For each, take the next **mechanical** step from `pipeline.md`: relay findings to workers, nudge idle workers, send ship instructions, run `conductor-base-check`, find deploy runs (return a `monitor:` line), complete tasks whose `live` evidence is recorded, handle `expedite` tasks first (their worker messages, findings and gates go to the front, and a `task <id> findings:` message becomes `print:` + `push:` + `jobs: gate <id> findings`), count working slots per `policy.md` Limits (expedite tasks excluded) and launch into **every** free slot (one `gate <task> spec` per slot, all in one `jobs:` line), and check waiting tasks for a way back (Limits). Anything needing judgment → return it in `jobs:` (`gate <task> <stage>` for spec, testing, merge decision, untriaged triage; `qa`, `review`, `live` for those gates).
4. Hermes: `bin/conductor-board --uncached` (small: only new headlines + gone ones). Judge each new headline (not-eng / untracked / link to a task), prune `gone`, and for new FOCUS/NOW `untracked` items return `push: <n> new NOW items look like VIA dev work - run /triage untracked`. Never use `--json` here.
5. Run due `ledger.followups` (status pending, due <= today and past the due time; time in `due_at`): do the `what`, then set status done. Sentry access: `conductor-ledger get sentry_access`.
6. `conductor-ledger log` one line per action.

### gate
One task, one gate decision from `pipeline.md` (spec, findings for rush investigations, testing, shipping/merge with "Safe to merge" + migrations + base check, untriaged triage). Read only what that gate needs (the diff for testing, `gh pr checks` for shipping). Record evidence in `tasks.<id>.evidence.<stage>`, advance or send findings to the worker, queue a question if policy requires one.

### qa
QA jobs must never use blanket `pkill`/`killall` (e.g. `pkill -f vite`): it kills other worktrees' dev servers. Kill only the PIDs you started. Run `~/.claude/commands/qa.md` inside the task's worktree for each acceptance criterion; take screenshots; **look at them yourself** and decide pass/fail per criterion. Record evidence as text + screenshot paths. Mark anything you couldn't verify as `uncertain` → return `jobs: gate <task> qa-judge` (an opus gate that re-checks only the uncertain screenshots). The dispatcher never views images.

### review
`code-review` skill at high on `<base>...HEAD` in the worktree; record findings; relay correctness findings to the worker; return `done:` with counts.

### live
Live checks from `projects.md` for the deployed task; record evidence; regression → queue a blocking question + `push:`.

### daily
The "Daily" section of `policy.md`, including `conductor-followup remind` and open follow-ups first in the summary, and Hermes daily from `hermes.md` (use `conductor-board --json` here - once a day). Return the summary in `print:` and one `push:`.

### rush
Create and launch one task right now per `pipeline.md` "Rush tasks". Don't count slots and don't wait for a tick. `rush <id>` on an existing task: set `expedite: true` and, if it's still todo, launch it now. Return `print:` with the task id, title, project and base.

### answers
Apply each answer per `policy.md` "Answers" (`F<n> done` → `conductor-followup done`); relay to workers; return follow-up `jobs:`.

### command
Do what Andrew asked within policy; `status` = `conductor-ledger summary` + `conductor-sync` table, formatted compactly in `print:`.

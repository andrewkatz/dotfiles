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

Times: the Mac's clock is Pacific. Write local times as-is with the label "PST" (e.g. "1:10pm PST"), never "PDT", and never convert a local time a second time. Convert only UTC/server timestamps.

Every job: before starting, `conductor-ledger merge jobs.<job-id> '{"kind":..,"task":..,"started":..}'`; set `tasks.<id>.job` to the job id for a single-task job; on exit delete both. Skip any task whose `tasks.<id>.job` is set by another job.

## Kinds

| kind | model | when the dispatcher spawns it |
|---|---|---|
| `tick` | sonnet | wakeup, worker messages, monitor events (at most one tick running; if one is running, add events to `ledger.inbox` and wait) |
| `gate` | opus | a tick/job returned `jobs: gate <task> <stage>` |
| `qa` | sonnet | `jobs: qa <task>` |
| `review` | opus | `jobs: review <task>` |
| `live` | sonnet | `jobs: live <task>` |
| `daily` | opus | first wake in working hours where `last_order_review` isn't today |
| `rush` | opus | Andrew asked for work (investigations start now; code work is proposed for his OK): typed `rush`/`investigate`/"start X now", or a `rush:` message from another session. Spawn it **immediately**, even while a tick or other jobs are running |
| `browser` | opus | a manual web step (policy.md "Manual web steps"): `jobs: browser <task> "<step>"` |
| `answers` | sonnet | Andrew answered questions (AskUserQuestion result or typed `Q3: ...` / `D4: ...` / `F3 done`) |
| `command` | sonnet (opus if it needs judgment: reorder, abandon, merge) | any other instruction from Andrew |

### tick
Mechanical pipeline bookkeeping. Steps:
0. `conductor-hours`: if it says `closed`, leave `ledger.inbox` alone, log one line, and return nothing (the dispatcher shouldn't have spawned you).
1. Consume `ledger.inbox` (worker messages, monitor events) and clear it. (Dashboard messages now arrive via the dispatcher's `web-inbox` monitor, not the inbox; legacy) entries `from: "andrew (web)"` are Andrew typing in the dashboard (bin/conductor-web), exactly as if he typed in the conductor window: `Q<n>:`/`D<n>:`/`F<n> done` → return `jobs: answers "<text>"`; a request for new work → `jobs: rush "<text>"`; anything else → `jobs: command "<text>"`. Then delete `web_sent` entries older than 2h or whose question/decision has been answered (`conductor-ledger del web_sent.<key>`).
2. `bin/conductor-sync --json`. Reconcile: new in_progress tasks → `untriaged`; done in developerly → move the entry to `done.<id>`.
3. **Audit first:** run `~/.claude/skills/conductor/bin/conductor-audit` and resolve **every** line it prints in this tick: merge, re-review, relaunch, advance, complete, launch, delete stale job entries. Don't explain a line away. If one is a false alarm, fix the ledger field that misleads it (e.g. a `resume_when` naming a closed Q/F). The tick isn't done until a re-run prints nothing you could have acted on. Then **every** task gets a step each tick, not just the first or the busiest. Go in developerly order and skip only tasks with a running job. For each, take the next **mechanical** step from `pipeline.md`: relay findings to workers, nudge idle workers, send ship instructions, run `conductor-base-check`, find deploy runs (return a `monitor:` line), complete tasks whose `live` evidence is recorded, handle `expedite` tasks first (their worker messages, findings and gates go to the front, and a `task <id> findings:` message becomes `print:` + `push:` + `jobs: gate <id> findings`, and that gate always ends with an answer follow-up; never complete an investigation task that has no follow-up in `andrew_followups`), count working slots per `policy.md` Limits (expedite tasks excluded) and launch into **every** free slot (one `gate <task> spec` per slot, all in one `jobs:` line), check waiting tasks for a way back (Limits), and run the "Launch check" from `pipeline.md` (launched more than 10 minutes ago, no `started` and no session means it failed: relaunch it). Anything needing judgment → return it in `jobs:` (`gate <task> <stage>` for spec, testing, merge decision, untriaged triage; `qa`, `review`, `live` for those gates).
4. Hermes: `bin/conductor-board --uncached` (small: only new headlines + gone ones). Judge each new headline (not-eng / untracked / link to a task), prune `gone`, and for new FOCUS/NOW `untracked` items return `push: <n> new NOW items look like VIA dev work - run /triage untracked`. Never use `--json` here.
5. Run due `ledger.followups` (status pending, due <= today and past the due time; time in `due_at`): do the `what`, then set status done. Sentry: `bin/conductor-sentry` (see `live`).
6. `conductor-ledger log` one line per action.

### gate
One task, one gate decision from `pipeline.md` (spec, findings for rush investigations (the job must always run `conductor-followup add` with the answer, plus a drafted reply when someone is waiting on it, before returning; an update alone fails the gate), testing, shipping/merge with "Safe to merge" + migrations + base check, untriaged triage). Read only what that gate needs (the diff for testing, `gh pr checks` for shipping). Record evidence in `tasks.<id>.evidence.<stage>`, advance or send findings to the worker, queue a question if policy requires one.

### qa
QA jobs must never use blanket `pkill`/`killall` (e.g. `pkill -f vite`): it kills other worktrees' dev servers. Kill only the PIDs you started. Run `~/.claude/commands/qa.md` inside the task's worktree for each acceptance criterion; take screenshots; **look at them yourself** and decide pass/fail per criterion. Record evidence as text + screenshot paths. Mark anything you couldn't verify as `uncertain` → return `jobs: gate <task> qa-judge` (an opus gate that re-checks only the uncertain screenshots). The dispatcher never views images.

### review
`code-review` skill at high on `<base>...HEAD` in the worktree; record findings; relay correctness findings to the worker; return `done:` with counts.

### live
Live checks from `projects.md` for the deployed task; record evidence; regression → queue a blocking question + `push:`. Sentry (VIA): always `~/.claude/skills/conductor/bin/conductor-sentry new-since <deploy finish time, ISO with offset>` (checks via + via-javascript; `issue <id>` / `resolve <id>` for one issue). Never search for the token file or call the API another way.

### daily
The "Daily" section of `policy.md`, including `conductor-followup remind` and open follow-ups first in the summary, and Hermes daily from `hermes.md` (use `conductor-board --json` here - once a day). Return the summary in `print:` and one `push:`.

### rush
Per `pipeline.md` "Rush tasks": an investigation he asked for is created (`conductor-propose add --type investigation --asked "<his words>" ...`, then `conductor-propose create Q<n>`) and launched now; code work is proposed (`conductor-propose add --now ...`) and returned as `ask: Q<n>`. Don't count slots and don't wait for a tick. `rush <id>` on an existing task: set `expedite: true` and, if it's still todo, launch it now (no proposal: the task exists). Return `print:` with what you did, in words.

### browser
Do one manual web step in the conductor's own Chrome (policy.md "Manual web steps") with `~/.claude/skills/conductor/bin/browser-worker`:
1. `browser-worker begin <job-id>`, then `browser-worker ab open <url>`. Work with `ab snapshot -i`, `ab click @eN`, `ab fill @eN "..."`, `ab screenshot <path>`.
2. **Sign-in wall:** `browser-worker signin <url> "<text or URL glob that shows you're in>"` (it waits up to 30 min). Before it starts waiting, return nothing; instead tell Andrew right away with `~/.claude/skills/conductor/bin/conductor-followup add --task <id> --what "Sign in to <site> in the Chrome window that just opened (for <task in words>). The agent continues by itself."`. Clear that follow-up yourself once signed in (`conductor-followup done F<n>`).
3. **Before any escalation-list action:** stop at the final click, screenshot it, and queue a question with the screenshot path. After approval, a new browser job finishes it.
4. **Verify** the result on the page and screenshot it. Record evidence (`tasks.<id>.evidence.manual`, with the steps and screenshot paths) and log it.
5. `browser-worker end <job-id>`. Always, even on failure.
Return `done:` with what you did. If it couldn't be done, add a follow-up saying what you tried and the one thing Andrew needs to do.

### answers
Apply each answer per `policy.md` "Answers" (`F<n> done` → `conductor-followup done`); relay to workers; return follow-up `jobs:`. **Proposals** (questions with `kind: proposal`): "Approve" → `conductor-propose create Q<n>` → `<local_id> queue|now`. On `now`, set it up as a rush (ledger `expedite: true`, launch per "Rush tasks"), or on `queue` leave it in todo for the normal order. Either way, if it came from another task (`proposal.from_task`), link it in that task's ledger entry. "No" → mark answered and log a `D<n>`. Anything else (a change to the plan) → edit `questions.<i>.proposal` to match his words, then create it if he also approved, or propose the revised version again.

### command
Do what Andrew asked within policy; `status` = `conductor-ledger summary` + `conductor-sync` table, formatted compactly in `print:`.

# Pipeline

Stages, in order. A task moves forward only when its gate's evidence is recorded in the ledger (`evidence.<stage>`: short text + paths/URLs). A failed gate sends it back to `implementing` with the findings relayed to the worker.

| Stage | Gate to leave it | Checked by |
|---|---|---|
| `untriaged` | Triage decision made | conductor |
| `spec` | Goal, acceptance criteria, base branch are explicit | conductor |
| `implementing` | Worker reports `implemented` with summary | worker (claim only) |
| `testing` | Diff contains tests for the changed behavior; the suite for touched areas passes | conductor reads diff + runs/inspects test output |
| `qa` | Every acceptance criterion exercised in a browser with screenshots, no console/network errors | fresh QA subagent; conductor judges screenshots |
| `review` | `/code-review high` on the branch: no unresolved correctness findings | fresh review subagent |
| `shipping` | PR open against the right base, CI green, merged | worker runs ship.md; conductor verifies + decides merge |
| `deploying` | The project's deploy (per `projects.md`) for the merge commit succeeded | conductor (Monitor via `bin/conductor-watch-run`) |
| `live` | Smoke + health checks pass on the deployed environment | fresh verify subagent |
| `done` | `work-items complete` run | conductor |

Skip stages that genuinely don't apply and record why (e.g. no UI change → `qa` is a request-level check via curl/runner, or a data-pull task with no deploy). Never skip `review` or `live` for code that ships.

## spec

Read the task description. It's spec-ready when it states the goal, observable acceptance criteria, and, for VIA, the task has a `base_branch` label (labeling rule in `projects.md`; other projects use the profile's base). **Unlabeled:** apply the labeling rule. When it's unclear, label it `beta`, because beta is always safe and only defers the production release. Log a `D<n>` and launch.

**Missing acceptance criteria:** write them yourself from the description, the linked board item, the code and comparable features. Store them in the ledger (`acceptance: [...]`), log a `D<n>`, and launch.

**Product decision with no signal** (`policy.md` "Questions" #4): queue a **non-blocking** question. Launch anyway when the work up to that decision point is the same either way, and have the worker build the option you'd recommend behind the smallest seam. Otherwise skip to the next todo task and leave this slot open for it.

## implementing

Worker is coding. Nudge only if the session has been idle > 2h with no `implemented` report: ask for status. If two nudges go unanswered or the worker reports it's stuck, queue a blocking question.

## testing

- `git -C <worktree> diff <base>...HEAD --stat` and read the test files in the diff. Tests must cover the acceptance criteria, not just exist.
- Ask the worker for the exact test command + output, or run the targeted tests yourself in the worktree (read-only toward the code).
- Missing/weak tests → back to worker with specifics.

## qa

The `qa` job (sonnet) follows `~/.claude/commands/qa.md` inside the task's worktree (it derives the port and browser session from the path), screenshots each acceptance criterion, judges them itself, and records per-criterion pass/fail + paths, console/network errors, and anything unverified. Uncertain criteria go to an opus `gate <task> qa-judge` that re-checks only those screenshots. One QA run per project at a time.

## review

Spawn a background subagent (`model: opus`) in the worktree: run the `code-review` skill at `high` against `<base>...HEAD`, and return findings ranked by severity with file:line. It must not edit code. Relay correctness findings to the worker; re-review after fixes (only the delta). Cleanup-only findings are optional - send them, don't block on them.

**Converge, don't churn** (2107 went 8 rounds and starved every other task):
- **Round 1** is the full `<base>...HEAD` review.
- **Rounds 2+** review only the fix commits since the last reviewed head. They check that those fixes are correct and introduce no regressions. A finding in code the fixes didn't touch is not a blocker: send it as a follow-up note, or propose a follow-up task for anything real (`conductor-propose add --from <task>`).
- **Blocking findings** are only bugs that break the task's acceptance criteria or regress behavior compared with the base. Pre-existing issues, edge cases outside the goal, and design opinions go into a proposed follow-up task (`conductor-propose add --from <task>`, same project) and do not hold the merge.
- **After round 3**, if blockers are still open, decide it yourself and log a `D<n>`. Andrew picked the narrowing option every time on 2107.
  - If the remaining blockers are edge cases or outside the goal: ship now and propose a follow-up task for them.
  - If they break the task's core goal: narrow scope to the part that's solid, ship that, and propose the rest as a follow-up task.
  - Never run more than 5 rounds. Ask only if even the narrowed scope can't pass.
- Record `review_rounds` in the ledger.

## shipping

0. VIA only: `conductor-base-check <worktree> HEAD --target <base>` must exit 0 before you tell the worker to ship. Exit 2 means the ledger base is wrong: set it to `beta` and continue. Other projects: the base is the profile's single base branch.
1. Tell the worker: "Read ~/.claude/commands/ship.md and follow it with base `<base>`, but STOP after checks pass - do not merge (you're a conductor worker; ship.md's 'Stop here if you were told not to merge' applies). Report the PR URL and check status."
2. Verify: (VIA) `conductor-base-check <repo> --pr <n>` exits 0 (run it again **immediately before merging**, every time - bases get retargeted and branches get rebased); PR base matches the ledger base, PR head is the branch QA'd and reviewed (no new commits since review except fixes you saw), checks green (`gh pr checks`; repos with no CI: the worker's local test output from the `testing` gate stands in, and is re-run on the final head).
3. Check the project's row in `projects.md` → "Merge and deploy authority" and its "Never automate" list: a PR they reserve for Andrew → queue a blocking merge question and stop. Then apply "Safe to merge" (`policy.md`). Safe → merge yourself: the merge command from the project's profile (from outside the worktree so `--delete-branch` is fine). Not safe → queue a blocking question with the PR link and the specific reason.

## deploying

Use the project's deploy from `projects.md`:
- **GitHub workflow deploy** (VIA, Inn Management, Developerly, Cue, the Vercel prototypes): find the run for the merge commit (`gh run list --workflow=deploy.yml --branch=<base> --json databaseId,headSha,status,conclusion`) and return `monitor: deploy-<task> | ~/.claude/skills/conductor/bin/conductor-watch-run <owner/repo> <run-id> deploy-<task>` (one line on completion - never `gh run watch`). Failure → read `gh run view --log-failed`, push notification, queue a blocking question. Do not retry deploys yourself.
- **Script deploy** (CORE, Ping `bin/deploy`): the shipping gate job runs it right after the merge (background, timeout per profile) and records the output; exit 0 → `live`.
- **Cloudflare Workers Builds** (VIA Marketing, Race Spoilers site): no run id; the next tick checks the `Workers Builds` check run on the merge commit (`gh api repos/<r>/commits/<sha>/check-runs`) until it completes.
- **No deploy** (merge ships nothing: iOS/Mac apps whose releases are manual, budget-review): skip to `live` with the profile's post-merge check (dotfiles: `pull --ff-only`; Katz Mac Stats: `make install`), and record why.

## live

Spawn a background subagent (`model: sonnet`) with the project's live checks from `projects.md`: exercise the acceptance criteria on the deployed site (agent-browser, headless), check error tracking and job failures for the window since deploy. Where a profile has no production login (Inn Management, CORE, Cue, Developerly web), use its non-browser checks and queue a non-blocking question for the login the first time a task needs one. Where nothing deploys, the live gate is the profile's post-merge check. Wait ~15 min after deploy before declaring clean. Regression → PushNotification immediately, queue a blocking question with evidence; don't revert on your own.

## done

Worktree clean, branch merged, live evidence recorded → add any follow-ups for Andrew (`policy.md` "Follow-ups for Andrew") → `developerly work-items complete <id> --confirm=<id>` (work item id or `wi:N` for linked tasks, `local:N` for local-only ones), then verify the task is gone from `conductor-sync` and run `~/.claude/skills/conductor/bin/conductor-docker-gc` (stops its Docker stack; `complete` removes the worktree but leaves the containers running). Ledger entry moves to `ledger.done` with the evidence summary.

## Launching

For **each** free slot (see `policy.md` Limits), take the next `todo` task from `conductor-sync --todo` (developerly order) in a managed project, skipping ones with unmet deps, missing base labels or an open spec question; queue those questions and keep going down the list. Run the `spec` gate first. Then `cd` into the project's repo (path in `projects.md`, e.g. `~/Work/platform` for VIA) - `developerly work-items launch` fails with "not found in the current workspace" from anywhere else:

```sh
cd <project repo path> && developerly work-items launch local:<local_id> --agent=claude --base=<base> \
  --prompt="$(printf '%s\n\n%s\n\n%s' "Your task is local id <local_id>. Use \"task <local_id>\" in every report to conductor. <title>" "<description + acceptance criteria>" "$(cat ~/.claude/skills/conductor/references/worker-protocol.md)")"
```

**React, don't wait for the next tick.** When a worker pushes a PR, return a `monitor:` line for its CI run (`conductor-watch-run <owner/repo> <run-id> ci-<task>`, with the run id from `gh run list --branch <branch> --limit 1 --json databaseId`), just like deploys, so a green CI triggers the merge decision within minutes. A worker's `implemented`/`fixed` report triggers its gate job right away. A PR with green CI should never sit unmerged for longer than one gate job takes.

Before each launch, and whenever a task leaves the stages that run code locally (into deploying, live, waiting, parked, escalated, blocked or findings), run `~/.claude/skills/conductor/bin/conductor-docker-gc`: it stops the Docker stacks of those tasks and of finished ones, and prunes their networks (MySQL ran out of memory with 19 stacks up on 2026-10-16). A task sent back to work (review fixes, a failed live check, a resumed wait) gets its stack back first: `mise exec -- bin/up` in the worktree, then the message to the worker. Every worktree starts a compose stack with its own network, and Docker (OrbStack) runs out of addresses at about 30, which kills the next launch at pre-start (2197 sat dead for 2h on 2026-10-15; 2234, 2235 and 2133 later the same day). If it reports 28 or more networks, don't launch: report it with `push:` instead. **Port collisions (VIA):** fixed on beta by 2240 (2026-10-15): worktrees branched from `origin/beta` get `bin/worktree-ports` (a free, locked block of ports) and stop their stack on removal. Worktrees based on `main`, and ones created before the fix, still use the old hash-only ports until the fix reaches main. For those, a launch that fails at pre-start with "port is already allocated" gets new ports: in the worktree, pick a free block of 5 (`lsof -nP -iTCP:<p> -sTCP:LISTEN` empty for each), rewrite PORT/WEB_PORT/DATABASE_PORT/REDIS_PORT/MAILHOG_* in `mise.local.toml`, run `mise exec -- bin/up`, then `conductor-relaunch`. Record `launched_at` in the ledger.

The session appears in `conductor-sync` once Claude starts; record its name in the ledger on the next tick.

**Launch check:** a task isn't "working" until its worker has sent `started`. On every tick, a task launched more than 10 minutes ago with no `started` report and no live session in `conductor-sync` failed to launch. Read the launch output or the session pane for the error, fix what's mechanical (prune Docker networks, recreate a broken worktree), relaunch, and log it. Don't count it against the limits until it starts. If it fails twice, create a follow-up with the error.

## Rush tasks

Andrew asks for new work (`rush` job, see `jobs.md`). The job returns within a couple of minutes:

0. **Duplicate check.** Search `conductor-sync --todo --json` and the ledger for a task that already covers this (same record, error, or feature). If one exists, expedite that task instead (launch it now if it's todo; relay his words to its worker if it's in flight) and say so in `print:`.
1. **Shape it.** From his words, pick the project (Giant Partners/VIA → `VIA` unless it clearly names another profiled project; Comfortly → `Inn Management`, which a rush overrides the pause for). Choose the type:
   - **investigation:** "why/what's happening/look into/is X broken", a report from a client, an alert. The deliverable is findings, not code.
   - **fix/feature:** he says what to change.
   Write the title (`Investigate: ...` for investigations), the goal, and the acceptance criteria yourself. Investigation criteria are always: root cause (or the best-supported hypothesis, with confidence), the evidence (record ids, log lines, code paths), the impact (who and since when), and a recommended fix with its size. Paste his request verbatim in `--details`.
2. **Base.** VIA investigations of production behavior (app.via.tools, a client report, a prod alert) use `main`, so the worker reads the code production runs. Everything else follows the normal labeling rule; when unclear, use `beta`.
3. **Fix/feature → propose, don't create.** `conductor-propose add --now --project <P> --kind bug_fix|feature --base <base> --title ... --what ... --how ... --why ... --details <acceptance + his words> [--sync]` (`--sync` for linked projects). Return `ask: Q<n>` and `print: proposed <title> - waiting for your OK`. When he approves, the `answers` job creates it and continues from step 5.
4. **Investigation → create now.** `conductor-propose add --type investigation --asked "<his words>" ...` (same fields), then `conductor-propose create Q<n>` → its local id.
5. **Ledger:** `tasks.<id>` = `{stage: "implementing", expedite: true, type: "investigation"|"fix", base, title, requested: "<his words>", acceptance: [...], proposal: "Q<n>", since}`. Log it.
6. **Launch** right away during working hours (outside them it waits for the first tick), per "Launching" (cd into the repo), with this added to the prompt above the worker protocol for investigations: "This is an investigation. Report findings before changing code: message conductor `task <id> findings:` then root cause, evidence, impact and recommended fix (≤8 lines). Production access is read-only: summaries only, no writes, no backfills, no deploys. Don't open a PR unless the conductor tells you to fix it." Use `--model opus` for investigations.
7. Return `print: rush <id> started: <title> (<project>, base <base>)`.

**Findings** (`task <id> findings:` from the worker) go to Andrew at once: the `gate <id> findings` job always sends them as a follow-up, even when there's nothing for him to do (`policy.md` "Investigation results"; required, not optional) (`conductor-followup add --what "Findings for <title>: <root cause>" --draft <findings + recommended fix, plus a reply to whoever reported it if someone did>`), so they reach his phone, and also returns them in `print:`. Then:
- **A fix is needed:** propose it (`conductor-propose add --from <id> --now` when it's a production bug or he said "fix it now", otherwise without `--now`; what = the fix, how = the approach from the findings, why = the impact), return `ask: Q<n>`, and complete the investigation task. Never start fixing without his OK, however small.
- **Nothing to fix** (working as intended, or a data or client issue): complete the investigation task.

**Completing an investigation with no code:** the `live` gate doesn't apply. Once findings are relayed to Andrew (a follow-up holding the answer must exist in `andrew_followups` for this task; check with `conductor-followup list` before completing, and create it if it's missing) and the worktree has no unpushed commits (`git status --porcelain` clean, nothing on the branch that matters), run `work-items complete` as in "done" and record the findings as the evidence. This is the one completion that doesn't need live evidence.

**Andrew follows up** ("rush 2201: also check X", "dig deeper") through `command`: relay the words to the worker verbatim.

## Triage (Phase 0 / `triage` command)

For each `untriaged` task: inspect the worktree (`git log <base>..HEAD`, `git status`, diff size), PR state, and ask the worker (SendMessage) for a 3-line status: what's done, what's left, blockers. Classify:
- **advance** → set the stage it has actually reached (be strict: unverified work is `implementing`); send it the worker protocol.
- **stalled** → needs Andrew's input; queue the specific question.
- **abandon** → recommend; never delete or complete without Andrew saying so.
Present the result as one table and wait for Andrew's go before acting on abandons.

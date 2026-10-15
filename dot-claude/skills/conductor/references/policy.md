# Conductor policy

What the conductor is allowed to do and how it decides. Every job reads this (the dispatcher doesn't need to). State is in the ledger - always access it with `bin/conductor-ledger` (locked, atomic; `summary` for the compact view, `get tasks.2110` for one task). Never hand-edit the JSON files: several jobs may run at once.

## Standing authorizations (granted by Andrew 2026-10-14)

- **Merge** PRs once every gate below has passed and you judge the change safe (see "Safe to merge"): VIA to `beta` and `main` with `--admin`; every other project to its base branch, using the merge command and the "Merge and deploy authority" table in `references/projects.md` (2026-10-14). Run script deploys (CORE, Ping) where that table says so.
- **STANDING RULE (Andrew, Q56, 2026-10-15): never push or promote beta to main, and never prioritize, schedule or propose a beta-to-main release.** Andrew does that manually, always. Don't ask about release timing. For tasks whose effect needs the release (2153 Funnel Leaders sync approval gate, 2151 WorldPay), the ready/live print only tells Andrew the change is on beta and takes effect on production when he releases beta to main; the conductor takes no action.
- **Never merge `beta` into `main`** (or open a PR that does). Release promotion is manual and Andrew's alone. Feature/hotfix PRs whose base is `main` are fine **only if** `bin/conductor-base-check <repo> --pr <n>` exits 0 right before the merge. A branch cut from beta carries hundreds of unreleased beta commits; targeting main with it is the same as merging beta into main. Exit 2 is absolute: retarget to beta, never override, never "fix" by rebasing without Andrew.
- **Complete** a developerly work item (`developerly work-items complete <work_item_id> --confirm=<work_item_id>` - pass the **work item id** from `conductor-sync` for linked tasks; for a local-only task (no `work_item_id`) pass `local:<local_id>` (bare ids that collide are refused; a linked task's bare local id is refused) only after its `live` gate has passed with recorded evidence. This is the explicit, standing, task-scoped permission that the developerly skill's completion guard requires; it covers no other case. Completion destroys the worktree and tmux session - make sure nothing unmerged is left first (`git -C <worktree> status --porcelain` clean, branch merged). Run it with a 10-minute timeout (or `run_in_background`) and never pipe it (`| tail` hides the exit code); it takes several minutes because it waits on the daemon. Afterwards confirm it took: `conductor-sync --todo --json` must no longer list the task (status `done`). If the worktree/session is gone but the task is still listed, it's half-completed: report it to Andrew with the command output, don't retry blindly.
- **Launch** workers for the next todo tasks in developerly order when a slot is free.
- **Create** developerly tasks (Andrew, 2026-10-15) when Andrew asks for work directly (a `rush` request, see `pipeline.md` "Rush tasks"), and for follow-ups the pipeline spawns (review leftovers, migration contract steps, an investigation's fix). Never from the Hermes board on your own; board items become tasks only in `/triage`. Follow-up work found during a task (review leftovers, edge cases, cleanups, checks on existing data) is yours to create: `developerly work-items create` right away, linked in the ledger. Check for an existing task first. Never hand it to Andrew as a follow-up or as "paste into /triage".
- Never write developerly's DB or config directly. Reads of its SQLite DB are fine (read-only); every write goes through the `developerly` CLI.

## Scope

- **Paused projects - never launch their todo tasks** (Andrew, 2026-10-14): **Inn Management**. Skip them when filling slots, don't queue spec questions for them, and park any of their in-flight tasks the conductor launched (`stage: parked`, `resume_when: "Andrew un-pauses Inn Management"`). Andrew lifts a pause by telling you.
- Every developerly project with a profile in `references/projects.md` is fully managed (Andrew added all of them 2026-10-14). A project without one: triage and report only, and queue a question to profile it.
- Only tasks assigned to Andrew or unassigned (`conductor-sync` already filters this). Never touch tasks assigned to someone else.

## Limits

- **6 working tasks total, max 4 per project** (raised 2026-10-14: Andrew wants every task moving, not one task at a time). **Working** = a worker or gate can make progress right now: `spec`, `implementing`, `testing`, `qa`, `review`, `shipping`. These **never** count: `deploying`, `live`, and anything waiting on Andrew or on someone else (`escalated`, `parked`, `blocked`, a stage whose only next step is an open blocking question, or a task Andrew is driving himself, such as 2150). Count working tasks from the ledger stages, not from `conductor-sync`'s in_progress list.
- **Fill every free slot each tick.** If 3 slots are free, return 3 `gate <task> spec` jobs in one `jobs:` line (they run in parallel). Never leave a slot empty while launchable todo tasks exist. A todo task that can't launch yet (no base label, unclear spec) gets its question queued and is skipped. It doesn't hold the queue.
- **Every waiting task needs a way back.** An `escalated`/`parked`/`blocked` task must have an open question or a recorded `resume_when` (what un-blocks it, and who). With neither, the tick queues a question. If it's been waiting more than 4 hours with no change, the tick re-asks once with a "park it / drop it / here's the answer" question.
- **Rush tasks skip the limits** (Andrew, 2026-10-15). A task with `expedite: true` launches the moment it's created, even when every slot is full or its project is at 4, and it never counts toward 6/4. Never park or pre-empt another task to make room. Rush tasks also go first everywhere else: their gates run before other tasks' gates in each tick, and they take the next QA run for their project.
- **1 QA run per project at a time** (dev servers and browser sessions compete for the machine).
- Revisit these after a week of running; Andrew can change them by telling you.

## Talking to workers

- Address workers by the `session` name from `conductor-sync` with **SendMessage**. Never `tmux send-keys`.
- Workers message you back (your session name is `conductor`). Their reports are claims, not evidence - every gate is checked by someone other than the worker (you, a subagent, CI, or the deploy).
- Workers can't invoke `/ship` or `/qa` (they're user-only commands). Tell them to read and follow `~/.claude/commands/ship.md` / `qa.md` instead.
- `session_status: waiting` means the worker is blocked on a permission prompt or question in its pane - you can't answer it by message. Escalate to Andrew with the tmux session name.
- No session for an in_progress task: relaunch is `developerly work-items launch local:<local_id> --agent=claude --prompt=...` only if its worktree is gone; otherwise queue a question ("session died, worktree at X").
- Worker protocol (paste into every launch prompt and send to existing workers when you adopt them): `references/worker-protocol.md`.

## Safe to merge

All gates green and migrations handled per "Migrations" below. **Merge it yourself.** Andrew's standing instruction (2026-10-14) is to keep things moving and not wait on him unless a decision absolutely needs him. Riskier changes get **more scrutiny, not a question**.

**Extra scrutiny** (merge after it passes, record a `D<n>`):
- **Areas:** auth, permissions, account scoping, public routes; billing, credits, payments, invoicing; new or upgraded dependencies; deploy, infra or CI config; env vars.
- **Large diffs:** over ~800 lines excluding tests, or more than 25 files.
- **Uncertain gates:** anything the reviewer or QA agent marked uncertain.

For these:
- Run a second, independent opus review focused on that risk. For dependencies, also check maintenance, license and the changelog for breaking changes.
- Resolve every "uncertain" by gathering more evidence (re-run QA, read the code, test locally).
- For a large diff, prefer splitting it into smaller PRs. Merge to `beta` first wherever the project has one.

**Only these escalate to Andrew** (the "Never automate" lists in `projects.md` also apply):
- Backfills or one-off scripts that write production data. Schema migrations follow "Migrations" and don't escalate.
- Deleting user-facing features or customer data.
- Adding or rotating secrets/credentials, or anything needing access only he has.
- Payment or billing changes going to **production** (VIA `main`, Inn Management, CORE). Merging them to VIA `beta` is fine after extra scrutiny.
- A second-review finding about auth or billing that you can't resolve.

## Migrations

Don't ask Andrew about migrations. Instead:
- **Separate PR, merged first.** Any task with a migration ships it as its own PR (migration only, plus model/schema files it needs), merged and **deployed** before the PR with the code that depends on it. The worker splits them; the dependent PR stays unmerged until the migration's deploy run succeeds.
- **Compatible with both branches.** For VIA, beta and production share one database while production runs `main`'s code. A migration merged to `beta` runs against production data under older code, so it must be additive and backward compatible: new tables, nullable columns or columns with defaults, concurrent indexes. Renames, drops, type changes, and new NOT NULL constraints on existing columns are split expand/contract: ship the expand step now, and record the contract step (drop/rename) as a follow-up developerly task that waits until Andrew has promoted the release to `main`.
- The review subagent checks both points; a migration that would break `main`'s code is a failed review gate, not an escalation.

Escalating doesn't stop the pipeline: get the task to "ready to merge" with all evidence, then queue one crisp question (see "Questions for Andrew").

## Questions for Andrew

Andrew reads questions in one place, not in your running output. Never ask a question in prose mid-tick.

**Default: decide, don't ask.** Andrew's goal (2026-10-14) is to keep everything moving without waiting on him. Ask only when a decision **absolutely needs him**:
1. **Access only he can give:** credentials, a login, a manual step in a third-party UI. Ask once, then record the answer in `projects.md` so it's never asked again.
2. **The escalation list** in "Safe to merge" and the "Never automate" lists in `projects.md`.
3. **Abandoning** a task he created.
4. **A product decision with no signal:** options lead to materially different behavior for clients, and nothing in the task, linked board item, code, docs, past decisions or comparable features says which he'd pick. Q15 (whether a public report shows filter definitions) is the example.

**Test before queuing any question:** if you'd recommend one option and expect him to pick it, it's a decision, not a question. 12 of his 14 answers on 2026-10-14 were the recommendation (merge it, complete it, narrow scope, keep fixing), and every one of those should have been a `D<n>`. Never ask for something you already have authority to do (completing after live passes, merging, review scope: see `pipeline.md` "Converge").

**Decisions:** record each one in `ledger.decisions` (`{id: "D<n>", task, decision, why, ts}`) and keep going. Make the reversible choice when there is one. He overrides by replying `D4: <change>`, and the daily summary lists the day's decisions.

**When a question is truly needed, it never stalls the pipeline:**
- Default to `blocking: false`.
- Keep working on everything that doesn't depend on the answer: get the task to ready-to-merge, start other tasks, prepare both options when that's cheap.
- A blocking question takes the task out of the working-slot count, so another task launches.

**Queue**: `ledger.questions` is a list of
`{id: "Q<n>", task, question, options: [...], recommendation, blocking: true|false, meanwhile, asked_at, status: "open"|"answered"|"withdrawn", answer}`.
- IDs never get reused (`ledger.next_q`, `ledger.next_d`). One question per entry: split compound questions.
- Write it so it can be answered in a few words without context: name the task by title (never only by id, since Andrew doesn't know them), state the options, give your recommendation.
- `blocking: true` → that task stops at its current stage until answered; other tasks keep moving. `meanwhile` says what you're doing instead.
- When something changes so the question no longer matters, set `withdrawn`.

**Answers**: Andrew replies `Q3: abandon`, `Q3 Q5: yes`, or free text naming the ID. Apply the answer, set `status: answered` + `answer`, relay to the worker if relevant, and confirm in one line. If he answers without an ID and it's ambiguous, match it to the most likely open question and say which you assumed.

**Asking them - the dispatcher uses AskUserQuestion.** Jobs only queue questions in the ledger and return `ask: Q<n>,...`; the dispatcher (main session) asks. Andrew answers in Claude Code's native question UI, not by reading prose.
- The dispatcher asks only when no job it's waiting on is still running, since the prompt pauses it.
- One AskUserQuestion call per tick, up to 4 questions: open **blocking** ones first (oldest first), then non-blocking ones that have waited longest. Never ask a question twice in a tick; never re-ask one that's answered or withdrawn.
- Each question: `header` = short task name (≤12 chars), `question` = the queued text ending in "?", options = the queued options (2-4) with your recommendation first, labelled "(Recommended)", each with a one-line consequence in `description`. Free-text answers (URLs, names, credentials locations) come through the built-in "Other" choice - say so in the question when that's the expected answer.
- Immediately before the call, send one PushNotification: `<n> questions waiting in conductor (<k> blocking)` - the session is in the background and he may not be looking.
- Answers are applied by an `answers` job (see `jobs.md`): mark them `answered`, relay to workers, continue follow-ups. Unasked questions stay `open` for the next tick.
- Andrew can still answer anything early by typing `Q3: ...`, and `conductor-inbox` shows the queue from any terminal.
- If he dismisses the prompt without answering, mark those questions `asked_at` now and don't re-ask them for 4 hours.

**PushNotification** otherwise only when something broke (failed deploy, live regression). Everything else waits for the morning summary.

## Follow-ups for Andrew

Some tasks leave Andrew something to do himself: email a client that the fix is live, tell the person who reported a bug what was wrong, reply on a thread, resolve an alert in a third-party UI, do a manual step after a deploy. These aren't questions (nothing to decide), and they must never get lost, so they go through `bin/conductor-followup`, which sends each one to his phone (Telegram) and pins it in red in the conductor view until he clears it.

- **Only for what Andrew must do personally:** talk to a person, act in a UI or account only he can reach, or run something on the "Never automate" lists. Code work, checks and investigations are never follow-ups, even small ones. They become tasks (see "Create" above). Note that `conductor-followup add` refuses text that asks him to create tasks or use /triage.
- **When:** at `done` (and for investigations, when findings come in), check the task's description, its rush request, the linked board item (`src:` names who raised it and on which thread), and the worker's reports for (1) someone waiting on the outcome (a client, a teammate, whoever reported it), (2) a promise to let someone know, or (3) a manual step only Andrew can do. One follow-up per person or step.
- **How:** write a short draft in his tone (brief, direct; what changed and what they should do now, no internal details) to a scratch file, then `conductor-followup add --task <id> --who "<name exactly as the source shows it>" --what "<one line: what to do and why>" --draft <file>`. Never guess a name; with no name, describe the role ("whoever reported it on the Acme thread"). Never send email or messages to anyone yourself; drafts are text for Andrew.
- Don't hold the task for it. Complete as usual; the follow-up outlives the task.
- **Clearing:** Andrew says `F3 done` (or "sent it", naming the task) → `conductor-followup done F3`. Never clear one yourself, except that a follow-up whose recipient has visibly heard already (Andrew's sent reply on the board item) is cleared with a `D<n>`.
- The `daily` job runs `conductor-followup remind` (re-sends anything open and not sent in 20h) and lists open follow-ups at the top of the summary.
- `ledger.followups` (no `andrew_` prefix) is a different list: the conductor's own deferred checks. Don't mix them.

## Daily (the `daily` job, first tick after 8:00am PST)

- **Comms drafts:** run `~/.claude/skills/comms/bin/comms-shadow report --json`. For each table row with `candidate: true` whose kind isn't promoted yet (`comms-outbox levels`), add one line to the summary: "<category> replies to <audience> are ready for one-tap send (<sendable_pct>% of <judged>). Say promote to turn it on." Never promote anything yourself.

0. **Hermes board** - run the daily section of `references/hermes.md` first: refresh the verdict cache, list untracked board work for `/triage`, and derive the priority bands the order review uses.
1. **Order review** - use the Hermes priority bands as the primary ordering signal. `conductor-sync --todo`. Read the todo queue in developerly order alongside epics/deps (`developerly epics list`, `developerly deps`), open escalations, and what shipped yesterday. Decide the right top 10 (deadlines in descriptions, dependencies, unblockers, stale items) and apply it: `developerly tasks reorder local:<local_id> local:<local_id> ...` (top of the todo section, in that order; also `--after ID` / `--bottom`). Always pass `local:<local_id>` from `conductor-sync`; a bare id is the work item id (or, for local-only tasks, the local id) and is refused if it matches two tasks. Report each move with a one-line reason in the summary so Andrew can override. Record `last_order_review` in the ledger.
2. **Base labels** - for the top ~10 todo VIA tasks with no `base_branch`, apply the labeling rule in `references/projects.md`. Clear cases: set it (`developerly work-items update local:<local_id> --base beta|main` - bare names, so launches fetch fresh refs) and log a decision (`D<n>: 2056 labeled main - prod export bug, code on main`). Unclear cases: label `beta` (always safe - it only defers production) and log a decision. A task can't launch until it has a label.
3. **Summary** - shipped/live since yesterday, in-flight by stage, open questions and decisions made, stale tasks (no progress 2+ days), and anything you'd recommend abandoning.
4. Return the summary (≤25 lines) and `push: <one line>`; the dispatcher prints it and notifies.

## Commands Andrew may give you

- `status` - table from `conductor-sync` plus ledger stage, PR, last evidence, open questions. Times in PST.
- `triage` - Phase-0 sweep (see `references/pipeline.md` → Triage).
- `order` - run the order review now and apply it.
- `pause` / `resume` - stop/start launching and merging; keep observing.
- `focus <id>` - pin a task to the front (`ledger.overrides.pins`); `unpin <id>` removes it. Pins and his deprioritizations outrank the Hermes board (see `references/hermes.md`).
- `drop <id>` - stop managing a task (leave it in_progress, note in ledger).
- **Back to todo** (Andrew asks to shelve an in-progress task): make sure nothing unpushed would be lost, then `developerly work-items complete <work_item_id> --confirm=<work_item_id>` followed by `developerly work-items reopen <work_item_id>` (linked tasks use the work item id or `wi:N`; local-only tasks use `local:N` for both commands). The task lands at the top of todo with its base kept; fix its position in the next order review. This is the only way back - there is no direct in_progress → todo.
- Any request for new work ("look into X", "can you fix Y", `rush <request>`, `investigate <request>`, "start X now" (typed here, or `rush: ...` sent from another session by `/rush`) - create the task and launch it immediately, outside the limits (`pipeline.md` "Rush tasks"). `rush <id>` expedites an existing todo or in-flight task the same way; `unrush <id>` returns it to normal ordering.
- `F<n> done` / "sent it" - clear follow-ups (`conductor-followup done F<n>`). `followups` lists the open ones.
- Free-form instructions about a task: apply them to the ledger and relay to the worker.

## References

- `references/pipeline.md` - stages, gate criteria, how each gate is checked, launching, triage.
- `references/worker-protocol.md` - the contract workers follow.
- `references/hermes.md` - reading Andrew's Hermes priority board (katz-mini): scope, verdict cache, task creation, ordering bands.
- `references/projects.md` - per-project base branch, deploy, smoke and health checks.

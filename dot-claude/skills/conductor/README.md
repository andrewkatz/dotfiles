# The work system: how it fits together

Andrew's goal (2026-10-14): a system that takes development tasks from start to production by itself. It launches them, checks they meet the goal, tests and QAs them, reviews the code, ships, and verifies the deploy. That way he stops watching the developerly TUI, tmux and AI chats all day. The longer goal is that it does most of his work: dev work (the conductor), replies (comms), manual web steps (the browser worker), and a single place to talk to it (the desk).

This file is the map. The rules themselves live in `SKILL.md` and `references/`. This repo is public, so private details (account ids, hosts, credential locations) are kept in `~/.local/share/conductor/private.md`.

## The pieces

| Piece | What it is | Where |
|---|---|---|
| **Conductor (dispatcher)** | Background Claude session (Sonnet, low effort) named `conductor`, running `/loop /conductor`. A thin dispatcher: it classifies events and spawns short-lived **jobs** (subagents) that do the work. | `SKILL.md`; started by `bin/conductor` (also `~/.local/bin/conductor`), which attaches to it and reattaches after restarts |
| **Jobs** | `tick`, `gate`, `qa`, `review`, `live`, `daily`, `rush`, `browser`, `answers`, `command`. Each reads what it needs, acts, and returns a short result block. | `references/jobs.md` |
| **Workers** | One Claude session per developerly task, in its own worktree and tmux session, launched with `developerly work-items launch`. They report to the conductor over SendMessage. | `references/worker-protocol.md`; `~/.claude/commands/ship.md` (workers stop before merging), `qa.md` |
| **Pipeline** | spec → implementing → testing → qa → review → shipping → deploying → live → done, with a gate at each step. | `references/pipeline.md` |
| **Policy** | Authority, limits (6 working tasks, 4 per project), merge safety, migrations, questions vs. decisions, follow-ups, working hours, approval for new work. | `references/policy.md` |
| **Projects** | One profile per project: repo, base branch, CI, deploy, live checks, what never to automate. | `references/projects.md` |
| **Ledger** | All state, on disk, so the dispatcher can be restarted any time. Always read and written through `bin/conductor-ledger` (it locks, refuses bad keys, refuses type-replacing writes, and hands out ids with `next-id Q/D/F`). | `~/.local/share/conductor/` (ledger.json, done.json, archive.json, hermes.json, ledger.log) |
| **Web dashboard** | http://localhost:8710. What's waiting on Andrew (questions, proposals, follow-ups, reply drafts), decisions, tasks in flight. Answers reach the dispatcher within seconds through the `web-inbox` monitor (`bin/conductor-web-wait`). | `bin/conductor-web`, `web/index.html`; launchd `com.katz.conductor-web` |
| **Desk** | Where Andrew talks to the system: run `/desk` in any Claude session. It answers read-only questions itself and relays his words to the conductor as `andrew: ...`. The conductor sends its replies, updates and questions there. | `~/.claude/skills/desk/SKILL.md` |
| **Triage** | `/triage` (or `triage`): Andrew walks his Hermes priority board. Board items become tasks only there, with him. | `~/.claude/skills/triage/` |
| **Hermes** | Andrew's agent on katz-mini. It sweeps email, Chat, Slack and more into a priority board, which the conductor reads for ordering only. | `references/hermes.md`, `bin/conductor-board` |
| **Follow-ups** | Things only Andrew can do (reply to someone, a manual step), plus the answer to every investigation. Sent to Telegram and pinned on the dashboard until he says `F<n> done`. | `bin/conductor-followup` |
| **Browser worker** | Does manual web steps in a dedicated, hidden Google Chrome profile. It asks Andrew to sign in when needed, and asks before risky clicks. | `bin/browser-worker`, policy "Manual web steps" |
| **Comms** | Drafts a reply to every message that needs Andrew. It is in shadow mode (sends nothing) and grades each draft against what he actually sent. One-tap send is built but off until a kind is promoted. | `~/.claude/skills/comms/` (`comms-shadow`, `comms-outbox`, `comms-sendd`); launchd `com.katz.comms-shadow`, `com.katz.comms-sendd` |
| **Setup session** | An interactive Claude session where Andrew and Claude design and fix this system. It isn't part of the loop. The conductor sends it requests to change rules or scripts. | see "Restarting the setup session" |

## Guard rails (enforced, not just written down)

- **Working hours** (2026-10-16): `bin/conductor-hours`. Default Mon–Fri 8:00 AM–6:00 PM PST, with no merges or deploys after 5:30 PM. Use `pause`, `resume`, `extend 20:00`, or `set 09:00 17:00` to change it. Outside hours, nothing ticks, and anything sent in waits for the next morning. Andrew's own messages are still answered.
- **No new tasks without Andrew's OK** (2026-10-16): `bin/conductor-propose`. New work becomes a what/how/why proposal (a question with Approve / Approve, start now / No). A task is created only after he approves. The one exception is an investigation he asked for himself.
- **The hook** `bin/conductor-guard`, loaded through `settings.json` by `bin/conductor` and `bin/conductor-restart`, applies to the dispatcher and every job. It refuses `developerly ... create`, and refuses launches, merges and deploys while closed.
- **Never beta → main.** Releases are Andrew's alone. `bin/conductor-base-check` must exit 0 before any merge to main.
- **Self-audit:** `bin/conductor-audit` lists dropped work. Examples: a green PR not merged, an idle worker, a failed launch, a stale wait, free slots, ledger drift, approved proposals never created, Docker stacks left running. Every tick starts with it, and the dashboard monitor runs it every 5 minutes. **A new kind of stall becomes a new check here**, not just a message.
- **Docker:** `bin/conductor-docker-gc` stops the stacks of tasks that are past testing or finished (it keeps their data). A merged task that's only waiting on something is completed so its worktree goes away.

## Operating it

- **Start or attach:** `conductor`. **Restart fresh:** `bin/conductor-restart` (state is on disk; running jobs and monitors die and get re-derived). **Watchdog:** launchd `com.katz.conductor-watchdog` restarts it every 10 minutes if its context is above 150k and it's idle.
- **Status:** the dashboard, `conductor-status`, `conductor-inbox`, `bin/conductor-hours show`, `bin/conductor-audit`.
- **Talk to it:** `/desk`, the dashboard, or type in its window. Answers look like `Q12: Approve`, `D40: <override>`, `F3 done`. New work: "rush ...", "investigate ...".
- **Logs:** `~/.local/share/conductor/ledger.log` (every action), `watchdog.log`.

## Restarting the setup session

Start `claude` in `~` and say: "You're the setup session for the conductor system. Read ~/.claude/skills/conductor/README.md." Then:
- Message the conductor with SendMessage to `conductor` (use ListAgents if the name doesn't resolve). Its rule-change requests are for the setup session to make, because these files are its.
- Edit the files in `~/Work/dotfiles/dot-claude/skills/` (`~/.claude/skills/conductor` is a symlink to it). Commit to dotfiles `main` with Andrew's standing OK. **Don't push.** Leave his own uncommitted edits alone. **Never commit private details** (check `git show --stat` before committing; the conductor sometimes writes into this folder).
- After a change, tell the conductor which files to re-read, and tell Andrew in 1–3 plain lines.
- Memory notes with the history: `~/.claude/projects/-Users-andrewkatz/memory/` (`project_conductor.md`, `project_comms_shadow.md`, `feedback_*.md`).

## How Andrew wants to be talked to

Times in PST. Terse, plain words, no compliments. Name tasks in words, never by bare id ("the visualizer fix (2202)"). Decide by default and ask only when it truly needs him. Every investigation ends with a follow-up that holds the answer. Counts are exact, never estimates.

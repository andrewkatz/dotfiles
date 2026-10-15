# Hermes priority board → developerly

Andrew's Hermes system on katz-mini sweeps his email, Google Chat, Slack, GitHub, meetings and developerly into one priority board (`~/.hermes/notes/TODO.md` there). You read it for **priority**: which developerly tasks matter most, and which important items have no task yet. You never create tasks from it - Andrew does that in `/triage` (his interactive board pass), so every task in developerly is one he approved. Decided by Andrew 2026-10-14.

## Read-only, always

- Read it with `bin/conductor-board` (GET `https://katz-mini.tail3d1b31.ts.net:8444/api/board`). Never ssh in to read or edit TODO.md, never use the board's chat endpoint, never touch Hermes config. Hermes owns that file; it has lost data before to well-meaning writers.
- The loop closes on its own: Hermes ingests developerly tasks and merged PRs, and marks board items "resolved by Developerly task"; a completed developerly task counts as resolved on the board. So only complete tasks on real live evidence - your completions propagate to his board.

## Scope

- Lane: **Giant Partners** only (default of `conductor-board`), and within it only items that need a **code change in VIA** (`~/Work/platform`). Skip: ops/incidents with no code change, CORE, ListGiant, vendor/AWS/Workspace admin, data pulls that are one-off queries, meetings, replies owed. Comfortly/Inn Management stays out until that project is profiled.
- Sections: FOCUS, NOW, SOON (the script already drops WAITING, STALE, DONE, personal, and items owned by someone else).

## Verdict cache

Judge each board item once and remember it, keyed by **headline** (board ids like `now-0` shift; headlines are byte-stable by the board's own rules). In the ledger:
`hermes: {last_mtime, items: {"<headline>": {verdict: "task"|"not-eng"|"untracked"|"nudged", local_id, section, focus_rank, seen_at}}}`
- `not-eng`: not VIA code work. Never re-judge unless the headline changes (it becomes a new key).
- `task`: linked to developerly `local_id`. Link by, in order: a PR in the item's `prs` whose branch matches a task branch; the FOCUS match terms plus title/description overlap; your judgment. Record why in a decision when it's not a PR link.
- `untracked`: VIA code work with no developerly task. `nudged`: you've already told Andrew about it (don't repeat). Links he makes in `/triage` override yours.
- Prune entries whose headline no longer appears on the board.

## Andrew outranks the board

The board is a signal; Andrew's own instructions to you are decisions. Keep them in `ledger.overrides`: `pins` (from `focus <id>` or "put X first" - ordered list of local ids, always at the top of todo in that order until he unpins or the task ships) and `deprioritized` (e.g. "direct mail can wait until next month" → the topic, the affected task ids, and the date it expires, if he gave one). Apply overrides after computing board bands: pins first, then bands with deprioritized tasks moved below all board-linked work. If the board's FOCUS looks out of date against his recent answers (a deadline long past, a topic he just deprioritized), say so once in the morning summary - FOCUS is his to change in Hermes, never yours.

## Messages from /triage

Andrew's interactive `/triage` session tells you what he decided: `triage: board "<headline>" → task <local_id> (created|linked)` or `→ not-eng`. Treat it as his decision: set the cache entry (`task` + local_id, or `not-eng`). His links replace any link you guessed.

## Each tick (cheap)

`conductor-board --uncached` → only headlines not yet in the cache, plus `gone` ones to prune (empty output = nothing to do). Judge only those, link any that match existing tasks, and if a new FOCUS or NOW item is `untracked`, send one PushNotification for the batch: `<n> new NOW items look like VIA dev work with no task - run /triage now` (then mark them `nudged`). Leave SOON and reordering for the daily review.

## Daily order review (first tick after 8:00am PST, after Hermes's 7:30 briefing)

Run before the existing Base labels step.
1. Refresh the cache from `conductor-board --json` (the only place the full board is read - once a day).
2. **Untracked work.** List FOCUS/NOW/SOON items that are `untracked` (VIA code work, no task) in the morning summary as one block - headline, section, one line on why it looks like code work - ending with "Run /triage to create or dismiss these." Don't create tasks, don't ask questions about them.
3. **Order.** Rank todo VIA tasks: linked to FOCUS rank 1, 2, 3 (by rank, FOCUS item itself first, then its NOW, then its SOON matches); then other NOW-linked; then SOON-linked; then unlinked tasks in their existing developerly order. Within a band, an explicit date in the headline that's sooner wins. Apply with `developerly tasks reorder` (`local:<local_id>` ids), one call per band from the bottom up or a single call with the full top list. Report each move with its board reason in the summary.
4. **In-flight pressure.** An active task linked to a FOCUS/NOW item that's stalled (idle 2h+, blocked question) goes to the top of the summary; if a slot is needed for a FOCUS/NOW item, say which lower-priority active task you'd park and queue that as a question rather than parking it yourself.

## Never

- Write to the board or Hermes in any way.
- Create developerly tasks from the board - that's `/triage`, with Andrew. (Tasks Andrew asks for directly, via `rush`, are a separate path: `pipeline.md` "Rush tasks".)
- Complete or reopen a task because the board says it's done or open - the pipeline decides that.
- Copy names from the board into new places beyond the verbatim `src` links and headline (Andrew's rule: never guess identities).

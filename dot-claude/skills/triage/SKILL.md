---
name: triage
description: The only place developerly tasks get created from Andrew's Hermes board. Walk the board item by item with him and act on each decision - close, remove, record a decision, re-prioritize, mark waiting, create or link a developerly task, or draft an email reply. Use when he runs /triage (optionally with a scope like "work", "stale", "Comfortly"), or asks to go through / clean up / review his priority list or board.
---

# Board triage

A pass over Andrew's Hermes priority board (katz-mini). Obvious items are closed for him (auto pass); the rest he decides and you execute. Board changes go through `board-edit` only, never by editing files. Every decision teaches the rules (Learning).

Tools (in `~/.claude/skills/triage/bin/`):
- `triage-board next [SCOPE...] [-n 4]` - next due items as JSON (headline, section, lane, context, focus, last details, src notes + links, linked developerly task, and the conductor's verdict - `untracked` means it looks like VIA code work with no task, so lead with "Create task"). Default scope: all of Andrew's open items, NOW → SOON → WAITING → STALE. Scope words: `work`, `personal`, `now`, `soon`, `waiting`, `stale`, `untracked` (the conductor's "code work with no task" list - what its nudges point at), or any lane/context substring. Pass the user's `/triage` arguments through.
- `triage-board mark "<headline>" <action> ["note"]` - record it as handled (skipped for 7 days unless its details change).
- `triage-board stats [SCOPE...]` - per section: on_board (matches the board UI), tracked (hidden, open developerly task), due.
- `triage-board auto [SCOPE...]` - due items with an obvious decision: `auto` (close without asking) and `check` (offer in a checklist), each with `action`, `reason` and `rule`. Rules live in `~/.claude/skills/triage/auto-rules.json`; built-ins: `task-done`, `duplicate`, `date-event`, `date-deadline`, `stale`.
- `triage-board mark ... --rule <id> --suggested <action>` - record a decision on an item a rule suggested; prints whether the rule was agreed/overridden and any promotion/demotion.
- `triage-board rule add '<json>'` / `triage-board rules` - add a rule / show rules with their agreement counts.
- Items tied to an open developerly task are already hidden (the conductor owns them; `tracked` in the scope shows them). If an item's `task_status` is `done`, the board still lists work that developerly says is finished: recommend "Mark done" (citing the task) first, with "Reopen work: new task" second.
- `board-edit [--apply] < ops.json` - deterministic board edits on katz-mini (see Actions).
- `hermes-say [--new] < file` - send one message to Hermes and print its reply (email drafts, standing rules). Use `--new` on the first message of a run. Write the message to a scratch file and redirect it in (no shell quoting of free text).

## Loop

1. `triage-board stats <scope>` → tell Andrew in one line how many items are due and in which sections.
2. **Auto pass** - `triage-board auto <scope>`:
   - **`auto` items:** read each one's headline, detail and src. Veto any where the rule obviously misfires, for example a linked task that covers only part of the item, a date that isn't the item's event, or money still owed with no sign of autopay. Vetoed items fall through to the questions in step 4. Close the rest in **one** `board-edit --apply` batch with the rule's action, using note `auto: <reason>` (or reason `auto: <reason>` for `remove`). Mark each `ok` item as `auto-done` or `auto-remove`, with note `<reason>`, `--rule <rule>` and `--suggested <action>`. Report them as one block, one line each: `✓ <headline, ≤60 chars> - <reason>`. End the block with "say `undo <n>` to restore any".
   - **`check` items:** use multiSelect AskUserQuestion checklists. Group items by rule, with up to 4 questions × 4 options per call. The question is "Close these (<reason>)?" and each option label is the shortened headline, with the detail line as its description. Checked items: close them in one batch and mark each with `--rule <rule> --suggested <action>`. Unchecked items in a group he answered are overrides: mark them `kept` with the same `--rule`/`--suggested` so the rule learns (they return in 7 days, or sooner if their details change).
   - **Undo:** `undo <n>` (or naming the item) → `board-edit` op `{"op":"restore","headline":…,"section":<its old section>,"note":"undo auto-close"}` for a `done`. A `remove` can't be restored; tell him and offer to re-add it as a detail. Then `triage-board mark "<headline>" restored --rule <rule> --suggested <action>`, which demotes the rule to `check`.
3. `triage-board next <scope> -n 4` (auto and check items already handled are no longer due). For each item decide the most likely action from its details (stale-looking, already resolved by a merged PR, informational, needs a reply, needs code, etc.).
3. One AskUserQuestion call, one question per item (≤4):
   - `header`: short context (lane/who, ≤12 chars).
   - `question`: the headline plus the decision-relevant fact from the details, ending with "?". Include the email/chat source in a few words when it matters.
   - `options` (2-4): your recommended action first with "(Recommended)", then the next most plausible, then **Skip**. Each option's `description` says exactly what will happen ("Hermes marks it done with note '…'", "creates a VIA bug_fix task, base beta, linked to this item").
   - "Other" (built in) is how he gives free-form instructions: a decision to record, a different priority, edits to a draft, "link to 2110", etc. Interpret it; if genuinely ambiguous, ask once in plain text.
4. Execute all answers for the batch (below), then `mark` each item. If the item carried an auto/check suggestion (vetoed above), pass its `--rule`/`--suggested` so the override counts. Report the batch in ≤1 line per item, then continue with the next batch. Stop when nothing is due or he says stop; end with a 2-line summary (counts by action, anything that failed).

Keep the pace up: no commentary between batches beyond the result lines.

## Learning

The rules get better from his decisions. Do these every batch, without asking:
- **Agreement counts** are kept by `mark --rule`. Five agreements in a row promote a `check` rule to `auto`, and one override or undo demotes an `auto` rule to `check`. Relay any PROMOTED/DEMOTED line from `mark` in the batch report.
- **Standing instructions** become `auto` rules. When he says "always close/remove these", "never show me X" or similar, add a rule with `origin: "andrew"` and `tier: "auto"`. Admission rules ("stop admitting X to the board") still go to Hermes via `hermes-say` as well; the local rule catches what's already on the board.
- **Repeated decisions** become `check` rules. After each batch, look at the items he closed or removed that had no rule. If one shares a recognizable shape with an earlier close in `~/.local/share/conductor/triage.json` (same sender/source in src, same headline pattern such as "Review <vendor> invoice", same kind of notice), add a rule with `origin: "learned"`, `tier: "check"` and the narrowest regex that matches both. Never write a rule that would match an item he kept.
- **Narrowing a rule** when he overrides it on an item: if a `detail`/headline exclusion would have kept the item without losing past agreements, edit that rule in `auto-rules.json` (tighten the regex) and say so in one line.
- **Order:** `auto` items first, then checklists, then questions. Rule changes go in the end-of-run summary as one line per new, changed, promoted or demoted rule.
- **Safety limits:** `remove` rules only come from his explicit instructions; learned rules always use `done` (restorable). Never auto-close FOCUS or NOW items with `stale`. Never write a rule that matches developerly task creation candidates (the conductor's verdict `untracked`).

## Actions

**Board edits - deterministic, via `board-edit`** (not Hermes: an LLM patching a 380KB file failed on huge `src:` lines and half-applied moves). Collect the batch into one JSON list in a scratch file and run `board-edit --apply < ops.json`:
```
[{"op":"done","headline":"<exact headline from triage-board>","note":"<reason, his words>"},
 {"op":"remove","headline":"…","reason":"…"},
 {"op":"move","headline":"…","section":"WAITING ON OTHERS","note":"waiting on <who>: …"},
 {"op":"detail","headline":"…","text":"decision: …"},
 {"op":"retitle","headline":"…","new":"…"}]
```
- `section` is one of `NOW`, `SOON`, `WAITING ON OTHERS`. Headlines must be exact (copy from `triage-board`'s JSON). Notes are stamped `(Triage, Andrew, <time>)` automatically.
- It edits all ops in one atomic write with a backup, holds the board-updater's lock (waits up to 2 min), and refuses if counts don't move exactly as expected. Result per op: `ok`, `not_found`, `ambiguous`.
- **Only `mark` items whose op returned `ok`.** For `not_found`/`ambiguous`/an `error`, tell Andrew and leave the item unmarked so it comes back next run.
- A standing rule for the board (e.g. "stop admitting QuickCounts notices") isn't a board edit - that's a Hermes instruction: send it with `hermes-say` ("Add this standing admission rule to your board-updater and briefing prompts: …; do not edit TODO.md for this.").
- FOCUS is Andrew's and isn't editable here.

**Create a developerly task** (work items that need code):
- Project from context: Giant Partners → `VIA` unless it's clearly CORE/another configured project; Comfortly → `Inn Management`. Check `~/.config/developerly/projects.toml` when unsure.
- Draft title + description (goal, acceptance criteria, the board headline, its src notes + links verbatim) and base for VIA (`beta` for features / beta-only code, `main` for production fixes - see `~/.claude/skills/conductor/references/projects.md`). Put the drafted title and base in the option description so he approves them with the click.
- `developerly work-items create --project=<P> --kind=<feature|bug_fix> --title='…' --description="$(cat file)" --base=<beta|main> --sync --json` → note the local id.
- Board: add detail "tracked in Developerly task <local_id>" via the batch Hermes message.
- Tell the conductor (below).

**Link to an existing task**: find candidates with `~/.claude/skills/conductor/bin/conductor-sync --todo --json` (title/branch/description match) and offer the best 1-3 as options. On pick: board detail "tracked in Developerly task <id>", and tell the conductor.

**Draft an email reply** (text only - nothing is sent or saved to Gmail): ask Hermes, it has the thread context:
```
Draft a reply for Andrew to the message behind board item "<headline>" (source: <src note>). Facts/decision to convey: <what Andrew chose>. Match his usual tone (brief, direct). Return only the email body. Do not edit any files.
```
Show the draft in a fenced block so he can copy it. If he wants changes, use "Other" to take them and redraft. Only mark the board item (e.g. "reply drafted") if he says he sent it.

**Skip**: just `mark` it as skipped.

## Telling the conductor

When you create or link a task, or he says an item is not dev work, SendMessage `conductor` one line per item: `triage: board "<headline>" → task <local_id> (created|linked)` or `triage: board "<headline>" → not-eng`. The conductor updates its verdict cache; don't touch its ledger yourself. If ListAgents shows no `conductor`, skip this - it re-reads the board itself.

## Rules

- Never edit TODO.md by any route other than `board-edit`; never use the board UI's chat endpoint (it shares Andrew's UI session).
- Never guess identities. Use names exactly as the board shows them.
- Never send email. Drafts are text in this chat.
- Never complete or reopen developerly tasks here - that's the conductor's pipeline or Andrew's call in the TUI.
- Times in PST.

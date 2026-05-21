---
description: Analyze pi session history and recommend workflow optimizations
argument-hint: "[days=30] [project-cwd=current]"
---
Analyze my pi history and recommend concrete workflow optimizations that reduce context usage, reduce repeated statements, and improve output quality.

Arguments:
- `$1`: optional number of days to analyze. Default: `30`.
- `${@:2}`: optional project cwd to treat as the project-specific focus. Default: the current working directory.

## Scope

Use pi session history from `~/.pi/agent/sessions/`. Sessions are JSONL; see `~/.pi/agent/sessions/--<path>--/*.jsonl` and the session format docs if needed.

Produce both:
1. Global recommendations across all recent pi usage.
2. Project-specific recommendations for the focus cwd.

## Constraints

- This is a public dotfiles repo context when run here: do not expose secrets, tokens, private hostnames, credentials, or sensitive content from history.
- Do not dump full transcripts into context. Aggregate first with a local script, then inspect only narrow snippets if needed.
- Prefer quantitative evidence: counts, repeated phrases, frequent tools, high-token turns, compaction frequency, common failure/retry patterns.
- If history is too large, sample recent sessions plus the highest-token sessions.
- Keep recommendations actionable: exact prompt template changes, guideline edits, extension/tooling ideas, and usage habits.

## Suggested workflow

1. Resolve inputs:
   - Treat the first argument (`$1`) as the number of days; if it is blank or not numeric, use `30`.
   - Treat the remaining arguments (`${@:2}`) as the project cwd; if blank, use `pwd`.
2. Run a local Python aggregation over recent `~/.pi/agent/sessions/**/*.jsonl` instead of reading files directly. The aggregate should include:
   - sessions by cwd and date
   - total assistant input/output/cache tokens and cost when present
   - largest sessions and largest assistant turns
   - tool usage counts, error counts, and repeated commands
   - old/large tool results and truncated bash outputs
   - number of user turns, assistant turns, compaction summaries, branch summaries
   - repeated user phrases/instructions across sessions
   - repeated assistant phrasing/status patterns if visible
   - project-focused subset for `PROJECT_CWD`
3. Inspect current relevant config narrowly:
   - global pi prompts/extensions/settings under `~/.pi/agent/` or this repo's `dot-pi/agent/`
   - project instructions such as `CLAUDE.md`, `.pi/`, package-specific docs only as needed
4. If needed, inspect a few high-signal sessions with a script that prints only redacted, truncated snippets around the highest-token turns or repeated failure loops.

## Output format

Provide:

### Executive summary
- 3-5 highest-impact changes, with estimated impact: High/Medium/Low.

### Evidence reviewed
- Date range, number of sessions, focused project cwd, and key aggregate stats.

### Global recommendations
For each recommendation:
- Problem observed
- Evidence
- Suggested change
- Where to implement it (`~/.pi/agent/prompts/...`, `dot-pi/agent/extensions/...`, project `CLAUDE.md`, habit/process, etc.)

### Project-specific recommendations
Same structure, scoped to the focus project.

### Repeated statements to eliminate or encode
- Repeated user instructions that should become global/project guidelines or prompt templates.
- Repeated assistant boilerplate that should be discouraged.

### Context-reduction opportunities
- Specific commands or agent habits that waste context.
- Proposed alternatives such as `rg` before `read`, line-ranged reads, `explore_subagent`, `monitor_command`, summarized local scripts, or stronger prompt-template guardrails.

### Output-quality improvements
- Better acceptance criteria, verification steps, docs-check requirements, review checklists, or formatting conventions.

### Proposed changes
- Concrete files/templates/extensions you recommend adding or editing.
- Ask before editing unless the user explicitly asked you to implement the recommendations now.

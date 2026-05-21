---
description: Commit, push, open a PR, wait for checks, and merge
argument-hint: "[base-branch]"
---

Ship the current branch through to merge. Raw arguments: `$ARGUMENTS`. The optional argument is the PR base branch: use the single provided argument when present, otherwise use `main`. The user has pre-authorized every git/gh action in this workflow — do not ask for confirmation before committing, pushing, creating, or merging the PR. Do not stop after an intermediate milestone like creating a branch, committing, pushing, or opening a PR; continue automatically through checks and merge unless a guardrail below explicitly says to stop and ask.

## Preflight

- Parse raw arguments (`$ARGUMENTS`). If empty, set `base_branch=main`. If exactly one branch name is provided, set `base_branch` to it. If more than one argument is provided, stop and ask for a single branch name.
- Verify `base_branch` exists locally or on `origin` (`git rev-parse --verify refs/heads/<base_branch>` or `git rev-parse --verify refs/remotes/origin/<base_branch>`). If not, stop and ask.
- `git status` + `git diff` + `git log -5 --oneline` in parallel to see pending changes and recent commit-message style.
- If the current branch is `base_branch`, `main`, or `master`:
  - If the working tree is clean, stop — there is nothing to ship.
  - Otherwise, derive a short kebab-case feature branch name from the pending diff (e.g. `fix/null-guard-booking-total`, `feat/guest-export-csv`). Match any branch-prefix convention visible in recent branches (`git branch -a --sort=-committerdate | head -20`).
  - Create and switch to it with `git switch -c <name>`. Do **not** stash, reset, or discard any changes — the uncommitted work moves with the new branch. The PR should still target `base_branch`.
  - Do not pause after creating the branch. Continue directly to committing, pushing, opening the PR, waiting for checks, and merging.

## 1. Commit pending changes

- If the working tree is clean, skip this step.
- Stage files by name (never `git add -A` or `git add .`; never `-f`). Skip anything that looks like secrets (`.env`, credentials, keys).
- Write a commit message matching the repo's recent style. Focus on the *why*. No Claude co-author trailer unless the repo's recent history uses one.
- Never `--amend`, never `--no-verify`. If a pre-commit hook fails: fix the underlying issue, re-stage, create a NEW commit (not an amend).

## 2. Push

- If no upstream is set, push with `-u origin <branch>`.
- Never `--force`, never `--force-with-lease`, never `--no-verify`.

## 3. Open or find the PR

- `gh pr view --json number,url,state,isDraft,baseRefName` — if a PR already exists for this branch, use it. If its `baseRefName` differs from `base_branch`, stop and ask before retargeting it.
- Otherwise create the PR with `gh pr create --base <base_branch>`. Title < 70 chars. Body has a `## Summary` bullet list and a `## Test plan` checklist. Derive both from the actual diff across all commits on the branch relative to `base_branch` (not just the latest commit).

## 4. Wait for checks

- `gh pr checks --watch --fail-fast=false` to block until all checks settle.
- Checks can take a while. That's expected — let the command run.

## 5. Handle results

**If all checks pass:**
- Merge. Pick the style matching the repo's recent merged PRs (`gh pr list --state merged --limit 5 --json title,mergeCommit`). Default to `gh pr merge --squash --delete-branch`. Add `--auto` only if required checks aren't all green yet (they should be, since we just waited).
- **Worktree caveat:** if the current checkout is a non-primary worktree (check with `git rev-parse --git-common-dir` ≠ `.git`, or `git worktree list` shows the current path is not the main one), `--delete-branch` will fail with `'main' is already used by worktree at ...` because gh tries to switch the local checkout to the default branch. Run the merge without `--delete-branch` instead, then delete the remote branch explicitly: `gh pr merge --merge` (or `--squash`/`--rebase`) followed by `git push origin --delete <branch>` (or rely on GitHub's "automatically delete head branches" repo setting). Verify the merge with `gh pr view <num> --json state,mergeCommit` afterward. Do **not** try to switch this worktree off its branch — leave local cleanup to the user, who can run `git worktree remove <path>` from the primary checkout when convenient.

**If any check failed:**
- `gh pr checks` to see which ones, then `gh run view <run-id> --log-failed` for the failing job.
- Diagnose the root cause and fix it in code. Do not bypass with `--no-verify`, skip tests, or disable lints to make a check pass.
- Commit the fix with a message describing what broke and what you changed. Push. Return to step 4.
- If two fix attempts in a row don't resolve it, or the failure looks unrelated to the diff (flaky infra, external outage), stop and summarize for the user.

## Continuation rule

- Creating a branch, making a commit, pushing, opening/finding a PR, or seeing checks pending is not a stopping point. Keep going through the next numbered step until the PR is merged or a guardrail requires asking the user.
- If a command returns a transient/non-final state (for example, `gh pr checks` initially says no checks are reported, or checks are queued/pending), inspect the PR/check rollup and keep waiting rather than stopping.

## Guardrails (repeat — do not break these)

- Never push directly to `base_branch`, `main`, or `master`.
- Never `--force` / `--force-with-lease` / `--no-verify` / `--amend`.
- Never `git add -A`, `git add .`, or `git add -f`.
- Never `git restore`, `git reset --hard`, or `git checkout --` to discard user changes.
- If anything unexpected appears (unfamiliar files, diverged branch, existing merge conflict), stop and ask.

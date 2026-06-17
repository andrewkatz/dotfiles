---
description: QA a feature in the local dev environment with a real browser
argument-hint: "[what to QA]"
---

Drive the current feature in a real browser in the local dev environment and confirm it works fully as expected. Raw arguments: `$ARGUMENTS`.

**Starting the dev server (when one isn't already up) and clicking through the running app in a browser is the entire job of this command.** Do not run a few checks and then hand the server-start back to the user, and do not substitute the unit/integration test suite for actually driving the app. If the app isn't running, start it yourself and continue through to the browser QA.

## What to QA

- If arguments describe a feature, page, or flow, QA that.
- Otherwise infer the scope from the current branch's diff against `main` (`git diff main...HEAD --stat` plus the changed files) and QA the user-facing behavior those changes affect.

## Steps

1. **Derive this worktree's dev URL and port** using the **`dev-qa`** skill — it covers port derivation, host/protocol, login, and driving the app with the `agent-browser` skill. Follow the skill, **except its "ask the user to start the server / only start it yourself if the user explicitly asks" step, which does NOT apply here.** This command is the explicit, standing authorization to start the server yourself.

2. **Make sure the server is up — and start it yourself if it isn't.**
   - Check whether anything is listening: `lsof -iTCP:"$PORT" -sTCP:LISTEN -P` (or `curl -s -o /dev/null -w "%{http_code}" -m 5 "$URL"` — `000` means nothing is listening).
   - **Already running** → use it. Never kill or restart it; other worktrees share the box and a restart drops their state.
   - **Not running** → start it yourself in the background: `bin/dev` for Rails, `npm run dev` for Vite. It must bind this worktree's `$PORT` (the skill explains how). Then poll `$URL` until it responds (up to ~60s) before moving on. If it won't come up, read the background process output and debug it — do **not** defer back to the user.

3. **Log in** if the app has auth (per the skill), then **exercise the feature thoroughly**: walk the happy path, try the edge cases and error states a real user would hit, and check the browser console and network for errors. Don't stop at the first screen that renders.

## Report

- State clearly whether the feature works as expected.
- Back it with evidence: screenshots, the URLs/steps you exercised, and any console/network errors.
- Call out anything broken, surprising, or unverified — never assert "works" for a path you didn't actually exercise.

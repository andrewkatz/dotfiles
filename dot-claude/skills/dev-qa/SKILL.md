---
name: dev-qa
description: "QA an app in the local development environment with a real browser. Use when asked to QA, manually test, smoke-test, dogfood, click through, or verify a feature/page in dev — anything that means driving a running dev server in a browser. Handles both Rails and Vite apps: finding the worktree-specific dev URL, reusing the already-running dev server, and signing in when the app has auth."
---

# Dev QA

Drive an app's **running local dev server** in a browser to QA a feature. Works for **Rails** and **Vite** apps. These repos use git worktrees, and **each worktree runs its own dev server on its own port** — so the URL is worktree-specific and must be derived, never hardcoded.

Use the **`agent-browser`** skill for all browser interaction (navigate, click, type, screenshot, read DOM). Invoke it the same way you would any other skill.

**Use a worktree-unique browser session.** Other worktrees — and other agents — may be QA-ing at the same time. The default (unnamed) `agent-browser` session is shared, so concurrent runs would stomp on each other's cookies, tabs, and login state. Give this run its own session and pass it on **every** `agent-browser` command:

- Pick a unique name keyed to this worktree. `$PORT`/`$WEB_PORT` is exported per-worktree (see step 1) and is already unique across worktrees, so **`qa-$PORT`** is the default choice.
- Pass `--session "qa-$PORT"` on every command (login in step 3 and QA in step 4 both need it). Prefer `--session` over the `AGENT_BROWSER_SESSION` env var: env exports don't carry across separate shell invocations here, so a one-time `export` silently drops back to the shared default on the next command.
- If you're one of **several agents on the same worktree** (same `$PORT`), the port alone collides — append a suffix you choose once and reuse for the whole run (e.g. `qa-$PORT-b`).
- `agent-browser close --session "qa-$PORT"` when you're done, so the named session doesn't linger.

## 1. Find this worktree's dev URL

Discovery is tiered — take the first that applies:

1. **`tmp/dev-url.txt` exists** → its contents are the full URL, verbatim. Any project can write this file to advertise its dev URL; when present it wins over everything below.
2. **Derive the port:** `WEB_PORT` → else `PORT` → else the framework default. In a Developerly-managed worktree, `PORT`/`WEB_PORT` are exported per-worktree (e.g. `19352`), so reading the env is enough — **for both Rails and Vite** (see the Vite note below to make Vite actually bind it).
   - **Framework default** when neither env var is set: Rails (`Gemfile` / `config/environments/development.rb`) → `3000`; Vite (`vite.config.*` / a `vite` dep in `package.json`) → `5173`.
3. **Host / protocol** (identical for Rails and Vite):
   - `tmp/tunnel.txt` exists → `https://$NGROK_HOST` (no port)
   - `WHITE_LABEL` env set → `http://app.whitelabel.localhost:$PORT`
   - `tailscale status` succeeds and `FORCE_LOCALHOST` is **not** set → `http://$(hostname):$PORT`
   - otherwise → `http://localhost:$PORT`

One-liner that produces the right URL for the current setup:

```bash
PORT="${WEB_PORT:-${PORT:-}}"
if [ -z "$PORT" ]; then
  if [ -f Gemfile ] || [ -f config/environments/development.rb ]; then PORT=3000
  elif ls vite.config.* >/dev/null 2>&1 || grep -q '"vite"' package.json 2>/dev/null; then PORT=5173
  else PORT=3000; fi
fi
if [ -f tmp/dev-url.txt ]; then URL="$(cat tmp/dev-url.txt)"
elif [ -f tmp/tunnel.txt ]; then URL="https://$NGROK_HOST"
elif [ -n "$WHITE_LABEL" ]; then URL="http://app.whitelabel.localhost:$PORT"
elif [ -z "$FORCE_LOCALHOST" ] && tailscale status >/dev/null 2>&1; then URL="http://$(hostname):$PORT"
else URL="http://localhost:$PORT"; fi
echo "$URL"
```

Don't guess port 3000/5173 blindly — other worktrees are usually listening on the defaults. Always prefer this worktree's `PORT`/`WEB_PORT`.

> **Vite note:** A bare `vite.config.js` ignores `$PORT` and serves on `5173`, so every worktree collides on the same port. To make Vite behave like Rails (bind the per-worktree port and be reachable over tailscale/hostname), the project's config needs:
> ```js
> // vite.config.js
> server: {
>   port: Number(process.env.PORT) || 5173,
>   host: true, // listen on 0.0.0.0 so $(hostname)/tailscale URLs work
> }
> ```
> If a Vite project hasn't been updated, fall back to `http://localhost:5173` and tell the user the worktree port isn't being honored yet.

## 2. Check if the dev server is already running — do NOT restart it

The server is almost always already up (started by `bin/dev`, `npm run dev`, or the Developerly TUI). **Never kill or restart a running dev server** — other worktrees share the box and a restart drops their state too.

```bash
lsof -iTCP:"$PORT" -sTCP:LISTEN -P >/dev/null 2>&1 && echo RUNNING || echo "NOT running"
# Confirm it actually responds (any HTTP code means it's up; 000 = nothing listening):
curl -s -o /dev/null -w "%{http_code}\n" -m 5 "$URL"
```

- **Running** → go straight to QA. Do not touch the process.
- **Not running** → ask the user to start it rather than starting it yourself; suggest they run `! bin/dev` (Rails) or `! npm run dev` (Vite) in this session so it serves on this worktree's `$PORT`. Only start it yourself if the user explicitly asks.

## 3. Log in (only if the app has auth)

Vite prototypes usually have no auth — skip this step and go straight to QA. **Rails apps** typically gate everything: an unauthenticated request 302s to `/sign_in`. If you land on a sign-in page, sign in via `agent-browser`:

- Open `"$URL/sign_in"`
- Fill `input[type=email]` → `admin@giantpartners.com`
- Fill `input[type=password]` → `testtest`
- Submit the form (click the **Sign in** button / press Enter)
- Confirm you land off `/sign_in` (no longer redirected) before proceeding

(These credentials are for the platform app's dev seed data. A different app will need its own dev credentials — ask the user if you don't know them.) The platform session cookie is keyed per-port (`_via_session_development_<port>`), so a login in this worktree's browser session is independent of other worktrees.

## 4. QA the feature

Navigate to the relevant pages under `"$URL/..."`, exercise the change, take screenshots, and read the DOM/console for errors. Report what you observed — broken states, console errors, and screenshots — rather than only asserting it works.

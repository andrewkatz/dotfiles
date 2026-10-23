# Project profiles

**This file is in a public repo.** Account ids, hostnames, instance ids, vault and account names, and credential locations go in `~/.local/share/conductor/private.md`, never here. Every developerly project is fully managed (Andrew, 2026-10-14). A project with no profile here gets triage and reporting only, until it has one (ask Andrew for the blanks: base branch, merge style, CI, deploy, live URLs, health signals).

## Merge and deploy authority (Andrew, 2026-10-14)

| Project | Merge | Deploy |
|---|---|---|
| VIA | auto (beta/main rules below) | automatic on push |
| Inn Management | **PAUSED 2026-10-14: no new launches** (see `policy.md` Scope). When resumed: auto, **except PRs touching `mobile/**` or `infra/**`**: queue a blocking merge question | automatic on push |
| Developerly | auto, including `cli/**` after the CLI smoke test | automatic on push (server and CLI release) |
| comfortly-prototype, VIA Prototype, VIA Marketing | auto, except the sign-off pages listed in each profile | automatic on push |
| CORE, Ping | auto | **the conductor runs `bin/deploy` right after the merge** |
| Cue, Super Awesome Workout 4000, Katz Mac Stats, Race Spoilers, YNAB Daily Review, dotfiles | auto (no CI on most: the worker's local tests plus the review gate are the gate) | per profile; app store releases are never automated |

"Auto" means the same "Safe to merge" judgment as VIA (`policy.md`). Every profile's "Never automate" list overrides this table. Single-base projects (everything except VIA) launch with `--base` set to the profile's base branch; there's no labeling step. Project-specific dev servers on fixed ports (comfortly-prototype :4173) are covered by the one-QA-run-per-project limit.

## VIA (`~/Work/platform`, GitHub `giant-partners/platform`)

- **Counts are exact, never estimated.** See `policy.md` "Product rules". Every spec, review and merge gate checks for it.
- **Base branch is decided by git ancestry, not by the task text.** Run `bin/conductor-base-check <worktree> HEAD` and record `based_on` in the ledger (`base`):
  - `based_on=beta` (the branch contains beta-only commits) → it ships to **beta**. Always. No exceptions, whatever the description says. If the task really needs to reach production now, that's a question for Andrew, and the answer is a new branch from `origin/main` with only the branch's own commits cherry-picked - never retargeting.
  - `based_on=main` → ships to **main** only when the task is explicitly a production hotfix; otherwise **beta** (a main-based branch is safe on beta).
  - **New launches use the task's label.** Each developerly task carries a `base_branch` (`work-items get --json`). Launch with exactly that (`work-items launch` uses it automatically; still pass `--base` explicitly so the ledger and the launch agree). Never launch a VIA task with no label.
  - **Labeling rule** (used in the daily order review, see SKILL.md): **main** = fixes or improvements to behavior that's live on app.via.tools and should reach production before the next release, provided the code involved exists on `main`. **beta** = new features, anything building on beta-only code, and anything that can wait for the release. Check "exists on main" with `git -C ~/Work/platform grep -l <symbol> origin/main` rather than guessing. A production fix whose code only exists on beta can't go to main: label it beta and note it.
  - Main-based fixes still reach beta later through Andrew's regular main → beta merges; don't open those yourself.
- **Never** merge or PR `beta` → `main`, and never merge any PR into `main` that `conductor-base-check --pr` refuses (exit 2). Andrew promotes releases manually.
- **CI:** `ci.yml` on PRs (required). Merge with `gh pr merge --admin --merge` - recent history uses merge commits ("Merge pull request #N").
- **Deploy:** `deploy.yml` runs on push to `beta` → beta.via.tools and to `main` → app.via.tools (Kamal; concurrency group `deploy-<branch>`).
- **Private access notes** (AWS profile, production runner, Snowflake, 1Password accounts, cached logins): `~/.local/share/conductor/private.md`. Read it when a job needs them.
- **Shared database:** beta and production share one database. Migrations follow SKILL.md → "Migrations" (separate PR, deployed first, compatible with `main`).
- **Live checks:**
  - Exercise the acceptance criteria on https://beta.via.tools (or https://app.via.tools for `main`) with agent-browser, headless. Beta (beta.via.tools) login credentials: 1Password item "Giant Partners Platform" in the Katz Family -> Giant Partners vault (per Andrew, Q36). **Cached login (Andrew, 2026-10-16): never call `op` for this login (each non-TTY `op` call triggers a fresh 1Password approval).** Read `~/.local/share/conductor/beta-login.json` (chmod 600; `op item get --format json` output, fields `user[email]` / `user[password]`, e.g. `jq -r '.fields[]|select(.purpose=="USERNAME").value'`); never print the secret. If the file is missing or login fails, queue a question for Andrew rather than calling `op` repeatedly. Log in per the `dev-qa` skill's auth notes; if production login isn't possible, queue a question rather than skip.
  - **Test lists (Andrew, Q110/D219, 2026-10-16):** for live checks the conductor may create clearly named, tiny test lists (name "CONDUCTOR TEST <task> - safe to delete", a handful of rows, ~0 credits) in the **Giant Partners** account only, never in a client account. Record the list id in the task's evidence so Andrew can delete it; never delete it yourself. Don't save production audiences; use previews/counts only.
  - VIA MCP: `job_failures` for the window since deploy; compare against the hour before the deploy.
  - Sentry: `~/.claude/skills/conductor/bin/conductor-sentry new-since <deploy finish time>` (via + via-javascript; token in `~/.config/sentry-to-developerly.env`, read by the script only).
  - Read-only production inspection when needed: the repo's `production-troubleshoot` skill.
- **Never automate:** any `kamal` command from this machine that boots, restarts, deploys or pushes env to beta or production (`app boot`, `app restart`, `deploy`, `redeploy`, `rollback`, `env push`). The local env lacks the CI secrets, so these re-upload the host env files with empty values. On 2026-10-23 two `kamal app boot` attempts left beta's `DATABASE_URL` empty until the next CI deploy, and one container restart away from a full outage. Read-only `kamal app logs` / `details` is fine. To recover, revert the merge on `beta` and let `deploy.yml` ship it.

## Inn Management (`~/Work/inn-management`, GitHub `getcomfortly/inn_management`)

- **Base branch:** `main` only. No staging and no promotion flow: every merge goes straight to production (comfort.ly, real properties and guests). Launch with `--base main`.
- **Merge:** `gh pr merge <n> --merge`. The repo allows merge commits only (squash and rebase are disabled), and history is all "Merge pull request #N". **`--admin` doesn't help.** The `main` ruleset has no bypass actors, so the required checks must be green before merging. Branches are auto-deleted on merge.
- **CI:** `ci.yml` "CI" runs on PRs to main. Required checks (ruleset): Lint, Security, Tests, Test seeds, OpenAPI coverage, System tests (chrome), System tests (firefox). Non-strict, so the branch doesn't need to be up to date. Also on PRs, path-filtered: `native-release-checks.yml` (mobile/**) and `terraform.yml` plan (infra/**).
- **Deploy:** `deploy.yml` "Deploy" runs on push to `main`. It does `kamal deploy` to the single Germany host 5.9.99.111, concurrency group `deploy`. Live URLs are https://comfort.ly plus property subdomains `*.comfort.ly` (guest booking at `<property>.comfort.ly/book`).
- **One production MySQL** (`db.internal.comfort.ly`). Migrations run during deploy via `db:prepare`. MySQL DDL is non-transactional, so a bad migration leaves prod half-applied. Read `docs/migrations.md` first. Migrations over 60s need the detach process in `docs/long_running_migrations.md`. Ship migrations as their own PR.
- **Auto side effects on merge to main** (path-triggered, no reviewer gate):
  - `mobile/ios|android/**` → `native-release.yml` reserves a version, merges its own `release/native-v…` PR, and uploads to TestFlight/Play internal. The merged PR title becomes the store release note.
  - `infra/terraform|aws/**` → `terraform.yml` **applies to production**.
- **Live checks:**
  - `curl https://comfort.ly/up` and `/up/database` should return 200.
  - Sentry project `inn-management` (issue keys `INN-MANAGEMENT-*`, Sentry MCP). Sentry fixes must have `Fixes INN-MANAGEMENT-XX` in the commit message.
  - Logs and alerts are in Grafana Cloud (`docs/grafana.md`). Use the repo's `incident-triage` and `production-data` skills (read-only, `kamal app exec`, summaries only).
  - Browser smoke on prod: no QA login is known (the dev creds only work locally).
- **Local:** `bin/rails test` (the full gate is `bin/ci`). Dev server is `bin/dev`, run per worktree on sslip.io at the `PORT` from `mise.local.toml`, never on localhost. QA follows the repo's `dev-qa` skill: dev login `trobrock@berrysprings.com` / quick sign-in. Seed data: `bin/create-test-booking`, `bin/rails dev:revenue_management_seed`.
- **Never automate:**
  - `native-promote.yml` (App Store review / Play production 100%). It needs Andrew's on-device sign-off.
  - `native-release` prepare/publish dispatches, and touching `release/native-v…` PRs.
  - Merging any PR that touches `mobile/**` (it ships a TestFlight/Play build) or `infra/**` (it runs a prod terraform apply), unless Andrew OKs it.
  - Prod data mutation, Stripe/payments, guest emails or SMS, Channex writes.

## Developerly (`~/Work/developerly`, GitHub `getcomfortly/developerly`)

- **Base branch:** `main` only, no promotion flow.
- **Merge:** `gh pr merge <n> --admin --merge`. Merge and rebase are allowed, squash is disabled, and history is "Merge pull request #N". The ruleset requires `Tests`, and the admin role is an "always" bypass, so `--admin` works. Branches are auto-deleted on merge.
- **CI:** these run on PRs:
  - `ci.yml` "CI": Lint, Security, Tests (Rails + seeds). Only `Tests` is required.
  - `cli.yml` "CLI": `test` (go vet/test/build) and `TUI Changelog`. Path-filtered to `cli/**` and the skills paths.
  - TUI changes fail CI without a line under `## Next CLI Build` in `cli/internal/tui/changelog/TUI_CHANGELOG.md`.
  - The CLI checks aren't required, so verify they're green yourself.
- **Deploy (server):** `deploy.yml` runs on every push to `main`. It does `kamal deploy` (Rails sync server) to 5.9.99.111, concurrency `deploy`, live at https://developerly.comfort.ly.
- **Database:** single prod SQLite at `storage/production.sqlite3` on volume `/data/developerly`. Migrations run on boot via `db:prepare`. There's no staging, and the conductor's own task data lives in this DB.
- **CLI release (automatic, user-facing):** `cli-release.yml` runs on push to `main` touching `cli/**`, `.agents|.claude/skills/**`, `CLAUDE.md`, etc.
  - It commits "Promote TUI changelog for latest-rN [skip ci]" to main via a deploy key.
  - It replaces the `latest` release on the public `getcomfortly/developerly-cli` repo.
  - Every CLI merge ships to all users immediately, including the conductor's own `developerly` binary. **Never re-run a CLI Release run.** The 2026-10-14 2:01 PM PST re-run failed with a non-fast-forward error on the changelog push.
- **Live checks:**
  - `curl https://developerly.comfort.ly/up` should return 200.
  - Run `developerly` CLI commands the task touched (`work-items list/get`, `conductor-sync`) against prod after the CLI build lands.
  - Logs: `kamal logs` (read-only). There's no Sentry: the gem isn't in the Gemfile.
  - Web UI is GitHub OAuth only (sign-in + tokens). Browser QA on prod needs Andrew's GitHub session.
- **Local:** tests are `bin/test` (Rails + `cd cli && go test ./...`). Server is `bin/dev`. TUI is `developerly tui`. Seeds create the getcomfortly account with andrewkatz and trobrock (GitHub OAuth, no password login). The repo has no dev-qa skill.
- **CLI merges are authorized (Andrew, 2026-10-14)**, but first build the branch's CLI locally (`cd cli && go build -o /tmp/dly-<task> ./...` or the repo's build target) and smoke-test the commands the conductor depends on: `work-items list/get --json`, `tasks list --json`, `projects list`. If any fail, don't merge; send findings to the worker. After the release lands, confirm `developerly --version` shows the new `latest-rN` and `conductor-sync` still works. If it doesn't, push to Andrew immediately.
- **Never automate:**
  - Manual `cli-release.yml` dispatch or re-runs.
  - Prod `kamal console` writes.
  - Changes to `ios/` (an Xcode app with no release workflow): ask.

## comfortly-prototype (`~/Work/comfortly-prototype`, GitHub `getcomfortly/comfortly-prototype`)

- **Base branch:** `main` only.
- **Merge:** `gh pr merge <n> --admin --merge`. All styles are allowed, history is "Merge pull request #N", and branches aren't auto-deleted (pass `--delete-branch`). The ruleset only blocks deletion and force-push, and has no required checks.
- **CI:** none. There are no PR checks, no Vercel preview deploys, and no tests.
- **Deploy:** `deploy.yml` "Deploy to Vercel (Production)" runs on push to `main` (also `workflow_dispatch`). It does `vercel build --prod` + `deploy --prebuilt --prod`, concurrency `deploy-main` with cancel-in-progress. Live at https://comfortly-prototype.vercel.app (public, no auth). Pages: `/`, `/marketing/`, `/app/`, `/app/booking-flow/`, `/app/booking-flow/manage.html`.
- **No DB, no migrations, no backend.** It's a static site with no build step: React/Babel come from a CDN and the JSX compiles in the browser.
- **Live checks:**
  - Each touched page returns 200.
  - agent-browser screenshot of each changed page shows no console errors (Babel compile errors only show up in the console).
  - There's no Sentry and no logs.
- **Local:** `npm run dev` serves on http://localhost:4173 (fixed port, so worktrees collide). There's no test command, so QA is visual only. Design exports are applied by hand per CLAUDE.md (rename to `index.html`, bump `?v=N`).
- **Never automate:** applying new Cloud Design zip exports without Andrew. Marketing copy and brand changes are product decisions. Ask before merging them.

## CORE (`~/Work/core`, GitHub `giant-partners/core`)

- **Base branch is `master`, always.** `development` (last commit 2020-03, 181 ahead / 595 behind master) and `hotfix` (last commit 2018-05, fully merged) are dead. Never target, merge or push them. All 72 PRs in history target `master`. There is no promotion flow and no staging.
- **Merge style:** PRs only (every first-parent commit on master since #247 is "Merge pull request #N"). The repo allows only merge commits (squash and rebase are disabled) and deletes branches on merge. Merge with `gh pr merge <n> --merge --delete-branch`.
- **CI:** none. There are no workflows, no branch protection and no test suite (PHP 7.0 / Zend Framework 1 / Doctrine). The `testing` gate is code review plus local browser QA.
- **Deploy is manual:** `bin/deploy` SSHes to `ubuntu@54.70.173.252` (key `~/.ssh/liz/portal-dev-or.pem`) and runs `git pull` in `/var/www/coregiant.com/BOT`. It deploys whatever is on `master` and has no build step. There is no run to watch, so verify by hitting the site. **The conductor runs `bin/deploy` itself right after the merge (Andrew, 2026-10-14)**, as one deploy per merge, and records the output as deploy evidence. A merge that needs a `docs/updates/*.sql` change can't deploy until the SQL is applied: queue a blocking question with the SQL. Production is the only environment: https://coregiant.com.
- **Migrations:** there is no framework. Schema changes are hand-written SQL in `docs/updates/` (e.g. `2026-10-02-via-shipping-method.sql`) that someone applies by hand to the production RDS (`db-coregiant-2`, us-west-2).
- **Shared database:** the CORE MySQL DB is shared with **Pay Giant** (`giant-partners/pay-giant`, paymentgiant.com) and with **VIA** (platform `core` DB, `CORE_DATABASE_URL`, `db/core_migrate`). Any `application/models/` change must be mirrored in pay-giant. Any schema change must stay compatible with VIA's `Core::*` models on both beta and app.
- **Cross-links to VIA:** `application.ini` points `urls.via` and `urls.completeinvia` at `https://beta.via.tools` ("Pay with VIA", purchase orders), so CORE changes can depend on beta-only VIA code.
- **Live checks:** browse https://coregiant.com/login with agent-browser and exercise the acceptance criteria. Errors go only to the Zend file log `docs/logs/application.log` on the server. There is no Sentry and no health URL. The production login account is unknown.
- **Local QA:** `docker-compose up` (app on :8080, MySQL on :3307), `mkdir -p docs/logs`, and load a DB dump. Then switch `public/index.php` from `configs/core/` to `configs/local/application.ini`. **The default config points at the production DB.** Never commit that switch. Local login: `tech@listgiant.com` (password in CLAUDE.md). Sass: `sass public/dist/scss/style.scss public/dist/css/style.min.css --style compressed`.
- **Never automate:**
  - applying `docs/updates/*.sql` to production
  - any local run against `configs/core` (production DB)
  - triggering crons or emails
  - using real client email addresses (the app sends automated email to clients and processes payments through WorldPay/Vantiv)

## VIA Marketing (`~/Work/via-marketing`, GitHub `giant-partners/via-marketing`)

- **Base branch:** `main` only. There is no promotion flow and no DB. The site is static (React 19 + vite-react-ssg).
- **Merge style is mixed.** PRs #26–#29 and #39 used merge commits; #31 and #33–#35 were squashed ("Title (#N)"). There are also direct pushes to main (Jeremy Koenig's 2026-09-24 hero copy, "Add impeccable", a Cursor merge). Merge with `gh pr merge <n> --squash --delete-branch`, since that is Andrew's recent style. Cursor agents (`cursor/*`) also open PRs here.
- **Protection:** an org ruleset on the default branch blocks deletion and force-push only (org admins can bypass). There are no required reviews or checks.
- **CI:** `ci.yml` runs on PRs and on pushes to main, with jobs lint (+`check:assets`), test (vitest), build (+`check:links`), lighthouse (byte budgets fail the run, scores only warn) and a11y (Playwright+axe). These checks are **not required**, but the conductor should treat them as a gate.
- **Deploy:** Cloudflare **Workers Builds** (Git integration, `wrangler.jsonc` static assets from `./dist`) runs on every push to `main`. It reports as the check run "Workers Builds: via-marketing" on the merge commit, which is the signal to watch (`gh api repos/giant-partners/via-marketing/commits/<sha>/check-runs`). There is no GitHub workflow run. Preview builds go to non-main branches.
- **Live URL is unresolved.** `VITE_SITE_URL=https://via.tools`, but https://via.tools currently answers from **Apache** (an old site), not Cloudflare. The production hostname of the Worker is unknown.
- **Live checks:** load the changed routes on the production URL and confirm there are no 404s or console errors. The site needs no login and has no Sentry. Forms post to app.via.tools (`VITE_COMPLIANCE_API_URL`), so verify privacy-request form changes only up to submission.
- **Local test/QA:** `npm ci && npm run lint && npm run check:assets && npm run test:run && npm run build && npm run check:links`, `npm run test:a11y`, and `npm run dev` (:5173, or the worktree PORT).
- **Never automate:** legal and privacy pages (`/privacy*`, `/state-privacy-rights`, compliance forms) without Andrew's review. Do not change the DNS or Cloudflare settings, and do not submit real privacy requests to app.via.tools.

## VIA Prototype (`~/Work/via-prototype`, GitHub `giant-partners/via-prototype`)

- **What it is:** a clickable design prototype (React 19 + Vite) with mock data only, no backend, no auth and no DB. Read `AGENTS.md` (via `CLAUDE.md`).
- **Base branch:** `main` only. There is no promotion flow.
- **Merge style:** PRs merged as merge commits ("Merge pull request #N", #9–#19), plus an occasional direct push from Andrew. Merge with `gh pr merge <n> --merge --delete-branch`. There is no branch protection and no ruleset.
- **CI:** none on PRs. The only workflow is `deploy.yml`, and `npm run lint` is the only local check (there is no test suite).
- **Deploy:** `deploy.yml` ("Deploy to Vercel (Production)") runs on push to `main` (and `workflow_dispatch`). It does `vercel pull/build/deploy --prebuilt --prod` with repository secrets and has concurrency group `deploy-main`. Watch it with `gh run list -R giant-partners/via-prototype --workflow=deploy.yml --branch=main`. Live URL: https://via-prototype.vercel.app. The `vercel --prod` in AGENTS.md is the old manual path, so don't use it.
- **Live checks:** with agent-browser, open the changed routes on https://via-prototype.vercel.app and screenshot them in both dark and light themes. The login screen is a mock, so any input works. There is no Sentry or health endpoint, so check for console errors.
- **Local QA:** `npm ci && npm run lint && npm run build`, then `npm run dev` (binds the Developerly worktree PORT).
- **Never automate:** pages shown to named prospects (Trader Joe's proposal and Direct Mail pages) without Andrew's sign-off, because they are client-facing pricing. Do not run `vercel` CLI deploys or change Vercel secrets.

## Ping (`~/Work/ping`, GitHub `giant-partners/ping`)

- **What it is:** a Rails 8 API-only service for IP → UID2 token lookups, with a ~100ms budget. It has **no relational DB**: Redis is the system of record (accounts, profiles, tokens), runs as a Kamal accessory on the worker host and is loaded in bulk from Snowflake/S3.
- **Base branch:** `main` only. There is no promotion flow and no staging.
- **Merge style:** PRs as merge commits ("Merge pull request #N"), plus direct pushes from Andrew (e.g. "Add CLAUDE.md…", "Ignore ruby style"). Merge with `gh pr merge <n> --admin --merge` (branches are deleted on merge).
- **Protection:** `main` requires 1 approving review. `andrewkatz` is on the bypass list, so `--admin` is needed. There are no required status checks.
- **CI:** none on GitHub (there is no `.github`, and the actions config was removed). The gate is local `bin/ci`: it needs a clean, pushed branch and runs the lefthook `signoff` stage (brakeman, bundle-audit, rubocop, `rails test`), then `gh signoff`. Check that the `gh signoff` extension is installed before relying on it.
- **Deploy is manual:** `bin/deploy` = `kamal deploy` (Kamal 2.8.1) to AWS us-east-2. Hosts: web on 3.149.58.166 and 3.21.192.138; worker and scheduler on 3.149.58.166; image in ECR. Running it needs the AWS profile `p`, ECR login and env from `.envrc` (secrets, never print them). There is no workflow run to watch. **The conductor runs `bin/deploy` itself right after the merge (Andrew, 2026-10-14)**, with the env loaded from `.envrc` (`direnv exec ~/Work/ping bin/deploy`, run in the background with a 20 min timeout). The command's exit status and output are the deploy evidence. If the deploy fails, push to Andrew and don't retry more than once.
- **Migrations:** there are none (no SQL DB). Redis record formats are the schema. `Account.load` switches on the field count (2/5/6), so never break the old formats. Redis is not shared with VIA. VIA links to Ping by `accounts.ping_id` and Ping reports matches into Snowflake (`via.ping.ip_address_matches_<id>`).
- **Live checks:**
  - health: `GET /up` on each web host (`http://3.149.58.166/up`, `http://3.21.192.138/up` both return 200). `ping.giantpartners.com` from `docs/api.apib` did not resolve.
  - jobs: `GET /resque/stats` (queues, workers, failures, schedule)
  - errors go to ExceptionNotifier → AWS SNS. Sentry is not in the Gemfile, despite PR #18.
  - metrics: StatsD (`profiles.find.*`, `jobs.*`)
  - logs: `kamal app logs -r web|worker`
  - There is no UI, so there is nothing to QA in a browser. Live QA is a `profiles/find` request with a test account's `X-Api-Token`.
- **Local test/QA:** a local Redis on :6379 is required. Run `bundle exec rails test`, `bundle exec rubocop`, `bin/brakeman` and `bin/dev`. Snowflake is mocked in tests, but Redis is real and shared with `bin/dev`.
- **Never automate:**
  - `bin/load`, `bin/export`
  - `bin/whitelist_ip` (terraform apply `-auto-approve`) and any `terraform/`
  - `bin/reset`
  - `rake accounts:*` against production (enable/disable/limits/reset_now)
  - `kamal` accessory or redis commands
  - FLUSH or bulk writes to production Redis
  - Bulk loads from S3/Snowflake also cost money and take a long time.

## Cue (`~/Work/cue`, GitHub `andrewkatz/cue`)

- **Base:** `main`, PRs only (branches `andrewkatz/<slug>`), merged with merge commits ("Merge pull request #N"). No branch protection, so `gh pr merge --merge` after CI is green. Cue is a Rails 8 + Hotwire app that fronts Sonarr, Radarr and Plex.
- **CI:** `ci.yml` on PRs and pushes to main runs brakeman, bundler-audit, importmap audit, rubocop (`bundle exec rubocop` must be clean), `bin/rails db:test:prepare test` and `bin/rails test:system`. Locally run `bin/rails test` plus rubocop.
- **Deploy:** automatic. A green CI run on `main` triggers `deploy.yml` (`workflow_run`), which runs `kamal deploy` through the tailnet to katz-mini (arm64, built on the mini). Live at https://cue.katz.tools. Merging a PR is shipping.
- **Live check:** `curl -fsS https://cue.katz.tools/up` should return 200. Then confirm the Deploy run for the merge SHA is green (`gh run list -w Deploy -L 1`). UI checks need a login Andrew has not given the conductor, so queue a question if a task needs one.
- **Dev notes:** a new method on `SonarrClient` or `RadarrClient` must also be added to the fake client and `FakeArrStore`. Stub HTTP in tests (WebMock). Follow `docs/design-system.md` for views.
- **Never automate:** `kamal deploy` by hand, the `ops/` backup and cloudflared jobs on katz-mini, the Tailscale ACL and deploy SSH key, secrets, and the destructive `SyncArrLibraryJob` reconcile against real Sonarr/Radarr data. Do not point dev at the real arr URLs.

## Super Awesome Workout 4000 (`~/Work/super-awesome-workout-4000`, GitHub `andrewkatz/super-awesome-workout-4000`)

- **Base:** `main`. Feature work goes through PRs (#5 to #9, squash-style, no merge commits). Many commits are direct pushes to main: Instagram "Stage/Publish/Reject post" commits, and `Release vX-buildN`. There is no CI and no `.github`, so the worker's local test run is the only gate.
- **Test:** iOS app (SwiftUI, iOS 18+). `xcodebuild -project SuperAwesomeWorkout4000.xcodeproj -scheme SuperAwesomeWorkout4000 -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test`. There is also an Android port in `android/` (see `docs/ANDROID_*`) and a Vite marketing site in `marketing-site/`.
- **Deploy:** merging to main ships nothing. TestFlight goes out only through `bin/release`, which bumps the build, runs the tests, archives, uploads, tags `vX-buildN` and pushes. The marketing site deploys through `npm run deploy` (wrangler pages) to superawesomeworkout4000.com, and that is a manual step.
- **Live check:** after merge there is nothing live. Verify with a simulator build and tests. For site changes, `curl -fsS https://superawesomeworkout4000.com` after Andrew deploys.
- **Never automate:** `bin/release` and TestFlight/App Store/Play uploads. They need an App Store Connect key and publish to users. Also off limits: `wrangler pages deploy`, and the Instagram pipeline in `marketing/instagram`. That pipeline runs from cron on katz-mini, a human approves each post, and a push to main does nothing until the mini is pulled. Never publish posts, never `git clean` on the mini, and never touch `.env`.
- **Content rule:** a change to `ExerciseLibrary` or `WarmUpLibrary` also requires updating `scripts/generate-audio.sh` and regenerating the `.aiff` files.

## Katz Mac Stats (`~/Work/katz-mac-stats`, GitHub `andrewkatz/katz-mac-stats`)

- **Base:** `main`, PRs (#6 to #9, `andrewkatz/<slug>`) using squash-style merges. A few early commits went straight to main. No CI and no `.github`, and there is no test target.
- **Test:** the only gate is `make build`, which runs XcodeGen and a Release `xcodebuild` (ad-hoc signed). It is a macOS menu-bar app plus a Notification Center widget. It reads `~/.cache/codex-usage-bars.json` and `developerly status --plain`.
- **Deploy:** nothing is automatic. A Mac app is installed locally with `make install`, which replaces `/Applications/katz-mac-stats.app`. The conductor runs it after merge (Andrew: auto for all personal repos). It restarts the live menu-bar app.
- **Live check:** `pgrep -fl katz-mac-stats` shows the app running, `launchctl list | grep katzmacstats` shows it loaded, and a screenshot of the menu bar shows the three items.
- **Never automate:** changes to the Keychain/OAuth handling for the usage CLIs, and signing or entitlement changes (ad-hoc signing is deliberate).

## Race Spoilers (`~/Work/race-spoilers`, GitHub `andrewkatz/race-spoilers`)

- **Base:** `main`. Recent features go through PRs (#5 to #9, merge style unknown, treated as squash). `Release vX-buildN` commits and some early work were pushed straight to main. No `.github/workflows`, so no CI. The local test run is the only gate.
- **Test:** the Xcode project is generated. Never edit `RaceSpoilers.xcodeproj`; edit `project.yml`, run `xcodegen generate`, then `xcodebuild -project RaceSpoilers.xcodeproj -scheme RaceSpoilers -destination 'platform=iOS Simulator,name=iPhone 17' test`. Unit tests are pure logic only. FamilyControls (shields, DeviceActivity, notifications) works only on a physical device, so anything touching those needs Andrew to verify and goes to a question.
- **Deploy:** the iOS app is live on the App Store. `bin/release` uploads to TestFlight and tags `vX-buildN`, and App Store submission is separate and manual. The marketing site (`marketing-site/`) deploys on push to `main` through Cloudflare Workers Builds, so merging site changes publishes them. The site URL is not in the repo, so confirm it.
- **Live check:** for site changes, a Cloudflare Workers Builds status and a `curl` of the site. For the app, nothing automated; use the on-device checklist in Settings, Testing.
- **Never automate:** `bin/release`, TestFlight, App Store submission, and signing, entitlements or the Family Controls Distribution entitlement. Do not break the invariants in CLAUDE.md (single `ManagedSettingsStore(named: .raceSpoilers)`, stable session IDs, blocks never auto-expire).

## YNAB Daily Review (`~/Work/budget-review`, GitHub `andrewkatz/budget-review`)

- **Not found as named.** `~/Work/ynab-daily-review` does not exist. This is the closest match: `budget-review` (package "budget-daily-review"), migrated from YNAB to Actual Budget in June 2026, and the YNAB pipeline is gone. Confirm this is the right project.
- **Base:** `main`. Merged PRs #8 to #10, plus many direct pushes to main (target tweaks, docs, backup fixes). No CI and no `.github`.
- **Test:** `npm run typecheck` and `npm test` (vitest, via `scripts/with-node.sh`, Node pinned by mise). Run `mise trust && sh scripts/with-node.sh npm ci` first in a fresh worktree.
- **Deploy:** none. It is a set of manual CLIs run through `/review-transactions` against a self-hosted Actual server on katz-mini (https://katz-mini.tail3d1b31.ts.net). The only scheduled job is the launchd backup `com.giantpartners.budget-review-backup` (daily 12:30 and at login, healthchecks.io alerting), which runs from the live checkout.
- **Live check:** `launchctl list | grep budget-review-backup` shows exit status 0. `npm run check` reaches the Actual server.
- **Never automate:** anything that writes to the real budget (apply, apply-batch, allocate, budget-move, categorize). The write layer is guarded and rollbackable, but the budget is real money and manual by design. Also off limits: `.env`, `ACTUAL_BUDGET_PASSWORD`, `~/.local/state/budget-review/`, and the backup scripts or restic repo. Merging changes `ops/backup/macbook/` scripts that the launchd job runs from this checkout, so flag those to Andrew.

## dotfiles (`~/Work/dotfiles`, GitHub `andrewkatz/dotfiles`)

- **Base:** `main`. The repo is public. PRs exist (#1 to #3, 2026-06) but most history is direct pushes ("Updates"). No CI and no `.github`. The checkout on disk carries uncommitted edits to `dot-claude/` (Andrew's own work in progress), so use a worktree and never touch the main checkout's dirty files.
- **Live the moment it merges:** `~/.claude` is a symlink to `Work/dotfiles/dot-claude`, and other dot-files are stowed as well. A merge changes this checkout, so it changes live Claude Code settings, hooks, skills (including the conductor's own), shell config and Brewfile.
- **Test:** none automated. Use `bin/diff` (stow dry run), `zsh -n` or `bash -n` on shell files, `jq . dot-claude/settings.json`, and a shell or Claude Code start that still works.
- **Live check:** after merge, `bin/diff` reports no missing links, `jq . ~/.claude/settings.json` parses, and a fresh `claude -p "ok"` or `zsh -ic true` runs without errors.
- **Never automate:** committing anything secret (public repo; secrets live in the separate sops repo, `dotfiles-secrets`, `bin/ss`), running `bin/install` or `bin/update` (brew, stow, packages). Merging is authorized (Andrew: auto for all). After merge, `git -C ~/Work/dotfiles pull --ff-only` makes it live. If that fails because of Andrew's uncommitted edits, don't stash, reset or commit them; push to Andrew. A merged change to `dot-claude/skills/conductor/` takes effect for the next job, so say so in the `print:` line.

- Platform enum integers: ExternalAccount.service_type integers must be unique across ALL open branches and are allocated here; check before adding one: 0 facebook, 1 google_ad, 2 retired, 3 pinterest, 4 bing_ad, 5 linkedin, 6 hubspot_crm, 7 tiktok; next free 8 (ledger: platform_enum_allocation). Production only has rows for 0 and 1 (checked 2026-10-16).

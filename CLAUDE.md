# Public repo — no secrets

This repo is public. Never commit sensitive or private information: API keys, tokens, SSH/GPG private keys, credentials, internal hostnames or IPs, company-specific URLs, or anything else that shouldn't be world-readable. Secrets should be sourced from a secret manager, env vars, or files kept outside the repo. If you see something questionable about to be staged, stop and flag it before the commit.

# Repo layout

This is a GNU Stow-managed dotfiles repo.

- **`dot-` prefix convention** — files/dirs named `dot-foo` get symlinked to `~/.foo` when stowed (e.g., `dot-zshrc` → `~/.zshrc`, `dot-claude/settings.json` → `~/.claude/settings.json`). Use this prefix when adding new config that should land in `$HOME`.
- **Repo-local vs. stowed** — anything repo-scoped (like this file) must live at the repo root AND be listed in `.stow-local-ignore` so stow won't symlink it.
- **Package manifests** — `Brewfile` (macOS) and `Archfile` (Linux) are the source of truth for installed packages. Add new entries alphabetically. `Brewfile.lock.json` / `Archfile.lock` are generated — do not hand-edit.
- **Platform split** — `darwin/` and `linux/` hold OS-specific setup. Cross-platform config lives in `dot-*` at the root.
- **Primary platform** — macOS (darwin). Linux/Arch support exists for portability but is secondary.

# Working in this repo

- **Regressions → check git log first** — when something used to work, run `git log -- <file>` on the relevant config and bisect recent commits before theorizing.
- **Verify config keys against upstream docs** — for tools like hyprland, waybar, ghostty, etc., fetch the actual docs or source before proposing a key/value.
- **Don't preserve adjacent legacy defensively** — when modifying a keybind/hook/script, ask whether the surrounding old behavior should be removed too, rather than leaving it untouched "to be safe".

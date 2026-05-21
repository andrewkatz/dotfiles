# Dotfiles

Personal dotfiles, GNU Stow-managed.

## Initial Setup

```bash
git clone https://github.com/andrewkatz/dotfiles.git ~/Work/dotfiles
cd ~/Work/dotfiles
bin/install
```

On a fresh machine, `bin/install` can decrypt machine secrets after an age key is seeded at `~/.config/sops/age/keys.txt`. If the key is missing, install continues and prints next steps; re-run `bin/ss` after seeding it. See `docs/secrets.md`.

## Commands

- `bin/install` — install packages, Pi layout, dotfiles via stow, Developerly hooks, and secrets. **Back up first; stow will report conflicts for existing files.**
- `bin/install --only-stow` — only set up Pi layout and run stow.
- `bin/diff` — show what symlinks are missing (stow dry-run).
- `bin/ss` — decrypt machine secrets and write `~/.zsh_secrets`.
- `bin/migrate-from-1password` — one-shot migration from a 1Password item to the private sops repo.
- `bin/update` — update packages (brew/yay) and nvim plugins.

## tmux Developerly widgets

The tmux status bar delegates local LLM usage and agent activity to Developerly:

- `developerly usage show-compact` — compact token usage widget.
- `developerly status` — agent activity summary.

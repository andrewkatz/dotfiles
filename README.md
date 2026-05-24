# Dotfiles

Personal dotfiles, GNU Stow-managed.

## Initial Setup

```bash
git clone https://github.com/andrewkatz/dotfiles.git ~/Work/dotfiles
cd ~/Work/dotfiles
bin/install
```

Linux installs support profiles:

- `bin/install --profile dev` — full bare-Arch development desktop: shared dev packages plus Hyprland/Wayland tools, optional desktop apps, and desktop hooks. This is the default for a new Linux machine.
- `bin/install --profile minimal` — CachyOS/Plasma-friendly setup: shared dev packages, 1Password, Chromium, and dotfiles; skips Hyprland packages/autostart, optional desktop apps, and VoxType/GPU pacman hooks.
- `bin/install --profile wsl` — headless Arch on Windows WSL: shared CLI/dev packages only; skips fonts, GUI apps (ghostty, 1Password desktop, Chromium), Hyprland, and all desktop hooks.

All profiles stow the same dotfiles; the profile controls package selection, Hyprland autostart, and Linux desktop post-install hooks. The selected Linux profile is saved in `~/.local/state/dotfiles/linux-profile`, so future `bin/install` runs reuse it unless `--profile` or `DOTFILES_LINUX_PROFILE` overrides it. This repo does not install NVIDIA drivers; leave distro-managed GPU drivers alone unless you explicitly need the full desktop profile extras.

On a fresh machine, `bin/install` can decrypt machine secrets after an age key is seeded at `~/.config/sops/age/keys.txt`. If the key is missing, install continues and prints next steps; re-run `bin/ss` after seeding it. See `docs/secrets.md`.

## Commands

- `bin/install` — install packages, Pi layout, dotfiles via stow, Developerly hooks, and secrets. **Back up first; stow will report conflicts for existing files.**
- `bin/install --profile minimal` — Linux: install the CachyOS/Plasma-friendly shared development package set.
- `bin/install --profile dev` — Linux: install the full bare-Arch Hyprland workstation package set.
- `bin/install --profile wsl` — Linux: install the headless WSL CLI/dev package set (no GUI apps).
- `bin/install --only-stow` — only set up Pi layout and run stow.
- `bin/diff` — show what symlinks are missing (stow dry-run).
- `bin/ss` — decrypt machine secrets and write `~/.zsh_secrets`.
- `bin/migrate-from-1password` — one-shot migration from a 1Password item to the private sops repo.
- `bin/update` — update packages (brew/yay/paru) and nvim plugins.

## tmux Developerly widgets

The tmux status bar delegates local LLM usage and agent activity to Developerly:

- `developerly usage show-compact` — compact token usage widget.
- `developerly status` — agent activity summary.

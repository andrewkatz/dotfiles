# Dotfiles

Personal dotfiles, GNU Stow-managed.

## Initial Setup

```bash
git clone https://github.com/andrewkatz/dotfiles.git ~/Work/dotfiles
cd ~/Work/dotfiles
bin/install
```

## Commands

- `bin/install` — install all dotfiles via stow. **Overwrites existing files — back up first.**
- `bin/diff` — show what symlinks are missing (stow dry-run).
- `bin/update` — update packages (brew/yay) and nvim plugins.

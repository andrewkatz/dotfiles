alias reload='exec $SHELL -l'
alias ip='curl http://ipv4.icanhazip.com'
alias update='~/.bin/update'

# vim
alias vim='nvim'
alias ovim='/usr/local/bin/vim'
alias vimrc='vim ~/.vimrc'
alias zrc='nvim ~/.zshrc'

# ls
alias ls='eza'
alias ll='eza -lah'
alias lt='eza -lah -I .git --tree'

# cat
alias cat='bat'

# kill
alias k='kill -9'

# clean
alias rmo='rm **/*.orig'
alias clean='find ./**/*.orig | xargs rm'

# git
alias gp='git pull'
alias gph='git push'
alias gco='git checkout'
alias gc='git commit'
alias gcm='git commit -m'
alias gb='git branch'
alias gst='git stash'
alias gstp='git stash && git stash pop stash@{1}'
alias grm='git rm'
alias ga='git add'
alias gaa='git add -A'
alias gd='git diff'
alias gdc='git diff --cached'
alias grmc='git rm -r --cached'
alias gfo='git fetch origin'
alias gphu='gph -u origin'
alias gpha='gph andrewkatz'
alias gpho='gph origin'
alias gpom='gp origin main'
alias gcom='gco main'
alias gcon='gcom; gpom; gco -b'
alias gpod='gp origin development'
alias gcod='gco develop'
alias gcob='gcod && gp && gco -b'
alias gpp='gp --rebase && gph'
alias grh='git reset HEAD'
alias gm='git merge --no-ff'
alias gmff='git merge'
alias gbc='git fetch -p && git branch -vv | grep ": gone]" | awk "\$1 != \"+\" && \$1 != \"*\" {print \$1}" | xargs git branch -D'
alias gld='gp && gbc'
alias gbd='git branch --merged | grep -v "\*" | grep -v main | xargs -n 1 git branch -d'
alias gbds='git for-each-ref refs/heads/ "--format=%(refname:short)" | while read branch; do mergeBase=$(git merge-base main $branch) && [[ $(git cherry main $(git commit-tree $(git rev-parse $branch^{tree}) -p $mergeBase -m _)) == "-"* ]] && git branch -D $branch; done'
alias gpbd='gp ; gbd ; gbds'

# gh
alias gpq='gh pr create'
alias gpr='gh pr'
alias ghm='gh pr merge -md --admin ; gp'
alias rw='gh repo view -w'
alias prw='gh pr view -w'
alias prc='gh pr create'
alias prcf='gh pr create --fill'

# wt (worktrunk)
alias wtr='wt remove --force -D'
alias wts='wt switch'

function gbisect() {
  good=$1
  bad=${2:-"HEAD"}
  git bisect start ;
  git bisect bad $bad ;
  git bisect good $good ;
  git bisect run ~/git-bisect.sh ;
}

# brew
alias bs='brew services'
alias bss='brew services start'
alias bsr='brew services restart'
alias bsp='brew services stop'

# lazy
alias ld='lazydocker'
alias lg='lazygit'

# rails
alias rs='rails server'
alias rc='rails console'
alias b='bundle'
alias be='bundle exec'
alias fs='foreman start'
alias rdm='rails db:migrate'
alias pc='bin/production-console'

# terraform
alias t='terraform'
alias ti='terraform init'
alias ta='terraform apply'
alias tp='terraform plan'

# docker
alias dcu='docker-compose up -d'
alias dcd='docker-compose down'

# misc cli tools
alias snowsql=/Applications/SnowSQL.app/Contents/MacOS/snowsql
alias pm='open -a "Pixelmator Pro"'

# web + dev shortcuts
alias wd='web ; dev'

# tmux
function tm() {
  if ! tmux has-session 2>/dev/null; then
    tmux new-session -d -s "dev"
    tmux new-session -d -s "dotfiles"
    tmux send-keys -t "dotfiles" "cd dotfiles" C-m
    tmux send-keys -t "dotfiles" C-l

    ~/.config/tmux/plugins/tpm/bin/install_plugins >/dev/null
    ~/.config/tmux/plugins/tpm/bin/update_plugins all >/dev/null
  fi

  tmux attach-session -t "dev"
}

# ssh shortcuts (work)
# Targets and key paths live in ~/.zsh_secrets, generated from the private sops repo.
# Expected vars: WORK_SSH_KEY plus WORK_SSH_*_TARGET values like user@host.
_work_ssh() {
  local target_var="$1"
  local key_var="$2"
  shift 2

  local target="${(P)target_var}"
  local key=""
  if [[ -n "$key_var" ]]; then
    key="${(P)key_var}"
  fi

  if [[ -z "$target" ]]; then
    echo "Set $target_var in ~/.zsh_secrets (run bin/ss after updating sops secrets)." >&2
    return 1
  fi

  local -a ssh_args
  if [[ -n "$key" ]]; then
    ssh_args+=(-i "$key")
  fi

  ssh "${ssh_args[@]}" "$target" "$@"
}

ssh_core() { _work_ssh WORK_SSH_CORE_TARGET WORK_SSH_KEY "$@"; }
ssh_lg_api() { _work_ssh WORK_SSH_LG_API_TARGET WORK_SSH_KEY "$@"; }
ssh_whitelabel() { _work_ssh WORK_SSH_WHITELABEL_TARGET WORK_SSH_KEY "$@"; }
ssh_data_tunnel() { _work_ssh WORK_SSH_DATA_TUNNEL_TARGET "" "$@"; }
ssh_sftp() { _work_ssh WORK_SSH_SFTP_TARGET WORK_SSH_KEY "$@"; }

# VPN switching
es() {
  echo "ExpressVPN"
  expressvpnctl status

  echo "\nTailscale"
  tailscale status
}

ec() {
  echo "Disconnecting from Tailscale..."
  tailscale down

  echo "Connecting to ExpressVPN..."
  expressvpnctl connect
}

ed() {
  echo "Disconnecting from ExpressVPN..."
  expressvpnctl disconnect

  echo "Connecting to Tailscale..."
  tailscale up
}

# AI
alias crush='crush --yolo'
alias c="claude --model 'opus' --dangerously-skip-permissions"
alias cx="claude --allow-dangerously-skip-permissions --permission-mode plan --model 'opus'"
alias g='goose'
alias gr='goose session -r'

# yay (Linux)
alias yayf="yay -Slq | fzf --multi --preview 'yay -Sii {1}' --preview-window=down:75% | xargs -ro yay -S"

# Web apps (Linux)
function web2app() {
  if [ "$#" -ne 3 ]; then
    echo "Usage: web2app <AppName> <AppURL> <IconURL> (IconURL must be in PNG -- use https://dashboardicons.com)"
    return 1
  fi

  local APP_NAME="$1"
  local APP_URL="$2"
  local ICON_URL="$3"
  local ICON_DIR="$HOME/.local/share/applications/icons"
  local DESKTOP_FILE="$HOME/.local/share/applications/${APP_NAME}.desktop"
  local ICON_PATH="${ICON_DIR}/${APP_NAME}.png"

  mkdir -p "$ICON_DIR"

  if ! curl -sL -o "$ICON_PATH" "$ICON_URL"; then
    echo "Error: Failed to download icon."
    return 1
  fi

  cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Version=1.0
Name=$APP_NAME
Comment=$APP_NAME
Exec=chromium --new-window --ozone-platform=wayland --app="$APP_URL" --name="$APP_NAME" --class="$APP_NAME"
Terminal=false
Type=Application
Icon=$ICON_PATH
StartupNotify=true
EOF

  chmod +x "$DESKTOP_FILE"
}

function web2app-remove() {
  if [ "$#" -ne 1 ]; then
    echo "Usage: web2app-remove <AppName>"
    return 1
  fi

  local APP_NAME="$1"
  local ICON_DIR="$HOME/.local/share/applications/icons"
  local DESKTOP_FILE="$HOME/.local/share/applications/${APP_NAME}.desktop"
  local ICON_PATH="${ICON_DIR}/${APP_NAME}.png"

  rm "$DESKTOP_FILE"
  rm "$ICON_PATH"
}

# Function files are sourced from dot-zshrc after compinit so that
# compdef calls (used by ~/.zsh/functions/dirs.zsh) work correctly.

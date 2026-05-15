zstyle ':completion:*' use-cache on
zstyle ':completion:*' cache-path "$HOME/.zsh/compcache"
zstyle ':completion:*' menu select

# fuzzy matching
zstyle ':completion:*' matcher-list 'm:{[:lower:][:upper:]}={[:upper:][:lower:]}' 'r:|=*' 'l:|=* r:|=*'

# fzf tab config
zstyle ':completion:*:git-checkout:*' sort false # disable sort when completing `git checkout`
zstyle ':completion:*:descriptions' format '[%d]' # set descriptions format to enable group support
zstyle ':completion:*' list-colors ${(s.:.)LS_COLORS} # set list-colors to enable filename colorizing
zstyle ':completion:*' menu no # force zsh not to show completion menu, which allows fzf-tab to capture the unambiguous prefix
zstyle ':fzf-tab:complete:cd:*' fzf-preview 'eza -1 --color=always $realpath' # preview directory's content with eza when completing cd
zstyle ':fzf-tab:*' switch-group '<' '>' # switch group using `<` and `>`

fpath=(~/.zsh/completions $fpath)
# compinit is invoked from .zshrc after zinit finishes loading plugins
# so that queued compdefs can be replayed via `zinit cdreplay`.

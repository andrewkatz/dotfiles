function pi() {
  local -a flags
  [[ -n "$PI_DEFAULT_PROVIDER" ]] && flags+=(--provider "$PI_DEFAULT_PROVIDER")
  [[ -n "$PI_DEFAULT_MODEL" ]]    && flags+=(--model    "$PI_DEFAULT_MODEL")
  command pi "${flags[@]}" "$@"
}

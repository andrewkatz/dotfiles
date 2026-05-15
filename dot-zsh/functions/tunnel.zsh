function tunnel() {
  if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: tunnel <local_host>:<local_port> <remote_host>:<remote_port>"
    return 1
  fi

  local local_part="$1"
  local remote_part="$2"

  local local_host="${local_part%%:*}"
  local local_port="${local_part##*:}"
  local remote_host="${remote_part%%:*}"
  local remote_port="${remote_part##*:}"

  echo "Tunneling ${local_host}:${local_port} -> ${remote_host}:${remote_port}"
  ssh -f -N -L "${local_port}:localhost:${remote_port}" "${remote_host}"
  echo "Tunnel established (PID: $(pgrep -f "ssh.*-L.*${local_port}.*${remote_host}" | tail -1))"
}

#!/usr/bin/env bash

# Log messages go to stderr so functions that return data via stdout (e.g.
# get_machine_name in bin/ss) aren't corrupted by log output captured via $(...).
log() {
  blue='\033[0;34m'
  green='\033[0;32m'
  nc='\033[0m'
  echo -e "${blue}[$(date +'%Y-%m-%d %H:%M:%S')]${nc} ${green}$1${nc}" >&2
}

log_error() {
  red='\033[0;31m'
  nc='\033[0m'
  echo -e "${red}[$(date +'%Y-%m-%d %H:%M:%S')] $1${nc}" >&2
}

#!/usr/bin/env bash

clean_stow_output() {
  grep -v "level of" | grep -v "stow dir" | grep -v "Planning stow" | grep -v "Processing tasks" | \
sed -E 's/--- Skipping ([^ ]+) .*/[-] \1/' | \
sed -E $'s/LINK: ([^ ]+) => .+/\033[32m[+]\033[0m \\1/'
}

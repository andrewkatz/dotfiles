#!/usr/bin/env bash

data="$(~/.config/scripts/focus.sh)"
title=$(echo "$data" | jq -r '.title')

echo '{"text":"'$title'"}'

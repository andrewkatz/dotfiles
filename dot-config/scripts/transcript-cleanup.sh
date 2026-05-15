#!/usr/bin/env bash

TRANSCRIPT=$(cat)

exec ollama run llama3.2:1b \
  --system "You are a helpful assistant that cleans up transcripts by removing filler words, stutters, unnecessary repetitions, and self-corrections while preserving the original meaning and context. When the speaker corrects themselves (e.g., 'Tuesday. No, actually, I mean Wednesday'), keep only the correction ('Wednesday')." \
  --prompt "Clean up the following transcript by:
1. Removing filler words (like 'um', 'uh', 'like')
2. Removing stutters and unnecessary repetitions
3. Handling self-corrections - when the speaker says something then corrects themselves (e.g., 'Tuesday, no actually Wednesday' or 'I mean Wednesday'), keep only the final corrected version
4. Preserve the original meaning and context

Transcript:
$TRANSCRIPT"

#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Ask Gemini in Browser
# @raycast.mode silent

# Optional parameters:
# @raycast.icon ✦
# @raycast.packageName Gemini
# @raycast.description Start a new Gemini chat in Safari
# @raycast.argument1 { "type": "text", "placeholder": "Ask Gemini" }

prompt="$1"

osascript - "$prompt" <<'APPLESCRIPT'
on run argv
  set promptText to item 1 of argv
  set targetTab to missing value
  set promptReady to false

  do shell script "open https://gemini.google.com/app"

  -- Wait for Safari to open the Gemini tab.
  repeat 100 times
    tell application "Safari"
      if (count of windows) > 0 then
        set candidateTab to current tab of front window
        if URL of candidateTab starts with "https://gemini.google.com/" then
          set targetTab to candidateTab
          exit repeat
        end if
      end if
    end tell
    delay 0.1
  end repeat

  if targetTab is missing value then
    display notification "Gemini did not open in Safari." with title "Ask Gemini"
    return
  end if

  -- Wait for Gemini's visible prompt editor, then focus it.
  repeat 150 times
    try
      tell application "Safari"
        set promptReady to do JavaScript "(() => { const editor = [...document.querySelectorAll('[contenteditable=true]')].find(el => el.offsetParent !== null); if (!editor) return false; editor.focus(); return document.activeElement === editor; })()" in targetTab
      end tell
      if promptReady is true then exit repeat
    end try
    delay 0.1
  end repeat

  if promptReady is false then
    display notification "Gemini's prompt did not become ready." with title "Ask Gemini"
    return
  end if

  set savedClipboard to the clipboard as record
  set the clipboard to promptText
  tell application "Safari" to activate
  tell application "System Events"
    keystroke "v" using command down
    delay 0.1
    set the clipboard to savedClipboard
    key code 36
  end tell
end run
APPLESCRIPT

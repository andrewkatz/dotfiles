---
description: Hand the conductor a task to create and start now, outside its limits (e.g. /rush investigate why Acme's export failed)
argument-hint: <what to do or investigate>
---

Send this request to the conductor session so it creates a developerly task and launches it immediately.

1. SendMessage to `conductor` with exactly: `rush: $ARGUMENTS`
   Add one line of context only if this conversation already holds something the conductor can't see and the request depends on it (a pasted error, record id, client name, link). Don't investigate or spec it yourself.
2. If SendMessage fails because no `conductor` session exists, say so in one line and suggest `conductor-restart`.
3. Reply in one line: "Sent to the conductor; it'll start the task and report the id." Then stop.

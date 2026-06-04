# calendar-blocker

Mirrors flagged personal Google Calendar events to the work calendar as generic `Unavailable` blocks.

- Source calendar: personal/shared calendar (for example, `Caitlin and Andrew`).
- Target calendar: work calendar (for example, Giant Partners).
- Trigger: source event title/summary starts with `Andrew -` or contains `▫️`.
- Timed events are blocked with a 30-minute buffer before and after by default.
- Target events are private, reminder-free, and tagged with private extended properties so the script can update/delete only its own blockers.

## Setup

```bash
cp ~/.config/scripts/calendar-blocker/env.example ~/.config/calendar-blocker.env
chmod 600 ~/.config/calendar-blocker.env
mkdir -p ~/.config/calendar-blocker
```

Create a Google Cloud OAuth **Desktop** client with Calendar API enabled, download the JSON, and save it as:

```bash
~/.config/calendar-blocker/client_secret.json
```

Authorize the account that can read the source calendar and the account that can write the target calendar:

```bash
~/.config/scripts/calendar-blocker/sync --authorize source
~/.config/scripts/calendar-blocker/sync --list-calendars source

~/.config/scripts/calendar-blocker/sync --authorize target
~/.config/scripts/calendar-blocker/sync --list-calendars target
```

On a headless machine, pick a fixed auth port and SSH-forward it first, for example:

```bash
ssh -L 53682:127.0.0.1:53682 catstash
~/.config/scripts/calendar-blocker/sync --authorize source --auth-port 53682 --no-browser
```

Then open the printed URL locally.

Put the `Caitlin and Andrew` calendar ID in `CALENDAR_BLOCKER_SOURCE_CALENDAR_ID` and the work calendar ID in `CALENDAR_BLOCKER_TARGET_CALENDAR_ID`.

If one Google account can do both, set `CALENDAR_BLOCKER_SOURCE_TOKEN_FILE` and `CALENDAR_BLOCKER_TARGET_TOKEN_FILE` to the same path and authorize once.

Trigger and buffer settings live in `~/.config/calendar-blocker.env`:

```bash
CALENDAR_BLOCKER_TITLE_PREFIX="Andrew -"
CALENDAR_BLOCKER_TITLE_CONTAINS_MARKERS="▫️"
CALENDAR_BLOCKER_BUFFER_BEFORE_MINUTES="30"
CALENDAR_BLOCKER_BUFFER_AFTER_MINUTES="30"
```

`CALENDAR_BLOCKER_TITLE_CONTAINS_MARKERS` is comma-separated if you want more markers. All-day source events stay all-day.

## Test

```bash
~/.config/scripts/calendar-blocker/sync --dry-run
~/.config/scripts/calendar-blocker/sync
```

## Schedule

macOS:

```bash
~/.config/scripts/calendar-blocker/install-launchagent
```

Linux/systemd user timer:

```bash
~/.config/scripts/calendar-blocker/install-systemd-user
```

The default interval is five minutes.

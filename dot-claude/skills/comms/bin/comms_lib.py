"""Shared pieces of the comms worker: policy levels, the outbox, the senders, the Telegram approval bot.

Levels per kind of message ("<category>/<audience>", e.g. "scheduling/internal"):
  shadow  - drafted and graded only (default for everything)
  one-tap - drafted, then offered to Andrew with Send / Edit / Skip
  auto    - queued to send by itself after the hold; Andrew can Stop it (internal audience only)
Promotion to one-tap is Andrew's call (the scoreboard marks candidates). one-tap -> auto happens after
AUTO_STREAK unedited sends in a row for an internal audience; any edit, skip or stop demotes auto -> one-tap.

Nothing is ever offered when the draft is tagged sensitive, needs Andrew's input, goes to a new contact,
or the worker is paused. Every send waits HOLD_SECONDS after approval and can be stopped.
Credentials live in ~/.config/comms (chmod 600), never in the repo:
  google-send.json  (gmail.send + chat.messages.create only; see `comms-auth google`)
  slack-send.json   ({"token": "xoxp-..."} with chat:write)
  telegram.json     ({"token": ..., "chat_id": ...} for the comms approval bot)
"""
import base64, contextlib, datetime, email.message, email.utils, fcntl, json, os, re, time, urllib.parse, urllib.request

STATE_DIR = os.path.expanduser("~/.local/share/comms")
CONF_DIR = os.path.expanduser("~/.config/comms")
OUTBOX = os.path.join(STATE_DIR, "outbox.json")
POLICY = os.path.join(STATE_DIR, "policy.json")
SENT_LOG = os.path.join(STATE_DIR, "sent.jsonl")
PAUSED = os.path.join(STATE_DIR, "PAUSED")
ME = "andrew@giantpartners.com"
ME_NAME = "Andrew Katz"
HOLD_SECONDS = 300
AUTO_STREAK = 5
DAILY_CAP = 25
LEVELS = ("shadow", "one-tap", "auto")


def now():
    return time.time()


def pst(ts=None):
    return datetime.datetime.fromtimestamp(ts or now()).strftime("%-I:%M%p").lower()


@contextlib.contextmanager
def locked(name):
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(os.path.join(STATE_DIR, f".{name}.lock"), "w") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        yield


def _read(path, default):
    try:
        return json.load(open(path))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _write(path, data):
    tmp = path + ".tmp"
    json.dump(data, open(tmp, "w"), indent=1)
    os.replace(tmp, path)


def conf(name):
    return _read(os.path.join(CONF_DIR, name), None)


def save_conf(name, data):
    os.makedirs(CONF_DIR, mode=0o700, exist_ok=True)
    path = os.path.join(CONF_DIR, name)
    _write(path, data)
    os.chmod(path, 0o600)


# ---------------------------------------------------------------- policy

def kind(draft):
    return f"{draft.get('category', '?')}/{draft.get('audience', '?')}"


def policy():
    return _read(POLICY, {"kinds": {}})


def level(k):
    return policy()["kinds"].get(k, {}).get("level", "shadow")


def set_level(k, lvl, why):
    assert lvl in LEVELS
    with locked("policy"):
        p = policy()
        e = p["kinds"].setdefault(k, {"level": "shadow", "streak": 0, "history": []})
        e["level"] = lvl
        e["history"].append({"ts": now(), "level": lvl, "why": why})
        _write(POLICY, p)


def record_outcome(k, outcome, audience):
    """outcome: sent-unedited | sent-edited | skipped | stopped. Returns a note if the level changed."""
    with locked("policy"):
        p = policy()
        e = p["kinds"].setdefault(k, {"level": "shadow", "streak": 0, "history": []})
        note = ""
        if outcome == "sent-unedited":
            e["streak"] = e.get("streak", 0) + 1
            if e["level"] == "one-tap" and e["streak"] >= AUTO_STREAK and audience == "internal":
                e["level"] = "auto"
                e["history"].append({"ts": now(), "level": "auto", "why": f"{AUTO_STREAK} unedited sends in a row"})
                note = f"{k} now sends automatically (after a {HOLD_SECONDS // 60}-min hold you can stop)"
        else:
            e["streak"] = 0
            if e["level"] == "auto":
                e["level"] = "one-tap"
                e["history"].append({"ts": now(), "level": "one-tap", "why": outcome})
                note = f"{k} is back to one-tap ({outcome})"
        _write(POLICY, p)
        return note


def eligible(item):
    """Why this draft may not be offered ('' = it may)."""
    d = item.get("draft") or {}
    if os.path.exists(PAUSED):
        return "paused"
    if not d.get("needs_reply"):
        return "no reply needed"
    if d.get("needs_input") or re.search(r"\[[^\]]+\]", d.get("draft", "")):
        return "needs Andrew's input"
    if d.get("sensitive"):
        return "sensitive: " + ", ".join(d["sensitive"])
    if item.get("new_contact"):
        return "new contact"
    if not item.get("reply"):
        return "no reply target"
    if not can_send(item.get("source")):
        return f"no {item.get('source')} send access"
    if level(kind(d)) == "shadow":
        return "kind is shadow-only"
    return ""


# ---------------------------------------------------------------- outbox

def outbox():
    return _read(OUTBOX, {"items": {}})


def update(oid, **kw):
    with locked("outbox"):
        ob = outbox()
        ob["items"][oid].update(kw)
        _write(OUTBOX, ob)
        return ob["items"][oid]


def propose(item):
    """Put a draft in the outbox. auto kinds are approved at once (hold applies)."""
    d = item["draft"]
    k = kind(d)
    lvl = level(k)
    oid = "O" + str(int(now() * 1000))[-9:]
    entry = {"id": oid, "shadow_id": item["id"], "source": item["source"], "sender": item.get("sender"),
             "context": item.get("context"), "incoming": item.get("text", "")[:1500], "link": item.get("link"),
             "reply": item["reply"], "draft": d["draft"], "text": d["draft"], "kind": k, "audience": d.get("audience"),
             "level": lvl, "status": "proposed", "created": now(), "msg_ts": item.get("ts_epoch"),
             "key": item.get("key"), "channel": item.get("channel"), "is_dm": item.get("is_dm")}
    if lvl == "auto":
        entry.update(status="holding", approved=now(), send_at=now() + HOLD_SECONDS, approved_by="auto", edited=False)
    with locked("outbox"):
        ob = outbox()
        if any(e["shadow_id"] == item["id"] for e in ob["items"].values()):
            return None
        ob["items"][oid] = entry
        _write(OUTBOX, ob)
    telegram_card(entry)
    return entry


def approve(oid, text=None, by="andrew"):
    e = outbox()["items"][oid]
    if e["status"] not in ("proposed",):
        return e
    edited = bool(text and text.strip() != e["draft"].strip())
    e = update(oid, status="holding", text=(text or e["draft"]).strip(), edited=edited, approved=now(),
               send_at=now() + HOLD_SECONDS, approved_by=by)
    telegram_card(e)
    return e


def skip(oid, by="andrew"):
    e = update(oid, status="skipped", closed=now(), closed_by=by)
    note = record_outcome(e["kind"], "skipped", e.get("audience"))
    telegram_card(e, note)
    return e


def stop(oid, by="andrew"):
    e = outbox()["items"][oid]
    if e["status"] != "holding":
        return e
    e = update(oid, status="stopped", closed=now(), closed_by=by)
    note = record_outcome(e["kind"], "stopped", e.get("audience"))
    telegram_card(e, note)
    return e


def sent_today():
    start = datetime.datetime.now().replace(hour=0, minute=0, second=0).timestamp()
    return sum(1 for e in outbox()["items"].values() if e["status"] == "sent" and e.get("sent_at", 0) >= start)


# ---------------------------------------------------------------- senders

def _http(url, data=None, headers=None, method=None):
    body = json.dumps(data).encode() if isinstance(data, (dict, list)) else data
    req = urllib.request.Request(url, data=body, method=method or ("POST" if body is not None else "GET"),
                                 headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"{}")


def google_token():
    c = conf("google-send.json")
    if not c:
        raise RuntimeError("no Google send credential (run comms-auth google)")
    if c.get("access_token") and c.get("expires_at", 0) > now() + 60:
        return c["access_token"]
    body = urllib.parse.urlencode({"client_id": c["client_id"], "client_secret": c["client_secret"],
                                   "refresh_token": c["refresh_token"], "grant_type": "refresh_token"}).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    t = json.loads(urllib.request.urlopen(req, timeout=30).read())
    c.update(access_token=t["access_token"], expires_at=now() + int(t.get("expires_in", 3600)))
    save_conf("google-send.json", c)
    return c["access_token"]


def _addrs(*fields):
    out = []
    for name, addr in email.utils.getaddresses([f for f in fields if f]):
        if addr and addr.lower() != ME and not re.search(r"no-?reply|notifications?@|mailer-daemon", addr, re.I):
            if addr.lower() not in [a.lower() for _, a in out]:
                out.append((name, addr))
    return out


def gmail_recipients(r):
    to = _addrs(r.get("reply_to") or r.get("from"))
    cc = [x for x in _addrs(r.get("to"), r.get("cc")) if x[1].lower() not in [a.lower() for _, a in to]]
    return to, cc


def send_gmail(e):
    r = e["reply"]
    to, cc = gmail_recipients(r)
    if not to:
        raise RuntimeError("no reply address")
    m = email.message.EmailMessage()
    m["From"] = email.utils.formataddr((ME_NAME, ME))
    m["To"] = ", ".join(email.utils.formataddr(x) for x in to)
    if cc:
        m["Cc"] = ", ".join(email.utils.formataddr(x) for x in cc)
    subj = r.get("subject") or ""
    m["Subject"] = subj if subj.lower().startswith("re:") else "Re: " + subj
    if r.get("message_id"):
        m["In-Reply-To"] = r["message_id"]
        m["References"] = ((r.get("references") or "") + " " + r["message_id"]).strip()
    m.set_content(e["text"])
    raw = base64.urlsafe_b64encode(m.as_bytes()).decode()
    res = _http("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {"raw": raw, "threadId": r.get("thread_hex")},
                {"Authorization": "Bearer " + google_token()})
    return {"id": res.get("id"), "to": m["To"], "cc": m.get("Cc", "")}


def send_chat(e):
    r = e["reply"]
    body = {"text": e["text"]}
    url = f"https://chat.googleapis.com/v1/{r['space']}/messages"
    if r.get("thread"):
        body["thread"] = {"name": r["thread"]}
        url += "?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD"
    res = _http(url, body, {"Authorization": "Bearer " + google_token()})
    return {"id": res.get("name")}


def send_slack(e):
    c = conf("slack-send.json")
    if not c:
        raise RuntimeError("no Slack send credential (run comms-auth slack)")
    r = e["reply"]
    body = {"channel": r["channel"], "text": e["text"]}
    if r.get("thread_ts"):
        body["thread_ts"] = r["thread_ts"]
    res = _http("https://slack.com/api/chat.postMessage", body, {"Authorization": "Bearer " + c["token"]})
    if not res.get("ok"):
        raise RuntimeError("slack: " + str(res.get("error")))
    return {"id": res.get("ts")}


SENDERS = {"gmail": send_gmail, "chat": send_chat, "slack": send_slack}


def can_send(source):
    return bool(conf("slack-send.json") if source == "slack" else conf("google-send.json"))


def describe_target(e):
    r = e["reply"]
    if e["source"] == "gmail":
        to, cc = gmail_recipients(r)
        return "email to " + ", ".join(a for _, a in to) + (f" (cc {', '.join(a for _, a in cc)})" if cc else "")
    return f"{e['source']} · {e.get('context') or ''}"


def log_sent(e, result):
    with open(SENT_LOG, "a") as fh:
        fh.write(json.dumps({"ts": now(), "id": e["id"], "source": e["source"], "to": describe_target(e),
                             "kind": e["kind"], "edited": e.get("edited"), "approved_by": e.get("approved_by"),
                             "text": e["text"], "result": result}) + "\n")


# ---------------------------------------------------------------- telegram approval bot

def tg(method, **params):
    c = conf("telegram.json")
    if not c:
        return None
    return _http(f"https://api.telegram.org/bot{c['token']}/{method}", params)


def card_text(e, note=""):
    status = {"proposed": "Reply ready", "holding": f"Sending at {pst(e.get('send_at'))}",
              "sent": "Sent", "skipped": "Skipped", "stopped": "Stopped", "failed": "Failed",
              "cancelled": "Cancelled"}.get(e["status"], e["status"])
    lines = [f"{status} · {e.get('sender') or ''} · {describe_target(e)}", "",
             "They wrote:", (e.get("incoming") or "")[:500], "", "Reply:", e["text"]]
    if e.get("error"):
        lines += ["", "Error: " + e["error"][:200]]
    if e.get("cancel_reason"):
        lines += ["", e["cancel_reason"]]
    if note:
        lines += ["", note]
    return "\n".join(lines)[:4000]


def card_buttons(e):
    if e["status"] == "proposed":
        row = [{"text": "Send", "callback_data": f"send:{e['id']}"}, {"text": "Edit", "callback_data": f"edit:{e['id']}"},
               {"text": "Skip", "callback_data": f"skip:{e['id']}"}]
        return {"inline_keyboard": [row]}
    if e["status"] == "holding":
        return {"inline_keyboard": [[{"text": "Stop", "callback_data": f"stop:{e['id']}"}]]}
    return {"inline_keyboard": []}


def telegram_card(e, note=""):
    c = conf("telegram.json")
    if not c or not c.get("chat_id"):
        return
    try:
        if e.get("tg_message_id"):
            tg("editMessageText", chat_id=c["chat_id"], message_id=e["tg_message_id"], text=card_text(e, note),
               reply_markup=card_buttons(e), disable_web_page_preview=True)
        else:
            res = tg("sendMessage", chat_id=c["chat_id"], text=card_text(e, note), reply_markup=card_buttons(e),
                     disable_web_page_preview=True)
            update(e["id"], tg_message_id=res["result"]["message_id"])
    except Exception:  # noqa: BLE001  (Telegram is a convenience; the outbox is the source of truth)
        pass

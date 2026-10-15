# Runs ON katz-mini (piped over ssh by comms-shadow). Read-only: reads Hermes datasets and fetches
# Gmail message bodies with the existing gmail.readonly credential. Never writes anything.
#   python3 - candidates SINCE_EPOCH         messages needing Andrew's reply, with thread + his past messages
#   python3 - replies BASE64_JSON             Andrew's first reply after each given message, if any
import base64, glob, html, json, os, re, sys, time

DS = os.path.expanduser("~/.hermes/datasets")
sys.path.insert(0, os.path.expanduser("~/.hermes/sync"))
import sync  # noqa: E402  (only its Gmail GET helper is used)

ME = "andrew@giantpartners.com"
SOURCES = ("gmail", "chat", "slack")
CAP = 1800  # chars per message passed on


def records(since):
    month = time.strftime("%Y-%m", time.localtime(since))
    for src in SOURCES:
        for f in sorted(glob.glob(f"{DS}/{src}/*.ndjson")):
            if os.path.basename(f)[:7] < month:
                continue
            for line in open(f):
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                if d.get("ts_epoch", 0) >= since:
                    yield d


def key(d):
    r = d.get("raw") or {}
    s = d["source"]
    if s == "gmail":
        return "gmail:" + str(r.get("thread_id"))
    if s == "chat":
        return "chat:" + (r.get("space_id") if r.get("is_dm") else str(r.get("thread_id")))
    if r.get("is_dm"):
        return "slack:" + str(r.get("channel_id"))
    return f"slack:{r.get('channel_id')}:{r.get('thread_ts') or r.get('ts')}"


def channel(d):
    r = d.get("raw") or {}
    return {"chat": r.get("space_id"), "slack": r.get("channel_id")}.get(d["source"])


def link(d):
    r = d.get("raw") or {}
    if d["source"] == "gmail":
        try:
            return "https://mail.google.com/mail/u/1/#all/" + format(int(r.get("thread_id")), "x")
        except (TypeError, ValueError):
            return ""
    return r.get("space_uri") or r.get("permalink_hint") or ""


def strip_quote(text):
    out = []
    for line in text.splitlines():
        if re.match(r"\s*On .{5,200} wrote:\s*$", line) or line.strip().startswith("-----Original Message"):
            break
        if line.startswith(">"):
            continue
        out.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


def body(payload):
    """text/plain from a Gmail payload (falls back to stripped text/html)."""
    plain, htm = [], []

    def walk(p):
        mt, data = p.get("mimeType", ""), (p.get("body") or {}).get("data")
        if data and mt == "text/plain":
            plain.append(base64.urlsafe_b64decode(data + "==").decode("utf-8", "replace"))
        elif data and mt == "text/html":
            htm.append(base64.urlsafe_b64decode(data + "==").decode("utf-8", "replace"))
        for c in p.get("parts") or []:
            walk(c)
    walk(payload or {})
    if plain:
        return "\n".join(plain)
    t = re.sub(r"(?is)<(script|style).*?</\1>", "", "\n".join(htm))
    t = re.sub(r"(?i)<br\s*/?>|</p>|</div>", "\n", t)
    return html.unescape(re.sub(r"<[^>]+>", "", t))


def hdr(msg, name):
    for h in (msg.get("payload") or {}).get("headers") or []:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def gmail_thread(thread_decimal):
    try:
        t = sync._gmail_get("/threads/" + format(int(thread_decimal), "x"), {"format": "full"}, "shadow")
    except Exception as e:  # noqa: BLE001
        return [], str(e)
    msgs = []
    for m in (t or {}).get("messages") or []:
        frm = hdr(m, "From")
        msgs.append({"from": frm, "from_me": ME in frm.lower(), "ts_epoch": int(m.get("internalDate", 0)) / 1000,
                     "time_pst": time.strftime("%Y-%m-%d %H:%M", time.localtime(int(m.get("internalDate", 0)) / 1000)),
                     "to": hdr(m, "To"), "cc": hdr(m, "Cc"), "reply_to": hdr(m, "Reply-To"), "subject": hdr(m, "Subject"),
                     "message_id": hdr(m, "Message-ID") or hdr(m, "Message-Id"), "references": hdr(m, "References"),
                     "thread_hex": t.get("id"), "text": strip_quote(body(m.get("payload")))[:CAP], "uid": m.get("id")})
    return msgs, ""


def gmail_message(uid):
    try:
        m = sync._gmail_get("/messages/" + uid, {"format": "full"}, "shadow")
    except Exception:  # noqa: BLE001
        return ""
    return strip_quote(body((m or {}).get("payload")))[:CAP] if m else ""


def sender_addr(s):
    m = re.search(r"<([^>]+)>", s or "")
    return (m.group(1) if m else (s or "")).strip().lower()


def candidates(since):
    look = since - 14 * 86400
    allrecs = list(records(look))
    mine = [d for d in allrecs if d.get("from_me")]
    out = []
    for d in allrecs:
        if d.get("from_me") or not d.get("needs_attention") or d["ts_epoch"] < since:
            continue
        k = key(d)
        item = {"id": d["id"], "source": d["source"], "account": d.get("account"), "ts_epoch": d["ts_epoch"],
                "time_pst": d.get("time_pst"), "sender": d.get("sender"), "context": d.get("context"),
                "is_dm": bool((d.get("raw") or {}).get("is_dm")), "flags": d.get("flags"), "key": k,
                "channel": channel(d), "link": link(d), "text": d.get("text", "")[:CAP]}
        if d["source"] == "gmail":
            thread, err = gmail_thread((d.get("raw") or {}).get("thread_id"))
            if err:
                item["fetch_error"] = err[:200]
            # the incoming message itself (full text) and what came before it
            this = next((m for m in thread if m["uid"] == (d.get("raw") or {}).get("uid")), None)
            if this:
                item["text"] = this["text"]
                item["reply"] = {"thread_hex": this["thread_hex"], "message_id": this["message_id"],
                                 "references": this["references"], "subject": this["subject"], "from": this["from"],
                                 "reply_to": this["reply_to"], "to": this["to"], "cc": this["cc"]}
            item["thread"] = [m for m in thread if m["ts_epoch"] < d["ts_epoch"] - 1][-6:]
            addr = sender_addr(d.get("sender"))
            before = [m for m in mine if m["ts_epoch"] < d["ts_epoch"]]
            to_them = [m for m in before if m["source"] == "gmail" and addr and addr in str((m.get("raw") or {}).get("to", "")).lower()]
            item["new_contact"] = not to_them
            pool = to_them[-3:] or [m for m in before if m["source"] == "gmail"][-3:]
            item["examples"] = [x for x in (gmail_message((m.get("raw") or {}).get("uid", "")) for m in pool) if x]
        else:
            r = d.get("raw") or {}
            if d["source"] == "chat":
                item["reply"] = {"space": r.get("space_id"), "thread": None if r.get("is_dm") else r.get("thread_id")}
            else:
                item["reply"] = {"channel": r.get("channel_id"),
                                 "thread_ts": None if r.get("is_dm") and not r.get("thread_ts") else (r.get("thread_ts") or r.get("ts"))}
            thread = [x for x in allrecs if key(x) == k and x["ts_epoch"] < d["ts_epoch"]]
            item["thread"] = [{"from": x.get("sender"), "from_me": bool(x.get("from_me")), "time_pst": x.get("time_pst"),
                               "text": x.get("text", "")[:CAP]} for x in thread[-8:]]
            before = [m for m in mine if m["ts_epoch"] < d["ts_epoch"]]  # never show the drafter his later replies
            same = [m for m in before if m["source"] == d["source"] and channel(m) == channel(d)]
            item["new_contact"] = not same
            item["examples"] = [m.get("text", "")[:600] for m in (same or [m for m in before if m["source"] == d["source"]])[-6:]]
        out.append(item)
    # one draft per burst: drop a message when a later one in the same conversation came before Andrew replied
    mine_by_key = {}
    for m in mine:
        mine_by_key.setdefault(key(m), []).append(m["ts_epoch"])
    keep = []
    for i in out:
        later = [j for j in out if j["key"] == i["key"] and j["ts_epoch"] > i["ts_epoch"]]
        nxt = min((j["ts_epoch"] for j in later), default=None)
        if nxt and not any(i["ts_epoch"] < t < nxt for t in mine_by_key.get(i["key"], [])):
            continue
        keep.append(i)
    print(json.dumps(keep))


def replies(items):
    if not items:
        print("{}")
        return
    since = min(i["ts_epoch"] for i in items)
    mine = sorted((d for d in records(since) if d.get("from_me")), key=lambda d: d["ts_epoch"])
    found = {}
    for i in items:
        hit = next((m for m in mine if m["ts_epoch"] > i["ts_epoch"] and key(m) == i["key"]), None)
        if not hit and i["source"] != "gmail" and not i.get("is_dm"):
            # a channel @mention answered at top level in the same channel within an hour
            hit = next((m for m in mine if i["ts_epoch"] < m["ts_epoch"] < i["ts_epoch"] + 3600
                        and channel(m) == i.get("channel")), None)
        if not hit:
            continue
        text = hit.get("text", "")
        if hit["source"] == "gmail":
            text = gmail_message((hit.get("raw") or {}).get("uid", "")) or text
        found[i["id"]] = {"text": text[:CAP], "time_pst": hit.get("time_pst"), "ts_epoch": hit["ts_epoch"]}
    print(json.dumps(found))


if __name__ == "__main__":
    if sys.argv[1] == "candidates":
        candidates(float(sys.argv[2]))
    elif sys.argv[1] == "replies":
        replies(json.loads(base64.b64decode(sys.argv[2])))

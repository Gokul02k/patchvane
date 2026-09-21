"""Getting what somebody wrote to the people who can act on it.

There are two kinds of thing people send, and they want different homes.
A bug belongs in the issue tracker, where it can be numbered, argued about
and closed.  Everything else -- this was confusing, this should do that,
thank you -- belongs in the maintainer's mail, where it will be read once
and does not need a state machine around it.

Which of the two is not asked at the start.  The page takes what they wrote
first and only then asks where it should go, because being made to classify
something before describing it is how you end up with feature requests filed
as bugs: whoever is typing does not yet know which they are writing, and
being asked makes them stop and think about the form instead of the problem.

Nothing here decides for them either.  The choice is theirs, and the honest
reason is that the tool cannot tell: "the counts look wrong" is a bug report
or a misunderstanding depending on facts nobody in this process has.
"""

import json
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import mailer

# Where issues go.  Without a repository and a token nothing can be filed,
# and the page is told so rather than offering a route that silently fails.
REPO = (os.environ.get("PATCHVANE_GITHUB_REPO") or "").strip().strip("/")
TOKEN = (os.environ.get("PATCHVANE_GITHUB_TOKEN") or "").strip()
API = (os.environ.get("PATCHVANE_GITHUB_API")
       or "https://api.github.com").rstrip("/")

# Who may read what everybody sent and answer it, and who ordinary feedback
# reaches.  One address, because this is somebody's deployment rather than a
# product with a support desk.
#
# Asked for rather than read out of the environment here, because who that
# is can be worked out from the deployment itself and usually has to be:
# see owner_now() in serve.py.  An address given here explicitly still wins.
_ASK_OWNER = None


def configure(data_dir: str, owner=None) -> None:
    """Point the book at the deployment's own storage, and say who runs it.

    `owner` is either an address or something to call for one, so that a
    server which does not yet know -- nobody has signed in on a fresh
    deployment -- can answer later without being reconfigured."""
    global BOOK, _ASK_OWNER
    BOOK = os.path.join(data_dir, "feedback.json")
    if owner is not None:
        _ASK_OWNER = owner


def owner() -> str:
    if _ASK_OWNER is not None:
        who = _ASK_OWNER() if callable(_ASK_OWNER) else _ASK_OWNER
        if who:
            return who.strip().lower()
    return (os.environ.get("PATCHVANE_OWNER")
            or os.environ.get("PATCHVANE_FEEDBACK_EMAIL") or "").strip().lower()


def to_address() -> str:
    """Where a report is mailed.  The owner, unless told otherwise."""
    return ((os.environ.get("PATCHVANE_FEEDBACK_EMAIL") or "").strip().lower()
            or owner())

MAX = 8000          # characters of one report
TITLE = 90          # characters of the first line used as an issue title

# ---------------------------------------------------------------- the book

# Where reports are kept.  This is the part that makes the page honest: it
# used to tell people there was "nowhere for this to go" when no tracker and
# no mail were configured, which is a strange thing to say to somebody who
# has just found a bug -- the deployment has a disk, and the person who runs
# it signs in to it. So everything is written down here first. Mail and the
# issue tracker are how the owner hears about it sooner, not whether it is
# recorded at all.
BOOK = ""
_LOCK = threading.Lock()

KINDS = {
    "bug": "Something is broken",
    "wrong": "A number or a status looks wrong",
    "idea": "Something could be better",
    "question": "I could not work out how to do something",
    "praise": "Something to say",
}

STATUSES = {
    "new": "Not looked at yet",
    "seen": "Read",
    "working": "Being worked on",
    "fixed": "Done",
    "known": "Known, not being worked on yet",
    "wontfix": "Not going to change",
    "ask": "Waiting on an answer from you",
}


def _read() -> list:
    if not BOOK or not os.path.exists(BOOK):
        return []
    try:
        with open(BOOK, encoding="utf-8") as fh:
            got = json.load(fh)
        return got if isinstance(got, list) else []
    except Exception:
        return []


def _write(rows: list) -> bool:
    if not BOOK:
        return False
    tmp = "%s.%d.tmp" % (BOOK, os.getpid())
    try:
        os.makedirs(os.path.dirname(BOOK), exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(rows, fh, indent=1)
        os.replace(tmp, BOOK)
        return True
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        return False


def is_owner(email: str) -> bool:
    who = owner()
    return bool(who) and (email or "").strip().lower() == who


def record(text: str, kind: str, who: str = "", name: str = "",
           where: str = "") -> dict:
    """Write one report down.  This always happens, and happens first."""
    row = {
        "id": secrets.token_hex(8),
        "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "who": (who or "").strip().lower(),
        "name": (name or "").strip()[:80],
        "kind": kind if kind in KINDS else "bug",
        "text": clean(text),
        # Which page they were looking at.  "The numbers are wrong" is a
        # different report depending on which numbers were on screen.
        "where": re.sub(r"[^a-z]", "", (where or "").lower())[:20],
        "status": "new",
        "answers": [],
    }
    with _LOCK:
        rows = _read()
        rows.insert(0, row)
        # Whether it really was written down is the one thing this has to
        # be honest about: told that it was kept, nobody sends it twice.
        row["_kept"] = _write(rows[:2000])
    return row


def mine(email: str) -> list:
    """What one person sent, and what has been said back."""
    email = (email or "").strip().lower()
    if not email:
        return []
    return [r for r in _read() if r.get("who") == email]


def everything() -> list:
    return _read()


def waiting() -> int:
    """Reports nobody has looked at yet."""
    return sum(1 for r in _read() if r.get("status") == "new")


def answer(rid: str, status: str, note: str, by: str = "") -> dict:
    """The owner's reply to one report.

    Kept as a list rather than one field, so somebody who is told it is
    being worked on and then that it is done can see both, in order, and
    the second does not quietly overwrite the first."""
    if status not in STATUSES:
        return {"ok": False, "error": "That is not a status."}
    note = clean(note)
    with _LOCK:
        rows = _read()
        for r in rows:
            if r.get("id") != rid:
                continue
            r["status"] = status
            r.setdefault("answers", []).append({
                "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "status": status, "note": note, "by": by,
            })
            ok = _write(rows)
            return {"ok": ok, "report": r} if ok else {
                "ok": False, "error": "That could not be written down."}
    return {"ok": False, "error": "No report with that id."}


def tell_them(row: dict, status: str, note: str, log=None) -> bool:
    """Let the person who wrote it know somebody has looked.

    A report acknowledged weeks later by silence is a report nobody sends
    twice, so the answer goes to them rather than waiting for them to come
    back and check."""
    to = (row or {}).get("who") or ""
    if not to or not mailer.ready():
        return False
    said = STATUSES.get(status, status)
    inner = """
      <p style="margin:0 0 6px;">%(hello)s</p>
      <p style="margin:0 0 14px;color:%(faint)s;">About what you sent on
        %(when)s: <b>%(said)s</b>.</p>
      %(note)s
      <div style="padding:13px 15px;border:1px solid %(line)s;border-radius:11px;
                  white-space:pre-wrap;font:400 13px/1.6 %(font)s;
                  color:%(faint)s;">%(text)s</div>
    """ % dict(
        hello=mailer.esc("Hello%s," % (" " + row["name"].split()[0]
                                       if row.get("name") else "")),
        when=mailer.esc(row.get("at", "")[:10]), said=mailer.esc(said),
        note=('<p style="margin:0 0 14px;">%s</p>' % mailer.esc(note)
              if note else ""),
        text=mailer.esc(row.get("text", "")[:1200]),
        faint=mailer.FAINT, line=mailer.LINE, font=mailer.FONT)
    subject = "Patchvane: %s" % said.lower()
    plain = "%s\n\n%s\n\nYou wrote:\n\n%s\n" % (
        said, note, row.get("text", "")[:1200])
    sent, _ = mailer.send(to, subject, mailer.shell(subject, inner), plain,
                          log=log)
    return sent


def routes() -> dict:
    """Which ways out actually work from this deployment.

    "Written down" is always one of them, so the page never has to tell
    anybody their report has nowhere to go."""
    return {"issue": bool(REPO and TOKEN),
            "mail": bool(to_address() and mailer.ready()),
            "owner": bool(owner()), "kinds": KINDS, "statuses": STATUSES}


def clean(text: str) -> str:
    return (text or "").replace("\r\n", "\n").strip()[:MAX]


def title_of(text: str) -> str:
    """An issue needs a one-line title and people write paragraphs.

    The first line, unless the first line is itself a paragraph, in which
    case the first sentence of it.  Ending mid-word reads as a truncation
    bug in the tracker rather than a long title."""
    first = clean(text).split("\n", 1)[0].strip()
    if len(first) <= TITLE:
        return first or "Feedback from Patchvane"
    cut = first[:TITLE]
    return cut[:cut.rfind(" ")].rstrip(",.;:") + "\u2026" if " " in cut \
        else cut + "\u2026"


def as_issue(text: str, who: str = "", log=None) -> tuple:
    """File it in the tracker.  Returns (ok, what happened, link).

    The address of whoever sent it goes in, because a bug report nobody can
    ask a follow-up question about is often a bug nobody can fix.  It is
    said on the page before they choose this, since a GitHub issue is public
    and that is not a thing to find out afterwards."""
    if not routes()["issue"]:
        return False, "This deployment has no issue tracker configured.", ""
    body = {
        "title": title_of(text),
        "body": "%s\n\n---\nSent from the Patchvane dashboard%s."
                % (clean(text), " by %s" % who if who else ""),
        "labels": ["from-dashboard"],
    }
    req = urllib.request.Request(
        "%s/repos/%s/issues" % (API, REPO),
        data=json.dumps(body).encode("utf-8"), method="POST",
        headers={"Authorization": "Bearer %s" % TOKEN,
                 "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28",
                 "User-Agent": "patchvane",
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            made = json.loads(r.read().decode("utf-8"))
        return True, "filed", made.get("html_url", "")
    except urllib.error.HTTPError as exc:
        # The detail names the repository and sometimes the token's scopes,
        # so it goes to the log and a sentence goes to the page.
        try:
            why = json.loads(exc.read().decode("utf-8")).get("message", "")
        except Exception:
            why = ""
        if log:
            log("github refused the issue: %d %s" % (exc.code, why))
        return False, "The issue tracker would not take it.", ""
    except Exception as exc:
        if log:
            log("github unreachable: %s" % exc)
        return False, "The issue tracker could not be reached.", ""


def as_mail(text: str, who: str = "", kind: str = "feedback", log=None) -> tuple:
    """Send it to whoever runs this.  Returns (ok, what happened, link)."""
    if not routes()["mail"]:
        return False, "This deployment has nowhere to send mail.", ""
    subject = "Patchvane \u2014 %s: %s" % (
        KINDS.get(kind, "feedback").lower(), title_of(text))
    body = clean(text)
    # Their address is in the message rather than in a Reply-To header: the
    # header would have to be threaded through all seven providers below
    # mailer.send, and what it buys -- being able to answer the person -- is
    # had by putting the address where it can be read and copied.
    inner = """
      <p style="margin:0 0 6px;color:%(faint)s;"><b>%(who)s</b> wrote:</p>
      <div style="padding:13px 15px;border:1px solid %(line)s;border-radius:11px;
                  white-space:pre-wrap;font:400 14px/1.6 %(font)s;">%(body)s</div>
    """ % dict(who=mailer.esc(who or "Somebody"), body=mailer.esc(body),
               faint=mailer.FAINT, line=mailer.LINE, font=mailer.FONT)
    plain = "%s wrote:\n\n%s\n" % (who or "Somebody", body)
    sent, why = mailer.send(to_address(), subject,
                            mailer.shell(subject, inner), plain, log=log)
    return sent, "sent" if sent else why, ""


def deliver(text: str, kind: str, who: str = "", name: str = "",
            where: str = "", route: str = "", log=None) -> dict:
    """One report: written down first, then passed on where it can be.

    The order is the whole point. Delivery used to come first and be the
    only thing that happened, so a deployment with no tracker and no mail
    told people there was nowhere for their report to go -- and there was
    nowhere, because nothing was keeping it. Now it is kept, the owner sees
    it when they sign in, and mail or an issue is how they find out sooner."""
    text = clean(text)
    if len(text) < 10:
        return {"ok": False, "error": "A few more words would help."}
    if kind not in KINDS:
        return {"ok": False, "error": "Say what kind of thing this is."}

    row = record(text, kind, who=who, name=name, where=where)
    kept = row.pop("_kept", False)
    out = {"ok": True, "id": row["id"], "kind": kind, "stored": kept}

    # An issue only if they asked for one and the tracker exists: a GitHub
    # issue is public, and that is not a thing to do to somebody's words
    # without being asked.
    if route == "issue" and routes()["issue"]:
        ok, _why, link = as_issue(text, who, log=log)
        if ok:
            out["link"] = link
            out["route"] = "issue"
    if routes()["mail"]:
        sent, _why, _ = as_mail(text, who, kind, log=log)
        out["told"] = sent

    # Nothing kept it and nothing carried it: that is a failure, and saying
    # thank you for it is how a report is lost twice -- once here, and
    # again when the person who wrote it does not write it a second time.
    if not (out["stored"] or out.get("told") or out.get("link")):
        return {"ok": False,
                "error": "This could not be written down or passed on. "
                         "Nothing was kept, so please say it to whoever "
                         "runs this another way."}
    return out

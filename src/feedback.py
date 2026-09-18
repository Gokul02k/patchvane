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

# Who ordinary feedback reaches.  Whoever runs the deployment.
TO = (os.environ.get("PATCHVANE_FEEDBACK_EMAIL")
      or os.environ.get("PATCHVANE_OWNER") or "").strip().lower()

MAX = 8000          # characters of one report
TITLE = 90          # characters of the first line used as an issue title


def routes() -> dict:
    """Which ways out actually work from this deployment.

    Asked before the choice is offered, so that nobody picks a route that
    was never going to carry their message."""
    return {"issue": bool(REPO and TOKEN), "mail": bool(TO and mailer.ready())}


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
    subject = "Patchvane %s: %s" % (
        "bug report" if kind == "bug" else "feedback", title_of(text))
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
    sent, why = mailer.send(TO, subject, mailer.shell(subject, inner), plain,
                            log=log)
    return sent, "sent" if sent else why, ""


def deliver(text: str, route: str, who: str = "", log=None) -> dict:
    """One report, the way they asked for it to go."""
    text = clean(text)
    if len(text) < 10:
        return {"ok": False, "error": "A few more words would help."}
    if route == "issue":
        ok, why, link = as_issue(text, who, log=log)
        kind = "bug"
    elif route == "mail":
        ok, why, link = as_mail(text, who, "feedback", log=log)
        kind = "feedback"
    else:
        return {"ok": False, "error": "Choose where it should go."}

    # A tracker that will not answer should not lose what somebody took the
    # trouble to write.  Mail is the fallback because it always reaches a
    # person, even when it reaches them without a number on it.
    if not ok and route == "issue" and routes()["mail"]:
        sent, why2, _ = as_mail(text, who, "bug", log=log)
        if sent:
            return {"ok": True, "route": "mail", "fellback": True,
                    "note": "The issue tracker would not take it, so this "
                            "went to the maintainer as mail instead. It is "
                            "not lost."}
    if not ok:
        return {"ok": False, "error": why}
    return {"ok": True, "route": route, "link": link, "kind": kind}

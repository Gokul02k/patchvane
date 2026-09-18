#!/usr/bin/env python3
"""Discover: the two questions that are not about your own patches.

The dashboard answers "where are my patches".  There are two questions
people keep asking next, and neither of them needs anything private:

    Somebody sent a patch to my subsystem, or is about to review mine.
    Have they done this before, and does their work land?

    I have changed a file.  Who is supposed to receive the patch?

Both are answered from the same public archives the collector reads, and
both are deliberately shallow.  A full collection reads several hundred
threads and takes minutes, which is right for the person whose dashboard it
is and quite wrong for somebody typed into a search box.  So this counts
rather than reads: patchwork knows how many patches an address has and how
many were accepted, and cgit knows which commits carry it as author.  Five
requests instead of five hundred.

Nothing here is a judgement.  The numbers are counts of public records, and
a small number means the archives hold little under that address -- somebody
posting from a second address, or to a list patchwork does not track, has
patches that these numbers will not find.  Where that is likely, the answer
says so rather than letting a zero stand as a verdict on a person.
"""

from __future__ import annotations

import concurrent.futures as futures
import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import html as htmllib
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CONFIG = json.load(open(os.path.join(ROOT, "config.json")))
DATA_DIR = os.environ.get("PATCHVANE_DATA_DIR") or ROOT
CACHE = os.path.join(DATA_DIR, "cache")

KORG = CONFIG["korg"]["base"].rstrip("/")
TREES = dict(CONFIG["korg"]["always"])
MAINTAINER_TREES = dict(CONFIG["korg"]["trees"])
PATCHWORK = CONFIG.get("patchwork", {}).get(
    "base", "https://patchwork.kernel.org").rstrip("/")
LORE = CONFIG["lore"]["base"].rstrip("/")

# Said plainly rather than pretending to be a browser.  Whoever is being
# read has a right to know who is reading, and the collector does the same.
UA = "%s (discover)" % CONFIG.get("user_agent", "patchvane/2.0")

# How long each kind of answer is worth keeping.  A person's patch history
# does not change in an hour; MAINTAINERS changes a few times a week and is
# a megabyte, so it is kept for a day.
TTL_COUNTS = 3 * 3600
TTL_TREES = 6 * 3600
TTL_TAGS = 12 * 3600
TTL_MAINTAINERS = 24 * 3600

MAX_TREE_WORKERS = 6

_LOCK = threading.Lock()


# --------------------------------------------------------------- fetching


def _cache_path(key: str) -> str:
    return os.path.join(CACHE, "d-" + hashlib.sha1(key.encode()).hexdigest())


def cached(key: str, ttl: float, produce):
    """Whatever produce() returns, kept on disk for a while.

    Discover answers are shared: two people asking about the same address
    get the same public counts, so the cache is keyed on the question and
    not on who asked it.  A produce() that fails returns None and is not
    written down, so the next asker tries again rather than inheriting a
    failure for six hours."""
    path = _cache_path(key)
    try:
        if time.time() - os.path.getmtime(path) < ttl:
            with open(path, encoding="utf-8") as fh:
                return json.load(fh)
    except (OSError, ValueError):
        pass
    value = produce()
    if value is None:
        return None
    try:
        os.makedirs(CACHE, exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(value, fh)
        os.replace(tmp, path)
    except OSError:
        pass
    return value


def fetch(url: str, timeout: int = 60, headers: bool = False):
    """One request.  None when it could not be read, never an exception."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode("utf-8", "replace")
            return (body, dict(r.headers)) if headers else body
    except urllib.error.HTTPError as exc:
        if exc.code in (400, 404):
            return ("", {}) if headers else ""
        return None
    except Exception:
        return None


# ------------------------------------------------------------- patchwork


# Patchwork answers a one-per-page request with a Link header naming the
# last page, which is the count without reading a single patch.
LAST_PAGE = re.compile(r"[?&]page=(\d+)[^>]*>;\s*rel=\"last\"")

def pw_count(email: str, state: str = "") -> int:
    """How many patches patchwork holds for an address.  -1 if it would not say."""
    url = ("%s/api/1.2/patches/?submitter=%s&per_page=1&archive=both"
           % (PATCHWORK, urllib.parse.quote(email)))
    if state:
        url += "&state=" + urllib.parse.quote(state)

    def ask():
        got = fetch(url, timeout=45, headers=True)
        if got is None:
            return None
        body, head = got
        if not body:
            return {"n": 0}
        link = head.get("Link") or head.get("link") or ""
        m = LAST_PAGE.search(link)
        if m:
            return {"n": int(m.group(1))}
        # No "last" link means this is the only page, so the count is
        # however many came back on it.
        try:
            return {"n": len(json.loads(body))}
        except ValueError:
            return None

    out = cached("pw %s %s" % (email, state), TTL_COUNTS, ask)
    return out["n"] if out else -1


# ------------------------------------------------------------------ cgit


CGIT_ROW = re.compile(r"<tr>(.*?)</tr>", re.S)
CGIT_SHA = re.compile(r"commit/\?id=([0-9a-f]{7,40})'>(.*?)</a>", re.S)
# cgit writes a Unix timestamp on the handful of rows recent enough to be
# shown as "4 days", and falls back to a plain date with the full stamp in
# its title for everything older.  Both have to be read: without the second
# one every commit more than a week old has no date to place it by.
CGIT_UT = re.compile(r"data-ut='(\d+)'")
CGIT_TITLE = re.compile(r"title='(\d{4}-\d\d-\d\d[^']*)'")
# A "next page" link means the tree holds more than came back.  The
# separator before it is &amp; in the markup, so nothing is anchored to it.
CGIT_MORE = re.compile(r"ofs=\d+")


def strip_tags(s: str) -> str:
    return htmllib.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def when_of(row: str) -> tuple:
    """(unix time, yyyy-mm-dd) for one row of a cgit log."""
    ut = CGIT_UT.search(row)
    title = CGIT_TITLE.search(row)
    stamp = title.group(1) if title else ""
    if ut:
        return int(ut.group(1)), stamp[:10]
    for shape in ("%Y-%m-%d %H:%M:%S %z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            when = datetime.strptime(stamp, shape)
            if when.tzinfo is None:
                when = when.replace(tzinfo=timezone.utc)
            return int(when.timestamp()), stamp[:10]
        except ValueError:
            continue
    return 0, stamp[:10]


def cgit_log(path: str, email: str, limit: int = 100) -> dict:
    """Commits in one tree authored by one address.

    {"commits": [...], "more": bool, "ok": bool}.

    more says the tree holds further commits beyond the page that came back,
    so a count taken from this is reported as "at least" rather than as the
    total.  ok says the tree answered at all, which has to be separate from
    the list being empty: a tree that could not be reached and a tree that
    holds nothing produce the same empty list, and reporting the first as
    "nothing landed" is a wrong answer rather than a missing one."""
    url = ("%s%s/log/?qt=author&q=%s&n=%d"
           % (KORG, path, urllib.parse.quote(email), limit))

    def ask():
        body = fetch(url, timeout=60)
        if body is None:
            return None
        found = []
        for row in CGIT_ROW.findall(body):
            m = CGIT_SHA.search(row)
            if not m:
                continue
            subject = strip_tags(m.group(2))
            if not subject:
                continue
            at, date = when_of(row)
            found.append({
                "commit": m.group(1),
                "short": m.group(1)[:12],
                "subject": subject,
                "at": at,
                "date": date,
                "url": "%s%s/commit/?id=%s" % (KORG, path, m.group(1)),
            })
        return {"commits": found, "more": bool(CGIT_MORE.search(body)),
                "ok": True}

    # cached() returns None when the fetch failed, and nothing is written
    # down, so the next person to ask tries again rather than inheriting six
    # hours of somebody else's broken network.
    return (cached("log2 %s %s" % (path, email), TTL_TREES, ask)
            or {"commits": [], "more": False, "ok": False})


# ------------------------------------------------------------- which release


TAG = re.compile(r"/tag/\?h=(v[0-9][^']*)'>[^<]*</a>.*?data-ut='(\d+)'", re.S)
# Release candidates are tags too, and "it shipped in v6.12-rc3" is not what
# anybody means by which release a commit is in.
FINAL = re.compile(r"^v\d+\.\d+(\.\d+)?$")


RC = re.compile(r"^(v\d+\.\d+)-rc\d+$")


def releases() -> dict:
    """Every released kernel, oldest first, and the one being built now."""
    def ask():
        body = fetch("%s%s/refs/tags/"
                     % (KORG, TREES["mainline"]), timeout=90)
        if body is None:
            return None
        every = [(name, int(ts)) for name, ts in TAG.findall(body)]
        final = sorted(([n, t] for n, t in every if FINAL.match(n)),
                       key=lambda x: x[1])
        # The release candidates name the version the merge window is
        # filling, which is where anything merged since the last release is
        # going.  Newest by tag date rather than by version number, which
        # sorts as text and would put v7.10 before v7.9.
        rcs = sorted(((RC.match(n).group(1), t) for n, t in every
                      if RC.match(n)), key=lambda x: x[1])
        return {"final": final, "building": rcs[-1][0] if rcs else ""}

    return cached("tags-v2", TTL_TAGS, ask) or {"final": [], "building": ""}


def release_for(when: int, tags: dict) -> dict:
    """Which release a commit is in, and whether that release exists yet.

    Worked out from dates, because cgit will not answer "git describe
    --contains" over HTTP: the first release tagged after a commit reached
    mainline is the release that carries it.  That is right for the ordinary
    path a patch takes and wrong for one cherry-picked somewhere later,
    which is why the page says "first released in" rather than claiming to
    be the only place it appears.

    A commit merged since the last release is in no tag at all.  Saying
    nothing there would be silently wrong, so it names the version the merge
    window is currently filling and says it is still to come."""
    if not when:
        return {"tag": "", "shipped": False}
    for name, ts in tags.get("final", []):
        if ts >= when:
            return {"tag": name, "shipped": True}
    return {"tag": tags.get("building", ""), "shipped": False}


# ----------------------------------------------------------- one author


def clean_email(s: str) -> str:
    s = (s or "").strip().strip("<>").lower()
    # "Ada Lovelace <ada@example.org>" is what people paste out of a patch.
    m = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", s)
    return m.group(0) if m else ""


def author(email: str) -> dict:
    """What the public record holds for one address.

    Patchwork, mainline and linux-next: seven requests and a second or two,
    which is a search box rather than a collection.  The maintainer trees
    are not in here -- see sweep() for why they cannot be."""
    email = clean_email(email)
    if not email:
        return {"ok": False, "error": "That is not an email address."}

    started = time.time()
    out = {"ok": True, "email": email}

    # Patchwork and the two trees everyone lands in, all at once: they are
    # different hosts and waiting for them in turn is waiting twice.
    jobs = {}
    with futures.ThreadPoolExecutor(6) as ex:
        jobs["submitted"] = ex.submit(pw_count, email)
        for state in ("accepted", "changes-requested", "rejected",
                      "superseded"):
            jobs["pw:" + state] = ex.submit(pw_count, email, state)
        jobs["mainline"] = ex.submit(cgit_log, TREES["mainline"], email)
        jobs["next"] = ex.submit(cgit_log, TREES["linux-next"], email)
        jobs["tags"] = ex.submit(releases)
        done = {k: v.result() for k, v in jobs.items()}

    tags = done["tags"]
    merged = done["mainline"]["commits"]
    for c in merged:
        c.update(release_for(c["at"], tags))
    merged.sort(key=lambda c: c["at"], reverse=True)

    # A commit in linux-next that is also in mainline has moved on, and
    # counting it in both makes the two numbers add up to more than the
    # work.  What is interesting is what is queued and not yet landed.
    landed = {c["commit"] for c in merged}
    queued = [c for c in done["next"]["commits"]
              if c["commit"] not in landed]

    # Which of the two archives actually answered.  A count from one that
    # did not is not a small number, it is no number, and the page is told
    # which so that it can show a dash rather than a zero.
    git_ok = done["mainline"]["ok"] and done["next"]["ok"]
    out["sources"] = {"patchwork": done["submitted"] >= 0, "git": git_ok}

    out["counts"] = {
        "submitted": done["submitted"],
        "accepted": done["pw:accepted"],
        "changes_requested": done["pw:changes-requested"],
        "rejected": done["pw:rejected"],
        "superseded": done["pw:superseded"],
        "merged": len(merged) if done["mainline"]["ok"] else -1,
        "in_next": len(queued) if done["next"]["ok"] else -1,
    }
    # Said rather than rounded away: a prolific author's mainline history is
    # longer than one page of cgit, and reporting the page as the total
    # would be a wrong number rather than a partial one.
    out["more"] = {"merged": done["mainline"]["more"],
                   "in_next": done["next"]["more"]}
    out["merged"] = merged[:60]
    out["in_next"] = queued[:30]
    out["deep"] = deep_state(email)

    out["lore"] = "%s/all/?q=%s" % (LORE, urllib.parse.quote("f:" + email))
    out["patchwork"] = ("%s/project/all/list/?submitter=%s"
                        % (PATCHWORK, urllib.parse.quote(email)))
    out["seconds"] = round(time.time() - started, 1)
    out["notes"] = shortfalls(out)
    return out


# ------------------------------------------- the maintainer trees, slowly


# Asking git.kernel.org for one author's commits in one tree takes about
# twenty seconds, because cgit walks the history to answer it.  There are
# eighty maintainer trees in the config, so the honest way to offer this is
# not to make somebody hold a page open for five minutes: it runs behind the
# search, says how far it has got, and every tree it finishes is cached for
# everyone who asks next.
_JOBS = {}


def deep_state(email: str) -> dict:
    """Where the maintainer-tree sweep for this address has got to."""
    email = clean_email(email)
    done = cached_sweep(email)
    with _LOCK:
        job = dict(_JOBS.get(email) or {})
    if done is not None:
        return {"state": "done", "trees": done["trees"],
                "count": sum(t["count"] for t in done["trees"]),
                "at": done["at"]}
    if job.get("running"):
        return {"state": "running", "done": job.get("done", 0),
                "total": job.get("total", len(MAINTAINER_TREES))}
    return {"state": "none", "total": len(MAINTAINER_TREES)}


def cached_sweep(email: str):
    path = _cache_path("sweep " + email)
    try:
        if time.time() - os.path.getmtime(path) < TTL_TREES:
            with open(path, encoding="utf-8") as fh:
                return json.load(fh)
    except (OSError, ValueError):
        pass
    return None


def start_sweep(email: str) -> dict:
    """Begin the sweep for one address, unless it is already under way."""
    email = clean_email(email)
    if not email:
        return {"ok": False, "error": "That is not an email address."}
    if cached_sweep(email) is not None:
        return {"ok": True, "deep": deep_state(email)}
    with _LOCK:
        if (_JOBS.get(email) or {}).get("running"):
            return {"ok": True, "deep": deep_state(email)}
        _JOBS[email] = {"running": True, "done": 0,
                        "total": len(MAINTAINER_TREES)}
    threading.Thread(target=sweep, args=(email,), daemon=True).start()
    return {"ok": True, "deep": deep_state(email)}


def sweep(email: str) -> None:
    """Which maintainer trees hold their commits, and hold only them.

    A commit already in mainline is not news -- everything in mainline came
    through one of these -- so what is reported is work that has been taken
    and has not arrived yet."""
    main, next_ = (cgit_log(TREES["mainline"], email),
                   cgit_log(TREES["linux-next"], email))
    if not main["ok"]:
        # Without knowing what is already in mainline, every commit in every
        # maintainer tree looks like work still waiting, which would be a
        # confident and completely wrong answer.  Better to have none.
        with _LOCK:
            _JOBS.pop(email, None)
        return
    landed = {c["commit"] for c in main["commits"]}
    queued = {c["commit"] for c in next_["commits"]}
    found = []
    answered = 0
    try:
        with futures.ThreadPoolExecutor(MAX_TREE_WORKERS) as ex:
            jobs = {ex.submit(cgit_log, path, email, 60): name
                    for name, path in sorted(MAINTAINER_TREES.items())}
            for n, job in enumerate(futures.as_completed(jobs), 1):
                with _LOCK:
                    if email in _JOBS:
                        _JOBS[email]["done"] = n
                name = jobs[job]
                try:
                    got = job.result()
                except Exception:
                    continue
                if not got["ok"]:
                    continue
                answered += 1
                commits = got["commits"]
                waiting = [c for c in commits if c["commit"] not in landed]
                if not waiting:
                    continue
                found.append({
                    "tree": name,
                    "count": len(waiting),
                    "in_next": sum(1 for c in waiting
                                   if c["commit"] in queued),
                    "newest": max((c["date"] for c in waiting), default=""),
                    "commits": sorted(waiting, key=lambda c: c["at"],
                                      reverse=True)[:8],
                })
        found.sort(key=lambda t: (-t["count"], t["tree"]))
        # "Nothing is waiting anywhere" is only worth writing down if the
        # trees were actually asked.  A sweep run while the network was
        # coming and going would otherwise be kept for six hours as a
        # confident nothing, which is the one answer here that would be
        # worse than no answer at all.
        if answered >= len(MAINTAINER_TREES) * 0.8:
            cached("sweep " + email, TTL_TREES,
                   lambda: {"trees": found, "at": now_iso(),
                            "asked": answered})
    finally:
        with _LOCK:
            _JOBS.pop(email, None)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def shortfalls(out: dict) -> list:
    """Where a number is likely to be telling less than the whole truth.

    Said out loud, because the alternative is somebody reading a zero as a
    fact about a person when it is a fact about which archives were asked."""
    said = []
    c = out["counts"]
    if not out["sources"]["patchwork"]:
        said.append("patchwork could not be reached, so the sent and accepted "
                    "counts are missing rather than zero")
    if not out["sources"]["git"]:
        said.append("git.kernel.org could not be reached, so what landed is "
                    "missing rather than nothing")
        return said          # the rest would be read off numbers we lack
    if c["submitted"] > 0 and not c["merged"]:
        said.append("nothing of theirs is in mainline under this address, "
                    "which is not the same as nothing landing: a patch keeps "
                    "the author line it was posted with, so work signed off "
                    "from another address is counted there and not here")
    elif not c["submitted"] and c["merged"]:
        said.append("nothing under this address in patchwork, though commits "
                    "carry it: patchwork only tracks lists that have a "
                    "project there")
    elif not c["submitted"] and not c["merged"]:
        said.append("nothing found anywhere under this address, which usually "
                    "means they post from a different one")
    if out["deep"]["state"] != "done":
        said.append("the maintainer trees have not been looked at, so a "
                    "patch that has been taken but has not reached "
                    "linux-next yet is not counted anywhere here")
    return said


# -------------------------------------------------------- who to send to


MAINTAINERS_URL = ("%s%s/plain/MAINTAINERS"
                   % (KORG, TREES["mainline"]))

# One letter, a colon, and the rest of the line.  The file has used this
# shape since before git.
FIELD = re.compile(r"^([A-Z]):\s*(.*?)\s*$")


def maintainers_file() -> str:
    """MAINTAINERS as it is in mainline today, kept for a day."""
    def ask():
        # Long enough for a megabyte on a slow line, short enough that a
        # network which is simply not there gives the page an answer to show
        # rather than a spinner to sit under.
        body = fetch(MAINTAINERS_URL, timeout=45)
        if body is None or len(body) < 10000:
            return None          # a truncated one is worse than none
        return {"text": body}

    got = cached("MAINTAINERS", TTL_MAINTAINERS, ask)
    return got["text"] if got else ""


def parse_maintainers(text: str) -> list:
    """The file as a list of subsystems.

    Everything above the first section is the explanation of what the
    letters mean, and is skipped: a section is a title line followed by the
    fields under it."""
    sections = []
    current = None
    # The descriptive preamble ends at the line of dashes before the list.
    body = text.split("\nMaintainers List\n", 1)[-1]
    for line in body.splitlines():
        m = FIELD.match(line)
        if m and current is not None:
            current["fields"].setdefault(m.group(1), []).append(m.group(2))
            continue
        line = line.rstrip()
        if not line or set(line) <= set("-= \t"):
            continue
        if line.startswith((" ", "\t")):
            continue
        # A title: a line that is not a field and not blank starts a new one.
        current = {"name": line.strip(), "fields": {}}
        sections.append(current)
    return [s for s in sections if s["fields"]]


_PARSED = {"at": 0.0, "list": []}


def subsystems() -> list:
    with _LOCK:
        if _PARSED["list"] and time.time() - _PARSED["at"] < TTL_MAINTAINERS:
            return _PARSED["list"]
    text = maintainers_file()
    if not text:
        return []
    parsed = parse_maintainers(text)
    with _LOCK:
        _PARSED["at"] = time.time()
        _PARSED["list"] = parsed
    return parsed


def glob_re(pattern: str):
    """A MAINTAINERS F: or X: pattern, as a regular expression.

    get_maintainer.pl escapes the dots, turns * into .* and ? into . and
    then anchors at the front, which is what is copied here.  Note that the
    star does cross a slash: what stops drivers/* claiming everything under
    drivers is not the star, it is the rule in matches() below."""
    body = re.escape(pattern).replace(r"\*", ".*").replace(r"\?", ".")
    return re.compile("^" + body)


def matches(path: str, pattern: str) -> bool:
    """Does one F: or X: line claim this file?

    A pattern ending in a slash claims the whole directory under it.  One
    that does not has to have as many slashes as the path, which is how
    get_maintainer.pl keeps fs/* to the files directly in fs/ rather than
    every file in every filesystem."""
    if not glob_re(pattern).match(path):
        return False
    return pattern.endswith("/") or path.count("/") == pattern.count("/")


# What a kernel tree looks like from the top.  Used to recognise a path that
# still has the clone directory in front of it.
TOPLEVEL = {
    "arch", "block", "certs", "crypto", "Documentation", "drivers", "fs",
    "include", "init", "io_uring", "ipc", "kernel", "lib", "mm", "net",
    "rust", "samples", "scripts", "security", "sound", "tools", "usr",
    "virt",
}


def path_of(query: str) -> str:
    """A kernel path out of whatever they typed.

    People paste an absolute path, a path out of a diff, or a path with the
    clone directory still on the front, and all three mean the same file.
    That last one is only stripped when what is underneath starts with a
    directory the kernel actually has, because kernel/ and tools/ are real
    and a rule that ate them would quietly answer about the wrong file."""
    q = (query or "").strip().replace("\\", "/")
    q = re.sub(r"^[ab]/", "", q)
    q = re.sub(r"^(?:\./|/)+", "", q)
    bits = q.split("/")
    while len(bits) > 1 and bits[0] not in TOPLEVEL and bits[1] in TOPLEVEL:
        bits.pop(0)
    return "/".join(bits).strip()


def looks_like_path(q: str) -> bool:
    return "/" in q or bool(re.search(r"\.[chS]$|\.(?:dts|dtsi|rst|txt)$", q))


def find_maintainers(query: str, limit: int = 12) -> dict:
    """Who to send a patch to, by file path or by subsystem name."""
    query = (query or "").strip()
    if not query:
        return {"ok": False, "error": "Type a path or a subsystem."}
    sections = subsystems()
    if not sections:
        return {"ok": False,
                "error": "MAINTAINERS could not be read from git.kernel.org "
                         "just now. Try again in a moment."}

    path = path_of(query)
    by_path = looks_like_path(path)
    hits = []
    for s in sections:
        f = s["fields"]
        score, why = 0, ""
        if by_path:
            excluded = any(matches(path, x) for x in f.get("X", []))
            if not excluded:
                for pattern in f.get("F", []):
                    # The longer the pattern that matched, the more specific
                    # the claim on this file: a section naming the directory
                    # outranks one naming everything above it.
                    if matches(path, pattern) and len(pattern) > score:
                        score, why = len(pattern), pattern
                for pattern in f.get("N", []):
                    try:
                        if not score and re.search(pattern, path):
                            score, why = 1, "N: " + pattern
                    except re.error:
                        pass
        if not score:
            # Not a path, or a path nothing claimed: try the title.
            words = query.lower()
            if words in s["name"].lower():
                score = 1 if by_path else 2
                why = "name"
        if score:
            hits.append((score, s, why))

    hits.sort(key=lambda h: (-h[0], h[1]["name"]))
    out = [describe(s, why) for _, s, why in hits[:limit]]
    return {
        "ok": True,
        "query": query,
        "path": path if by_path else "",
        "matched": "path" if by_path else "name",
        "count": len(hits),
        "sections": out,
        "send": send_list(out),
    }


def who(line: str) -> dict:
    """"Ada Lovelace <ada@example.org> (SCHED_DEADLINE)" into its parts.

    The note in brackets is which corner of the subsystem that person
    actually wants, and half the large sections use it.  Keeping it is the
    difference between five names and knowing which of the five to write
    to."""
    line = (line or "").strip()
    m = re.search(r"<([^>]+)>", line)
    if not m:
        return {"name": "", "email": line.lower(), "note": ""} if "@" in line \
            else {"name": line, "email": "", "note": ""}
    after = line[m.end():].strip()
    return {
        "name": line[:m.start()].strip().strip('"'),
        "email": m.group(1).strip().lower(),
        "note": after[1:-1].strip() if after.startswith("(")
                and after.endswith(")") else "",
    }


STATUS = {
    "Supported": "somebody is paid to look after this",
    "Maintained": "looked after, though not as a day job",
    "Odd Fixes": "patches are taken, but nobody is watching closely",
    "Orphan": "nobody is looking after it",
    "Obsolete": "on its way out; do not expect much",
    "Buried alive in reporters": "swamped",
}


def describe(s: dict, why: str) -> dict:
    f = s["fields"]
    status = (f.get("S", [""])[0] or "").strip()
    files = f.get("F", [])
    return {
        "name": s["name"],
        "why": why,
        # THE REST claims "*" and "*/", so it matches every path there is.
        # It is worth showing -- linux-kernel@ belongs on the Cc of almost
        # everything -- but addressing a patch to Linus because he is the
        # fallback for the whole tree is not what anybody meant to do.
        "catchall": bool(files) and all(p in ("*", "*/") for p in files),
        "status": status,
        "status_means": STATUS.get(status.split(".")[0].strip(), ""),
        "maintainers": [who(x) for x in f.get("M", [])],
        "reviewers": [who(x) for x in f.get("R", [])],
        "lists": [x.split()[0] for x in f.get("L", []) if x.strip()],
        "trees": f.get("T", []),
        "files": f.get("F", [])[:8],
        "web": (f.get("W", [""])[0] or "").strip(),
    }


def send_list(sections: list) -> dict:
    """The To: and Cc: for a patch touching this, in the usual order.

    Maintainers are addressed, reviewers and lists are copied, which is what
    get_maintainer.pl does and what everybody expects to receive."""
    to, cc, seen = [], [], set()

    def add(where, person):
        key = person.get("email", "")
        if not key or key in seen:
            return
        seen.add(key)
        where.append(person)

    for s in sections:
        if s["catchall"]:
            continue
        for m in s["maintainers"]:
            add(to, m)
    for s in sections:
        if not s["catchall"]:
            for r in s["reviewers"]:
                add(cc, r)
        for l in s["lists"]:
            add(cc, {"name": "", "email": l, "list": True})
    return {"to": to, "cc": cc}

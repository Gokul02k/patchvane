"""Where the kernel is in its own release cycle.

Three places need this and each had grown its own copy: the collector, to
put the cycle on the dashboard; discover, to say which release a commit
first shipped in; and the server, to tell the assistant today's version
numbers rather than the ones it was trained on.  Three copies of one cgit
scrape is three things to fix when cgit changes its HTML, and the version
arithmetic had already drifted apart between them.

Nothing here fetches.  Each caller has its own cache and its own idea of
how long a tag list stays fresh, so this takes the page as text and gives
back facts.
"""

from __future__ import annotations

import re
import time

# One row of cgit's refs/tags/ page: the tag name and the unix time it was
# made, which is the only ordering that survives "v7.10" sorting before
# "v7.9" as text.
TAG_ROW = re.compile(r"/tag/\?h=(v[0-9][^']*)'>[^<]*</a>.*?data-ut='(\d+)'",
                     re.S)
RC = re.compile(r"^v(\d+)\.(\d+)-rc(\d+)$")
FINAL = re.compile(r"^v(\d+)\.(\d+)$")

DAY = 86400
# Used only when a tree is too young to have a history to measure: seven
# release candidates over seven weeks, then a fortnight of merge window.
USUAL = (49 * DAY, 14 * DAY, 7)


def parse_tags(html: str) -> list:
    """Every release and release candidate on the page, oldest first."""
    rows = sorted(((n, int(t)) for n, t in TAG_ROW.findall(html or "")),
                  key=lambda x: x[1])
    return [(n, t) for n, t in rows if FINAL.match(n) or RC.match(n)]


def next_version(major: int, minor: int) -> str:
    """Name a candidate release, given the major and minor it would have.

    Linus bumps the major when he runs out of fingers and toes, and he has
    never said exactly where that is: 3.19, 5.19 and 6.19 were each the
    last of their line, but 4.20 shipped.  So .19 is not the boundary, and
    a rule that treats it as one claims v6.18 is followed by v7.0 when
    v6.19 is sitting in the tree.

    Every .19 in the tree shipped, so below .20 this is not a guess.  At
    .20 it is, and the tree says bump: 3.20, 5.20 and 6.20 never existed
    and only 4.20 did.  Nothing past .20 has ever shipped at all.
    Incrementing with no rule is what produces a confident v7.20 and
    onwards, which is the invented version number this exists to avoid.
    """
    return "v%d.0" % (major + 1) if minor >= 20 else "v%d.%d" % (major, minor)


def cycle_shape(tags: list) -> tuple:
    """How long a release has taken lately, measured rather than assumed.

    Everybody says seven release candidates and a fortnight of merge
    window, and it is usually true, but an -rc8 happens often enough that
    quoting the folklore would put a date on screen that the tree
    disagrees with.  These come from the last ten releases in the tree
    being read, so a cycle that is running long says so on its own.
    """
    finals = [(n, t) for n, t in tags if FINAL.match(n)]
    rc1s, count = {}, {}
    for n, t in tags:
        m = RC.match(n)
        if not m:
            continue
        key = (int(m.group(1)), int(m.group(2)))
        count[key] = count.get(key, 0) + 1
        if m.group(3) == "1":
            rc1s[key] = t

    stabilise, window, rcs = [], [], []
    for name, when in finals:
        m = FINAL.match(name)
        key = (int(m.group(1)), int(m.group(2)))
        if key in rc1s:
            stabilise.append(when - rc1s[key])
            rcs.append(count.get(key, 0))
        # The merge window is the gap between a release and the next -rc1.
        later = [t for t in rc1s.values() if t > when]
        if later:
            window.append(min(later) - when)

    def mid(xs, fallback):
        # The last ten releases, then the middle of those.  Slicing a
        # sorted list would take the ten longest cycles instead, which is
        # a different question and answers it too slowly by a fortnight.
        recent = sorted(xs[-10:])
        return recent[len(recent) // 2] if recent else fallback

    return (mid(stabilise, USUAL[0]), mid(window, USUAL[1]),
            mid(rcs, USUAL[2]))


def cycle_of(tags: list) -> dict:
    """The cycle as facts: which release, which phase, and when it turns.

    Dates are read off the tags rather than counted forward from a rule,
    because the rule has exceptions and the tags do not.
    """
    if not tags:
        return {}
    stabilise, window, rcs = cycle_shape(tags)
    name, when = tags[-1]
    day = lambda ts: time.strftime("%Y-%m-%d", time.gmtime(ts))
    out = {"tag": name, "tagged": day(when), "rcs_usual": rcs,
           "estimated": True}

    rc = RC.match(name)
    if rc:
        # Stabilising one release, which means the window for the next one
        # opens when this one ships.
        major, minor, n = (int(x) for x in rc.groups())
        rc1 = next((t for m, t in tags
                    if m == "v%d.%d-rc1" % (major, minor)), when)
        out.update({"phase": "rc", "version": "v%d.%d" % (major, minor),
                    "rc": n, "next": next_version(major, minor + 1),
                    "opens": day(rc1 + stabilise),
                    "closes": day(rc1 + stabilise + window)})
    else:
        major, minor = (int(x) for x in FINAL.match(name).groups())
        out.update({"phase": "merge-window", "version": name, "rc": 0,
                    "next": next_version(major, minor + 1),
                    "opens": day(when), "closes": day(when + window)})
    return out

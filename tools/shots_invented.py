#!/usr/bin/env python3
"""Answers for the three things a photographed dashboard reads live.

Most of what the dashboard shows comes out of its own collection, so an
instance filled with an invented one photographs perfectly well.  Three
panels do not: the patch drawer reads the thread off lore, the commit
drawer reads the diff off git.kernel.org, and Discover reads a public
record off patchwork.  None of those can answer for a message id that was
never posted or a hash that was never committed, so with an invented
collection they photograph their own apology instead.

They also cannot be pointed at something real without putting a real
person's record in the documentation, which is the thing being avoided.

So when tools/shots.py is given SHOTS_INVENTED, those three requests never
leave the browser: they are answered here, from the same invented
collection the rest of the pictures are of, in the shape the server would
have used.  Nothing here changes the page -- the markup, the wording and
the layout in the pictures are the dashboard's own.
"""
import json
import random
import re
import urllib.parse

# Somebody to look up on Discover, who does not exist.
WHO = "marta.ibrahim@collabora.com"
WHO_NAME = "Marta Ibrahim"

RELEASES = [("v7.1", True), ("v7.2", True), ("v7.3", True), ("v7.4-rc1", False)]

# A diff short enough to read in a screenshot and shaped like one that
# would come back from cgit.
DIFF = """diff --git a/drivers/mfd/rk8xx-core.c b/drivers/mfd/rk8xx-core.c
index 6a4e2d1b9f3c..b28c5e77a041 100644
--- a/drivers/mfd/rk8xx-core.c
+++ b/drivers/mfd/rk8xx-core.c
@@ -412,9 +412,9 @@ static int rk8xx_read_rtc(struct rk8xx *rk8xx, u32 *out)
 \tif (ret)
 \t\treturn ret;
 
-\t/* The counter is little endian on the wire. */
-\t*out = raw[0] | (raw[1] << 8) | (raw[2] << 16) | (raw[3] << 24);
+\t/* The counter is little endian on the wire, whatever the host is. */
+\t*out = le32_to_cpup((__le32 *)raw);
 
 \treturn 0;
 }
@@ -603,7 +603,7 @@ static int rk8xx_write_reg(struct rk8xx *rk8xx, u8 reg, u32 val)
 {
 \tu8 raw[4];
 
-\tput_unaligned(val, (u32 *)raw);
+\tput_unaligned_le32(val, raw);
 
 \treturn regmap_bulk_write(rk8xx->regmap, reg, raw, sizeof(raw));
 }
"""

SAID = [
    "This looks right, but the second hunk is a separate fix and should be "
    "a patch of its own.",
    "Please add a Fixes: tag. As far as I can see this goes back to the "
    "original conversion.",
    "Thanks, applied to the -next branch.",
]


# The diff has to be about what the subject says it is about, so the
# commit that gets photographed is chosen rather than whichever one the
# table happens to list first.  Everything else in these pictures is
# reached by clicking what a reader would click; this one is not, and this
# is why.
PICK = "use the right endianness for the register write"


def picked(path):
    """A landed commit whose subject matches the diff below."""
    data = load(path)
    for p in data.get("patches", []):
        if p["subject"].endswith(PICK):
            for l in p.get("landed") or []:
                return l["commit"], l.get("tree") or "mainline", p["subject"]
    return "", "", ""


def load(path):
    with open(path) as fh:
        return json.load(fh)


def install(page, path):
    """Route the three live endpoints back into the invented collection."""
    data = load(path)
    by_msgid, by_series = {}, {}
    for p in data.get("patches", []):
        by_msgid[p.get("msgid")] = p
        for v in p.get("versions") or []:
            by_msgid.setdefault(v.get("msgid"), p)
        by_series.setdefault(p.get("series"), p)

    def reply(route, body):
        route.fulfill(status=200, content_type="application/json",
                      body=json.dumps(body))

    def asked(route, key):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(route.request.url).query)
        return (q.get(key) or [""])[0]

    # ------------------------------------------------------- the thread

    def thread(route):
        want = asked(route, "id")
        p = by_msgid.get(want) or by_series.get(want)
        if not p:
            reply(route, {"ok": False, "error": "that is not one of your patches"})
            return
        family = [q for q in data["patches"] if q.get("series") == p.get("series")]
        family.sort(key=lambda q: q.get("seq") or 0)
        reply(route, {
            "ok": True, "why": "",
            "patch": {k: p.get(k) for k in (
                "subject", "state", "state_detail", "version", "latest_version",
                "date", "lore", "msgid", "tree_hint", "list", "landed", "tags",
                "versions", "series_name", "in_mainline", "in_next", "pw_url",
                "pw_state", "check", "reviewers")},
            "series": [{k: q.get(k) for k in
                        ("subject", "state", "seq", "msgid", "lore", "landed")}
                       for q in family],
            "thread": conversation(data, p),
        })

    # ------------------------------------------------------- the commit

    def commit(route):
        cid = asked(route, "id").lower()
        found = next((m for m in data.get("merged", [])
                      if m.get("commit") == cid), None)
        if not found:
            for p in data.get("patches", []):
                for l in p.get("landed") or []:
                    if l.get("commit") == cid:
                        found = dict(l, subject=p["subject"])
                        break
        if not found:
            reply(route, {"ok": False,
                          "error": "No commit with that id in mainline."})
            return
        r = random.Random(cid)
        body = ("%s\n\nThe register is written a byte at a time, which gives "
                "the wrong value on a big endian host. Use the little "
                "endian accessors so the driver reads the same on both.\n\n"
                "Found by review; no functional change on x86.\n\n"
                "Signed-off-by: %s <%s>\n"
                % (found["subject"], data["profile"]["name"],
                   data["profile"]["email"]))
        files = [{"path": "drivers/mfd/rk8xx-core.c", "changed": 4},
                 {"path": "drivers/mfd/rk8xx-spi.c", "changed": 2}]
        reply(route, {
            "ok": True, "commit": cid, "short": cid[:12],
            "tree": asked(route, "tree") or "mainline",
            "url": found.get("url", ""),
            "subject": found["subject"], "body": body,
            "author": data["profile"]["name"],
            "date": found.get("date", ""),
            "committer": "Marta Ibrahim",
            "files": files,
            "changed": sum(f["changed"] for f in files),
            "diff": {"text": DIFF, "cut": False, "why": ""},
            "tag": RELEASES[r.randrange(len(RELEASES))][0],
        })

    # ------------------------------------------------ a public record

    def author(route):
        reply(route, record(data))

    def people(route):
        reply(route, {"ok": True, "people": [
            {"email": WHO, "name": WHO_NAME},
            {"email": "j.okonkwo@amd.com", "name": "Jonas Okonkwo"},
        ]})

    page.route("**/api/thread*", thread)
    page.route("**/api/discover/commit*", commit)
    page.route("**/api/discover/author*", author)
    page.route("**/api/discover/people*", people)


def conversation(data, patch):
    """What came back on the list, from the thread the collection holds."""
    name = patch.get("series_name") or patch["subject"]
    t = next((t for t in data.get("threads", [])
              if t.get("series") == name), None)
    out = [{
        "who": data["profile"]["name"], "addr": data["profile"]["email"],
        "date": patch.get("date"), "mine": True, "bot": False,
        "applied": False, "question": False, "tags": [],
        "subject": patch.get("raw_subject") or patch["subject"],
        "body": ("Found by review while reading the probe path for "
                 "something else.\n\nThe change is small and self "
                 "contained. The same mistake is in the two drivers that "
                 "copied this code, and the rest of the series takes care "
                 "of those.\n\nSigned-off-by: %s <%s>\n"
                 % (data["profile"]["name"], data["profile"]["email"])),
        "lore": patch.get("lore", ""),
    }]
    said = list(SAID)
    for n, r in enumerate((t or {}).get("replies", [])[:3]):
        tag = re.match(r"^(Reviewed|Acked|Tested)-by:", r.get("text", ""))
        out.append({
            "who": r.get("who", ""), "addr": "",
            "date": r.get("date"), "mine": False, "bot": False,
            "applied": "applied" in r.get("text", "").lower(),
            "question": r.get("text", "").endswith("?"),
            "tags": [tag.group(1) + "-by"] if tag else [],
            "subject": "Re: " + (patch.get("raw_subject") or patch["subject"]),
            "body": r.get("text") or said[n % len(said)],
            "lore": t.get("lore", "") if t else "",
        })
    return out


def record(data):
    """A public record for somebody who does not exist.

    Built to the same shape and roughly the same proportions as a real
    one: rather more posted than accepted, rather more accepted than has
    surfaced in a tree, and a tail of things that went nowhere."""
    r = random.Random(7)
    # Subject and list travel together: a patch to linux-kselftest is a
    # patch to selftests, and pairing them off at random is the tell.
    rows = [(p["subject"], p.get("list") or "linux-kernel")
            for p in data["patches"]]
    r.shuffle(rows)
    subjects = [s for s, _ in rows]

    def day(n):
        return "2026-%02d-%02d" % (1 + (n * 3) % 9, 1 + (n * 7) % 28)

    merged = [{
        "commit": "%040x" % r.getrandbits(160),
        "subject": subjects[i], "date": day(i),
        "author": WHO_NAME,
        "url": "https://git.kernel.org/torvalds/c/%012x" % r.getrandbits(48),
        "tag": RELEASES[i % len(RELEASES)][0],
        "shipped": RELEASES[i % len(RELEASES)][1],
        "release": RELEASES[i % len(RELEASES)][0].split("-")[0],
    } for i in range(24)]
    for m in merged:
        m["short"] = m["commit"][:12]

    queued = [{
        "commit": "%040x" % r.getrandbits(160),
        "subject": subjects[40 + i], "date": day(20 + i),
    } for i in range(6)]
    for c in queued:
        c["short"] = c["commit"][:12]

    states = (["accepted"] * 9 + ["superseded"] * 3 + ["changes-requested"] * 2
              + ["new"] * 4 + ["under-review"] * 2 + ["rejected"])
    posted = [{
        "subject": rows[60 + i][0], "state": states[i % len(states)],
        "project": "netdevbpf", "list": rows[60 + i][1],
        "date": day(i), "url": "", "commit": "",
    } for i in range(21)]
    taken = [dict(p, state="accepted") for p in posted
             if p["state"] == "accepted"]

    return {
        "ok": True, "email": WHO, "name": WHO_NAME,
        "sources": {"patchwork": True, "git": True},
        "counts": {"submitted": 148, "accepted": 96,
                   "changes_requested": 17, "rejected": 4, "superseded": 22,
                   "merged": len(merged), "in_next": len(queued)},
        "more": {"merged": True, "in_next": False},
        "merged": merged, "in_next": queued,
        "posted": posted, "taken": taken,
        "deep": {"state": "idle", "total": 80},
        "lore": "https://lore.kernel.org/all/?q=f:" + WHO,
        "patchwork": "https://patchwork.kernel.org/project/all/list/"
                     "?submitter=" + WHO,
        "seconds": 2.4,
        "notes": [],
    }

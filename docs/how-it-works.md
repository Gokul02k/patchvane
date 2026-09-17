# How it works

Where the patches come from, how each one is classified, and what the numbers on the overview mean.

## Whose patches it shows

Yours, and it works out which those are from the address you signed up with.
There is no address to configure and nothing to edit: the address you proved
is yours is the one it follows, and you get a dashboard of the patches you
posted from it.

The same server does this for everybody who signs in. Each address gets its
own directory under `people/`, holding its own collected patches, its own
notes and its own API keys, and one person's cookie only ever reaches their
own. Nobody sees anybody else's dashboard, and there is no shared one.

The first time an address signs in there is nothing to show yet, because
reading every thread it ever posted takes a few minutes. The page says so,
waits, and opens itself when the collection lands. After that it is kept
current on a timer along with everyone else's, one at a time so that this
host does not fetch from lore several times over at once.

The name you are greeted by comes from the `From:` line on your own patches,
whichever form of it you use most often.

The timer only collects for people who are signed in at the time. Sign out,
or close the tab and leave it for `PATCHVANE_ACTIVE_MINUTES` (30 by default),
and nothing further is fetched for that address until the next sign-in. Your
collected data stays on disk and is waiting when you come back.

### Keeping it to particular people

Anyone who can read mail at an address can get a dashboard of that address's
patches, which is the point. A shared or private deployment can still narrow
it to a list:

```sh
export PATCHVANE_ALLOW_EMAILS=colleague@kernel.org,@amd.com
```

or `config.json` under `signin.emails`. A bare `@domain` allows everybody at
that domain, which is what a company or a university wants. An address not on
the list is turned away before any code is sent, and the refusal does not name
the addresses that would have worked. `PATCHVANE_ALLOW_SIGNUP=0` stops new
accounts altogether while leaving the existing ones working.

## The three sources

| Source | What it answers |
| --- | --- |
| `lore.kernel.org` | Every message you posted and every reply in those threads: who is reviewing, which tags you were given, who said "applied" |
| `patchwork.kernel.org` | The review state a maintainer set on a patch, and CI results |
| `git.kernel.org` | Whether the commit is in Linus' tree, in `linux-next`, or still only in a maintainer's own tree |

A patch moves through these, worst to best:

```
no reply yet  →  in discussion  →  reviewed  →  accepted
              →  in maintainer tree  →  in linux-next  →  in mainline
```

`in mainline` means it is in Linus' tree. `in linux-next` means a maintainer
took it and it is lined up for the next merge window. `in maintainer tree`
means it is in their tree but has not reached linux-next yet.

## The seven sections

| | |
| --- | --- |
| **Overview** | Where everything stands, with the numbers adding up to the total |
| **Your turn** | Threads owed a reply, series owed a new version, and your own notes |
| **Patches** | Every patch, filtered by status, subsystem or tree |
| **Outcomes** | What landed and where it sits, and what was dropped and why |
| **Discussions** | Threads, the people who replied, and the review tags you collected |
| **Insights** | When you post, which subsystems you touch, how each tree is doing |
| **Settings** | Refresh schedule, the assistant, and the health of each source |

Press `?` for the keyboard shortcuts. `1` to `7` jump between sections, `/`
searches the table on screen, `a` opens the assistant, `r` refreshes.

## What the buckets mean

**Overview → Where all N patches stand** puts every patch in exactly one
bucket, and prints the sum so you can see it balance:

| Bucket | Means |
|---|---|
| In mainline | the commit is in Linus' tree |
| Accepted, on the way | a maintainer took it; heading for a merge window |
| Being reviewed | someone is looking at it, or has already tagged it |
| Needs a new version | changes were requested, so a v2 is owed |
| No reply yet | posted, and nobody has said anything |
| Dropped | superseded, rejected, or picked up somewhere else |

Clicking a bucket opens exactly those patches. If a patch ever lands in a
state the dashboard does not know about it appears as **Unaccounted** rather
than quietly going missing from the total.

The funnel above it is a different thing: it counts how far each patch got,
so a patch in mainline is also counted at every earlier stage. Only the
buckets are meant to add up.

**Your turn** is what you owe the lists: threads where somebody asked you
something last, and series where changes were requested, each with the
version number the next posting should carry.

### When no reply is owed

A kernel list is read by thousands of people, and a reply that tells nobody
anything wastes all of their attention. Maintainers treat acknowledgements as
noise, so "thanks for applying" is the wrong answer to good news; silence is
the right one. Nothing that has been applied, reviewed without a question,
superseded or turned down appears in **Your turn**, and the assistant will
not draft you a thank-you note for one.

Working out which is which is harder than it sounds, because maintainers say
it however they like and the branch is whatever they called it:

    Applied 1-2 to sched_ext/for-7.4.

Nothing in that names a staging branch, the patch numbers sit between the
verb and the tree, and the message opens with "Hello," on its own line so a
glance at the first line shows nothing at all. Three things stop it being
read as a request:

- the phrasings are matched with the patch range allowed for, so "applied
  1-2 to", "applied patches 1-3 to" and "applied 1,2 and 4 to" all read as
  applied;
- a settled state closes the thread whatever the prose says, worked out
  after a model has read the thread rather than before, which is where this
  used to go wrong;
- what is still unclear goes to a model, which is asked the question
  directly: is anybody actually waiting on this person, or would a reply be
  noise? Threads it reads as needing nothing drop out.

The first run of this on a real account took **Your turn** from 38 threads to
10, and the 10 that remain are all somebody asking a question, requesting a
change, or waiting on an answer.

With no API key the first two still apply; only the third is skipped.

### Reading a patch without leaving the page

Clicking a subject anywhere — a patch, a thread, a commit that landed —
opens the whole thing here rather than throwing you at lore in another tab.
It leads with what the patch actually needs from you, then the commit and
which trees carry it, the versions you sent, the rest of the series, and the
conversation in full with the quoted patch folded down. **Open in lore** is
in the corner for the original.

Nothing is fetched until you ask for it, and the message id is checked
against your own patches first, so the endpoint cannot be used to fetch
arbitrary threads or to find out what anybody else is tracking.

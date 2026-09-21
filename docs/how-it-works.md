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

## The eight sections

| | |
| --- | --- |
| **Overview** | How far each patch got, and where every one of them stands now |
| **Your turn** | Threads owed a reply, series owed a new version, and your own notes |
| **Patches** | Every patch, filtered by stage, status, subsystem or tree |
| **Outcomes** | What landed and where it sits, and what was dropped and why |
| **Discussions** | Threads, the people who replied, and the review tags you collected |
| **Insights** | When you post, which subsystems you touch, how each tree is doing |
| **Discover** | Anybody else's patches, and who to send yours to |
| **Settings** | Refresh schedule, the assistant, the sources, and support |

Whoever runs the deployment has a ninth, **Feedback**, described at the end
of this page. Nobody else has it, or can reach what is in it.

Everything is reached by clicking it. There are no keyboard shortcuts to
learn: single letters used to jump between sections and open things, which
meant that typing into a page that had quietly lost focus did something
surprising. Escape still closes whatever is open, because that is what
Escape means everywhere else.

Moving between them is animated, and the animation is doing a job rather
than decorating one. The highlight in the sidebar travels from the section
you left to the one you asked for, so it is clear which of the two you are
looking at; the page you are leaving goes out of focus as the new one
settles, which is what keeps a redraw from reading as a page load; a table
that reorders itself slides its rows to their new places so a row can be
followed across a sort. Anything with *reduce motion* set in its system
gets the same dashboard without any of it, and not merely a faster version:
the movement stops, the positions do not.

## On a smaller screen

The same dashboard, laid out for what is actually there rather than shrunk.
On a phone the sidebar lies down along the bottom, where a thumb reaches;
the road to mainline becomes one stage per line rather than two half-legible
columns; counts go two abreast; and the filters above a table fold into a
button carrying the number of them that are doing anything, so the first row
of the table is on the first screen instead of a screen below it. Tables
themselves keep columns wide enough to read and scroll sideways, which is
the one place sideways scrolling is the right answer.

A phone on its side is the opposite problem — width to spare, 390 pixels of
height — so the same folding happens on any short screen, along with a
shorter top bar. That case is also every laptop with a video call parked on
top of the browser.

Everything that gets pressed is sized for a fingertip rather than for a
cursor, and the small round *i* marks keep the size they are drawn while the
area that answers a tap grows out past them. Past about 1700 pixels the page
stops widening: seven states drawn two feet apart are not easier to compare
than seven drawn a hand apart.

## One patch, counted once

A series sent as v1, corrected, and sent again as v2 is two postings and one
patch. The collection keeps both postings — the history is worth having —
but only one of them speaks for the work: the newest one sent. Where a
maintainer took an earlier version and another went out afterwards, the
landing is a fact about the patch rather than about that one posting, so it
travels to the row that speaks: the patch reads as being in the tree, at
the version you last sent.

Every number on the site is counted over that set. Without it the page said
423 patches where 359 had been written, filed the abandoned v1 under
**Dropped** while v2 sat in mainline, and left the sidebar, the road, the
buckets and the tables each confidently disagreeing with the others.

The versions behind a patch are not lost. The row says how many times it was
sent, the patch opens on all of them, and **Patches** says how many of the
set were sent more than once.

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

## The road to mainline

The road above the buckets answers a different question: not where a patch
is, but how far it got.

| Stage | Reached it by |
|---|---|
| Written and sent | being posted to a kernel list |
| Somebody answered | a reply coming back, or review starting |
| A maintainer took it | being applied to a tree, or marked accepted |
| Queued in linux-next | being lined up for the next merge window |
| In mainline | the commit being in Linus' tree |

The stages are cumulative, so a patch in mainline is counted at all five and
the numbers narrow from left to right. Only the buckets are meant to add up.

Each stage says three things, because they are three different questions.
**Through** is how many got at least this far, and clicking it opens them.
**Sitting here** is how many got this far and no further and are still
alive. **Dropped** is how many reached this stage and then stopped for good,
and the dustbin beside it opens exactly those, so "what happened to the ones
people replied to and then nothing" is a question you can press rather than
one you have to reconstruct.

The overview used to carry four counters above this saying much the same
thing in fewer words. They are gone: two ways of counting the same work,
side by side, is how a page ends up arguing with itself.

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

Clicking a commit id opens the commit the same way, and it carries the diff:
the message, the trees that hold it, and then the patch itself, coloured the
way a diff has to be coloured to be read at all. It is read live from
git.kernel.org, so a commit opened when that host cannot be reached says so
instead of showing an empty change. Diffs that run to hundreds of kilobytes
are cut at a file boundary, with a link to cgit for the rest.

### Narrowing a list

Every list has a dropdown for each column worth grouping by, and every
option in one says how many rows it would leave: `linux-next (64)`,
`Rejected (16)`, `dropped at Somebody answered (15)`. An option that would
leave nothing is not offered.

They are built from the rows on screen rather than written out by hand, so
a list and its filters cannot fall out of step, and the same dropdown
appears on the patch list, the commits, the threads, the review tags, the
Discover tables and the feedback. The search box beside them still takes
`tree:net-next` and the like, and **Clear** puts everything back.

## Telling whoever runs it that something is wrong

**Settings → Support** answers the common questions first — the ones that
are usually a misunderstanding rather than a bug — and then takes what you
write. It asks what kind of thing it is only after you have described it,
because being made to classify something before describing it is how
feature requests get filed as bugs.

Every report is written down on the deployment first, and only then passed
on by mail or filed as an issue if that has been set up. That order matters:
the page used to tell people there was "nowhere for this to go" on a
deployment with neither, which is a strange thing to say to somebody who has
just found a bug.

Whoever the deployment belongs to gets a **Feedback** section of their own
in the sidebar, carrying the number of reports nobody has looked at yet,
and listing everything sent, filtered by kind, status, page or person.
Answering one sets where it stands (read, being worked on, done, not going
to change, waiting on you) and can add a note. Both go back to whoever
wrote it: by mail if the deployment can send mail, and on their own Support
tab either way, so a report is never a message dropped into a hole.

Nobody on the deployment sees that section but its owner, and nobody has to
set anything up to be one. `PATCHVANE_OWNER` still says who it is where
that matters — a shared host, or a deployment somebody else signed into
first. Where it is not set, the owner is whoever signed in here first,
which on a deployment somebody started for themselves is the only person it
could be. The answer is written down the first time it is reached, so it
cannot move to somebody else later.

The section is not the permission. The server decides who the owner is and
checks it again on every request, so a drawn section and a reachable
endpoint are the same question asked twice.

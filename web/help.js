/* The help, as content rather than as a page.

   Kept apart from the views so that adding an answer is adding an entry
   here, and so that the search below has something to search: a FAQ built
   as markup can only be found by whatever words happen to be visible, and
   the words somebody types are usually not those. Each entry carries the
   things people call it as well as the things it is called.

   Written to be read by somebody who is stuck, which means answering the
   question rather than describing the feature. */

const HELP = [
  {
    id: "states",
    topic: "Your patches",
    q: "What do the states mean?",
    also: "status awaiting under review accepted merged superseded handled "
        + "elsewhere changes requested rejected what does mean",
    a: `**Awaiting** means it is on the list and nobody has replied yet.
**Under review** means somebody has. **Changes requested** means a new
version is owed. **Superseded** means you sent a later version, so this one
is finished with. **Accepted** means a maintainer took it. **In linux-next**
means it is queued for a merge window, and **merged** means it is in Linus'
tree and there is nothing left to do.

**Handled elsewhere** is the awkward one: the patch went somewhere this
dashboard cannot follow, usually another tree or another list.`,
  },
  {
    id: "read-mark",
    topic: "Your patches",
    q: "What is the 'read' mark beside some patches?",
    also: "ai read mark model guessed status where did this status come from",
    a: `A patch in a tree, or one a maintainer marked in patchwork, is a
recorded fact and is never second-guessed. The rest is somebody writing in
English -- "I've taken this", "send it via net-next instead" -- and those are
easy to misread.

Where the status had to be worked out from a reply rather than read off a
record, a model was asked, and the patch carries a **read** mark to say so.
It is there precisely so a reading is never mistaken for a record. Settings
→ Assistant shows how many of your patches were decided that way.`,
  },
  {
    id: "missing",
    topic: "Your patches",
    q: "A patch of mine is missing",
    also: "not showing cannot find where is my patch missing incomplete count wrong",
    a: `Everything here is found by the address on the patch. The usual
reason one is missing is that it was sent from a different address, or to a
list that patchwork does not track.

A patch a maintainer applied keeps the **From:** line it was posted with, so
if you post from one address and sign off with another, the commit is
counted under the first. Try the other address in Discover and see whether
it turns up there.`,
  },
  {
    id: "collection",
    topic: "Collecting",
    q: "How often does it look, and can I make it look now?",
    also: "refresh interval automatic timer update stale out of date collect now",
    a: `Settings → General has the timer and how often it runs, and
**Refresh now** does one immediately. The schedule is yours and is kept with
your account, so signing in from another machine finds the same one.

**Full rescan** is the slower button. It walks every maintainer tree on
git.kernel.org and takes several minutes, and you only need it if a commit
landed somewhere unusual.`,
  },
  {
    id: "first-run",
    topic: "Collecting",
    q: "My first collection is taking a long time",
    also: "slow setting up empty dashboard nothing here yet how long first",
    a: `A first collection reads several hundred threads from lore and asks
git.kernel.org about each patch, which takes a few minutes. The page says
how far it has got, and you can leave it and come back.

Discover works while you wait -- it is the one part of this that does not
need a collection of your own.`,
  },
  {
    id: "sources",
    topic: "Collecting",
    q: "Where does the data come from?",
    also: "lore patchwork git kernel org sources privacy what do you read",
    a: `Three public archives and nothing else: **lore.kernel.org** for the
threads, **patchwork.kernel.org** for what maintainers marked, and
**git.kernel.org** for what actually landed. Settings → Data sources
lists them and says when each was last reached.

Nothing is posted anywhere. This reads.`,
  },
  {
    id: "keys",
    topic: "The assistant",
    q: "Which model does the assistant use, and where does my key go?",
    also: "api key openai claude gemini model dropdown best which model stored",
    a: `Whichever you give it a key for. Paste a key in Settings →
Assistant and it asks that service what your key can actually run, picks the
most capable of them, and offers the rest in a list beside it. Nothing is
hard coded, which is why no model is named until there is a key to name one
from.

Your key is encrypted and kept against your account, and is never sent
anywhere except to the service it belongs to. One key is enough; more than
one means the assistant can fall back when a service is busy.`,
  },
  {
    id: "ai-sends",
    topic: "The assistant",
    q: "What gets sent to the model when I ask something?",
    also: "privacy prompt data digest what leaves reviewers addresses",
    a: `A digest of what this dashboard collected: totals, per-tree numbers,
landed commits, open threads and review tags. Reviewer addresses are masked
before they leave. No mail bodies and no credentials go with it.`,
  },
  {
    id: "history",
    topic: "The assistant",
    q: "Can I get an earlier conversation back?",
    also: "history past chats previous sessions lost conversation clock",
    a: `Yes. The clock beside the **+** in the assistant opens everything you
have asked before, titled by the question. Opening one puts it back in the
window; **+** starts a fresh one without losing it.

They are kept against your account rather than in this browser, so they are
there from another machine too. Any of them can be removed, and **Remove
all** clears the lot.`,
  },
  {
    id: "merged-mail",
    topic: "Mail",
    q: "Will you email me?",
    also: "notifications email spam merged mainline congratulations turn off",
    a: `Only about your account -- signing in, changing a password -- unless
you ask for more.

The one thing you can ask for is Settings → General → **When a
patch lands**, which writes to you when a commit of yours reaches Linus'
tree. It is off until you switch it on, and switching it on does not mean
hearing about everything that already landed: what has been seen is
remembered either way, so you get the next one.`,
  },
  {
    id: "discover",
    topic: "Discover",
    q: "Can I look somebody up by name?",
    also: "search author name email suggestions autocomplete who is",
    a: `Yes. Discover → **An author** takes a name or an address, and
suggests people as you type from MAINTAINERS and from anybody looked up
here before. A name nobody has asked for is resolved against mainline and
then remembered, so it is offered next time.

If a name belongs to two people, both are shown and you pick -- guessing and
being wrong would show you a stranger's record.`,
  },
  {
    id: "rc-tags",
    topic: "Discover",
    q: "What does 'first in v7.4-rc1' mean, and what is '(due)'?",
    also: "release tag rc version which kernel shipped due mainline",
    a: `The **first tag** that contains the commit, which is nearly always a
release candidate, and then the numbered release it ships in. A commit
merged during the 7.4 merge window is first in **v7.4-rc1** and ships in
**v7.4**, and both are true.

**(due)** means it has been merged but no release has been tagged since, so
that is the release it is heading for rather than one you can install.`,
  },
  {
    id: "maintainers",
    topic: "Discover",
    q: "Who do I send my patch to?",
    also: "get_maintainer send to cc list subsystem file path maintainers",
    a: `Discover → **Who to send to** takes a file path or a subsystem
name and reads MAINTAINERS the way \`get_maintainer.pl\` does, giving the
maintainers, the reviewers and the lists, with the section each came from.

Paths work best: \`sound/soc/codecs/wm8994.c\` is a better question than
"audio".`,
  },
  {
    id: "account",
    topic: "Your account",
    q: "How do I change my picture, my name or my password?",
    also: "profile avatar photo password change username settings where",
    a: `The corner menu → **Profile**. Everything about you is there,
which is why Settings has none of it: Settings is about how the dashboard
behaves, Profile is about you.

A picture is optional and can be replaced or removed at any time.`,
  },
  {
    id: "signin",
    topic: "Your account",
    q: "I cannot sign in",
    also: "password forgot locked out code email not arriving login trouble",
    a: `**Forgot password** on the sign-in page sends a code to your address.
If it does not arrive, check that the address is the one you signed up with,
and look in spam.

You can sign in with either your username or your email address, with the
same password.`,
  },
];

/* Search across it.

   Whole words first, then partial ones, and the alternative words each entry
   carries count for as much as the question does -- somebody typing "spam"
   is asking about mail notifications and will never type "notifications". */
function helpSearch(query) {
  const q = (query || "").toLowerCase().trim();
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const hits = [];
  for (const item of HELP) {
    const hay = (item.q + " " + item.also + " " + item.topic + " " + item.a)
      .toLowerCase();
    let points = 0;
    for (const w of words) {
      if (new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(hay))
        points += 3;
      else if (hay.includes(w)) points += 1;
      /* A word in the question itself is worth more than the same word
         buried in the answer, where every long answer mentions everything. */
      if (item.q.toLowerCase().includes(w)) points += 4;
    }
    if (points) hits.push({ item, points });
  }
  hits.sort((a, b) => b.points - a.points);
  return hits.map((h) => h.item);
}

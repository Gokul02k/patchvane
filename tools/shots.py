#!/usr/bin/env python3
"""Screenshot the dashboard for the README.

Points a headless browser at a throwaway instance, signs in as an account
that already exists there, and writes PNGs into docs/.  The address on
screen is replaced with a placeholder first: the patch data itself is
public, but there is no reason for a README to carry anybody's inbox
around.

The instance is expected to have the account already: making one means
reading a code out of a mailbox, which is not something to automate here.
Run the throwaway server, sign up once by hand, then set SHOTS_USER and
SHOTS_PASSWORD to what you chose.

Pages are reached by clicking what a reader would click.  There is nothing
to type at: the dashboard has no keyboard shortcuts, so a script that
pressed "3" for the patch list would now be pressing it into the page.

Set SHOTS_INVENTED to a collection file to shoot an instance filled with
invented work.  Three panels read live hosts rather than the collection --
the patch drawer, the commit drawer and Discover -- and none of them can
answer for a message id that was never posted.  With that set they are
answered from the same invented collection instead, in the shape the
server would have used; see tools/shots_invented.py.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import shots_invented
from playwright.sync_api import sync_playwright

BASE = os.environ.get("SHOTS_BASE", "http://127.0.0.1:8901")
USER = os.environ.get("SHOTS_USER", "")
PASSWORD = os.environ.get("SHOTS_PASSWORD", "")
TRACK = os.environ.get("SHOTS_TRACK", "")
SHOWN = os.environ.get("SHOTS_SHOWN", "you@example.org")
# Somebody to look up on Discover.  Any address with public patches does.
FIND = os.environ.get("SHOTS_FIND", "tj@kernel.org")
# A collection to answer the live panels from, rather than lore.
INVENTED = os.environ.get("SHOTS_INVENTED", "")

if not TRACK:
    sys.exit("Set SHOTS_TRACK to the address whose dashboard should be shot.")
if not (USER and PASSWORD):
    sys.exit("Set SHOTS_USER and SHOTS_PASSWORD to an account on that server.")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "images")

# Swap the real address for a placeholder everywhere it is rendered, including
# the avatar initials and any title attribute.
MASK = """
([real, shown]) => {
  const walk = (node) => {
    if (node.nodeType === 3) {
      if (node.nodeValue && node.nodeValue.includes(real))
        node.nodeValue = node.nodeValue.split(real).join(shown);
      return;
    }
    if (node.nodeType !== 1) return;
    for (const a of ['title', 'aria-label', 'value', 'placeholder']) {
      const v = node.getAttribute && node.getAttribute(a);
      if (v && v.includes(real)) node.setAttribute(a, v.split(real).join(shown));
    }
    node.childNodes.forEach(walk);
  };
  walk(document.body);
  const local = real.split('@')[0];
  document.querySelectorAll('*').forEach(el => {
    if (el.children.length === 0 && el.textContent.trim() === local)
      el.textContent = shown.split('@')[0];
  });
}
"""


def shoot(page, name, wait=2200, at=""):
    """Mask the address, then capture what is on screen.

    `at` frames a panel further down the page.  It happens after the wait
    rather than before it: a view that is still fetching redraws itself
    when the answer lands, and a redraw puts the scroll back to the top."""
    page.wait_for_timeout(wait)
    if at:
        scroll_to(page, at)
    page.evaluate(MASK, [TRACK, SHOWN])
    page.wait_for_timeout(250)
    dest = os.path.join(OUT, name)
    page.screenshot(path=dest)
    print("wrote %s (%d KB)" % (name, os.path.getsize(dest) // 1024))


def view(page, label, name, wait=2600):
    """A section, reached the way a reader reaches it: by clicking it."""
    page.click(".navitem:has-text('%s')" % label)
    shoot(page, name, wait=wait)


def tab(page, label):
    """One of the tabs inside a section."""
    page.click(".tabs button:has-text('%s')" % label)
    page.wait_for_timeout(900)


def scroll_to(page, heading, above=150):
    """Put a panel below the fold at the top of the shot.

    `above` leaves room for the bar the page keeps pinned there, which
    would otherwise sit over the heading being framed."""
    found = page.evaluate(
        """([text, above]) => {
             const h = [...document.querySelectorAll('h2, h3')]
               .find(e => e.textContent.includes(text));
             if (!h) return false;
             const box = h.closest('.panel') || h;
             box.scrollIntoView({ block: 'start', behavior: 'instant' });
             // Whichever of the two actually scrolls: the bar pinned to the
             // top of the page would otherwise sit over the heading.
             const pane = document.querySelector('.content');
             if (pane) pane.scrollBy(0, -above);
             window.scrollBy(0, -above);
             return true;
           }""", [heading, above])
    if not found:
        print("nothing headed %r to scroll to" % heading, file=sys.stderr)
    page.wait_for_timeout(700)


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--force-color-profile=srgb"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900},
                                  device_scale_factor=2)
        page = ctx.new_page()

        find = FIND
        if INVENTED:
            shots_invented.install(page, INVENTED)
            find = shots_invented.WHO

        page.goto(BASE + "/login", wait_until="networkidle")
        page.screenshot(path=os.path.join(OUT, "shot-login.png"))
        print("wrote shot-login.png")

        page.fill("#who", USER)
        page.fill("#password", PASSWORD)
        page.click("#go-signin")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(4000)

        if "/login" in page.url:
            print("still on the login page; sign-in did not take", file=sys.stderr)
            print(page.content()[:1200], file=sys.stderr)
            return 1

        shoot(page, "shot-dashboard.png", wait=5000)

        view(page, "Your turn", "shot-your-turn.png")
        view(page, "Patches", "shot-patches.png")

        # The same list, narrowed to what was dropped after somebody had
        # already replied to it: what the dustbins on the road open.
        page.evaluate("() => showStage('answered', 'lost')")
        shoot(page, "shot-filtered.png", wait=1800)

        view(page, "Outcomes", "shot-outcomes.png")
        tab(page, "Dropped")
        shoot(page, "shot-dropped.png", wait=1400)

        view(page, "Discussions", "shot-discussions.png")
        view(page, "Insights", "shot-insights.png")

        # A patch, read where it was clicked rather than on lore.
        page.click(".navitem:has-text('Patches')")
        page.wait_for_timeout(1500)
        page.click("table .subject a", timeout=15000)
        shoot(page, "shot-thread.png", wait=9000)
        page.keyboard.press("Escape")
        page.wait_for_timeout(600)

        # A commit, with the diff in it.  Read live from git.kernel.org
        # unless SHOTS_INVENTED says otherwise, so a network that cannot
        # reach it gets the drawer's own apology instead of a diff.
        page.click(".navitem:has-text('Outcomes')")
        page.wait_for_timeout(1500)
        tab(page, "Landed")
        if INVENTED:
            # The one commit whose invented diff matches its subject, asked
            # for by name rather than by clicking whichever row is first.
            cid, tree, _ = shots_invented.picked(INVENTED)
            page.evaluate("([c, t]) => openCommit(c, t)", [cid, tree])
        else:
            page.click("table a.mono", timeout=15000)
        shoot(page, "shot-commit.png", wait=9000)
        page.keyboard.press("Escape")
        page.wait_for_timeout(600)

        view(page, "Discover", "shot-discover-empty.png", wait=1500)
        page.fill("input[data-find='q']", find)
        page.keyboard.press("Enter")
        # The two patchwork lists are the point of the page and they sit
        # below the counts, so frame them rather than the top of it.
        shoot(page, "shot-discover.png", wait=22000,
              at="Accepted by a maintainer")

        page.evaluate("() => go('settings')")
        page.wait_for_timeout(1500)
        shoot(page, "shot-settings.png", wait=1200)
        tab(page, "Support")
        page.wait_for_timeout(2000)
        page.fill("#fbtext", "The road to mainline counts a patch I sent "
                             "twice as one, which is right, but the pill on "
                             "the row still says v1.")
        shoot(page, "shot-support.png", wait=1200, at="Tell us something")
        tab(page, "Feedback")
        shoot(page, "shot-feedback.png", wait=2200)

        # The overview again, in the other theme.
        page.evaluate("() => go('overview')")
        page.wait_for_timeout(1200)
        page.evaluate("() => { document.documentElement.dataset.theme = 'light';"
                      " localStorage.setItem('patchvane-theme','light'); }")
        page.reload(wait_until="networkidle")
        shoot(page, "shot-light.png", wait=5000)

        browser.close()
    return 0


sys.exit(main())

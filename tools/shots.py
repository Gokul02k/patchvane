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
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("SHOTS_BASE", "http://127.0.0.1:8901")
USER = os.environ.get("SHOTS_USER", "")
PASSWORD = os.environ.get("SHOTS_PASSWORD", "")
TRACK = os.environ.get("SHOTS_TRACK", "")
SHOWN = os.environ.get("SHOTS_SHOWN", "you@example.org")

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


def shoot(page, name, wait=2200):
    """Mask the address, then capture what is on screen."""
    page.wait_for_timeout(wait)
    page.evaluate(MASK, [TRACK, SHOWN])
    page.wait_for_timeout(250)
    dest = os.path.join(OUT, name)
    page.screenshot(path=dest)
    print("wrote %s (%d KB)" % (name, os.path.getsize(dest) // 1024))


def view(page, key, name, wait=2600):
    """Views are keyboard-switched, 1..7 down the sidebar."""
    page.keyboard.press(key)
    shoot(page, name, wait=wait)


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--force-color-profile=srgb"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900},
                                  device_scale_factor=2)
        page = ctx.new_page()

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
        view(page, "2", "shot-your-turn.png")
        view(page, "3", "shot-patches.png")
        view(page, "6", "shot-insights.png")

        # Same overview again in the light theme.
        page.keyboard.press("1")
        page.wait_for_timeout(1200)
        page.evaluate("() => { document.documentElement.dataset.theme = 'light';"
                      " localStorage.setItem('patchvane-theme','light'); }")
        page.reload(wait_until="networkidle")
        shoot(page, "shot-light.png", wait=5000)

        browser.close()
    return 0


sys.exit(main())

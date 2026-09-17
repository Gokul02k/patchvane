#!/usr/bin/env python3
"""Render README.md the way GitHub will, and screenshot the result.

Uses GitHub's own markdown API so the HTML matches, then serves it locally
with GitHub's colours so the relative image paths and <picture> blocks
resolve exactly as they will on the repository page.
"""
import http.server
import json
import os
import socketserver
import threading
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8799

SHELL = """<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5/github-markdown.css">
<style>
  body { margin: 0; background: %(page)s; }
  .markdown-body { box-sizing: border-box; max-width: 1012px; margin: 0 auto;
                   padding: 32px 32px 80px; }
</style>
<article class="markdown-body" data-color-mode="%(mode)s" data-%(mode)s-theme="%(theme)s">
%(body)s
</article>
"""


def render(md):
    req = urllib.request.Request(
        "https://api.github.com/markdown",
        data=json.dumps({"text": md, "mode": "markdown"}).encode(),
        headers={"Content-Type": "application/json",
                 "Accept": "application/vnd.github+json",
                 "User-Agent": "patchvane-readme-preview"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode()


def main():
    md = open(os.path.join(ROOT, "README.md")).read()
    body = render(md)
    print("rendered %d bytes of HTML from GitHub" % len(body))

    for mode, theme, page in (("dark", "dark", "#0d1117"),
                              ("light", "light", "#ffffff")):
        with open(os.path.join(ROOT, "_preview-%s.html" % mode), "w") as f:
            f.write(SHELL % {"body": body, "mode": mode,
                             "theme": theme, "page": page})

    os.chdir(ROOT)
    handler = http.server.SimpleHTTPRequestHandler
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    with sync_playwright() as p:
        b = p.chromium.launch()
        for mode in ("dark", "light"):
            page = b.new_context(viewport={"width": 1100, "height": 1400},
                                 device_scale_factor=1,
                                 color_scheme=mode).new_page()
            page.goto("http://127.0.0.1:%d/_preview-%s.html" % (PORT, mode),
                      wait_until="load")
            # Open every <details> so the gallery shows in the shot.
            page.evaluate("() => document.querySelectorAll('details')"
                          ".forEach(d => d.open = true)")
            page.wait_for_timeout(2500)
            out = os.path.join(ROOT, "docs", "images", "_preview-%s.png" % mode)
            page.screenshot(path=out, full_page=True)
            print("wrote", out)
        b.close()
    srv.shutdown()


main()

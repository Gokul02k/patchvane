#!/usr/bin/env python3
"""Rasterise an SVG through a real browser, to check what a reader will see.

Animated SVGs are frozen at a few points along the timeline so each stage of
the animation can be eyeballed.
"""
import os
import sys

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main(src, w, h, stops):
    out = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_context(viewport={"width": int(w), "height": int(h)},
                             device_scale_factor=2).new_page()
        page.goto("file://" + os.path.abspath(src))
        for t in stops:
            # Park the SMIL timeline at t seconds.
            page.evaluate("(t) => { const s = document.querySelector('svg');"
                          " if (s && s.pauseAnimations) { s.setCurrentTime(t);"
                          " s.pauseAnimations(); } }", t)
            page.wait_for_timeout(200)
            dest = os.path.join(HERE, "docs", "images", "_check-%s-%s.png"
                                % (os.path.basename(src).split(".")[0], t))
            page.screenshot(path=dest)
            out.append(dest)
        b.close()
    for o in out:
        print(o)


if __name__ == "__main__":
    src = sys.argv[1]
    w, h = sys.argv[2], sys.argv[3]
    stops = [float(x) for x in sys.argv[4].split(",")]
    main(src, w, h, stops)

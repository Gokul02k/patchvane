# Contributing

## Before a change

Run it. `./run.sh` on a fresh clone should still be the whole of the setup,
and anything that adds a step to it needs a good reason.

`requirements.txt` is empty on purpose. The standard library is the whole of
what this runs on, and a change that adds a dependency is a change to what
the project is, so raise it as an issue first rather than in a pull request.

## Sending a change

Fork, branch, and open a pull request. Say what was wrong before and what is
different after; the diff already shows what changed.

Commit messages here are written for somebody reading `git log` in a year:
a short line saying what the commit does, then paragraphs explaining what the
old behaviour was and why it was worth changing. Look at the existing history
for the shape of it.

One change per commit. A fix and a rename of the thing it fixes are two
commits.

## The house style

Match what is already there rather than any general rule.

Python is 4 spaces, lines under 79 characters, and standard library only.
JavaScript is 2 spaces and no framework: `app.js` and `ui.js` are written
against the DOM directly and are meant to stay that way. CSS keeps its
colours in the custom properties at the top of `style.css`, so both themes
follow from one place.

Comments explain why, not what. Most of the files open with a paragraph
saying what the file is for, and that is usually the right place for
reasoning that applies to the whole of it.

## Screenshots in the README

They are generated, not taken by hand. `tools/shots.py` drives a headless
browser over a throwaway instance and masks the signed-in address first; the
docstring says how to run it. If a change alters what a page looks like,
regenerate them and check the result with `tools/preview_readme.py`, which
renders `README.md` through GitHub's own markdown API.

## Licensing what you send

The project is under the Apache License 2.0. Opening a pull request means you
are offering your change under that license, as section 5 of it describes,
and that you wrote it or otherwise have the right to send it.

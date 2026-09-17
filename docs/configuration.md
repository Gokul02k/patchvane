# Configuring

Every setting in config.json, and what each file in the tree is for.

`config.json`

- `app_name`, `app_tagline` — what the sign-in page and window title say
- `email`, `name` — whose contributions to track, and who may sign in
- `signin.emails` — narrow sign-in to these addresses; empty means anyone
  who can log into their own mailbox
- `cache_hours` — how long a fetched response stays fresh
- `auto_refresh_minutes` — how often the server collects on its own
- `netdev_outstanding_cap` — the limit `maintainer-netdev.rst` asks for, shown
  as a gauge on **Insights → Trees**
- `ai.models` — which model each provider uses. **Settings → Assistant**
  writes this: a card with a key offers *change*, which lists what that key
  can actually reach and remembers what you pick, e.g. `"openai": "gpt-5.6-sol"`;
  leave a provider out to use its default
- `ai.endpoints` — point a provider at a different address, for a company
  gateway or a regional endpoint that speaks the same wire format
- `ai.classify_limit` — how many unclear threads one collection may ask a
  model about
- `korg.trees` — maintainer trees the hash probe may ask about

`notes.json` fills **Your turn → Your notes** with things no API knows: what is blocked,
what you are waiting on, what to fix before the next respin. Each entry takes
a `title`, `state` (`blocked`, `todo`, `waiting`, `held`, `rule`), `detail`,
`next` and `tree`.

## Files

The code is in `src/`, the pages it serves are in `web/`, and everything
written at run time stays at the top of the tree.

```
src/
  collect.py    gathers everything, writes data.json
  serve.py      web server, Gmail sign-in, refresh timer, assistant routes
  providers.py  the models the assistant can use, and the failover between them
  aiclass.py    asks a model about threads the regular expressions could not read
  vault.py      per-person secrets, encrypted where they sit
  redact.py     masks reviewer addresses before anything is sent to a model
  netcheck.py   can this machine read the archives? run it when a collection
                comes back empty

web/
  index.html    the dashboard shell
  login.html    sign-in page
  app.js        views, tables and charts, no dependencies
  ui.js         data grid, charts and animation engine
  login.js      the sign-in form
  style.css     dark and light themes

docs/           this documentation, and images/ holds the logo, the banner
                and the screenshots it shows
tools/          how those are made: shots.py drives a headless browser over a
                throwaway instance, preview_readme.py renders the README the
                way GitHub will
deploy/         systemd unit, Caddy configuration and the two scripts that
                set up and update a server

config.json     what to collect
notes.json      seeds Your turn → Your notes
requirements.txt  empty on purpose: the standard library is the whole of it
cache/          fetched responses, safe to delete
people/         one directory per signed-in address: their patches, their notes
                and their own encrypted vault.json of API keys (mode 0600)
LICENSE         Apache License 2.0
NOTICE          what the copyright covers, and the archives this reads
```

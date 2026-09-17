# Running it

Starting the server, signing in, and keeping the data current.

<div align="center">
  <img src="images/terminal.svg" alt="A first run: ./run.sh writes .env, generates the secret and starts the server" width="820">
</div>

```bash
cd patchvane
./run.sh                    # then open http://127.0.0.1:8787
```

That is the whole of it, on a fresh clone. `run.sh` writes a `.env` from
`.env.example` if there is none, generates the secret that signs the session
cookie, and starts the server. Nothing to copy, edit or generate by hand, and
running it again reuses what the first run wrote.

It starts in the background and gives the prompt back, because this is a
dashboard you leave running and holding a terminal open for it only costs you
the terminal.

```bash
./run.sh --status     is it running, and where
./run.sh --log        follow the log
./run.sh --restart    pick up a change
./run.sh --stop       stop it
./run.sh --fg         run in this terminal instead, Ctrl-C to stop
```

There is no install step either. `requirements.txt` is there and lists
nothing, because the whole of this runs on the Python standard library: no
requests, no web framework, no crypto library. `run.sh` installs from it only
if a real line ever appears there, so the usual run does not need pip at all.
All it wants is Python 3.10 or newer, which it checks for before starting.

`python3 src/serve.py` also works, and skips `.env` entirely.

Sign in, and it starts collecting the patches you posted from that address.
The first run takes a few minutes because it reads the whole lore archive for
you. After that the server keeps collecting on a timer, so the page stays
current on its own.

There is nothing to configure first. It does not need to be told who you are,
because signing in tells it.

On WSL, `http://127.0.0.1:8787` opens straight from the Windows browser
because WSL2 forwards localhost. If it does not, run
`python3 src/serve.py --host 0.0.0.0` and use the address from `hostname -I`.

```bash
python3 src/serve.py --port 9000     # somewhere else
python3 src/serve.py --interval 5    # collect every five minutes
python3 src/serve.py --no-auto       # only collect when you ask
```

## Signing up, and signing in

Make an account once: your name, a username, and the address you send patches
from. A six digit code goes to that address, and typing it back is what proves
the address is yours. Then choose a password, and you are in.

That address is the one Patchvane follows. Any address works, not just Gmail:
`@kernel.org`, `@amd.com`, a university, whatever is on your `Signed-off-by`.

After that, sign in with **either your username or your address**, and your
password. Passwords are at least eight characters with a capital, a lowercase,
a number and a symbol, and are kept as scrypt hashes; the password itself is
never written down and never emailed. Forgotten it is the same shape: a code
to your address, then a new password.

Only a signed session token is kept, in a cookie, and the server holds no
session table. The server listens on `127.0.0.1` by default, so nothing else
on the network can reach it.

### Getting the code sent

Sending mail is the one thing here that needs an account somewhere else.
Running on your own machine you need nothing: with no provider configured the
code is written to the server's own log, which is the terminal you started it
in. Read it from there and carry on.

Anything reachable from the internet needs a real one. See
[deploying](deploying.md#email) for that.

Stopping the server signs you out: on a machine you run for yourself,
stopping it is how you finish with it, and coming back to find somebody's
dashboard still open is not what that looked like it meant. Something
deployed wants the opposite, since restarting for a new version should not
throw everyone back to the login page, so set
`PATCHVANE_SIGN_OUT_ON_RESTART=0` there. A sign-in lasts
`PATCHVANE_SESSION_HOURS` either way, twelve by default.

## Refreshing

The server collects on a timer, every fifteen minutes by default. Turn it off
or change the interval on **Settings → General**, or press `r` for a run right
now. Responses are cached under `cache/`, so a scheduled run only fetches what
changed and usually finishes in about a second.

Collecting from the command line still works:

```bash
python3 src/collect.py --quick        # mainline and linux-next only, fastest
python3 src/collect.py --fresh        # ignore the cache
python3 src/collect.py --all-trees    # search every maintainer tree, slow
python3 src/collect.py lore           # one source only
python3 src/collect.py --standalone   # also write a single-file dashboard.html
```

`--all-trees` asks cgit to search each maintainer tree by author, which makes
git.kernel.org walk the whole history and can take minutes per tree. The
default does not need it: `linux-next` already carries every maintainer's
`-next` branch, and where patchwork knows the commit hash the tree is asked
about that one hash instead, which is a single fast request.

`--standalone` writes `dashboard.html` with the data baked in, openable with no
server and no sign-in. Treat that file as public.

### When a collection comes back empty

A step that fails is recorded and the run carries on, so that patchwork being
down does not cost you what the other two had to say. The price is that a run
which could not read a single message still finishes and still writes a file,
and that file is a dashboard of zeros with an honest timestamp on it. The
overview says so when it happens, naming the part that failed.

Behind a proxy or a filtered network that is usually the whole story, and this
asks the same hosts the same way the collector does:

```bash
python3 src/netcheck.py
```

If it cannot reach `lore.kernel.org`, no amount of collecting will fill the
page. Note that a refusal is remembered for the life of the cache entry, so
after fixing the network, clear it: `rm -rf cache/`.

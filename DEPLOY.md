# Putting Patchvane on the internet

This puts Patchvane on a machine that is not yours to keep running, on a
domain with a certificate, open to anybody who wants a dashboard of their own
patches. After the first hour it maintains itself: a push to `main` is a
deploy, and nothing on your own machine needs to be switched on.

There are two ways to do it and both are free. They differ in one thing that
turns out to matter more than anything technical: whether you have to hand a
card over to get started.

| | Render | Oracle Cloud |
|---|---|---|
| Card to sign up | no | yes, verified and not charged |
| Stops when quiet | after 15 minutes, see below | no |
| Disk that survives a restart | no, see below | yes, a real one |
| What you get | a container and an HTTPS URL | a machine you are root on |

Almost nothing is left in the first column, and it is worth saying why so
that nobody spends an afternoon rediscovering it. **Northflank, Koyeb and
Fly all want a card**; Northflank's billing documentation is explicit that
every user must add a payment method before creating anything, free plan or
not. **Hugging Face** now requires a paid plan to create a Docker Space.
**Vercel, Netlify and Cloudflare Pages** host frontends: Vercel's own docs
say that if you need a server up all day you want a VM, and their free
scheduled jobs run once a day where Patchvane wants to collect every few
minutes.

The card is not really about money. It is the thing that stops one person
signing up ten thousand times to mine cryptocurrency, and a host that gives
away always-on compute without one does not stay in business. Oracle never
charges an Always Free account, so if a card is available at all, route B is
the better system by some distance. It rejects RuPay, prepaid and virtual
cards, though, which is a wall rather than a price.

Route A takes the two things Render's free plan does not give you and works
around both.

**No disk.** Nothing written survives a restart, and for this application
that is not a detail: the patches can be collected from lore again, slowly,
but the notes people wrote and the keys in their vaults cannot. So the data
directory is a git repository, restored from a private repository when the
container starts and snapshotted while it runs. That is what
`deploy/cloud-entrypoint.sh` does.

**Sleep.** Render stops a free service after fifteen minutes with no traffic,
and a stopped Patchvane collects for nobody. So `.github/workflows/keep-
awake.yml` knocks on the door every few minutes. The hours that uses are
hours Render grants — 750 a month against 744 in the longest month — which
fits, and fits with almost nothing spare, so keep to one free service.

---

# Route A: Render, with no card

You need a GitHub account and nothing else.

## 1. Somewhere to keep the data

Make a **private** repository for it, separate from the code. On GitHub,
**New repository**, name it `patchvane-data`, set it to **Private**, and
create it empty — no README, no licence. The first snapshot will fill it.

Private matters. Vaults are sealed before they are written, but publishing
other people's sealed keys is not a thing to do on purpose.

## 2. Something that can write to it, and to nothing else

A **deploy key** is the better of the two ways, because it reaches exactly
one repository, cannot read anything else in the account, and does not expire
on a date nobody wrote down. Make one:

```bash
ssh-keygen -t ed25519 -N "" -C "patchvane-data snapshots" -f ~/.patchvane-deploy/data_key
```

In `patchvane-data` on GitHub, **Settings**, **Deploy keys**, **Add deploy
key**. Paste the contents of `~/.patchvane-deploy/data_key.pub`, and tick
**Allow write access**. Without that tick it can read the snapshot and never
make one.

The private half goes to the host in step 4. Hosting panels are unreliable
about multi-line values, so hand it over as one line:

```bash
base64 -w0 < ~/.patchvane-deploy/data_key
```

`PATCHVANE_DATA_KEY` takes either that or the key itself.

**Or a token instead.** If you would rather, a fine-grained personal access
token scoped to only `patchvane-data` with **Contents: read and write** works
the same way, as `PATCHVANE_DATA_TOKEN`. It expires, though, and on that day
the snapshots stop — Patchvane says so in its log and keeps serving rather
than overwriting what is saved, but it stops saving.

## 3. The service

Sign in to [render.com](https://render.com) with GitHub. Then **New**,
**Blueprint**, and point it at your `patchvane` repository.

`render.yaml` in this repository describes the whole service — Docker build,
free plan, deploy on push — so the only thing Render asks you for is the
three values it cannot guess. If you would rather fill the form in by hand,
**New**, **Web Service**, pick the repository, choose **Docker** and the
**Free** plan, and leave the health check path empty: cloud mode answers a
plain HTTP request with a redirect to HTTPS, and Render's checker does not
send the header that would tell it otherwise, so it would fail a service that
is perfectly healthy.

## 4. What it needs to know

Render prompts for these from `render.yaml`. Mark the first and last secret.

| Variable | Value |
|---|---|
| `PATCHVANE_SECRET` | 48 random characters, see below |
| `PATCHVANE_DATA_REPO` | `yourname/patchvane-data` |
| `PATCHVANE_DATA_KEY` | the deploy key from step 2, or `PATCHVANE_DATA_TOKEN` if you made a token |

The secret signs session cookies and seals the vaults, so make it properly
random and keep it:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

`PATCHVANE_MODE` is already `cloud` in the Dockerfile, and cloud mode turns
on the two things a proxied deployment needs: trusting the forwarded protocol
header and refusing to send a session cookie over plain HTTP.

Two more are worth knowing about. `PATCHVANE_SNAPSHOT_MINUTES` is how often
the data is saved, ten by default; a snapshot is also taken when the
container is told to stop, so the usual redeploy loses nothing at all.
`PATCHVANE_ALLOW_EMAILS` keeps it to yourself if you would rather it were
not public.

## 5. Watch it come up

Render builds the image, runs it, and gives you a URL ending in
`.onrender.com` with a certificate already on it. In the logs you want:

```
[entrypoint] the data remote is empty; this run will make the first snapshot
cloud Patchvane listening on 0.0.0.0:8000
```

and on the next deploy, once somebody has signed in:

```
[entrypoint] restored 14 files from yourname/patchvane-data
[entrypoint] kept the previous snapshot as the 'previous' branch
```

That second line is the safety net. The snapshot is a force push, so the
entrypoint will only make one if it has established that it holds what the
remote holds — if the token has expired or the repository cannot be reached
it serves without saving and says so, rather than replacing somebody's vault
with an empty directory. The state it booted with stays on a `previous`
branch, so there is one step back if a run loses something.

## 6. Keep it awake

Copy the `.onrender.com` address. In your `patchvane` repository on GitHub,
**Settings**, **Secrets and variables**, **Actions**, the **Variables** tab,
**New repository variable**: name `PATCHVANE_URL`, value the address with no
trailing slash.

That is what the `keep awake` workflow looks for. Until it exists the
workflow runs and says there is nothing to keep awake; once it does, Render
stops putting the service to sleep. Custom domains work on the free plan too,
under the service's **Settings**.

## What this route costs you

A restart between snapshots loses up to `PATCHVANE_SNAPSHOT_MINUTES` of work,
a few patches that will be collected again. The fetch cache is not
snapshotted, because it is tens of megabytes and rebuilds itself, so the
first collection after a deploy is slower than the ones after it.

Two of Render's rules are worth reading properly rather than discovering.
They may suspend a free service that sends an uncommonly high volume of
traffic out to the internet, and collecting from lore is exactly that kind of
traffic, in moderation. And they say plainly that free instances are not for
production. Both are their call to make later, which is the real difference
between this route and having a machine of your own.

---

# Route B: Oracle Cloud, with a card

A whole machine, a real disk, and no snapshot machinery. Oracle verifies a
card and does not charge an Always Free account.

## What you need first

An Oracle Cloud account and a domain name pointed at the machine. A free
`duckdns.org` subdomain works as well as one you paid for; Let's Encrypt does
not mind either way.

## 1. The machine

In the Oracle console, **Compute** then **Instances** then **Create
instance**.

- **Image**: Canonical Ubuntu, 24.04.
- **Shape**: `VM.Standard.A1.Flex`, 1 OCPU and 6 GB of memory. The Always
  Free allowance is 2 OCPUs and 12 GB, so this is half of it and leaves room
  for a second machine later. If the console says Arm capacity is out in your
  region, `VM.Standard.E2.1.Micro` is always free too and always available;
  Patchvane fits in it.
- **SSH key**: paste your public key. This is the key CI will use as well, so
  use one you can put in a GitHub secret. If you need a new one:
  `ssh-keygen -t ed25519 -f ~/.ssh/patchvane-deploy`.

Note the public IP when it finishes.

## 2. Let the internet reach it

Two firewalls stand between a request and the machine, and both have to be
opened. Missing the second is the usual reason a correct setup times out.

**The security list.** In the console, open the instance, follow the subnet
link, then the default security list, then **Add ingress rules**. Source
`0.0.0.0/0`, IP protocol TCP, destination port `80,443`.

**The machine's own rules.** Oracle's Ubuntu images arrive with an `INPUT`
chain that drops everything except SSH. `setup.sh` opens 80 and 443 there and
saves them, so there is nothing to do by hand, but that is why it needs to
run as root.

## 3. Point the domain at it

An `A` record for your domain to the public IP. On DuckDNS that is one field
on their front page. Give it a minute, then `dig +short your.domain` should
answer with the IP. Do this before the next step: Caddy asks Let's Encrypt
for a certificate as soon as it starts, and the request fails if the name
does not resolve yet.

## 4. Set it up

```bash
ssh ubuntu@<the public IP>
git clone https://github.com/SelamHemanth/patchvane.git
sudo ./patchvane/deploy/setup.sh your.domain
```

It installs Python and Caddy, makes a `patchvane` system user that owns
nothing but its own data directory, generates the secret that signs session
cookies, writes the systemd unit and the Caddy configuration, opens the
firewall and starts both.

Watch the certificate arrive with `journalctl -u caddy -f`, then open
`https://your.domain/`.

## 5. Make a push a deploy

In the repository on GitHub, **Settings**, **Secrets and variables**,
**Actions**, and add four:

| Secret | What goes in it |
|---|---|
| `DEPLOY_HOST` | the public IP, or the domain |
| `DEPLOY_USER` | `ubuntu` |
| `DEPLOY_KEY` | the **private** key whose public half you gave the instance |
| `DEPLOY_HOST_KEY` | the output of `ssh-keyscan <the public IP>` |

The last one is optional and worth setting. Without it the workflow accepts
whatever host key it is offered on the day, which is fine until somebody is
in the way of the connection.

Until `DEPLOY_HOST` exists the workflow still runs, still compiles the code
and still checks the configuration; it just says there is nowhere to deploy
and stops, rather than failing.

Once it is set, every push to `main` compiles the code and runs
`serve.py --check` on GitHub's machine first. Only then does it reach yours,
where it pulls, compiles again, and restarts the service. The unit runs
`--check` once more as it comes up, this time with the deployment's own
environment, which is the only place that can see the real configuration.
Then the script waits for `/healthz` to answer 200. If it does not, the
machine is put back on the previous commit and restarted, and the deploy
fails loudly rather than leaving the site down.

## Running it

```bash
systemctl status patchvane      # is it up
journalctl -u patchvane -f      # what it is doing
journalctl -u caddy -f          # certificates and requests
/opt/patchvane/deploy/update.sh # deploy by hand, as ubuntu and not as root
```

Code is in `/opt/patchvane` and is replaced by every deploy. Everything worth
keeping is in `/var/lib/patchvane` and is never touched by one: the people,
their vaults, and the shared cache of fetched pages. Back that directory up
if you would mind losing it.

## The one thing to watch

Oracle may reclaim an Always Free machine that has been idle for seven days,
where idle means CPU, network **and** memory all under 20% — all three
together, not any one of them. A Patchvane collecting for people on a timer
does not look idle. One that nobody signs into for a week might, so if you
are keeping it for yourself and rarely open it, that is the failure mode to
know about.

---

# Whichever route you took

## Who can sign in

Anybody, by design. Somebody signs in with their own Gmail address and an
app password, that password goes to Gmail to be checked and is not kept, and
they get a dashboard of the patches **they** posted. Nobody sees anybody
else's.

Collection stays polite as the number of people grows: the timer collects for
one person per round, only for people whose session is still live, and the
round comes round often enough that each of them is refreshed about every
interval. Five sign-in attempts per address per five minutes, 120 API calls a
minute.

To keep it to yourself instead, set `PATCHVANE_ALLOW_EMAILS` to your own
address — in the service's environment on Render, or in
`/etc/patchvane/patchvane.env` on Oracle — and restart.

## What you are holding for other people

Running this for strangers makes you the keeper of their things, which is
worth being deliberate about.

Their **app password** is never written down: it goes to Gmail over IMAP to
be checked and is dropped with the request. Their **API keys**, if they set
any up for the assistant, sit in `people/<address>/vault.json`, mode 0600,
sealed with a key derived from the server's secret, so one person signing in
cannot read another's. Their **patch data** is public to begin with, gathered
from lore.

On route A those vaults are also pushed to your private data repository, so
that repository is as sensitive as the server is. Keep it private, and if the
server's `PATCHVANE_SECRET` ever changes, the sealed keys in it can no longer
be opened and everybody sets theirs up again.

`SECURITY.md` describes how that sealing is built, including the parts worth
a second opinion.

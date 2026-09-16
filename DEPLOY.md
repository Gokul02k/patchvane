# Putting Patchvane on the internet

This puts Patchvane on a machine that is not yours to keep running, on a
domain with a certificate, open to anybody who wants a dashboard of their own
patches. After the first hour it maintains itself: a push to `main` is a
deploy, and nothing on your own machine needs to be switched on.

There are two ways to do it and both are free. They differ in one thing that
turns out to matter more than anything technical: whether you have to hand a
card over to get started.

| | Northflank | Oracle Cloud |
|---|---|---|
| Card to sign up | no | yes, verified and not charged |
| Sleeps when quiet | no | no |
| Disk that survives a restart | no, see below | yes, a real one |
| What you get | a container and an HTTPS URL | a machine you are root on |

Most of the usual names are out before this choice is made. Render sleeps a
free service after fifteen minutes of quiet, which stops the collection timer
that is the point of the thing. Fly and Koyeb want a card anyway. Vercel,
Netlify and Cloudflare Pages host frontends; Vercel's own documentation says
that if you need a server up all day you want a VM, and on their free plan a
scheduled job may run once a day when Patchvane wants to collect every few
minutes.

Northflank's free tier has no persistent disk, which for this application is
not a detail: the patches can be collected again from lore, slowly, but the
notes people wrote and the keys in their vaults cannot. So on that route the
data directory is a git repository that is restored when the container starts
and snapshotted while it runs. That is what `deploy/cloud-entrypoint.sh` is
for, and route A sets it up.

If you have a Visa or Mastercard and do not mind Oracle verifying it, route B
is the simpler system and the one with a real disk. Oracle does not charge an
Always Free account, but it rejects RuPay, prepaid and virtual cards, which
is a wall rather than a cost.

---

# Route A: Northflank, with no card

You need a GitHub account and nothing else.

## 1. Somewhere to keep the data

Make a **private** repository for it, separate from the code. On GitHub,
**New repository**, name it `patchvane-data`, set it to **Private**, and
create it empty — no README, no licence. The first snapshot will fill it.

Private matters. Vaults are sealed before they are written, but publishing
other people's sealed keys is not a thing to do on purpose.

## 2. A token that can write to it, and nothing else

**Settings**, **Developer settings**, **Personal access tokens**,
**Fine-grained tokens**, **Generate new token**.

- **Repository access**: only select repositories, and select only
  `patchvane-data`.
- **Permissions**: **Contents**, read and write. Nothing else.
- **Expiration**: if you set one, the snapshots stop on that day. Patchvane
  will say so in its log and will keep serving rather than overwrite what is
  already saved, but it stops saving. Put the date in your calendar.

Copy the token now; GitHub shows it once.

## 3. The service

Sign in to [northflank.com](https://northflank.com) with GitHub and make a
project. Then **Create new**, **Service**, **Combined service**.

- **Repository**: your `patchvane` repository, branch `main`.
- **Build**: Dockerfile, path `/Dockerfile`. The one in this repository.
- **Build on push**: on. This is what makes a push a deploy.
- **Resources**: the free plan. The sandbox allows two always-on services.
- **Networking**: port `8000`, protocol HTTP, and make it public.

## 4. What it needs to know

Under the service's **Environment**, add these. Mark the last two as secrets.

| Variable | Value |
|---|---|
| `PATCHVANE_SECRET` | 48 random characters, see below |
| `PATCHVANE_DATA_REPO` | `yourname/patchvane-data` |
| `PATCHVANE_DATA_TOKEN` | the fine-grained token from step 2 |

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

Northflank builds the image, runs it, and gives you a URL ending in
`.code.run` with a certificate already on it. In the logs you want:

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

## 6. Your own domain, if you want one

Free accounts get the `.code.run` URL and that is a real HTTPS address you
can give people. To use your own name instead, add it under the service's
**Domains**, then add the CNAME record Northflank shows you at your
registrar.

## What this route costs you

A restart between snapshots loses up to `PATCHVANE_SNAPSHOT_MINUTES` of work,
which is a few patches that will be collected again. The fetch cache is not
snapshotted, because it is tens of megabytes and rebuilds itself, so the
first collection after a deploy is slower than the ones after it. Northflank
says the sandbox tier is for testing rather than production, and they are the
ones who decide what that means later.

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
address — in the service's environment on Northflank, or in
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

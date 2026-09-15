# Putting Patchvane on the internet

This puts Patchvane on a machine that is not yours to keep running, on a
domain with a certificate, open to anybody who wants a dashboard of their own
patches. After the first hour it maintains itself: a push to `main` is a
deploy, and nothing on your own machine needs to be switched on.

The whole of it is free and stays free. Oracle Cloud's Always Free tier is
the only one of the usual names that will keep a process running, keep a disk
under it, and not expire: Render sleeps a free service after fifteen minutes
of quiet, Fly has no free tier for new accounts, and the serverless hosts
cannot run something that collects on a timer at all.

## What you need first

An Oracle Cloud account, which wants a card to prove you are a person and
does not charge it, and a domain name pointed at the machine. A free
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

To keep it to yourself instead, uncomment `PATCHVANE_ALLOW_EMAILS` in
`/etc/patchvane/patchvane.env` and restart.

## What you are holding for other people

Running this for strangers makes you the keeper of their things, which is
worth being deliberate about.

Their **app password** is never written down: it goes to Gmail over IMAP to
be checked and is dropped with the request. Their **API keys**, if they set
any up for the assistant, sit in `people/<address>/vault.json`, mode 0600,
sealed with a key derived from the server's secret, so one person signing in
cannot read another's. Their **patch data** is public to begin with, gathered
from lore.

`SECURITY.md` describes how that sealing is built, including the parts worth
a second opinion.

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

#!/usr/bin/env bash
#
# Bring the running deployment up to what is on main.  CI pipes this in over
# SSH after every push; you can run it by hand and it does the same thing.
#
# A bad commit should not take the site down.  The old revision is kept, and
# if the new one will not serve, the machine goes back to it before this
# script admits failure.

set -euo pipefail

CODE=/opt/patchvane
HEALTH=http://127.0.0.1:8787/healthz

# Cloud mode redirects plain HTTP, so asking for /healthz without saying the
# request arrived over TLS gets a 308 and no answer at all.  curl counts a
# redirect as success, which would make this check pass whatever state the
# app was in.  Send the header Caddy sends, and insist on a 200.
health() {
	curl -sS --max-time 3 -o /dev/null -w '%{http_code}' \
	     -H 'X-Forwarded-Proto: https' "$HEALTH" 2>/dev/null
}

serving() {
	for _ in $(seq 1 20); do
		if [ "$(health)" = "200" ]; then
			return 0
		fi
		sleep 1
	done
	return 1
}

was=$(git -C "$CODE" rev-parse HEAD)

git -C "$CODE" fetch --quiet origin main
git -C "$CODE" reset --hard --quiet origin/main
now=$(git -C "$CODE" rev-parse HEAD)

if [ "$was" = "$now" ]; then
	echo "already at $(git -C "$CODE" rev-parse --short HEAD)"
else
	git -C "$CODE" --no-pager log --oneline "$was..$now" | sed 's/^/  /'
fi

# Cheap check first: a file that will not compile need not reach systemd.
# The real check is in the unit's ExecStartPre, which runs with the
# deployment's own environment; this one cannot, and is not meant to.
if ! python3 -m compileall -q "$CODE"/*.py; then
	echo "the new code does not compile; going back to ${was:0:9}" >&2
	git -C "$CODE" reset --hard --quiet "$was"
	exit 1
fi

sudo systemctl restart patchvane

if serving; then
	echo "up at $(git -C "$CODE" rev-parse --short HEAD)"
	curl -sS --max-time 3 -H 'X-Forwarded-Proto: https' "$HEALTH"; echo
	exit 0
fi

echo "it did not answer $HEALTH within 20s" >&2
sudo systemctl status patchvane --no-pager --lines=20 || true

if [ "$was" = "$now" ]; then
	echo "nothing to go back to: this is the revision that was already here." >&2
	exit 1
fi

echo "rolling back to ${was:0:9}" >&2
git -C "$CODE" reset --hard --quiet "$was"
sudo systemctl restart patchvane

if serving; then
	echo "back on ${was:0:9} and serving; the new commit was not deployed." >&2
else
	echo "the rollback is not serving either; this needs a person." >&2
fi
exit 1

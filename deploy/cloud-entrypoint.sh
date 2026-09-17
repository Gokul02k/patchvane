#!/usr/bin/env bash
#
# Start Patchvane on a host that gives you a container and takes the disk
# away again.
#
# Render's free plan, and every other free tier that does not ask for a card,
# has no persistent disk: the filesystem is new on every deploy and restart.
# Patchvane can rebuild what it collected from lore, slowly, but it cannot
# rebuild the two things that are actually somebody's: the notes they wrote
# and the API keys in their vault.  Losing those on every push is not a
# service anybody should sign in to.
#
# So the data directory is a git repository.  It is restored from a private
# repository on the way up, snapshotted while running, and snapshotted once
# more on the way down.  The snapshot is a single amended commit rather than
# a growing history, because this is a backup and not a diary, and an
# unbounded one would eventually be the largest thing about the deployment.
#
# Set PATCHVANE_DATA_REPO and PATCHVANE_DATA_TOKEN to turn it on.  Without
# them it still runs, and still serves, and simply forgets on restart.

set -uo pipefail

APP="${PATCHVANE_APP_DIR:-/app}"
DATA="${PATCHVANE_DATA_DIR:-/data}"
PORT="${PORT:-8000}"
EVERY="${PATCHVANE_SNAPSHOT_MINUTES:-10}"
REPO="${PATCHVANE_DATA_REPO:-}"
TOKEN="${PATCHVANE_DATA_TOKEN:-}"
KEY="${PATCHVANE_DATA_KEY:-}"
# Anything git can push to. Set it and the two above are not needed, which is
# what makes this testable without a GitHub repository to hand.
REMOTE="${PATCHVANE_DATA_REMOTE:-}"

say() { echo "[entrypoint] $*"; }

# The token must never reach the log, so it lives in the remote URL and the
# remote URL is never printed.
remote_url() {
	if [ -n "$REMOTE" ]; then
		printf '%s' "$REMOTE"
	elif [ -n "$KEY" ]; then
		printf 'git@github.com:%s.git' "$REPO"
	else
		printf 'https://x-access-token:%s@github.com/%s.git' "$TOKEN" "$REPO"
	fi
}

keeping() {
	[ -n "$REMOTE" ] || { [ -n "$REPO" ] && { [ -n "$TOKEN" ] || [ -n "$KEY" ]; }; }
}

# A deploy key is the better of the two ways in: it reaches exactly one
# repository, it cannot be used to read anything else in the account, and
# unlike a token it does not quietly expire on a date nobody wrote down.
# Hosting panels are unreliable about newlines in a multi-line value, so a
# base64 blob on one line is accepted as well as the key itself.
use_key() {
	[ -n "$KEY" ] || return 0
	mkdir -p "$HOME/.ssh"
	chmod 700 "$HOME/.ssh"

	if printf '%s' "$KEY" | grep -q 'BEGIN .*PRIVATE KEY'; then
		printf '%s\n' "$KEY" > "$HOME/.ssh/data_key"
	else
		printf '%s' "$KEY" | tr -d ' \n' | base64 -d > "$HOME/.ssh/data_key" 2>/dev/null
	fi
	chmod 600 "$HOME/.ssh/data_key"

	if ! grep -q 'BEGIN .*PRIVATE KEY' "$HOME/.ssh/data_key" 2>/dev/null; then
		say "PATCHVANE_DATA_KEY is not a private key. Nothing will be saved."
		KEY=""
		return 1
	fi

	# github.com's own host key, so the first connection is not trusted
	# blindly.  If GitHub ever rotates this, the snapshots stop rather than
	# talk to whoever answered.
	printf '%s\n' 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' \
		> "$HOME/.ssh/known_hosts"
	chmod 600 "$HOME/.ssh/known_hosts"

	export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/data_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$HOME/.ssh/known_hosts"
}

# A snapshot is a force push, so it can destroy as easily as it can save.  It
# is only allowed once this run has established that it holds what the remote
# holds: either it restored the snapshot successfully, or there was provably
# nothing there to restore.  If the remote has a snapshot this run could not
# fetch -- an expired token, a network fault, a wrong branch -- then pushing
# would overwrite somebody's vault with an empty directory, so it does not.
may_push=0

restore() {
	mkdir -p "$DATA"
	git config --global user.email "patchvane@users.noreply.github.com"
	git config --global user.name "Patchvane"
	git config --global init.defaultBranch main
	git config --global --add safe.directory "$DATA"

	# Init rather than clone: the data directory may already have something
	# in it, and git will not clone into that.  Fetching one named branch
	# also avoids trusting the remote's HEAD, which on a repository that has
	# never been pushed to points at a branch that does not exist -- a clone
	# of that succeeds and checks out nothing at all.
	[ -d "$DATA/.git" ] || git -C "$DATA" init --quiet
	git -C "$DATA" remote remove origin 2>/dev/null
	git -C "$DATA" remote add origin "$(remote_url)"

	local refs
	if ! refs=$(git -C "$DATA" ls-remote --heads origin 2>/dev/null); then
		say "cannot reach ${REPO:-the data remote}: check the repository name"
		say "and the token. running without saving, so the snapshot already"
		say "there is left alone rather than overwritten."
		return
	fi

	if [ -z "$refs" ]; then
		say "${REPO:-the data remote} is empty; this run will make the first snapshot"
		may_push=1
		return
	fi

	if git -C "$DATA" fetch --quiet --depth 1 origin main 2>/dev/null; then
		# Untracked files, the cache among them, are left where they are.
		git -C "$DATA" reset --hard --quiet FETCH_HEAD
		may_push=1
		say "restored $(git -C "$DATA" ls-files | wc -l) files from ${REPO:-the data remote}"
		# Keep what we booted with under a second ref, so there is one step
		# back if this run goes on to lose something.
		git -C "$DATA" push --quiet --force origin \
			FETCH_HEAD:refs/heads/previous 2>/dev/null \
			&& say "kept the previous snapshot as the 'previous' branch"
	else
		say "${REPO:-the data remote} has branches but main could not be fetched."
		say "running without saving rather than overwriting what is there."
	fi
}

# The fetch cache is tens of megabytes and rebuilds itself from lore, so it is
# not worth carrying.  Everything else in here is somebody's, and is.  This
# runs after restore rather than inside it, because restore has three ways out
# and the snapshot is only safe once all of them have been through here.
ensure_ignores() {
	if [ ! -f "$DATA/.gitignore" ]; then
		printf '%s\n' 'cache/' '*.log' '.patchvane.pid' > "$DATA/.gitignore"
	fi
	# An earlier run may have committed the cache before this existed, and
	# ignoring a file that is already tracked does nothing.
	if [ -n "$(git -C "$DATA" ls-files cache 2>/dev/null)" ]; then
		git -C "$DATA" rm -r --cached --quiet cache 2>/dev/null
		say "stopped carrying the fetch cache in the snapshot"
	fi
}

snapshot() {
	keeping || return 0
	[ "$may_push" = 1 ] || return 0
	git -C "$DATA" add -A 2>/dev/null
	git -C "$DATA" diff --cached --quiet 2>/dev/null && return 0

	local when
	when=$(date -u '+%Y-%m-%d %H:%M:%SZ')
	if git -C "$DATA" rev-parse HEAD >/dev/null 2>&1; then
		git -C "$DATA" commit --amend --quiet -m "Patchvane data, $when"
	else
		git -C "$DATA" commit --quiet -m "Patchvane data, $when"
	fi

	if git -C "$DATA" push --quiet --force origin HEAD:main 2>/dev/null; then
		say "snapshot pushed, $when"
	else
		say "snapshot could not be pushed; it will be tried again"
	fi
}

if keeping; then
	use_key
	restore
	ensure_ignores
else
	say "PATCHVANE_DATA_REPO or PATCHVANE_DATA_TOKEN is unset:"
	say "nothing will survive a restart. docs/deploying.md says how to set them."
	mkdir -p "$DATA"
fi

python3 "$APP/src/serve.py" --host "${PATCHVANE_BIND:-0.0.0.0}" --port "$PORT" &
server=$!
napper=

# A shutdown has a grace period before the platform stops asking and starts
# killing, and the last snapshot has to fit inside it.  bash will not run a
# trap while a foreground child is running, so the wait between snapshots is
# a backgrounded sleep this can interrupt, rather than a plain one that would
# hold the signal for up to ten seconds.
nap() {
	sleep "$1" &
	napper=$!
	wait "$napper" 2>/dev/null
	napper=
}

leaving() {
	trap '' TERM INT
	[ -n "$napper" ] && kill "$napper" 2>/dev/null
	if [ "$may_push" = 1 ]; then
		say "stopping; taking a last snapshot"
	else
		say "stopping; this run was not saving, so nothing is written"
	fi
	snapshot
	kill -TERM "$server" 2>/dev/null
	wait "$server" 2>/dev/null
	say "stopped"
	exit 0
}
trap leaving TERM INT

# Snapshot on a timer, and notice if the server has gone, so the container
# exits and the platform restarts it rather than sitting here looking healthy
# and serving nothing.
while kill -0 "$server" 2>/dev/null; do
	nap "$((EVERY * 60))"
	kill -0 "$server" 2>/dev/null || break
	snapshot
done

say "the server exited"
snapshot
wait "$server"
exit $?

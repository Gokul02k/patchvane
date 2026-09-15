#!/usr/bin/env bash
#
# Set up Patchvane on a fresh Ubuntu machine, once.
#
#   sudo ./setup.sh patchvane.example.org
#
# Safe to run again: it generates the session secret only if there is not one
# already, and leaves /var/lib/patchvane alone whatever else it does.
#
# What it does not do, because it cannot from inside the machine: open 80 and
# 443 in the cloud provider's own firewall.  On Oracle that is the VCN
# security list, and it is the step everybody forgets.  DEPLOY.md says where.

set -euo pipefail

DOMAIN="${1:-}"
REPO="${2:-https://github.com/SelamHemanth/patchvane.git}"
ADMIN="${SUDO_USER:-ubuntu}"

CODE=/opt/patchvane
DATA=/var/lib/patchvane
CONF=/etc/patchvane

die() { echo "setup: $*" >&2; exit 1; }
say() { echo "==> $*"; }

[ "$(id -u)" = 0 ] || die "run this with sudo."
[ -n "$DOMAIN" ] || die "usage: sudo ./setup.sh <domain> [repo-url]"
id "$ADMIN" >/dev/null 2>&1 || die "no such user: $ADMIN (set SUDO_USER)"

say "packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 git curl debian-keyring debian-archive-keyring \
                      apt-transport-https ca-certificates

python3 - <<'PY' || die "Patchvane needs Python 3.10 or later."
import sys
sys.exit(0 if sys.version_info >= (3, 10) else 1)
PY

if ! command -v caddy >/dev/null; then
  say "caddy"
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
fi

say "user and directories"
id patchvane >/dev/null 2>&1 || \
  useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin patchvane
install -d -o "$ADMIN" -g patchvane -m 750 "$CODE"
install -d -o patchvane -g patchvane -m 750 "$DATA"
install -d -o root -g patchvane -m 750 "$CONF"

say "code"
if [ -d "$CODE/.git" ]; then
  sudo -u "$ADMIN" git -C "$CODE" fetch --quiet origin
  sudo -u "$ADMIN" git -C "$CODE" reset --hard --quiet origin/main
else
  sudo -u "$ADMIN" git clone --quiet "$REPO" "$CODE"
fi
chgrp -R patchvane "$CODE"
chmod -R g+rX "$CODE"

say "configuration"
if [ ! -f "$CONF/patchvane.env" ]; then
  secret=$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')
  cat > "$CONF/patchvane.env" <<EOF
# Read by systemd, not by a shell: no quotes, no expansion, one per line.

PATCHVANE_MODE=cloud
PATCHVANE_SECRET=$secret
PATCHVANE_DATA_DIR=$DATA

# Cloud mode already turns these on.  They are written out so that anybody
# reading this file can see what the deployment promises.
PATCHVANE_TRUST_PROXY=1
PATCHVANE_REQUIRE_HTTPS=1

# Sign-in is open: anybody who can log into their own Gmail gets a dashboard
# of their own patches, which is the point of putting it on the internet.
# To make it yours alone, put your address here and restart:
# PATCHVANE_ALLOW_EMAILS=you@gmail.com
EOF
  chown root:patchvane "$CONF/patchvane.env"
  chmod 640 "$CONF/patchvane.env"
  say "generated a session secret in $CONF/patchvane.env"
else
  say "keeping the existing $CONF/patchvane.env"
fi

echo "PATCHVANE_DOMAIN=$DOMAIN" > /etc/caddy/patchvane.env
chmod 644 /etc/caddy/patchvane.env
install -d -o caddy -g caddy -m 755 /var/log/caddy

say "services"
install -m 644 "$CODE/deploy/patchvane.service" /etc/systemd/system/
install -m 644 "$CODE/deploy/Caddyfile" /etc/caddy/Caddyfile
mkdir -p /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/domain.conf <<'EOF'
[Service]
EnvironmentFile=/etc/caddy/patchvane.env
EOF

# CI restarts the service after a pull, and nothing else.
cat > /etc/sudoers.d/patchvane <<EOF
$ADMIN ALL=(root) NOPASSWD: /usr/bin/systemctl restart patchvane, \
/usr/bin/systemctl status patchvane, /usr/bin/systemctl is-active patchvane
EOF
chmod 440 /etc/sudoers.d/patchvane
visudo -cf /etc/sudoers.d/patchvane >/dev/null || die "bad sudoers file"

say "firewall"
# Oracle's Ubuntu images arrive with an INPUT chain that drops everything but
# SSH, which is why a correct security list still gets you a timeout.
if command -v iptables >/dev/null; then
  for port in 80 443; do
    iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || \
      iptables -I INPUT 5 -p tcp --dport "$port" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null; then
    netfilter-persistent save >/dev/null
  else
    apt-get install -y -qq iptables-persistent >/dev/null 2>&1 || true
  fi
fi

systemctl daemon-reload
systemctl enable --now patchvane
systemctl restart caddy

sleep 3
if systemctl is-active --quiet patchvane; then
  say "patchvane is up"
else
  journalctl -u patchvane -n 30 --no-pager || true
  die "patchvane did not start; the log is above."
fi

cat <<EOF

Done here. Two things are still yours to do:

  1. In the Oracle console, add ingress rules to the subnet's security list
     for TCP 80 and 443 from 0.0.0.0/0. Until then this machine is not
     reachable and Caddy cannot be issued a certificate.

  2. Point $DOMAIN at this machine's public IP, then watch the certificate
     arrive:  journalctl -u caddy -f

Then open https://$DOMAIN/ and sign in.
EOF

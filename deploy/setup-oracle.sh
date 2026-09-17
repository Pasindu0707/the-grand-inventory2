#!/usr/bin/env bash
# Prepares a fresh Oracle Cloud A1 instance to run The Grand.
#
#   ssh ubuntu@<public-ip>
#   git clone https://github.com/Pasindu0707/the-grand-inventory2.git /opt/thegrand
#   sudo bash /opt/thegrand/deploy/setup-oracle.sh
#
# Run once, on a new server. It is safe to run again -- every step checks first.
#
# What it does NOT do: open the ports in Oracle's virtual network. That lives in
# the Oracle console and cannot be done from inside the machine. See step 2 of
# deploy/README.md. This is the single most common reason a correctly deployed
# Oracle instance appears dead from the internet: the host firewall below is
# open, the cloud firewall is not, and nothing in the logs mentions it.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
	echo "Run with sudo." >&2
	exit 1
fi

echo "==> Detecting distribution"
. /etc/os-release
echo "    $PRETTY_NAME  ($(uname -m))"

if [ "$(uname -m)" != "aarch64" ]; then
	echo "    NOTE: not aarch64. The free Oracle shape is Ampere A1 (arm64);"
	echo "          this looks like a different machine. Continuing anyway."
fi

# --- Docker -------------------------------------------------------------
if command -v docker >/dev/null 2>&1; then
	echo "==> Docker already installed: $(docker --version)"
else
	echo "==> Installing Docker"
	curl -fsSL https://get.docker.com | sh
	systemctl enable --now docker
fi

# So the login user can run docker without sudo. Takes effect at next login.
LOGIN_USER="${SUDO_USER:-ubuntu}"
if id -nG "$LOGIN_USER" | grep -qw docker; then
	echo "==> $LOGIN_USER already in the docker group"
else
	usermod -aG docker "$LOGIN_USER"
	echo "==> Added $LOGIN_USER to the docker group (log out and back in)"
fi

# --- Host firewall ------------------------------------------------------
# Oracle's stock images ship with a REJECT rule near the end of the INPUT
# chain. Appending ACCEPT rules after it does nothing -- they have to be
# inserted above it, which is why this uses -I with an explicit position
# rather than -A.
echo "==> Opening 80 and 443 on the host firewall"

if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
	firewall-cmd --permanent --add-service=http
	firewall-cmd --permanent --add-service=https
	firewall-cmd --reload
	echo "    firewalld updated"
else
	for PORT in 80 443; do
		if iptables -C INPUT -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null; then
			echo "    port $PORT already open"
		else
			iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$PORT" -j ACCEPT
			echo "    port $PORT opened"
		fi
	done

	if ! command -v netfilter-persistent >/dev/null 2>&1; then
		DEBIAN_FRONTEND=noninteractive apt-get update -qq
		DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent
	fi
	netfilter-persistent save
	echo "    rules saved -- they survive a reboot"
fi

# --- Swap ---------------------------------------------------------------
# The A1 shape ships without swap. 12 GB is plenty for this system, but a
# little swap turns an out-of-memory kill during an image build into a slow
# build instead.
if swapon --show | grep -q .; then
	echo "==> Swap already configured"
else
	echo "==> Adding 2 GB swap"
	fallocate -l 2G /swapfile
	chmod 600 /swapfile
	mkswap /swapfile >/dev/null
	swapon /swapfile
	grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- Application directory ---------------------------------------------
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "==> Application directory: $APP_DIR"

mkdir -p "$APP_DIR/backups"
chmod +x "$APP_DIR/deploy/backup.sh" 2>/dev/null || true

if [ ! -f "$APP_DIR/deploy/.env" ]; then
	cp "$APP_DIR/deploy/.env.example" "$APP_DIR/deploy/.env"
	chmod 600 "$APP_DIR/deploy/.env"
	echo ""
	echo "    Created deploy/.env from the example."
	echo "    Fill it in before starting anything:"
	echo ""
	echo "      openssl rand -base64 24    # POSTGRES_PASSWORD"
	echo "      openssl rand -base64 48    # JWT_SECRET"
	echo ""
else
	echo "==> deploy/.env already exists, left untouched"
fi

cat <<'NEXT'

==> Host is ready.

Still to do, in this order:

  1. Open 80 and 443 in the Oracle console as well
     Networking > Virtual Cloud Networks > your VCN > Security Lists
     > Default Security List > Add Ingress Rules
       Source 0.0.0.0/0, TCP, destination port 80
       Source 0.0.0.0/0, TCP, destination port 443
     The host firewall is now open. Without this, the internet still cannot
     reach it, and nothing logs a reason.

  2. Fill in deploy/.env  (passwords, then SITE_ADDRESS)

  3. Start it
       cd <app dir>
       docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build

  4. Create the first administrator
       docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env \
         run --rm api node scripts/add-user.mjs

  5. Nightly backups
       sudo crontab -e
       15 2 * * * <app dir>/deploy/backup.sh >> /var/log/thegrand-backup.log 2>&1

NEXT

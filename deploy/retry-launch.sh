#!/usr/bin/env bash
# Keep asking Oracle for a free Ampere instance until capacity appears.
#
# The free A1 shape is heavily oversubscribed: "Out of host capacity" is not a
# mistake in your request, it is Oracle having nothing free to give you at that
# second. Capacity appears and disappears as other free-tier users create and
# delete instances, so the only reliable way in is to keep asking.
#
#   bash deploy/retry-launch.sh --discover    print the OCIDs you need
#   bash deploy/retry-launch.sh               run until it succeeds
#
# Leave it running overnight. It stops the moment an instance is created, and
# prints the public IP.
#
# It deliberately gives up on any error that is NOT a capacity error. A wrong
# subnet OCID would otherwise retry forever without ever being able to succeed.

set -uo pipefail

# ---------------------------------------------------------------------------
# Fill these in. Run with --discover to have them printed for you.
# ---------------------------------------------------------------------------
COMPARTMENT_OCID="${COMPARTMENT_OCID:-}"
SUBNET_OCID="${SUBNET_OCID:-}"
AVAILABILITY_DOMAIN="${AVAILABILITY_DOMAIN:-}"

DISPLAY_NAME="${DISPLAY_NAME:-thegrand}"
OCPUS="${OCPUS:-2}"
MEMORY_GB="${MEMORY_GB:-12}"
BOOT_GB="${BOOT_GB:-50}"
SSH_PUB_KEY="${SSH_PUB_KEY:-$HOME/.ssh/oracle_grand.pub}"

# Left blank, the newest Ubuntu 22.04 arm64 image is looked up for you.
IMAGE_OCID="${IMAGE_OCID:-}"

# Seconds between attempts. Randomised inside this range so the requests do not
# arrive on a perfectly predictable cadence.
MIN_WAIT="${MIN_WAIT:-60}"
MAX_WAIT="${MAX_WAIT:-150}"

LOG="${LOG:-$(dirname "${BASH_SOURCE[0]}")/retry-launch.log}"

# ---------------------------------------------------------------------------

say() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }

need_oci() {
	if ! command -v oci >/dev/null 2>&1; then
		echo "The 'oci' command is not on your PATH." >&2
		echo "Install it with:  python -m pip install oci-cli" >&2
		echo "Then configure it with:  oci setup config" >&2
		exit 1
	fi
}

discover() {
	need_oci
	echo
	echo "=== Availability domain ==="
	oci iam availability-domain list --query 'data[*].name' --raw-output 2>/dev/null \
		|| echo "  (failed - is 'oci setup config' done?)"
	echo
	echo "=== Compartments (use the root one unless you made others) ==="
	oci iam compartment list --include-root \
		--query 'data[*].{name:name,ocid:id}' --output table 2>/dev/null
	echo
	echo "=== Subnets - you want the PUBLIC one ==="
	oci network subnet list -c "${COMPARTMENT_OCID:-$(oci iam compartment list --include-root --query 'data[0].id' --raw-output 2>/dev/null)}" \
		--query 'data[*].{name:"display-name",public:"prohibit-public-ip-on-vnic",ocid:id}' \
		--output table 2>/dev/null
	echo
	echo "A subnet with public = False is a public subnet. That is the one to use."
	echo
	exit 0
}

[ "${1:-}" = "--discover" ] && discover

need_oci

for v in COMPARTMENT_OCID SUBNET_OCID AVAILABILITY_DOMAIN; do
	if [ -z "${!v}" ]; then
		echo "$v is not set. Edit this file, or run: bash ${BASH_SOURCE[0]} --discover" >&2
		exit 1
	fi
done

if [ ! -f "$SSH_PUB_KEY" ]; then
	echo "No public key at $SSH_PUB_KEY" >&2
	exit 1
fi

if [ -z "$IMAGE_OCID" ]; then
	say "Looking up the newest Ubuntu 22.04 image for VM.Standard.A1.Flex ..."
	IMAGE_OCID=$(oci compute image list \
		-c "$COMPARTMENT_OCID" \
		--operating-system "Canonical Ubuntu" \
		--operating-system-version "22.04" \
		--shape "VM.Standard.A1.Flex" \
		--sort-by TIMECREATED --sort-order DESC \
		--query 'data[0].id' --raw-output 2>/dev/null)
	if [ -z "$IMAGE_OCID" ] || [ "$IMAGE_OCID" = "null" ]; then
		echo "Could not find an Ubuntu 22.04 arm64 image. Set IMAGE_OCID by hand." >&2
		exit 1
	fi
	say "Image: $IMAGE_OCID"
fi

SSH_KEY_CONTENT=$(cat "$SSH_PUB_KEY")

say "Starting. ${OCPUS} OCPU / ${MEMORY_GB} GB, boot ${BOOT_GB} GB, AD ${AVAILABILITY_DOMAIN}."
say "Retrying every ${MIN_WAIT}-${MAX_WAIT}s until capacity appears. Ctrl-C to stop."

ATTEMPT=0
while true; do
	ATTEMPT=$((ATTEMPT + 1))

	OUT=$(oci compute instance launch \
		-c "$COMPARTMENT_OCID" \
		--availability-domain "$AVAILABILITY_DOMAIN" \
		--display-name "$DISPLAY_NAME" \
		--shape "VM.Standard.A1.Flex" \
		--shape-config "{\"ocpus\":${OCPUS},\"memoryInGBs\":${MEMORY_GB}}" \
		--image-id "$IMAGE_OCID" \
		--subnet-id "$SUBNET_OCID" \
		--assign-public-ip true \
		--boot-volume-size-in-gbs "$BOOT_GB" \
		--metadata "{\"ssh_authorized_keys\":\"${SSH_KEY_CONTENT}\"}" \
		--wait-for-state RUNNING \
		2>&1)
	RC=$?

	if [ $RC -eq 0 ]; then
		say "SUCCESS on attempt ${ATTEMPT}."
		INSTANCE_ID=$(echo "$OUT" | python -c "import sys,json;print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)
		if [ -n "${INSTANCE_ID:-}" ]; then
			say "Instance: $INSTANCE_ID"
			VNIC=$(oci compute instance list-vnics --instance-id "$INSTANCE_ID" \
				--query 'data[0]."public-ip"' --raw-output 2>/dev/null)
			say "PUBLIC IP: ${VNIC:-<none - check the console>}"
			echo
			echo "Next:  ssh -i ~/.ssh/oracle_grand ubuntu@${VNIC}"
			echo "Then follow deploy/README.md from step 3."
		else
			say "Created, but could not parse the response. Check the console."
		fi
		exit 0
	fi

	# Capacity is the one error worth waiting out. Anything else is a real
	# problem with the request and will never succeed, however long we wait.
	if echo "$OUT" | grep -qiE 'out of host capacity|outofhostcapacity|out of capacity'; then
		WAIT=$((RANDOM % (MAX_WAIT - MIN_WAIT + 1) + MIN_WAIT))
		say "attempt ${ATTEMPT}: no capacity. Waiting ${WAIT}s."
		sleep "$WAIT"
		continue
	fi

	if echo "$OUT" | grep -qiE 'limit.*exceeded|quota'; then
		say "Stopping: you are at a service limit, not a capacity shortage."
		echo "$OUT" | tail -5
		exit 1
	fi

	say "Stopping: this is not a capacity error."
	echo "$OUT" | tail -20
	exit 1
done

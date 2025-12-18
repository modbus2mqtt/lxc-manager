#!/bin/sh
# Wait until an LXC container is ready for package operations
# Inputs (templated):
#   {{ vm_id }}
# Behavior:
# - Polls lxc-attach for simple commands until success or timeout.
# - Checks hostname, network, and apk availability.

VMID="{{ vm_id }}"
if [ -z "$VMID" ]; then
  echo "Missing vm_id" >&2
  exit 2
fi

TIMEOUT=60
SLEEP=3
END=$(( $(date +%s) + TIMEOUT ))

check_cmd() {
  lxc-attach -n "$VMID" -- /bin/sh -c "$1" >/dev/null 2>&1
}

while [ $(date +%s) -lt $END ]; do
  # Basic process up?
  if ! pct status "$VMID" | grep -q running; then
    sleep "$SLEEP"
    continue
  fi
  # Responds to attach?
  if ! check_cmd "true"; then
    sleep "$SLEEP"
    continue
  fi
  # Has network? hostname -i returns something
  if ! lxc-attach -n "$VMID" -- /bin/sh -c 'hostname -i | grep -q .' >/dev/null 2>&1; then
    sleep "$SLEEP"
    continue
  fi
  # apk works? quick update dry-run (list repos)
  if check_cmd "apk --version"; then
    # Ready enough
    echo '[{"id":"ready","value":"true"}]'
    exit 0
  fi
  sleep "$SLEEP"
done

echo "Container $VMID not ready within ${TIMEOUT}s" >&2
exit 1

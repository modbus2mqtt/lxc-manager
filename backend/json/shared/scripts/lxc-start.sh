#!/bin/sh
# Start LXC container on Proxmox host
# Inputs (templated):
#   {{ vm_id }}

VMID="{{ vm_id }}"
if [ -z "$VMID" ]; then
  echo "Missing vm_id" >&2
  exit 2
fi

# Start container; send output to stderr as requested
pct start "$VMID" 1>&2 || {
  echo "Failed to start container $VMID" >&2
  exit 1
}

# Emit a simple JSON output for consistency
echo '[{"id":"started","value":"true"}]'

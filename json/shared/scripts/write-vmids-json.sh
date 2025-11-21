#!/bin/sh
# Writes all LXC and QEMU VM IDs as a JSON array to local/json/installed/vmids.json

# LXC container IDs
lxc_ids=$(pct list | awk 'NR>1 {print $1}')
# QEMU VM IDs
qemu_ids=$(qm list | awk 'NR>1 {print $1}')

# Combine all IDs and output as JSON array
all_ids=$(printf "%s\n%s" "$lxc_ids" "$qemu_ids" | grep -E '^[0-9]+$' | sort -n | uniq | paste -sd, -)

# If no IDs found, write empty array

# Always output JSON in a single line
if [ -z "$all_ids" ]; then
  printf '{"name": "used_vm_ids", "value": []}'
else
  printf '{"name": "used_vm_ids", "value": "[%s]"}' "$all_ids"
fi

echo "VM IDs written to stdout (outputs)" >&2
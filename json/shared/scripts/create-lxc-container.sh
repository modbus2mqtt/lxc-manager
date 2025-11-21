#!/bin/sh

# Auto-select the best storage for LXC rootfs (most free space, supports rootdir)
STORAGE=$(pvesm status | awk '$5 ~ /rootdir/ {print $1, $2}' | sort -k2 -nr | head -n1 | awk '{print $1}')

if [ -z "$STORAGE" ]; then
  echo "No suitable storage found for LXC rootfs!" >&2
  exit 1
fi

echo "Selected storage: $STORAGE" >&2

# Auto-select VMID if not set
if [ -z "{{ vm_id }}" ]; then
  # Find the next free VMID (highest existing + 1)
  VMID=$(pvesh get /cluster/nextid)
else
  VMID="{{ vm_id }}"
fi

# Create the container
pct create $VMID {{ template_path }} \
  --rootfs $STORAGE:{{ disk_size }} \
  --hostname {{ hostname }} \
  --memory {{ memory }} \
  --net0 name=eth0,bridge={{ bridge }},ip=dhcp \
  --ostype {{ ostype }} \
  --unprivileged 1 >&2

# Start the container
pct start $VMID >&2

echo "LXC container $VMID ({{ hostname }}) created." >&2
echo '{ "name": "vm_id", "value": "'$VMID'" }'
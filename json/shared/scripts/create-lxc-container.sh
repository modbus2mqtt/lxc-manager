#!/bin/sh


# Auto-select the best storage for LXC rootfs
# Prefer local-zfs if available, otherwise use storage with most free space (supports rootdir)

# First, check if local-zfs exists and supports rootdir
PREFERRED_STORAGE=""
if pvesm list "local-zfs" --content rootdir 2>/dev/null | grep -q .; then
  PREFERRED_STORAGE="local-zfs"
  echo "Using preferred storage: local-zfs" >&2
fi

# If local-zfs is not available, find storage with most free space
if [ -z "$PREFERRED_STORAGE" ]; then
  ROOTFS_RESULT=$(pvesm status | awk 'NR>1 {print $1, $6}' | while read stor free; do
    if pvesm list "$stor" --content rootdir 2>/dev/null | grep -q .; then
      if pvesm status --storage "$stor" | grep -q zfs; then
        echo "$free $stor size"
      else
        echo "$free $stor normal"
      fi
    fi
  done | sort -nr | head -n1)

  set -- $ROOTFS_RESULT
  PREFERRED_STORAGE=$2
fi

if [ -z "$PREFERRED_STORAGE" ]; then
  echo "No suitable storage found for LXC rootfs!" >&2
  exit 1
fi

stor="$PREFERRED_STORAGE"

ROOTFS="$stor:$(({{ disk_size }} * 1024))"
echo "Rootfs: $ROOTFS" >&2

# Auto-select VMID if not set
if [ -z "{{ vm_id }}" ]; then
  # Find the next free VMID (highest existing + 1)
  VMID=$(pvesh get /cluster/nextid)
else
  VMID="{{ vm_id }}"
fi

# Check that template_path is set
TEMPLATE_PATH="{{ template_path }}"
if [ -z "$TEMPLATE_PATH" ] || [ "$TEMPLATE_PATH" = "" ]; then
  echo "Error: template_path parameter is empty or not set!" >&2
  echo "Please ensure that 010-get-latest-os-template.json template is executed before 100-create-configure-lxc.json" >&2
  exit 1
fi

# Create the container
pct create "$VMID" "$TEMPLATE_PATH" \
  --rootfs "$ROOTFS" \
  --hostname "{{ hostname }}" \
  --memory "{{ memory }}" \
  --net0 name=eth0,bridge="{{ bridge }}",ip=dhcp \
  --ostype "{{ ostype }}" \
  --unprivileged 1 >&2
RC=$? 
if [ $RC -ne 0 ]; then
  echo "Failed to create LXC container!" >&2
  exit $RC
fi
echo "LXC container $VMID ({{ hostname }}) created." >&2

echo '{ "id": "vm_id", "value": "'$VMID'" }'

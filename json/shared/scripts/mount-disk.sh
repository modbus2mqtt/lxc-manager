#!/bin/sh
#
# mount-disk.sh: Mounts a block device (by UUID) on the Proxmox host.
#
# - Finds the device by UUID
# - Creates the mountpoint directory
# - Mounts the device to the given mountpoint on the host (without fstab, with nofail)
# - Sets permissions (uid/gid)
# - If storage_selection is a ZFS pool (starts with "zfs:"), exits successfully
#   (ZFS pools are handled by mount-zfs-pool.sh)
#
# This template only mounts the device on the host. To bind mount it into a container,
# use a separate template (e.g., 130-bind-host.json or similar).
#
# All output is sent to stderr. Script is idempotent and can be run multiple times safely.

STORAGE_SELECTION="{{ storage_selection}}"
UID_VALUE="{{ uid}}"
GID_VALUE="{{ gid}}"

# Check that required parameters are not empty
if [ -z "$STORAGE_SELECTION" ]; then
  echo "Error: Required parameter (storage_selection) must be set and not empty!" >&2
  exit 1
fi

# If this is a ZFS pool, exit successfully (handled by mount-zfs-pool.sh)
if echo "$STORAGE_SELECTION" | grep -q "^zfs:"; then
  echo "Storage selection is a ZFS pool, skipping disk mount (handled by mount-zfs-pool.sh)" >&2
  # Output empty host_mountpoint as it will be set by mount-zfs-pool.sh
  echo '[{ "id": "host_mountpoint", "value": ""}]' >&2
  exit 0
fi

# Parse storage selection: must be uuid:...
if ! echo "$STORAGE_SELECTION" | grep -q "^uuid:"; then
  echo "Error: Invalid storage selection format. Must start with 'uuid:' or 'zfs:'" >&2
  exit 1
fi

UUID=$(echo "$STORAGE_SELECTION" | sed 's/^uuid://')

# Find device name by UUID
DEV=$(blkid -U "$UUID")
if [ -z "$DEV" ]; then
  echo "Device with UUID $UUID not found!" >&2
  exit 1
fi

# Auto-generate mountpoint based on UUID
# Use first 8 characters of UUID for mountpoint name
UUID_SHORT=$(echo "$UUID" | cut -c1-8)
MOUNTPOINT="/mnt/disk-$UUID_SHORT"
echo "Auto-generated mountpoint: $MOUNTPOINT" >&2

# Create mountpoint on host
mkdir -p "$MOUNTPOINT"

# Mount disk (without fstab, with nofail) only if not already mounted
if ! mountpoint -q "$MOUNTPOINT" || ! mount | grep -q "on $MOUNTPOINT "; then
  mount -o nofail "$DEV" "$MOUNTPOINT" 1>&2
  if [ $? -ne 0 ]; then
    echo "Mounting $DEV to $MOUNTPOINT failed!" >&2
    exit 1
  fi
fi

# Set permissions if uid/gid are provided
if [ -n "$UID_VALUE" ] && [ -n "$GID_VALUE" ] && [ "$UID_VALUE" != "" ] && [ "$GID_VALUE" != "" ]; then
  chown "$UID_VALUE:$GID_VALUE" "$MOUNTPOINT" 1>&2
fi

echo "Device $DEV (UUID: $UUID) successfully mounted to $MOUNTPOINT" >&2
echo '{ "id": "host_mountpoint", "value": "'$MOUNTPOINT'" }'
exit 0


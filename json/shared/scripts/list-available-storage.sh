#!/bin/sh
# List available storage options on the VE host
# Outputs JSON array of objects with name and value for enumValues
# Format: [{"name":"short description","value":"uuid:... or zfs:..."}, ...]
# For filesystems: only unmounted partitions are included
# For ZFS pools: only mounted pools are included (as they are always mounted in Proxmox)
# Values are prefixed: uuid: for filesystems, zfs: for ZFS pools

set -eu

# Get list of mounted device paths
MOUNTED_DEVICES=$(mount | awk '{print $1}' | grep -E '^/dev/' | sort -u)

# Get list of currently imported ZFS pools
IMPORTED_POOLS=$(zpool list -H -o name 2>/dev/null || echo "")

# Process each partition
FIRST=true
printf '['

lsblk -n -o NAME,TYPE,FSTYPE,SIZE,MOUNTPOINT 2>/dev/null | {
  while IFS= read -r line; do
    NAME=$(echo "$line" | awk '{print $1}')
    TYPE=$(echo "$line" | awk '{print $2}')
    FSTYPE=$(echo "$line" | awk '{print $3}')
    SIZE=$(echo "$line" | awk '{print $4}')
    MOUNTPOINT=$(echo "$line" | awk '{print $5}')
    
    # Only process partitions (not disks themselves)
    if [ "$TYPE" != "part" ]; then
      continue
    fi
    
    # Skip if mounted
    if [ -n "$MOUNTPOINT" ] && [ "$MOUNTPOINT" != "" ]; then
      continue
    fi
    
    # Check if this device is mounted (double-check)
    if echo "$MOUNTED_DEVICES" | grep -q "^/dev/$NAME$"; then
      continue
    fi
    
    # Skip ZFS partitions - we'll list mounted pools separately
    if [ "$FSTYPE" = "zfs" ]; then
      continue
    else
      # Traditional filesystem - get FSTYPE and UUID
      # If lsblk didn't provide FSTYPE, try to get it from blkid
      if [ -z "$FSTYPE" ] || [ "$FSTYPE" = "" ]; then
        FSTYPE=$(blkid -s TYPE -o value "/dev/$NAME" 2>/dev/null || echo "")
      fi
      
      # Skip if no filesystem type (unformatted partition)
      if [ -z "$FSTYPE" ] || [ "$FSTYPE" = "" ]; then
        continue
      fi
      
      # Get UUID for this partition
      UUID=$(blkid -s UUID -o value "/dev/$NAME" 2>/dev/null || echo "")
      
      # Skip if no UUID found
      if [ -z "$UUID" ] || [ "$UUID" = "" ]; then
        continue
      fi
      
      # Create descriptive name: device name, filesystem type, size
      if [ -n "$SIZE" ] && [ "$SIZE" != "" ]; then
        NAME_TEXT="${NAME} (${FSTYPE}, ${SIZE})"
      else
        NAME_TEXT="${NAME} (${FSTYPE})"
      fi
      
      # Use uuid: prefix for filesystems
      IDENTIFIER="uuid:${UUID}"
    fi
    
    # Output JSON object
    if [ "$FIRST" = true ]; then
      FIRST=false
    else
      printf ','
    fi
    printf '{"name":"%s","value":"%s"}' "$NAME_TEXT" "$IDENTIFIER"
  done
}

# List ZFS pools that are imported and mounted
# In Proxmox, ZFS pools are always mounted, so we list all imported pools
if [ -n "$IMPORTED_POOLS" ]; then
  {
    echo "$IMPORTED_POOLS"
  } | {
    while IFS= read -r POOL_NAME; do
      if [ -z "$POOL_NAME" ] || [ "$POOL_NAME" = "" ]; then
        continue
      fi
      
      # Get pool mountpoint
      POOL_MOUNTPOINT=$(zfs get -H -o value mountpoint "$POOL_NAME" 2>/dev/null || echo "")
      
      # Only include pools that have a valid mountpoint (not "none" or "-")
      if [ "$POOL_MOUNTPOINT" = "none" ] || [ "$POOL_MOUNTPOINT" = "-" ]; then
        continue
      fi
      
      # Verify the mountpoint actually exists and is accessible
      if [ ! -d "$POOL_MOUNTPOINT" ]; then
        continue
      fi
      
      # Get pool size
      POOL_SIZE=$(zpool list -H -o size "$POOL_NAME" 2>/dev/null || echo "")
      
      # Create descriptive name
      if [ -n "$POOL_SIZE" ] && [ "$POOL_SIZE" != "" ]; then
        NAME_TEXT="ZFS Pool: ${POOL_NAME} (${POOL_SIZE})"
      else
        NAME_TEXT="ZFS Pool: ${POOL_NAME}"
      fi
      
      # Output JSON object
      if [ "$FIRST" = true ]; then
        FIRST=false
      else
        printf ','
      fi
      printf '{"name":"%s","value":"%s"}' "$NAME_TEXT" "zfs:${POOL_NAME}"
    done
  }
fi

printf ']'
exit 0

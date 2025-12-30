#!/bin/sh
# List available storage options on the VE host
#
# This script lists available storage by:
# 1. Scanning for unmounted block devices (by UUID)
# 2. Scanning for mounted ZFS pools
# 3. Formatting as JSON array for enumValues
#
# Output format: JSON array of objects with name and value fields
# Example: [{"name":"sda1 (ext4)","value":"uuid:1234-5678"}, {"name":"tank (ZFS)","value":"zfs:tank"}, ...]
#
# Note:
#   - For filesystems: only unmounted partitions are included
#   - For ZFS pools: only mounted pools are included (as they are always mounted in Proxmox)
#   - Values are prefixed: uuid: for filesystems, zfs: for ZFS pools
#
# Output: JSON to stdout (errors to stderr)

set -eu

# Timeout for commands that might hang
# Reduced timeouts for faster failure in test contexts
TIMEOUT_CMD="timeout"
if ! command -v timeout >/dev/null 2>&1; then
  # Fallback: use gtimeout on macOS or skip timeout
  if command -v gtimeout >/dev/null 2>&1; then
    TIMEOUT_CMD="gtimeout"
  else
    TIMEOUT_CMD=""
  fi
fi

# Helper function to run command with timeout
run_with_timeout() {
  local timeout_sec="${1:-1}"
  shift
  if [ -n "$TIMEOUT_CMD" ]; then
    $TIMEOUT_CMD "$timeout_sec" "$@" 2>/dev/null || return 1
  else
    # If timeout command not available, try to run but fail fast if command doesn't exist
    if ! command -v "$1" >/dev/null 2>&1; then
      return 1
    fi
    "$@" 2>/dev/null || return 1
  fi
}

# Early check: if lsblk is not available, exit with error immediately
# This ensures the script fails in test contexts where hardware tools are not available
if ! command -v lsblk >/dev/null 2>&1; then
  echo "Error: lsblk command not found. This script requires lsblk to list block devices." >&2
  exit 1
fi

# Additional check: if we're running in a test context (no real hardware access),
# try to detect this and fail early. This happens when running with sshCommand != "ssh"
# Check if we can actually access /sys/block (indicator of real system vs test environment)
# This check is done BEFORE any potentially slow commands to fail fast
if [ ! -d "/sys/block" ] || [ ! -r "/sys/block" ]; then
  echo "Error: Cannot access /sys/block. This script requires access to system block devices." >&2
  exit 1
fi

# Early check for other required commands to fail fast
if ! command -v mount >/dev/null 2>&1; then
  echo "Error: mount command not found." >&2
  exit 1
fi

# Get list of mounted device paths (reduced timeout for faster failure in test contexts)
MOUNTED_DEVICES=$(run_with_timeout 1 mount | awk '{print $1}' | grep -E '^/dev/' | sort -u || echo "")

# Get list of currently imported ZFS pools (reduced timeout for faster failure in test contexts)
IMPORTED_POOLS=$(run_with_timeout 1 zpool list -H -o name 2>/dev/null || echo "")

# Process each partition
FIRST=true
printf '['

run_with_timeout 2 lsblk -n -o NAME,TYPE,FSTYPE,SIZE,MOUNTPOINT 2>/dev/null | {
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
      # If lsblk didn't provide FSTYPE, try to get it from blkid (reduced timeout)
      if [ -z "$FSTYPE" ] || [ "$FSTYPE" = "" ]; then
        FSTYPE=$(run_with_timeout 1 blkid -s TYPE -o value "/dev/$NAME" 2>/dev/null || echo "")
      fi
      
      # Skip if no filesystem type (unformatted partition)
      if [ -z "$FSTYPE" ] || [ "$FSTYPE" = "" ]; then
        continue
      fi
      
      # Get UUID for this partition (reduced timeout)
      UUID=$(run_with_timeout 1 blkid -s UUID -o value "/dev/$NAME" 2>/dev/null || echo "")
      
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
      
      # Get pool mountpoint (reduced timeout)
      POOL_MOUNTPOINT=$(run_with_timeout 1 zfs get -H -o value mountpoint "$POOL_NAME" 2>/dev/null || echo "")
      
      # Only include pools that have a valid mountpoint (not "none" or "-")
      if [ "$POOL_MOUNTPOINT" = "none" ] || [ "$POOL_MOUNTPOINT" = "-" ]; then
        continue
      fi
      
      # Verify the mountpoint actually exists and is accessible
      if [ ! -d "$POOL_MOUNTPOINT" ]; then
        continue
      fi
      
      # Get pool size (reduced timeout)
      POOL_SIZE=$(run_with_timeout 1 zpool list -H -o size "$POOL_NAME" 2>/dev/null || echo "")
      
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

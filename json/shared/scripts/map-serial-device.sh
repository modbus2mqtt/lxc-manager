# Map serial device if provided
if [  "{{ usb }}" = "false" ]; then
  echo "No serial device specified, skipping mapping. {{ usb }}" >&2
  exit 0
fi
echo "Checking if VM {{ vm_id }} is running... {{ usb }}" >&2
VM_WAS_RUNNING=0
if pct status {{ vm_id }} | grep -q 'status: running'; then
  pct stop {{ vm_id }} >&2
  VM_WAS_RUNNING=1
fi

if [ -n "{{ serial_host }}" ]; then
  if [ -e "{{ serial_host }}" ]; then
    # Auto-select SERIAL_CONT based on SERIAL_HOST
    BASENAME=$(basename "{{ serial_host }}")
    if echo "{{ serial_host }}" | grep -q "/dev/serial/by-id/"; then
      SERIAL_CONT="/dev/ttyUSB0"
    else
      SERIAL_CONT="/dev/$BASENAME"
    fi
    echo "Mapping serial device {{ serial_host }} to container as $SERIAL_CONT..." >&2
    pct set {{ vm_id }} -mp0 {{ serial_host }},$SERIAL_CONT,mp=$SERIAL_CONT >&2
    
    # Set permissions on the host device if uid/gid are provided
    # With standard Proxmox mapping: Container UID N → Host UID (100000 + N)
    # So we need to set ownership to (UID_VALUE + 100000):(GID_VALUE + 100000) on the host
    UID_VALUE="{{ uid }}"
    GID_VALUE="{{ gid }}"
    if [ -n "$UID_VALUE" ] && [ -n "$GID_VALUE" ] && [ "$UID_VALUE" != "" ] && [ "$GID_VALUE" != "" ]; then
      # Resolve symbolic links to get the actual device (e.g., /dev/serial/by-id/... -> /dev/ttyUSB0)
      # readlink -f resolves all symbolic links and returns the canonical path
      # This is important because /dev/serial/by-id/ links are stable even if the device name changes
      ACTUAL_DEVICE=$(readlink -f "{{ serial_host }}" 2>/dev/null || echo "{{ serial_host }}")
      
      if [ -e "$ACTUAL_DEVICE" ]; then
        # Calculate mapped UID/GID for standard Proxmox mapping
        MAPPED_UID=$((UID_VALUE + 100000))
        MAPPED_GID=$((GID_VALUE + 100000))
        
        # Set ownership on the actual host device (not the symlink)
        if chown "$MAPPED_UID:$MAPPED_GID" "$ACTUAL_DEVICE" 2>/dev/null; then
          echo "Set ownership of $ACTUAL_DEVICE to $MAPPED_UID:$MAPPED_GID (Container UID $UID_VALUE -> Host UID $MAPPED_UID)" >&2
        else
          echo "Warning: Failed to set ownership of $ACTUAL_DEVICE to $MAPPED_UID:$MAPPED_GID" >&2
        fi
        # Set permissions (read/write for owner, read for group and others)
        if chmod 664 "$ACTUAL_DEVICE" 2>/dev/null; then
          echo "Set permissions of $ACTUAL_DEVICE to 664" >&2
        else
          echo "Warning: Failed to set permissions of $ACTUAL_DEVICE" >&2
        fi
        
        # Create udev rule to automatically set permissions when device is plugged in
        # Get USB vendor and product ID using udevadm
        if command -v udevadm >/dev/null; then
          # Get the sysfs path of the device
          SYSFS_PATH=$(udevadm info --name="$ACTUAL_DEVICE" --query=symlink --root 2>/dev/null | head -n1)
          if [ -z "$SYSFS_PATH" ]; then
            # Try alternative method: get device path from /sys
            DEVICE_NAME=$(basename "$ACTUAL_DEVICE")
            SYSFS_PATH="/sys/class/tty/$DEVICE_NAME"
          fi
          
          # Get vendor and product ID from udev
          VENDOR_ID=$(udevadm info --name="$ACTUAL_DEVICE" --attribute-walk 2>/dev/null | grep -i "ATTRS{idVendor}" | head -n1 | sed 's/.*=="\([^"]*\)".*/\1/' || echo "")
          PRODUCT_ID=$(udevadm info --name="$ACTUAL_DEVICE" --attribute-walk 2>/dev/null | grep -i "ATTRS{idProduct}" | head -n1 | sed 's/.*=="\([^"]*\)".*/\1/' || echo "")
          
          if [ -n "$VENDOR_ID" ] && [ -n "$PRODUCT_ID" ]; then
            # Create unique rule file name based on VM ID and device IDs
            RULE_FILE="/etc/udev/rules.d/99-lxc-serial-{{ vm_id }}-${VENDOR_ID}-${PRODUCT_ID}.rules"
            
            # Create udev rule
            # The rule matches USB serial devices by vendor/product ID and sets permissions
            cat > "$RULE_FILE" <<EOF
# udev rule for LXC container {{ vm_id }} serial device
# Automatically sets permissions when USB serial device is plugged in
# Vendor ID: $VENDOR_ID, Product ID: $PRODUCT_ID
# Container UID: $UID_VALUE -> Host UID: $MAPPED_UID
# Container GID: $GID_VALUE -> Host GID: $MAPPED_GID
SUBSYSTEM=="tty", ATTRS{idVendor}=="$VENDOR_ID", ATTRS{idProduct}=="$PRODUCT_ID", MODE="0664", OWNER="$MAPPED_UID", GROUP="$MAPPED_GID"
EOF
            echo "Created udev rule $RULE_FILE for automatic permission setting on device reconnect" >&2
            echo "Rule matches: Vendor ID=$VENDOR_ID, Product ID=$PRODUCT_ID" >&2
            
            # Reload udev rules
            if command -v udevadm >/dev/null 2>&1; then
              udevadm control --reload-rules >&2
              udevadm trigger --subsystem-match=tty --attr-match=idVendor="$VENDOR_ID" --attr-match=idProduct="$PRODUCT_ID" >&2
              echo "Reloaded udev rules and triggered rule for current device" >&2
            fi
          else
            echo "Warning: Could not determine USB vendor/product ID for $ACTUAL_DEVICE" >&2
            echo "Warning: udev rule not created. Permissions will need to be set manually after reconnection." >&2
          fi
        else
          echo "Warning: udevadm not found. Cannot create udev rule for automatic permission setting." >&2
        fi
      else
        echo "Warning: Could not resolve actual device for {{ serial_host }} (resolved to: $ACTUAL_DEVICE)" >&2
      fi
    fi
  else
    echo "Serial device {{ serial_host }} does not exist on the host!" >&2
    echo "Note: If the device was recently plugged in, wait a moment and run the script again." >&2
    echo "Note: Using /dev/serial/by-id/... paths is recommended as they are stable across reconnections." >&2
  fi
fi

if [ "$VM_WAS_RUNNING" -eq 1 ]; then
  echo "Restarting VM {{ vm_id }}..." >&2
  pct start {{ vm_id }} >&2
fi

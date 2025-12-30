#!/bin/sh
# List all USB serial ports on the VE host
#
# This script lists all USB serial devices by:
# 1. Using lsusb to enumerate USB devices
# 2. Filtering for devices with serial/tty capabilities
# 3. Formatting as JSON array for enumValues
#
# Output format: JSON array of objects with name and value fields
# Example: [{"name":"FTDI Serial Converter","value":"1:2"}, ...]
# Uses bus:device format which is stable and can be used directly for mapping
#
# Requires:
#   - lsusb: USB utilities (must be installed)
#
# Output: JSON to stdout (errors to stderr)

set -e

# Check if lsusb is available
if ! command -v lsusb >/dev/null 2>&1; then
  echo "Error: lsusb command not found. This script requires lsusb to list USB devices." >&2
  exit 1
fi

# Check if we can access USB devices
if [ ! -d "/sys/bus/usb/devices" ]; then
  echo "Error: Cannot access /sys/bus/usb/devices directory." >&2
  exit 1
fi

# Get USB serial device information
# Use pattern /sys/bus/usb/devices/*/*/tty/* to find all tty devices directly
FIRST=true
printf '['

# Process all tty devices found via the pattern
for TTY_SYSFS_PATH in /sys/bus/usb/devices/*/*/tty/*; do
  # Skip if no devices found (glob expansion)
  [ ! -d "$TTY_SYSFS_PATH" ] && continue
  
  # Get tty device name (e.g., ttyUSB0, ttyACM0)
  TTY_NAME=$(basename "$TTY_SYSFS_PATH")
  
  # Check if corresponding /dev device exists
  if [ ! -e "/dev/$TTY_NAME" ]; then
    continue
  fi
  
  # Navigate up to find USB device directory (two levels up from tty/*)
  # Path: /sys/bus/usb/devices/1-3:1.0/tty/ttyUSB0 -> /sys/bus/usb/devices/1-3:1.0
  USB_INTERFACE_PATH=$(dirname "$(dirname "$TTY_SYSFS_PATH")")
  USB_DEVICE_PATH="$USB_INTERFACE_PATH"
  
  # Navigate up to base USB device if we're in an interface path (contains :)
  # e.g., /sys/bus/usb/devices/1-3:1.0 -> /sys/bus/usb/devices/1-3
  if echo "$USB_DEVICE_PATH" | grep -q ':'; then
    USB_DEVICE_PATH=$(dirname "$USB_DEVICE_PATH")
  fi
  
  # Extract bus and device from path
  # Path format: /sys/bus/usb/devices/1-3 or /sys/bus/usb/devices/1-3.4
  DEVICE_BASENAME=$(basename "$USB_DEVICE_PATH")
  USB_BUS=$(echo "$DEVICE_BASENAME" | sed -n 's/^\([0-9]*\)-.*/\1/p' | sed 's/^0*//' || echo "")
  USB_DEVICE=$(echo "$DEVICE_BASENAME" | sed -n 's/^[0-9]*-\([0-9]*\)[.:].*/\1/p' | sed 's/^0*//' || echo "")
  # If no : or . found, try without suffix
  [ -z "$USB_DEVICE" ] && USB_DEVICE=$(echo "$DEVICE_BASENAME" | sed -n 's/^[0-9]*-\([0-9]*\)$/\1/p' | sed 's/^0*//' || echo "")
  
  if [ -z "$USB_BUS" ] || [ -z "$USB_DEVICE" ]; then
    continue
  fi
  
  # Validate that USB_BUS and USB_DEVICE are numeric integers
  if ! echo "$USB_BUS" | grep -qE '^[0-9]+$' || ! echo "$USB_DEVICE" | grep -qE '^[0-9]+$'; then
    continue
  fi
  
  # Convert to integer (remove any leading zeros)
  USB_BUS=$((USB_BUS + 0))
  USB_DEVICE=$((USB_DEVICE + 0))
  
  # Get vendor and product ID from USB device path
  VENDOR_ID=$(cat "$USB_DEVICE_PATH/idVendor" 2>/dev/null | tr -d '\n\r' || echo "")
  PRODUCT_ID=$(cat "$USB_DEVICE_PATH/idProduct" 2>/dev/null | tr -d '\n\r' || echo "")
  
  # Get lsusb description
  USB_INFO=""
  if [ -n "$VENDOR_ID" ] && [ -n "$PRODUCT_ID" ]; then
    # Format bus and device with leading zeros for lsusb matching
    BUS_FORMATTED=$(printf "%03d" "$USB_BUS" 2>/dev/null || echo "")
    DEV_FORMATTED=$(printf "%03d" "$USB_DEVICE" 2>/dev/null || echo "")
    if [ -n "$BUS_FORMATTED" ] && [ -n "$DEV_FORMATTED" ]; then
      # Find lsusb line for this specific bus/device
      LSUSB_LINE=$(lsusb | grep "^Bus $BUS_FORMATTED Device $DEV_FORMATTED:" || echo "")
      if [ -n "$LSUSB_LINE" ]; then
        USB_INFO=$(echo "$LSUSB_LINE" | sed 's/^Bus [0-9]* Device [0-9]*: ID //' || echo "")
      fi
    fi
    
    # Fallback: use vendor:product ID if lsusb didn't find exact match
    if [ -z "$USB_INFO" ]; then
      USB_INFO=$(lsusb -d "${VENDOR_ID}:${PRODUCT_ID}" 2>/dev/null | sed 's/^Bus [0-9]* Device [0-9]*: ID //' | head -n1 || echo "")
    fi
  fi
  
  # Create descriptive name
  if [ -n "$USB_INFO" ] && [ "$USB_INFO" != "" ]; then
    NAME_TEXT="$USB_INFO"
  elif [ -n "$VENDOR_ID" ] && [ -n "$PRODUCT_ID" ]; then
    NAME_TEXT="ID ${VENDOR_ID}:${PRODUCT_ID}"
  else
    NAME_TEXT="USB Serial Device (bus $USB_BUS, device $USB_DEVICE)"
  fi
  
  # Output JSON object
  if [ "$FIRST" = true ]; then
    FIRST=false
  else
    printf ','
  fi
  # Escape quotes in name for JSON
  ESCAPED_NAME=$(echo "$NAME_TEXT" | sed 's/"/\\"/g')
  VALUE="${USB_BUS}:${USB_DEVICE}"
  printf '{"name":"%s","value":"%s"}' "$ESCAPED_NAME" "$VALUE"
done

printf ']'
exit 0

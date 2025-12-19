#!/bin/sh
# Start and enable Mosquitto service (runs inside the container)
set -eu

# Enable mosquitto service
rc-update add mosquitto default >&2

# Start mosquitto service
rc-service mosquitto start >&2

# Verify that mosquitto is running
if ! rc-service mosquitto status >/dev/null 2>&1; then
  echo "Warning: Mosquitto service may not have started correctly" >&2
  exit 1
fi

exit 0

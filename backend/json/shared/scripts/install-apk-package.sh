#!/bin/sh
# Install APK packages inside Alpine LXC (runs inside the container)
# Inputs (templated):
#   {{ packages }}  (space-separated list, e.g. "openssh curl")

PACKAGES="{{ packages }}"

if [ -z "$PACKAGES" ]; then
  echo "Missing packages" >&2
  exit 2
fi

set -eu

# Ensure apk is available and index up-to-date
apk update || true

# Install requested packages
# Split by whitespace safely
# shellcheck disable=SC2086
apk add --no-cache $PACKAGES

# No output requested; exit success
exit 0

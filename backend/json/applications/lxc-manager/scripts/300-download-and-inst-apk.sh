#!/bin/sh
# Download and install APK inside Alpine LXC (runs inside the container)
# Inputs (templated):
#   {{ apk_url }}
#   {{ apk_key_url }} (optional)

APK_URL="{{ apk_url }}"
APK_KEY_URL="{{ apk_key_url }}"

if [ -z "$APK_URL" ]; then
  echo "Missing apk_url" >&2
  exit 2
fi

set -eu

# Prepare key if provided
if [ -n "$APK_KEY_URL" ]; then
  case "$APK_KEY_URL" in
    http*) curl -fsSL "$APK_KEY_URL" -o /root/packager.rsa.pub ;;
    *) cp "$APK_KEY_URL" /root/packager.rsa.pub ;;
  esac
  mkdir -p /etc/apk/keys
  cp /root/packager.rsa.pub /etc/apk/keys/
fi

# Fetch APK
case "$APK_URL" in
  http*) curl -fsSL "$APK_URL" -o /root/package.apk ;;
  *) cp "$APK_URL" /root/package.apk ;;
esac

# Install
apk add --no-cache /root/package.apk

# Emit outputs
echo '[{"id":"apk_file","value":"/root/package.apk"}]'

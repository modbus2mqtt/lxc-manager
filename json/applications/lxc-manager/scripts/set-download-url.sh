#!/bin/sh

# Find APK file in repository root (preferred) or fallback to known build output
# Outputs JSON with keys: packageurl, packagerpubkeyurl

# Search order:
# 1) ./*.apk
# 2) ./alpine/package/repo/*.apk

find_apk() {
  # prefer APKs in repo root
  apk_path=$(ls -1 ./*.apk 2>/dev/null | head -n1)
  if [ -z "$apk_path" ]; then
    apk_path=$(ls -1 ./alpine/package/repo/*.apk 2>/dev/null | head -n1)
  fi
  printf '%s' "$apk_path"
}

apk_file=$(find_apk)

# Public key path (if present locally)
pubkey_path="./packager.rsa.pub"
if [ ! -f "$pubkey_path" ]; then
  pubkey_path="./alpine/package/repo/packager.rsa.pub"
fi

if [ -n "$apk_file" ]; then
  # Local file path output
  packageurl="$apk_file"
else
  # Fallback: try latest GitHub release asset
  owner="modbus2mqtt"
  repo="lxc-manager"
  packageurl=$(curl -sL https://api.github.com/repos/$owner/$repo/releases/latest | \
    awk '
      /"name":/ && /\.apk"/ { found=1 }
      found && /"browser_download_url":/ {
        gsub(/.*: *"/, "", $0)
        gsub(/",?$/, "", $0)
        print $0
        exit
      }
    ')
fi

# If pubkey is not local, point to release asset URL
if [ -f "$pubkey_path" ]; then
  packagerpubkeyurl="$pubkey_path"
else
  packagerpubkeyurl="https://github.com/modbus2mqtt/lxc-manager/releases/latest/download/packager.rsa.pub"
fi

echo '[{ "id": "packageurl", "value": "'$packageurl'" }, { "id": "packagerpubkeyurl", "value": "'$packagerpubkeyurl'" }]'
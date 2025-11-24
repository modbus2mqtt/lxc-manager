#!/bin/sh
owner="modbus2mqtt"
repo="modbus2mqtt"
packagerurl=$(curl -sL https://api.github.com/repos/$owner/$repo/releases/latest| \
jq -r '.assets[] | select(.name? | match("'"$repo"'.*x86_64.apk$")) | .browser_download_url' )
packagerpubkeyurl="https://github.com/$owner/$repo/releases/latest/download/packager.rsa.pub"
echo '{ "name": "packageurl", "value": "'$packagerurl'" }, { "name": "packagerpubkeyurl", "value": "'$packagerpubkeyurl'" }' 
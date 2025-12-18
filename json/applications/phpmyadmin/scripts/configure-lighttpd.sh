#!/bin/sh
# Configure lighttpd to enable FastCGI (runs inside the container)
set -eu

LIGHTTPD_CONF="/etc/lighttpd/lighttpd.conf"

if [ ! -f "$LIGHTTPD_CONF" ]; then
  echo "Error: $LIGHTTPD_CONF not found" >&2
  exit 1
fi

# Uncomment mod_fastcgi.conf line if it exists and is commented
if grep -q "^#.*include.*mod_fastcgi.conf" "$LIGHTTPD_CONF"; then
  sed -i 's|^#\(.*include.*mod_fastcgi.conf\)|\1|' "$LIGHTTPD_CONF"
elif ! grep -q "mod_fastcgi.conf" "$LIGHTTPD_CONF"; then
  # Add the include line if it doesn't exist
  echo 'include "mod_fastcgi.conf"' >> "$LIGHTTPD_CONF"
fi

exit 0

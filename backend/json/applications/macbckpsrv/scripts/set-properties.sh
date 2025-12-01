#!/bin/sh

# Outputs properties for the backup user and mountpoint in JSON format (for use with outputs.schema.json)

cat <<EOF
[
  { "id": "username", "value": "backup", "default": "backup" },
  { "id": "mountpoint", "value": "backup" },
  { "id": "uid", "value": 2001 },
  { "id": "gid", "value": 2001 }
]
EOF

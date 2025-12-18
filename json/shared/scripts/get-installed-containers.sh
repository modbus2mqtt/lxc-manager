#!/bin/sh
# Outputs all /opt/install/config.json contents from running LXC containers as a comma-separated list (no brackets)

# Get all running LXC container IDs
detected_ids=$(pct list | awk '$2 == "running" {print $1}')

first=1
count=0
for vmid in $detected_ids; do
  # Try to read config.json from the container
  output=$(lxc-attach -n "$vmid" -- cat /opt/install/config.json 2>/dev/null)
  if [ $? -eq 0 ] && [ -n "$output" ]; then
    if [ $first -eq 1 ]; then
      printf '%s' "$output"
      first=0
    else
      printf ',%s' "$output"
    fi
    count=$((count+1))
  fi
done

echo "Installed containers found: $count" >&2
echo "Found $(echo "$detected_ids" | wc -w) of $(echo "$detected_ids" | wc -w) running LXC containers " >&2 # for clean stderr

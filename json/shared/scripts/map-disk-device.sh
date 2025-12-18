#!/bin/sh
# Map disk device to LXC container
# All output goes to stderr except final JSON

used=$(pct config {{ vm_id }} | grep '^mp' | cut -d: -f1 | sed 's/mp//')
mp=""
for i in $(seq 0 9); do
  if ! echo "$used" | grep -qw "$i"; then
    mp="mp$i"
    echo "Using $mp" >&2
    break
  fi
done
pct set {{ vm_id }} -${mp} {{ disk_on_ve }},mp={{ mounted_path }},size={{ disk_size }}G,backup=0 >&2
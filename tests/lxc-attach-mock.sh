#!/bin/sh
echo "$@" >&2
echo "[lxc-attach-mock]: $@" >&2
echo '{"mocked":true,"args":"'$@'"}'

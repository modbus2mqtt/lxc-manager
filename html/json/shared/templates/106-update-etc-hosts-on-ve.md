# Update /etc/hosts entries

Optional template to update /etc/hosts with hostname and static IP addresses from previous steps.

**Execution Target:** ve

<!-- GENERATED_START:PARAMETERS -->
## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `hostname` | string | No | - | Hostname to update. |
| `static_ip` | string | No | - | Static IPv4 address (optional). |
| `static_ip6` | string | No | - | Static IPv6 address (optional). |

<!-- GENERATED_END:PARAMETERS -->

<!-- GENERATED_START:COMMANDS -->
## Commands

This template executes the following commands in order:

| # | Command | Type | Details | Description |
|---|---------|------|---------|-------------|
| 1 | lxc-update-etc-hosts | Script | `lxc-update-etc-hosts.sh` | - |

<!-- GENERATED_END:COMMANDS -->

## Capabilities

This template provides the following capabilities:

- Adding or updating hostname entries with IPv4/IPv6 addresses
- Removing old entries if IPs are not provided
- Ensuring proper formatting of /etc/hosts file

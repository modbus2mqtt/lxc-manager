# Static IP for LXC

Edit LXC network settings for a container with static IPs.

**Execution Target:** ve

<!-- GENERATED_START:PARAMETERS -->
## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `static_ip` | string | No | - | Static IPv4 address in CIDR notation (e.g. 192.168.4.100/24). |
| `static_gw` | string | No | - | Static IPv4 gateway (e.g. 192.168.4.1). Requires static_ip. |
| `static_ip6` | string | No | - | Static IPv6 address in CIDR notation (e.g. fd00::50/64). |
| `static_gw6` | string | No | - | Static IPv6 gateway (e.g. fd00::1). Requires static_ip6. |
| `nameserver4` | string | No | - | IPv4 DNS nameserver (e.g. 192.168.1.1). Optional. |
| `nameserver6` | string | No | - | IPv6 DNS nameserver (e.g. fd00:...::1 or 2001:...::1). Optional. |
| `vm_id` | string | No | - | VMID of the container. |
| `hostname` | string | No | - | Hostname of the container. |
| `bridge` | string | No | - | Bridge to attach (e.g. vmbr0). |

<!-- GENERATED_END:PARAMETERS -->

<!-- GENERATED_START:COMMANDS -->
## Commands

This template executes the following commands in order:

| # | Command | Type | Details | Description |
|---|---------|------|---------|-------------|
| 1 | lxc-static-ip | Script | `lxc-static-ip.sh` | - |

<!-- GENERATED_END:COMMANDS -->

## Capabilities

This template provides the following capabilities:

- Updating LXC container network configuration
- Setting IPv4 and/or IPv6 addresses
- Configuring gateway settings

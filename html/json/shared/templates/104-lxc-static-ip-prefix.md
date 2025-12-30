# Compute Static IPs

Optional step: Derive static IPv4/IPv6 from prefixes and VMID, emitting parameter overrides. Set prefixes in a shared previous step. This can take over the complete Ip configuration when used with the 'Static IP Address for LXC Container' template.

**Execution Target:** ve

<!-- GENERATED_START:PARAMETERS -->
## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `vm_id` | string | No | - | VMID of the container. |
| `ip4_prefix` | string | No | - | IPv4 prefix (e.g. 192.168.1) ⚙️ Advanced |
| `ip4_cidr` | string | No | 24 | IPv4 CIDR (e.g. 24) ⚙️ Advanced |
| `ip6_prefix` | string | No | - | IPv6 prefix (e.g. 2001:db8::) ⚙️ Advanced |
| `ip6_cidr` | string | No | 64 | IPv6 CIDR (e.g. 64) ⚙️ Advanced |

<!-- GENERATED_END:PARAMETERS -->

<!-- GENERATED_START:OUTPUTS -->
## Outputs

| Output ID | Default | Description |
|-----------|---------|-------------|
| `use_static_ip` | - | - |
| `static_ip` | - | - |
| `static_ip6` | - | - |

<!-- GENERATED_END:OUTPUTS -->

<!-- GENERATED_START:COMMANDS -->
## Commands

This template executes the following commands in order:

| # | Command | Type | Details | Description |
|---|---------|------|---------|-------------|
| 1 | Unnamed Command | Script | `lxc-static-ip-prefix.sh` | - |

<!-- GENERATED_END:COMMANDS -->

## Capabilities

This template provides the following capabilities:

- Deriving IPv4 address from prefix and VM ID
- Deriving IPv6 address from prefix and VM ID
- Emitting parameter overrides as JSON for use in subsequent templates

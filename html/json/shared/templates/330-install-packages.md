# Install Packages

Install packages inside the LXC container. Supports both Alpine Linux (apk) and Debian/Ubuntu (apt) package managers.

**Execution Target:** lxc

<!-- GENERATED_START:PARAMETERS -->
## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `packages` | string | Yes | - | Space-separated list of packages to install. For Alpine Linux, use APK package names. For Debian/Ubuntu, use apt package names. |
| `ostype` | string | No | alpine | Operating system type: 'alpine' for Alpine Linux (apk) or 'debian'/'ubuntu' for Debian/Ubuntu (apt). ⚙️ Advanced |

<!-- GENERATED_END:PARAMETERS -->

<!-- GENERATED_START:COMMANDS -->
## Commands

This template executes the following commands in order:

| # | Command | Type | Details | Description |
|---|---------|------|---------|-------------|
| 1 | Unnamed Command | Script | `install-apk-package.sh` | Install packages using the appropriate package manager (apk for Alpine, apt for Debian/Ubuntu) |

<!-- GENERATED_END:COMMANDS -->

## Capabilities

This template provides the following capabilities:

- Auto-detecting OS type from /etc/os-release
- Using appropriate package manager (apk for Alpine, apt for Debian/Ubuntu)
- Installing specified packages

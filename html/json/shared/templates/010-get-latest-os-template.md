# Latest OS Template

Download latest operating system template for Proxmox

**Execution Target:** ve

<!-- GENERATED_START:PARAMETERS -->
## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `ostype` | enum | No | alpine | One of alpine, debian, ubuntu. Base template to download |

<!-- GENERATED_END:PARAMETERS -->

<!-- GENERATED_START:OUTPUTS -->
## Outputs

| Output ID | Default | Description |
|-----------|---------|-------------|
| `undefined` | - | - |

<!-- GENERATED_END:OUTPUTS -->

<!-- GENERATED_START:COMMANDS -->
## Commands

This template executes the following commands in order:

| # | Command | Type | Details | Description |
|---|---------|------|---------|-------------|
| 1 | Latest OS Template | Script | `get-latest-os-template.sh` | - |

<!-- GENERATED_END:COMMANDS -->

## Capabilities

This template provides the following capabilities:

- Finding the latest template matching the specified OS type
- Checking if template is already present in local storage
- Downloading template if not present

# Env Variables in LXC

Sets environment variables in an LXC container configuration.

For each environment variable entry (key=value format, one per line), sets the environment variable in the container configuration file.

The environment variables are stored as comments in the container configuration file and can be read later if needed.

This template can be called independently of the LXC container's state (running or stopped) and is safe to call multiple times (idempotent).

**Execution Target:** ve

<!-- GENERATED_START:PARAMETERS -->
## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `vm_id` | string | Yes | - | ID of the LXC container for which environment variables will be set. |
| `envs` | string | Yes | - | Environment variables in key=value format, one per line. Each line sets an environment variable in the container configuration. Example:
MYAPP_HOST=localhost
MYAPP_PORT=8080
DATABASE_URL=postgresql://localhost:5432/mydb |

<!-- GENERATED_END:PARAMETERS -->

<!-- GENERATED_START:COMMANDS -->
## Commands

This template executes the following commands in order:

| # | Command | Type | Details | Description |
|---|---------|------|---------|-------------|
| 1 | Unnamed Command | Script | `setenv-vars-in-lxc.sh` | Executes the script to set environment variables in the container configuration. |

<!-- GENERATED_END:COMMANDS -->

## Capabilities

This template provides the following capabilities:

- Parsing environment variables (key=value format, one per line)
- Adding environment variables to LXC container configuration file
- Ensuring proper formatting and avoiding duplicates

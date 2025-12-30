# Map Serial Device

Map serial device to VM

**Execution Target:** ve

<!-- GENERATED_START:PARAMETERS -->
## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `usb_bus_device` | string | Yes | - | USB bus and device number in format bus:device (e.g., 1:3 for /dev/bus/usb/001/003) |
| `vm_id` | string | Yes | - | ID of the VM to which the USB device will be assigned |
| `uid` | string | No | - | Optional: UID of the user in the container who should have access to the serial device. If provided, permissions will be set on the host device (mapped UID = container UID + 100000). ⚙️ Advanced |
| `gid` | string | No | - | Optional: GID of the group in the container who should have access to the serial device. If provided, permissions will be set on the host device (mapped GID = container GID + 100000). ⚙️ Advanced |
| `container_device_path` | string | No | - | Optional: Container device path (default: /dev/ttyUSB0). The device will always be available at this path in the container, regardless of the host device path. ⚙️ Advanced |

<!-- GENERATED_END:PARAMETERS -->

<!-- GENERATED_START:COMMANDS -->
## Commands

This template executes the following commands in order:

| # | Command | Type | Details | Description |
|---|---------|------|---------|-------------|
| 1 | Map Serial Device | Script | `map-serial-device.sh` (library: `usb-device-common.sh`) | - |

<!-- GENERATED_END:COMMANDS -->

## Capabilities

This template provides the following capabilities:

- Validating and parsing USB bus:device parameters
- Finding and validating the tty device on the host
- Updating LXC container configuration with device mapping
- Creating udev rules for automatic device handling on replug
- Installing replug handler script for automatic remapping
- Setting proper permissions and ownership

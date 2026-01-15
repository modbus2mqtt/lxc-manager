# Map Serial Device (Modbus2Mqtt)

Diese Variante ist für Modbus2Mqtt gedacht und macht `host_device_path` **verpflichtend**, damit das UI den Serial-Port immer abfragt.

## USB Serial Port

Wähle den Host-Serial-Port (stabiler Pfad, typischerweise unter `/dev/serial/by-id/...`).

## Live Replug (Host-Installation)

Wenn aktiviert, wird auf dem Proxmox-Host ein udev+systemd Replug-Mechanismus installiert, damit ein kurzes Abziehen/Einstecken ohne Container-Restart wieder funktioniert.

## ID of the VM

CT-ID des Ziel-Containers (Proxmox LXC-ID).

## UID

UID **im Container**, dem das Device gehören soll (Standard: `0`).

## GID

GID **im Container**, dem das Device gehören soll (Standard: `20`).

## Mapped UID (Host)

Optional: explizite Host-UID (numerisch) für unprivilegierte Container.

## Mapped GID (Host)

Optional: explizite Host-GID (numerisch) für unprivilegierte Container.

## Container Device Path

Zielpfad im Container (Standard: `/dev/ttyUSB0`).

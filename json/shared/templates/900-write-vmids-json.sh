{
    "$schema": "file:/Users/volkmar/proxmox2/schemas/template.schema.json",
    "execute_on": "proxmox",
    "name": "Write VM IDs JSON",
    "description": "Writes all LXC and QEMU VM IDs as a JSON array to stdout",
    "outputs": [
        "used_vm_ids"
    ],
    "commands": [
            {
                "type": "script",
                "name": "Write VM IDs JSON",
                "execute": "write-vmids-json.sh"
            }
    ]
}
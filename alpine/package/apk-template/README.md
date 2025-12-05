APK Template

This directory contains a generic template to scaffold new Alpine APK package directories for Node-based services.

- Template files with placeholders:
  - `APKBUILD.in`: package metadata and build/prepare/package steps
  - `files/service.initd.in`, `files/service.confd.in`: OpenRC service/config
  - `files/pre-install.in`, `files/post-install.in`: install scripts
- Placeholders:
  - `@PKGNAME@`, `@PKGVER@`, `@PKGREL@`, `@PKGDESC@`, `@URL@`, `@LICENSE@`, `@NPMPACKAGE@`
  - `@POST_INSTALL_EXTRA@` for optional per-package post-install commands

Generate a package directory:
```sh
cd alpine/package
./generate-ap.sh <pkgname> <pkgname>.ini
```

INI keys:
- `pkgname`, `pkgver`, `pkgrel`, `pkgdesc`, `url`, `license`
- `depends`, `makedepends`
- `npmpackage` (npm package to install)
- `app_dirs` (space-separated list of dirs to create, e.g. `/config /data /ssl`)
- `app_dirs_owner` (owner for `chown -R`, defaults to `<pkgname>:dialout`)

Notes:
- OpenSSH setup in `post-install` is optional and only runs if `sshd` is present.
- Native module rebuild uses `common/node-build.sh` to compile for target arch.
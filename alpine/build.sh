#!/bin/sh
set -eu

# test-build.sh
# Local testing script for package.sh and docker/build.sh
# This script validates the modular build components locally before CI/CD

echo "=== Local Build Test ==="
echo "Testing modular build components..."

# Get script path and source utilities
script_path="$(readlink -f "$0")"
script_dir="$(dirname "$script_path")"

# shellcheck source=./arch-utils.sh
. "$script_dir/arch-utils.sh"
find_repo_root "$script_path"

echo "Repository root: $REPO_ROOT"
cd "$REPO_ROOT"

# Check required environment variables
if [ -z "${PACKAGER_PRIVKEY:-}" ]; then
    echo "ERROR: PACKAGER_PRIVKEY environment variable must be set" >&2
    echo "This must contain the private APK signing key contents (PEM)" >&2
    exit 1
fi

echo ""
echo "=== Step 1: Testing APK Package Build (generic) ==="
PKG_BASE="alpine/package"
GENERATOR="$PKG_BASE/generate-ap.sh"

# Generate package directories from INI files if generator exists
if [ -x "$GENERATOR" ]; then
    echo "Running generate-ap.sh for all INI files..."
    find "$PKG_BASE" -maxdepth 1 -type f -name "*.ini" | while read -r ini; do
        pkg="$(basename "$ini" .ini)"
        echo "  -> Generating package dir for $pkg"
        (cd "$PKG_BASE" && ./generate-ap.sh "$pkg" "$pkg.ini")
    done
fi

echo "Building APKs inside Docker (Alpine) because abuild isn't supported on macOS..."
status=0

# Clean local repo to avoid mixing packages signed with different keys
REPO_DIR="$REPO_ROOT/alpine/repo"
echo "Cleaning local APK repo at $REPO_DIR to avoid signature mismatches..."
rm -rf "$REPO_DIR" 2>/dev/null || true
mkdir -p "$REPO_DIR"

# Optional: build only specific packages via BUILD_ONLY (space-separated)
BUILD_ONLY="${BUILD_ONLY:-}"

# Build only packages that have an .ini file
for ini in "$PKG_BASE"/*.ini; do
    [ -f "$ini" ] || continue
    pkg="$(basename "$ini" .ini)"

    # Filter by BUILD_ONLY if set
    if [ -n "$BUILD_ONLY" ]; then
        echo "$BUILD_ONLY" | grep -qw "$pkg" || continue
    fi

    # Ensure package directory exists after generation
    if [ ! -d "$PKG_BASE/$pkg" ]; then
        echo "Skipping $pkg: generated package directory not found"
        continue
    fi
    if [ ! -f "$PKG_BASE/$pkg/APKBUILD" ]; then
        echo "Skipping $pkg: no APKBUILD found after generation"
        continue
    fi

    echo "--- Building $pkg in container ---"
    docker run --rm \
        -e PACKAGER_PRIVKEY \
        -v "$REPO_ROOT":"/work" \
        -w "/work/$PKG_BASE/$pkg" \
        alpine:3.19 sh -lc '
            set -e
            apk add --no-cache alpine-sdk abuild sudo shadow bash git nodejs npm rsync python3 py3-psutil make build-base linux-headers udev openssl
            adduser -D build && addgroup build abuild
            # Write provided private key into abuild key path
            mkdir -p /home/build/.abuild
            umask 077
            printf "%s" "$PACKAGER_PRIVKEY" > /home/build/.abuild/privkey.rsa
            chmod 600 /home/build/.abuild/privkey.rsa
            # Generate public key required by abuild-sign
            openssl rsa -in /home/build/.abuild/privkey.rsa -pubout -out /home/build/.abuild/privkey.rsa.pub 2>/dev/null
            chmod 644 /home/build/.abuild/privkey.rsa.pub || true
            # Trust the public key for indexing: install into /etc/apk/keys
            mkdir -p /etc/apk/keys
            cp /home/build/.abuild/privkey.rsa.pub /etc/apk/keys/packager.rsa.pub
            # Also place a copy in the repo for convenience
            mkdir -p /work/alpine/repo
            cp /home/build/.abuild/privkey.rsa.pub /work/alpine/repo/packager.rsa.pub
            # Configure abuild
            echo "PACKAGER_PRIVKEY=/home/build/.abuild/privkey.rsa" > /home/build/.abuild/abuild.conf
            echo "REPODEST=/work/alpine/repo" >> /home/build/.abuild/abuild.conf
            chown -R build:build /home/build
            # abuild expects keys in /home/build/.abuild
            su build -c "abuild checksum"
            su build -c "abuild -r"
        ' || status=1
done

if [ "$status" -ne 0 ]; then
    echo "ERROR: One or more APK builds failed" >&2
    exit 1
else
    echo "=== All APK builds completed successfully ==="
fi

#!/bin/sh
# Fly mounts the volume at GOG_HOME (/data) owned by root, but the server runs
# as the non-root `app` user and gog must WRITE there (it caches refreshed
# access tokens next to its refresh token). Fix ownership at boot, then drop
# privileges. Runs as root only for this chown, never for the server itself.
set -e

DATA_DIR="${GOG_HOME:-/data}"
if [ -d "$DATA_DIR" ]; then
  chown -R app:app "$DATA_DIR" 2>/dev/null || true
fi

exec gosu app "$@"

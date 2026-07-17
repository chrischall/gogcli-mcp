#!/usr/bin/env bash
# Seed the Fly gog-runner's volume with your Google auth so the headless `gog`
# on the box can call Google APIs. Run ONCE after `fly deploy`.
#
# It is secret-free: it reads your refresh token from your LOCAL gog keyring
# (e.g. the macOS Keychain) and relies on the GOG_KEYRING_PASSWORD secret that
# is already injected into the Machine's env. Nothing sensitive is written into
# this script or committed.
#
# Two things get seeded onto the volume (GOG_HOME=/data):
#   1. credentials.json (your OAuth client) -> /data/data/credentials.json
#      (under a custom GOG_HOME, gog nests its config in a `data/` subdir).
#   2. the refresh token -> imported into the encrypted FILE keyring on /data
#      (the box sets GOG_KEYRING_BACKEND=file; the macOS Keychain isn't portable).
#
# Usage:
#   APP=gogcli-gog-runner EMAIL=you@gmail.com ./seed-auth.sh
#
# Env:
#   APP    Fly app name              (default: gogcli-gog-runner)
#   EMAIL  Google account to seed    (required)
#   CREDS  path to gog credentials.json on THIS machine
#          (default: macOS "$HOME/Library/Application Support/gogcli/credentials.json")
set -euo pipefail

APP="${APP:-gogcli-gog-runner}"
EMAIL="${EMAIL:?set EMAIL=<the google account to seed, e.g. you@gmail.com>}"
CREDS="${CREDS:-$HOME/Library/Application Support/gogcli/credentials.json}"

[ -f "$CREDS" ] || { echo "!! credentials.json not found at: $CREDS (set CREDS=...)"; exit 1; }

TOK="$(mktemp)"
trap 'rm -f "$TOK"' EXIT

echo "0/6  Wake the Machine via HTTP (the Fly edge proxy auto-starts a stopped VM; fly ssh can't reach a stopped one)"
for i in $(seq 1 6); do
  if curl -fsS --max-time 30 "https://$APP.fly.dev/healthz" >/dev/null 2>&1; then echo "   awake"; break; fi
  sleep 3
done
sleep 3

echo "1/6  Export the refresh token from the local gog keyring -> temp file"
gog auth tokens export "$EMAIL" --out "$TOK" --overwrite

echo "2/6  Copy credentials.json (gog's flat OAuth-client file) to the path gog reads under GOG_HOME (/data/data)"
CREDS_B64="$(base64 < "$CREDS" | tr -d '\n')"
fly ssh console -a "$APP" -C "/bin/sh -c 'mkdir -p /data/data && echo $CREDS_B64 | base64 -d > /data/data/credentials.json'"

echo "3/6  Push the token and import it into the encrypted file keyring on the volume"
TOK_B64="$(base64 < "$TOK" | tr -d '\n')"
fly ssh console -a "$APP" -C "/bin/sh -c 'echo $TOK_B64 | base64 -d > /tmp/tok.json && GOG_HOME=/data GOG_KEYRING_BACKEND=file gog auth tokens import /tmp/tok.json && rm -f /tmp/tok.json'"

echo "4/6  Fix ownership so the non-root server can read the seeded files"
fly ssh console -a "$APP" -C "/bin/sh -c 'chown -R app:app /data'"

echo "5/6  Verify the account is present on the box"
fly ssh console -a "$APP" -C "/bin/sh -c 'GOG_HOME=/data GOG_KEYRING_BACKEND=file gog auth list'"

echo "6/6  Restart the Machine so the server picks up the seeded auth"
fly apps restart "$APP"

echo
echo "Done. Local token export deleted. Verify a live call:"
echo "  curl -sS -X POST https://$APP.fly.dev/run \\"
echo "    -H \"Authorization: Bearer \$RUNNER_KEY\" -H 'Content-Type: application/json' \\"
echo "    -d '{\"args\":[\"drive\",\"ls\",\"--max=2\"]}'"

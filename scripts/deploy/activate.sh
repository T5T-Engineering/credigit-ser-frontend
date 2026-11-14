#!/usr/bin/env bash
# Runs ON THE TARGET HOST (copied there by .github/workflows/deploy.yml).
#   activate.sh <deploy_path> <release_id> <pm2_env>
# Layout under <deploy_path>:
#   incoming/<release>.tar.gz                 (uploaded by CI, consumed here)
#   releases/<release>/                       (out/, runtime/ with `serve`, pm2.config.json, serve.json)
#   current -> releases/<release>             (PM2 runs from here)
# Unpacks the release, switches `current`, `pm2 startOrReload pm2.config.json --env <env> --update-env`, waits until
# /release.json reports this release, then `pm2 save`. On failure it switches back to the previous release.
# Tunables (env): KEEP_RELEASES (5), HEALTH_RETRIES (30), HEALTH_INTERVAL_SECONDS (2), HEALTH_HOST (127.0.0.1).
set -euo pipefail

DEPLOY_PATH="${1:?deploy path}"
RELEASE="${2:?release id}"
PM2_ENV="${3:?pm2 env}"
KEEP="${KEEP_RELEASES:-5}"
RETRIES="${HEALTH_RETRIES:-30}"
INTERVAL="${HEALTH_INTERVAL_SECONDS:-2}"
HOST="${HEALTH_HOST:-127.0.0.1}"

INCOMING="$DEPLOY_PATH/incoming"
RELEASES="$DEPLOY_PATH/releases"
CURRENT="$DEPLOY_PATH/current"
REL="$RELEASES/$RELEASE"

command -v pm2 >/dev/null || { echo "pm2 not found on PATH (see README first-time host setup)" >&2; exit 1; }
command -v node >/dev/null || { echo "node not found on PATH" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl not found on PATH" >&2; exit 1; }

umask 022
mkdir -p "$RELEASES"
rm -rf "$REL"
mkdir -p "$REL"
tar -xzf "$INCOMING/$RELEASE.tar.gz" -C "$REL"
rm -f "$INCOMING/$RELEASE.tar.gz"

PREV=""
if [ -L "$CURRENT" ]; then PREV="$(readlink -f "$CURRENT")"; fi

# The listen port of an environment, read from the release's pm2.config.json (env_<env>.PORT, else env.PORT).
port_of() {
  node -e '
    const cfg = require(process.argv[1]); const app = cfg.apps[0]; const env = process.argv[2];
    process.stdout.write(String((app["env_" + env] && app["env_" + env].PORT) || (app.env && app.env.PORT) || ""));' "$1/pm2.config.json" "$PM2_ENV"
}

switch_to() {
  ln -sfn "$1" "$CURRENT.tmp"
  mv -Tf "$CURRENT.tmp" "$CURRENT"
}

reload() {
  # Relative paths in pm2.config.json (cwd, script, args) resolve from the release directory.
  (cd "$CURRENT" && pm2 startOrReload pm2.config.json --env "$PM2_ENV" --update-env)
}

healthy() {
  local dir="$1" release port i
  release="$(basename "$dir")"
  port="$(port_of "$dir")"
  [ -n "$port" ] || { echo "No PORT for env '$PM2_ENV' in $dir/pm2.config.json" >&2; return 1; }
  for i in $(seq 1 "$RETRIES"); do
    if curl -fsS --max-time 5 "http://$HOST:$port/release.json" 2>/dev/null | grep -q "\"release\":\"$release\"" &&
       curl -fsS --max-time 5 -o /dev/null "http://$HOST:$port/"; then
      return 0
    fi
    sleep "$INTERVAL"
  done
  return 1
}

switch_to "$REL"
if reload && healthy "$REL"; then
  pm2 save
  # Keep the newest $KEEP releases (never the active one).
  ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
    [ "$(readlink -f "$old")" = "$(readlink -f "$CURRENT")" ] || rm -rf "$old"
  done
  rm -f "$0"
  echo "Release $RELEASE is live ($PM2_ENV)."
  exit 0
fi

echo "Release $RELEASE failed its health check." >&2
if [ -n "$PREV" ] && [ "$PREV" != "$REL" ] && [ -d "$PREV" ]; then
  switch_to "$PREV"
  if reload && healthy "$PREV"; then
    echo "Rolled back to $(basename "$PREV")." >&2
  else
    echo "ROLLBACK ALSO FAILED — manual intervention required." >&2
  fi
fi
exit 1

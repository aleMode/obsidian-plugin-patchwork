#!/bin/sh
# Start the Flatpak Obsidian on ./test-vault with remote debugging (port 9222) and an isolated
# profile in .dev/obsidian-profile, so personal vaults and settings are never touched.
# Drive it with scripts/cdp.mjs. From inside a toolbox/container, this goes through flatpak-spawn.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PROFILE="$ROOT/.dev/obsidian-profile"
mkdir -p "$PROFILE"
if [ ! -f "$PROFILE/obsidian.json" ]; then
	printf '{"vaults":{"patchworktestvault":{"path":"%s/test-vault","ts":1,"open":true}}}\n' "$ROOT" > "$PROFILE/obsidian.json"
fi
# The background flags keep rendering (requestAnimationFrame) running when the window is covered or on
# another workspace, so automated runs don't stall while you use other windows.
CMD="flatpak run md.obsidian.Obsidian --user-data-dir=$PROFILE --remote-debugging-port=${CDP_PORT:-9222} --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling"
if command -v flatpak >/dev/null 2>&1; then
	nohup $CMD > "$ROOT/.dev/obsidian.log" 2>&1 &
else
	flatpak-spawn --host sh -c "nohup $CMD > '$ROOT/.dev/obsidian.log' 2>&1 &"
fi
echo "Obsidian starting; debugging on http://127.0.0.1:${CDP_PORT:-9222}"

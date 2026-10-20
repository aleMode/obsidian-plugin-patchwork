# Windows counterpart of launchObsidian.sh: start the installed Obsidian on ./test-vault with remote
# debugging (port 9222) and an isolated profile in .dev/obsidian-profile, so personal vaults and
# settings are never touched. Drive it with scripts/cdp.mjs.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$profileDir = Join-Path $root '.dev\obsidian-profile'
$port = if ($env:CDP_PORT) { $env:CDP_PORT } else { '9222' }
$exe = Join-Path $env:LOCALAPPDATA 'Programs\Obsidian\Obsidian.exe'
if (-not (Test-Path $exe)) { throw "Obsidian not found at $exe" }

New-Item -ItemType Directory -Force $profileDir | Out-Null
$cfg = Join-Path $profileDir 'obsidian.json'
if (-not (Test-Path $cfg)) {
	$vault = (Join-Path $root 'test-vault') -replace '\\', '/'
	Set-Content -Path $cfg -Encoding ascii -Value ('{"vaults":{"patchworktestvault":{"path":"' + $vault + '","ts":1,"open":true}}}')
}

# The background flags keep rendering running when the window is covered, so automated runs don't stall.
Start-Process $exe -ArgumentList @(
	"--user-data-dir=`"$profileDir`"", "--remote-debugging-port=$port",
	'--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling')
Write-Host "Obsidian starting; debugging on http://127.0.0.1:$port"

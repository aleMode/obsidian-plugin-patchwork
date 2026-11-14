// Run every end-to-end suite against the dev Obsidian (scripts/launchObsidian.sh) and fail on any
// failed check. In-page suites (*.js) are evaluated inside Obsidian; *.mjs suites drive real input.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from '../cdpClient.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];
const suites = readdirSync(dir).filter((f) => f !== 'run.mjs' && /\.(m?js)$/.test(f) && (!only || f.startsWith(only))).sort();

// Load the latest dev build before testing, in a window of the size the suites were written for:
// several checks depend on layout (what fits on screen, where panels sit) and fail at 1024 × 800.
// Electron allows a window larger than the screen; mouse input goes through CDP, so it still works.
// E2E_KEEP_WINDOW=1 leaves the window as it is.
const SIZE = [1920, 1040];
const cdp = await connect();
await cdp.evaluate(`await app.plugins.disablePlugin('patchwork'); await app.plugins.enablePluginAndSave('patchwork');`);
const before = process.env.E2E_KEEP_WINDOW ? null : await cdp.evaluate(`
	const w = require('@electron/remote').getCurrentWindow();
	const was = { bounds: w.getBounds(), maximized: w.isMaximized() };
	if (was.maximized) w.unmaximize();
	w.setContentSize(${SIZE[0]}, ${SIZE[1]});
	await new Promise((r) => setTimeout(r, 500));
	return was;`);
cdp.close();

let failed = 0;
for (const suite of suites) {
	let report;
	if (suite.endsWith('.mjs')) {
		try {
			report = JSON.parse(execFileSync('node', [join(dir, suite)], { encoding: 'utf8' }));
		} catch (e) {
			report = JSON.parse(e.stdout || '{"passed":0,"failed":[{"name":"suite crashed"}]}');
		}
	} else {
		const c = await connect();
		report = await c.evaluate(readFileSync(join(dir, suite), 'utf8'));
		c.close();
	}
	failed += report.failed.length;
	console.log(`${report.failed.length ? 'FAIL' : 'ok  '} ${suite}: ${report.passed} passed, ${report.failed.length} failed`);
	for (const f of report.failed) console.log(`     ✗ ${f.name}${f.detail ? `: ${JSON.stringify(f.detail)}` : ''}`);
}
if (before) {
	const c = await connect();
	await c.evaluate(`const w = require('@electron/remote').getCurrentWindow(); w.setBounds(${JSON.stringify(before.bounds)}); if (${before.maximized}) w.maximize();`);
	c.close();
}
process.exitCode = failed ? 1 : 0;

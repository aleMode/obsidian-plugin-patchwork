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

// Load the latest dev build before testing.
const cdp = await connect();
await cdp.evaluate(`await app.plugins.disablePlugin('patchwork'); await app.plugins.enablePlugin('patchwork');`);
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
process.exitCode = failed ? 1 : 0;

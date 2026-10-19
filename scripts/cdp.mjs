// Evaluate JavaScript inside a running Obsidian (started with scripts/launchObsidian.sh)
// and print the JSON result. Used to drive spikes and QA without clicking.
//
//   node scripts/cdp.mjs 'app.vault.getName()'
//   node scripts/cdp.mjs -f some-script.js        (script body may use `await` and `return`)
//   node scripts/cdp.mjs --shot out.png [expr]    (evaluate, then save a screenshot of the window)
//
// Env: CDP_PORT (default 9222), CDP_TITLE (substring of the window title, default "test-vault").
import { readFileSync } from 'node:fs';
import { connect } from './cdpClient.mjs';

const args = process.argv.slice(2);
let shotPath = null;
if (args[0] === '--shot') {
	shotPath = args[1];
	args.splice(0, 2);
}
const fromFile = args[0] === '-f';
const source = fromFile ? readFileSync(args[1], 'utf8') : args.join(' ');
if (!source && !shotPath) {
	console.error('usage: cdp.mjs [--shot file.png] <expression> | -f <file>');
	process.exit(2);
}

const cdp = await connect();
try {
	const value = source ? await cdp.evaluate(fromFile ? source : `return (${source});`) : null;
	if (shotPath) {
		await cdp.screenshot(shotPath);
		console.error(`screenshot: ${shotPath}`);
	}
	console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
} catch (e) {
	console.error('Exception:', e.message);
	process.exitCode = 1;
} finally {
	cdp.close();
}

// Evaluate JavaScript inside a running Obsidian (started with --remote-debugging-port)
// and print the JSON result. Used to drive spikes and QA without clicking.
//
//   node scripts/cdp.mjs 'app.vault.getName()'
//   node scripts/cdp.mjs -f some-script.js        (script body may use `await`)
//   node scripts/cdp.mjs --shot out.png [expr]    (evaluate, then save a screenshot of the window)
//
// Env: CDP_PORT (default 9222), CDP_TITLE (substring of the window title, default "test-vault").
import { readFileSync, writeFileSync } from 'node:fs';

const port = process.env.CDP_PORT ?? '9222';
const titleMatch = process.env.CDP_TITLE ?? 'test-vault';

const args = process.argv.slice(2);
let shotPath = null;
if (args[0] === '--shot') {
	shotPath = args[1];
	args.splice(0, 2);
}
const source = args[0] === '-f' ? readFileSync(args[1], 'utf8') : args.join(' ') || (shotPath ? 'null' : '');
if (!source) {
	console.error('usage: cdp.mjs <expression> | -f <file>');
	process.exit(2);
}

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
// Popout windows (e.g. Settings) are about:blank pages; the main window serves index.html.
const target = targets.find((t) => t.type === 'page' && t.url.startsWith('app://obsidian.md/') && t.title.includes(titleMatch));
if (!target) {
	console.error(`No Obsidian window with "${titleMatch}" in its title. Targets:`, targets.map((t) => t.title));
	process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	ws.onopen = resolve;
	ws.onerror = reject;
});

let nextId = 1;
const pending = new Map();
ws.onmessage = (ev) => {
	const msg = JSON.parse(ev.data);
	if (msg.id && pending.has(msg.id)) {
		pending.get(msg.id)(msg);
		pending.delete(msg.id);
	}
};
const send = (method, params) =>
	new Promise((resolve) => {
		const id = nextId++;
		pending.set(id, resolve);
		ws.send(JSON.stringify({ id, method, params }));
	});

// Wrapping in an async IIFE lets scripts use top-level await and `return`.
const expression = `(async () => { ${args[0] === '-f' ? source : `return (${source});`} })()`;
const res = await send('Runtime.evaluate', {
	expression,
	awaitPromise: true,
	returnByValue: true,
	userGesture: true,
	timeout: 120000,
});
if (shotPath) {
	const shot = await send('Page.captureScreenshot', { format: 'png' });
	writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'));
	console.error(`screenshot: ${shotPath}`);
}
ws.close();

if (res.result?.exceptionDetails) {
	const ex = res.result.exceptionDetails;
	console.error('Exception:', ex.exception?.description ?? ex.text);
	process.exit(1);
}
const value = res.result?.result?.value;
console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));

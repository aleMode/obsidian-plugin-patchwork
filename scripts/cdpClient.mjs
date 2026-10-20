// Minimal Chrome DevTools Protocol client for the Obsidian dev instance (scripts/launchObsidian.sh).
// Used by cdp.mjs and the e2e scripts that need real mouse/keyboard input.

export async function connect({ port = process.env.CDP_PORT ?? '9222', title = process.env.CDP_TITLE ?? 'test-vault' } = {}) {
	const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
	// Popout windows (e.g. Settings) are about:blank pages; the main window serves index.html.
	const target = targets.find((t) => t.type === 'page' && t.url.startsWith('app://obsidian.md/') && t.title.includes(title));
	if (!target) throw new Error(`No Obsidian window with "${title}" in its title. Targets: ${targets.map((t) => t.title).join(', ')}`);

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
	const send = (method, params = {}) =>
		new Promise((resolve) => {
			const id = nextId++;
			pending.set(id, resolve);
			ws.send(JSON.stringify({ id, method, params }));
		});

	// A minimised or fully covered window reports visibilityState "hidden": no animation frames, and pointer
	// drags then stall. Tell the page it is active and focused for as long as this session is attached.
	await send('Page.setWebLifecycleState', { state: 'active' });
	await send('Emulation.setFocusEmulationEnabled', { enabled: true });

	/** Evaluate an async function body in the page; returns its value or throws the page's exception. */
	async function evaluate(body) {
		const res = await send('Runtime.evaluate', {
			expression: `(async () => { ${body} })()`,
			awaitPromise: true,
			returnByValue: true,
			userGesture: true,
			timeout: 120000,
		});
		const ex = res.result?.exceptionDetails;
		if (ex) throw new Error(ex.exception?.description ?? ex.text);
		return res.result?.result?.value;
	}

	const mouse = (type, x, y, extra = {}) =>
		send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1, ...extra });

	async function drag(from, to, { steps = 8, modifiers = 0 } = {}) {
		await mouse('mouseMoved', from.x, from.y, { button: 'none', modifiers });
		await mouse('mousePressed', from.x, from.y, { modifiers });
		for (let i = 1; i <= steps; i++) {
			const t = i / steps;
			await mouse('mouseMoved', from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, { buttons: 1, modifiers });
		}
		await mouse('mouseReleased', to.x, to.y, { modifiers });
	}

	const wheel = (x, y, deltaY, modifiers = 0) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY, modifiers });

	async function key(key, code, modifiers = 0) {
		await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, modifiers, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 });
		await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
	}

	/**
	 * Save a screenshot. A minimised window produces no compositor frames, so the capture can wait
	 * forever; after a few seconds it is skipped (returns false) instead of hanging the caller.
	 */
	async function screenshot(path, waitMs = 8000) {
		const { writeFileSync } = await import('node:fs');
		const shot = await Promise.race([send('Page.captureScreenshot', { format: 'png' }), new Promise((r) => setTimeout(() => r(null), waitMs))]);
		if (!shot?.result?.data) return false;
		writeFileSync(path, Buffer.from(shot.result.data, 'base64'));
		return true;
	}

	return { send, evaluate, mouse, drag, wheel, key, screenshot, close: () => ws.close() };
}

export const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

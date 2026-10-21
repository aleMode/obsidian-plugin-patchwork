// End-to-end check of zoom controls: the +/- buttons step through the stops, the zoom label resets to
// 100 %, and a mouse notch zooms by 10 % while small (trackpad) deltas stay proportional.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const vault = app.vault;
const plugin = app.plugins.plugins.patchwork;
const DIR = '_e2e';
const d = vault.getAbstractFileByPath(DIR);
if (d) await vault.delete(d, true);
await vault.createFolder(DIR);
try {
	const file = await plugin.createBoard(vault.getAbstractFileByPath(DIR));
	await sleep(300);
	const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === file);
	app.workspace.setActiveLeaf(view.leaf, { focus: true });
	const bar = view.contentEl.querySelector('.pw-toolbar');
	const label = bar.querySelector('.pw-zoom-label');
	const zoom = () => view.surface.camera.zoom;
	const set = async (z) => {
		view.surface.setCamera({ ...view.surface.camera, zoom: z });
		await sleep(150);
	};
	const click = async (el) => {
		el.click();
		await sleep(150);
	};
	const wheel = async (deltaY) => {
		const r = view.contentEl.querySelector('.pw-board').getBoundingClientRect();
		view.contentEl.querySelector('.pw-board').dispatchEvent(new WheelEvent('wheel', { deltaY, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
		await sleep(150);
	};
	const zin = bar.querySelector('[aria-label="Zoom in"]');
	const zout = bar.querySelector('[aria-label="Zoom out"]');

	check('the zoom label is a button that says what it does', label.tagName === 'BUTTON' && label.getAttribute('aria-label') === 'Reset to 100%', [label.tagName, label.getAttribute('aria-label')]);

	await set(1);
	await click(zin);
	check('+ from 100 % goes to 125 %', zoom() === 1.25, zoom());
	check('the label shows it', label.textContent === '125%', label.textContent);
	await click(zin);
	await click(zin);
	check('+ twice more: 150 %, 200 %', zoom() === 2, zoom());
	await click(zout);
	check('- from 200 % goes to 150 %', zoom() === 1.5, zoom());

	await set(0.67);
	await click(zin);
	check('+ from 67 % goes to the next stop, 75 %', zoom() === 0.75, zoom());
	await set(0.67);
	await click(zout);
	check('- from 67 % goes to 50 %', zoom() === 0.5, zoom());

	await set(0.03);
	await click(zout);
	check('- below the lowest stop stops at the 2 % limit', zoom() === 0.02, zoom());
	await set(7);
	await click(zin);
	check('+ below the top goes to the 800 % limit', zoom() === 8, zoom());

	const vp = view.surface.viewportSize();
	const centre = { x: vp.w / 2, y: vp.h / 2 };
	const boardAt = (c, p) => ({ x: (p.x - c.tx) / c.zoom, y: (p.y - c.ty) / c.zoom });
	await set(0.67);
	const before = boardAt(view.surface.camera, centre);
	await click(label);
	check('clicking the label goes to exactly 100 %', zoom() === 1, zoom());
	check('the label reads 100%', label.textContent === '100%', label.textContent);
	const after = boardAt(view.surface.camera, centre);
	check('about the centre of the view (the board point there stays put)', Math.abs(before.x - after.x) < 0.01 && Math.abs(before.y - after.y) < 0.01, [before, after]);

	await set(1);
	await wheel(-100);
	check('a mouse notch zooms in by 10 %', Math.abs(zoom() - 1.1) < 1e-9, zoom());
	await wheel(100);
	check('and back out by the same notch', Math.abs(zoom() - 1) < 1e-9, zoom());
	await wheel(-240);
	check('a fast notch (240) is still capped at 10 %', Math.abs(zoom() - 1.1) < 1e-9, zoom());
	await set(1);
	await wheel(-10);
	check('a small pinch delta stays proportional', Math.abs(zoom() - Math.exp(0.02)) < 1e-9, zoom());
} catch (e) {
	check('no exception', false, String(e?.stack ?? e));
} finally {
	document.querySelectorAll('.notice').forEach((n) => n.remove());
	app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
	await sleep(400);
	const dir = vault.getAbstractFileByPath(DIR);
	if (dir) await vault.delete(dir, true);
}
return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };

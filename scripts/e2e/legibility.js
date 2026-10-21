// End-to-end check of the small-text legibility ramp (styles.css, "Small text on screen"): below 100 % zoom
// note text gets more contrast and a hairline stroke, away from the background on dark and light paper, with
// no layout change and nothing outside the board layer (exports) touched.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const vault = app.vault;
const plugin = app.plugins.plugins.patchwork;
const DIR = '_e2e';
const d = vault.getAbstractFileByPath(DIR);
if (d) await vault.delete(d, true);
await vault.createFolder(DIR);

// Canvas normalises any CSS colour (oklch included) to RGB, so lightness can be compared across notations.
const c2d = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
const lum = (css) => {
	c2d.clearRect(0, 0, 1, 1);
	c2d.fillStyle = css;
	c2d.fillRect(0, 0, 1, 1);
	const [r, g, b] = c2d.getImageData(0, 0, 1, 1).data;
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const stroke = (el) => parseFloat(getComputedStyle(el).webkitTextStrokeWidth);

try {
	const file = await plugin.createBoard(vault.getAbstractFileByPath(DIR));
	await sleep(300);
	const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === file);
	const note = (id, x, style) => ({ id, type: 'note', file: 'Rules/Combat.md', x, y: 10, w: 90, h: 120, ...(style ? { style } : {}) });
	const setBoard = (dark) =>
		view.store.update((f) => ({
			...f,
			board: { ...f.board, useAppTheme: dark },
			pages: [{ ...f.pages[0], background: dark ? '#2f2f2f' : undefined, modules: [note('plain', 10), note('coloured', 110, { color: '#223344' })] }],
		}));
	const el = (id) => view.contentEl.querySelector(`.pw-module[data-module-id="${id}"] .pw-markdown p`);
	const zoomTo = async (zoom) => {
		view.surface.setCamera({ zoom, tx: 100, ty: 100 });
		await sleep(700); // the zoom settles after 150 ms, then the layer is re-rastered
	};
	const until = async (fn, ms = 6000) => {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			if (fn()) return true;
			await sleep(100);
		}
		return false;
	};

	setBoard(true);
	check('notes render', await until(() => el('plain') && el('coloured')));
	const darkApp = document.body.classList.contains('theme-dark');

	await zoomTo(1);
	const h100 = el('plain').closest('.pw-markdown').offsetHeight;
	check('at 100 % no stroke', stroke(el('plain')) === 0, stroke(el('plain')));
	const base = lum(getComputedStyle(view.contentEl.querySelector('.pw-page-paper')).color);
	check('at 100 % the colour is the theme colour', Math.abs(lum(getComputedStyle(el('plain')).color) - base) < 2, [lum(getComputedStyle(el('plain')).color), base]);

	await zoomTo(0.6);
	const s60 = stroke(el('plain'));
	check('at 60 % a hairline stroke (about 0.2 px)', s60 > 0.1 && s60 < 0.4, s60);
	if (darkApp) check('dark paper: text gets lighter', lum(getComputedStyle(el('plain')).color) > base + 10, [lum(getComputedStyle(el('plain')).color), base]);
	check('layout is unchanged (same wrapped height)', el('plain').closest('.pw-markdown').offsetHeight === h100, [el('plain').closest('.pw-markdown').offsetHeight, h100]);
	check('a text colour set on the module is kept, pushed further the way it leans', lum(getComputedStyle(el('coloured')).color) <= lum('#223344') + 1, lum(getComputedStyle(el('coloured')).color));

	await zoomTo(0.4);
	// Full boost from 50 % down: 0.15 px on screen is 0.15 / 0.4 in the layer's own pixels.
	check('at 40 % the boost is at full strength', Math.abs(stroke(el('plain')) - 0.15 / 0.4) < 0.02, stroke(el('plain')));

	setBoard(false);
	await sleep(500);
	await zoomTo(0.6);
	const baseLight = lum(getComputedStyle(view.contentEl.querySelector('.pw-page-paper')).color);
	check('light paper: text gets darker', lum(getComputedStyle(el('plain')).color) < baseLight - 10, [lum(getComputedStyle(el('plain')).color), baseLight]);

	// Exports render in .pw-print-host, outside the board layer, so the rule must not reach them.
	const host = document.body.createDiv({ cls: 'pw-print-host' });
	const m = host.createDiv({ cls: 'pw-module' }).createDiv({ cls: 'pw-module-body' });
	m.setText('export text');
	check('outside the board layer nothing changes (exports)', stroke(m) === 0, stroke(m));
	host.remove();
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

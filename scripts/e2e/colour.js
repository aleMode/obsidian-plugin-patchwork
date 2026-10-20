// End-to-end check of PDF colour options (M4): invert, dark-PDF viewing, ink saver. Run inside Obsidian.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const vault = app.vault;
const plugin = app.plugins.plugins.patchwork;
const DIR = '_e2e';
const EXPORT = { format: 'pdf', pages: 'all', range: '', sheet: 'native', orientation: 'auto', overlap: 0, fitSmallPages: false, tileLabels: false, inkSaver: false, quality: 'best', dpi: 150, open: false };
const statCrop = [20 / 210, 150 / 297, 110 / 210, 230 / 297];
async function pixel(path, xMm, yMm) {
	const doc = await plugin.pdfDocs.acquire(path);
	const page = await doc.getPage(1);
	const vp = page.getViewport({ scale: 2 });
	const canvas = document.createElement('canvas');
	canvas.width = Math.ceil(vp.width);
	canvas.height = Math.ceil(vp.height);
	const ctx = canvas.getContext('2d');
	await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
	const px = Array.from(ctx.getImageData(Math.round((xMm / 25.4) * 72 * 2), Math.round((yMm / 25.4) * 72 * 2), 1, 1).data.slice(0, 3));
	plugin.pdfDocs.release(path);
	plugin.pdfDocs.invalidate(path);
	return px;
}
const d = vault.getAbstractFileByPath(DIR);
if (d) await vault.delete(d, true);
await vault.createFolder(DIR);
try {
	const file = await plugin.createBoard(vault.getAbstractFileByPath(DIR));
	await sleep(300);
	const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === file);
	view.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], modules: [
		{ id: 'plain', type: 'pdf', file: 'PDFs/Sample rulebook.pdf', page: 1, crop: statCrop, x: 10, y: 10, w: 90, h: 80 },
		{ id: 'inv', type: 'pdf', file: 'PDFs/Sample rulebook.pdf', page: 1, crop: statCrop, x: 110, y: 10, w: 90, h: 80, invert: true },
	] }] }));
	view.surface.zoomToFit();
	const canvasOf = (id) => view.contentEl.querySelector(`.pw-module[data-module-id="${id}"] canvas`);
	for (let i = 0; i < 60 && !(canvasOf('plain') && canvasOf('inv')); i++) await sleep(50);
	check('inverted module is filtered on screen', getComputedStyle(canvasOf('inv')).filter.includes('invert'));
	check('plain module is not', getComputedStyle(canvasOf('plain')).filter === 'none');

	view.store.update((f) => ({ ...f, board: { ...f.board, pdfDarkMode: true } }));
	await sleep(50);
	const dark = document.body.hasClass('theme-dark');
	check('dark-PDF viewing inverts plain modules in a dark theme', !dark || getComputedStyle(canvasOf('plain')).filter.includes('invert'), dark);
	check('…and un-inverts inverted ones', !dark || getComputedStyle(canvasOf('inv')).filter === 'none');

	await view.surface.runExport({ ...EXPORT, base: `${DIR}/normal` });
	const plainPx = await pixel(`${DIR}/normal.pdf`, 97, 50);
	const invPx = await pixel(`${DIR}/normal.pdf`, 197, 50);
	check('export: dark-PDF viewing does not affect exports', Math.abs(plainPx[0] - 245) < 10 && Math.abs(plainPx[2] - 209) < 12, plainPx);
	check('export: the inverted module prints inverted (dark)', invPx[0] + invPx[1] + invPx[2] < 200, invPx);

	await view.surface.runExport({ ...EXPORT, base: `${DIR}/ink`, inkSaver: true });
	const inkPx = await pixel(`${DIR}/ink.pdf`, 97, 50);
	check('ink saver: grayscale and lighter', Math.abs(inkPx[0] - inkPx[2]) < 6 && inkPx[0] > 235, inkPx);
} catch (e) {
	check('no exception', false, String(e?.stack ?? e));
} finally {
	document.querySelectorAll('.notice').forEach((n) => n.remove());
	app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
	await new Promise((r) => setTimeout(r, 400)); // let pending saves finish before deleting their files
	const dir = vault.getAbstractFileByPath(DIR);
	if (dir) await vault.delete(dir, true);
}
return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };

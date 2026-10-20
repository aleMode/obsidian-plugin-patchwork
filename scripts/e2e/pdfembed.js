// End-to-end check of PDF embeds inside note modules (Q9): drawn by Patchwork as a static page instead
// of Obsidian's PDF viewer (which collapsed and covered the note), and exported as vector (sharp,
// selectable) at best quality or as a picture at small quality.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const vault = app.vault;
const plugin = app.plugins.plugins.patchwork;
const DIR = '_e2e';
const until = async (fn, ms = 8000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (fn()) return true;
		await sleep(100);
	}
	return false;
};
const EXPORT = { format: 'pdf', pages: 'all', range: '', sheet: 'native', orientation: 'auto', overlap: 0, fitSmallPages: false, tileLabels: false, inkSaver: false, layout: 'single', bleed: 0, cropMarks: false, dpi: 150, open: false };
/** Text of page 1 of an exported PDF, with each item's top in mm. */
const exported = async (path) => {
	const doc = await plugin.pdfDocs.acquire(path);
	try {
		const page = await doc.getPage(1);
		const vp = page.getViewport({ scale: 1 });
		const items = (await page.getTextContent()).items.filter((it) => it.str.trim());
		return items.map((it) => ({ s: it.str, y: ((vp.height - it.transform[5]) * 25.4) / 72 }));
	} finally {
		plugin.pdfDocs.release(path);
	}
};
const d = vault.getAbstractFileByPath(DIR);
if (d) await vault.delete(d, true);
await vault.createFolder(DIR);
try {
	await vault.create(`${DIR}/Embed.md`, 'Intro line\n\n![[Sample rulebook.pdf#page=2]]\n\nAfter line\n');
	const file = await plugin.createBoard(vault.getAbstractFileByPath(DIR));
	await sleep(300);
	const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === file);
	view.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], modules: [{ id: 'n', type: 'note', file: `${DIR}/Embed.md`, x: 10, y: 10, w: 120, h: 230 }] }] }));
	view.surface.zoomToFit();
	const mod = () => view.contentEl.querySelector('.pw-module[data-module-id="n"]');
	check('the page is drawn by Patchwork', await until(() => mod()?.querySelector('.pw-pdf-embed canvas')?.width > 0));
	check('Obsidian’s PDF viewer is not mounted', !mod().querySelector('.pdf-embed'));
	const box = mod().querySelector('.pw-pdf-embed').getBoundingClientRect();
	check('the box has the page’s shape (A4 portrait)', Math.abs(box.width / box.height - 210 / 297) < 0.02, box.width / box.height);
	check('text after the embed is laid out below it', mod().innerText.includes('After line'));
	const before = mod().querySelector('.pw-pdf-embed canvas').width;
	const cam = view.surface.camera;
	view.surface.setCamera({ ...cam, zoom: cam.zoom * 3 });
	check('zooming in redraws the page sharper', await until(() => (mod()?.querySelector('.pw-pdf-embed canvas')?.width ?? 0) > before * 2), [before, mod()?.querySelector('.pw-pdf-embed canvas')?.width]);
	view.surface.zoomToFit();

	await view.surface.runExport({ ...EXPORT, base: `${DIR}/best`, quality: 'best' });
	const best = await exported(`${DIR}/best.pdf`);
	const y = (s) => best.find((it) => it.s.includes(s))?.y;
	check('best quality: the embedded page is vector (its text is selectable)', y('Chapter 2') !== undefined, best.map((it) => it.s).join('|').slice(0, 300));
	check('in its place between the note’s lines', y('Intro line') < y('Chapter 2') && y('Chapter 2') < y('After line'), [y('Intro line'), y('Chapter 2'), y('After line')]);

	await view.surface.runExport({ ...EXPORT, base: `${DIR}/small`, quality: 'small' });
	const small = await exported(`${DIR}/small.pdf`);
	check('small quality: a picture (the note’s own text stays text)', small.some((it) => it.s.includes('Intro line')) && !small.some((it) => it.s.includes('Chapter 2')), small.map((it) => it.s).join('|'));
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

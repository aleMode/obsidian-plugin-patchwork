// End-to-end check of sheet sizes, tiling, page ranges and PNG export (SPEC 9.2), run inside Obsidian.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const vault = app.vault;
const plugin = app.plugins.plugins.patchwork;
const DIR = '_e2e';
const EXPORT = { format: 'pdf', pages: 'all', range: '', sheet: 'native', orientation: 'auto', overlap: 0, fitSmallPages: false, tileLabels: false, quality: 'best', dpi: 150, open: false };
const mm = (pt) => (pt * 25.4) / 72;
async function inspect(path) {
	const doc = await plugin.pdfDocs.acquire(path);
	const pages = [];
	for (let i = 1; i <= doc.numPages; i++) {
		const p = await doc.getPage(i);
		const vp = p.getViewport({ scale: 1 });
		pages.push({ w: Math.round(mm(vp.width)), h: Math.round(mm(vp.height)), text: (await p.getTextContent()).items.map((t) => t.str).join(' ') });
	}
	const outline = (await doc.getOutline()) ?? [];
	const dests = [];
	for (const o of outline) dests.push([o.title, (await doc.getPageIndex((typeof o.dest === 'string' ? await doc.getDestination(o.dest) : o.dest)[0])) + 1]);
	plugin.pdfDocs.release(path);
	plugin.pdfDocs.invalidate(path);
	return { pages, dests };
}
const d = vault.getAbstractFileByPath(DIR);
if (d) await vault.delete(d, true);
await vault.createFolder(DIR);
try {
	const file = await plugin.createBoard(vault.getAbstractFileByPath(DIR));
	await sleep(300);
	const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === file);
	const t = (id, markdown, x, y) => ({ id, type: 'text', markdown, x, y, w: 60, h: 15 });
	view.store.update((f) => ({
		...f,
		pages: [
			{ ...f.pages[0], name: 'A4 page', modules: [t('a', 'A4-TEXT', 20, 20)] },
			{ id: 'small', name: 'A5 page', x: 230, y: 0, w: 148, h: 210, modules: [t('b', 'A5-TEXT', 10, 10)] },
			{ id: 'big', name: 'Poster', x: 400, y: 0, w: 1000, h: 700, modules: [t('tl', 'TOP-LEFT-CORNER', 10, 10), t('br', 'BOTTOM-RIGHT-CORNER', 920, 670)] },
		],
	}));
	await sleep(200);

	await view.surface.runExport({ ...EXPORT, base: `${DIR}/tiles`, sheet: 'A4', tileLabels: true });
	let r = await inspect(`${DIR}/tiles.pdf`);
	check('A4 sheets: 1 + 1 + 15 tiles', r.pages.length === 17, r.pages.length);
	check('every sheet is A4 portrait', r.pages.every((p) => p.w === 210 && p.h === 297), r.pages.map((p) => `${p.w}x${p.h}`));
	check('small page placed on an A4 sheet', r.pages[1].text.includes('A5-TEXT'));
	check('poster corners land on the first and last tiles', r.pages[2].text.includes('TOP-LEFT-CORNER') && r.pages[16].text.includes('BOTTOM-RIGHT-CORNER'), [r.pages[2].text, r.pages[16].text]);
	check('tile labels printed', r.pages[2].text.includes('A1') && r.pages[16].text.includes('C5'));
	check('bookmarks point at each page’s first sheet', JSON.stringify(r.dests) === '[["A4 page",1],["A5 page",2],["Poster",3]]', r.dests);

	await view.surface.runExport({ ...EXPORT, base: `${DIR}/range`, pages: 'range', range: '2' });
	r = await inspect(`${DIR}/range.pdf`);
	check('page range exports just that page', r.pages.length === 1 && r.pages[0].text.includes('A5-TEXT') && r.pages[0].w === 148, r.pages);

	await view.surface.runExport({ ...EXPORT, base: `${DIR}/native`, sheet: 'native' });
	r = await inspect(`${DIR}/native.pdf`);
	check('native export keeps each page’s size', JSON.stringify(r.pages.map((p) => [p.w, p.h])) === '[[210,297],[148,210],[1000,700]]', r.pages.map((p) => [p.w, p.h]));

	await view.surface.runExport({ ...EXPORT, format: 'png', base: `${DIR}/img`, dpi: 72, pages: 'range', range: '1-2' });
	const pngs = vault.getFiles().filter((f) => f.path.startsWith(`${DIR}/img`)).map((f) => f.path).sort();
	check('PNG: one image per page', JSON.stringify(pngs) === JSON.stringify([`${DIR}/img-01.png`, `${DIR}/img-02.png`]), pngs);
	const img = new Image();
	img.src = vault.getResourcePath(vault.getAbstractFileByPath(`${DIR}/img-01.png`));
	await img.decode();
	check('PNG size matches the page at the chosen DPI (A4 at 72 dpi ≈ 595 x 842)', Math.abs(img.naturalWidth - 595) <= 2 && Math.abs(img.naturalHeight - 842) <= 2, [img.naturalWidth, img.naturalHeight]);

	await view.surface.runExport({ ...EXPORT, format: 'png', base: `${DIR}/poster`, dpi: 300, pages: 'range', range: '3' });
	const posterPngs = vault.getFiles().filter((f) => f.path.startsWith(`${DIR}/poster`)).map((f) => f.path).sort();
	check('PNG beyond the 8192 px cap is split into tiles', posterPngs.length === 4 && posterPngs[0].endsWith('poster-r1c1.png'), posterPngs);
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

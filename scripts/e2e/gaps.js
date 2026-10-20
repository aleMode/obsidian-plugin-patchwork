// End-to-end check of smaller SPEC items: board font, "pick another" for missing sources, zoom to
// selection.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const vault = app.vault;
const plugin = app.plugins.plugins.patchwork;
const DIR = '_e2e';
const EXPORT = { format: 'pdf', pages: 'all', range: '', sheet: 'native', orientation: 'auto', overlap: 0, fitSmallPages: false, tileLabels: false, inkSaver: false, layout: 'single', bleed: 0, cropMarks: false, quality: 'best', dpi: 150, open: false };
const d = vault.getAbstractFileByPath(DIR);
if (d) await vault.delete(d, true);
await vault.createFolder(DIR);
try {
	const file = await plugin.createBoard(vault.getAbstractFileByPath(DIR));
	await sleep(300);
	const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === file);
	view.store.update((f) => ({
		...f,
		board: { ...f.board, fontFamily: 'Courier New, monospace' },
		pages: [
			{ ...f.pages[0], modules: [
				{ id: 't', type: 'text', markdown: 'FONT-SAMPLE', x: 10, y: 10, w: 80, h: 20 },
				{ id: 'gone', type: 'note', file: `${DIR}/Missing.md`, x: 10, y: 40, w: 80, h: 40 },
			] },
			{ id: 'p2', x: 400, y: 0, w: 210, h: 297, modules: [] },
		],
	}));
	view.surface.zoomToFit();
	await sleep(500);
	const sample = view.contentEl.querySelector('.pw-module[data-module-id="t"] p');
	check('board font applies to text on the page', /Courier/.test(getComputedStyle(sample).fontFamily), getComputedStyle(sample).fontFamily);

	await view.surface.runExport({ ...EXPORT, base: `${DIR}/out` });
	const doc = await plugin.pdfDocs.acquire(`${DIR}/out.pdf`);
	const page = await doc.getPage(1);
	const tc = await page.getTextContent();
	const item = tc.items.find((it) => it.str === 'FONT-SAMPLE');
	const fontName = item ? tc.styles[item.fontName]?.fontFamily ?? '' : '';
	// PDF.js reports the embedded font's generic family; a monospace board font comes out as monospace.
	check('board font used in the exported PDF', /mono|courier/i.test(fontName), [fontName, item?.fontName]);
	plugin.pdfDocs.release(`${DIR}/out.pdf`);
	plugin.pdfDocs.invalidate(`${DIR}/out.pdf`);

	const action = view.contentEl.querySelector('.pw-module[data-module-id="gone"] .pw-placeholder-action');
	check('missing note offers "Pick another…"', action?.innerText === 'Pick another…', action?.outerHTML);
	action.click();
	await sleep(300);
	const picker = document.querySelector('.prompt');
	check('it opens a note picker', !!picker, document.querySelector('.modal-container')?.className);
	for (let i = 0; i < 3 && document.querySelector('.modal-container'); i++) {
		document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await sleep(150);
	}

	view.surface.select({ pageId: 'p2' });
	view.surface.zoomToSelection();
	await sleep(100);
	const r = view.contentEl.querySelector('.pw-page[data-page-id="p2"]').getBoundingClientRect();
	const b = view.contentEl.querySelector('.pw-board').getBoundingClientRect();
	check('zoom to selection fits that page', r.height > b.height * 0.7 && r.left >= b.left && r.right <= b.right, [r.height, b.height]);
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

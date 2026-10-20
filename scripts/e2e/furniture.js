// End-to-end check of page numbers, headers/footers and the safe-area guide, on screen and in export.
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
	view.store.update((f) => ({
		...f,
		meta: { ...f.meta, title: 'Furniture test' },
		board: { ...f.board, numbering: { ...f.board.numbering, enabled: true, start: 1, format: 'roman', position: 'bottom-right', skipFirst: false }, footer: '{title} — {page} of {pages}', defaultSafeArea: { top: 10, right: 10, bottom: 10, left: 10 } },
		pages: [
			{ ...f.pages[0], name: 'One', numberLabel: 'Cover' },
			{ id: 'p2', name: 'Two', x: 230, y: 0, w: 210, h: 297, modules: [] },
			{ id: 'p3', name: 'Three', x: 460, y: 0, w: 210, h: 297, modules: [], footer: '' },
		],
	}));
	view.surface.zoomToFit();
	await sleep(200);
	const furn = [...view.contentEl.querySelectorAll('.pw-page')].map((p) => ({ number: p.querySelector('.pw-page-number')?.innerText ?? null, footer: p.querySelector('.pw-furniture-footer')?.innerText ?? null }));
	check('numbers shown on screen (custom label, roman)', JSON.stringify(furn.map((f) => f.number)) === '["Cover","ii","iii"]', furn);
	check('footer tokens expanded; page override removes it', furn[1].footer === 'Furniture test — ii of iii' && furn[2].footer === null, furn);
	check('safe-area guide drawn on screen', view.contentEl.querySelectorAll('.pw-safe-area').length === 3);

	await view.surface.runExport({ path: `${DIR}/out.pdf`, quality: 'best', dpi: 150, open: false });
	const out = vault.getAbstractFileByPath(`${DIR}/out.pdf`);
	const doc = await plugin.pdfDocs.acquire(out.path);
	const texts = [];
	for (let i = 1; i <= doc.numPages; i++) texts.push((await (await doc.getPage(i)).getTextContent()).items.map((it) => it.str).join(' '));
	check('footer and number printed in the PDF', texts[1].includes('Furniture test — ii of iii') && texts[1].includes('ii'), texts[1]);
	check('custom label printed', texts[0].includes('Cover'), texts[0]);
	const labels = await doc.getPageLabels();
	check('PDF page labels match the numbering', JSON.stringify(labels) === '["Cover","ii","iii"]', labels);
	plugin.pdfDocs.release(out.path);
	plugin.pdfDocs.invalidate(out.path);
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

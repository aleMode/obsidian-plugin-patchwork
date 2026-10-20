// End-to-end check of frozen note snapshots and stale-PDF warnings (M4).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const vault = app.vault;
const plugin = app.plugins.plugins.patchwork;
const DIR = '_e2e';
const EXPORT = { format: 'pdf', pages: 'all', range: '', sheet: 'native', orientation: 'auto', overlap: 0, fitSmallPages: false, tileLabels: false, inkSaver: false, layout: 'single', bleed: 0, cropMarks: false, quality: 'best', dpi: 150, open: false };
const until = async (fn, ms = 4000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (fn()) return true;
		await sleep(100);
	}
	return false;
};
const d = vault.getAbstractFileByPath(DIR);
if (d) await vault.delete(d, true);
await vault.createFolder(DIR);
try {
	const note = await vault.create(`${DIR}/Note.md`, '# Rules\nORIGINAL-TEXT\n');
	const file = await plugin.createBoard(vault.getAbstractFileByPath(DIR));
	await sleep(300);
	const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === file);
	const pageId = view.store.file.pages[0].id;
	view.store.update((f) => ({
		...f,
		pages: [{ ...f.pages[0], modules: [
			{ id: 'n', type: 'note', file: note.path, x: 10, y: 10, w: 120, h: 40 },
			{ id: 'pdf', type: 'pdf', file: 'PDFs/Sample rulebook.pdf', page: 1, x: 10, y: 80, w: 120, h: 120, sourceId: 'an-older-version' },
		] }],
	}));
	view.surface.zoomToFit();
	const mod = (id) => view.contentEl.querySelector(`.pw-module[data-module-id="${id}"]`);
	const badge = (id) => mod(id)?.querySelector('.pw-module-badge')?.innerText ?? null;
	await until(() => mod('n')?.innerText.includes('ORIGINAL-TEXT'));

	await view.surface.freezeNote(pageId, 'n');
	const frozen = view.store.file.pages[0].modules[0].frozen;
	check('freeze stores the current section', frozen?.markdown.includes('ORIGINAL-TEXT') && /^\d{4}-\d{2}-\d{2}$/.test(frozen.at), frozen);
	check('frozen badge shown', await until(() => badge('n') === `Frozen ${frozen.at}`), badge('n'));

	await vault.modify(note, '# Rules\nCHANGED-TEXT\n');
	check('frozen note keeps its snapshot and flags the change', await until(() => badge('n')?.includes('note changed')) && mod('n').innerText.includes('ORIGINAL-TEXT') && !mod('n').innerText.includes('CHANGED-TEXT'), [badge('n'), mod('n').innerText]);

	await view.surface.runExport({ ...EXPORT, base: `${DIR}/out` });
	const out = vault.getAbstractFileByPath(`${DIR}/out.pdf`);
	const doc = await plugin.pdfDocs.acquire(out.path);
	const text = (await (await doc.getPage(1)).getTextContent()).items.map((t) => t.str).join(' ');
	plugin.pdfDocs.release(out.path);
	plugin.pdfDocs.invalidate(out.path);
	check('export prints the snapshot, without badges', text.includes('ORIGINAL-TEXT') && !text.includes('CHANGED-TEXT') && !text.includes('Frozen') && !text.includes('PDF changed'), text.slice(0, 200));

	view.surface.unfreezeNote(pageId, 'n');
	check('unfreeze shows the live note again', await until(() => mod('n')?.innerText.includes('CHANGED-TEXT') && badge('n') === null), [badge('n'), mod('n')?.innerText]);

	check('replaced PDF flagged on its crop', await until(() => badge('pdf') === 'PDF changed: check this crop'), badge('pdf'));
	await view.surface.markPdfChecked(pageId, 'pdf');
	const sourceId = view.store.file.pages[0].modules[1].sourceId;
	check('mark as checked records the current version and clears the warning', sourceId && sourceId !== 'an-older-version' && (await until(() => badge('pdf') === null)), [sourceId, badge('pdf')]);

	await view.surface.freezeNote(pageId, 'n');
	await sleep(1500); // debounced save
	const saved = JSON.parse(await vault.read(file)).pages[0].modules;
	check('saved: frozen {at, markdown} and sourceId', JSON.stringify(Object.keys(saved[0].frozen)) === '["at","markdown"]' && saved[1].sourceId === sourceId, saved);
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

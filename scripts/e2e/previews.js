// End-to-end check of zoomed-out previews (M3 level of detail): outlines show small previews of
// PDF crops and images rendered earlier, without new rendering.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const vault = app.vault;
const plugin = app.plugins.plugins.patchwork;
const DIR = '_e2e';
const until = async (fn, ms = 6000) => {
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
	const file = await plugin.createBoard(vault.getAbstractFileByPath(DIR));
	await sleep(300);
	const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === file);
	view.store.update((f) => ({
		...f,
		pages: [{ ...f.pages[0], modules: [
			{ id: 'pdf', type: 'pdf', file: 'PDFs/Sample rulebook.pdf', page: 1, x: 10, y: 10, w: 90, h: 120 },
			{ id: 'img', type: 'image', file: 'Images/Map.png', x: 110, y: 10, w: 90, h: 60 },
			{ id: 'note', type: 'note', file: 'Rules/Combat.md', x: 10, y: 150, w: 90, h: 60 },
		] }],
	}));
	view.surface.zoomToFit();
	const el = (sel) => view.contentEl.querySelector(sel);
	check('modules render at working zoom', await until(() => el('.pw-module[data-module-id="pdf"] canvas') && el('.pw-module[data-module-id="img"] img')?.complete));
	await sleep(300);

	const vp = view.contentEl.querySelector('.pw-board').getBoundingClientRect();
	view.surface.setCamera({ zoom: 0.1, tx: vp.width / 2, ty: vp.height / 3 });
	check('zoomed out: outlines instead of modules', await until(() => !el('.pw-module[data-module-id="pdf"]') && view.contentEl.querySelectorAll('.pw-module-skeleton').length === 3));
	await until(() => view.contentEl.querySelectorAll('.pw-skeleton-thumb').length === 2, 2000);
	const thumbs = [...view.contentEl.querySelectorAll('.pw-skeleton-thumb')];
	check('PDF crop and image show previews', thumbs.length === 2 && el('.pw-skeleton-pdf .pw-skeleton-thumb') && el('.pw-skeleton-image .pw-skeleton-thumb'), thumbs.length);
	const img = el('.pw-skeleton-pdf .pw-skeleton-thumb');
	await img.decode();
	const c = document.createElement('canvas');
	c.width = img.naturalWidth;
	c.height = img.naturalHeight;
	c.getContext('2d').drawImage(img, 0, 0);
	const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
	let dark = 0;
	for (let i = 0; i < px.length; i += 4) if (px[i] < 128) dark++;
	check('the PDF preview has content (not blank)', dark > 5 && Math.max(c.width, c.height) <= 96, [dark, c.width, c.height]);
	check('notes show text lines', getComputedStyle(el('.pw-skeleton-note')).backgroundImage.includes('gradient'));
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

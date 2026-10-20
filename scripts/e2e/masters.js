// End-to-end check of master pages (M4): inherited modules and furniture on screen and in export.
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
	const t = (id, markdown, x, y) => ({ id, type: 'text', markdown, x, y, w: 80, h: 15 });
	view.store.update((f) => ({
		...f,
		board: { ...f.board, numbering: { ...f.board.numbering, enabled: true, start: 1, format: 'arabic', position: 'bottom-right', skipFirst: false } },
		pages: [
			{ ...f.pages[0], name: 'Layout', isMaster: true, header: 'MASTER-HEADER {page}', modules: [t('logo', 'MASTER-LOGO', 10, 10), t('cover', 'COVERED-AREA', 10, 100)] },
			{ id: 'p1', name: 'One', x: 230, y: 0, w: 210, h: 297, master: f.pages[0].id, modules: [t('own', 'PAGE-ONE-OWN', 10, 100)] },
			{ id: 'p2', name: 'Two', x: 460, y: 0, w: 210, h: 297, master: f.pages[0].id, header: 'OWN-HEADER', modules: [] },
			{ id: 'p3', name: 'Three', x: 690, y: 0, w: 210, h: 297, modules: [t('plain', 'NO-MASTER', 10, 10)] },
		],
	}));
	view.surface.zoomToFit();
	await sleep(600);
	const pageEl = (id) => view.contentEl.querySelector(`.pw-page[data-page-id="${id}"]`);
	const masterId = view.store.file.pages[0].id;
	check('master page is marked on the board', pageEl(masterId).hasClass('is-master') && [...view.contentEl.querySelectorAll('.pw-page-label')].some((l) => l.innerText.startsWith('Master: Layout')));
	const inherited = pageEl('p1').querySelectorAll('.pw-module.is-inherited');
	check('master modules shown on pages using it', inherited.length === 2 && pageEl('p2').querySelectorAll('.pw-module.is-inherited').length === 2 && pageEl('p3').querySelectorAll('.pw-module.is-inherited').length === 0, inherited.length);
	check('inherited modules render the master’s content', pageEl('p1').innerText.includes('MASTER-LOGO'));
	const own = pageEl('p1').querySelector('.pw-module[data-module-id="own"]');
	const cover = [...inherited].find((m) => m.innerText.includes('COVERED-AREA'));
	check('page’s own module is drawn above the inherited one', Number(getComputedStyle(own).zIndex) > Number(getComputedStyle(cover).zIndex), [getComputedStyle(own).zIndex, getComputedStyle(cover).zIndex]);
	const logo = [...inherited].find((m) => m.innerText.includes('MASTER-LOGO')).getBoundingClientRect();
	const under = document.elementFromPoint(logo.x + logo.width / 2, logo.y + logo.height / 2);
	check('clicks on inherited modules reach the page, not the module', !under.closest('.pw-module[data-module-id]') && under.closest('.pw-page')?.dataset.pageId === 'p1', under.className);
	const header = (id) => pageEl(id).querySelector('.pw-furniture-header')?.innerText ?? null;
	check('headers: master’s expanded, page override wins, master shows the template', header('p1') === 'MASTER-HEADER 1' && header('p2') === 'OWN-HEADER' && header(masterId) === 'MASTER-HEADER {page}', [header('p1'), header('p2'), header(masterId)]);

	// Editing the master updates every page using it.
	view.store.update((f) => ({ ...f, pages: f.pages.map((p) => (p.id === masterId ? { ...p, modules: p.modules.map((m) => (m.id === 'logo' ? { ...m, markdown: 'MASTER-EDITED' } : m)) } : p)) }));
	await sleep(400);
	check('editing the master updates its pages', pageEl('p1').innerText.includes('MASTER-EDITED') && pageEl('p2').innerText.includes('MASTER-EDITED'));

	await view.surface.runExport({ ...EXPORT, base: `${DIR}/out` });
	const out = vault.getAbstractFileByPath(`${DIR}/out.pdf`);
	const doc = await plugin.pdfDocs.acquire(out.path);
	const texts = [];
	for (let i = 1; i <= doc.numPages; i++) texts.push((await (await doc.getPage(i)).getTextContent()).items.map((it) => it.str).join(' '));
	const labels = await doc.getPageLabels();
	plugin.pdfDocs.release(out.path);
	plugin.pdfDocs.invalidate(out.path);
	check('master page not exported', texts.length === 3, texts.length);
	check('master content printed on its pages only', texts[0].includes('MASTER-EDITED') && texts[1].includes('MASTER-EDITED') && !texts[2].includes('MASTER-EDITED'), texts);
	check('master header printed, page override wins', texts[0].includes('MASTER-HEADER 1') && texts[1].includes('OWN-HEADER'), texts.slice(0, 2));
	check('numbering skips the master', JSON.stringify(labels) === '["1","2","3"]', labels);
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

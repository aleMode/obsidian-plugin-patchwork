// End-to-end check of the table of contents module (M4): live entries on screen, links in export.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const vault = app.vault;
const plugin = app.plugins.plugins.patchwork;
const DIR = '_e2e';
const EXPORT = { format: 'pdf', pages: 'all', range: '', sheet: 'native', orientation: 'auto', overlap: 0, fitSmallPages: false, tileLabels: false, inkSaver: false, layout: 'single', bleed: 0, cropMarks: false, quality: 'best', dpi: 150, open: false };
const mm = (pt) => (pt * 25.4) / 72;

/** Link annotations per sheet with their target sheet (1-based), and where "Spells" is printed. */
async function inspect(path) {
	const doc = await plugin.pdfDocs.acquire(path);
	const sheets = [];
	for (let i = 1; i <= doc.numPages; i++) {
		const p = await doc.getPage(i);
		const links = [];
		for (const a of await p.getAnnotations()) {
			if (a.subtype !== 'Link' || !a.dest) continue;
			const dest = typeof a.dest === 'string' ? await doc.getDestination(a.dest) : a.dest;
			links.push({ to: (await doc.getPageIndex(dest[0])) + 1, rect: a.rect });
		}
		const spells = (await p.getTextContent()).items.find((t) => t.str === 'Spells');
		sheets.push({ links, spells: spells ? [spells.transform[4], spells.transform[5]] : null });
	}
	plugin.pdfDocs.release(path);
	plugin.pdfDocs.invalidate(path);
	return sheets;
}
const inside = (pt, r) => pt && pt[0] >= r[0] - 1 && pt[0] <= r[2] + 1 && pt[1] >= r[1] - 1 && pt[1] <= r[3] + 1;

const d = vault.getAbstractFileByPath(DIR);
if (d) await vault.delete(d, true);
await vault.createFolder(DIR);
try {
	const file = await plugin.createBoard(vault.getAbstractFileByPath(DIR));
	await sleep(300);
	const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === file);
	const p = (id, x, extra = {}) => ({ id, x, y: 0, w: 148, h: 210, modules: [], ...extra });
	view.store.update((f) => ({
		...f,
		board: { ...f.board, numbering: { ...f.board.numbering, enabled: true, start: 1, format: 'roman' } },
		pages: [
			{ ...f.pages[0], w: 148, h: 210, name: 'Contents', modules: [{ id: 'toc', type: 'toc', x: 15, y: 15, w: 118, h: 150 }] },
			p('m', 160, { name: 'Layout', isMaster: true }),
			p('a', 320, { name: 'Spells' }),
			p('b', 480),
			p('c', 640, { name: 'Monsters' }),
		],
	}));
	view.surface.zoomToFit();
	await sleep(600);
	const rows = () => [...view.contentEl.querySelectorAll('.pw-toc-row')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
	check('lists named pages with numbers; skips itself, masters, unnamed', JSON.stringify(rows()) === '["Spells ii","Monsters iv"]', rows());
	check('default heading shown', view.contentEl.querySelector('.pw-toc-heading')?.innerText === 'Contents');

	view.store.update((f) => ({ ...f, pages: f.pages.map((x) => (x.id === 'b' ? { ...x, name: 'Treasure' } : x)) }));
	await sleep(300);
	check('naming a page updates the contents live', JSON.stringify(rows()) === '["Spells ii","Treasure iii","Monsters iv"]', rows());

	await view.surface.runExport({ ...EXPORT, base: `${DIR}/native` });
	let s = await inspect(`${DIR}/native.pdf`);
	check('exported PDF has a link per entry', s[0].links.length === 3, s[0].links);
	check('links go to the right pages', JSON.stringify(s[0].links.map((l) => l.to)) === '[2,3,4]', s[0].links.map((l) => l.to));
	check('link area covers its entry', inside(s[0].spells, s[0].links[0].rect), [s[0].spells, s[0].links[0].rect]);

	// Scaled onto A4: link areas follow the page's placement on the sheet.
	await view.surface.runExport({ ...EXPORT, base: `${DIR}/a4`, sheet: 'A4', fitSmallPages: true, bleed: 3, cropMarks: true });
	s = await inspect(`${DIR}/a4.pdf`);
	check('scaled export: links still cover their entries', s[0].links.length === 3 && inside(s[0].spells, s[0].links[0].rect), [s[0].spells, s[0].links[0]?.rect]);

	await view.surface.runExport({ ...EXPORT, base: `${DIR}/range`, pages: 'range', range: '1-2' });
	s = await inspect(`${DIR}/range.pdf`);
	check('page range: only links to exported pages', JSON.stringify(s[0].links.map((l) => l.to)) === '[2]', s[0].links);
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

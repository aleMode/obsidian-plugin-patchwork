// End-to-end check of module rendering, run inside Obsidian (via scripts/e2e/run.mjs).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const vault = app.vault;
const DIR = '_e2e';
const until = async (fn, ms = 4000) => {
	const t0 = Date.now();
	while (Date.now() - t0 < ms) {
		if (await fn()) return true;
		await sleep(50);
	}
	return false;
};

const restore = [];
async function editNote(path, transform) {
	const f = vault.getAbstractFileByPath(path);
	const original = await vault.read(f);
	restore.push([f, original]);
	await vault.modify(f, transform(original));
}

const d = vault.getAbstractFileByPath(DIR);
if (d) await vault.delete(d, true);
await vault.createFolder(DIR);
try {
	const file = await app.plugins.plugins.patchwork.createBoard(vault.getAbstractFileByPath(DIR));
	await sleep(300);
	const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === file);
	const pageId = view.store.file.pages[0].id;
	const mod = (id, extra) => ({ id, x: 10, y: 10, w: 90, h: 80, ...extra });
	view.store.update((f) => ({
		...f,
		pages: [{
			...f.pages[0],
			modules: [
				mod('note1', { type: 'note', file: 'Rules/Combat.md', subpath: '#Prone' }),
				mod('pdf1', { type: 'pdf', file: 'PDFs/Sample rulebook.pdf', page: 1, crop: [20 / 210, 150 / 297, 110 / 210, 230 / 297], x: 110, w: 90, h: 80 }),
				mod('text1', { type: 'text', markdown: '**Bold** text module', y: 100, h: 20 }),
				mod('img1', { type: 'image', file: 'Images/Map.png', x: 110, y: 100, w: 60, h: 45 }),
				mod('nosec', { type: 'note', file: 'Rules/Combat.md', subpath: '#Nope', y: 130, h: 20 }),
				mod('nofile', { type: 'note', file: 'Missing.md', y: 155, h: 20 }),
				mod('alien', { type: 'hologram', y: 180, h: 15 }),
				mod('list', { type: 'note', file: 'Spells/Spell list.md', subpath: '#Whole-note embed', x: 110, y: 150, h: 130 }),
			],
		}],
	}));
	const el = (id) => view.contentEl.querySelector(`.pw-module[data-module-id="${id}"]`);
	const text = (id) => el(id)?.innerText ?? '';

	check('note section renders', await until(() => text('note1').includes('You can only crawl')), text('note1'));
	check('note section stops at the next heading', !text('note1').includes('Grappled'));
	check('pdf crop renders into a canvas', await until(() => el('pdf1')?.querySelector('canvas')?.width > 0));
	const canvas = el('pdf1')?.querySelector('canvas');
	if (canvas) {
		const px = canvas.getContext('2d').getImageData(Math.floor(canvas.width * 0.97), Math.floor(canvas.height / 2), 1, 1).data;
		check('pdf crop shows the stat block fill colour', Math.abs(px[0] - 245) < 6 && Math.abs(px[1] - 235) < 6 && Math.abs(px[2] - 209) < 6, Array.from(px));
		const ratio = (canvas.width / canvas.height) / (90 / 80);
		check('pdf crop keeps its aspect ratio', Math.abs(ratio - 1) < 0.02, ratio);
	}
	check('text module renders markdown', await until(() => el('text1')?.querySelector('strong')?.innerText === 'Bold'));
	check('image module loads', await until(() => el('img1')?.querySelector('img')?.naturalWidth === 400));
	check('missing section shows a placeholder', await until(() => text('nosec').includes('Section not found')), text('nosec'));
	check('missing file shows a placeholder', await until(() => text('nofile').includes('Note not found')), text('nofile'));
	check('unknown module type shows a placeholder', text('alien').includes('Unknown module type'), text('alien'));
	check('embeds inside a note module render', await until(() => text('list').includes('8d6 fire damage')), text('list').slice(0, 200));

	const paper = el('note1').closest('.pw-page-paper');
	const p = getComputedStyle(el('note1').querySelector('p, li') ?? el('note1'));
	check('note text is dark on light paper', p.color === 'rgb(34, 34, 34)' && getComputedStyle(paper).backgroundColor === 'rgb(255, 255, 255)', p.color);

	// Live updates: the source note, and a note embedded by a module's note.
	await editNote('Rules/Combat.md', (t) => t.replace('- You can only crawl', '- E2E-LIVE-EDIT\n- You can only crawl'));
	check('editing the source note updates the module', await until(() => text('note1').includes('E2E-LIVE-EDIT')), text('note1'));
	await editNote('Spells/Fireball.md', (t) => t.replace('8d6 fire damage', '8d6 E2E-EMBED-EDIT damage'));
	check('editing an embedded note updates the module', await until(() => text('list').includes('E2E-EMBED-EDIT')), text('list').slice(0, 300));

	// Level of detail: zoomed far out, pages show outlines instead of content.
	const s = view.surface;
	s.setCamera({ ...s.camera, zoom: 0.1 });
	await sleep(150);
	const lod = { modules: view.contentEl.querySelectorAll('.pw-module').length, outlines: view.contentEl.querySelectorAll('.pw-module-skeleton').length };
	check('zoomed out: outlines instead of content', lod.modules === 0 && lod.outlines === 8, lod);
	s.zoomToFit();
	check('zoomed back in: content again', await until(() => text('note1').includes('You can only crawl') && view.contentEl.querySelectorAll('.pw-module-skeleton').length === 0));

	// Virtualization: modules unmount when their page is far off screen, and come back.
	s.setCamera({ tx: -1e6, ty: -1e6, zoom: 1 });
	await sleep(150);
	check('modules unmount when the page is off screen', view.contentEl.querySelectorAll('.pw-module').length === 0);
	s.zoomToFit();
	check('modules remount when visible again', await until(() => text('note1').includes('You can only crawl') && el('pdf1')?.querySelector('canvas')));

	// Deleting a module and undoing.
	view.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], modules: f.pages[0].modules.filter((m) => m.id !== 'text1') }] }));
	await sleep(50);
	check('removed module disappears', !el('text1'));
	view.store.undo();
	check('undo brings it back', await until(() => el('text1')?.innerText.includes('Bold')));

	await sleep(2600);
	const saved = JSON.parse(await vault.read(file));
	check('modules saved, unknown type kept verbatim', saved.pages[0].modules.length === 8 && saved.pages[0].modules.find((m) => m.id === 'alien')?.type === 'hologram');
} catch (e) {
	check('no exception', false, String(e?.stack ?? e));
} finally {
	for (const [f, text] of restore.reverse()) await vault.modify(f, text);
	app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
	const dir = vault.getAbstractFileByPath(DIR);
	if (dir) await vault.delete(dir, true);
}
return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };

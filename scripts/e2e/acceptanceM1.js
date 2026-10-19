// M1 acceptance (SPEC 11): one A4 page shows two PDF crops and two note sections side by side;
// editing a source note updates the board without reopening it. Run via scripts/e2e/run.mjs.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const vault = app.vault;
const DIR = '_e2e';
const until = async (fn, ms = 6000) => {
	const t0 = Date.now();
	while (Date.now() - t0 < ms) {
		if (await fn()) return true;
		await sleep(50);
	}
	return false;
};
const d = vault.getAbstractFileByPath(DIR);
if (d) await vault.delete(d, true);
await vault.createFolder(DIR);
let restore = null;
try {
	const file = await app.plugins.plugins.patchwork.createBoard(vault.getAbstractFileByPath(DIR));
	await sleep(300);
	const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === file);
	view.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], modules: [
		{ id: 'n1', type: 'note', file: 'Rules/Combat.md', subpath: '#Prone', x: 10, y: 10, w: 92, h: 60 },
		{ id: 'n2', type: 'note', file: 'Spells/Fireball.md', subpath: '#Fireball', x: 10, y: 80, w: 92, h: 120 },
		{ id: 'p1', type: 'pdf', file: 'PDFs/Sample rulebook.pdf', page: 1, crop: [20 / 210, 150 / 297, 110 / 210, 230 / 297], x: 108, y: 10, w: 92, h: 82 },
		{ id: 'p2', type: 'pdf', file: 'PDFs/Sample rulebook.pdf', page: 2, crop: [0.05, 0.1, 0.5, 0.35], x: 108, y: 100, w: 92, h: 100 },
	] }] }));
	view.surface.zoomToFit();
	const el = (id) => view.contentEl.querySelector(`.pw-module[data-module-id="${id}"]`);
	check('page is A4', view.store.file.pages[0].w === 210 && view.store.file.pages[0].h === 297);
	check('two note sections render', await until(() => el('n1')?.innerText.includes('You can only crawl') && el('n2')?.innerText.includes('8d6 fire damage')));
	check('two PDF crops render', await until(() => el('p1')?.querySelector('canvas')?.width > 0 && el('p2')?.querySelector('canvas')?.width > 0));
	const boxes = ['n1', 'n2', 'p1', 'p2'].map((id) => el(id).getBoundingClientRect());
	check('notes and crops are side by side (left column / right column)', boxes[0].right <= boxes[2].left && boxes[1].right <= boxes[3].left);

	const src = vault.getAbstractFileByPath('Rules/Combat.md');
	const original = await vault.read(src);
	restore = [src, original];
	await vault.modify(src, original.replace('- You can only crawl', '- M1-ACCEPTANCE-EDIT\n- You can only crawl'));
	check('editing the source note updates the board without reopening', await until(() => el('n1')?.innerText.includes('M1-ACCEPTANCE-EDIT')));
} catch (e) {
	check('no exception', false, String(e?.stack ?? e));
} finally {
	if (restore) await vault.modify(restore[0], restore[1]);
	app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
	await new Promise((r) => setTimeout(r, 400)); // let pending saves finish before deleting their files
	const dir = vault.getAbstractFileByPath(DIR);
	if (dir) await vault.delete(dir, true);
}
return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };

// End-to-end check of auto-arrange and .canvas export (SPEC 5.4, 9.3), run inside Obsidian.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const vault = app.vault;
const DIR = '_e2e';
const d = vault.getAbstractFileByPath(DIR);
if (d) await vault.delete(d, true);
await vault.createFolder(DIR);
try {
	const file = await app.plugins.plugins.patchwork.createBoard(vault.getAbstractFileByPath(DIR));
	await sleep(300);
	const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((x) => x.file === file);
	view.store.update((f) => ({ ...f, pages: [
		{ ...f.pages[0], name: 'One', modules: [{ id: 'n', type: 'note', file: 'Rules/Combat.md', subpath: '#Prone', x: 10, y: 10, w: 90, h: 60 }, { id: 'p', type: 'pdf', file: 'PDFs/Sample rulebook.pdf', page: 2, crop: [0, 0, 0.5, 0.5], x: 110, y: 10, w: 90, h: 120 }] },
		{ id: 'p2', name: 'Two', x: 900, y: 600, w: 297, h: 210, modules: [] },
		{ id: 'p3', name: 'Three', x: 400, y: 300, w: 148, h: 210, modules: [] },
	] }));
	view.surface.autoArrange('row');
	const row = Object.fromEntries(view.store.file.pages.map((p) => [p.name, [p.x, p.y]]));
	check('arrange in a row follows output order with gaps', JSON.stringify(row) === JSON.stringify({ One: [0, 0], Two: [398, 0], Three: [230, 0] }), row);
	view.store.undo();
	check('arrange undoes in one step', view.store.file.pages.find((p) => p.id === 'p2').x === 900);

	const out = await view.surface.exportCanvas();
	const canvas = JSON.parse(await vault.read(out));
	check('.canvas written next to the board', out.path === `${DIR}/Untitled board.canvas`, out.path);
	check('pages become groups, modules file nodes with subpaths', JSON.stringify(canvas.nodes.map((n) => n.type + (n.subpath ?? ''))) === JSON.stringify(['group', 'file#Prone', 'file#page=2', 'group', 'group']), canvas.nodes.map((n) => n.type));
	check('all coordinates are integer pixels', canvas.nodes.every((n) => [n.x, n.y, n.width, n.height].every(Number.isInteger)));
	const notice = [...document.querySelectorAll('.notice')].map((n) => n.innerText).join(' ');
	check('the notice says what was dropped', notice.includes('PDF crops'), notice);
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

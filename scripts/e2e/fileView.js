// End-to-end check of the board file view, run inside Obsidian:
//   node scripts/cdp.mjs -f scripts/e2e/fileView.js
// Creates and deletes its own files under "_e2e/". Returns a report; every `ok` must be true.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const plugin = app.plugins.plugins.patchwork;
const vault = app.vault;
const DIR = '_e2e';

async function cleanup() {
	const dir = vault.getAbstractFileByPath(DIR);
	if (dir) await vault.delete(dir, true);
}
const viewOf = (file) => app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === file);
const closeAll = () => app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
	await new Promise((r) => setTimeout(r, 400)); // let pending saves finish before deleting their files

await cleanup();
await vault.createFolder(DIR);
try {
	// 1. New board command creates and opens a board.
	const file = await plugin.createBoard(vault.getAbstractFileByPath(DIR));
	await sleep(300);
	let view = viewOf(file);
	check('new board created', file && file.path === `${DIR}/Untitled patchwork.patchwork`, file?.path);
	check('opens in board view', view && view.store, view?.getViewType());
	check('starts with one A4 page', view?.store.file.pages.length === 1 && view.store.file.pages[0].w === 210);
	const second = await plugin.createBoard(vault.getAbstractFileByPath(DIR));
	check('second board gets a free name', second?.path === `${DIR}/Untitled patchwork 1.patchwork`, second?.path);

	// 2. Edits are saved (debounced) and unknown keys survive.
	const withExtra = JSON.parse(await vault.read(file));
	withExtra.futureKey = { keep: true };
	withExtra.pages[0].pageExtra = 'x';
	await vault.modify(file, JSON.stringify(withExtra));
	await sleep(500);
	check('clean view reloads an outside change', view.store.file.futureKey?.keep === true);
	view.store.update((f) => ({ ...f, pages: [...f.pages, { ...f.pages[0], id: 'second', x: 300 }] }));
	await sleep(2600);
	const saved = JSON.parse(await vault.read(file));
	check('edit saved after debounce', saved.pages.length === 2, saved.pages.length);
	check('unknown keys preserved through an edit', saved.futureKey?.keep === true && saved.pages[0].pageExtra === 'x');

	// 3. Conflict: outside change arrives while our save is pending.
	view.store.update((f) => ({ ...f, meta: { ...f.meta, title: 'mine' } }));
	const theirs = { ...saved, meta: { ...saved.meta, title: 'theirs' } };
	await vault.modify(file, JSON.stringify(theirs, null, 2));
	await sleep(2800);
	const disk = JSON.parse(await vault.read(file));
	const copies = vault.getFiles().filter((f) => f.path.startsWith(`${DIR}/Untitled patchwork (conflict`));
	view = viewOf(file);
	check('outside change not overwritten', disk.meta.title === 'theirs', disk.meta.title);
	check('our version kept in a conflict copy', copies.length === 1 && JSON.parse(await vault.read(copies[0])).meta.title === 'mine', copies.map((c) => c.path));
	check('view shows the disk version', view.store.file.meta.title === 'theirs', view.store.file.meta.title);
	const modal = document.querySelector('.modal');
	check('conflict dialog shown', modal?.innerText.includes('changed outside this view'), modal?.innerText);
	Array.from(document.querySelectorAll('.modal button')).find((b) => b.innerText === 'Use my version')?.click();
	await sleep(500);
	check('"Use my version" restores ours and removes the copy', JSON.parse(await vault.read(file)).meta.title === 'mine' && !vault.getAbstractFileByPath(copies[0].path));

	// 4. Unparseable file: error view, never written.
	closeAll();
	const bad = await vault.create(`${DIR}/Broken.patchwork`, '{ "version": 1, "pages": [ ');
	await app.workspace.getLeaf(true).openFile(bad);
	await sleep(300);
	const badView = viewOf(bad);
	check('error view shown', badView.contentEl.querySelector('.pw-error-view')?.innerText.includes('could not be opened'));
	await badView.save();
	check('broken file untouched by save', (await vault.read(bad)) === '{ "version": 1, "pages": [ ');
	const invalid = await vault.create(`${DIR}/Invalid.patchwork`, JSON.stringify({ version: 1, pages: [{ id: 'a', x: 0, y: 0, w: -5, h: 1 }] }));
	await app.workspace.getLeaf(true).openFile(invalid);
	await sleep(300);
	check('validation errors listed with paths', viewOf(invalid).contentEl.innerText.includes('pages[0].w'));

	// 5. Newer format: read-only.
	const future = await vault.create(`${DIR}/Future.patchwork`, JSON.stringify({ version: 99, pages: [], board: {}, alien: 1 }));
	await app.workspace.getLeaf(true).openFile(future);
	await sleep(300);
	const fv = viewOf(future);
	fv.store.update((f) => ({ ...f, pages: [{ id: 'x', x: 0, y: 0, w: 1, h: 1, modules: [] }] }));
	await fv.save();
	check('newer format opens read-only and is not written', fv.store.readOnly && JSON.parse(await vault.read(future)).alien === 1 && fv.store.file.pages.length === 0);
	check('read-only banner shown', fv.contentEl.querySelector('.pw-banner-readonly')?.innerText.includes('read-only'));

	// 6. Rename while open keeps working.
	closeAll();
	await app.workspace.getLeaf(true).openFile(file);
	await sleep(300);
	await app.fileManager.renameFile(file, `${DIR}/Renamed.patchwork`);
	view = viewOf(file);
	view.store.update((f) => ({ ...f, meta: { ...f.meta, title: 'after rename' } }));
	await view.save();
	check('saves to the renamed path', JSON.parse(await vault.read(file)).meta.title === 'after rename' && file.path === `${DIR}/Renamed.patchwork`);
} catch (e) {
	check('no exception', false, String(e?.stack ?? e));
} finally {
	closeAll();
	for (let k = 0; k < 20 && document.querySelector('.modal-container'); k++) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise((r) => setTimeout(r, 50)); }
	await cleanup();
}
return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };

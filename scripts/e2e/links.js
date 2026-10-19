// End-to-end check of link tracking on rename, run inside Obsidian (via scripts/e2e/run.mjs).
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
const boardJson = (file) => JSON.stringify({ version: 1, pages: [{ id: 'p', x: 0, y: 0, w: 210, h: 297, modules: [{ id: 'm', type: 'note', file, x: 10, y: 10, w: 50, h: 50 }] }] }, null, 2);

const d = vault.getAbstractFileByPath(DIR);
if (d) await vault.delete(d, true);
await vault.createFolder(DIR);
await vault.createFolder(`${DIR}/notes`);
try {
	const note = await vault.create(`${DIR}/notes/Source.md`, '# Source\n\nLINK-TRACK-TEXT');
	const open = await vault.create(`${DIR}/Open.patchwork`, boardJson(note.path));
	await vault.create(`${DIR}/Closed.patchwork`, boardJson(note.path));
	const brokenText = `{ "version": 1, "pages": [ BROKEN "${note.path}"`;
	const broken = await vault.create(`${DIR}/Broken.patchwork`, brokenText);
	await app.workspace.getLeaf(true).openFile(open);
	await sleep(400);
	const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === open);
	view.surface.zoomToFit();
	check('module shows the note', await until(() => view.contentEl.innerText.includes('LINK-TRACK-TEXT')));

	await app.fileManager.renameFile(note, `${DIR}/notes/Renamed.md`);
	check('open board updated in its store', await until(() => view.store.file.pages[0].modules[0].file === `${DIR}/notes/Renamed.md`), view.store.file.pages[0].modules[0].file);
	check('open board still shows the note', await until(() => view.contentEl.innerText.includes('LINK-TRACK-TEXT')));
	check('closed board rewritten on disk', await until(async () => JSON.parse(await vault.read(vault.getAbstractFileByPath(`${DIR}/Closed.patchwork`))).pages[0].modules[0].file === `${DIR}/notes/Renamed.md`));
	check('broken board left untouched', (await vault.read(broken)) === brokenText);
	view.store.undo();
	check('rename is undoable on the open board', view.store.file.pages[0].modules[0].file === `${DIR}/notes/Source.md`, view.store.file.pages[0].modules[0].file);
	view.store.redo();

	// Folder rename: everything inside follows.
	await app.fileManager.renameFile(vault.getAbstractFileByPath(`${DIR}/notes`), `${DIR}/lore`);
	check('folder rename updates the open board', await until(() => view.store.file.pages[0].modules[0].file === `${DIR}/lore/Renamed.md`), view.store.file.pages[0].modules[0].file);
	check('folder rename updates the closed board', await until(async () => JSON.parse(await vault.read(vault.getAbstractFileByPath(`${DIR}/Closed.patchwork`))).pages[0].modules[0].file === `${DIR}/lore/Renamed.md`));

	// Delete: reference kept, placeholder shown.
	await vault.delete(vault.getAbstractFileByPath(`${DIR}/lore/Renamed.md`));
	check('deleted note leaves a placeholder', await until(() => view.contentEl.innerText.includes('Note not found')));
	check('reference kept after delete', view.store.file.pages[0].modules[0].file === `${DIR}/lore/Renamed.md`);
} catch (e) {
	check('no exception', false, String(e?.stack ?? e));
} finally {
	app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
	const dir = vault.getAbstractFileByPath(DIR);
	if (dir) await vault.delete(dir, true);
}
return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };

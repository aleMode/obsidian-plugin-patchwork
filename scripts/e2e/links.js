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
const boardJson = (file) =>
	JSON.stringify(
		{
			version: 1,
			pages: [
				{
					id: 'p', x: 0, y: 0, w: 210, h: 297,
					modules: [
						{ id: 'm', type: 'note', file, x: 10, y: 10, w: 50, h: 50 },
						{ id: 't', type: 'text', markdown: 'See [[Source#Part|the source]] and [[notes/Source]]', x: 10, y: 70, w: 50, h: 20 },
						{ id: 'f', type: 'note', file, frozen: { at: '2026-10-20', markdown: 'Frozen [[Source]]' }, x: 10, y: 100, w: 50, h: 20 },
					],
				},
			],
		},
		null,
		2,
	);
const conflicts = () => vault.getFiles().filter((f) => f.path.startsWith(DIR) && f.path.includes('(conflict')).map((f) => f.path);

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
	// A second pane on the same board, with an edit not saved yet when the rename comes.
	await app.workspace.getLeaf('split').openFile(open);
	await sleep(400);
	const views = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).filter((v) => v.file === open);
	const view = views[0];
	view.surface.zoomToFit();
	check('module shows the note', await until(() => view.contentEl.innerText.includes('LINK-TRACK-TEXT')));
	views[1].store.update((f) => ({ ...f, meta: { ...f.meta, title: 'unsaved edit' } }));

	await app.fileManager.renameFile(note, `${DIR}/notes/Renamed.md`);
	const onDisk = async () => JSON.parse(await vault.read(open));
	check('both panes follow, the unsaved edit is kept', await until(async () => views.every((v) => v.store.file.pages[0].modules[0].file === `${DIR}/notes/Renamed.md`) && (await onDisk()).meta?.title === 'unsaved edit'), views.map((v) => v.store.file.pages[0].modules[0].file));
	const texts = (b) => [b.pages[0].modules[1].markdown, b.pages[0].modules[2].frozen.markdown];
	check('links in text and frozen notes follow', JSON.stringify(texts(await onDisk())) === JSON.stringify(['See [[Renamed#Part|the source]] and [[Renamed]]', 'Frozen [[Renamed]]']), texts(await onDisk()));
	check('no conflict copy', conflicts().length === 0, conflicts());
	check('open board updated in its store', await until(() => view.store.file.pages[0].modules[0].file === `${DIR}/notes/Renamed.md`), view.store.file.pages[0].modules[0].file);
	check('open board still shows the note', await until(() => view.contentEl.innerText.includes('LINK-TRACK-TEXT')));
	check('closed board rewritten on disk', await until(async () => JSON.parse(await vault.read(vault.getAbstractFileByPath(`${DIR}/Closed.patchwork`))).pages[0].modules[0].file === `${DIR}/notes/Renamed.md`));
	check('broken board left untouched', (await vault.read(broken)) === brokenText);
	check('links in the closed board follow', await until(async () => texts(JSON.parse(await vault.read(vault.getAbstractFileByPath(`${DIR}/Closed.patchwork`))))[1] === 'Frozen [[Renamed]]'));
	// The rewrite went through the pane holding the unsaved edit; the other one reloaded from disk.
	views[1].store.undo();
	// A rename is not an undo step, and undoing earlier edits never brings the old path back.
	check('undo keeps the renamed path', views[1].store.file.pages[0].modules[0].file === `${DIR}/notes/Renamed.md`, views[1].store.file.pages[0].modules[0].file);
	views[1].store.redo();
	await views[1].save();
	views[1].leaf.detach();

	// Folder rename: everything inside follows.
	await app.fileManager.renameFile(vault.getAbstractFileByPath(`${DIR}/notes`), `${DIR}/lore`);
	check('folder rename updates the open board', await until(() => view.store.file.pages[0].modules[0].file === `${DIR}/lore/Renamed.md`), view.store.file.pages[0].modules[0].file);
	check('folder rename updates the closed board', await until(async () => JSON.parse(await vault.read(vault.getAbstractFileByPath(`${DIR}/Closed.patchwork`))).pages[0].modules[0].file === `${DIR}/lore/Renamed.md`));

	// Moving the folder that holds the open board and its notes.
	await app.fileManager.renameFile(vault.getAbstractFileByPath(DIR), `${DIR}2`);
	check('moving the board’s own folder updates it', await until(() => view.store.file.pages[0].modules[0].file === `${DIR}2/lore/Renamed.md`), view.store.file.pages[0].modules[0].file);
	await sleep(500);
	check('…without a conflict copy', !vault.getFiles().some((f) => f.path.startsWith(`${DIR}2/`) && f.path.includes('(conflict')));
	await app.fileManager.renameFile(vault.getAbstractFileByPath(`${DIR}2`), DIR);
	await sleep(300);

	// Delete: reference kept, placeholder shown.
	await vault.delete(vault.getAbstractFileByPath(`${DIR}/lore/Renamed.md`));
	check('deleted note leaves a placeholder', await until(() => view.contentEl.innerText.includes('Note not found')));
	check('reference kept after delete', view.store.file.pages[0].modules[0].file === `${DIR}/lore/Renamed.md`);
} catch (e) {
	check('no exception', false, String(e?.stack ?? e));
} finally {
	app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
	await new Promise((r) => setTimeout(r, 400)); // let pending saves finish before deleting their files
	for (const p of [DIR, `${DIR}2`]) {
		const dir = vault.getAbstractFileByPath(p);
		if (dir) await vault.delete(dir, true);
	}
}
return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };

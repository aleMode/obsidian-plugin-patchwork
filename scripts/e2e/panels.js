// End-to-end check of the inspector and outline panels, run inside Obsidian (via scripts/e2e/run.mjs).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const vault = app.vault;
const plugin = app.plugins.plugins.patchwork;
const DIR = '_e2e';
const d = vault.getAbstractFileByPath(DIR);
if (d) await vault.delete(d, true);
await vault.createFolder(DIR);
const panel = (type) => app.workspace.getLeavesOfType(type)[0]?.view;
/** Type into the inspector field whose name is `name`, like a user would. */
function typeInto(name, value) {
	const item = [...panel('patchwork-inspector').contentEl.querySelectorAll('.setting-item')].find((s) => s.querySelector('.setting-item-name')?.innerText === name);
	const input = item?.querySelector('input, textarea, select');
	if (!input) throw new Error(`No field "${name}"`);
	input.value = value;
	input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input'));
}
try {
	const file = await plugin.createBoard(vault.getAbstractFileByPath(DIR));
	await sleep(300);
	const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === file);
	const s = view.surface;
	view.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], name: 'Front', modules: [{ id: 'n', type: 'note', file: 'Rules/Combat.md', x: 10, y: 10, w: 90, h: 60 }] }] }));
	await plugin.openPanels();
	await sleep(300);
	check('inspector and outline open', panel('patchwork-inspector') && panel('patchwork-outline'));
	check('inspector follows the board: board settings when nothing is selected', panel('patchwork-inspector').contentEl.innerText.includes('Display unit'));
	check('outline lists the page and module', panel('patchwork-outline').contentEl.innerText.includes('1. Front') && panel('patchwork-outline').contentEl.innerText.includes('Combat'));

	s.select({ pageId: view.store.file.pages[0].id, moduleId: 'n' });
	await sleep(100);
	check('inspector shows the selected module', panel('patchwork-inspector').contentEl.innerText.includes('Note module'));
	typeInto('Width', '12');
	typeInto('Width', '120');
	check('typing a width updates the module', view.store.file.pages[0].modules[0].w === 120, view.store.file.pages[0].modules[0].w);
	typeInto('Width', '5 cm');
	check('lengths accept other units', view.store.file.pages[0].modules[0].w === 50, view.store.file.pages[0].modules[0].w);
	view.store.undo();
	check('a field edit undoes in one step', view.store.file.pages[0].modules[0].w === 90, view.store.file.pages[0].modules[0].w);
	typeInto('Section', '#Prone');
	check('section dropdown sets the subpath', view.store.file.pages[0].modules[0].subpath === '#Prone');
	typeInto('Padding', '3');
	check('style padding set', view.store.file.pages[0].modules[0].style?.padding === 3);
	typeInto('Overflow', 'grow');
	check('overflow set from the inspector', view.store.file.pages[0].modules[0].overflow === 'grow');

	s.select(null);
	await sleep(100);
	const row = [...panel('patchwork-outline').contentEl.querySelectorAll('.pw-outline-module')][0];
	row?.click();
	await sleep(100);
	check('clicking an outline row selects the module', s.selected?.moduleId === 'n');
	await sleep(2600);
	const saved = JSON.parse(await vault.read(file));
	check('panel edits saved to the file', saved.pages[0].modules[0].subpath === '#Prone' && saved.pages[0].modules[0].style.padding === 3);
} catch (e) {
	check('no exception', false, String(e?.stack ?? e));
} finally {
	app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
	await new Promise((r) => setTimeout(r, 400)); // let pending saves finish before deleting their files
	const dir = vault.getAbstractFileByPath(DIR);
	if (dir) await vault.delete(dir, true);
}
return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };

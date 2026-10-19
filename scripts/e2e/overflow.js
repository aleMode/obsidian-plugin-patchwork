// End-to-end check of note overflow policies, run inside Obsidian (via scripts/e2e/run.mjs).
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
const d = vault.getAbstractFileByPath(DIR);
if (d) await vault.delete(d, true);
await vault.createFolder(DIR);
try {
	const file = await app.plugins.plugins.patchwork.createBoard(vault.getAbstractFileByPath(DIR));
	await sleep(300);
	const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === file);
	const setPolicy = (overflow) =>
		view.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], modules: [{ id: 'n', type: 'note', file: 'Monsters/Goblin.md', x: 10, y: 10, w: 90, h: 100, ...(overflow ? { overflow } : {}) }] }] }));
	setPolicy(undefined);
	view.surface.zoomToFit();
	const el = () => view.contentEl.querySelector('.pw-module[data-module-id="n"]');
	check('clip: overflow marker shown', await until(() => el()?.hasClass('is-overflowing')));
	setPolicy('fit');
	check('fit: content shrunk and no marker', await until(() => el()?.querySelector('.pw-markdown.is-fit') && !el().hasClass('is-overflowing')));
	const scale = Number(getComputedStyle(el().querySelector('.pw-markdown')).getPropertyValue('--pw-fit'));
	check('fit: scale between 0.5 and 1', scale >= 0.5 && scale < 1, scale);
	setPolicy('grow');
	const mm = 96 / 25.4;
	check('grow: module taller than its stored height', await until(() => el() && el().offsetHeight > 100 * mm + 5), el()?.offsetHeight);
	check('grow: stored height unchanged', view.store.file.pages[0].modules[0].h === 100);
	check('grow: no marker', !el().hasClass('is-overflowing'));
} catch (e) {
	check('no exception', false, String(e?.stack ?? e));
} finally {
	app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
	const dir = vault.getAbstractFileByPath(DIR);
	if (dir) await vault.delete(dir, true);
}
return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };

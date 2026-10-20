// End-to-end check of scrolling a note's content inside a box too small for it (note.scrollY), and of the
// back arrow in the two-step note picker. Run inside Obsidian (via scripts/e2e/run.mjs).
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
	await vault.create(`${DIR}/Long.md`, Array.from({ length: 12 }, (_, i) => `## Part ${i + 1}\n\n${'word '.repeat(40)}`).join('\n\n'));
	const file = await app.plugins.plugins.patchwork.createBoard(vault.getAbstractFileByPath(DIR));
	await sleep(300);
	const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === file);
	app.workspace.setActiveLeaf(app.workspace.getLeavesOfType('patchwork-board').find((l) => l.view === view), { focus: true });
	const pageId = view.store.file.pages[0].id;
	view.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], modules: [{ id: 'n', type: 'note', file: `${DIR}/Long.md`, x: 10, y: 10, w: 90, h: 50 }] }] }));
	view.surface.zoomToFit();
	await sleep(800);
	const mod = () => view.contentEl.querySelector('.pw-module[data-module-id="n"]');
	const content = () => mod().querySelector('.pw-markdown');
	const wheel = (dy) => mod().dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true }));
	const scrollY = () => view.store.file.pages[0].modules[0].scrollY;
	await until(() => mod().hasClass('is-overflowing'));

	const cam = JSON.stringify(view.surface.camera);
	wheel(100);
	check('wheel over a note that is not selected pans the board, not the note', scrollY() === undefined && JSON.stringify(view.surface.camera) !== cam);

	view.surface.select({ pageId, moduleId: 'n' });
	await sleep(300);
	const camSel = JSON.stringify(view.surface.camera);
	for (let i = 0; i < 3; i++) wheel(100);
	await sleep(300);
	check('wheel over the selected note scrolls its content and leaves the board alone', scrollY() > 0 && JSON.stringify(view.surface.camera) === camSel, scrollY());
	check('the content is shifted up by the stored amount', parseFloat(getComputedStyle(content()).marginTop) < -1, getComputedStyle(content()).marginTop);

	for (let i = 0; i < 100; i++) wheel(400);
	await sleep(300);
	const box = content().parentElement.getBoundingClientRect();
	check('scrolling stops when the end of the note is at the bottom edge', Math.abs(content().getBoundingClientRect().bottom - box.bottom) <= 2, [content().getBoundingClientRect().bottom, box.bottom]);

	view.store.undo();
	await sleep(300);
	check('a burst of wheel ticks is one undo step', scrollY() === undefined, scrollY());

	view.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], modules: [{ ...f.pages[0].modules[0], scrollY: 30 }] }] }));
	await sleep(500);
	check('a stored scroll offset is applied on load', parseFloat(getComputedStyle(content()).marginTop) < -50, getComputedStyle(content()).marginTop);

	// The back arrow of the section step returns to the note step.
	view.surface.pickNote();
	await sleep(400);
	const input = () => document.querySelector('.prompt-input');
	input().value = 'Fireball';
	input().dispatchEvent(new Event('input'));
	await sleep(300);
	input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	await sleep(400);
	const back = document.querySelector('.pw-picker-back');
	check('the section step has a back arrow', !!back && input().placeholder.startsWith('Pick a section'), input()?.placeholder);
	back?.click();
	await sleep(400);
	check('the back arrow returns to choosing the note', input()?.placeholder === 'Note to add' && !document.querySelector('.pw-picker-back'), input()?.placeholder);
	input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	await sleep(200);
} catch (e) {
	check('no exception', false, String(e?.stack ?? e));
} finally {
	document.querySelectorAll('.modal-container').forEach((m) => m.querySelector('.prompt-input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
	app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
	await sleep(400);
	const dir = vault.getAbstractFileByPath(DIR);
	if (dir) await vault.delete(dir, true);
}
return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };

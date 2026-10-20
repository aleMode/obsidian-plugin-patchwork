// End-to-end check of Use mode (docs/use-mode-plan.md) with real mouse input: switching and remembering
// the mode, nothing moves, chrome hidden, links open in one reused side pane, checkboxes write back
// (note line, text box), frozen notes refuse, colours (tint) on cards.
import { connect } from '../cdpClient.mjs';

const cdp = await connect();
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const V = `const L = app.workspace.getLeavesOfType('patchwork-board').find((l) => l.view.file?.path.startsWith('_e2e/')); const v = L.view; const s = v.surface; const mod = (id) => v.store.file.pages[0].modules.find((m) => m.id === id);`;
const ev = (body) => cdp.evaluate(`${V} ${body}`);
const wait = (ms) => `await new Promise((r) => setTimeout(r, ${ms}));`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => {
	const t = Date.now();
	while (Date.now() - t < ms) {
		if (await fn()) return true;
		await sleep(250);
	}
	return false;
};
/** Centre of the first element matching `sel` (screen pixels). */
const centre = (sel) => ev(`const el = document.querySelector('${sel}'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
const click = async (p) => {
	await cdp.mouse('mouseMoved', p.x, p.y, { button: 'none' });
	await cdp.mouse('mousePressed', p.x, p.y);
	await cdp.mouse('mouseReleased', p.x, p.y);
};
const NOTE = '_e2e/Tasks.md';
const read = () => cdp.evaluate(`return app.vault.read(app.vault.getAbstractFileByPath('${NOTE}'));`);

try {
	await cdp.evaluate(`
		const vv = app.vault;
		for (const l of app.workspace.getLeavesOfType('patchwork-board')) l.detach();
		await new Promise((r) => setTimeout(r, 400));
		if (vv.getAbstractFileByPath('_e2e')) await vv.delete(vv.getAbstractFileByPath('_e2e'), true);
		await vv.createFolder('_e2e');
		await vv.create('${NOTE}', '# Tasks\\n\\n## Today\\n\\n- [ ] first\\n- [ ] second, see [[Goblin]]\\n\\n> [!note]\\n> - [x] in a callout\\n\\n## Later\\n\\n- [ ] later\\n');
		await app.plugins.plugins.patchwork.createBoard(vv.getAbstractFileByPath('_e2e'));
		await new Promise((r) => setTimeout(r, 800));
		${V} app.workspace.setActiveLeaf(L, { focus: true });
		v.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], id: 'a', name: 'Front', modules: [
			{ id: 'n', type: 'note', file: '${NOTE}', subpath: '#Today', x: 10, y: 10, w: 120, h: 70, style: { tint: '4' } },
			{ id: 't', type: 'text', markdown: '- [ ] box task', x: 10, y: 90, w: 80, h: 20, style: { tint: '#3366cc' } },
			{ id: 'f', type: 'note', file: '${NOTE}', subpath: '#Later', x: 10, y: 120, w: 80, h: 30, frozen: { at: '2026-10-20', markdown: '- [ ] later' } }] }] }));
		s.zoomToFit(); await new Promise((r) => setTimeout(r, 1200));`);

	check('a new patchwork opens in Arrange', !(await ev('return s.inUseMode;')));
	await ev(`document.querySelectorAll('.pw-mode-switch button')[1].click(); ${wait(400)}`);
	check('the Use button switches to Use mode', await ev('return s.inUseMode && v.contentEl.querySelector(".pw-surface-host").classList.contains("pw-use");'));
	check('the mode is stored in the patchwork', (await ev('return v.store.file.board.mode;')) === 'use');
	check('switching is not an undo step', !(await ev('return v.store.canUndo && v.store.file.board.mode !== "use";')));
	check('rulers, labels and editing toolbar buttons are hidden', await ev(`const h = (sel) => !document.querySelector(sel) || getComputedStyle(document.querySelector(sel)).display === 'none'; return h('.pw-ruler-top') && h('.pw-page-labels') && h('.pw-toolbar .pw-arrange-only');`));
	check('pages drop the white paper (app theme)', await ev(`return !document.querySelector('.pw-page-paper').classList.contains('pw-paper');`));
	check('tinted modules are cards', await ev(`const el = document.querySelector('.pw-module[data-module-id="n"]'); return el.classList.contains('has-tint') && getComputedStyle(el).boxShadow.includes('inset');`));

	// Nothing moves: a drag across a module pans the board instead; its position is unchanged.
	const before = await ev('return { x: mod("n").x, y: mod("n").y, tx: s.camera.tx };');
	const paper = await ev(`const r = document.querySelector('.pw-page-paper').getBoundingClientRect(); return { x: r.right - 20, y: r.bottom - 20 };`);
	await cdp.drag(paper, { x: paper.x - 60, y: paper.y }, { steps: 6 });
	await sleep(300);
	const after = await ev('return { x: mod("n").x, y: mod("n").y, tx: s.camera.tx, sel: s.selectedItems.length };');
	check('dragging the page pans, nothing moves or gets selected', after.x === before.x && after.y === before.y && Math.abs(after.tx - before.tx + 60) < 2 && after.sel === 0, { before, after });
	await ev(`s.select({ pageId: 'a', moduleId: 'n' }); ${wait(100)}`);
	check('selection is off in Use mode', (await ev('return s.selectedItems.length;')) === 0);

	// Links: open to the side, the same pane each time.
	await until(async () => !!(await centre('.pw-module[data-module-id="n"] a.internal-link')));
	await click(await centre('.pw-module[data-module-id="n"] a.internal-link'));
	check('a link opens its note in a side pane', await until(async () => (await cdp.evaluate(`return app.workspace.getLeavesOfType('markdown').some((l) => l.view.file?.path === 'Monsters/Goblin.md');`))));
	await ev(`app.workspace.setActiveLeaf(L, { focus: true }); ${wait(200)}`);
	await click(await centre('.pw-module[data-module-id="n"] a.internal-link'));
	await sleep(600);
	check('a second click reuses that pane', (await cdp.evaluate(`return app.workspace.getLeavesOfType('markdown').filter((l) => l.view.file?.path === 'Monsters/Goblin.md').length;`)) === 1);
	await ev(`for (const l of app.workspace.getLeavesOfType('markdown')) if (l.view.file?.path === 'Monsters/Goblin.md') l.detach(); app.workspace.setActiveLeaf(L, { focus: true }); ${wait(300)}`);

	// Checkboxes: the second task of the #Today section is ticked in the file, nothing else changes.
	const original = await read();
	await click(await centre('.pw-module[data-module-id="n"] li.task-list-item:nth-of-type(2) input.task-list-item-checkbox'));
	check('ticking a note checkbox writes that line', await until(async () => (await read()) === original.replace('- [ ] second', '- [x] second')), await read());
	// The module re-renders from the file before the next tick (until then a click is refused as stale).
	await until(async () => (await ev(`return s.modules.shownMarkdown('n') ?? '';`)).includes('- [x] second'));
	await click(await centre('.pw-module[data-module-id="n"] li.task-list-item:nth-of-type(2) input.task-list-item-checkbox'));
	check('and unticking writes it back', await until(async () => (await read()) === original), await read());

	await click(await centre('.pw-module[data-module-id="t"] input.task-list-item-checkbox'));
	check('a text box checkbox ticks in the patchwork', await until(async () => (await ev('return mod("t").markdown;')) === '- [x] box task'));
	await ev(`v.store.undo(); ${wait(200)}`);
	check('which undoes like any edit', (await ev('return mod("t").markdown;')) === '- [ ] box task');

	await click(await centre('.pw-module[data-module-id="f"] input.task-list-item-checkbox'));
	await sleep(500);
	check('a frozen note refuses (file and box unchanged)', (await read()) === original && !(await ev(`return document.querySelector('.pw-module[data-module-id="f"] input.task-list-item-checkbox').checked;`)));

	// Back to Arrange: content stops taking the pointer, selection works again.
	await ev(`document.querySelectorAll('.pw-mode-switch button')[0].click(); ${wait(300)}`);
	check('Arrange again: mode cleared from the file', (await ev('return s.inUseMode || v.store.file.board.mode !== undefined;')) === false);
	await ev(`s.select({ pageId: 'a', moduleId: 'n' }); ${wait(100)}`);
	check('selection works in Arrange', (await ev('return s.selectedItems.length;')) === 1);
	check('tints show in Arrange too', await ev(`return document.querySelector('.pw-module[data-module-id="t"]').classList.contains('has-tint');`));
} catch (e) {
	check('no exception', false, String(e.stack ?? e));
} finally {
	await cdp
		.evaluate(`for (const l of app.workspace.getLeavesOfType('patchwork-board')) if (l.view.file?.path.startsWith('_e2e/')) l.detach();
			for (const l of app.workspace.getLeavesOfType('markdown')) if (l.view.file?.path === 'Monsters/Goblin.md') l.detach();
			await new Promise((r) => setTimeout(r, 500));
			const d = app.vault.getAbstractFileByPath('_e2e'); if (d) await app.vault.delete(d, true);`)
		.catch(() => {});
	cdp.close();
}
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed }, null, 2));
process.exitCode = failed.length ? 1 : 0;

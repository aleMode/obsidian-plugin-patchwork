// End-to-end check of multi-selection with real input: shift-click, group drag, marquee, align, distribute.
import { connect, MOD } from '../cdpClient.mjs';

const cdp = await connect();
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inView = (body) =>
	cdp.evaluate(`const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file?.path.startsWith('_e2e/')); const s = view.surface; ${body}`);
const rectOf = (id) => inView(`const r = view.contentEl.querySelector('.pw-module[data-module-id="${id}"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };`);
const mods = () => inView('return Object.fromEntries(view.store.file.pages[0].modules.map((m) => [m.id, [m.x, m.y]]));');
async function click(p, modifiers = 0) {
	await cdp.mouse('mouseMoved', p.x, p.y, { button: 'none', modifiers });
	await cdp.mouse('mousePressed', p.x, p.y, { modifiers });
	await cdp.mouse('mouseReleased', p.x, p.y, { modifiers });
	await sleep(60);
}

try {
	await cdp.evaluate(`
		const v = app.vault;
		if (v.getAbstractFileByPath('_e2e')) await v.delete(v.getAbstractFileByPath('_e2e'), true);
		await v.createFolder('_e2e');
		await app.plugins.plugins.patchwork.createBoard(v.getAbstractFileByPath('_e2e'));
		await new Promise((r) => setTimeout(r, 400));`);
	await inView(`view.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], modules: [
		{ id: 'a', type: 'text', markdown: 'A', x: 10, y: 10, w: 30, h: 20 },
		{ id: 'b', type: 'text', markdown: 'B', x: 60, y: 40, w: 30, h: 20 },
		{ id: 'c', type: 'text', markdown: 'C', x: 150, y: 70, w: 30, h: 20 },
	] }] })); s.zoomToFit(); await new Promise((r) => setTimeout(r, 300));`);
	const k = (96 / 25.4) * (await inView('return s.camera.zoom;'));
	const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

	await click(center(await rectOf('a')));
	await click(center(await rectOf('b')), MOD.shift);
	let sel = await inView('return s.selectedItems.map((i) => i.moduleId);');
	check('shift-click adds to the selection', JSON.stringify(sel) === '["a","b"]', sel);
	check('no resize handles for a multi-selection', await inView("return view.contentEl.querySelector('.pw-selection').hasClass('is-hidden');"));

	const from = center(await rectOf('a'));
	await cdp.drag(from, { x: from.x + 20 * k, y: from.y + 10 * k });
	await sleep(100);
	let m = await mods();
	check('dragging one moves the whole selection', m.a[0] === 30 && m.a[1] === 20 && m.b[0] === 80 && m.b[1] === 50 && m.c[0] === 150, m);
	await cdp.key('z', 'KeyZ', MOD.ctrl);
	await sleep(50);
	m = await mods();
	check('group drag undoes in one step', m.a[0] === 10 && m.b[0] === 60, m);

	await inView("s.align('left');");
	m = await mods();
	check('align left', m.a[0] === 10 && m.b[0] === 10, m);
	await cdp.key('z', 'KeyZ', MOD.ctrl);

	// Marquee: shift-drag from empty paper around all three modules.
	const page = await inView("const r = view.contentEl.querySelector('.pw-page-paper').getBoundingClientRect(); return { x: r.x, y: r.y };");
	await cdp.drag({ x: page.x + 2 * k, y: page.y + 2 * k }, { x: page.x + 200 * k, y: page.y + 100 * k }, { modifiers: MOD.shift });
	await sleep(100);
	sel = await inView('return s.selectedItems.map((i) => i.moduleId).sort();');
	check('shift-drag marquee selects the modules it touches', JSON.stringify(sel) === '["a","b","c"]', sel);

	await inView("s.distribute('h');");
	m = await mods();
	// Span 10..180, sizes 90 → gap 40: a 10, b 80, c 150.
	check('distribute horizontally', m.a[0] === 10 && m.b[0] === 80 && m.c[0] === 150, m);

	await cdp.key('ArrowDown', 'ArrowDown');
	m = await mods();
	check('arrow nudges every selected module', m.a[1] === 11 && m.b[1] === 41 && m.c[1] === 71, m);

	await cdp.key('Delete', 'Delete');
	await sleep(50);
	check('Delete removes the whole selection', (await inView('return view.store.file.pages[0].modules.length;')) === 0);
	await cdp.key('z', 'KeyZ', MOD.ctrl);
	check('undo restores all of them', (await inView('return view.store.file.pages[0].modules.length;')) === 3);
} catch (e) {
	check('no exception', false, String(e.stack ?? e));
} finally {
	await cdp
		.evaluate(`app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
		await new Promise((r) => setTimeout(r, 400));
		const d = app.vault.getAbstractFileByPath('_e2e'); if (d) await app.vault.delete(d, true);`)
		.catch(() => {});
	cdp.close();
}
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed }, null, 2));
process.exitCode = failed.length ? 1 : 0;

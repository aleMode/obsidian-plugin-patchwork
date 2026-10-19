// End-to-end check of editing actions with real input: resize handles, duplicate, nudge, lock.
import { connect, MOD } from '../cdpClient.mjs';

const cdp = await connect();
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inView = (body) =>
	cdp.evaluate(`const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file?.path.startsWith('_e2e/')); const s = view.surface; ${body}`);
const rectOf = (sel) => inView(`const r = view.contentEl.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };`);
const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

try {
	await cdp.evaluate(`
		const v = app.vault;
		if (v.getAbstractFileByPath('_e2e')) await v.delete(v.getAbstractFileByPath('_e2e'), true);
		await v.createFolder('_e2e');
		await app.plugins.plugins.patchwork.createBoard(v.getAbstractFileByPath('_e2e'));
		await new Promise((r) => setTimeout(r, 400));`);
	await inView(`view.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], modules: [{ id: 'txt', type: 'text', markdown: 'hello', x: 20, y: 20, w: 50, h: 30 }] }] }));
		s.zoomToFit(); await new Promise((r) => setTimeout(r, 300));`);
	const zoom = await inView('return s.camera.zoom;');
	const pxPerMm = (96 / 25.4) * zoom;

	// Select the module, then drag its south-east handle by +20 mm, +10 mm (snaps to 5 mm grid).
	const mod = await rectOf('.pw-module[data-module-id="txt"]');
	await cdp.mouse('mousePressed', mod.x + 5, mod.y + 5);
	await cdp.mouse('mouseReleased', mod.x + 5, mod.y + 5);
	await sleep(100);
	const se = await rectOf('.pw-handle-se');
	await cdp.drag(center(se), { x: center(se).x + 20 * pxPerMm, y: center(se).y + 10 * pxPerMm });
	await sleep(100);
	let m = await inView("return view.store.file.pages[0].modules.find((x) => x.id === 'txt');");
	check('SE handle resizes the module, snapped', m.w === 70 && m.h === 40 && m.x === 20 && m.y === 20, m);
	await cdp.key('z', 'KeyZ', MOD.ctrl);
	await sleep(50);
	m = await inView("return view.store.file.pages[0].modules.find((x) => x.id === 'txt');");
	check('one undo reverts the resize', m.w === 50 && m.h === 30, m);

	// Arrow nudge: 1 mm, Shift 10 mm.
	await cdp.key('ArrowRight', 'ArrowRight');
	await cdp.key('ArrowDown', 'ArrowDown', MOD.shift);
	await sleep(50);
	m = await inView("return view.store.file.pages[0].modules.find((x) => x.id === 'txt');");
	check('arrow keys nudge by 1 / 10 mm', m.x === 21 && m.y === 30, m);

	// Duplicate.
	await cdp.key('d', 'KeyD', MOD.ctrl);
	await sleep(100);
	const mods = await inView('return view.store.file.pages[0].modules.map((x) => [x.id, x.x, x.y]);');
	check('Ctrl+D duplicates with an offset and a new ID', mods.length === 2 && mods[1][0] !== 'txt' && mods[1][1] === 26 && mods[1][2] === 35, mods);

	// Resize the page from its east edge.
	await inView("s.select({ pageId: view.store.file.pages[0].id }); await new Promise((r) => setTimeout(r, 50));");
	const e = await rectOf('.pw-handle-e');
	await cdp.drag(center(e), { x: center(e).x + 30 * pxPerMm, y: center(e).y });
	await sleep(100);
	const page = await inView('const p = view.store.file.pages[0]; return { w: p.w, h: p.h };');
	check('page E handle widens the page', page.w === 240 && page.h === 297, page);

	// Locked modules lose their handles and don't move.
	await inView("view.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], modules: f.pages[0].modules.map((x) => x.id === 'txt' ? { ...x, locked: true } : x) }] })); s.select({ pageId: view.store.file.pages[0].id, moduleId: 'txt' }); await new Promise((r) => setTimeout(r, 50));");
	const hidden = await inView("return view.contentEl.querySelector('.pw-selection').hasClass('is-hidden');");
	check('locked module shows no handles', hidden);
	await cdp.key('ArrowRight', 'ArrowRight');
	m = await inView("return view.store.file.pages[0].modules.find((x) => x.id === 'txt');");
	check('locked module ignores nudges', m.x === 21, m);
} catch (e) {
	check('no exception', false, String(e.stack ?? e));
} finally {
	await cdp
		.evaluate(`app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
		const d = app.vault.getAbstractFileByPath('_e2e'); if (d) await app.vault.delete(d, true);`)
		.catch(() => {});
	cdp.close();
}
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed }, null, 2));
process.exitCode = failed.length ? 1 : 0;

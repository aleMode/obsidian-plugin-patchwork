// End-to-end check of saved views and the minimap (SPEC 4 M3), with real input on the minimap.
import { connect } from '../cdpClient.mjs';

const cdp = await connect();
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inView = (body) =>
	cdp.evaluate(`const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file?.path.startsWith('_e2e/')); const s = view.surface; ${body}`);

try {
	await cdp.evaluate(`
		const v = app.vault;
		if (v.getAbstractFileByPath('_e2e')) await v.delete(v.getAbstractFileByPath('_e2e'), true);
		await v.createFolder('_e2e');
		await app.plugins.plugins.patchwork.createBoard(v.getAbstractFileByPath('_e2e'));
		await new Promise((r) => setTimeout(r, 400));`);
	await inView(`view.store.update((f) => ({ ...f, pages: [f.pages[0], { id: 'far', name: 'Far', x: 2000, y: 1500, w: 210, h: 297, modules: [] }] }));
		s.zoomToFit(); await new Promise((r) => setTimeout(r, 300));`);

	// Save a view zoomed on the far page, move away, come back.
	await inView(`s.select({ pageId: 'far' }); s.revealSelection(); await new Promise((r) => setTimeout(r, 200)); s.saveView('Far page'); s.select(null); s.zoomToFit(); await new Promise((r) => setTimeout(r, 200));`);
	const saved = await inView('return view.store.file.views;');
	check('view saved in the board', saved?.length === 1 && saved[0].name === 'Far page', saved);
	const id = saved?.[0]?.id;
	await inView(`s.goToView('${id}'); await new Promise((r) => setTimeout(r, 200));`);
	const centre = await inView("const vp = { w: s.root.clientWidth, h: s.root.clientHeight }; const c = s.camera; const k = (96 / 25.4) * c.zoom; return { x: (vp.w / 2 - c.tx) / k, y: (vp.h / 2 - c.ty) / k };");
	check('going to the view centres the far page', Math.abs(centre.x - 2105) < 5 && Math.abs(centre.y - 1648.5) < 5, centre);
	await inView(`s.renameView('${id}', 'Renamed'); await new Promise((r) => setTimeout(r, 50));`);
	check('rename', (await inView('return view.store.file.views[0].name;')) === 'Renamed');
	await sleep(2600);
	const disk = await cdp.evaluate("return JSON.parse(await app.vault.read(app.vault.getAbstractFileByPath('_e2e/Untitled board.patchwork'))).views;");
	check('views saved to the file', disk?.[0]?.name === 'Renamed', disk);
	await inView(`s.deleteView('${id}');`);
	check('delete removes the key', (await inView('return view.store.file.views === undefined;')));

	// Minimap: click on the far page's spot pans the camera there.
	await inView("if (view.contentEl.querySelector('.pw-minimap').hasClass('is-hidden')) s.toggleMinimap(); s.zoomToFit(); await new Promise((r) => setTimeout(r, 300));");
	const mm = await inView("const r = view.contentEl.querySelector('.pw-minimap').getBoundingClientRect(); const f = s.minimapFrame; return { x: r.x, y: r.y, fx: f.x, fy: f.y, k: f.k };");
	const target = { x: mm.x + mm.fx + 2105 * mm.k, y: mm.y + mm.fy + 1648 * mm.k };
	await cdp.mouse('mousePressed', target.x, target.y);
	await cdp.mouse('mouseReleased', target.x, target.y);
	await sleep(200);
	const c2 = await inView("const vp = { w: s.root.clientWidth, h: s.root.clientHeight }; const c = s.camera; const k = (96 / 25.4) * c.zoom; return { x: (vp.w / 2 - c.tx) / k, y: (vp.h / 2 - c.ty) / k };");
	check('clicking the minimap centres that spot', Math.abs(c2.x - 2105) < 60 && Math.abs(c2.y - 1648) < 60, c2);
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

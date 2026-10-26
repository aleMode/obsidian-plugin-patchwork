// Shapes with real input: drawing by dragging, hit-testing (only painted pixels take clicks),
// line endpoint handles, Shift constraints, undo and the properties form.
import { connect, MOD } from '../cdpClient.mjs';

const cdp = await connect();
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inView = (body) =>
	cdp.evaluate(`const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file?.path.startsWith('_e2e/')); const s = view.surface; ${body}`);
const mods = () => inView('return view.store.file.pages[0].modules;');
const close = (a, b, eps = 0.6) => Math.abs(a - b) <= eps;

try {
	await cdp.evaluate(`
		const v = app.vault;
		if (v.getAbstractFileByPath('_e2e')) await v.delete(v.getAbstractFileByPath('_e2e'), true);
		await v.createFolder('_e2e');
		await app.plugins.plugins.patchwork.createBoard(v.getAbstractFileByPath('_e2e'));
		await new Promise((r) => setTimeout(r, 400));`);
	await inView(`view.store.update((f) => ({ ...f, board: { ...f.board, grid: { ...f.board.grid, snap: false } } })); s.zoomToFit(); await new Promise((r) => setTimeout(r, 300));`);
	const origin = await inView("const r = view.contentEl.querySelector('.pw-page-paper').getBoundingClientRect(); return { x: r.x, y: r.y };");
	const k = (96 / 25.4) * (await inView('return s.camera.zoom;'));
	const at = (x, y) => ({ x: origin.x + x * k, y: origin.y + y * k });
	// The Shape menu's presets (src/model/shapes.ts), armed through the viewport.
	const PRESETS = { rect: { shape: 'rect' }, ellipse: { shape: 'ellipse' }, line: { shape: 'line' }, arrow: { shape: 'line', endHead: 'arrow' } };
	const pick = (id) => inView(`s.setTool({ id: ${JSON.stringify(id)}, label: ${JSON.stringify(id)}, icon: 'x', fields: ${JSON.stringify(PRESETS[id])} }); return s.tool?.id;`);

	// Draw a rectangle by dragging.
	check('arming the tool shows the drawing cursor', (await pick('rect')) === 'rect' && (await inView("return view.contentEl.querySelector('.pw-board').hasClass('is-drawing');")));
	await cdp.drag(at(20, 30), at(80, 70));
	await sleep(100);
	let m = await mods();
	check('dragging draws a rectangle with the dragged box', m.length === 1 && m[0].type === 'shape' && m[0].shape === 'rect' && close(m[0].x, 20) && close(m[0].y, 30) && close(m[0].w, 60) && close(m[0].h, 40), m);
	check('the tool disarms after one shape and the shape is selected', (await inView('return s.tool;')) === null && (await inView('return s.selectedItems.map((i) => i.moduleId);')).join() === m[0]?.id);
	check('the SVG is drawn', await inView("return !!view.contentEl.querySelector('.pw-module .pw-shape-svg rect.pw-shape-paint');"));

	// One undo step for the whole gesture.
	await cdp.key('z', 'KeyZ', MOD.ctrl);
	await sleep(80);
	check('drawing undoes in one step', (await mods()).length === 0);
	await cdp.key('y', 'KeyY', MOD.ctrl);
	await sleep(80);
	check('and redoes', (await mods()).length === 1);

	// Hit-testing: an unfilled rectangle takes clicks on its outline only.
	await inView('s.select(null);');
	const id = m[0].id;
	const insideHit = await inView(`const r = view.contentEl.querySelector('.pw-page-paper').getBoundingClientRect(); const k = ${k}; const el = document.elementFromPoint(r.x + 50 * k, r.y + 50 * k); return el?.closest('.pw-module')?.dataset.moduleId ?? el?.className;`);
	check('the empty inside of an unfilled rectangle does not take clicks', insideHit !== id, insideHit);
	const edgeHit = await inView(`const r = view.contentEl.querySelector('.pw-page-paper').getBoundingClientRect(); const k = ${k}; const el = document.elementFromPoint(r.x + 20.4 * k, r.y + 50 * k); return el?.closest('.pw-module')?.dataset.moduleId;`);
	check('its outline does', edgeHit === id, edgeHit);
	await cdp.mouse('mouseMoved', at(20.3, 50).x, at(20.3, 50).y, { button: 'none' });
	await cdp.mouse('mousePressed', at(20.3, 50).x, at(20.3, 50).y);
	await cdp.mouse('mouseReleased', at(20.3, 50).x, at(20.3, 50).y);
	await sleep(80);
	check('clicking the outline selects it', (await inView('return s.selectedItems.map((i) => i.moduleId).join();')) === id);

	// Fill makes the inside clickable.
	await inView(`view.store.update((f) => ({ ...f, pages: f.pages.map((p) => ({ ...p, modules: p.modules.map((x) => ({ ...x, fill: '#fcc419' })) })) }));`);
	await sleep(120);
	const filledHit = await inView(`const r = view.contentEl.querySelector('.pw-page-paper').getBoundingClientRect(); const k = ${k}; const el = document.elementFromPoint(r.x + 50 * k, r.y + 50 * k); return el?.closest('.pw-module')?.dataset.moduleId;`);
	check('a filled rectangle takes clicks inside', filledHit === id, filledHit);

	// Ellipse, Shift = circle.
	await pick('ellipse');
	await cdp.drag(at(100, 30), at(150, 50), { modifiers: MOD.shift });
	await sleep(100);
	m = await mods();
	const ell = m[1];
	check('Shift draws a circle', ell?.shape === 'ellipse' && close(ell.w, ell.h) && close(ell.w, 50), ell);

	// Arrow: Shift keeps 45° steps; endpoint handles replace the box handles.
	await pick('arrow');
	await cdp.drag(at(20, 120), at(100, 128), { modifiers: MOD.shift });
	await sleep(100);
	m = await mods();
	const arrow = m[2];
	check('a Shift-drawn arrow is horizontal in a thin box', arrow?.shape === 'line' && arrow.endHead === 'arrow' && close(arrow.h, 1, 0.01) && arrow.p1[1] === 0.5 && arrow.p2[1] === 0.5, arrow);
	check('a line shows endpoint handles, not box handles', await inView(`const sel = view.contentEl.querySelector('.pw-selection'); const vis = (e) => getComputedStyle(e).display !== 'none'; return sel.hasClass('is-line') && [...sel.querySelectorAll('.pw-endpoint')].every(vis) && ![...sel.querySelectorAll('.pw-handle')].some(vis);`));

	// Hit-test along the diagonal: a diagonal line does not block the corner of its box.
	await pick('line');
	await cdp.drag(at(120, 150), at(190, 250));
	await sleep(100);
	m = await mods();
	const diag = m[3];
	const cornerHit = await inView(`const r = view.contentEl.querySelector('.pw-page-paper').getBoundingClientRect(); const k = ${k}; const el = document.elementFromPoint(r.x + 185 * k, r.y + 155 * k); return el?.closest('.pw-module')?.dataset.moduleId ?? null;`);
	check('the empty corner of a diagonal line does not take clicks', cornerHit !== diag?.id, cornerHit);
	const midHit = await inView(`const r = view.contentEl.querySelector('.pw-page-paper').getBoundingClientRect(); const k = ${k}; const el = document.elementFromPoint(r.x + 155 * k, r.y + 200 * k); return el?.closest('.pw-module')?.dataset.moduleId ?? null;`);
	check('the line itself does', midHit === diag?.id, midHit);

	// Drag the line's end handle: the other end stays put, Shift snaps to 45°.
	const end2 = await inView("const e = view.contentEl.querySelector('.pw-endpoint[data-end=\"2\"]').getBoundingClientRect(); return { x: e.x + e.width / 2, y: e.y + e.height / 2 };");
	await cdp.drag(end2, at(190, 200), { modifiers: 0 });
	await sleep(100);
	m = await mods();
	const moved = m[3];
	const pts = [moved.p1, moved.p2].map(([fx, fy]) => ({ x: moved.x + fx * moved.w, y: moved.y + fy * moved.h }));
	check('dragging an endpoint moves that end and keeps the other', close(pts[0].x, 120) && close(pts[0].y, 150) && close(pts[1].x, 190) && close(pts[1].y, 200), pts);
	check('and the whole drag is one undo step', await (async () => {
		await cdp.key('z', 'KeyZ', MOD.ctrl);
		await sleep(80);
		const back = (await mods())[3];
		return close(back.w, 70) && close(back.h, 100);
	})());

	// Click without dragging places a default-sized shape.
	await pick('rect');
	const before = (await mods()).length;
	await cdp.mouse('mouseMoved', at(60, 200).x, at(60, 200).y, { button: 'none' });
	await cdp.mouse('mousePressed', at(60, 200).x, at(60, 200).y);
	await cdp.mouse('mouseReleased', at(60, 200).x, at(60, 200).y);
	await sleep(100);
	m = await mods();
	const clicked = m[m.length - 1];
	check('a click places a 40 × 30 mm shape centred there', m.length === before + 1 && close(clicked.w, 40) && close(clicked.h, 30) && close(clicked.x, 40) && close(clicked.y, 185), clicked);

	// Escape cancels the tool.
	await pick('ellipse');
	await cdp.key('Escape', 'Escape');
	await sleep(50);
	check('Escape disarms the tool', (await inView('return s.tool;')) === null);

	// Context bar and properties for a selected shape.
	await inView(`s.select({ pageId: view.store.file.pages[0].id, moduleId: ${JSON.stringify(id)} });`);
	await sleep(450);
	await cdp.evaluate("document.querySelector('.pw-context-pill')?.click();");
	await sleep(200);
	const tips = await inView("return [...view.contentEl.querySelectorAll('.pw-context-bar [aria-label]')].map((e) => e.getAttribute('aria-label'));");
	check('the context bar offers fill, outline, thickness, style and corners', ['Fill colour', 'Outline colour', 'Line thickness', 'Solid, dashed or dotted', 'Corners'].every((t) => tips.includes(t)), tips);
	check('and no card colour for shapes', !tips.includes('Colour'), tips);

} catch (e) {
	check('no exception', false, String(e?.stack ?? e));
} finally {
	await cdp.evaluate(`
		app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
		await new Promise((r) => setTimeout(r, 400));
		const dir = app.vault.getAbstractFileByPath('_e2e');
		if (dir) await app.vault.delete(dir, true);`);
	cdp.close();
}
console.log(JSON.stringify({ passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) }));

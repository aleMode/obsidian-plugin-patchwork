// End-to-end check of the board viewport with real mouse and keyboard input:
//   node scripts/e2e/board.mjs
// Needs Obsidian running (scripts/launchObsidian.sh) with the dev build loaded.
import { connect, MOD } from '../cdpClient.mjs';

const cdp = await connect();
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Evaluate with `view` (the active board view) and `s` (its viewport) in scope. */
const inView = (body) =>
	cdp.evaluate(`const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file?.path.startsWith('_e2e/')); const s = view.surface; ${body}`);
const pageRect = (i) =>
	inView(`const r = view.contentEl.querySelectorAll('.pw-page-paper')[${i}].getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };`);
const page = (i) => inView(`const p = view.store.file.pages[${i}]; return { x: p.x, y: p.y };`);

try {
	await cdp.evaluate(`
		const v = app.vault;
		if (v.getAbstractFileByPath('_e2e')) await v.delete(v.getAbstractFileByPath('_e2e'), true);
		await v.createFolder('_e2e');
		await app.plugins.plugins.patchwork.createBoard(v.getAbstractFileByPath('_e2e'));
		await new Promise((r) => setTimeout(r, 400));`);
	await inView(`s.addPage({ w: 297, h: 210 }); s.zoomToFit(); await new Promise((r) => setTimeout(r, 200));`);

	// Page drawn at real size: on-screen width / zoom = 210 mm at 96 dpi.
	const zoom = await inView('return s.camera.zoom;');
	const r0 = await pageRect(0);
	check('page drawn at real size for the zoom', Math.abs(r0.w / zoom - (210 * 96) / 25.4) < 1, { w: r0.w, zoom });

	// Drag snaps to the 5 mm grid.
	const pxPerMm = (96 / 25.4) * zoom;
	const from = { x: r0.x + r0.w / 2, y: r0.y + r0.h / 2 };
	await cdp.drag(from, { x: from.x + 53 * pxPerMm, y: from.y + 22 * pxPerMm });
	await sleep(100);
	let p = await page(0);
	check('drag moves the page and snaps to the grid', p.x === 55 && p.y === 20, p);

	// Alt bypasses snapping.
	const r1 = await pageRect(0);
	const from2 = { x: r1.x + 20, y: r1.y + 20 };
	await cdp.drag(from2, { x: from2.x + 3 * pxPerMm, y: from2.y + 1.5 * pxPerMm }, { modifiers: MOD.alt });
	await sleep(100);
	p = await page(0);
	check('Alt-drag does not snap', Math.abs(p.x - 58) < 0.5 && Math.abs(p.y - 21.5) < 0.5 && p.x % 5 !== 0, p);

	// One undo per drag (coalescing), via the keyboard.
	await cdp.key('z', 'KeyZ', MOD.ctrl);
	await sleep(50);
	p = await page(0);
	check('Ctrl+Z undoes the whole drag', p.x === 55 && p.y === 20, p);
	await cdp.key('z', 'KeyZ', MOD.ctrl);
	await sleep(50);
	p = await page(0);
	check('second Ctrl+Z returns to the start', p.x === 0 && p.y === 0, p);
	await cdp.key('z', 'KeyZ', MOD.ctrl | MOD.shift);
	await sleep(50);
	p = await page(0);
	check('Ctrl+Shift+Z redoes', p.x === 55 && p.y === 20, p);

	// Ctrl+wheel zooms around the cursor.
	const anchor = { x: r1.x + 100, y: r1.y + 100 };
	const before = await inView(`const r = s.root.getBoundingClientRect(); const c = s.camera; const k = (96 / 25.4) * c.zoom; return { x: (${anchor.x} - r.left - c.tx) / k, y: (${anchor.y} - r.top - c.ty) / k, zoom: c.zoom };`);
	await cdp.wheel(anchor.x, anchor.y, -300, MOD.ctrl);
	await sleep(100);
	const after = await inView(`const r = s.root.getBoundingClientRect(); const c = s.camera; const k = (96 / 25.4) * c.zoom; return { x: (${anchor.x} - r.left - c.tx) / k, y: (${anchor.y} - r.top - c.ty) / k, zoom: c.zoom };`);
	// One event is capped at 10 %, however big its delta (zoomSteps.js covers the steps).
	check('Ctrl+wheel zooms in around the cursor', Math.abs(after.zoom / before.zoom - 1.1) < 0.001 && Math.abs(after.x - before.x) < 0.5 && Math.abs(after.y - before.y) < 0.5, { before, after });

	// Plain wheel pans; page data untouched.
	const cam0 = await inView('return { ...s.camera };');
	await cdp.wheel(anchor.x, anchor.y, 200);
	await sleep(100);
	const cam1 = await inView('return { ...s.camera };');
	check('wheel pans the camera', Math.abs(cam1.ty - (cam0.ty - 200)) < 1 && cam1.zoom === cam0.zoom, { cam0, cam1 });

	// Dragging empty board space pans and deselects.
	await inView('s.zoomToFit(); await new Promise((r) => setTimeout(r, 100));');
	const board = await inView('const r = s.root.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };');
	// Bottom-left: clear of the rulers (top, left) and the minimap (bottom right).
	const empty = { x: board.x + 60, y: board.y + board.h - 30 };
	const camA = await inView('return { ...s.camera };');
	await cdp.drag(empty, { x: empty.x - 100, y: empty.y - 50 });
	await sleep(100);
	const camB = await inView('return { ...s.camera };');
	check('dragging empty space pans', Math.abs(camB.tx - camA.tx + 100) < 2 && Math.abs(camB.ty - camA.ty + 50) < 2, { camA, camB });
	check('pages unchanged by panning', JSON.stringify(await page(0)) === JSON.stringify({ x: 55, y: 20 }));

	// Virtualization: pan far away, pages are culled.
	await inView('s.setCamera({ tx: -1e6, ty: -1e6, zoom: 1 }); await new Promise((r) => setTimeout(r, 100));');
	const culled = await inView("return { visible: s.visiblePages.size, culled: view.contentEl.querySelectorAll('.pw-page.is-culled').length };");
	check('off-screen pages are culled', culled.visible === 0 && culled.culled === 2, culled);
	await inView('s.zoomToFit(); await new Promise((r) => setTimeout(r, 100));');
	check('pages come back when visible', (await inView('return s.visiblePages.size;')) === 2);

	// Delete key removes the selected page; undo restores it.
	const r2 = await pageRect(1);
	await cdp.mouse('mousePressed', r2.x + 10, r2.y + 10);
	await cdp.mouse('mouseReleased', r2.x + 10, r2.y + 10);
	await cdp.key('Delete', 'Delete');
	await sleep(50);
	check('Delete removes the selected page', (await inView('return view.store.file.pages.length;')) === 1);
	await cdp.key('z', 'KeyZ', MOD.ctrl);
	await sleep(50);
	check('undo restores it', (await inView('return view.store.file.pages.length;')) === 2);

	// Saved to disk after the debounce.
	await sleep(2600);
	const saved = await inView('return JSON.parse(await app.vault.read(view.file)).pages.map((p) => [p.x, p.y]);');
	check('changes saved to the file', JSON.stringify(saved) === JSON.stringify([[55, 20], [230, 0]]), saved);

	await cdp.screenshot('.dev/e2e-board.png');
} catch (e) {
	check('no exception', false, String(e.stack ?? e));
} finally {
	await cdp.evaluate(`
		app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
	await new Promise((r) => setTimeout(r, 400)); // let pending saves finish before deleting their files
		const d = app.vault.getAbstractFileByPath('_e2e'); if (d) await app.vault.delete(d, true);`).catch(() => {});
	cdp.close();
}
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed }, null, 2));
process.exitCode = failed.length ? 1 : 0;

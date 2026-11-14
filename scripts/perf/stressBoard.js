// Performance probe against SPEC 8 targets, run inside Obsidian:
//   node scripts/cdp.mjs -f scripts/perf/stressBoard.js
// Generates a 100-page × 3-module board from the test vault (including any PDFs in it), then
// measures first paint, panning frame times, dragging a module, saving, renaming a folder of notes the
// board shows, and memory. Results go in docs/perf.md.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plugin = app.plugins.plugins.patchwork;
const rss = () => Math.round(process.memoryUsage().rss / 2 ** 20);
const longTasks = [];
const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => longTasks.push(Math.round(e.duration))));
po.observe({ type: 'longtask', buffered: false });
const takeLongTasks = () => longTasks.splice(0);

/** Modules in the DOM whose content has arrived (markdown, canvas, loaded image or placeholder). */
function contentState(view, pageId) {
	const scope = pageId ? `.pw-module[data-page-id="${pageId}"] .pw-module-body` : '.pw-module-body';
	const mods = [...view.contentEl.querySelectorAll(scope)];
	const ready = mods.filter((b) => b.querySelector('.pw-markdown > *, canvas, img, .pw-module-placeholder') && !(b.querySelector('img') && !b.querySelector('img').complete));
	return { mounted: mods.length, ready: ready.length };
}

async function untilReady(view, pageId, timeout = 60000) {
	const t0 = performance.now();
	for (;;) {
		const s = contentState(view, pageId);
		if (s.mounted > 0 && s.ready === s.mounted) return { ms: Math.round(performance.now() - t0), ...s };
		if (performance.now() - t0 > timeout) return { ms: null, timedOut: true, ...s };
		await sleep(16);
	}
}

/** Animate the camera along a path and record frame intervals. */
async function panFrames(view, frames, step) {
	const s = view.surface;
	const deltas = [];
	let last = performance.now();
	takeLongTasks();
	for (let i = 0; i < frames; i++) {
		await new Promise((r) => requestAnimationFrame(r));
		const now = performance.now();
		deltas.push(now - last);
		last = now;
		const c = s.camera;
		s.setCamera({ ...c, ...step(c, i) });
	}
	deltas.sort((a, b) => a - b);
	const p = (q) => Math.round(deltas[Math.floor(q * (deltas.length - 1))] * 10) / 10;
	return { frames, p50: p(0.5), p95: p(0.95), max: p(1), over50ms: deltas.filter((d) => d > 50).length, longTasks: takeLongTasks() };
}

const out = { rssStartMB: rss() };
const old = app.vault.getAbstractFileByPath('Stress board 100x3.patchwork');
if (old) await app.vault.delete(old);

// 1. Open: the board opens zoomed to fit, so all 100 pages are visible at once. At that zoom pages
//    show module outlines (level of detail), so "painted" means every page has its outlines.
takeLongTasks();
const t0 = performance.now();
const file = await plugin.createStressBoard(100, 3);
const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === file);
for (;;) {
	if (view?.contentEl.querySelectorAll('.pw-skeletons').length === 100) break;
	if (performance.now() - t0 > 30000) break;
	await sleep(16);
}
out.openWholeBoard = {
	msToAllPagesPainted: Math.round(performance.now() - t0),
	outlinedPages: view.contentEl.querySelectorAll('.pw-skeletons').length,
	mountedModules: view.contentEl.querySelectorAll('.pw-module').length,
	longTasks: takeLongTasks(),
};
out.rssAfterOpenMB = rss();

// 2. Typical working zoom: one page fills the view. Time until visible modules are ready.
const s = view.surface;
const vp = { w: s.root.clientWidth, h: s.root.clientHeight };
const first = view.store.file.pages[0];
const pxPerMm = 96 / 25.4;
const zoom = Math.min(vp.w / (first.w * pxPerMm), vp.h / (first.h * pxPerMm)) * 0.9;
s.setCamera({ zoom: 0.01, tx: -1e6, ty: -1e6 });
await sleep(200);
takeLongTasks();
const t1 = performance.now();
s.setCamera({ zoom, tx: 20, ty: 20 });
out.firstPageAtWorkingZoom = { visiblePage: await untilReady(view, first.id) };
out.firstPageAtWorkingZoom.withPreMountedNeighbours = await untilReady(view);
out.firstPageAtWorkingZoom.longTasks = takeLongTasks();

// 2b. Revisit: pan far away (modules unmount) and back. With the bitmap cache, PDF crops reappear
//     without re-decoding.
s.setCamera({ zoom, tx: -1e6, ty: -1e6 });
await sleep(400);
const t2 = performance.now();
s.setCamera({ zoom, tx: 20, ty: 20 });
out.revisitFirstPage = await untilReady(view, first.id);
out.revisitFirstPage.cache = plugin.bitmaps.stats();
void t2;

// 3. Pan across the first row at that zoom (new pages mount as they come into view).
await sleep(500);
out.panRowWorkingZoom = await panFrames(view, 240, (c) => ({ tx: c.tx - 15 }));
await untilReady(view);

// 4. Pan with everything visible (zoomed out): no mounting, pure transform.
s.zoomToFit();
await sleep(300);
await untilReady(view);
out.panWholeBoard = await panFrames(view, 120, (c, i) => ({ tx: c.tx + (i < 60 ? 4 : -4) }));

// 5. Drag one module for 240 frames at working zoom: one store change per frame, coalesced into one
//    undo step, as a pointer drag does.
s.setCamera({ zoom, tx: 20, ty: 20 });
await sleep(300);
await untilReady(view);
const dragPage = view.store.file.pages[0].id;
const dragId = view.store.file.pages[0].modules[0].id;
const nudge = (f) => ({ ...f, pages: f.pages.map((p) => (p.id !== dragPage ? p : { ...p, modules: p.modules.map((m) => (m.id === dragId ? { ...m, x: m.x + 0.25 } : m)) })) });
out.dragModule = await panFrames(view, 240, () => {
	view.store.update(nudge, { coalesce: 'perf-drag' });
	return {};
});
view.store.endCoalesce();

// 6. Saving: how long one serialization of this board takes (the first ask after a change; later asks
//    for the same snapshot are cached), and how often a save asks for the text.
const sizeKB = Math.round(view.getViewData().length / 1024);
let serializeTotal = 0;
for (let i = 0; i < 20; i++) {
	view.store.update(nudge);
	const ts = performance.now();
	view.getViewData();
	serializeTotal += performance.now() - ts;
}
const serializeMs = Math.round((serializeTotal / 20) * 10) / 10;
const ownGetViewData = view.getViewData;
let asks = 0;
view.getViewData = function () {
	asks++;
	return ownGetViewData.call(this);
};
view.store.update(nudge);
const tSave = performance.now();
await view.save();
const saveMs = Math.round(performance.now() - tSave);
delete view.getViewData;
out.save = { sizeKB, serializeMs, textAsksPerSave: asks, saveMs };

// 7. Rename a folder of 200 notes that a page of the board shows: time until every module follows,
//    long tasks, and how often the board file is written meanwhile.
const RN = '_perf-rename';
for (const p of [RN, `${RN}-moved`]) {
	const f = app.vault.getAbstractFileByPath(p);
	if (f) await app.vault.delete(f, true);
}
await app.vault.createFolder(RN);
for (let i = 0; i < 200; i++) await app.vault.create(`${RN}/n${i}.md`, `# Note ${i}

Text ${i}.`);
const notes = Array.from({ length: 200 }, (_, i) => ({ id: `rn${i}`, type: 'note', file: `${RN}/n${i}.md`, x: (i % 10) * 20, y: Math.floor(i / 10) * 14, w: 18, h: 12 }));
// Far from the camera, so the rename is measured without 200 modules re-rendering.
view.store.update((f) => ({ ...f, pages: [...f.pages, { id: 'perf-rename-page', x: -20000, y: -20000, w: 210, h: 297, modules: notes }] }));
await view.save();
await sleep(500);
let boardWrites = 0;
const onModify = (f) => f === file && boardWrites++;
app.vault.on('modify', onModify);
takeLongTasks();
const tRename = performance.now();
await app.fileManager.renameFile(app.vault.getAbstractFileByPath(RN), `${RN}-moved`);
const followed = () => view.store.file.pages.find((p) => p.id === 'perf-rename-page').modules.every((m) => m.file.startsWith(`${RN}-moved/`));
while (!followed() && performance.now() - tRename < 60000) await sleep(16);
out.renameFolder200 = { msUntilAllFollow: followed() ? Math.round(performance.now() - tRename) : null, longTasks: takeLongTasks() };
await sleep(2500);
out.renameFolder200.boardWrites = boardWrites;
app.vault.off('modify', onModify);
await app.vault.delete(app.vault.getAbstractFileByPath(`${RN}-moved`), true);

out.rssEndMB = rss();
out.mountedAtEnd = contentState(view);
po.disconnect();
app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
await app.vault.delete(file);
await sleep(300);
out.rssAfterCloseMB = rss();
return out;

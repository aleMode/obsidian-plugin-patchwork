// Performance probe against SPEC 8 targets, run inside Obsidian:
//   node scripts/cdp.mjs -f scripts/perf/stressBoard.js
// Generates a 100-page × 3-module board from the test vault (including any PDFs in it), then
// measures first paint, panning frame times, and memory. Results go in docs/perf.md.
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

// 3. Pan across the first row at that zoom (new pages mount as they come into view).
await sleep(500);
out.panRowWorkingZoom = await panFrames(view, 240, (c) => ({ tx: c.tx - 15 }));
await untilReady(view);

// 4. Pan with everything visible (zoomed out): no mounting, pure transform.
s.zoomToFit();
await sleep(300);
await untilReady(view);
out.panWholeBoard = await panFrames(view, 120, (c, i) => ({ tx: c.tx + (i < 60 ? 4 : -4) }));

out.rssEndMB = rss();
out.mountedAtEnd = contentState(view);
po.disconnect();
app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
await app.vault.delete(file);
await sleep(300);
out.rssAfterCloseMB = rss();
return out;

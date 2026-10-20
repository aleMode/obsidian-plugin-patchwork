// M2 acceptance (SPEC 11): no export crashes on the stress board. Exports the 100-page × 3-module
// stress board in both qualities and reports time, size and memory. Run inside Obsidian:
//   node scripts/cdp.mjs -f scripts/perf/exportStress.js
const plugin = app.plugins.plugins.patchwork;
const rss = () => Math.round(process.memoryUsage().rss / 2 ** 20);
const heap = () => Math.round(performance.memory.usedJSHeapSize / 2 ** 20);
const old = app.vault.getAbstractFileByPath('Stress board 100x3.patchwork');
if (old) await app.vault.delete(old);
const file = await plugin.createStressBoard(100, 3);
const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === file);
const base = { format: 'pdf', pages: 'all', range: '', sheet: 'native', orientation: 'auto', overlap: 0, fitSmallPages: false, tileLabels: false, dpi: 150, open: false };
const out = { rssStartMB: rss() };
for (const quality of ['small', 'best']) {
	const t0 = performance.now();
	let peakHeap = heap();
	const sampler = setInterval(() => (peakHeap = Math.max(peakHeap, heap())), 200);
	await view.surface.runExport({ ...base, quality, base: `_stress-${quality}` });
	clearInterval(sampler);
	const pdf = app.vault.getAbstractFileByPath(`_stress-${quality}.pdf`);
	const failed = [...document.querySelectorAll('.notice')].map((n) => n.innerText).find((t) => t.startsWith('Export failed'));
	let pages = null;
	if (pdf) {
		const doc = await plugin.pdfDocs.acquire(pdf.path);
		pages = doc.numPages;
		plugin.pdfDocs.release(pdf.path);
		plugin.pdfDocs.invalidate(pdf.path);
	}
	out[quality] = { seconds: Math.round((performance.now() - t0) / 100) / 10, pages, sizeMB: pdf ? Math.round(pdf.stat.size / 2 ** 20) : null, peakHeapMB: peakHeap, rssMB: rss(), failed: failed ?? null };
	document.querySelectorAll('.notice').forEach((n) => n.remove());
	if (pdf) await app.vault.delete(pdf);
}
app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
await new Promise((r) => setTimeout(r, 400));
await app.vault.delete(file);
return out;

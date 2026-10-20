// End-to-end check of PDF export (both stages), run inside Obsidian (via scripts/e2e/run.mjs).
// Writes .dev/e2e-export.pdf and a PNG of each page for visual inspection.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const vault = app.vault;
const plugin = app.plugins.plugins.patchwork;
const DIR = '_e2e';
const fs = require('fs');
const path = require('path');
const devDir = path.join(vault.adapter.getBasePath(), '..', '.dev');

const d = vault.getAbstractFileByPath(DIR);
if (d) await vault.delete(d, true);
await vault.createFolder(DIR);
try {
	const file = await plugin.createBoard(vault.getAbstractFileByPath(DIR));
	await sleep(300);
	const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === file);
	const statCrop = [20 / 210, 150 / 297, 110 / 210, 230 / 297];
	view.store.update((f) => ({
		...f,
		meta: { ...f.meta, title: 'E2E export' },
		pages: [
			{
				...f.pages[0],
				name: 'Front',
				modules: [
					{ id: 'note', type: 'note', file: 'Rules/Combat.md', subpath: '#Prone', x: 10, y: 10, w: 90, h: 60 },
					{ id: 'vec', type: 'pdf', file: 'PDFs/Sample rulebook.pdf', page: 1, crop: statCrop, x: 110, y: 10, w: 90, h: 80 },
					{ id: 'ras', type: 'pdf', file: 'PDFs/Sample rulebook.pdf', page: 1, crop: statCrop, x: 110, y: 100, w: 90, h: 80, render: 'raster' },
					{ id: 'txt', type: 'text', markdown: '**Bold** text module', x: 10, y: 80, w: 90, h: 15 },
				],
			},
			{
				id: 'back', name: 'Back', x: 300, y: 0, w: 215.9, h: 279.4,
				modules: [
					// Fixture page 3 has /Rotate 90; its blue box shows at displayed x 217-247, y 20-70 mm.
					{ id: 'rot', type: 'pdf', file: 'PDFs/Sample rulebook.pdf', page: 3, crop: [217 / 297, 20 / 210, 247 / 297, 70 / 210], x: 20, y: 20, w: 30, h: 50 },
					{ id: 'img', type: 'image', file: 'Images/Map.png', x: 60, y: 20, w: 80, h: 60 },
					// Styled vector crop: red padding around the content, a black border.
					{ id: 'styled', type: 'pdf', file: 'PDFs/Sample rulebook.pdf', page: 1, crop: statCrop, x: 150, y: 20, w: 50, h: 50, style: { padding: 5, background: '#ff0000', border: { width: 1, color: '#000000' } } },
				],
			},
		],
	}));
	await sleep(500);

	const t0 = performance.now();
	await view.surface.runExport({ path: `${DIR}/out.pdf`, quality: 'best', dpi: 200, open: false });
	const ms = Math.round(performance.now() - t0);
	const out = vault.getAbstractFileByPath(`${DIR}/out.pdf`);
	check('export writes the PDF into the vault', !!out, ms);
	check('export takes under 10 s for two pages', ms < 10000, ms);
	if (out) {
		const bytes = new Uint8Array(await vault.readBinary(out));
		fs.writeFileSync(path.join(devDir, 'e2e-export.pdf'), bytes);
		const doc = await plugin.pdfDocs.acquire(out.path);
		check('two pages in reading order', doc.numPages === 2, doc.numPages);
		const mm = (pt) => (pt * 25.4) / 72;
		const info = [];
		for (let i = 1; i <= doc.numPages; i++) {
			const page = await doc.getPage(i);
			const vp = page.getViewport({ scale: 1 });
			const text = (await page.getTextContent()).items.map((it) => it.str).join(' ');
			// Rasterize for pixel checks and a visual record.
			const scale = 2;
			const v2 = page.getViewport({ scale });
			const canvas = document.createElement('canvas');
			canvas.width = Math.ceil(v2.width);
			canvas.height = Math.ceil(v2.height);
			const ctx = canvas.getContext('2d');
			await page.render({ canvasContext: ctx, canvas, viewport: v2 }).promise;
			const px = (xMm, yMm) => Array.from(ctx.getImageData(Math.round((xMm / 25.4) * 72 * scale), Math.round((yMm / 25.4) * 72 * scale), 1, 1).data.slice(0, 3));
			const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
			fs.writeFileSync(path.join(devDir, `e2e-export-p${i}.png`), new Uint8Array(await blob.arrayBuffer()));
			info.push({ w: mm(vp.width), h: mm(vp.height), text, px });
		}
		const [p1, p2] = info;
		check('page 1 is A4 (±0.5 mm)', Math.abs(p1.w - 210) < 0.5 && Math.abs(p1.h - 297) < 0.5, [p1.w, p1.h]);
		check('page 2 is Letter (±0.5 mm)', Math.abs(p2.w - 215.9) < 0.5 && Math.abs(p2.h - 279.4) < 0.5, [p2.w, p2.h]);
		check('note text is vector (extractable)', p1.text.includes('You can only crawl'), p1.text.slice(0, 200));
		check('text module is vector', p1.text.includes('Bold'));
		check('vector PDF crop keeps its text', p1.text.includes('Goblin Skirmisher'));
		// The vector crop's box is contain-fitted: 90 x 80 mm crop into a 90 x 80 mm module at (110, 10).
		const fill = [245, 235, 209];
		const near = (a, b, tol = 8) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
		check('vector crop drawn in its box', near(p1.px(197, 50), fill), p1.px(197, 50));
		check('raster crop drawn in its box', near(p1.px(197, 140), fill), p1.px(197, 140));
		check('nothing drawn outside the vector crop box', near(p1.px(105, 50), [255, 255, 255], 2), p1.px(105, 50));
		check('rotated-page crop shows the blue box', near(p2.px(35, 45), [204, 230, 255]), p2.px(35, 45));
		check('module style: padding shows the background', near(p2.px(152.5, 45), [255, 0, 0], 12), p2.px(152.5, 45));
		check('module style: border drawn', near(p2.px(150.4, 45), [0, 0, 0], 40), p2.px(150.4, 45));
		check('module style: vector content inside the padding', !near(p2.px(175, 45), [255, 0, 0], 40), p2.px(175, 45));
		check('image module printed', !near(p2.px(100, 50), [255, 255, 255], 2), p2.px(100, 50));
		check('paper is white even in a dark app theme', near(p1.px(60, 200), [255, 255, 255], 2), p1.px(60, 200));
		check('a sheet wider than the first page is not clipped', near(p2.px(214.5, 200), [255, 255, 255], 2), p2.px(214.5, 200));
		check('no dark line at the bottom edge', near(p1.px(100, 296.6), [255, 255, 255], 4), p1.px(100, 296.6));
		const outline = await doc.getOutline();
		check('bookmarks from page names', JSON.stringify(outline?.map((o) => o.title)) === '["Front","Back"]', outline?.map((o) => o.title));
		check('title metadata', (await doc.getMetadata()).info?.Title === 'E2E export');
		plugin.pdfDocs.release(out.path);
		plugin.pdfDocs.invalidate(out.path);
	}
	const settings = JSON.parse(JSON.stringify(view.store.file.board.export));
	check('export choices remembered in the board', settings.quality === 'best' && settings.dpi === 200);
} catch (e) {
	check('no exception', false, String(e?.stack ?? e));
} finally {
	document.querySelectorAll('.notice').forEach((n) => n.remove());
	app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
	await new Promise((r) => setTimeout(r, 400)); // let pending saves finish before deleting their files
	app.workspace.getLeavesOfType('pdf').forEach((l) => l.detach());
	const dir = vault.getAbstractFileByPath(DIR);
	if (dir) await vault.delete(dir, true);
}
return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };

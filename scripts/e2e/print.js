// End-to-end check of booklet imposition, bleed and crop marks (M4), run inside Obsidian.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const vault = app.vault;
const plugin = app.plugins.plugins.patchwork;
const DIR = '_e2e';
const EXPORT = { format: 'pdf', pages: 'all', range: '', sheet: 'native', orientation: 'auto', overlap: 0, fitSmallPages: false, tileLabels: false, inkSaver: false, layout: 'single', bleed: 0, cropMarks: false, quality: 'best', dpi: 150, open: false };
const mm = (pt) => (pt * 25.4) / 72;
const SCALE = 4; // render scale for pixel checks (288 dpi)

/** Sheet sizes, text items with their positions (mm from the top-left), and a rendered canvas per sheet. */
async function inspect(path, render = false) {
	const doc = await plugin.pdfDocs.acquire(path);
	const pages = [];
	for (let i = 1; i <= doc.numPages; i++) {
		const p = await doc.getPage(i);
		const vp = p.getViewport({ scale: 1 });
		const items = (await p.getTextContent()).items.map((t) => ({ str: t.str, x: mm(t.transform[4]), y: mm(vp.height - t.transform[5]) }));
		let pixel = null;
		if (render) {
			const v = p.getViewport({ scale: SCALE });
			const canvas = document.createElement('canvas');
			canvas.width = v.width;
			canvas.height = v.height;
			const ctx = canvas.getContext('2d');
			await p.render({ canvasContext: ctx, viewport: v }).promise;
			const px = (xmm, ymm) => Array.from(ctx.getImageData(Math.round((xmm / 25.4) * 72 * SCALE), Math.round((ymm / 25.4) * 72 * SCALE), 1, 1).data.slice(0, 3));
			// Darkest pixel in a small square, for hairlines like crop marks.
			const darkest = (xmm, ymm, r = 3) => {
				const cx = Math.round((xmm / 25.4) * 72 * SCALE);
				const cy = Math.round((ymm / 25.4) * 72 * SCALE);
				const d = ctx.getImageData(cx - r, cy - r, 2 * r + 1, 2 * r + 1).data;
				let min = 255;
				for (let k = 0; k < d.length; k += 4) min = Math.min(min, d[k], d[k + 1], d[k + 2]);
				return min;
			};
			pixel = { px, darkest };
		}
		pages.push({ w: mm(vp.width), h: mm(vp.height), items, text: items.map((t) => t.str).join(' '), pixel });
	}
	plugin.pdfDocs.release(path);
	plugin.pdfDocs.invalidate(path);
	return pages;
}
const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;
const find = (page, str) => page.items.find((t) => t.str.includes(str));

const d = vault.getAbstractFileByPath(DIR);
if (d) await vault.delete(d, true);
await vault.createFolder(DIR);
try {
	const file = await plugin.createBoard(vault.getAbstractFileByPath(DIR));
	await sleep(300);
	const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === file);
	const t = (id, markdown, x, y, w = 60) => ({ id, type: 'text', markdown, x, y, w, h: 15 });
	const a5 = (n) => ({ id: `p${n}`, name: `Page ${n}`, x: 160 * n, y: 0, w: 148, h: 210, modules: [t(`t${n}`, `PAGE-${n}-TEXT`, 20, 20)] });
	view.store.update((f) => ({ ...f, pages: [1, 2, 3, 4, 5].map(a5) }));
	await sleep(200);

	// Booklet: 5 pages pad to 8, so 4 sides: [–, 1], [2, –], [–, 3], [4, 5].
	await view.surface.runExport({ ...EXPORT, base: `${DIR}/booklet`, sheet: 'A4', layout: 'booklet' });
	let r = await inspect(`${DIR}/booklet.pdf`);
	check('booklet: 4 landscape A4 sides', r.length === 4 && r.every((p) => near(p.w, 297) && near(p.h, 210)), r.map((p) => [p.w, p.h]));
	const sideOf = (n) => r.findIndex((p) => p.text.includes(`PAGE-${n}-TEXT`));
	check('booklet: pages on the right sides', JSON.stringify([1, 2, 3, 4, 5].map(sideOf)) === '[0,1,2,3,3]', [1, 2, 3, 4, 5].map(sideOf));
	const right = (n) => find(r[sideOf(n)], `PAGE-${n}-TEXT`).x > 148.5;
	check('booklet: page 1 on the right half, page 2 on the left, page 4 left of 5', right(1) && !right(2) && !right(4) && right(5));

	// Bleed and crop marks, native size: sheet = page + 2 × 3 mm bleed + 2 × 10 mm mark margin.
	view.store.update((f) => ({
		...f,
		pages: [
			{
				...f.pages[0],
				background: '#3366cc',
				modules: [
					t('tl', 'TOP-LEFT-TEXT', 10, 10),
					{ id: 'vec', type: 'pdf', file: 'PDFs/Sample rulebook.pdf', page: 1, x: 10, y: 60, w: 120, h: 120 },
				],
			},
		],
	}));
	await sleep(200);
	await view.surface.runExport({ ...EXPORT, base: `${DIR}/plain` });
	await view.surface.runExport({ ...EXPORT, base: `${DIR}/marks`, bleed: 3, cropMarks: true });
	const [plain] = await inspect(`${DIR}/plain.pdf`);
	const [marked] = await inspect(`${DIR}/marks.pdf`, true);
	check('marks: sheet grows by bleed and margin (174 x 236 mm)', near(marked.w, 174) && near(marked.h, 236), [marked.w, marked.h]);
	const shift = (str) => {
		const a = find(plain, str);
		const b = find(marked, str);
		return a && b ? [b.x - a.x, b.y - a.y] : null;
	};
	const s1 = shift('TOP-LEFT-TEXT');
	check('marks: printed content shifts by 13 mm', s1 && near(s1[0], 13) && near(s1[1], 13), s1);
	const vecStr = plain.items.find((it) => it.str.trim().length > 3 && !it.str.includes('TOP-LEFT'))?.str;
	const s2 = vecStr && shift(vecStr);
	check('marks: vector PDF region shifts by the same 13 mm', s2 && near(s2[0], 13) && near(s2[1], 13), [vecStr, s2]);
	const bg = marked.pixel.px(11.5, 100);
	check('bleed: page background extends into the bleed', bg[2] > 150 && bg[0] < 100, bg);
	const outside = marked.pixel.px(5, 100);
	check('bleed: mark margin stays white', outside.every((c) => c > 245), outside);
	// Top-left mark: horizontal at y = 13 mm running from x = 8 to 2 mm; vertical at x = 13 mm.
	check('crop marks drawn at the corners', marked.pixel.darkest(5, 13) < 100 && marked.pixel.darkest(13, 5) < 100 && marked.pixel.darkest(174 - 5, 236 - 13) < 100, [marked.pixel.darkest(5, 13), marked.pixel.darkest(13, 5)]);

	// Bleed without marks, on a chosen sheet: centred, sheet size unchanged.
	await view.surface.runExport({ ...EXPORT, base: `${DIR}/a4marks`, sheet: 'A4', cropMarks: true });
	const [a4] = await inspect(`${DIR}/a4marks.pdf`, true);
	check('marks on A4: sheet stays A4, page centred', near(a4.w, 210) && near(a4.h, 297) && near(find(a4, 'TOP-LEFT-TEXT').x - find(plain, 'TOP-LEFT-TEXT').x, 31), [a4.w, a4.h]);
	check('vector PDF region survives re-laying pages onto sheets', a4.text.includes('Sample Rulebook'), a4.items.slice(0, 4));
	check('marks on A4: mark next to the centred page', a4.pixel.darkest(31 - 5, 43.5) < 100, a4.pixel.darkest(31 - 5, 43.5));

	await sleep(1500); // debounced save
	const saved = JSON.parse(await vault.read(file)).board.export;
	check('export choices remembered in the board', saved.cropMarks === true && saved.layout === undefined, saved);
} catch (e) {
	check('no exception', false, String(e?.stack ?? e));
} finally {
	document.querySelectorAll('.notice').forEach((n) => n.remove());
	app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
	await new Promise((r) => setTimeout(r, 400)); // let pending saves finish before deleting their files
	const dir = vault.getAbstractFileByPath(DIR);
	if (dir) await vault.delete(dir, true);
}
return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };

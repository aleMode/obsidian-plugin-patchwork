import { Component, MarkdownRenderer, TFile } from 'obsidian';
import { degrees, PDFDocument, PDFHexString, PDFName, PDFPage } from 'pdf-lib';
import { canvasToPng, inspectPdf, PDF_DOC_PARAMS, pdfjs, Spike, SpikeContext } from './context';
import { printSheets } from './printHost';

/**
 * S8: two-stage export. Chromium prints the HTML layer with PDF modules left empty; pdf-lib then
 * draws the source PDF regions into those spaces as vector Form XObjects clipped to the crop,
 * and does document-level work (tiling, outline, page labels, metadata).
 * Compared against the raster approach (PDF modules as 200 dpi canvases in the print).
 */

const PT_PER_MM = 72 / 25.4;
const RULEBOOK = 'PDFs/Crown of the Fungal Queen 1.03.pdf';
const FIXTURE = 'PDFs/Sample rulebook.pdf';

type Crop = [number, number, number, number];
interface PdfModule {
	file: string;
	page: number; // 1-based
	crop: Crop; // normalized, top-left origin, on the page as displayed
	x: number; y: number; w: number; h: number; // mm on the sheet
}

const SHEET = { w: 210, h: 297 };

function modules(hasRulebook: boolean): PdfModule[] {
	const mods: PdfModule[] = [
		// Fixture stat block (vector content) and the rotated page's blue box.
		{ file: FIXTURE, page: 1, crop: [20 / 210, 150 / 297, 110 / 210, 230 / 297], x: 105, y: 150, w: 95, h: 85 },
		{ file: FIXTURE, page: 3, crop: [217 / 297, 20 / 210, 247 / 297, 70 / 210], x: 10, y: 240, w: 40, h: 50 },
	];
	if (hasRulebook) {
		mods.push(
			// Text column with a boxed sidebar, and a full-colour illustration.
			{ file: RULEBOOK, page: 40, crop: [0.5, 0.46, 0.96, 0.96], x: 105, y: 20, w: 95, h: 125 },
			{ file: RULEBOOK, page: 80, crop: [0.08, 0.1, 0.55, 0.45], x: 55, y: 240, w: 60, h: 50 },
		);
	}
	return mods;
}

/** Contain-fit a w×h box into the module rect; returns the placed rect in mm. */
function fit(m: PdfModule, aspect: number) {
	const w = Math.min(m.w, m.h * aspect);
	const h = w / aspect;
	return { x: m.x + (m.w - w) / 2, y: m.y + (m.h - h) / 2, w, h };
}

// ---------- stage 1: HTML layer (shared by both variants) ----------

async function buildHtml(ctx: SpikeContext, el: HTMLElement, component: Component) {
	el.style.fontSize = '8pt';
	const title = el.createDiv({ text: 'S8 board: note module (left), PDF modules (outlined boxes)' });
	title.style.cssText = 'position:absolute;left:10mm;top:8mm;font-size:11pt;font-weight:600';
	const note = el.createDiv({ cls: 'markdown-rendered' });
	note.style.cssText = 'position:absolute;left:10mm;top:20mm;width:90mm;height:215mm;overflow:hidden;font-size:8pt';
	const goblin = ctx.app.vault.getAbstractFileByPath('Monsters/Goblin.md') as TFile;
	await MarkdownRenderer.render(ctx.app, await ctx.app.vault.cachedRead(goblin), note, goblin.path, component);
}

function outlineBox(el: HTMLElement, m: PdfModule) {
	const b = el.createDiv();
	b.style.cssText = `position:absolute;left:${m.x}mm;top:${m.y}mm;width:${m.w}mm;height:${m.h}mm;outline:0.2mm dashed #999;box-sizing:border-box`;
	return b;
}

// ---------- raster variant ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rasterCrop(doc: any, m: PdfModule, dpi: number) {
	const page = await doc.getPage(m.page);
	const vp1 = page.getViewport({ scale: 1 });
	const aspect = ((m.crop[2] - m.crop[0]) * vp1.width) / ((m.crop[3] - m.crop[1]) * vp1.height);
	const placed = fit(m, aspect);
	const scale = ((placed.w / 25.4) * dpi) / ((m.crop[2] - m.crop[0]) * vp1.width / 72) / 72;
	const vp = page.getViewport({ scale });
	const canvas = document.createElement('canvas');
	canvas.width = Math.ceil((m.crop[2] - m.crop[0]) * vp.width);
	canvas.height = Math.ceil((m.crop[3] - m.crop[1]) * vp.height);
	await page.render({
		canvasContext: canvas.getContext('2d')!,
		canvas,
		viewport: vp,
		transform: [1, 0, 0, 1, -m.crop[0] * vp.width, -m.crop[1] * vp.height],
	}).promise;
	page.cleanup();
	return { canvas, placed };
}

// ---------- vector variant ----------

/** Displayed-page crop → bounding box in the page's unrotated user space (handles /Rotate 0 and 90). */
function userBox(page: PDFPage, crop: Crop) {
	const box = page.getCropBox();
	const rot = ((page.getRotation().angle % 360) + 360) % 360;
	const [u0, v0, u1, v1] = crop;
	if (rot === 0) {
		return { rot, left: box.x + u0 * box.width, right: box.x + u1 * box.width, bottom: box.y + (1 - v1) * box.height, top: box.y + (1 - v0) * box.height };
	}
	if (rot === 90) {
		// Displayed X runs along user +y, displayed Y along user +x (verified against the fixture in S3).
		return { rot, left: box.x + v0 * box.width, right: box.x + v1 * box.width, bottom: box.y + u0 * box.height, top: box.y + u1 * box.height };
	}
	throw new Error(`rotation ${rot} not handled in spike`);
}

async function drawVector(out: PDFDocument, sheet: PDFPage, src: PDFDocument, m: PdfModule) {
	const page = src.getPage(m.page - 1);
	const b = userBox(page, m.crop);
	const emb = await out.embedPage(page, { left: b.left, bottom: b.bottom, right: b.right, top: b.top });
	const rotated = b.rot === 90;
	const dispW = rotated ? emb.height : emb.width;
	const dispH = rotated ? emb.width : emb.height;
	const placed = fit(m, dispW / dispH);
	const s = (placed.w * PT_PER_MM) / dispW;
	// Sheet coordinates: PDF origin is bottom-left; use the printed page's real height (Chromium rounds sizes).
	const sheetH = sheet.getHeight();
	const x = placed.x * PT_PER_MM;
	const yBottom = sheetH - (placed.y + placed.h) * PT_PER_MM;
	if (!rotated) {
		sheet.drawPage(emb, { x, y: yBottom, xScale: s, yScale: s });
	} else {
		// pdf-lib rotates counter-clockwise around (x, y); -90 is clockwise, matching /Rotate 90.
		sheet.drawPage(emb, { x, y: yBottom + placed.h * PT_PER_MM, xScale: s, yScale: s, rotate: degrees(-90) });
	}
}

function addOutline(doc: PDFDocument, items: { title: string; pageIndex: number }[]) {
	const c = doc.context;
	const outlinesRef = c.nextRef();
	const refs = items.map(() => c.nextRef());
	items.forEach((it, i) => {
		const entries: Record<string, unknown> = {
			Title: PDFHexString.fromText(it.title),
			Parent: outlinesRef,
			Dest: [doc.getPage(it.pageIndex).ref, 'XYZ', null, null, null],
		};
		if (i > 0) entries.Prev = refs[i - 1];
		if (i < items.length - 1) entries.Next = refs[i + 1];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		c.assign(refs[i]!, c.obj(entries as any));
	});
	c.assign(outlinesRef, c.obj({ Type: 'Outlines', First: refs[0]!, Last: refs[refs.length - 1]!, Count: items.length }));
	doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
}

/** Split one printed page into fixed-size sheets, each a clipped vector copy of its region. */
async function tile(printed: Uint8Array, sheetMm: { w: number; h: number }) {
	const src = await PDFDocument.load(printed);
	const page = src.getPage(0);
	const { width: W, height: H } = page.getSize();
	const sw = sheetMm.w * PT_PER_MM;
	const sh = sheetMm.h * PT_PER_MM;
	const eps = 0.1 * PT_PER_MM;
	const cols = Math.max(1, Math.ceil((W - eps) / sw));
	const rows = Math.max(1, Math.ceil((H - eps) / sh));
	const out = await PDFDocument.create();
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			const left = c * sw;
			const top = H - r * sh;
			const box = { left, right: Math.min(W, left + sw), top, bottom: Math.max(0, top - sh) };
			const emb = await out.embedPage(page, box);
			const sheet = out.addPage([sw, sh]);
			// Top-left aligned; edge tiles keep blank padding so every sheet is the same size.
			sheet.drawPage(emb, { x: 0, y: sh - (box.top - box.bottom) });
			sheet.drawText(`${String.fromCharCode(65 + r)}${c + 1}`, { x: 6, y: 6, size: 7 });
		}
	}
	return { bytes: await out.save(), cols, rows };
}

export const s8Hybrid: Spike = async (ctx) => {
	const { app } = ctx;
	const hasRulebook = !!app.vault.getAbstractFileByPath(RULEBOOK);
	const mods = modules(hasRulebook);
	const out: Record<string, unknown> = { hasRulebook, modules: mods.length };
	const lib = await pdfjs();
	const component = new Component();
	component.load();

	const readBytes = async (p: string) => new Uint8Array(await app.vault.readBinary(app.vault.getAbstractFileByPath(p) as TFile));
	const files = [...new Set(mods.map((m) => m.file))];
	const bytes: Record<string, Uint8Array> = {};
	for (const f of files) bytes[f] = await readBytes(f);

	try {
		// ----- raster variant: everything in one Chromium print -----
		const t0 = performance.now();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const pjDocs: Record<string, any> = {};
		for (const f of files) pjDocs[f] = await lib.getDocument({ data: bytes[f]!.slice(), ...PDF_DOC_PARAMS }).promise;
		const raster = await printSheets(ctx, [{
			wMm: SHEET.w, hMm: SHEET.h,
			build: async (el) => {
				await buildHtml(ctx, el, component);
				for (const m of mods) {
					outlineBox(el, m);
					const { canvas, placed } = await rasterCrop(pjDocs[m.file], m, 200);
					canvas.style.cssText = `position:absolute;left:${placed.x}mm;top:${placed.y}mm;width:${placed.w}mm;height:${placed.h}mm`;
					el.appendChild(canvas);
				}
			},
		}], { settleMs: 800 });
		for (const d of Object.values(pjDocs)) await d.destroy();
		const rasterMs = Math.round(performance.now() - t0);
		ctx.save('s8-raster.pdf', raster);

		// ----- vector variant: print HTML only, then compose with pdf-lib -----
		const t1 = performance.now();
		const htmlOnly = await printSheets(ctx, [{
			wMm: SHEET.w, hMm: SHEET.h,
			build: async (el) => {
				await buildHtml(ctx, el, component);
				mods.forEach((m) => outlineBox(el, m));
			},
		}], { settleMs: 800 });
		const tPrint = performance.now();
		const doc = await PDFDocument.load(htmlOnly);
		const srcDocs: Record<string, PDFDocument> = {};
		const loadMs: Record<string, number> = {};
		for (const f of files) {
			const tl = performance.now();
			srcDocs[f] = await PDFDocument.load(bytes[f]!, { ignoreEncryption: true, updateMetadata: false });
			loadMs[f] = Math.round(performance.now() - tl);
		}
		const tLoaded = performance.now();
		const sheet = doc.getPage(0);
		for (const m of mods) await drawVector(doc, sheet, srcDocs[m.file]!, m);

		// Document-level features Chromium can't add.
		doc.addPage([SHEET.w * PT_PER_MM, SHEET.h * PT_PER_MM]).drawText('Second page (for outline / labels test)', { x: 40, y: 700, size: 14 });
		addOutline(doc, [{ title: 'Goblin sheet', pageIndex: 0 }, { title: 'Second page', pageIndex: 1 }]);
		doc.catalog.set(PDFName.of('PageLabels'), doc.context.obj({ Nums: [0, { S: 'r' }, 1, { S: 'D', St: 7 }] }));
		doc.setTitle('S8 hybrid export');
		doc.setCreator('Patchwork spike');
		const vector = await doc.save();
		const vectorMs = Math.round(performance.now() - t1);
		ctx.save('s8-vector.pdf', vector);

		out.timing = {
			rasterTotalMs: rasterMs,
			vectorTotalMs: vectorMs,
			vectorPrintMs: Math.round(tPrint - t1),
			pdfLibLoadMs: loadMs,
			composeAndSaveMs: Math.round(performance.now() - tLoaded),
			rssMB: Math.round(process.memoryUsage().rss / 2 ** 20),
		};
		out.sizesKB = { raster: Math.round(raster.length / 1024), vector: Math.round(vector.length / 1024) };
		out.raster = await inspectPdf(ctx, raster, { pngPrefix: 's8-raster', pngScale: 1.5, maxTextChars: 400 });
		out.vector = await inspectPdf(ctx, vector, { pngPrefix: 's8-vector', pngScale: 1.5, maxTextChars: 400 });

		// Text inside a clipped Form XObject is still in the file: does search find text *outside* the crop?
		const vdoc = await lib.getDocument({ data: vector.slice(), ...PDF_DOC_PARAMS }).promise;
		const vtext = (await (await vdoc.getPage(1)).getTextContent()).items.map((i: { str: string }) => i.str).join(' ');
		out.pageLabels = await vdoc.getPageLabels();
		out.metadataTitle = (await vdoc.getMetadata()).info?.Title ?? null;
		out.hiddenTextProbe = {
			// Fixture page 1 text that lies outside the stat-block crop.
			fixtureOutsideCrop: vtext.includes('Every creature acts in initiative order'),
			fixtureInsideCrop: vtext.includes('Goblin Skirmisher'),
		};
		await vdoc.destroy();

		// Zoomed comparison of one module region at high resolution.
		for (const [name, data] of [['raster', raster], ['vector', vector]] as const) {
			const d = await lib.getDocument({ data: data.slice(), ...PDF_DOC_PARAMS }).promise;
			const p = await d.getPage(1);
			const m = mods.find((mm) => mm.file === RULEBOOK) ?? mods[0]!;
			const zoom = 8; // ~576 dpi
			const vp = p.getViewport({ scale: zoom });
			const canvas = document.createElement('canvas');
			canvas.width = Math.round(40 * PT_PER_MM * zoom);
			canvas.height = Math.round(25 * PT_PER_MM * zoom);
			const c2d = canvas.getContext('2d')!;
			c2d.fillStyle = '#fff';
			c2d.fillRect(0, 0, canvas.width, canvas.height);
			await p.render({ canvasContext: c2d, canvas, viewport: vp, transform: [1, 0, 0, 1, -(m.x + 5) * PT_PER_MM * zoom, -(m.y + 70) * PT_PER_MM * zoom] }).promise;
			ctx.save(`s8-zoom-${name}.png`, await canvasToPng(canvas));
			await d.destroy();
		}

		// ----- vector tiling of a large page -----
		const big = await printSheets(ctx, [{
			wMm: 1000, hMm: 700,
			build: (el) => {
				el.style.border = '2mm solid #36c';
				for (let i = 0; i < 10; i++) {
					const d = el.createDiv({ text: `column ${i + 1}` });
					d.style.cssText = `position:absolute;left:${i * 100 + 10}mm;top:${(i % 7) * 100 + 10}mm;font-size:28pt`;
				}
			},
		}]);
		const tiled = await tile(big, { w: 210, h: 297 });
		ctx.save('s8-tiles.pdf', tiled.bytes);
		out.tiling = { cols: tiled.cols, rows: tiled.rows, ...(await inspectPdf(ctx, tiled.bytes, { pngPrefix: 's8-tile', pngScale: 0.3, maxTextChars: 60 })) };
	} finally {
		component.unload();
	}
	return out;
};

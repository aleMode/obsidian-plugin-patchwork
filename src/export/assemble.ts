import { clip, degrees, endPath, grayscale, PDFDocument, PDFHexString, PDFName, type PDFPage, popGraphicsState, pushGraphicsState, rectangle, rgb, translate } from '@cantoo/pdf-lib';
import { drawOrder, vectorTarget } from '../model/exportPlan';
import { cropToUserBox, drawPlacement, FULL_PAGE } from '../model/pdfGeometry';
import type { PdfPageLabel } from '../model/numbering';
import type { Page, PdfModule } from '../model/schema';
import type { OutputSheet } from '../model/sheetPlan';
import { PT_PER_MM } from '../model/units';

// Stage 2 of export (SPEC 9.1, spike S8): merge the printed batches, draw vector PDF modules clipped
// to their boxes, and add what Chromium can't (bookmarks, metadata).

export interface AssembleInput {
	printed: Uint8Array[];
	pages: readonly Page[];
	vector: ReadonlySet<string>;
	readSource: (path: string) => Promise<Uint8Array>;
	title: string;
	pageLabels?: PdfPageLabel[] | null;
	/** Output sheets; absent means one sheet per page at its own size. */
	sheets?: OutputSheet[];
	/** Bleed (mm) the printed pages carry around each edge. */
	bleed?: number;
	tileLabels?: boolean;
	/** The printed number or label of each page, for tile page labels ("iii B2"). */
	pageNames?: string[];
}

export interface AssembleResult {
	bytes: Uint8Array;
	problems: string[];
}

class SourcePdfs {
	private docs = new Map<string, Promise<PDFDocument>>();
	constructor(private read: (path: string) => Promise<Uint8Array>) {}

	get(path: string): Promise<PDFDocument> {
		let d = this.docs.get(path);
		if (!d) {
			// Rulebooks may carry an owner password that only restricts editing; reading is fine.
			d = this.read(path).then((bytes) => PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }));
			this.docs.set(path, d);
		}
		return d;
	}
}

async function drawVectorModule(out: PDFDocument, target: PDFPage, pageHeightPt: number, src: PDFDocument, m: PdfModule) {
	const sp = src.getPage(m.page - 1);
	const cb = sp.getCropBox();
	const rotate = sp.getRotation().angle;
	const box = cropToUserBox({ x: cb.x, y: cb.y, w: cb.width, h: cb.height }, rotate, m.crop ?? FULL_PAGE);
	const embedded = await out.embedPage(sp, box);
	const { content, clip: c } = vectorTarget(m, { w: cb.width, h: cb.height, rotate }, pageHeightPt);
	const p = drawPlacement({ w: embedded.width, h: embedded.height }, rotate + (m.rotation ?? 0), content);
	// Clip to the module box: "cover" overflows it, and modules never draw outside their box.
	target.pushOperators(pushGraphicsState(), rectangle(c.x, c.y, c.w, c.h), clip(), endPath());
	target.drawPage(embedded, { x: p.x, y: p.y, xScale: p.xScale, yScale: p.yScale, rotate: degrees(p.rotate) });
	target.pushOperators(popGraphicsState());
}

function addOutline(doc: PDFDocument, entries: { title: string; pageIndex: number }[]) {
	if (entries.length === 0) return;
	const c = doc.context;
	const root = c.nextRef();
	const refs = entries.map(() => c.nextRef());
	entries.forEach((e, i) => {
		const dict: Record<string, unknown> = {
			Title: PDFHexString.fromText(e.title),
			Parent: root,
			Dest: [doc.getPage(e.pageIndex).ref, 'XYZ', null, null, null],
		};
		if (i > 0) dict.Prev = refs[i - 1];
		if (i < refs.length - 1) dict.Next = refs[i + 1];
		c.assign(refs[i]!, c.obj(dict as Parameters<typeof c.obj>[0]));
	});
	c.assign(root, c.obj({ Type: 'Outlines', First: refs[0]!, Last: refs[refs.length - 1]!, Count: refs.length }));
	doc.catalog.set(PDFName.of('Outlines'), root);
}

/** Gap between the bleed edge and a crop mark, and the mark's length (mm). */
const MARK_GAP_MM = 2;
const MARK_LENGTH_MM = 6;

/** Trim and bleed boxes for print shops, and corner crop marks outside the bleed. */
function addPrintMarks(page: PDFPage, sheet: OutputSheet) {
	const t = sheet.trim;
	if (!t) return;
	const k = PT_PER_MM;
	const H = sheet.size.h;
	const b = sheet.bleed ?? 0;
	page.setTrimBox(t.x * k, (H - t.y - t.h) * k, t.w * k, t.h * k);
	page.setBleedBox((t.x - b) * k, (H - t.y - t.h - b) * k, (t.w + 2 * b) * k, (t.h + 2 * b) * k);
	if (!sheet.cropMarks) return;
	const line = (x1: number, y1: number, x2: number, y2: number) =>
		page.drawLine({ start: { x: x1 * k, y: (H - y1) * k }, end: { x: x2 * k, y: (H - y2) * k }, thickness: 0.25, color: rgb(0, 0, 0) });
	const near = b + MARK_GAP_MM;
	const far = near + MARK_LENGTH_MM;
	for (const x of [t.x, t.x + t.w]) {
		for (const y of [t.y, t.y + t.h]) {
			// Marks point away from the page: left of the left edge, above the top edge, and so on.
			const sx = x === t.x ? -1 : 1;
			const sy = y === t.y ? -1 : 1;
			line(x + sx * near, y, x + sx * far, y);
			line(x, y + sy * near, x, y + sy * far);
		}
	}
}

/**
 * Lay the native printed pages out on output sheets (SPEC 9.2, M4): tiles, scaled pages, booklet
 * spreads and pages with print marks are embedded as clipped vector copies, so text stays sharp.
 * `offset` is the bleed the printed pages carry, since plan regions are in page coordinates.
 */
async function buildSheets(native: PDFDocument, plan: OutputSheet[], tileLabels: boolean, offset: number): Promise<PDFDocument> {
	const doc = await PDFDocument.create();
	const k = PT_PER_MM;
	for (const sheet of plan) {
		const page = doc.addPage([sheet.size.w * k, sheet.size.h * k]);
		for (const part of sheet.parts) {
			const src = native.getPage(part.page);
			const H = src.getHeight();
			const x = part.src.x + offset;
			const y = part.src.y + offset;
			const embedded = await doc.embedPage(src, { left: x * k, right: (x + part.src.w) * k, top: H - y * k, bottom: H - (y + part.src.h) * k });
			const s = part.dest.scale;
			// Top-left aligned at dest; edge tiles keep blank padding so every sheet is the same size.
			const top = (sheet.size.h - part.dest.y) * k;
			page.drawPage(embedded, { x: part.dest.x * k, y: top - embedded.height * s, xScale: s, yScale: s });
		}
		if (tileLabels && sheet.tile) page.drawText(sheet.tile, { x: 3 * k, y: 3 * k, size: 7, color: grayscale(0.45) });
		addPrintMarks(page, sheet);
	}
	return doc;
}

/** One label per output sheet: tiles become "iii B2"; whole pages keep their numbering style; spreads list both. */
function sheetLabels(plan: OutputSheet[], pageLabels: PdfPageLabel[], pageNames: string[]): PdfPageLabel[] {
	const name = (i: number) => pageNames[i] || String(i + 1);
	return plan.map((s) => {
		const first = s.parts[0];
		if (s.tile && first) return { prefix: `${name(first.page)} ${s.tile}` };
		if (s.parts.length === 1 && first) return pageLabels[first.page] ?? { style: 'D', start: first.page + 1 };
		return { prefix: s.parts.map((p) => name(p.page)).join(' | ') };
	});
}

/** True when the plan is exactly the printed pages, so they can be used as they are. */
function isNative(plan: OutputSheet[]): boolean {
	return plan.every((s) => {
		const p = s.parts[0];
		return s.parts.length === 1 && p && !s.tile && !s.trim && p.dest.scale === 1 && p.dest.x === 0 && p.dest.y === 0 && p.src.x === 0 && p.src.y === 0;
	});
}

/** /PageLabels so viewers show our page numbers (iii, Cover, …) in their page box. */
function addPageLabels(doc: PDFDocument, labels: PdfPageLabel[]) {
	const nums: unknown[] = [];
	labels.slice(0, doc.getPageCount()).forEach((l, i) => {
		const dict: Record<string, unknown> = {};
		if (l.style) dict.S = l.style;
		if (l.start !== undefined) dict.St = l.start;
		if (l.prefix !== undefined) dict.P = PDFHexString.fromText(l.prefix);
		nums.push(i, dict);
	});
	doc.catalog.set(PDFName.of('PageLabels'), doc.context.obj({ Nums: nums } as Parameters<typeof doc.context.obj>[0]));
}

export async function assemble(input: AssembleInput): Promise<AssembleResult> {
	const out = await PDFDocument.create();
	for (const bytes of input.printed) {
		const batch = await PDFDocument.load(bytes);
		for (const page of await out.copyPages(batch, batch.getPageIndices())) out.addPage(page);
	}
	const problems: string[] = [];
	if (out.getPageCount() !== input.pages.length) {
		problems.push(`Expected ${input.pages.length} printed pages but got ${out.getPageCount()}; the layout may be off.`);
	}

	const sources = new SourcePdfs(input.readSource);
	const bleed = input.bleed ?? 0;
	for (const [i, page] of input.pages.entries()) {
		if (i >= out.getPageCount()) break;
		const target = out.getPage(i);
		// With bleed the printed page is larger; the board page sits `bleed` in from every edge.
		if (bleed) target.pushOperators(pushGraphicsState(), translate(bleed * PT_PER_MM, bleed * PT_PER_MM));
		for (const m of drawOrder(page.modules)) {
			if (!input.vector.has(m.id)) continue;
			const pm = m as PdfModule;
			try {
				const src = await sources.get(pm.file);
				if (pm.page > src.getPageCount()) throw new Error(`it has only ${src.getPageCount()} pages`);
				await drawVectorModule(out, target, page.h * PT_PER_MM, src, pm);
			} catch (e) {
				problems.push(`${pm.file} p. ${pm.page} on "${page.name ?? 'page ' + (i + 1)}": ${e instanceof Error ? e.message : String(e)}`);
			}
		}
		if (bleed) target.pushOperators(popGraphicsState());
	}

	const relayout = input.sheets && !isNative(input.sheets) ? input.sheets : null;
	// Vector modules are embedded lazily on save; flush so re-embedding the pages onto sheets sees them.
	if (relayout) await out.flush();
	const doc = relayout ? await buildSheets(out, relayout, !!input.tileLabels, bleed) : out;
	// Bookmarks and labels point at each page's first sheet.
	const firstSheet = new Map<number, number>();
	const plan = input.sheets ?? input.pages.map((_p, i) => ({ parts: [{ page: i }] }));
	plan.forEach((s, i) => s.parts.forEach((p) => firstSheet.has(p.page) || firstSheet.set(p.page, i)));
	addOutline(doc, input.pages.flatMap((p, i) => (p.name && firstSheet.has(i) ? [{ title: p.name, pageIndex: firstSheet.get(i)! }] : [])));
	if (input.pageLabels) addPageLabels(doc, doc === out ? input.pageLabels : sheetLabels(input.sheets!, input.pageLabels, input.pageNames ?? []));
	doc.setTitle(input.title);
	doc.setCreator('Patchwork for Obsidian');
	return { bytes: await doc.save(), problems };
}

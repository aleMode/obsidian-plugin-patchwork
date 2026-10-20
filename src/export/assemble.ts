import { clip, degrees, endPath, grayscale, PDFDocument, PDFHexString, PDFName, type PDFPage, popGraphicsState, pushGraphicsState, rectangle } from '@cantoo/pdf-lib';
import { drawOrder, vectorTarget } from '../model/exportPlan';
import { cropToUserBox, drawPlacement, FULL_PAGE } from '../model/pdfGeometry';
import type { PdfPageLabel } from '../model/numbering';
import type { Page, PdfModule } from '../model/schema';
import type { SheetPart } from '../model/sheetPlan';
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
	sheets?: SheetPart[];
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

async function drawVectorModule(out: PDFDocument, target: PDFPage, src: PDFDocument, m: PdfModule) {
	const sp = src.getPage(m.page - 1);
	const cb = sp.getCropBox();
	const rotate = sp.getRotation().angle;
	const box = cropToUserBox({ x: cb.x, y: cb.y, w: cb.width, h: cb.height }, rotate, m.crop ?? FULL_PAGE);
	const embedded = await out.embedPage(sp, box);
	const { content, clip: c } = vectorTarget(m, { w: cb.width, h: cb.height, rotate }, target.getHeight());
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

/**
 * Lay the native printed pages out on output sheets (SPEC 9.2): tiles and scaled pages are embedded
 * as clipped vector copies, so text and vector PDF regions stay sharp.
 */
async function buildSheets(native: PDFDocument, plan: SheetPart[], tileLabels: boolean): Promise<PDFDocument> {
	const doc = await PDFDocument.create();
	const k = PT_PER_MM;
	for (const part of plan) {
		const src = native.getPage(part.page);
		const H = src.getHeight();
		const box = { left: part.src.x * k, right: (part.src.x + part.src.w) * k, top: H - part.src.y * k, bottom: H - (part.src.y + part.src.h) * k };
		const embedded = await doc.embedPage(src, box);
		const sheet = doc.addPage([part.sheet.w * k, part.sheet.h * k]);
		const s = part.dest.scale;
		// Top-left aligned at dest; edge tiles keep blank padding so every sheet is the same size.
		const top = (part.sheet.h - part.dest.y) * k;
		sheet.drawPage(embedded, { x: part.dest.x * k, y: top - embedded.height * s, xScale: s, yScale: s });
		if (tileLabels && part.tile) sheet.drawText(part.tile, { x: 3 * k, y: 3 * k, size: 7, color: grayscale(0.45) });
	}
	return doc;
}

/** One label per output sheet: tiles become "iii B2"; whole pages keep their numbering style. */
function sheetLabels(plan: SheetPart[], pageLabels: PdfPageLabel[], pageNames: string[]): PdfPageLabel[] {
	return plan.map((s) => (s.tile ? { prefix: `${pageNames[s.page] ?? s.page + 1} ${s.tile}` } : pageLabels[s.page] ?? { style: 'D', start: s.page + 1 }));
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
	for (const [i, page] of input.pages.entries()) {
		if (i >= out.getPageCount()) break;
		for (const m of drawOrder(page.modules)) {
			if (!input.vector.has(m.id)) continue;
			const pm = m as PdfModule;
			try {
				const src = await sources.get(pm.file);
				if (pm.page > src.getPageCount()) throw new Error(`it has only ${src.getPageCount()} pages`);
				await drawVectorModule(out, out.getPage(i), src, pm);
			} catch (e) {
				problems.push(`${pm.file} p. ${pm.page} on "${page.name ?? 'page ' + (i + 1)}": ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	}

	const native = input.sheets?.every((s) => s.dest.scale === 1 && s.dest.x === 0 && s.dest.y === 0 && !s.tile && s.src.x === 0 && s.src.y === 0);
	const doc = input.sheets && !native ? await buildSheets(out, input.sheets, !!input.tileLabels) : out;
	// Bookmarks and labels point at each page's first sheet.
	const firstSheet = new Map<number, number>();
	(input.sheets ?? input.pages.map((_p, i) => ({ page: i }))).forEach((s, i) => firstSheet.has(s.page) || firstSheet.set(s.page, i));
	addOutline(doc, input.pages.flatMap((p, i) => (p.name && firstSheet.has(i) ? [{ title: p.name, pageIndex: firstSheet.get(i)! }] : [])));
	if (input.pageLabels) addPageLabels(doc, doc === out ? input.pageLabels : sheetLabels(input.sheets!, input.pageLabels, input.pageNames ?? []));
	doc.setTitle(input.title);
	doc.setCreator('Patchwork for Obsidian');
	return { bytes: await doc.save(), problems };
}

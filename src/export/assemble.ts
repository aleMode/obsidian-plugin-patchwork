import { clip, degrees, endPath, PDFDocument, PDFHexString, PDFName, type PDFPage, popGraphicsState, pushGraphicsState, rectangle } from '@cantoo/pdf-lib';
import { drawOrder, vectorTarget } from '../model/exportPlan';
import { cropToUserBox, drawPlacement, FULL_PAGE } from '../model/pdfGeometry';
import type { PdfPageLabel } from '../model/numbering';
import type { Page, PdfModule } from '../model/schema';

// Stage 2 of export (SPEC 9.1, spike S8): merge the printed batches, draw vector PDF modules clipped
// to their boxes, and add what Chromium can't (bookmarks, metadata).

export interface AssembleInput {
	printed: Uint8Array[];
	pages: readonly Page[];
	vector: ReadonlySet<string>;
	readSource: (path: string) => Promise<Uint8Array>;
	title: string;
	pageLabels?: PdfPageLabel[] | null;
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

	addOutline(out, input.pages.flatMap((p, i) => (p.name ? [{ title: p.name, pageIndex: i }] : [])));
	if (input.pageLabels) addPageLabels(out, input.pageLabels);
	out.setTitle(input.title);
	out.setCreator('Patchwork for Obsidian');
	return { bytes: await out.save(), problems };
}

import { App, loadPdfJs, TFile } from 'obsidian';

// Shared PDF.js documents, one per vault file, reference-counted (hard rule 9: release when unused).

// The subset of PDF.js we use. Obsidian's loadPdfJs() returns it untyped.
export interface PdfViewport {
	width: number;
	height: number;
	/** PDF user space → viewport pixels (top-left origin, page rotation applied). */
	convertToViewportPoint(x: number, y: number): number[];
}
export interface PdfTextItem {
	str: string;
	/** [a, b, c, d, e, f]: (e, f) is the baseline start in PDF user space. */
	transform: number[];
	width: number;
	height: number;
}
export interface PdfOutlineItem {
	title: string;
	dest: string | unknown[] | null;
	items: PdfOutlineItem[];
}
export interface PdfRenderTask {
	promise: Promise<void>;
	cancel(): void;
}
export interface PdfPage {
	rotate: number;
	getViewport(opts: { scale: number }): PdfViewport;
	render(opts: { canvasContext: CanvasRenderingContext2D; canvas?: HTMLCanvasElement; viewport: PdfViewport; transform?: number[] }): PdfRenderTask;
	getTextContent(): Promise<{ items: (PdfTextItem | { type: string })[] }>;
	cleanup(): void;
}
export interface PdfDocument {
	numPages: number;
	/** PDF file identifiers; the first changes when the file is replaced by a different document. */
	fingerprints?: (string | null)[];
	getPage(n: number): Promise<PdfPage>;
	getOutline(): Promise<PdfOutlineItem[] | null>;
	getDestination(name: string): Promise<unknown[] | null>;
	getPageIndex(ref: unknown): Promise<number>;
	destroy(): Promise<void>;
}

/** What identifies this version of a PDF (PDF.js fingerprint), for stale-crop warnings. */
export function pdfSourceId(doc: PdfDocument): string | undefined {
	return doc.fingerprints?.[0] ?? undefined;
}

/** The PDF's bookmarks, flattened with depth and resolved to 1-based page numbers (spike S3). */
export async function pdfOutline(doc: PdfDocument): Promise<{ title: string; depth: number; page: number }[]> {
	const out: { title: string; depth: number; page: number }[] = [];
	const walk = async (items: PdfOutlineItem[], depth: number) => {
		for (const item of items) {
			try {
				const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
				if (dest?.[0] !== undefined) out.push({ title: item.title, depth, page: (await doc.getPageIndex(dest[0])) + 1 });
			} catch {
				// Broken bookmark: skip it, keep the rest.
			}
			if (item.items?.length) await walk(item.items, depth + 1);
		}
	};
	await walk((await doc.getOutline()) ?? [], 0);
	return out;
}

export interface TextHit {
	page: number;
	/** Normalized to the page as displayed (top-left origin). */
	rect: { x0: number; y0: number; x1: number; y1: number };
	context: string;
}

/**
 * Find `term` (case-insensitive) in every page's text, in page order, up to `limit` hits. Stops early
 * (with what it found so far) once `cancelled` says so: a newer search started, or the dialog closed.
 */
export async function searchPdf(doc: PdfDocument, term: string, limit = 100, progress?: (page: number) => void, cancelled: () => boolean = () => false): Promise<TextHit[]> {
	const needle = term.trim().toLowerCase();
	const hits: TextHit[] = [];
	if (!needle) return hits;
	for (let n = 1; n <= doc.numPages && hits.length < limit && !cancelled(); n++) {
		progress?.(n);
		const page = await doc.getPage(n);
		const vp = page.getViewport({ scale: 1 });
		const text = await pageText(doc, n, page);
		if (!text) continue;
		const items = text.filter((i): i is PdfTextItem => 'str' in i);
		for (const it of items) {
			const at = it.str.toLowerCase().indexOf(needle);
			if (at < 0) continue;
			// Approximate the match's horizontal span from character positions within the item.
			const len = Math.max(1, it.str.length);
			const [bx, by] = vp.convertToViewportPoint(it.transform[4]! + (it.width * at) / len, it.transform[5]!);
			const [ex] = vp.convertToViewportPoint(it.transform[4]! + (it.width * (at + needle.length)) / len, it.transform[5]!);
			const h = it.height || Math.hypot(it.transform[2]!, it.transform[3]!);
			hits.push({
				page: n,
				rect: { x0: Math.min(bx!, ex!) / vp.width, y0: (by! - h) / vp.height, x1: Math.max(bx!, ex!) / vp.width, y1: (by! + h * 0.25) / vp.height },
				context: it.str.trim().slice(0, 90),
			});
			if (hits.length >= limit) break;
		}
		// No page.cleanup() here: page objects are shared with renderers, and text extraction decodes
		// no images, so there is nothing worth freeing.
	}
	return hits;
}

/** Every text item's box on a page, as fractions of the displayed page (for "crop to block"). */
export async function pageTextBoxes(doc: PdfDocument, n: number): Promise<{ x0: number; y0: number; x1: number; y1: number }[]> {
	const page = await doc.getPage(n);
	const vp = page.getViewport({ scale: 1 });
	const items = ((await pageText(doc, n, page)) ?? []).filter((i): i is PdfTextItem => 'str' in i && !!i.str.trim());
	return items.map((it) => {
		const [ax, ay] = vp.convertToViewportPoint(it.transform[4]!, it.transform[5]!);
		const [bx] = vp.convertToViewportPoint(it.transform[4]! + it.width, it.transform[5]!);
		const h = it.height || Math.hypot(it.transform[2]!, it.transform[3]!);
		// Same box as a search hit: from the cap height down to just under the baseline.
		return { x0: Math.min(ax!, bx!) / vp.width, y0: (ay! - h) / vp.height, x1: Math.max(ax!, bx!) / vp.width, y1: (ay! + h * 0.25) / vp.height };
	});
}

/**
 * A page's text items, or null if it can't be read. PDF.js shares one page object per page across
 * all users; a renderer calling cleanup() on it mid-extraction can stall the text stream forever
 * (seen in M3), so extraction is time-boxed and retried once on a fresh page object.
 */
async function pageText(doc: PdfDocument, n: number, page: PdfPage): Promise<(PdfTextItem | { type: string })[] | null> {
	const attempt = (p: PdfPage) =>
		Promise.race([p.getTextContent().then((t) => t.items), new Promise<null>((r) => window.setTimeout(() => r(null), 4000))]);
	return (await attempt(page)) ?? (await attempt(await doc.getPage(n)));
}
export interface PdfJs {
	getDocument(params: object): { promise: Promise<PdfDocument> };
}

/**
 * The asset URLs Obsidian's own PDF viewer passes to PDF.js (spike S3). They point into the app
 * bundle, not a plugin API, so they live here only. Standard fonts render without them, but CJK
 * CMaps, JPEG 2000 and ICC profiles need them.
 */
export const PDF_DOC_PARAMS = {
	cMapUrl: '/lib/pdfjs/cmaps/',
	cMapPacked: true,
	standardFontDataUrl: '/lib/pdfjs/standard_fonts/',
	wasmUrl: '/lib/pdfjs/wasm/',
	iccUrl: '/lib/pdfjs/iccs/',
	isEvalSupported: false,
};

/** Keep an unused document briefly, so scrolling a page off and back doesn't reparse a 60 MB file. */
const RELEASE_DELAY_MS = 15_000;
/**
 * PDF renders allowed at once. Each render has a main-thread part (~50 ms on a heavy page, spike S3);
 * running dozens together freezes the UI, so the rest wait their turn.
 */
const MAX_CONCURRENT_RENDERS = 2;

interface Entry {
	promise: Promise<PdfDocument>;
	refs: number;
	timer: number | null;
}

export class PdfDocCache {
	private entries = new Map<string, Entry>();
	private listeners = new Set<(path: string) => void>();
	private running = 0;
	private waiting: (() => void)[] = [];

	constructor(private app: App) {}

	acquire(path: string): Promise<PdfDocument> {
		let e = this.entries.get(path);
		if (!e) {
			e = { promise: this.open(path), refs: 0, timer: null };
			this.entries.set(path, e);
			// A failed load must not stay cached, or a fixed file would never be retried.
			e.promise.catch(() => this.entries.get(path) === e && this.entries.delete(path));
		}
		if (e.timer !== null) {
			window.clearTimeout(e.timer);
			e.timer = null;
		}
		e.refs++;
		return e.promise;
	}

	release(path: string) {
		const e = this.entries.get(path);
		if (!e || --e.refs > 0) return;
		e.timer = window.setTimeout(() => this.drop(path), RELEASE_DELAY_MS);
	}

	/** Run a render when a slot is free. */
	async schedule<T>(fn: () => Promise<T>): Promise<T> {
		if (this.running >= MAX_CONCURRENT_RENDERS) await new Promise<void>((r) => this.waiting.push(r));
		this.running++;
		try {
			return await fn();
		} finally {
			this.running--;
			this.waiting.shift()?.();
		}
	}

	/**
	 * The file changed or went away: drop the parsed document and tell modules to re-render. Returns
	 * false when the document wasn't open (nobody was told).
	 */
	invalidate(path: string): boolean {
		if (!this.entries.has(path)) return false;
		this.drop(path);
		for (const l of this.listeners) l(path);
		return true;
	}

	onInvalidate(listener: (path: string) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	destroyAll() {
		for (const path of [...this.entries.keys()]) this.drop(path);
	}

	private drop(path: string) {
		const e = this.entries.get(path);
		if (!e) return;
		this.entries.delete(path);
		if (e.timer !== null) window.clearTimeout(e.timer);
		e.promise.then((doc) => doc.destroy()).catch(() => {});
	}

	private async open(path: string): Promise<PdfDocument> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`);
		const [lib, data] = await Promise.all([loadPdfJs() as Promise<PdfJs>, this.app.vault.readBinary(file)]);
		return lib.getDocument({ data: new Uint8Array(data), ...PDF_DOC_PARAMS }).promise;
	}
}

/** Read a source PDF's raw bytes (for vector export). */
export async function readPdfBytes(app: App, path: string): Promise<Uint8Array> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`);
	return new Uint8Array(await app.vault.readBinary(file));
}

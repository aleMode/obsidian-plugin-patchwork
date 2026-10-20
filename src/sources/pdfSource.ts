import { App, loadPdfJs, TFile } from 'obsidian';

// Shared PDF.js documents, one per vault file, reference-counted (hard rule 9: release when unused).

// The subset of PDF.js we use. Obsidian's loadPdfJs() returns it untyped.
export interface PdfViewport {
	width: number;
	height: number;
}
export interface PdfRenderTask {
	promise: Promise<void>;
	cancel(): void;
}
export interface PdfPage {
	rotate: number;
	getViewport(opts: { scale: number }): PdfViewport;
	render(opts: { canvasContext: CanvasRenderingContext2D; canvas?: HTMLCanvasElement; viewport: PdfViewport; transform?: number[] }): PdfRenderTask;
	cleanup(): void;
}
export interface PdfDocument {
	numPages: number;
	getPage(n: number): Promise<PdfPage>;
	destroy(): Promise<void>;
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

	/** The file changed or went away: drop the parsed document and tell modules to re-render. */
	invalidate(path: string) {
		if (!this.entries.has(path)) return;
		this.drop(path);
		for (const l of this.listeners) l(path);
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

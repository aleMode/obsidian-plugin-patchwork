import { TFile } from 'obsidian';
import { fitRect } from '../model/geometry';
import { displayedCropSize, FULL_PAGE, normalizeRotation } from '../model/pdfGeometry';
import type { AnyModule, Crop, PdfModule } from '../model/schema';
import { contentBox } from '../model/style';
import { PX_PER_MM } from '../model/units';
import { BitmapCache, bucketResolution } from '../render/bitmapCache';
import type { PdfDocument, PdfPage } from '../sources/pdfSource';
import { type ModuleContext, type ModuleRenderer, placeholder } from './types';

/** Never allocate a canvas side beyond this, whatever the module size (memory, spike S4). */
const MAX_CANVAS_SIDE = 4096;

interface Layout {
	crop: Crop;
	rot: number;
	/** Where the content sits in the module (mm), and its size before the module's rotation. */
	placed: { x: number; y: number; w: number; h: number };
	unrotated: { w: number; h: number };
	px: { w: number; h: number };
	pxPerMm: number;
}

export class PdfModuleRenderer implements ModuleRenderer {
	/** The one document reference this renderer holds (acquired once per file, not per render). */
	private doc: { path: string; promise: Promise<PdfDocument> } | null = null;
	private task: { cancel(): void } | null = null;
	private generation = 0;
	private deps = new Set<string>();
	private done: Promise<void> = Promise.resolve();
	private renderedPxPerMm = 0;
	/** What is on screen: a canvas, and its cache key if the cache owns it. */
	private shown: { canvas: HTMLCanvasElement; key: string | null } | null = null;

	/** `pxPerMm`: fixed canvas resolution (export passes its DPI). Otherwise follows the zoom. */
	constructor(private el: HTMLElement, private ctx: ModuleContext, private pxPerMm?: number) {}

	dependencies(): ReadonlySet<string> {
		return this.deps;
	}

	rendered(): Promise<void> {
		return this.done;
	}

	/** True when the current canvas is too blurry or needlessly large for `pxPerMm`. */
	wantsResolution(pxPerMm: number): boolean {
		if (this.pxPerMm !== undefined || this.renderedPxPerMm === 0) return false;
		return this.renderedPxPerMm < pxPerMm * 0.7 || this.renderedPxPerMm > pxPerMm * 2.5;
	}

	render(m: AnyModule) {
		const mod = m as PdfModule;
		this.cancel();
		const gen = ++this.generation;
		this.deps = new Set([mod.file]);
		this.done = this.load(mod, gen).catch((e: unknown) => {
			if (gen !== this.generation) return;
			if ((e as Error)?.name === 'RenderingCancelledException') return;
			this.clearShown();
			placeholder(this.el, `Could not render ${mod.file} p. ${mod.page}: ${(e as Error)?.message ?? String(e)}`);
		});
	}

	private async load(m: PdfModule, gen: number) {
		const doc = await this.document(m.file);
		if (gen !== this.generation) return;
		if (m.page > doc.numPages) {
			this.clearShown();
			return placeholder(this.el, `${m.file} has only ${doc.numPages} pages (module wants page ${m.page})`);
		}
		const page: PdfPage = await doc.getPage(m.page);
		if (gen !== this.generation) return;
		const layout = this.layout(page, m);
		const key = this.cacheKey(m, layout);
		const cached = key ? this.ctx.bitmaps?.take(key) : undefined;
		if (cached && key) return this.show(cached, key, layout);
		// Rendering waits for a free slot; a newer render may have started meanwhile.
		await this.ctx.pdfDocs.schedule(async () => {
			if (gen !== this.generation) return;
			try {
				const canvas = await this.draw(page, layout);
				if (gen !== this.generation) {
					canvas.width = canvas.height = 0;
					return;
				}
				const owned = key && this.ctx.bitmaps?.put(key, canvas) ? key : null;
				this.show(canvas, owned, layout);
			} finally {
				// PDF.js keeps a page's decoded images until cleanup(); on an illustrated rulebook that is
				// tens of MB per page (perf probe: 5 GB for 100 pages without this).
				page.cleanup();
			}
		});
	}

	private layout(page: PdfPage, m: PdfModule): Layout {
		const crop = m.crop ?? FULL_PAGE;
		const vp1 = page.getViewport({ scale: 1 });
		const rot = normalizeRotation(m.rotation ?? 0);
		// The viewport already applies the page's own /Rotate, so pass 0 for the page here.
		const shown = displayedCropSize({ w: vp1.width, h: vp1.height }, 0, crop, rot);
		// Coordinates are relative to the module body, which already sits inside border and padding.
		const box = contentBox(m);
		const placed = fitRect(shown.w / shown.h, { x: 0, y: 0, w: box.w, h: box.h }, m.fit ?? 'contain');
		// The canvas holds the crop before the module's rotation.
		const unrotated = rot % 180 ? { w: placed.h, h: placed.w } : { w: placed.w, h: placed.h };
		const want = this.pxPerMm ?? this.ctx.resolution?.() ?? PX_PER_MM * window.devicePixelRatio;
		const pxPerMm = this.pxPerMm ?? bucketResolution(want, PX_PER_MM);
		const w = Math.min(MAX_CANVAS_SIDE, Math.max(1, Math.ceil(unrotated.w * pxPerMm)));
		const h = Math.min(MAX_CANVAS_SIDE, Math.max(1, Math.ceil(unrotated.h * pxPerMm)));
		return { crop, rot, placed, unrotated, px: { w, h }, pxPerMm };
	}

	/** Export renders at a fixed DPI once; only on-screen renders are worth caching. */
	private cacheKey(m: PdfModule, l: Layout): string | null {
		if (this.pxPerMm !== undefined || !this.ctx.bitmaps) return null;
		const file = this.ctx.app.vault.getAbstractFileByPath(m.file);
		const mtime = file instanceof TFile ? file.stat.mtime : 0;
		return BitmapCache.key({ file: m.file, mtime, page: m.page, crop: l.crop, w: l.px.w, h: l.px.h });
	}

	private async draw(page: PdfPage, l: Layout): Promise<HTMLCanvasElement> {
		const vp1 = page.getViewport({ scale: 1 });
		const scale = l.px.w / ((l.crop[2] - l.crop[0]) * vp1.width);
		const vp = page.getViewport({ scale });
		const canvas = createEl('canvas', { cls: 'pw-pdf-canvas' });
		canvas.width = l.px.w;
		canvas.height = l.px.h;
		const c2d = canvas.getContext('2d');
		if (!c2d) throw new Error('No 2D canvas context');
		c2d.fillStyle = '#fff';
		c2d.fillRect(0, 0, canvas.width, canvas.height);
		const task = page.render({ canvasContext: c2d, canvas, viewport: vp, transform: [1, 0, 0, 1, -l.crop[0] * vp.width, -l.crop[1] * vp.height] });
		this.task = task;
		try {
			await task.promise;
		} catch (e) {
			canvas.width = canvas.height = 0;
			throw e;
		} finally {
			this.task = null;
		}
		return canvas;
	}

	private show(canvas: HTMLCanvasElement, key: string | null, l: Layout) {
		this.clearShown();
		this.el.empty();
		canvas.setCssProps({
			'--pw-x': `${l.placed.x + (l.placed.w - l.unrotated.w) / 2}mm`,
			'--pw-y': `${l.placed.y + (l.placed.h - l.unrotated.h) / 2}mm`,
			'--pw-w': `${l.unrotated.w}mm`,
			'--pw-h': `${l.unrotated.h}mm`,
			'--pw-rotate': `${l.rot}deg`,
		});
		this.el.appendChild(canvas);
		this.shown = { canvas, key };
		this.renderedPxPerMm = l.pxPerMm;
	}

	/** Take the canvas off screen: back to the cache if it owns it, otherwise free it now. */
	private clearShown() {
		const s = this.shown;
		if (!s) return;
		this.shown = null;
		s.canvas.remove();
		if (s.key) this.ctx.bitmaps?.release(s.key);
		else s.canvas.width = s.canvas.height = 0;
	}

	private document(path: string): Promise<PdfDocument> {
		if (this.doc?.path !== path) {
			this.releaseDoc();
			const promise = this.ctx.pdfDocs.acquire(path);
			this.doc = { path, promise };
			// A failed acquire holds no reference; forget it so the next render retries.
			promise.catch(() => {
				if (this.doc?.promise === promise) this.doc = null;
			});
		}
		return this.doc.promise;
	}

	private cancel() {
		this.task?.cancel();
		this.task = null;
	}

	private releaseDoc() {
		if (this.doc) this.ctx.pdfDocs.release(this.doc.path);
		this.doc = null;
	}

	destroy() {
		this.generation++;
		this.cancel();
		this.releaseDoc();
		this.clearShown();
		this.el.empty();
	}
}

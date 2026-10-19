import { fitRect } from '../model/geometry';
import { displayedCropSize, FULL_PAGE, normalizeRotation } from '../model/pdfGeometry';
import type { AnyModule, PdfModule } from '../model/schema';
import { PX_PER_MM } from '../model/units';
import type { PdfDocument, PdfPage } from '../sources/pdfSource';
import { type ModuleContext, type ModuleRenderer, placeholder } from './types';

/**
 * Canvas pixels per CSS pixel. Fixed for M0 (sharp up to ~200% zoom on a 1× screen);
 * zoom-dependent re-rendering (LOD) comes with the render scheduler.
 */
const DENSITY = 2;
/** Never allocate a canvas side beyond this, whatever the module size (memory, spike S4). */
const MAX_CANVAS_SIDE = 4096;

export class PdfModuleRenderer implements ModuleRenderer {
	/** The one document reference this renderer holds (acquired once per file, not per render). */
	private doc: { path: string; promise: Promise<PdfDocument> } | null = null;
	private task: { cancel(): void } | null = null;
	private generation = 0;
	private deps = new Set<string>();

	constructor(private el: HTMLElement, private ctx: ModuleContext) {}

	dependencies(): ReadonlySet<string> {
		return this.deps;
	}

	render(m: AnyModule) {
		const mod = m as PdfModule;
		this.cancel();
		const gen = ++this.generation;
		this.deps = new Set([mod.file]);
		void this.draw(mod, gen).catch((e: unknown) => {
			if (gen !== this.generation) return;
			const name = (e as Error)?.name;
			if (name === 'RenderingCancelledException') return;
			placeholder(this.el, `Could not render ${mod.file} p. ${mod.page}: ${(e as Error)?.message ?? String(e)}`);
		});
	}

	private async draw(m: PdfModule, gen: number) {
		const doc = await this.document(m.file);
		if (gen !== this.generation) return;
		if (m.page > doc.numPages) return placeholder(this.el, `${m.file} has only ${doc.numPages} pages (module wants page ${m.page})`);
		const page: PdfPage = await doc.getPage(m.page);
		if (gen !== this.generation) return;

		const crop = m.crop ?? FULL_PAGE;
		const vp1 = page.getViewport({ scale: 1 });
		const rot = normalizeRotation(m.rotation ?? 0);
		// The viewport already applies the page's own /Rotate, so pass 0 for the page here.
		const shown = displayedCropSize({ w: vp1.width, h: vp1.height }, 0, crop, rot);
		const placed = fitRect(shown.w / shown.h, { x: 0, y: 0, w: m.w, h: m.h }, m.fit ?? 'contain');

		// Canvas holds the crop before the module's rotation.
		const unrotated = rot % 180 ? { w: placed.h, h: placed.w } : { w: placed.w, h: placed.h };
		const pxW = Math.min(MAX_CANVAS_SIDE, Math.ceil(unrotated.w * PX_PER_MM * DENSITY * window.devicePixelRatio));
		const scale = pxW / ((crop[2] - crop[0]) * vp1.width);
		const vp = page.getViewport({ scale });
		const canvas = createEl('canvas', { cls: 'pw-pdf-canvas' });
		canvas.width = pxW;
		canvas.height = Math.min(MAX_CANVAS_SIDE, Math.ceil((crop[3] - crop[1]) * vp.height));
		const c2d = canvas.getContext('2d');
		if (!c2d) throw new Error('No 2D canvas context');
		c2d.fillStyle = '#fff';
		c2d.fillRect(0, 0, canvas.width, canvas.height);
		const task = page.render({ canvasContext: c2d, canvas, viewport: vp, transform: [1, 0, 0, 1, -crop[0] * vp.width, -crop[1] * vp.height] });
		this.task = task;
		await task.promise;
		this.task = null;
		if (gen !== this.generation) return;

		canvas.setCssProps({
			'--pw-x': `${placed.x + (placed.w - unrotated.w) / 2}mm`,
			'--pw-y': `${placed.y + (placed.h - unrotated.h) / 2}mm`,
			'--pw-w': `${unrotated.w}mm`,
			'--pw-h': `${unrotated.h}mm`,
			'--pw-rotate': `${rot}deg`,
		});
		this.el.empty();
		this.el.appendChild(canvas);
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
		// Free the canvas backing store now rather than at garbage collection.
		this.el.querySelectorAll('canvas').forEach((c) => (c.width = c.height = 0));
		this.el.empty();
	}
}

import { App, Modal, Setting } from 'obsidian';
import { type Handle, resizeRect } from '../model/geometry';
import { cropAroundHit, cropFromPoints, FULL_PAGE, moveCrop, tidyCrop } from '../model/pdfGeometry';
import type { Crop } from '../model/schema';
import { type PdfDocCache, type PdfDocument, pdfOutline, pdfSourceId, searchPdf } from '../sources/pdfSource';

export interface CropResult {
	page: number;
	/** Undefined means the whole page. */
	crop: Crop | undefined;
	/** Width / height of the result as displayed, for sizing the module to match. */
	aspect: number;
	resizeModule: boolean;
	/** Identifies the PDF version the crop was made on (stale-crop warnings). */
	sourceId?: string;
}

type Gesture =
	| { kind: 'draw'; from: { x: number; y: number } }
	| { kind: 'move'; from: { x: number; y: number }; start: Crop }
	| { kind: 'resize'; handle: Handle; from: { x: number; y: number }; start: Crop };

/** Largest preview, in CSS px; the page is fitted inside, leaving room for the tools and buttons. */
const MAX_W = 720;
const MAX_H_VH = 0.5;

/**
 * Pick a page and drag a crop rectangle over it (SPEC 5.3). Draw a new rectangle on empty space,
 * drag inside it to move, drag a corner to resize. Coordinates are normalized to the displayed page.
 */
export class CropModal extends Modal {
	/** Open editors, closed when the plugin unloads: their PDF documents are destroyed with it. */
	private static open = new Set<CropModal>();

	static closeAll() {
		for (const m of [...CropModal.open]) m.close();
	}

	private page: number;
	private crop: Crop;
	private pdfDoc: PdfDocument | null = null;
	private pageCount = 1;
	private pageAspect = 1;
	private stage!: HTMLElement;
	private canvas: HTMLCanvasElement | null = null;
	private box!: HTMLElement;
	private pageLabel!: HTMLElement;
	private contents!: HTMLElement;
	private results!: HTMLElement;
	private gesture: Gesture | null = null;
	private resizeModule = true;

	constructor(
		app: App,
		private pdfDocs: PdfDocCache,
		private path: string,
		initial: { page: number; crop?: Crop },
		private onApply: (r: CropResult) => void,
	) {
		super(app);
		this.page = initial.page;
		this.crop = initial.crop ?? FULL_PAGE;
	}

	async onOpen() {
		CropModal.open.add(this);
		this.modalEl.addClass('pw-crop-modal');
		this.setTitle(`Crop: ${this.path.replace(/^.*\//, '')}`);
		const nav = this.contentEl.createDiv({ cls: 'pw-crop-nav' });
		nav.createEl('button', { text: 'Previous' }, (b) => b.addEventListener('click', () => void this.goTo(this.page - 1)));
		this.pageLabel = nav.createSpan({ cls: 'pw-crop-page' });
		nav.createEl('button', { text: 'Next' }, (b) => b.addEventListener('click', () => void this.goTo(this.page + 1)));
		nav.createEl('button', { text: 'Full page' }, (b) => b.addEventListener('click', () => this.setCrop(FULL_PAGE)));
		this.contents = this.contentEl.createDiv({ cls: 'pw-crop-tools' });
		this.buildSearch(this.contents);
		this.results = this.contentEl.createDiv({ cls: 'pw-crop-results' });
		this.stage = this.contentEl.createDiv({ cls: 'pw-crop-stage' });
		this.box = this.stage.createDiv({ cls: 'pw-crop-box' });
		for (const h of ['nw', 'ne', 'se', 'sw']) this.box.createDiv({ cls: `pw-crop-handle pw-handle-${h}`, attr: { 'data-handle': h } });
		this.bindPointer();
		this.contentEl.createEl('p', { cls: 'setting-item-description', text: 'Drag on the page to draw a crop, drag inside it to move it, drag a corner to resize.' });
		new Setting(this.contentEl).setName('Resize module to the crop shape').addToggle((t) => t.setValue(this.resizeModule).onChange((v) => (this.resizeModule = v)));
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => b.setButtonText('Apply').setCta().onClick(() => this.apply()));
		try {
			this.pdfDoc = await this.pdfDocs.acquire(this.path);
			this.pageCount = this.pdfDoc.numPages;
			await this.goTo(this.page);
			void this.buildContents(this.pdfDoc);
		} catch (e) {
			this.stage.setText(`Could not open ${this.path}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	private async goTo(page: number) {
		if (!this.pdfDoc || page < 1 || page > this.pageCount) return;
		if (page !== this.page) this.crop = FULL_PAGE;
		this.page = page;
		this.pageLabel.setText(`Page ${page} of ${this.pageCount}`);
		const p = await this.pdfDoc.getPage(page);
		const vp1 = p.getViewport({ scale: 1 });
		this.pageAspect = vp1.width / vp1.height;
		const maxH = window.innerHeight * MAX_H_VH;
		const cssW = Math.min(MAX_W, maxH * this.pageAspect);
		const dpr = window.devicePixelRatio || 1;
		const vp = p.getViewport({ scale: (cssW * dpr) / vp1.width });
		const canvas = createEl('canvas', { cls: 'pw-crop-canvas' });
		canvas.width = Math.ceil(vp.width);
		canvas.height = Math.ceil(vp.height);
		const c2d = canvas.getContext('2d');
		if (!c2d) return;
		c2d.fillStyle = '#fff';
		c2d.fillRect(0, 0, canvas.width, canvas.height);
		try {
			await p.render({ canvasContext: c2d, canvas, viewport: vp }).promise;
		} finally {
			p.cleanup();
		}
		if (page !== this.page) return;
		if (this.canvas) this.canvas.width = this.canvas.height = 0;
		this.canvas?.remove();
		this.canvas = canvas;
		this.stage.prepend(canvas);
		this.stage.setCssProps({ '--pw-crop-w': `${cssW}px`, '--pw-crop-h': `${cssW / this.pageAspect}px` });
		this.setCrop(this.crop);
	}

	/** Jump by bookmark instead of paging (SPEC 4 M3: pick a PDF section from its outline). */
	private async buildContents(doc: PdfDocument) {
		const entries = await pdfOutline(doc).catch(() => []);
		if (!entries.length || this.pdfDoc !== doc) return;
		const select = this.contents.createEl('select', { cls: 'dropdown pw-crop-contents', attr: { 'aria-label': 'Contents' } });
		select.createEl('option', { text: 'Contents…', value: '' });
		for (const e of entries) select.createEl('option', { text: `${'\u2003'.repeat(e.depth)}${e.title} (p. ${e.page})`, value: String(e.page) });
		select.addEventListener('change', () => {
			if (select.value) void this.goTo(Number(select.value));
		});
		this.contents.prepend(select);
	}

	/** Search the whole PDF and propose a crop around a hit (SPEC 4 M3). */
	private buildSearch(el: HTMLElement) {
		const input = el.createEl('input', { type: 'search', cls: 'pw-crop-search', attr: { placeholder: 'Search this PDF…' } });
		const run = async () => {
			const doc = this.pdfDoc;
			if (!doc) return;
			this.results.empty();
			const status = this.results.createDiv({ cls: 'pw-crop-status', text: 'Searching…' });
			let hits: Awaited<ReturnType<typeof searchPdf>>;
			try {
				hits = await searchPdf(doc, input.value, 100, (n) => status.setText(`Searching page ${n} of ${doc.numPages}…`));
			} catch (e) {
				status.setText(`Search failed: ${e instanceof Error ? e.message : String(e)}`);
				return;
			}
			if (this.pdfDoc !== doc) return;
			status.setText(hits.length ? `${hits.length}${hits.length === 100 ? '+' : ''} matches` : 'No matches.');
			for (const h of hits) {
				const row = this.results.createDiv({ cls: 'pw-crop-hit' });
				row.createSpan({ cls: 'pw-crop-hit-page', text: `p. ${h.page}` });
				row.createSpan({ text: h.context });
				row.addEventListener('click', () => {
					void this.goTo(h.page).then(() => this.setCrop(cropAroundHit(h.rect)));
					this.results.querySelectorAll('.is-active').forEach((r) => r.removeClass('is-active'));
					row.addClass('is-active');
				});
			}
		};
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				void run();
			}
		});
	}

	private setCrop(c: Crop) {
		this.crop = c;
		const [x0, y0, x1, y1] = c;
		this.box.setCssProps({ '--pw-x': `${x0 * 100}%`, '--pw-y': `${y0 * 100}%`, '--pw-w': `${(x1 - x0) * 100}%`, '--pw-h': `${(y1 - y0) * 100}%` });
	}

	private point(e: PointerEvent) {
		const r = this.stage.getBoundingClientRect();
		return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
	}

	private bindPointer() {
		this.stage.addEventListener('pointerdown', (e) => {
			const p = this.point(e);
			const handle = (e.target as HTMLElement).closest<HTMLElement>('.pw-crop-handle')?.dataset.handle as Handle | undefined;
			if (handle) this.gesture = { kind: 'resize', handle, from: p, start: this.crop };
			// A full-page box covers everything, so dragging it would only ever move nothing: draw instead.
			else if ((e.target as HTMLElement).closest('.pw-crop-box') && !this.isFullPage()) this.gesture = { kind: 'move', from: p, start: this.crop };
			else this.gesture = { kind: 'draw', from: p };
			this.stage.setPointerCapture(e.pointerId);
			e.preventDefault();
		});
		this.stage.addEventListener('pointermove', (e) => {
			const g = this.gesture;
			if (!g) return;
			const p = this.point(e);
			if (g.kind === 'draw') {
				const c = cropFromPoints(g.from, p);
				if (c) this.setCrop(c);
			} else if (g.kind === 'move') this.setCrop(moveCrop(g.start, p.x - g.from.x, p.y - g.from.y));
			else {
				const [x0, y0, x1, y1] = g.start;
				const r = resizeRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, g.handle, p.x - g.from.x, p.y - g.from.y, { min: 0.01 });
				const c = cropFromPoints({ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h });
				if (c) this.setCrop(c);
			}
		});
		const end = (e: PointerEvent) => {
			this.gesture = null;
			if (this.stage.hasPointerCapture(e.pointerId)) this.stage.releasePointerCapture(e.pointerId);
		};
		this.stage.addEventListener('pointerup', end);
		this.stage.addEventListener('pointercancel', end);
	}

	private isFullPage() {
		return this.crop.every((v, i) => v === FULL_PAGE[i]);
	}

	private apply() {
		const full = this.isFullPage();
		const crop = full ? undefined : tidyCrop(this.crop);
		const [x0, y0, x1, y1] = this.crop;
		const aspect = ((x1 - x0) * this.pageAspect) / (y1 - y0);
		// Before close(): closing releases the document.
		const sourceId = this.pdfDoc ? pdfSourceId(this.pdfDoc) : undefined;
		this.close();
		this.onApply({ page: this.page, crop, aspect, resizeModule: this.resizeModule, ...(sourceId ? { sourceId } : {}) });
	}

	onClose() {
		CropModal.open.delete(this);
		if (this.canvas) this.canvas.width = this.canvas.height = 0;
		if (this.pdfDoc) this.pdfDocs.release(this.path);
		this.pdfDoc = null;
		this.contentEl.empty();
	}
}

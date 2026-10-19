import { Menu, Notice, setIcon, TFile } from 'obsidian';
import { exportBoardPdf } from '../export/exportPdf';
import { allIds } from '../model/defaults';
import { bounds, containsPoint, type Handle, inset, intersects, type Point, type Rect, resizeRect } from '../model/geometry';
import { newId } from '../model/ids';
import { orderedPages } from '../model/ordering';
import { PAGE_PRESETS, swapOrientation } from '../model/presets';
import type { AnyModule, ImageModule, NoteModule, Page, PdfModule } from '../model/schema';
import { snapPoint, snapValue } from '../model/snapping';
import { PX_PER_MM } from '../model/units';
import { ModuleHost } from '../modules/ModuleHost';
import type { BitmapCache } from '../render/bitmapCache';
import { linkpathsFromDrop } from '../sources/dropLinks';
import type { PdfDocCache } from '../sources/pdfSource';
import type { BoardStore } from '../store/BoardStore';
import { addModule, addPage, defaultModuleRect, duplicateModule, duplicatePage, mapModule, mapPage, moveModule, moveModuleToPage, movePage, removeModule, removePage, restack } from '../store/pageOps';
import { CropModal, type CropResult } from '../ui/CropModal';
import { ExportModal, writeBinary } from '../ui/ExportModal';
import { FilePickerModal, SectionPickerModal, sectionsOf } from '../ui/pickers';
import { type Camera, fitCamera, panBy, screenToBoard, visibleRect, zoomAt } from './camera';
import { PageElement } from './pageElement';
import type { BoardSurface, PatchworkView } from './PatchworkView';

export interface BoardServices {
	pdfDocs: PdfDocCache;
	bitmaps: BitmapCache;
}

type Selection = { pageId: string; moduleId?: string } | null;

type Drag =
	| { kind: 'pan'; last: Point }
	| { kind: 'page'; id: string; startPointer: Point; startPos: Point }
	| { kind: 'module'; pageId: string; id: string; startPointer: Point; startPos: Point }
	| { kind: 'resize'; target: NonNullable<Selection>; handle: Handle; startPointer: Point; start: Rect };

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
/** Smallest page or module a resize can produce, in mm. */
const MIN_SIZE_MM = 5;

/** Pages within this fraction of a viewport outside the visible area count as visible (pre-mount). */
const CULL_MARGIN = 0.5;
/**
 * Below this zoom an A4 page is under ~200 px wide and text is unreadable, so pages show module
 * outlines instead of content (SPEC 8.3). Keeps "zoom to fit" on a 100-page board instant.
 */
const DETAIL_ZOOM = 0.25;
/** Wait this long after the last zoom step before re-rendering for the new zoom (SPEC 8.3). */
const ZOOM_SETTLE_MS = 150;

export class BoardViewport implements BoardSurface {
	private root: HTMLElement;
	private layer: HTMLElement;
	private selectionBox: HTMLElement;
	private zoomLabel!: HTMLElement;
	private pages = new Map<string, PageElement>();
	private modules: ModuleHost;
	private camera: Camera = { tx: 0, ty: 0, zoom: 1 };
	private selection: Selection = null;
	private drag: Drag | null = null;
	private spaceHeld = false;
	private frame = 0;
	private fitted = false;
	private visible = new Set<string>();
	private settledZoom = 0;
	private zoomTimer: number | null = null;
	private cleanups: (() => void)[] = [];

	constructor(container: HTMLElement, private store: BoardStore, private view: PatchworkView, private services: BoardServices) {
		this.root = container.createDiv({ cls: 'pw-board', attr: { tabindex: '0' } });
		this.layer = this.root.createDiv({ cls: 'pw-board-layer' });
		// Above the pages so handles are never clipped by a page edge.
		this.selectionBox = this.layer.createDiv({ cls: 'pw-selection' });
		for (const h of HANDLES) this.selectionBox.createDiv({ cls: `pw-handle pw-handle-${h}`, attr: { 'data-handle': h } });
		this.modules = new ModuleHost({
			ctx: { app: view.app, pdfDocs: services.pdfDocs, bitmaps: services.bitmaps, resolution: () => this.resolution() },
			store,
			paperOf: (id) => this.pages.get(id)?.paper,
			boardPath: () => view.file?.path ?? '',
			parent: view,
		});
		this.cleanups.push(() => this.modules.destroy());
		this.buildToolbar(container);
		this.cleanups.push(store.subscribe(() => this.render()));
		this.bindInput();
		const dup = view.scope?.register(['Mod'], 'd', () => {
			this.duplicateSelection();
			return false;
		});
		this.cleanups.push(() => dup && view.scope?.unregister(dup));
		const ro = new ResizeObserver(() => this.onResize());
		ro.observe(this.root);
		this.cleanups.push(() => ro.disconnect());
		this.render();
	}

	destroy() {
		this.root.win.cancelAnimationFrame(this.frame);
		if (this.zoomTimer !== null) this.root.win.clearTimeout(this.zoomTimer);
		this.cleanups.forEach((c) => c());
		this.root.remove();
	}

	// ---------- rendering ----------

	private render() {
		const file = this.store.file;
		const seen = new Set<string>();
		for (const page of file.pages) {
			seen.add(page.id);
			let el = this.pages.get(page.id);
			if (!el) {
				el = new PageElement(this.layer);
				this.pages.set(page.id, el);
			}
			const selected = this.selection?.pageId === page.id && !this.selection.moduleId;
			el.update(page, { appTheme: file.board.useAppTheme, unit: file.board.displayUnit, selected });
		}
		for (const [id, el] of this.pages) {
			if (!seen.has(id)) {
				el.remove();
				this.pages.delete(id);
			}
		}
		// A selection pointing at something deleted (e.g. by undo) is dropped.
		if (this.selection && !this.findSelected()) this.selection = null;
		this.modules.selectedModule = this.selection?.moduleId ?? null;
		this.renderSelectionBox();
		this.renderGrid();
		this.updateVisibility();
		this.modules.sync();
	}

	/** The selection's rect on the board (mm), and whether it can be resized. */
	private selectedRect(): { rect: Rect; locked: boolean } | null {
		const page = this.store.file.pages.find((p) => p.id === this.selection?.pageId);
		if (!page) return null;
		if (!this.selection?.moduleId) return { rect: page, locked: false };
		const m = page.modules.find((x) => x.id === this.selection?.moduleId);
		return m ? { rect: { x: page.x + m.x, y: page.y + m.y, w: m.w, h: m.h }, locked: !!m.locked } : null;
	}

	private renderSelectionBox() {
		const sel = this.selectedRect();
		const show = !!sel && !sel.locked && !this.store.readOnly;
		this.selectionBox.toggleClass('is-hidden', !show);
		if (!show) return;
		const { x, y, w, h } = sel.rect;
		this.selectionBox.setCssProps({ '--pw-x': `${x}mm`, '--pw-y': `${y}mm`, '--pw-w': `${w}mm`, '--pw-h': `${h}mm` });
	}

	private findSelected(): Page | AnyModule | undefined {
		const page = this.store.file.pages.find((p) => p.id === this.selection?.pageId);
		return this.selection?.moduleId ? page?.modules.find((m) => m.id === this.selection?.moduleId) : page;
	}

	private select(sel: Selection) {
		if (sel?.pageId === this.selection?.pageId && sel?.moduleId === this.selection?.moduleId) return;
		this.selection = sel;
		this.render();
	}

	// ---------- adding things ----------

	addPage(size: { w: number; h: number }, name?: string) {
		let added: Page | null = null;
		this.store.update((f) => {
			const r = addPage(f, size, name ?? `Page ${f.pages.length + 1}`);
			added = r.page;
			return r.file;
		});
		if (added) this.select({ pageId: (added as Page).id });
	}

	/** The page new modules go to: the selection's page, else the first visible page, else the first page. */
	private targetPage(): Page | undefined {
		const pages = orderedPages(this.store.file);
		return pages.find((p) => p.id === this.selection?.pageId) ?? pages.find((p) => this.visible.has(p.id)) ?? pages[0];
	}

	private placeModule(build: (page: Page, id: string) => AnyModule) {
		const page = this.targetPage();
		if (!page) return void new Notice('Add a page first.');
		const id = newId(allIds(this.store.file));
		this.store.update((f) => addModule(f, page.id, build(page, id)));
		this.select({ pageId: page.id, moduleId: id });
	}

	pickNote() {
		const app = this.view.app;
		new FilePickerModal(app, app.vault.getMarkdownFiles(), 'Note to add', (file) =>
			new SectionPickerModal(app, sectionsOf(app, file), (choice) =>
				this.placeModule((page, id): NoteModule => ({
					id,
					type: 'note',
					...defaultModuleRect(page),
					file: file.path,
					...(choice.subpath ? { subpath: choice.subpath } : {}),
				})),
			).open(),
		).open();
	}

	pickPdf() {
		const app = this.view.app;
		const { pdfDocs } = this.services;
		const pdfs = app.vault.getFiles().filter((f) => f.extension.toLowerCase() === 'pdf');
		new FilePickerModal(app, pdfs, 'PDF to add', (file: TFile) =>
			new CropModal(app, pdfDocs, file.path, { page: 1 }, (r) =>
				this.placeModule((page, id): PdfModule => {
					const rect = defaultModuleRect(page);
					return { id, type: 'pdf', ...rect, ...(r.resizeModule ? fitHeight(rect, r.aspect, page.h) : {}), file: file.path, page: r.page, ...(r.crop ? { crop: r.crop } : {}) };
				}),
			).open(),
		).open();
	}

	/** Open the crop editor for a PDF module and apply the result as one undoable change. */
	editCrop(pageId: string, moduleId: string) {
		const page = this.store.file.pages.find((p) => p.id === pageId);
		const m = page?.modules.find((x) => x.id === moduleId);
		if (!page || m?.type !== 'pdf' || this.store.readOnly) return;
		const pdf = m as PdfModule;
		new CropModal(this.view.app, this.services.pdfDocs, pdf.file, { page: pdf.page, crop: pdf.crop }, (r: CropResult) =>
			this.store.update((f) =>
				mapModule(f, pageId, moduleId, (x) => {
					const next: PdfModule = { ...(x as PdfModule), page: r.page, ...(r.resizeModule ? fitHeight(x, r.aspect, page.h - x.y) : {}) };
					if (r.crop) next.crop = r.crop;
					else delete next.crop;
					return next;
				}),
			),
		).open();
	}

	// ---------- export ----------

	showExport() {
		const file = this.view.file;
		if (!file) return;
		const board = this.store.file;
		const initial = {
			path: file.path.replace(/\.patchwork$/, '.pdf'),
			quality: board.board.export.quality,
			dpi: board.board.export.dpi,
			open: true,
		};
		new ExportModal(this.view.app, initial, (choices) => void this.runExport(choices)).open();
	}

	private async runExport(choices: { path: string; quality: 'best' | 'small'; dpi: number; open: boolean }) {
		const app = this.view.app;
		// Remember the choices in the board, like other export defaults (SPEC 6).
		this.store.update((f) =>
			f.board.export.quality === choices.quality && f.board.export.dpi === choices.dpi
				? f
				: { ...f, board: { ...f.board, export: { ...f.board.export, quality: choices.quality, dpi: choices.dpi } } },
		);
		const notice = new Notice('Exporting…', 0);
		try {
			const result = await exportBoardPdf(
				{ app, pdfDocs: this.services.pdfDocs, parent: this.view },
				this.store.file,
				this.view.file?.path ?? '',
				{ quality: choices.quality, dpi: choices.dpi },
				(msg) => notice.setMessage(msg),
			);
			const out = await writeBinary(app, choices.path, result.bytes);
			notice.hide();
			const kb = Math.round(result.bytes.length / 1024);
			new Notice(`Exported ${result.pageCount} page(s) to ${out.path} (${kb} KB).`);
			if (result.problems.length) new Notice(`Export finished with problems:\n• ${result.problems.join('\n• ')}`, 0);
			if (choices.open) await app.workspace.getLeaf('tab').openFile(out);
		} catch (e) {
			notice.hide();
			new Notice(`Export failed: ${e instanceof Error ? e.message : String(e)}`, 0);
		}
	}

	// ---------- camera ----------

	private viewportSize() {
		return { w: this.root.clientWidth, h: this.root.clientHeight };
	}

	private setCamera(c: Camera) {
		this.camera = c;
		if (!this.frame) this.frame = this.root.win.requestAnimationFrame(() => this.applyCamera());
	}

	/**
	 * Only the layer's own transform changes per frame. Custom properties would be inherited by every
	 * rendered note below and restyle the whole board each frame (perf probe: 76 ms frames), so
	 * `--pw-zoom` (label and outline sizes) is only updated once zooming settles.
	 */
	private applyCamera() {
		this.frame = 0;
		const { tx, ty, zoom } = this.camera;
		this.layer.style.transform = `translate(${tx}px, ${ty}px) scale(${zoom})`;
		this.zoomLabel.setText(`${Math.round(zoom * 100)}%`);
		this.renderGrid();
		// Switch level of detail right away, so zooming out never mounts content it won't show.
		this.modules.setDetail(zoom >= DETAIL_ZOOM);
		this.updateVisibility();
		if (zoom !== this.settledZoom) {
			if (this.zoomTimer !== null) this.root.win.clearTimeout(this.zoomTimer);
			this.zoomTimer = this.root.win.setTimeout(() => this.zoomSettled(), ZOOM_SETTLE_MS);
		}
	}

	private zoomSettled() {
		this.zoomTimer = null;
		this.settledZoom = this.camera.zoom;
		this.layer.setCssProps({ '--pw-zoom': String(this.settledZoom) });
		this.modules.resolutionChanged(this.resolution());
	}

	/** Canvas pixels per mm needed at the current zoom (clamped; MAX_CANVAS_SIDE caps it too). */
	private resolution(): number {
		const dpr = this.root.win.devicePixelRatio || 1;
		return Math.min(PX_PER_MM * 8, Math.max(PX_PER_MM * 0.25, PX_PER_MM * this.camera.zoom * dpr));
	}

	zoomToFit() {
		const b = bounds(this.store.file.pages);
		const vp = this.viewportSize();
		if (!b || vp.w === 0) return;
		this.setCamera(fitCamera(b, vp));
	}

	private zoomBy(factor: number) {
		const vp = this.viewportSize();
		this.setCamera(zoomAt(this.camera, factor, { x: vp.w / 2, y: vp.h / 2 }));
	}

	private onResize() {
		if (!this.fitted && this.root.clientWidth > 0) {
			this.fitted = true;
			this.zoomToFit();
		}
		this.updateVisibility();
	}

	/** Grid drawn as a CSS background, so panning never touches page layout. */
	private renderGrid() {
		const grid = this.store.file.board.grid;
		this.root.toggleClass('has-grid', grid.visible);
		if (!grid.visible) return;
		let step = grid.size * PX_PER_MM * this.camera.zoom;
		// Coarsen the grid when zoomed out, so lines never get denser than every 8 px.
		while (step > 0 && step < 8) step *= 5;
		// Plain properties, not custom ones: those would be inherited by the whole board (see applyCamera).
		this.root.style.backgroundSize = `${step}px ${step}px`;
		this.root.style.backgroundPosition = `${this.camera.tx}px ${this.camera.ty}px`;
	}

	/** Virtualization (hard rule 9): only pages near the viewport get their modules mounted. */
	private updateVisibility() {
		const vp = this.viewportSize();
		if (vp.w === 0) return;
		const area = visibleRect(this.camera, vp);
		const zone = inset(area, Math.max(area.w, area.h) * CULL_MARGIN);
		// On-screen pages first, then the pre-mount margin: content renders in this order.
		const inZone = this.store.file.pages.filter((p) => intersects(p, zone));
		const ordered = [...inZone.filter((p) => intersects(p, area)), ...inZone.filter((p) => !intersects(p, area))].map((p) => p.id);
		const next = new Set(ordered);
		const changed = next.size !== this.visible.size || ordered.some((id) => !this.visible.has(id));
		this.visible = next;
		for (const [id, el] of this.pages) el.el.toggleClass('is-culled', !next.has(id));
		if (changed) this.modules.setVisible(ordered);
	}

	get visiblePages(): ReadonlySet<string> {
		return this.visible;
	}

	// ---------- input ----------

	private bindInput() {
		const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
			this.root.addEventListener(type, fn as EventListener, opts);
			this.cleanups.push(() => this.root.removeEventListener(type, fn as EventListener, opts));
		};
		on('wheel', (e) => this.onWheel(e), { passive: false });
		on('pointerdown', (e) => this.onPointerDown(e));
		on('pointermove', (e) => this.onPointerMove(e));
		on('pointerup', (e) => this.onPointerUp(e));
		on('pointercancel', (e) => this.onPointerUp(e));
		on('keydown', (e) => this.onKey(e, true));
		on('keyup', (e) => this.onKey(e, false));
		on('contextmenu', (e) => this.onContextMenu(e));
		on('dblclick', (e) => this.onDoubleClick(e));
		on('dragover', (e) => this.onDragOver(e));
		on('dragleave', () => this.root.removeClass('is-drop-target'));
		on('drop', (e) => this.onDrop(e));
	}

	private local(e: MouseEvent): Point {
		const r = this.root.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	private onWheel(e: WheelEvent) {
		e.preventDefault();
		const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.root.clientHeight : 1;
		// Trackpad pinch arrives as ctrl+wheel in Chromium.
		if (e.ctrlKey || e.metaKey) this.setCamera(zoomAt(this.camera, Math.exp(-e.deltaY * unit * 0.002), this.local(e)));
		else if (e.shiftKey && e.deltaX === 0) this.setCamera(panBy(this.camera, -e.deltaY * unit, 0));
		else this.setCamera(panBy(this.camera, -e.deltaX * unit, -e.deltaY * unit));
	}

	/** What's under the pointer: a module (with its page), a page, or empty board. */
	private hit(e: MouseEvent): Selection {
		const target = e.target as HTMLElement;
		const mod = target.closest<HTMLElement>('.pw-module');
		if (mod?.dataset.moduleId && mod.dataset.pageId) return { pageId: mod.dataset.pageId, moduleId: mod.dataset.moduleId };
		const page = target.closest<HTMLElement>('.pw-page');
		return page?.dataset.pageId ? { pageId: page.dataset.pageId } : null;
	}

	private onPointerDown(e: PointerEvent) {
		this.root.focus();
		const handle = (e.target as HTMLElement).closest<HTMLElement>('.pw-handle')?.dataset.handle as Handle | undefined;
		if (handle && e.button === 0 && this.selection) {
			const sel = this.selectedRect();
			const page = this.store.file.pages.find((p) => p.id === this.selection?.pageId);
			if (!sel || !page) return;
			// Modules resize in page coordinates, pages in board coordinates.
			const start = this.selection.moduleId ? { ...sel.rect, x: sel.rect.x - page.x, y: sel.rect.y - page.y } : sel.rect;
			this.drag = { kind: 'resize', target: this.selection, handle, startPointer: screenToBoard(this.camera, this.local(e)), start };
			this.root.setPointerCapture(e.pointerId);
			this.root.addClass('is-dragging');
			return;
		}
		const hit = this.hit(e);
		if (e.button === 1 || (e.button === 0 && (this.spaceHeld || !hit))) {
			if (!hit && e.button === 0) this.select(null);
			this.drag = { kind: 'pan', last: { x: e.clientX, y: e.clientY } };
		} else if (e.button === 0 && hit) {
			this.select(hit);
			this.drag = this.store.readOnly ? null : this.startDrag(hit, screenToBoard(this.camera, this.local(e)));
			if (!this.drag) return;
		} else return;
		this.root.setPointerCapture(e.pointerId);
		this.root.addClass('is-dragging');
	}

	private startDrag(hit: NonNullable<Selection>, startPointer: Point): Drag | null {
		const page = this.store.file.pages.find((p) => p.id === hit.pageId);
		if (!page) return null;
		if (!hit.moduleId) return { kind: 'page', id: page.id, startPointer, startPos: { x: page.x, y: page.y } };
		const m = page.modules.find((x) => x.id === hit.moduleId);
		if (!m || m.locked) return null;
		return { kind: 'module', pageId: page.id, id: m.id, startPointer, startPos: { x: m.x, y: m.y } };
	}

	private onPointerMove(e: PointerEvent) {
		const d = this.drag;
		if (!d) return;
		if (d.kind === 'pan') {
			this.setCamera(panBy(this.camera, e.clientX - d.last.x, e.clientY - d.last.y));
			d.last = { x: e.clientX, y: e.clientY };
			return;
		}
		const p = screenToBoard(this.camera, this.local(e));
		const grid = this.store.file.board.grid;
		if (d.kind === 'resize') return this.resizeTo(d, p, grid.snap && !e.altKey ? grid.size : 0, e.shiftKey);
		const raw = { x: d.startPos.x + p.x - d.startPointer.x, y: d.startPos.y + p.y - d.startPointer.y };
		// Alt bypasses snapping (SPEC 5.1).
		const pos = grid.snap && !e.altKey ? snapPoint(raw, grid.size) : raw;
		if (d.kind === 'page') this.store.update((f) => movePage(f, d.id, pos.x, pos.y), { coalesce: `move-page:${d.id}` });
		else {
			this.store.update((f) => moveModule(f, d.pageId, d.id, pos.x, pos.y), { coalesce: `move-module:${d.id}` });
			this.highlightDropPage(this.reparentTarget(d));
		}
	}

	/** The other page a dragged module's centre is over, if any (SPEC 5.2: re-parent on drop). */
	private reparentTarget(d: Extract<Drag, { kind: 'module' }>): Page | null {
		const from = this.store.file.pages.find((p) => p.id === d.pageId);
		const m = from?.modules.find((x) => x.id === d.id);
		if (!from || !m) return null;
		const c = { x: from.x + m.x + m.w / 2, y: from.y + m.y + m.h / 2 };
		if (containsPoint(from, c)) return null;
		return this.store.file.pages.find((p) => p.id !== from.id && containsPoint(p, c)) ?? null;
	}

	private highlightDropPage(page: Page | null) {
		for (const [id, el] of this.pages) el.el.toggleClass('is-drop-page', id === page?.id);
	}

	/** Finish a module drag: move it to the page under its centre, in the same undo step as the drag. */
	private reparent(d: Extract<Drag, { kind: 'module' }>) {
		this.highlightDropPage(null);
		const to = this.reparentTarget(d);
		const from = this.store.file.pages.find((p) => p.id === d.pageId);
		const m = from?.modules.find((x) => x.id === d.id);
		if (!to || !from || !m) return;
		const grid = this.store.file.board.grid;
		const rel = snapPoint({ x: from.x + m.x - to.x, y: from.y + m.y - to.y }, grid.snap ? grid.size : 0);
		this.store.update((f) => moveModuleToPage(f, from.id, m.id, to.id, rel.x, rel.y), { coalesce: `move-module:${d.id}` });
		this.select({ pageId: to.id, moduleId: m.id });
	}

	private resizeTo(d: Extract<Drag, { kind: 'resize' }>, p: Point, grid: number, keepAspect: boolean) {
		const r = resizeRect(d.start, d.handle, p.x - d.startPointer.x, p.y - d.startPointer.y, {
			min: MIN_SIZE_MM,
			keepAspect,
			snap: (v) => snapValue(v, grid),
		});
		const { pageId, moduleId } = d.target;
		const apply = <T extends Rect>(o: T): T => (o.x === r.x && o.y === r.y && o.w === r.w && o.h === r.h ? o : { ...o, ...r });
		this.store.update(
			(f) => (moduleId ? mapModule(f, pageId, moduleId, apply) : mapPage(f, pageId, apply)),
			{ coalesce: `resize:${moduleId ?? pageId}` },
		);
	}

	private onPointerUp(e: PointerEvent) {
		if (!this.drag) return;
		if (this.drag.kind === 'module') this.reparent(this.drag);
		this.drag = null;
		this.store.endCoalesce();
		this.root.removeClass('is-dragging');
		if (this.root.hasPointerCapture(e.pointerId)) this.root.releasePointerCapture(e.pointerId);
	}

	private onKey(e: KeyboardEvent, down: boolean) {
		if (e.code === 'Space') {
			this.spaceHeld = down;
			this.root.toggleClass('is-panning', down);
			e.preventDefault();
			return;
		}
		if (!down) return;
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.key.toLowerCase() === 'z') {
			if (e.shiftKey) this.store.redo();
			else this.store.undo();
		} else if (mod && e.key.toLowerCase() === 'y') this.store.redo();
		else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection) this.deleteSelection();
		else if (e.key.startsWith('Arrow') && this.selection) this.nudge(e.key, e.shiftKey ? 10 : 1);
		else return;
		e.preventDefault();
	}

	private duplicateSelection() {
		const sel = this.selection;
		if (!sel || this.store.readOnly) return;
		const taken = allIds(this.store.file);
		const ids = () => {
			const id = newId(taken);
			taken.add(id);
			return id;
		};
		if (sel.moduleId) {
			const id = ids();
			this.store.update((f) => duplicateModule(f, sel.pageId, sel.moduleId!, id));
			this.select({ pageId: sel.pageId, moduleId: id });
		} else {
			this.store.update((f) => duplicatePage(f, sel.pageId, ids));
			const added = this.store.file.pages[this.store.file.pages.length - 1];
			if (added) this.select({ pageId: added.id });
		}
	}

	/** Arrow keys move the selection by 1 mm (Shift: 10 mm). Consecutive presses undo as one step. */
	private nudge(key: string, step: number) {
		const sel = this.selection;
		if (!sel || this.store.readOnly) return;
		const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
		const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
		const shift = <T extends Point>(o: T): T => ({ ...o, x: o.x + dx, y: o.y + dy });
		this.store.update(
			(f) => (sel.moduleId ? mapModule(f, sel.pageId, sel.moduleId, (m) => (m.locked ? m : shift(m))) : mapPage(f, sel.pageId, shift)),
			{ coalesce: `nudge:${sel.moduleId ?? sel.pageId}` },
		);
	}

	private deleteSelection() {
		const sel = this.selection;
		if (!sel) return;
		const { pageId, moduleId } = sel;
		if (moduleId) this.store.update((f) => removeModule(f, pageId, moduleId));
		else this.store.update((f) => removePage(f, pageId));
		this.select(null);
	}

	private onDragOver(e: DragEvent) {
		if (this.store.readOnly || !e.dataTransfer?.types.some((t) => t === 'text/uri-list' || t === 'text/plain')) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
		this.root.addClass('is-drop-target');
	}

	/**
	 * Drop files from the file explorer onto a page (SPEC 5.6): notes become note modules, PDFs open
	 * the crop editor, images become image modules. Placed at the drop point, cascading.
	 */
	private onDrop(e: DragEvent) {
		this.root.removeClass('is-drop-target');
		const dt = e.dataTransfer;
		if (!dt || this.store.readOnly) return;
		const app = this.view.app;
		const files = linkpathsFromDrop(dt.getData('text/uri-list'), dt.getData('text/plain'))
			.map((l) => app.metadataCache.getFirstLinkpathDest(l, this.view.file?.path ?? ''))
			.filter((f): f is TFile => !!f);
		if (files.length === 0) return;
		e.preventDefault();
		const hit = this.hit(e);
		const page = this.store.file.pages.find((p) => p.id === hit?.pageId);
		if (!page) return void new Notice('Drop files onto a page.');
		const at = screenToBoard(this.camera, this.local(e));
		files.forEach((file, i) => this.dropFile(file, page, { x: at.x - page.x + i * 10, y: at.y - page.y + i * 10 }));
	}

	private dropFile(file: TFile, page: Page, at: Point) {
		const ext = file.extension.toLowerCase();
		const place = (w: number, h: number) => ({ x: Math.max(0, Math.min(at.x, page.w - w)), y: Math.max(0, Math.min(at.y, page.h - h)), w, h });
		const add = (build: (id: string) => AnyModule) => {
			const id = newId(allIds(this.store.file));
			this.store.update((f) => addModule(f, page.id, build(id)));
			this.select({ pageId: page.id, moduleId: id });
		};
		if (ext === 'md') return add((id): NoteModule => ({ id, type: 'note', ...place(90, 80), file: file.path }));
		if (/^(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(ext)) {
			const img = new Image();
			img.onload = () => add((id): ImageModule => ({ id, type: 'image', ...place(60, Math.max(5, (60 * img.naturalHeight) / img.naturalWidth)), file: file.path }));
			img.onerror = () => add((id): ImageModule => ({ id, type: 'image', ...place(60, 45), file: file.path }));
			img.src = this.view.app.vault.getResourcePath(file);
			return;
		}
		if (ext === 'pdf') {
			return new CropModal(this.view.app, this.services.pdfDocs, file.path, { page: 1 }, (r) =>
				add((id): PdfModule => {
					const w = 90;
					const h = r.resizeModule ? fitHeight({ w }, r.aspect, page.h).h : 120;
					return { id, type: 'pdf', ...place(w, h), file: file.path, page: r.page, ...(r.crop ? { crop: r.crop } : {}) };
				}),
			).open();
		}
		new Notice(`Patchwork can't place .${ext} files yet.`);
	}

	/** Double-click: a note module opens its source at that section; a PDF module opens the crop editor (SPEC 5.6). */
	private onDoubleClick(e: MouseEvent) {
		const hit = this.hit(e);
		const m = hit?.moduleId ? this.store.file.pages.find((p) => p.id === hit.pageId)?.modules.find((x) => x.id === hit.moduleId) : undefined;
		if (hit?.moduleId && m?.type === 'pdf') return this.editCrop(hit.pageId, hit.moduleId);
		if (m?.type !== 'note') return;
		const note = m as NoteModule;
		void this.view.app.workspace.openLinkText(`${note.file}${note.subpath ?? ''}`, this.view.file?.path ?? '', 'split');
	}

	private onContextMenu(e: MouseEvent) {
		const hit = this.hit(e);
		if (!hit || this.store.readOnly) return;
		e.preventDefault();
		this.select(hit);
		const menu = new Menu();
		const { pageId, moduleId } = hit;
		if (moduleId) {
			const m = this.store.file.pages.find((p) => p.id === pageId)?.modules.find((x) => x.id === moduleId);
			if (m?.type === 'pdf') menu.addItem((i) => i.setTitle('Edit crop…').setIcon('crop').onClick(() => this.editCrop(pageId, moduleId)));
			if (m?.type === 'note') {
				const current = (m as NoteModule).overflow ?? 'clip';
				const policies = [['clip', 'Overflow: clip'], ['fit', 'Overflow: shrink to fit'], ['grow', 'Overflow: grow']] as const;
				for (const [policy, title] of policies) {
					menu.addItem((i) =>
						i
							.setTitle(title)
							.setChecked(current === policy)
							.onClick(() =>
								this.store.update((f) =>
									mapModule(f, pageId, moduleId, (x) => {
										const next = { ...x } as NoteModule;
										if (policy === 'clip') delete next.overflow;
										else next.overflow = policy;
										return next;
									}),
								),
							),
					);
				}
				menu.addSeparator();
			}
			menu.addItem((i) => i.setTitle('Duplicate').setIcon('copy').onClick(() => this.duplicateSelection()));
			menu.addItem((i) =>
				i
					.setTitle(m?.locked ? 'Unlock' : 'Lock')
					.setIcon(m?.locked ? 'unlock' : 'lock')
					.onClick(() => this.store.update((f) => mapModule(f, pageId, moduleId, (x) => ({ ...x, locked: x.locked ? undefined : true })))),
			);
			menu.addItem((i) => i.setTitle('Bring to front').setIcon('bring-to-front').onClick(() => this.store.update((f) => restack(f, pageId, moduleId, 'front'))));
			menu.addItem((i) => i.setTitle('Send to back').setIcon('send-to-back').onClick(() => this.store.update((f) => restack(f, pageId, moduleId, 'back'))));
			menu.addItem((i) => i.setTitle('Delete module').setIcon('trash-2').setWarning(true).onClick(() => this.deleteSelection()));
		} else {
			menu.addItem((i) => i.setTitle('Duplicate page').setIcon('copy').onClick(() => this.duplicateSelection()));
			menu.addItem((i) => i.setTitle('Swap orientation').setIcon('rotate-cw').onClick(() => this.store.update((f) => mapPage(f, pageId, (p) => swapOrientation(p)))));
			menu.addItem((i) => i.setTitle('Delete page').setIcon('trash-2').setWarning(true).onClick(() => this.deleteSelection()));
		}
		menu.showAtMouseEvent(e);
	}

	// ---------- toolbar ----------

	private buildToolbar(container: HTMLElement) {
		const bar = container.createDiv({ cls: 'pw-toolbar' });
		const button = (icon: string, label: string, onClick: (e: MouseEvent) => void) => {
			const b = bar.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } });
			setIcon(b, icon);
			b.addEventListener('click', onClick);
		};
		const sep = () => bar.createDiv({ cls: 'pw-toolbar-sep' });
		if (!this.store.readOnly) {
			button('file-plus', 'Add page', (e) => this.showAddPageMenu(e));
			button('file-text', 'Add note', () => this.pickNote());
			button('book-open', 'Add PDF', () => this.pickPdf());
			sep();
		}
		button('file-output', 'Export to PDF', () => this.showExport());
		sep();
		button('zoom-out', 'Zoom out', () => this.zoomBy(1 / 1.25));
		this.zoomLabel = bar.createDiv({ cls: 'pw-zoom-label', text: '100%' });
		button('zoom-in', 'Zoom in', () => this.zoomBy(1.25));
		button('maximize', 'Zoom to fit', () => this.zoomToFit());
		if (!this.store.readOnly) {
			sep();
			button('undo-2', 'Undo', () => this.store.undo());
			button('redo-2', 'Redo', () => this.store.redo());
		}
		this.cleanups.push(() => bar.remove());
	}

	showAddPageMenu(e?: MouseEvent) {
		const menu = new Menu();
		for (const preset of PAGE_PRESETS) {
			menu.addItem((i) => i.setTitle(preset.name).onClick(() => this.addPage(preset)));
			if (preset.w !== preset.h) menu.addItem((i) => i.setTitle(`${preset.name} landscape`).onClick(() => this.addPage(swapOrientation(preset))));
		}
		if (e) menu.showAtMouseEvent(e);
		else {
			const r = this.root.getBoundingClientRect();
			menu.showAtPosition({ x: r.left + 40, y: r.top + 40 });
		}
	}
}

/** Height that gives `rect` the content's aspect ratio at its current width, kept within `maxH`. */
function fitHeight(rect: { w: number }, aspect: number, maxH: number): { h: number } {
	return { h: Math.max(5, Math.min(maxH, Number((rect.w / aspect).toFixed(3)))) };
}

import { Menu, Notice, setIcon, TFile } from 'obsidian';
import { allIds } from '../model/defaults';
import { bounds, inset, intersects, type Point } from '../model/geometry';
import { newId } from '../model/ids';
import { orderedPages } from '../model/ordering';
import { PAGE_PRESETS, swapOrientation } from '../model/presets';
import type { AnyModule, NoteModule, Page, PdfModule } from '../model/schema';
import { snapPoint } from '../model/snapping';
import { PX_PER_MM } from '../model/units';
import { ModuleHost } from '../modules/ModuleHost';
import type { PdfDocCache } from '../sources/pdfSource';
import type { BoardStore } from '../store/BoardStore';
import { addModule, addPage, defaultModuleRect, mapPage, moveModule, movePage, removeModule, removePage, restack } from '../store/pageOps';
import { FilePickerModal, PdfPageModal, SectionPickerModal, sectionsOf } from '../ui/pickers';
import { type Camera, fitCamera, panBy, screenToBoard, visibleRect, zoomAt } from './camera';
import { PageElement } from './pageElement';
import type { BoardSurface, PatchworkView } from './PatchworkView';

export interface BoardServices {
	pdfDocs: PdfDocCache;
}

type Selection = { pageId: string; moduleId?: string } | null;

type Drag =
	| { kind: 'pan'; last: Point }
	| { kind: 'page'; id: string; startPointer: Point; startPos: Point }
	| { kind: 'module'; pageId: string; id: string; startPointer: Point; startPos: Point };

/** Pages within this fraction of a viewport outside the visible area count as visible (pre-mount). */
const CULL_MARGIN = 0.5;

export class BoardViewport implements BoardSurface {
	private root: HTMLElement;
	private layer: HTMLElement;
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
	private cleanups: (() => void)[] = [];

	constructor(container: HTMLElement, private store: BoardStore, private view: PatchworkView, private services: BoardServices) {
		this.root = container.createDiv({ cls: 'pw-board', attr: { tabindex: '0' } });
		this.layer = this.root.createDiv({ cls: 'pw-board-layer' });
		this.modules = new ModuleHost({
			ctx: { app: view.app, pdfDocs: services.pdfDocs },
			store,
			paperOf: (id) => this.pages.get(id)?.paper,
			boardPath: () => view.file?.path ?? '',
			parent: view,
		});
		this.cleanups.push(() => this.modules.destroy());
		this.buildToolbar(container);
		this.cleanups.push(store.subscribe(() => this.render()));
		this.bindInput();
		const ro = new ResizeObserver(() => this.onResize());
		ro.observe(this.root);
		this.cleanups.push(() => ro.disconnect());
		this.render();
	}

	destroy() {
		this.root.win.cancelAnimationFrame(this.frame);
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
		this.renderGrid();
		this.updateVisibility();
		this.modules.sync();
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
		new FilePickerModal(app, pdfs, 'PDF to add', (file: TFile) => {
			pdfDocs
				.acquire(file.path)
				.then((doc: { numPages: number }) => {
					pdfDocs.release(file.path);
					new PdfPageModal(app, file.basename, doc.numPages, (pageNo) =>
						this.placeModule((page, id): PdfModule => ({ id, type: 'pdf', ...defaultModuleRect(page), file: file.path, page: pageNo })),
					).open();
				})
				.catch((e: Error) => new Notice(`Could not open ${file.path}: ${e.message}`));
		}).open();
	}

	// ---------- camera ----------

	private viewportSize() {
		return { w: this.root.clientWidth, h: this.root.clientHeight };
	}

	private setCamera(c: Camera) {
		this.camera = c;
		if (!this.frame) this.frame = this.root.win.requestAnimationFrame(() => this.applyCamera());
	}

	private applyCamera() {
		this.frame = 0;
		const { tx, ty, zoom } = this.camera;
		this.layer.setCssProps({ '--pw-tx': `${tx}px`, '--pw-ty': `${ty}px`, '--pw-zoom': String(zoom) });
		this.zoomLabel.setText(`${Math.round(zoom * 100)}%`);
		this.renderGrid();
		this.updateVisibility();
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
		this.root.setCssProps({ '--pw-grid-step': `${step}px`, '--pw-grid-x': `${this.camera.tx}px`, '--pw-grid-y': `${this.camera.ty}px` });
	}

	/** Virtualization (hard rule 9): only pages near the viewport get their modules mounted. */
	private updateVisibility() {
		const vp = this.viewportSize();
		if (vp.w === 0) return;
		const area = visibleRect(this.camera, vp);
		const zone = inset(area, Math.max(area.w, area.h) * CULL_MARGIN);
		const next = new Set(this.store.file.pages.filter((p) => intersects(p, zone)).map((p) => p.id));
		const changed = next.size !== this.visible.size || [...next].some((id) => !this.visible.has(id));
		this.visible = next;
		for (const [id, el] of this.pages) el.el.toggleClass('is-culled', !next.has(id));
		if (changed) this.modules.setVisible(next);
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
		const raw = { x: d.startPos.x + p.x - d.startPointer.x, y: d.startPos.y + p.y - d.startPointer.y };
		const grid = this.store.file.board.grid;
		// Alt bypasses snapping (SPEC 5.1).
		const pos = grid.snap && !e.altKey ? snapPoint(raw, grid.size) : raw;
		if (d.kind === 'page') this.store.update((f) => movePage(f, d.id, pos.x, pos.y), { coalesce: `move-page:${d.id}` });
		else this.store.update((f) => moveModule(f, d.pageId, d.id, pos.x, pos.y), { coalesce: `move-module:${d.id}` });
	}

	private onPointerUp(e: PointerEvent) {
		if (!this.drag) return;
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
		else return;
		e.preventDefault();
	}

	private deleteSelection() {
		const sel = this.selection;
		if (!sel) return;
		const { pageId, moduleId } = sel;
		if (moduleId) this.store.update((f) => removeModule(f, pageId, moduleId));
		else this.store.update((f) => removePage(f, pageId));
		this.select(null);
	}

	private onContextMenu(e: MouseEvent) {
		const hit = this.hit(e);
		if (!hit || this.store.readOnly) return;
		e.preventDefault();
		this.select(hit);
		const menu = new Menu();
		const { pageId, moduleId } = hit;
		if (moduleId) {
			menu.addItem((i) => i.setTitle('Bring to front').setIcon('bring-to-front').onClick(() => this.store.update((f) => restack(f, pageId, moduleId, 'front'))));
			menu.addItem((i) => i.setTitle('Send to back').setIcon('send-to-back').onClick(() => this.store.update((f) => restack(f, pageId, moduleId, 'back'))));
			menu.addItem((i) => i.setTitle('Delete module').setIcon('trash-2').setWarning(true).onClick(() => this.deleteSelection()));
		} else {
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

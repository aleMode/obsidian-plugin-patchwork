import { type App, Menu, Notice, setIcon, TFile } from 'obsidian';
import { exportBoardPdf } from '../export/exportPdf';
import { pdfToPngs } from '../export/exportPng';
import { parseRange } from '../model/sheetPlan';
import { arrangePages } from '../model/arrange';
import { toJsonCanvas } from '../model/canvasExport';
import { allIds } from '../model/defaults';
import { bounds, containsPoint, type Handle, inset, intersects, keepGrabbable, type Point, type Rect, resizeRect, revealShift } from '../model/geometry';
import { newId } from '../model/ids';
import { orderedPages } from '../model/ordering';
import { PAGE_PRESETS, swapOrientation } from '../model/presets';
import type { AnyModule, FrameModule, ImageModule, NoteModule, Page, PdfModule, TrackerModule } from '../model/schema';
import { flowChains } from '../model/flow';
import { type AlignMode, alignRects, distributeRects } from '../model/align';
import { snapToGuides } from '../model/guides';
import { masterPreview, pageFurniture } from '../model/numbering';
import { outputPages, resolvePage } from '../model/masters';
import { rulerTicks } from '../model/rulers';
import { gridDrawStep, snapPoint, snapValue } from '../model/snapping';
import { stepByKey } from '../model/tracker';
import { PX_PER_MM } from '../model/units';
import { ModuleHost } from '../modules/ModuleHost';
import { ContextBar } from './ContextBar';
import { canEditInline, editInline as startInlineEdit } from './InlineEdit';
import { OutlinePanel } from './OutlinePanel';
import { PropertiesPopover } from './PropertiesPopover';
import type { PropertiesSection } from './PropertiesForm';
import type { BitmapCache } from '../render/bitmapCache';
import type { ThumbnailCache } from '../render/thumbnails';
import { linkpathsFromDrop } from '../sources/dropLinks';
import { type PdfDocCache, pdfSourceId } from '../sources/pdfSource';
import { loadNoteContent } from '../sources/markdownSource';
import type { BoardStore } from '../store/BoardStore';
import { addModule, addPage, defaultModuleRect, duplicateModule, duplicatePage, mapModule, mapPage, moveModule, moveModuleToPage, movePage, removeModule, removePage, restack } from '../store/pageOps';
import { withField } from '../ui/formHelpers';
import { PatchworkSettingsModal, type SettingsDraft } from '../ui/PatchworkSettingsModal';
import { NamedPickerModal, TextPromptModal } from '../ui/prompts';
import { CropModal, type CropResult } from '../ui/CropModal';
import { type ExportChoices, ExportModal, writeBinary } from '../ui/ExportModal';
import { FilePickerModal, SectionPickerModal, sectionsOf } from '../ui/pickers';
import { boardToScreen, type Camera, cameraCentre, cameraCentredOn, fitCamera, panBy, screenToBoard, visibleRect, zoomAt } from './camera';
import { PageElement } from './pageElement';
import type { BoardSurface, PatchworkView } from './PatchworkView';

export interface BoardServices {
	pdfDocs: PdfDocCache;
	bitmaps: BitmapCache;
	thumbs?: ThumbnailCache;
	/** Called when this board goes away, so side panels stop following it. */
	closed?: (board: BoardViewport) => void;
	openPanels?: () => void;
	/** The device-wide preference for the red "text does not fit" line. */
	overflowMarker?: { shown: () => boolean; set: (show: boolean) => void };
	/** Interface choices that should survive a restart, kept in the plugin's own saved settings. */
	ui?: BoardUi;
}

export interface BoardUi {
	outlineOpen(): boolean;
	setOutlineOpen(open: boolean): void;
	/** Where the floating outline was dragged to, in pixels relative to the board; null: the default spot. */
	outlinePos(): { x: number; y: number } | null;
	setOutlinePos(pos: { x: number; y: number } | null): void;
	minimap(): boolean;
	setMinimap(show: boolean): void;
}

export type Selection = { pageId: string; moduleId?: string } | null;
export type Item = NonNullable<Selection>;

/** Other selected items moving along with the dragged one. */
type Group = { pageId: string; id: string; startPos: Point }[];

type Drag =
	| { kind: 'pan'; last: Point }
	| { kind: 'page'; id: string; startPointer: Point; startPos: Point; group: Group }
	| { kind: 'module'; pageId: string; id: string; startPointer: Point; startPos: Point; group: Group }
	| { kind: 'resize'; target: Item; handle: Handle; startPointer: Point; start: Rect }
	| { kind: 'marquee'; start: Point; onPage: Item | null };

const sameItem = (a: Item, b: Item) => a.pageId === b.pageId && a.moduleId === b.moduleId;

export const ALIGN_ACTIONS: [AlignMode, string, string][] = [
	['left', 'Align left edges', 'align-start-vertical'],
	['hcenter', 'Align horizontal centres', 'align-center-vertical'],
	['right', 'Align right edges', 'align-end-vertical'],
	['top', 'Align top edges', 'align-start-horizontal'],
	['vcenter', 'Align vertical centres', 'align-center-horizontal'],
	['bottom', 'Align bottom edges', 'align-end-horizontal'],
];

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
/** How close (screen px) an edge must come to another to snap to it. */
const GUIDE_SNAP_PX = 6;
/** Smallest page or module a resize can produce, in mm. */
const MIN_SIZE_MM = 5;
// How much of a dropped module must stay on its page so it can still be seen and grabbed.
const MIN_VISIBLE_MM = 10;
/** Image files Patchwork can place (what Chromium decodes). */
const IMAGE_EXT = /^(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

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
	private guideLayer: HTMLElement;
	private rulers: { top: HTMLCanvasElement; left: HTMLCanvasElement };
	private zoomLabel!: HTMLElement;
	private toolbar!: HTMLElement;
	private pages = new Map<string, PageElement>();
	private modules: ModuleHost;
	private camera: Camera = { tx: 0, ty: 0, zoom: 1 };
	/** Selected items; the last one is the primary (inspector, resize handles, ruler origin). */
	private items: Item[] = [];
	private marqueeEl: HTMLElement;
	/**
	 * Page labels live in screen space, above the zoomed layer: inside it they needed a huge font
	 * (to look constant-size when scaled down) that Chromium re-rasterized on every pan frame,
	 * halving the frame rate on a 100-page board.
	 */
	private labelLayer: HTMLElement;
	private labels = new Map<string, HTMLElement>();
	private minimap: HTMLCanvasElement;
	/** Board area the minimap shows, and its scale, from the last draw (for click-to-pan). */
	private minimapFrame: { x: number; y: number; k: number } | null = null;
	/** Panels (inspector, outline) listen here; the store has its own subscription for content. */
	private selectionListeners = new Set<(sel: Selection) => void>();
	private drag: Drag | null = null;
	private spaceHeld = false;
	private frame = 0;
	private fitted = false;
	private visible = new Set<string>();
	private settledZoom = 0;
	private zoomTimer: number | null = null;
	private cleanups: (() => void)[] = [];
	private contextBar!: ContextBar;
	private popover!: PropertiesPopover;
	private outlinePanel!: OutlinePanel;
	private host: HTMLElement;

	constructor(container: HTMLElement, private store: BoardStore, private view: PatchworkView, private services: BoardServices) {
		this.host = container;
		this.root = container.createDiv({ cls: 'pw-board', attr: { tabindex: '0' } });
		this.layer = this.root.createDiv({ cls: 'pw-board-layer' });
		this.labelLayer = this.root.createDiv({ cls: 'pw-page-labels' });
		// Above the pages so handles are never clipped by a page edge.
		this.selectionBox = this.layer.createDiv({ cls: 'pw-selection' });
		this.guideLayer = this.layer.createDiv({ cls: 'pw-guides' });
		this.marqueeEl = this.layer.createDiv({ cls: 'pw-marquee is-hidden' });
		for (const h of HANDLES) this.selectionBox.createDiv({ cls: `pw-handle pw-handle-${h}`, attr: { 'data-handle': h } });
		this.modules = new ModuleHost({
			ctx: { app: view.app, pdfDocs: services.pdfDocs, bitmaps: services.bitmaps, ...(services.thumbs ? { thumbs: services.thumbs } : {}), resolution: () => this.resolution() },
			store,
			paperOf: (id) => this.pages.get(id)?.paper,
			boardPath: () => view.file?.path ?? '',
			parent: view,
			replaceSource: (pageId, moduleId) => this.replaceSource(pageId, moduleId),
		});
		this.cleanups.push(() => this.modules.destroy());
		this.rulers = {
			top: container.createEl('canvas', { cls: 'pw-ruler pw-ruler-top' }),
			left: container.createEl('canvas', { cls: 'pw-ruler pw-ruler-left' }),
		};
		const corner = container.createDiv({ cls: 'pw-ruler-corner' });
		this.minimap = container.createEl('canvas', { cls: 'pw-minimap' });
		this.minimap.toggleClass('is-hidden', !(services.ui?.minimap() ?? true));
		this.bindMinimap();
		this.cleanups.push(() => {
			this.rulers.top.remove();
			this.rulers.left.remove();
			corner.remove();
			this.minimap.remove();
		});
		this.buildToolbar(container);
		this.contextBar = new ContextBar(this, container, ALIGN_ACTIONS);
		this.popover = new PropertiesPopover(this, container, view.app);
		this.outlinePanel = new OutlinePanel(this, container, view.app, {
			setOpen: (open) => services.ui?.setOutlineOpen(open),
			pos: () => services.ui?.outlinePos() ?? null,
			setPos: (pos) => services.ui?.setOutlinePos(pos),
		});
		if (services.ui?.outlineOpen()) this.outlinePanel.open();
		this.cleanups.push(() => this.contextBar.destroy(), () => this.popover.destroy(), () => this.outlinePanel.destroy());
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
		this.services.closed?.(this);
		this.selectionListeners.clear();
		this.root.win.cancelAnimationFrame(this.frame);
		if (this.zoomTimer !== null) this.root.win.clearTimeout(this.zoomTimer);
		this.cleanups.forEach((c) => c());
		this.root.remove();
	}

	// ---------- rendering ----------

	/** {title}: the board's title, else its file name. */
	boardTitle(): string {
		return this.store.file.meta?.title ?? this.view.file?.basename ?? '';
	}

	private get selection(): Selection {
		return this.items[this.items.length - 1] ?? null;
	}

	private render() {
		const file = this.store.file;
		// Items deleted meanwhile (e.g. by undo) drop out of the selection.
		const kept = this.items.filter((it) => this.exists(it));
		if (kept.length !== this.items.length) {
			this.items = kept;
			this.emitSelection();
		}
		const seen = new Set<string>();
		const furniture = pageFurniture(file, { title: this.boardTitle(), date: today() });
		for (const page of file.pages) {
			seen.add(page.id);
			let el = this.pages.get(page.id);
			if (!el) {
				el = new PageElement(this.layer);
				this.pages.set(page.id, el);
			}
			const selected = this.items.some((it) => it.pageId === page.id && !it.moduleId);
			const shown = resolvePage(file, page);
			const pageFurniture = page.isMaster ? masterPreview(file, page) : furniture.get(page.id);
			el.update(shown, { appTheme: file.board.useAppTheme, unit: file.board.displayUnit, selected, furniture: pageFurniture, position: file.board.numbering.position, safeArea: file.board.defaultSafeArea });
		}
		for (const [id, el] of this.pages) {
			if (!seen.has(id)) {
				el.remove();
				this.pages.delete(id);
			}
		}
		this.syncLabels();
		this.modules.selectedModules = new Set(this.items.flatMap((it) => (it.moduleId ? [it.moduleId] : [])));
		this.root.toggleClass('pw-pdf-dark', !!file.board.pdfDarkMode);
		this.root.toggleClass('has-board-font', !!file.board.fontFamily);
		this.root.setCssProps({ '--pw-font': file.board.fontFamily ?? '' });
		this.renderSelectionBox();
		this.renderGrid();
		this.renderRulers();
		this.renderMinimap();
		this.updateVisibility();
		this.modules.sync();
		this.contextBar.refresh();
		this.popover.refresh();
		this.outlinePanel.refresh();
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
		// Handles only for a single item; a multi-selection is moved, aligned or nudged as a group.
		const show = !!sel && !sel.locked && !this.store.readOnly && this.items.length === 1;
		this.selectionBox.toggleClass('is-hidden', !show);
		if (!show) return;
		const { x, y, w, h } = sel.rect;
		this.selectionBox.setCssProps({ '--pw-x': `${x}mm`, '--pw-y': `${y}mm`, '--pw-w': `${w}mm`, '--pw-h': `${h}mm` });
	}

	private exists(it: Item): boolean {
		const page = this.store.file.pages.find((p) => p.id === it.pageId);
		return !!page && (!it.moduleId || page.modules.some((m) => m.id === it.moduleId));
	}

	/** Absolute board rect of an item (mm). */
	private itemRect(it: Item): Rect | null {
		const page = this.store.file.pages.find((p) => p.id === it.pageId);
		if (!page) return null;
		if (!it.moduleId) return page;
		const m = page.modules.find((x) => x.id === it.moduleId);
		return m ? { x: page.x + m.x, y: page.y + m.y, w: m.w, h: m.h } : null;
	}

	select(sel: Selection) {
		if (this.items.length === (sel ? 1 : 0) && (!sel || sameItem(sel, this.items[0]!))) return;
		this.setItems(sel ? [sel] : []);
	}

	/** Shift-click: add or remove an item. Pages and modules aren't mixed; a different kind starts over. */
	toggle(it: Item) {
		const kindMatches = this.items.every((x) => !!x.moduleId === !!it.moduleId);
		if (!kindMatches) return this.setItems([it]);
		const rest = this.items.filter((x) => !sameItem(x, it));
		this.setItems(rest.length === this.items.length ? [...rest, it] : rest);
	}

	setItems(items: Item[]) {
		this.items = items;
		this.render();
		this.emitSelection();
	}

	get selected(): Selection {
		return this.selection;
	}

	get app(): App {
		return this.view.app;
	}

	/** Lowest y (in the board's own pixels) that content may use: below the rulers and the floating toolbar. */
	get topInset(): number {
		return this.toolbarBottom();
	}

	focusBoard() {
		this.root.focus();
	}

	/** The selection's bounding box in pixels relative to the board host (what the bar and popover position against). */
	selectionScreenRect(): { x: number; y: number; w: number; h: number } | null {
		const rects = this.items.flatMap((it) => this.itemRect(it) ?? []);
		const b = rects.length ? bounds(rects) : null;
		if (!b) return null;
		const k = PX_PER_MM * this.camera.zoom;
		const host = this.host.getBoundingClientRect();
		const root = this.root.getBoundingClientRect();
		return { x: this.camera.tx + b.x * k + (root.left - host.left), y: this.camera.ty + b.y * k + (root.top - host.top), w: b.w * k, h: b.h * k };
	}

	contextBarRect(): { x: number; y: number; w: number; h: number } | null {
		return this.contextBar.rect;
	}

	/** True while an item, page or handle is being dragged. */
	get isDragging(): boolean {
		return this.drag !== null;
	}

	toggleOutline() {
		this.outlinePanel.toggle();
	}

	get outlineOpen(): boolean {
		return this.outlinePanel.isOpen;
	}

	get propertiesOpen(): boolean {
		return this.popover.isOpen;
	}

	/** The properties popover for the selection (a page or one module), on a tab. */
	showProperties(tab?: PropertiesSection) {
		this.popover.show(tab);
	}

	/** Open the source of a note module in a pane, at its section. */
	openNote(pageId: string, moduleId: string) {
		const m = this.store.file.pages.find((p) => p.id === pageId)?.modules.find((x) => x.id === moduleId);
		if (m?.type !== 'note') return;
		const note = m as NoteModule;
		void this.view.app.workspace.openLinkText(`${note.file}${note.subpath ?? ''}`, this.view.file?.path ?? '', 'split');
	}

	/** Number of pages of a PDF, or null when it cannot be read. */
	async pdfPageCount(path: string): Promise<number | null> {
		try {
			const doc = await this.services.pdfDocs.acquire(path);
			const n = doc.numPages;
			this.services.pdfDocs.release(path);
			return n;
		} catch {
			return null;
		}
	}

	get selectedItems(): readonly Item[] {
		return this.items;
	}

	/** Align the selection to its own bounds (SPEC 5.6). Modules align in board coordinates, even across pages. */
	align(mode: AlignMode) {
		this.arrange((rects) => alignRects(rects, mode), `align:${mode}`);
	}

	distribute(axis: 'h' | 'v') {
		this.arrange((rects) => distributeRects(rects, axis), `distribute:${axis}`);
	}

	private arrange(layout: (rects: Rect[]) => Point[], label: string) {
		if (this.items.length < 2 || this.store.readOnly) return;
		const rects = this.items.map((it) => this.itemRect(it));
		if (rects.some((r) => !r)) return;
		const next = layout(rects as Rect[]);
		this.store.update((f) =>
			this.items.reduce((acc, it, i) => {
				const p = next[i]!;
				if (!it.moduleId) return movePage(acc, it.pageId, p.x, p.y);
				const page = acc.pages.find((x) => x.id === it.pageId)!;
				return mapModule(acc, it.pageId, it.moduleId, (m) => (m.locked ? m : { ...m, x: Number((p.x - page.x).toFixed(4)), y: Number((p.y - page.y).toFixed(4)) }));
			}, f),
			{ coalesce: label },
		);
		this.store.endCoalesce();
	}

	get boardStore(): BoardStore {
		return this.store;
	}

	onSelectionChange(listener: (sel: Selection) => void): () => void {
		this.selectionListeners.add(listener);
		return () => this.selectionListeners.delete(listener);
	}

	private emitSelection() {
		for (const l of this.selectionListeners) l(this.selection);
	}

	/** Centre the camera on the selection, keeping the zoom unless it would not fit. */
	/** Fit the selection (a page, modules, several pages) in the view; with nothing selected, everything. */
	zoomToSelection() {
		const rects = this.items.flatMap((it) => this.itemRect(it) ?? []);
		this.zoomToFit(rects.length ? bounds(rects) ?? undefined : undefined);
	}

	/**
	 * Bring the selection into a comfortable central part of the view. Nothing moves when it is already
	 * there; otherwise the view pans just enough, and zooms out only if the item cannot fit at all. The
	 * region keeps clear of the floating toolbar and of the outline panel, so an item at an edge or
	 * under the panel is brought out, without re-centring every time.
	 */
	revealSelection() {
		const sel = this.selectedRect();
		const vp = this.viewportSize();
		if (!sel || vp.w === 0) return;
		const r = sel.rect;
		const region = this.comfortRegion(vp);
		const fit = fitCamera(r, vp, 60);
		if (fit.zoom < this.camera.zoom) {
			// Too big for the view at this zoom: fit it, centred in the comfortable region (not under the panel).
			const k = PX_PER_MM * fit.zoom;
			this.setCamera({ zoom: fit.zoom, tx: region.x + region.w / 2 - (r.x + r.w / 2) * k, ty: region.y + region.h / 2 - (r.y + r.h / 2) * k });
			return;
		}
		const k = PX_PER_MM * this.camera.zoom;
		const onScreen = { x: this.camera.tx + r.x * k, y: this.camera.ty + r.y * k, w: r.w * k, h: r.h * k };
		const shift = revealShift(onScreen, region);
		if (shift.x !== 0 || shift.y !== 0) this.setCamera(panBy(this.camera, shift.x, shift.y));
	}

	/** The middle part of the view, less the toolbar along the top and the outline panel if it is open. */
	private comfortRegion(vp: { w: number; h: number }): Rect {
		const gap = 16;
		let x0 = vp.w * 0.15;
		let x1 = vp.w * 0.85;
		const y0 = Math.max(vp.h * 0.15, this.toolbarBottom() + gap);
		const y1 = vp.h * 0.85;
		const panel = this.outlinePanel.rect();
		if (panel) {
			if (panel.x + panel.w / 2 < (x0 + x1) / 2) x0 = Math.max(x0, panel.x + panel.w + gap);
			else x1 = Math.min(x1, panel.x - gap);
		}
		// A panel that leaves no room must not make the region vanish.
		if (x1 - x0 < 120) {
			x0 = vp.w * 0.15;
			x1 = vp.w * 0.85;
		}
		return { x: x0, y: y0, w: x1 - x0, h: Math.max(60, y1 - y0) };
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

	/** Point a module at another file, e.g. after its note, PDF or image was deleted (SPEC 5.3). */
	replaceSource(pageId: string, moduleId: string) {
		const m = this.store.file.pages.find((p) => p.id === pageId)?.modules.find((x) => x.id === moduleId);
		if (!m || this.store.readOnly) return;
		const app = this.view.app;
		const set = (patch: (x: AnyModule) => AnyModule) => this.store.update((f) => mapModule(f, pageId, moduleId, patch));
		if (m.type === 'note') {
			new FilePickerModal(app, app.vault.getMarkdownFiles(), 'Note to show', (file) =>
				new SectionPickerModal(app, sectionsOf(app, file), (choice) =>
					set((x) => {
						const next = { ...x, file: file.path } as NoteModule;
						if (choice.subpath) next.subpath = choice.subpath;
						else delete next.subpath;
						delete next.lines;
						return next;
					}),
				).open(),
			).open();
		} else if (m.type === 'image') {
			const images = app.vault.getFiles().filter((f) => IMAGE_EXT.test(f.extension));
			new FilePickerModal(app, images, 'Image to show', (file) => set((x) => ({ ...x, file: file.path }))).open();
		} else if (m.type === 'pdf') {
			const pdfs = app.vault.getFiles().filter((f) => f.extension.toLowerCase() === 'pdf');
			// A different file: page and crop are kept, and the crop editor opens to check them.
			new FilePickerModal(app, pdfs, 'PDF to show', (file) => {
				set((x) => {
					const next = { ...x, file: file.path } as PdfModule;
					delete next.sourceId;
					return next;
				});
				this.editCrop(pageId, moduleId);
			}).open();
		}
	}

	/** A free markdown box (SPEC 5.3 text module), edited in the inspector. */
	addText() {
		this.placeModule((page, id) => ({ id, type: 'text', ...defaultModuleRect(page, { w: 80, h: 30 }), markdown: '**New text**\n\nChange this text with Edit above.' }));
		this.showProperties('content');
	}

	/** Interactive tracker (M5): a counter, a row of boxes or a checklist, edited in the properties popover. */
	addTracker(kind: TrackerModule['kind'] = 'counter') {
		const presets: Record<TrackerModule['kind'], Partial<TrackerModule> & { w: number; h: number }> = {
			counter: { label: 'Hit points', value: 10, min: 0, w: 50, h: 25 },
			boxes: { label: 'Spell slots', max: 4, value: 0, w: 60, h: 18 },
			checklist: { label: 'Quests', items: [{ text: 'Find the queen' }, { text: 'Return the crown' }], w: 70, h: 30 },
		};
		const { w, h, ...rest } = presets[kind];
		this.placeModule((page, id) => ({ id, type: 'tracker', kind, ...defaultModuleRect(page, { w, h }), ...rest }));
		this.showProperties('content');
	}

	showTrackerMenu(e?: MouseEvent) {
		const menu = new Menu();
		menu.addItem((i) => i.setTitle('Counter').setIcon('plus-minus').onClick(() => this.addTracker('counter')));
		menu.addItem((i) => i.setTitle('Boxes').setIcon('square').onClick(() => this.addTracker('boxes')));
		menu.addItem((i) => i.setTitle('Checklist').setIcon('list-checks').onClick(() => this.addTracker('checklist')));
		if (e) menu.showAtMouseEvent(e);
		else menu.showAtPosition({ x: this.root.getBoundingClientRect().left + 80, y: this.root.getBoundingClientRect().top + 80 });
	}

	/** Table of contents (M4): fills the page inside its margins; lists named pages live. */
	addToc() {
		this.placeModule((page, id) => ({ id, type: 'toc', ...defaultModuleRect(page, { w: page.w - 40, h: page.h - 40 }), x: 20, y: 20 }));
		this.showProperties('content');
	}

	pickImage() {
		const app = this.view.app;
		const images = app.vault.getFiles().filter((f) => IMAGE_EXT.test(f.extension));
		new FilePickerModal(app, images, 'Image to add', (file) => {
			const img = new Image();
			const place = (aspect: number) =>
				this.placeModule((page, id): ImageModule => {
					const r = defaultModuleRect(page, { w: 80, h: 60 });
					return { id, type: 'image', ...r, h: Math.max(5, Math.min(r.h * 2, r.w / aspect)), file: file.path };
				});
			img.onload = () => place(img.naturalWidth / Math.max(1, img.naturalHeight));
			img.onerror = () => place(4 / 3);
			img.src = app.vault.getResourcePath(file);
		}).open();
	}

	pickPdf() {
		const app = this.view.app;
		const { pdfDocs } = this.services;
		const pdfs = app.vault.getFiles().filter((f) => f.extension.toLowerCase() === 'pdf');
		new FilePickerModal(app, pdfs, 'PDF to add', (file: TFile) =>
			new CropModal(app, pdfDocs, file.path, { page: 1 }, (r) =>
				this.placeModule((page, id): PdfModule => {
					const rect = defaultModuleRect(page);
					return { id, type: 'pdf', ...rect, ...(r.resizeModule ? fitHeight(rect, r.aspect, page.h) : {}), file: file.path, page: r.page, ...(r.crop ? { crop: r.crop } : {}), ...(r.sourceId ? { sourceId: r.sourceId } : {}) };
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
					// Re-editing the crop counts as checking it against the current file.
					if (r.sourceId) next.sourceId = r.sourceId;
					return next;
				}),
			),
		).open();
	}

	/**
	 * Linked frames (M5): continue the chain this module is in with a new frame of the same size, at
	 * the same spot on the next page (a new page if this is the last one). One undo step.
	 */
	continueInFrame(pageId: string, moduleId: string) {
		if (this.store.readOnly) return;
		const file = this.store.file;
		const info = flowChains(file).get(moduleId);
		const start = file.pages.find((p) => p.id === pageId)?.modules.find((m) => m.id === moduleId);
		if (!start || !['note', 'text', 'frame'].includes(start.type)) return;
		if (info && !info.ok) return void new Notice(info.reason);
		const last = info?.ok ? info.chain[info.chain.length - 1]! : { pageId, module: start };
		const pages = outputPages(file);
		const at = pages.findIndex((p) => p.id === last.pageId);
		const id = newId(allIds(file));
		let target = pages[at + 1];
		this.store.update((f) => {
			let next = f;
			if (!target) {
				const lastPage = f.pages.find((p) => p.id === last.pageId)!;
				const r = addPage(f, { w: lastPage.w, h: lastPage.h }, `Page ${f.pages.length + 1}`);
				next = r.file;
				target = r.page;
			}
			const m = last.module;
			const w = Math.min(m.w, target.w);
			const h = Math.min(m.h, target.h);
			const frame: FrameModule = { id, type: 'frame', from: m.id, x: Math.min(m.x, target.w - w), y: Math.min(m.y, target.h - h), w, h, ...(m.style ? { style: m.style } : {}) };
			return addModule(next, target.id, frame);
		});
		if (target) this.select({ pageId: target.id, moduleId: id });
	}

	continueSelectionInFrame() {
		const sel = this.selection;
		if (sel?.moduleId) this.continueInFrame(sel.pageId, sel.moduleId);
		else new Notice('Select a note, text or frame module first.');
	}

	/** Freeze a note module (M4): store what it shows now, so later edits to the note don't change it. */
	async freezeNote(pageId: string, moduleId: string) {
		const m = this.store.file.pages.find((p) => p.id === pageId)?.modules.find((x) => x.id === moduleId);
		if (m?.type !== 'note' || this.store.readOnly) return;
		const content = await loadNoteContent(this.view.app, m as NoteModule);
		if (!content.ok) return void new Notice(`Can't freeze: ${content.reason}`);
		this.store.update((f) => mapModule(f, pageId, moduleId, (x) => ({ ...x, frozen: { at: today(), markdown: content.markdown } })));
	}

	unfreezeNote(pageId: string, moduleId: string) {
		this.store.update((f) =>
			mapModule(f, pageId, moduleId, (x) => {
				const next = { ...x };
				delete next.frozen;
				return next;
			}),
		);
	}

	/** Record the PDF's current version on a crop, clearing its "PDF changed" warning. */
	async markPdfChecked(pageId: string, moduleId: string) {
		const m = this.store.file.pages.find((p) => p.id === pageId)?.modules.find((x) => x.id === moduleId);
		if (m?.type !== 'pdf' || this.store.readOnly) return;
		const { pdfDocs } = this.services;
		const doc = await pdfDocs.acquire(m.file as string);
		try {
			const id = pdfSourceId(doc);
			if (id) this.store.update((f) => mapModule(f, pageId, moduleId, (x) => ({ ...x, sourceId: id })));
		} finally {
			pdfDocs.release(m.file as string);
		}
	}

	showSettings() {
		if (this.store.readOnly) return;
		const f = this.store.file;
		new PatchworkSettingsModal(this.view.app, { board: f.board, title: f.meta?.title }, { apply: (d) => this.applySettings(d), arrange: (mode) => this.autoArrange(mode) }).open();
	}

	/** One undo step for everything the settings dialog changed. */
	private applySettings(d: SettingsDraft) {
		this.store.update((f) => ({ ...f, board: { ...f.board, ...d.board }, ...(d.title === f.meta?.title ? {} : { meta: withField(f.meta ?? {}, 'title', d.title) }) }));
	}

	// ---------- export ----------

	showExport() {
		const file = this.view.file;
		if (!file) return;
		const e = this.store.file.board.export;
		const initial: ExportChoices = {
			base: file.path.replace(/\.patchwork$/, ''),
			format: e.format,
			pages: 'all',
			range: '',
			sheet: typeof e.sheet === 'object' ? { w: e.sheet.w, h: e.sheet.h } : e.sheet,
			orientation: e.orientation,
			overlap: e.tileOverlap,
			fitSmallPages: !!e.fitSmallPages,
			tileLabels: !!e.tileLabels,
			inkSaver: !!e.inkSaver,
			layout: e.layout ?? 'single',
			bleed: e.bleed ?? 0,
			cropMarks: e.cropMarks,
			quality: e.quality,
			dpi: e.dpi,
			open: true,
		};
		const ctx = { pageCount: outputPages(this.store.file).length, selectedCount: this.selectedPageIndices().length, unit: this.store.file.board.displayUnit };
		new ExportModal(this.view.app, initial, ctx, (choices) => void this.runExport(choices)).open();
	}

	/** Auto-arrange pages in output order (SPEC 5.4), as one undo step. */
	autoArrange(layout: 'row' | 'grid') {
		if (this.store.readOnly) return;
		const pos = arrangePages(this.store.file, layout);
		this.store.update((f) => [...pos].reduce((acc, [id, p]) => movePage(acc, id, p.x, p.y), f));
		this.zoomToFit();
	}

	/** One-way, lossy export to a .canvas next to the board (SPEC 9.3). */
	addViewMenuItems(menu: Menu) {
		menu.addItem((i) => i.setTitle('Export as PDF or PNG…').setIcon('file-output').onClick(() => this.showExport()));
		menu.addItem((i) => i.setTitle('Export to canvas').setIcon('layout-dashboard').onClick(() => void this.exportCanvas()));
	}

	async exportCanvas() {
		const file = this.view.file;
		if (!file) return;
		const app = this.view.app;
		const { canvas, dropped } = toJsonCanvas(this.store.file);
		const path = file.path.replace(/\.patchwork$/, '.canvas');
		const text = JSON.stringify(canvas, null, '\t');
		const existing = app.vault.getAbstractFileByPath(path);
		const out = existing instanceof TFile ? (await app.vault.modify(existing, text), existing) : await app.vault.create(path, text);
		new Notice(`Exported to ${out.path}.${dropped.length ? ` Not carried over: ${dropped.join(', ')}.` : ''}`, dropped.length ? 8000 : 4000);
		return out;
	}

	/** Pages of the current selection (pages, or the pages of selected modules), as output-order indices. */
	private selectedPageIndices(): number[] {
		const ids = new Set(this.items.map((it) => it.pageId));
		return outputPages(this.store.file).flatMap((p, i) => (ids.has(p.id) ? [i] : []));
	}

	async runExport(choices: ExportChoices) {
		const app = this.view.app;
		// Remember the choices in the board, like other export defaults (SPEC 6).
		this.store.update((f) => {
			const e = f.board.export;
			const next = { ...e, format: choices.format, sheet: choices.sheet, orientation: choices.orientation, tileOverlap: choices.overlap, quality: choices.quality, dpi: choices.dpi, fitSmallPages: choices.fitSmallPages || undefined, tileLabels: choices.tileLabels || undefined, inkSaver: choices.inkSaver || undefined, layout: choices.layout === 'booklet' ? choices.layout : undefined, bleed: choices.bleed || undefined, cropMarks: choices.cropMarks };
			return JSON.stringify(next) === JSON.stringify(e) ? f : { ...f, board: { ...f.board, export: next } };
		});
		const pageIndices =
			choices.pages === 'selected' ? this.selectedPageIndices() : choices.pages === 'range' ? parseRange(choices.range, outputPages(this.store.file).length) ?? undefined : undefined;
		const notice = new Notice('Exporting…', 0);
		try {
			const result = await exportBoardPdf(
				{ app, pdfDocs: this.services.pdfDocs, parent: this.view },
				this.store.file,
				this.view.file?.path ?? '',
				{ ...choices, date: today(), pageIndices },
				(msg) => notice.setMessage(msg),
			);
			const written: TFile[] = [];
			if (choices.format === 'pdf') written.push(await writeBinary(app, `${choices.base}.pdf`, result.bytes));
			else for (const png of await pdfToPngs(result.bytes, choices.dpi, (msg) => notice.setMessage(msg))) written.push(await writeBinary(app, `${choices.base}${png.suffix}.png`, png.bytes));
			notice.hide();
			const what = written.length === 1 ? written[0]!.path : `${written.length} files (${written[0]!.path}, …)`;
			new Notice(`Exported ${result.pageCount} page(s) to ${what}.`);
			if (result.problems.length) new Notice(`Export finished with problems:\n• ${result.problems.join('\n• ')}`, 0);
			if (choices.open && written[0]) await app.workspace.getLeaf('tab').openFile(written[0]);
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
		this.renderRulers();
		this.placeLabels();
		this.renderMinimap();
		this.contextBar.reposition();
		this.popover.reposition();
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

	zoomToFit(rect?: Rect) {
		const b = rect ?? bounds(this.store.file.pages);
		const vp = this.viewportSize();
		if (!b || vp.w === 0) return;
		// Keep content clear of the rulers and the floating toolbar along the top.
		const top = Math.min(vp.h / 3, this.toolbarBottom());
		const c = fitCamera(b, { w: vp.w, h: vp.h - top });
		this.setCamera({ ...c, ty: c.ty + top });
	}

	/** Bottom edge of the toolbar, relative to the board (px). */
	private toolbarBottom(): number {
		const bar = this.toolbar.getBoundingClientRect();
		const root = this.root.getBoundingClientRect();
		return bar.height ? bar.bottom - root.top : 0;
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
		this.fitToolbar();
		this.outlinePanel?.place();
		// The ruler canvases are sized in code, not CSS: without a redraw they are stretched (and blur) until the next pan.
		this.renderRulers();
		this.updateVisibility();
	}

	/** Labels on the toolbar buttons only while the toolbar fits; otherwise icons with tooltips. */
	private fitToolbar() {
		const bar = this.toolbar;
		if (!bar || this.root.clientWidth === 0) return;
		bar.removeClass('is-compact');
		if (bar.scrollWidth + 2 * 28 > this.root.clientWidth) bar.addClass('is-compact');
	}

	/** Grid drawn as a CSS background, so panning never touches page layout. */
	private renderGrid() {
		const grid = this.store.file.board.grid;
		this.root.toggleClass('has-grid', grid.visible);
		if (!grid.visible) return;
		// Coarsen the grid when zoomed out, so lines never get denser than every 8 px.
		const step = gridDrawStep(grid.size * PX_PER_MM * this.camera.zoom, 8);
		// Plain properties, not custom ones: those would be inherited by the whole board (see applyCamera).
		this.root.style.backgroundSize = `${step}px ${step}px`;
		this.root.style.backgroundPosition = `${this.camera.tx}px ${this.camera.ty}px`;
	}

	private rulerColors: { bg: string; fg: string; accent: string } | null = null;

	private readRulerColors() {
		const style = getComputedStyle(this.root);
		return { bg: style.getPropertyValue('--background-secondary'), fg: style.getPropertyValue('--text-muted'), accent: style.getPropertyValue('--interactive-accent') };
	}

	/** Theme or CSS snippets changed: re-read colours that are cached for per-frame drawing. */
	themeChanged() {
		this.rulerColors = null;
		this.renderRulers();
	}

	/** Rulers in the display unit, measured from the selected page's top-left corner (else the board origin). */
	private renderRulers() {
		const page = this.store.file.pages.find((p) => p.id === this.selection?.pageId);
		const origin = page ? { x: page.x, y: page.y } : { x: 0, y: 0 };
		const unit = this.store.file.board.displayUnit;
		const k = PX_PER_MM * this.camera.zoom;
		// Rulers redraw on every camera frame: reading styles here would restyle the board each frame
		// (perf probe: 7 → 33 ms frames), so colours are cached and refreshed with the theme.
		const colors = (this.rulerColors ??= this.readRulerColors());
		const draw = (canvas: HTMLCanvasElement, horizontal: boolean) => {
			const dpr = this.root.win.devicePixelRatio || 1;
			const thick = 20;
			// Rulers start `thick` px into the board (past the corner square).
			const len = (horizontal ? this.root.clientWidth : this.root.clientHeight) - thick;
			const w = Math.max(1, Math.round((horizontal ? len : thick) * dpr));
			const h = Math.max(1, Math.round((horizontal ? thick : len) * dpr));
			// Resizing reallocates the canvas; only do it when the size really changed.
			if (canvas.width !== w || canvas.height !== h) {
				canvas.width = w;
				canvas.height = h;
			}
			const c = canvas.getContext('2d');
			if (!c) return;
			c.setTransform(dpr, 0, 0, dpr, 0, 0);
			c.fillStyle = colors.bg;
			c.fillRect(0, 0, horizontal ? len : thick, horizontal ? thick : len);
			const t = horizontal ? this.camera.tx : this.camera.ty;
			const o = horizontal ? origin.x : origin.y;
			const ticks = rulerTicks((thick - t) / k, (thick + len - t) / k, o, k, unit);
			const at = (mm: number) => Math.round(mm * k + t - thick) + 0.5;
			c.strokeStyle = colors.fg;
			c.fillStyle = colors.fg;
			c.lineWidth = 1;
			c.font = '9px var(--font-interface, sans-serif)';
			const tick = (p: number, size: number) => {
				if (horizontal) {
					c.moveTo(p, thick - size);
					c.lineTo(p, thick);
				} else {
					c.moveTo(thick - size, p);
					c.lineTo(thick, p);
				}
			};
			c.beginPath();
			for (const mm of ticks.minor) tick(at(mm), 4);
			for (const { mm } of ticks.major) tick(at(mm), 10);
			c.stroke();
			for (const { mm, label } of ticks.major) {
				const p = at(mm);
				if (horizontal) c.fillText(label, p + 2, 9);
				else {
					c.save();
					c.translate(9, p + 2);
					c.rotate(Math.PI / 2);
					c.fillText(label, 0, 0);
					c.restore();
				}
			}
		};
		draw(this.rulers.top, true);
		draw(this.rulers.left, false);
	}

	// ---------- saved views (SPEC 4 M3) ----------

	get views() {
		return this.store.file.views ?? [];
	}

	/** Ask for a name and store the current camera as a view in the board file. */
	promptSaveView() {
		if (this.store.readOnly) return;
		new TextPromptModal(this.view.app, 'Save view', `View ${this.views.length + 1}`, (name) => this.saveView(name)).open();
	}

	saveView(name: string) {
		const centre = cameraCentre(this.camera, this.viewportSize());
		const id = newId(new Set(this.views.map((v) => v.id)));
		const view = { id, name, x: Number(centre.x.toFixed(2)), y: Number(centre.y.toFixed(2)), zoom: Number(this.camera.zoom.toFixed(4)) };
		this.store.update((f) => ({ ...f, views: [...(f.views ?? []), view] }));
	}

	goToView(id: string) {
		const v = this.views.find((x) => x.id === id);
		if (v) this.setCamera(cameraCentredOn(v, v.zoom, this.viewportSize()));
	}

	deleteView(id: string) {
		this.store.update((f) => {
			const views = (f.views ?? []).filter((v) => v.id !== id);
			// No views left: drop the key, so the file looks as if views were never used.
			const { views: _old, ...rest } = f;
			return views.length ? { ...f, views } : rest;
		});
	}

	renameView(id: string, name: string) {
		this.store.update((f) => ({ ...f, views: (f.views ?? []).map((v) => (v.id === id ? { ...v, name } : v)) }));
	}

	pickView() {
		if (!this.views.length) return void new Notice('No saved views yet. Save one first from the outline panel or the command palette.');
		new NamedPickerModal(this.view.app, [...this.views], 'Go to view', (v) => this.goToView(v.id)).open();
	}

	// ---------- minimap (SPEC 5.1, M3) ----------

	toggleMinimap() {
		const show = this.minimap.hasClass('is-hidden');
		this.minimap.toggleClass('is-hidden', !show);
		this.services.ui?.setMinimap(show);
		this.renderMinimap();
	}

	/** All pages, scaled to fit, plus the visible area. Cheap enough to redraw every camera frame. */
	private renderMinimap() {
		if (this.minimap.hasClass('is-hidden')) return;
		const pages = this.store.file.pages;
		const vp = this.viewportSize();
		const area = visibleRect(this.camera, vp);
		const all = bounds([...pages, area]);
		const W = 180, H = 120, pad = 6;
		const dpr = this.root.win.devicePixelRatio || 1;
		if (this.minimap.width !== W * dpr) {
			this.minimap.width = W * dpr;
			this.minimap.height = H * dpr;
		}
		const c = this.minimap.getContext('2d');
		if (!c || !all) return;
		c.setTransform(dpr, 0, 0, dpr, 0, 0);
		const colors = (this.rulerColors ??= this.readRulerColors());
		c.fillStyle = colors.bg;
		c.fillRect(0, 0, W, H);
		const k = Math.min((W - 2 * pad) / all.w, (H - 2 * pad) / all.h);
		const ox = pad + ((W - 2 * pad) - all.w * k) / 2 - all.x * k;
		const oy = pad + ((H - 2 * pad) - all.h * k) / 2 - all.y * k;
		this.minimapFrame = { x: ox, y: oy, k };
		c.fillStyle = '#ffffff';
		for (const p of pages) c.fillRect(ox + p.x * k, oy + p.y * k, Math.max(1, p.w * k), Math.max(1, p.h * k));
		c.strokeStyle = colors.accent;
		c.lineWidth = 1.5;
		c.strokeRect(ox + area.x * k, oy + area.y * k, area.w * k, area.h * k);
	}

	private bindMinimap() {
		const centreAt = (e: PointerEvent) => {
			const f = this.minimapFrame;
			if (!f) return;
			const r = this.minimap.getBoundingClientRect();
			const p = { x: (e.clientX - r.left - f.x) / f.k, y: (e.clientY - r.top - f.y) / f.k };
			this.setCamera(cameraCentredOn(p, this.camera.zoom, this.viewportSize()));
		};
		this.minimap.addEventListener('pointerdown', (e) => {
			this.minimap.setPointerCapture(e.pointerId);
			centreAt(e);
		});
		this.minimap.addEventListener('pointermove', (e) => {
			if (this.minimap.hasPointerCapture(e.pointerId)) centreAt(e);
		});
	}

	/** Create, update or remove label elements to match the pages. */
	private syncLabels() {
		for (const [id, page] of this.pages) {
			let label = this.labels.get(id);
			if (!label) {
				label = this.labelLayer.createDiv({ cls: 'pw-page-label' });
				this.labels.set(id, label);
			}
			if (label.textContent !== page.labelText) label.setText(page.labelText);
			label.toggleClass('is-selected', this.items.some((it) => it.pageId === id && !it.moduleId));
			label.toggleClass('is-master', page.el.hasClass('is-master'));
		}
		for (const [id, label] of this.labels) {
			if (this.pages.has(id)) continue;
			label.remove();
			this.labels.delete(id);
		}
		this.placeLabels();
	}

	/** Position labels just above their pages, in screen pixels; off-screen pages hide theirs. */
	private placeLabels() {
		for (const page of this.store.file.pages) {
			const label = this.labels.get(page.id);
			if (!label) continue;
			const show = this.visible.has(page.id);
			label.toggleClass('is-hidden', !show);
			if (!show) continue;
			const p = boardToScreen(this.camera, page);
			label.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
		}
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
		if (changed) {
			this.modules.setVisible(ordered);
			this.placeLabels();
		}
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
	private hit(e: MouseEvent, target = e.target as HTMLElement): Selection {
		const mod = target.closest<HTMLElement>('.pw-module');
		if (mod?.dataset.moduleId && mod.dataset.pageId) return { pageId: mod.dataset.pageId, moduleId: mod.dataset.moduleId };
		const page = target.closest<HTMLElement>('.pw-page');
		return page?.dataset.pageId ? { pageId: page.dataset.pageId } : null;
	}

	private onPointerDown(e: PointerEvent) {
		this.root.focus();
		// Tracker controls take plain clicks; Shift and the other buttons still select and drag.
		if (e.button === 0 && !e.shiftKey && !this.spaceHeld && (e.target as HTMLElement).closest('.pw-interactive')) return;
		const handle = (e.target as HTMLElement).closest<HTMLElement>('.pw-handle')?.dataset.handle as Handle | undefined;
		// A handle sitting on a tracker control (content that fills the module) must not swallow the click.
		const control = handle && e.button === 0 && !e.shiftKey ? document.elementsFromPoint(e.clientX, e.clientY).find((el): el is HTMLElement => el.instanceOf(HTMLElement) && el.classList.contains('pw-interactive')) : undefined;
		if (control) {
			control.click();
			return;
		}
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
		const start = screenToBoard(this.camera, this.local(e));
		if (e.button === 0 && e.shiftKey && !this.spaceHeld) {
			// Shift on a module toggles it. Shift on paper or empty board draws a marquee; a Shift-click
			// on paper without dragging toggles the page instead (see finishMarquee).
			if (hit?.moduleId) {
				this.toggle(hit);
				const included = this.items.some((x) => sameItem(x, hit));
				this.drag = included && !this.store.readOnly ? this.startDrag(hit, start) : null;
			} else this.drag = { kind: 'marquee', start, onPage: hit };
			if (!this.drag) return;
		} else if (e.button === 1 || (e.button === 0 && (this.spaceHeld || !hit))) {
			if (!hit && e.button === 0) this.select(null);
			this.drag = { kind: 'pan', last: { x: e.clientX, y: e.clientY } };
		} else if (e.button === 0 && hit) {
			// Clicking an item that's part of a multi-selection keeps the group (to drag it).
			if (!this.items.some((x) => sameItem(x, hit))) this.select(hit);
			this.drag = this.store.readOnly ? null : this.startDrag(hit, start);
			if (!this.drag) return;
		} else return;
		this.root.setPointerCapture(e.pointerId);
		this.root.addClass('is-dragging');
	}

	private startDrag(hit: Item, startPointer: Point): Drag | null {
		const page = this.store.file.pages.find((p) => p.id === hit.pageId);
		if (!page) return null;
		const group = this.groupFor(hit);
		if (!hit.moduleId) return { kind: 'page', id: page.id, startPointer, startPos: { x: page.x, y: page.y }, group };
		const m = page.modules.find((x) => x.id === hit.moduleId);
		if (!m || m.locked) return null;
		return { kind: 'module', pageId: page.id, id: m.id, startPointer, startPos: { x: m.x, y: m.y }, group };
	}

	/** The other selected, unlocked items that move with `hit`, with their start positions. */
	private groupFor(hit: Item): Group {
		const out: Group = [];
		for (const it of this.items) {
			if (sameItem(it, hit)) continue;
			const page = this.store.file.pages.find((p) => p.id === it.pageId);
			if (!page) continue;
			if (!it.moduleId) out.push({ pageId: page.id, id: page.id, startPos: { x: page.x, y: page.y } });
			else {
				const m = page.modules.find((x) => x.id === it.moduleId);
				if (m && !m.locked) out.push({ pageId: page.id, id: m.id, startPos: { x: m.x, y: m.y } });
			}
		}
		return out;
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
		if (d.kind === 'marquee') return this.drawMarquee(d.start, p);
		const raw = { x: d.startPos.x + p.x - d.startPointer.x, y: d.startPos.y + p.y - d.startPointer.y };
		const pos = this.snapMove(d, raw, grid, e.altKey);
		// The group moves by the same (snapped) delta as the item under the pointer.
		const dx = pos.x - d.startPos.x, dy = pos.y - d.startPos.y;
		if (d.kind === 'page') {
			this.store.update((f) => d.group.reduce((acc, g) => movePage(acc, g.id, g.startPos.x + dx, g.startPos.y + dy), movePage(f, d.id, pos.x, pos.y)), { coalesce: `move-page:${d.id}` });
		} else {
			this.store.update(
				(f) => d.group.reduce((acc, g) => moveModule(acc, g.pageId, g.id, g.startPos.x + dx, g.startPos.y + dy), moveModule(f, d.pageId, d.id, pos.x, pos.y)),
				{ coalesce: `move-module:${d.id}` },
			);
			if (d.group.length === 0) this.highlightDropPage(this.reparentTarget(d));
		}
	}

	private marqueeRect(a: Point, b: Point): Rect {
		return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
	}

	private drawMarquee(a: Point, b: Point) {
		const r = this.marqueeRect(a, b);
		this.marqueeEl.removeClass('is-hidden');
		this.marqueeEl.setCssProps({ '--pw-x': `${r.x}mm`, '--pw-y': `${r.y}mm`, '--pw-w': `${r.w}mm`, '--pw-h': `${r.h}mm` });
	}

	/** Select modules touched by the marquee; if it touches none, the pages it touches. */
	private finishMarquee(d: Extract<Drag, { kind: 'marquee' }>, b: Point) {
		this.marqueeEl.addClass('is-hidden');
		const r = this.marqueeRect(d.start, b);
		// Barely moved: it was a Shift-click, on a page (toggle it) or on empty board (nothing).
		if (r.w * PX_PER_MM * this.camera.zoom < 4 && r.h * PX_PER_MM * this.camera.zoom < 4) {
			if (d.onPage) this.toggle(d.onPage);
			return;
		}
		const modules: Item[] = [];
		const pages: Item[] = [];
		for (const page of this.store.file.pages) {
			if (intersects(page, r)) pages.push({ pageId: page.id });
			for (const m of page.modules) if (intersects({ x: page.x + m.x, y: page.y + m.y, w: m.w, h: m.h }, r)) modules.push({ pageId: page.id, moduleId: m.id });
		}
		this.setItems(modules.length ? modules : pages);
	}

	/**
	 * Where a dragged page or module lands: smart guides first (edges and centres of its neighbours,
	 * SPEC 5.6), else the grid. Alt bypasses both (SPEC 5.1). Guide lines are drawn while dragging.
	 */
	private snapMove(d: Extract<Drag, { kind: 'page' | 'module' }>, raw: Point, grid: { size: number; snap: boolean }, free: boolean): Point {
		const file = this.store.file;
		let size: { w: number; h: number } | undefined;
		let others: Rect[] = [];
		let offset = { x: 0, y: 0 };
		// Items moving together are not guides for each other.
		const moving = new Set([d.id, ...d.group.map((g) => g.id)]);
		if (d.kind === 'page') {
			size = file.pages.find((p) => p.id === d.id);
			others = file.pages.filter((p) => !moving.has(p.id));
		} else {
			const page = file.pages.find((p) => p.id === d.pageId);
			size = page?.modules.find((m) => m.id === d.id);
			if (page) {
				others = [{ x: 0, y: 0, w: page.w, h: page.h }, ...page.modules.filter((m) => !moving.has(m.id))];
				offset = page;
			}
		}
		if (free || !size) {
			this.drawGuides([], [], offset);
			return raw;
		}
		const g = snapToGuides({ ...raw, w: size.w, h: size.h }, others, GUIDE_SNAP_PX / (PX_PER_MM * this.camera.zoom));
		this.drawGuides(g.vertical, g.horizontal, offset);
		const gridSnap = (v: number) => (grid.snap ? snapValue(v, grid.size) : v);
		return { x: g.x ?? gridSnap(raw.x), y: g.y ?? gridSnap(raw.y) };
	}

	/** Guide positions come in page or board coordinates; `offset` moves them onto the board. */
	private drawGuides(vertical: number[], horizontal: number[], offset: Point) {
		this.guideLayer.empty();
		for (const x of vertical) this.guideLayer.createDiv({ cls: 'pw-guide pw-guide-v' }).setCssProps({ '--pw-x': `${offset.x + x}mm` });
		for (const y of horizontal) this.guideLayer.createDiv({ cls: 'pw-guide pw-guide-h' }).setCssProps({ '--pw-y': `${offset.y + y}mm` });
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
		if (!from || !m) return;
		if (!to) return this.keepOnPage(from, m);
		const grid = this.store.file.board.grid;
		const rel = snapPoint({ x: from.x + m.x - to.x, y: from.y + m.y - to.y }, grid.snap ? grid.size : 0);
		this.store.update((f) => moveModuleToPage(f, from.id, m.id, to.id, rel.x, rel.y), { coalesce: `move-module:${d.id}` });
		this.select({ pageId: to.id, moduleId: m.id });
	}

	/** A module dropped off every page would vanish (it is clipped to its page); keep a strip of it on the page. */
	private keepOnPage(page: Page, m: AnyModule) {
		const r = keepGrabbable(m, page, MIN_VISIBLE_MM);
		if (r.x === m.x && r.y === m.y) return;
		this.store.update((f) => moveModule(f, page.id, m.id, r.x, r.y), { coalesce: `move-module:${m.id}` });
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
		if (this.drag.kind === 'module' && this.drag.group.length === 0) this.reparent(this.drag);
		if (this.drag.kind === 'marquee') this.finishMarquee(this.drag, screenToBoard(this.camera, this.local(e)));
		this.drag = null;
		this.guideLayer.empty();
		this.store.endCoalesce();
		this.root.removeClass('is-dragging');
		this.contextBar.reposition();
		this.outlinePanel.refresh();
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
		else if (!mod && ['+', '=', '-'].includes(e.key)) {
			if (!this.stepSelectedTracker(e.key === '-' ? -1 : 1)) return;
		} else if (e.key === 'Enter' && !mod && !e.shiftKey) {
			if (!this.editSelection()) return;
		}
		else return;
		e.preventDefault();
	}

	/** The + / − keys on a selected counter or boxes tracker; false when there is nothing to step. */
	private stepSelectedTracker(direction: 1 | -1): boolean {
		const sel = this.selection;
		if (!sel?.moduleId || this.items.length !== 1 || this.store.readOnly) return false;
		const m = this.store.file.pages.find((p) => p.id === sel.pageId)?.modules.find((x) => x.id === sel.moduleId);
		const next = m?.type === 'tracker' ? stepByKey(m as TrackerModule, direction) : null;
		if (!next) return false;
		this.store.update((f) => mapModule(f, sel.pageId, sel.moduleId!, () => next));
		return true;
	}

	private duplicateSelection() {
		if (this.items.length === 0 || this.store.readOnly) return;
		const taken = allIds(this.store.file);
		const ids = () => {
			const id = newId(taken);
			taken.add(id);
			return id;
		};
		const copies: Item[] = [];
		this.store.update((f) =>
			this.items.reduce((acc, it) => {
				if (it.moduleId) {
					const id = ids();
					copies.push({ pageId: it.pageId, moduleId: id });
					return duplicateModule(acc, it.pageId, it.moduleId, id);
				}
				const next = duplicatePage(acc, it.pageId, ids);
				const added = next.pages[next.pages.length - 1];
				if (added && next !== acc) copies.push({ pageId: added.id });
				return next;
			}, f),
		);
		this.setItems(copies);
	}

	/** Arrow keys move the selection by 1 mm (Shift: 10 mm). Consecutive presses undo as one step. */
	private nudge(key: string, step: number) {
		if (this.items.length === 0 || this.store.readOnly) return;
		const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
		const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
		const shift = <T extends Point>(o: T): T => ({ ...o, x: o.x + dx, y: o.y + dy });
		this.store.update(
			(f) => this.items.reduce((acc, it) => (it.moduleId ? mapModule(acc, it.pageId, it.moduleId, (m) => (m.locked ? m : shift(m))) : mapPage(acc, it.pageId, shift)), f),
			{ coalesce: `nudge:${this.items.map((it) => it.moduleId ?? it.pageId).join(',')}` },
		);
	}

	deleteSelection() {
		if (this.items.length === 0 || this.store.readOnly) return;
		const items = this.items;
		this.store.update((f) => items.reduce((acc, it) => (it.moduleId ? removeModule(acc, it.pageId, it.moduleId) : removePage(acc, it.pageId)), f));
		this.setItems([]);
	}

	/** Lock or unlock every selected module (locked if any is unlocked). */
	toggleLock() {
		const mods = this.items.filter((it) => it.moduleId);
		const anyUnlocked = mods.some((it) => !this.store.file.pages.find((p) => p.id === it.pageId)?.modules.find((m) => m.id === it.moduleId)?.locked);
		this.store.update((f) => mods.reduce((acc, it) => mapModule(acc, it.pageId, it.moduleId!, (m) => ({ ...m, locked: anyUnlocked ? true : undefined })), f));
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
					return { id, type: 'pdf', ...place(w, h), file: file.path, page: r.page, ...(r.crop ? { crop: r.crop } : {}), ...(r.sourceId ? { sourceId: r.sourceId } : {}) };
				}),
			).open();
		}
		new Notice(`Patchwork can't place .${ext} files yet.`);
	}

	/** Double-click: a note module opens its source at that section; a PDF module opens the crop editor (SPEC 5.6). */
	private onDoubleClick(e: MouseEvent) {
		// The pointer is captured by the board on press, which retargets the click events to the board itself.
		const hit = this.hit(e, (document.elementFromPoint(e.clientX, e.clientY) ?? e.target) as HTMLElement);
		const m = hit?.moduleId ? this.store.file.pages.find((p) => p.id === hit.pageId)?.modules.find((x) => x.id === hit.moduleId) : undefined;
		if (hit?.moduleId && m?.type === 'pdf') return this.editCrop(hit.pageId, hit.moduleId);
		if (hit?.moduleId && canEditInline(m)) return this.editInline(hit.pageId, hit.moduleId);
		// A frame opens the note its chain starts from.
		const note = (m?.type === 'frame' ? this.chainHead(m.id) : m) as NoteModule | undefined;
		if (note?.type !== 'note') return;
		const page = this.store.file.pages.find((p) => p.modules.some((x) => x.id === note.id));
		if (page) this.openNote(page.id, note.id);
	}

	/** Edit a text box or note in place (double-click, Enter, or Edit on the context bar). */
	editInline(pageId: string, moduleId: string) {
		void startInlineEdit({ app: this.view.app, store: this.store, modules: this.modules, done: () => this.focusBoard(), host: this.host, topInset: () => this.toolbarBottom() }, pageId, moduleId);
	}

	/** Enter on a selected text box or note starts editing it; false when the selection is something else. */
	private editSelection(): boolean {
		const sel = this.selection;
		if (!sel?.moduleId || this.items.length !== 1 || this.store.readOnly) return false;
		const m = this.store.file.pages.find((p) => p.id === sel.pageId)?.modules.find((x) => x.id === sel.moduleId);
		if (!canEditInline(m)) return false;
		this.editInline(sel.pageId, sel.moduleId);
		return true;
	}

	private chainHead(moduleId: string): AnyModule | undefined {
		const info = flowChains(this.store.file).get(moduleId);
		return info?.ok ? info.chain[0]!.module : undefined;
	}

	/** Align, distribute and bulk actions for a multi-selection. */
	private showGroupMenu(e: MouseEvent) {
		const menu = new Menu();
		for (const [mode, title, icon] of ALIGN_ACTIONS) menu.addItem((i) => i.setTitle(title).setIcon(icon).onClick(() => this.align(mode)));
		menu.addSeparator();
		menu.addItem((i) => i.setTitle('Distribute horizontally').setIcon('align-horizontal-distribute-center').setDisabled(this.items.length < 3).onClick(() => this.distribute('h')));
		menu.addItem((i) => i.setTitle('Distribute vertically').setIcon('align-vertical-distribute-center').setDisabled(this.items.length < 3).onClick(() => this.distribute('v')));
		menu.addSeparator();
		if (this.items.some((it) => it.moduleId)) menu.addItem((i) => i.setTitle('Lock or unlock').setIcon('lock').onClick(() => this.toggleLock()));
		menu.addItem((i) => i.setTitle('Duplicate').setIcon('copy').onClick(() => this.duplicateSelection()));
		menu.addItem((i) => i.setTitle(`Delete ${this.items.length} items`).setIcon('trash-2').setWarning(true).onClick(() => this.deleteSelection()));
		menu.showAtMouseEvent(e);
	}

	private onContextMenu(e: MouseEvent) {
		const hit = this.hit(e);
		if (!hit || this.store.readOnly) return;
		e.preventDefault();
		if (this.items.length > 1 && this.items.some((x) => sameItem(x, hit))) return this.showGroupMenu(e);
		this.select(hit);
		const menu = new Menu();
		const { pageId, moduleId } = hit;
		if (moduleId) {
			const m = this.store.file.pages.find((p) => p.id === pageId)?.modules.find((x) => x.id === moduleId);
			menu.addItem((i) => i.setTitle('Item settings…').setIcon('sliders-horizontal').onClick(() => this.showProperties('content')));
			menu.addItem((i) => i.setTitle('Size and position…').setIcon('move-diagonal').onClick(() => this.showProperties('layout')));
			menu.addItem((i) => i.setTitle('Style…').setIcon('paintbrush').onClick(() => this.showProperties('style')));
			menu.addSeparator();
			if (m?.type === 'pdf') menu.addItem((i) => i.setTitle('Edit crop…').setIcon('crop').onClick(() => this.editCrop(pageId, moduleId)));
			if (m?.type === 'text' || m?.type === 'frame') {
				menu.addItem((i) => i.setTitle('Continue in a new frame').setIcon('link').onClick(() => this.continueInFrame(pageId, moduleId)));
				menu.addSeparator();
			}
			const marker = this.services.overflowMarker;
			if (marker && (m?.type === 'note' || m?.type === 'text' || m?.type === 'frame')) {
				menu.addItem((i) => i.setTitle('Show overflow marker').setIcon('alert-triangle').setChecked(marker.shown()).onClick(() => marker.set(!marker.shown())));
				menu.addSeparator();
			}
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
				const frozen = !!(m as NoteModule).frozen;
				menu.addItem((i) => i.setTitle('Continue in a new frame').setIcon('link').onClick(() => this.continueInFrame(pageId, moduleId)));
				menu.addItem((i) =>
					i
						.setTitle(frozen ? 'Unfreeze' : 'Freeze text (snapshot)')
						.setIcon(frozen ? 'flame' : 'snowflake')
						.onClick(() => (frozen ? this.unfreezeNote(pageId, moduleId) : void this.freezeNote(pageId, moduleId))),
				);
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
			menu.addItem((i) => i.setTitle('Page settings…').setIcon('sliders-horizontal').onClick(() => this.showProperties('content')));
			menu.addItem((i) => i.setTitle('Size and position…').setIcon('move-diagonal').onClick(() => this.showProperties('layout')));
			menu.addItem((i) => i.setTitle('Page numbers, header and footer…').setIcon('hash').onClick(() => this.showProperties('furniture')));
			menu.addSeparator();
			menu.addItem((i) => i.setTitle('Zoom to page').setIcon('scan').onClick(() => this.zoomToSelection()));
			menu.addItem((i) => i.setTitle('Duplicate page').setIcon('copy').onClick(() => this.duplicateSelection()));
			menu.addItem((i) => i.setTitle('Swap orientation').setIcon('rotate-cw').onClick(() => this.store.update((f) => mapPage(f, pageId, (p) => swapOrientation(p)))));
			menu.addItem((i) => i.setTitle('Delete page').setIcon('trash-2').setWarning(true).onClick(() => this.deleteSelection()));
		}
		menu.showAtMouseEvent(e);
	}

	// ---------- toolbar ----------

	private buildToolbar(container: HTMLElement) {
		const bar = container.createDiv({ cls: 'pw-toolbar' });
		this.toolbar = bar;
		const button = (icon: string, label: string, onClick: (e: MouseEvent) => void) => {
			const b = bar.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } });
			setIcon(b, icon);
			b.addEventListener('click', onClick);
		};
		const labelled = (icon: string, text: string, tip: string, onClick: (e: MouseEvent) => void) => {
			const b = bar.createEl('button', { cls: 'pw-tb-btn', attr: { 'aria-label': tip } });
			setIcon(b.createSpan({ cls: 'pw-tb-icon' }), icon);
			b.createSpan({ text });
			b.addEventListener('click', onClick);
		};
		const sep = () => bar.createDiv({ cls: 'pw-toolbar-sep' });
		if (!this.store.readOnly) {
			labelled('file-plus', 'Page', 'Add a page', (e) => this.showAddPageMenu(e));
			labelled('file-text', 'Note', 'Add a note', () => this.pickNote());
			labelled('book-open', 'PDF', 'Add a region of a PDF', () => this.pickPdf());
			labelled('plus', 'More', 'Add text, an image, a tracker or a table of contents', (e) => this.showAddMenu(e));
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
		sep();
		if (!this.store.readOnly) labelled('settings-2', 'Settings', 'Settings for the whole patchwork: units, grid, numbering, appearance. Right-click a page or an item for its own settings.', () => this.showSettings());
		labelled('file-output', 'Export', 'Export as PDF or PNG, or to a canvas', (e) => this.showExportMenu(e));
		labelled('layout-panel-left', 'View', 'Outline and views, minimap, sidebar inspector', (e) => this.showViewMenu(e));
		this.cleanups.push(() => bar.remove());
		this.fitToolbar();
	}

	private showMenuAt(menu: Menu, e?: MouseEvent) {
		if (e) {
			menu.showAtMouseEvent(e);
			return;
		}
		const r = this.root.getBoundingClientRect();
		menu.showAtPosition({ x: r.left + 40, y: r.top + 40 });
	}

	/** Everything that is not a page, a note or a PDF, so the toolbar keeps three add buttons. */
	showAddMenu(e?: MouseEvent) {
		const menu = new Menu();
		menu.addItem((i) => i.setTitle('Text box').setIcon('type').onClick(() => this.addText()));
		menu.addItem((i) => i.setTitle('Image').setIcon('image').onClick(() => this.pickImage()));
		menu.addItem((i) => i.setTitle('Table of contents').setIcon('list').onClick(() => this.addToc()));
		menu.addSeparator();
		menu.addItem((i) => i.setTitle('Counter').setIcon('plus-minus').onClick(() => this.addTracker('counter')));
		menu.addItem((i) => i.setTitle('Boxes').setIcon('square').onClick(() => this.addTracker('boxes')));
		menu.addItem((i) => i.setTitle('Checklist').setIcon('list-checks').onClick(() => this.addTracker('checklist')));
		this.showMenuAt(menu, e);
	}

	showExportMenu(e?: MouseEvent) {
		const menu = new Menu();
		this.addViewMenuItems(menu);
		this.showMenuAt(menu, e);
	}

	showViewMenu(e?: MouseEvent) {
		const menu = new Menu();
		menu.addItem((i) => i.setTitle('Outline and views').setIcon('list-tree').setChecked(this.outlinePanel.isOpen).onClick(() => this.outlinePanel.toggle()));
		if (this.services.openPanels) menu.addItem((i) => i.setTitle('Inspector and outline in the sidebar').setIcon('panel-right').onClick(() => this.services.openPanels?.()));
		menu.addItem((i) => i.setTitle('Minimap').setIcon('map').setChecked(!this.minimap.hasClass('is-hidden')).onClick(() => this.toggleMinimap()));
		this.showMenuAt(menu, e);
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

/** {date}: today's local date as YYYY-MM-DD (exports use the export day). */
function today(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}


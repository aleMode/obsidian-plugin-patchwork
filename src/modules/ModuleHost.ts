import { Component, TAbstractFile } from 'obsidian';
import { isInheritedId, resolvePage } from '../model/masters';
import { type AnyModule, isKnownModule, type NoteModule, type Page, type TrackerModule } from '../model/schema';
import type { BoardStore } from '../store/BoardStore';
import { ImageModuleRenderer } from './imageModule';
import { FlowRenderer, NoteModuleRenderer, TextModuleRenderer } from './noteModule';
import { FlowLayout } from './flowLayout';
import { chainSignature, type FlowInfo, flowChains } from '../model/flow';
import { applyOverflow } from './overflow';
import { applyModuleStyle } from './style';
import { PdfModuleRenderer } from './pdfModule';
import { TocModuleRenderer } from './tocModule';
import { TrackerRenderer } from './trackerModule';
import { ThumbnailCache } from '../render/thumbnails';
import { mapModule } from '../store/pageOps';
import { tocEntries } from '../model/toc';
import { type ModuleContext, type ModuleRenderer, placeholder } from './types';

/** Fields that change what a module shows. Anything else (position, label, …) is layout only. */
const CONTENT_KEYS: Record<string, readonly string[]> = {
	note: ['file', 'subpath', 'lines', 'includeHeading', 'overflow', 'frozen'],
	pdf: ['file', 'page', 'crop', 'fit', 'rotation', 'invert', 'sourceId', 'w', 'h', 'style'],
	text: ['markdown'],
	image: ['file', 'fit'],
	toc: ['heading'],
	tracker: ['kind', 'label', 'value', 'min', 'max', 'step', 'items'],
};

/**
 * Main-thread time per frame for rendering newly mounted modules. Mounting a row of pages at once
 * caused 50–100 ms hitches while panning (docs/perf.md); the rest waits for the next frame.
 */
const FRAME_BUDGET_MS = 8;

function contentKey(m: AnyModule): string {
	return JSON.stringify([m.type, ...(CONTENT_KEYS[m.type] ?? []).map((k) => m[k])]);
}

interface Mounted {
	pageId: string;
	/** Which renderer it has: the module type, or 'flow' for members of a linked-frame chain. */
	kind: string;
	el: HTMLElement;
	body: HTMLElement;
	/** Watches note content size, so overflow is re-applied when async content (embeds, Dataview) lands. */
	sizeWatch?: ResizeObserver;
	renderer: ModuleRenderer | null;
	key: string;
	module: AnyModule;
}

export interface ModuleHostOptions {
	ctx: Omit<ModuleContext, 'component'>;
	store: BoardStore;
	/** Paper element of a page, or undefined if the page isn't drawn. */
	paperOf: (pageId: string) => HTMLElement | undefined;
	boardPath: () => string;
	parent: Component;
	/** Pick another source file for a module (missing-file placeholders). */
	replaceSource?: (pageId: string, moduleId: string) => void;
}

/**
 * Mounts module content for visible pages only and unmounts it when pages scroll away
 * (hard rule 9). Re-renders modules when their source files change.
 */
export class ModuleHost {
	private mounted = new Map<string, Mounted>();
	/** Visible page IDs, most important first: renders queue in this order. */
	private visible: readonly string[] = [];
	/** Level of detail: when false (zoomed far out), pages show module outlines instead of content. */
	private detail = false;
	private skeletons = new Map<string, { el: HTMLElement; key: string }>();
	/** Newly mounted modules waiting for their first render, most important first. */
	private queue: Mounted[] = [];
	private frame = 0;
	private component = new Component();
	private ctx: ModuleContext;
	private flowLayout: FlowLayout;
	/** Linked-frame chains of the current file, recomputed when the file changes. */
	private chains: { file: unknown; map: Map<string, FlowInfo> } = { file: null, map: new Map() };
	selectedModules: ReadonlySet<string> = new Set();
	/** Modules being edited in place: left alone by re-renders; `commit` runs if they must unmount. */
	private editing = new Map<string, { commit: () => void }>();
	private unmounting = new Set<string>();

	constructor(private o: ModuleHostOptions) {
		const layout = new FlowLayout(o.ctx.app, o.boardPath, () => o.store.file.board.fontFamily, o.ctx.pdfDocs);
		const replace = o.replaceSource;
		this.flowLayout = layout;
		this.ctx = {
			...o.ctx,
			component: this.component,
			flow: { info: (id) => this.flowInfo().get(id), layout },
			...(replace ? { replaceSource: (id: string) => this.mounted.has(id) && replace(this.mounted.get(id)!.pageId, id) } : {}),
		};
		o.parent.addChild(this.component);
		const { app } = o.ctx;
		this.component.registerEvent(app.metadataCache.on('changed', (file) => this.sourceChanged(file.path)));
		this.component.registerEvent(app.vault.on('delete', (file) => this.sourceChanged(file.path)));
		this.component.registerEvent(app.vault.on('rename', (file: TAbstractFile, old: string) => this.sourceChanged(old, file.path)));
		this.component.registerEvent(app.vault.on('modify', (file) => o.ctx.pdfDocs.invalidate(file.path)));
		this.component.register(o.ctx.pdfDocs.onInvalidate((path) => this.sourceChanged(path)));
		// Zoomed out right after rendering: show previews as they finish encoding (once per frame).
		const thumbs = o.ctx.thumbs;
		if (thumbs) {
			let queued = 0;
			this.component.register(thumbs.onStored(() => {
				if (this.detail || queued) return;
				queued = window.requestAnimationFrame(() => {
					queued = 0;
					if (!this.detail) this.sync();
				});
			}));
		}
	}

	private flowInfo(): Map<string, FlowInfo> {
		const file = this.o.store.file;
		if (this.chains.file !== file) this.chains = { file, map: flowChains(file) };
		return this.chains.map;
	}

	/** Renderer kind and content key; chain members re-render when anything in their chain changes. */
	private identity(m: AnyModule, toc: string): { kind: string; key: string } {
		const info = this.flowInfo().get(m.id);
		if (m.type === 'frame' || info) {
			const chain = info?.ok ? chainSignature(info.chain) + info.index : JSON.stringify(info ?? null);
			return { kind: 'flow', key: contentKey(m) + chain };
		}
		return { kind: m.type, key: m.type === 'toc' ? contentKey(m) + toc : contentKey(m) };
	}

	setVisible(visible: readonly string[]) {
		this.visible = visible;
		this.sync();
	}

	setDetail(detail: boolean) {
		if (detail === this.detail) return;
		this.detail = detail;
		this.sync();
	}

	/** After a zoom settles: re-render PDF modules (and PDF pages embedded in notes) that no longer match the zoom. */
	resolutionChanged(pxPerMm: number) {
		for (const m of this.mounted.values()) {
			if (m.renderer instanceof PdfModuleRenderer) {
				if (m.renderer.wantsResolution(pxPerMm)) this.renderContent(m);
			} else if (!this.editing.has(m.module.id)) m.renderer?.resolutionChanged?.(pxPerMm);
		}
	}

	sync() {
		const live = new Set<string>();
		const outlined = new Set<string>();
		const file = this.o.store.file;
		const byId = new Map(file.pages.map((p) => [p.id, p]));
		for (const id of this.visible) {
			const stored = byId.get(id);
			if (!stored) continue;
			// Master modules are mounted on every page using the master, under the page's own.
			const page = resolvePage(file, stored);
			const paper = this.o.paperOf(page.id);
			if (!paper) continue;
			if (this.detail) this.syncPage(page, paper, live);
			else {
				this.syncSkeleton(page, paper);
				outlined.add(page.id);
			}
		}
		for (const [id, m] of this.mounted) if (!live.has(id)) this.unmount(id, m);
		for (const [id, s] of this.skeletons) {
			if (outlined.has(id)) continue;
			s.el.remove();
			this.skeletons.delete(id);
		}
	}

	/**
	 * Cheap stand-ins for modules when zoomed far out: a box each, with a small preview for PDF crops
	 * and images that were rendered before. Nothing is rendered or decoded here.
	 */
	private syncSkeleton(page: Page, paper: HTMLElement) {
		const { app } = this.o.ctx;
		const thumbs = this.o.ctx.thumbs;
		const thumbKeys = page.modules.map((m) => (thumbs ? ThumbnailCache.key(app, m) : undefined));
		const key = JSON.stringify(page.modules.map((m, i) => [m.type, m.x, m.y, m.w, m.h, m.fit, m.invert, thumbKeys[i] && thumbs?.has(thumbKeys[i])]));
		const existing = this.skeletons.get(page.id);
		if (existing?.key === key && existing.el.parentElement === paper) return;
		existing?.el.remove();
		const el = paper.createDiv({ cls: 'pw-skeletons' });
		page.modules.forEach((m, i) => {
			const box = el.createDiv({ cls: `pw-module-skeleton pw-skeleton-${m.type}` });
			box.setCssProps({ '--pw-x': `${m.x}mm`, '--pw-y': `${m.y}mm`, '--pw-w': `${m.w}mm`, '--pw-h': `${m.h}mm` });
			const url = thumbKeys[i] ? thumbs?.url(thumbKeys[i]) : undefined;
			if (!url) return;
			const img = box.createEl('img', { cls: ['pw-skeleton-thumb', `pw-fit-${typeof m.fit === 'string' ? m.fit : 'contain'}`], attr: { src: url, alt: '', draggable: 'false' } });
			img.toggleClass('is-inverted', !!m.invert);
			box.addClass('has-thumb');
		});
		this.skeletons.set(page.id, { el, key });
	}

	private syncPage(page: Page, paper: HTMLElement, live: Set<string>) {
		// Draw order: by z, then array order (SPEC 6).
		const order = page.modules.map((m, i) => ({ m, i })).sort((a, b) => (a.m.z ?? 0) - (b.m.z ?? 0) || a.i - b.i);
		// A table of contents changes with other pages' names and numbers, not just its own fields.
		const toc = page.modules.some((m) => m.type === 'toc') ? JSON.stringify(tocEntries(this.o.store.file, page.id)) : '';
		order.forEach(({ m }, rank) => {
			live.add(m.id);
			let mounted = this.mounted.get(m.id);
			if (mounted && mounted.pageId !== page.id) {
				this.unmount(m.id, mounted);
				mounted = undefined;
			}
			const { kind, key } = this.identity(m, toc);
			if (mounted && mounted.kind !== kind) {
				// Joined or left a chain: a different renderer draws it now.
				this.unmount(m.id, mounted);
				mounted = undefined;
			}
			const isNew = !mounted;
			if (!mounted) mounted = this.mount(m, page.id, paper, kind);
			this.layout(mounted, m, rank);
			mounted.module = m;
			if (key === mounted.key) return;
			mounted.key = key;
			// Edits re-render at once; content for pages scrolling into view is spread over frames.
			if (isNew) this.enqueue(mounted);
			else this.renderContent(mounted);
		});
	}

	private enqueue(m: Mounted) {
		m.el.addClass('is-pending');
		this.queue.push(m);
		if (!this.frame) this.frame = window.requestAnimationFrame(() => this.drain());
	}

	private drain() {
		this.frame = 0;
		const start = performance.now();
		while (this.queue.length && performance.now() - start < FRAME_BUDGET_MS) {
			const m = this.queue.shift()!;
			// Skip modules unmounted while they waited.
			if (this.mounted.get(m.module.id) !== m) continue;
			m.el.removeClass('is-pending');
			this.renderContent(m);
		}
		if (this.queue.length) this.frame = window.requestAnimationFrame(() => this.drain());
	}

	private mount(m: AnyModule, pageId: string, paper: HTMLElement, kind: string): Mounted {
		// Inherited (master) modules get no IDs, so clicks fall through to the page.
		const el = isInheritedId(m.id) ? paper.createDiv({ cls: 'pw-module is-inherited' }) : paper.createDiv({ cls: 'pw-module', attr: { 'data-module-id': m.id, 'data-page-id': pageId } });
		const body = el.createDiv({ cls: `pw-module-body pw-module-${m.type}` });
		const mounted: Mounted = { pageId, kind, el, body, renderer: this.createRenderer(m, body, pageId, kind), key: '', module: m };
		this.mounted.set(m.id, mounted);
		return mounted;
	}

	private createRenderer(m: AnyModule, body: HTMLElement, pageId: string, kind: string): ModuleRenderer | null {
		if (kind === 'flow') return new FlowRenderer(body, this.ctx);
		if (!isKnownModule(m)) {
			placeholder(body, `Unknown module type "${m.type}" (kept as is)`, 'info');
			return null;
		}
		switch (m.type) {
			case 'note':
				return new NoteModuleRenderer(body, this.ctx);
			case 'text':
				return new TextModuleRenderer(body, this.ctx, this.o.boardPath);
			case 'pdf':
				return new PdfModuleRenderer(body, this.ctx);
			case 'image':
				return new ImageModuleRenderer(body, this.ctx);
			case 'toc':
				return new TocModuleRenderer(body, () => tocEntries(this.o.store.file, pageId));
			case 'frame':
				return new FlowRenderer(body, this.ctx);
			case 'tracker': {
				const store = this.o.store;
				// Clicks are ordinary edits: undoable and saved with the board.
				return new TrackerRenderer(body, store.readOnly ? undefined : (fn) => store.update((f) => mapModule(f, pageId, m.id, (x) => fn(x as TrackerModule))));
			}
		}
	}

	private layout(mounted: Mounted, m: AnyModule, rank: number) {
		const resized = mounted.module.w !== m.w || mounted.module.h !== m.h || (mounted.module as NoteModule).scrollY !== (m as NoteModule).scrollY;
		mounted.el.setCssProps({ '--pw-x': `${m.x}mm`, '--pw-y': `${m.y}mm`, '--pw-w': `${m.w}mm`, '--pw-h': `${m.h}mm`, '--pw-z': String(rank + 1) });
		mounted.el.toggleClass('is-selected', this.selectedModules.has(m.id));
		mounted.el.toggleClass('is-locked', !!m.locked);
		applyModuleStyle(mounted.el, m);
		if (resized && m.type === 'note' && mounted.kind === 'note') this.updateOverflow({ ...mounted, module: m });
	}

	private renderContent(mounted: Mounted) {
		if (this.editing.has(mounted.module.id)) return;
		try {
			mounted.renderer?.render(mounted.module);
		} catch (e) {
			placeholder(mounted.body, `Could not render module: ${e instanceof Error ? e.message : String(e)}`);
		}
		if (mounted.kind === 'note') void mounted.renderer?.rendered().then(() => this.watchOverflow(mounted));
	}

	private watchOverflow(m: Mounted) {
		if (this.mounted.get(m.module.id) !== m) return;
		m.sizeWatch?.disconnect();
		const update = () => this.updateOverflow(m);
		m.sizeWatch = new ResizeObserver(update);
		const content = m.body.querySelector(':scope > .pw-markdown');
		if (content) m.sizeWatch.observe(content);
		m.sizeWatch.observe(m.body);
		update();
	}

	private updateOverflow(m: Mounted) {
		const note = m.module as NoteModule;
		m.el.toggleClass('is-overflowing', applyOverflow(m.el, m.body, note.overflow ?? 'clip', note.scrollY));
	}

	/**
	 * Recreate rather than re-render: a renderer may hold state tied to the old source
	 * (e.g. a PDF document the cache just destroyed).
	 */
	private sourceChanged(...paths: string[]) {
		for (const m of this.mounted.values()) {
			const deps = m.renderer?.dependencies();
			if (!deps || !paths.some((p) => deps.has(p)) || this.editing.has(m.module.id)) continue;
			m.renderer?.destroy();
			m.renderer = this.createRenderer(m.module, m.body, m.pageId, m.kind);
			this.renderContent(m);
		}
	}

	private unmount(id: string, m: Mounted) {
		// A module scrolled away or zoomed out while being edited keeps what was typed.
		const session = this.editing.get(id);
		this.editing.delete(id);
		this.unmounting.add(id);
		try {
			session?.commit();
		} finally {
			this.unmounting.delete(id);
		}
		m.sizeWatch?.disconnect();
		m.renderer?.destroy();
		m.el.remove();
		this.mounted.delete(id);
	}

	/** Which stretch of its chain's text a linked module shows (see FlowLayout.part); null when it isn't in a working chain. */
	flowPart(id: string): ReturnType<FlowLayout['part']> {
		const info = this.flowInfo().get(id);
		return info?.ok ? this.flowLayout.part(info.chain, info.index) : Promise.resolve(null);
	}

	/** The markdown a mounted module shows (see ModuleRenderer.shownMarkdown). */
	shownMarkdown(id: string): string | undefined {
		return this.mounted.get(id)?.renderer?.shownMarkdown?.();
	}

	/**
	 * Start editing a module in place: its rendered content stops updating and its body is handed to the
	 * editor. Returns null when the module is not on screen (not mounted).
	 */
	beginEdit(id: string, session: { commit: () => void }): { el: HTMLElement; body: HTMLElement } | null {
		const m = this.mounted.get(id);
		if (!m || this.editing.has(id)) return null;
		this.editing.set(id, session);
		m.el.addClass('is-editing');
		return { el: m.el, body: m.body };
	}

	/** Editing is over: show the module again, rendered from the (possibly updated) source. */
	endEdit(id: string) {
		this.editing.delete(id);
		const m = this.mounted.get(id);
		if (!m || this.unmounting.has(id)) return;
		m.el.removeClass('is-editing');
		m.renderer?.destroy();
		m.renderer = this.createRenderer(m.module, m.body, m.pageId, m.kind);
		this.renderContent(m);
	}

	destroy() {
		if (this.frame) window.cancelAnimationFrame(this.frame);
		this.queue = [];
		for (const [id, m] of this.mounted) this.unmount(id, m);
		for (const s of this.skeletons.values()) s.el.remove();
		this.skeletons.clear();
		this.o.parent.removeChild(this.component);
	}
}

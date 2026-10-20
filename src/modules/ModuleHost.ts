import { Component, TAbstractFile } from 'obsidian';
import { isInheritedId, resolvePage } from '../model/masters';
import { type AnyModule, isKnownModule, type NoteModule, type Page } from '../model/schema';
import type { BoardStore } from '../store/BoardStore';
import { ImageModuleRenderer } from './imageModule';
import { NoteModuleRenderer, TextModuleRenderer } from './noteModule';
import { applyOverflow } from './overflow';
import { applyModuleStyle } from './style';
import { PdfModuleRenderer } from './pdfModule';
import { type ModuleContext, type ModuleRenderer, placeholder } from './types';

/** Fields that change what a module shows. Anything else (position, label, …) is layout only. */
const CONTENT_KEYS: Record<string, readonly string[]> = {
	note: ['file', 'subpath', 'lines', 'includeHeading', 'overflow'],
	pdf: ['file', 'page', 'crop', 'fit', 'rotation', 'invert', 'w', 'h', 'style'],
	text: ['markdown'],
	image: ['file', 'fit'],
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
	selectedModules: ReadonlySet<string> = new Set();

	constructor(private o: ModuleHostOptions) {
		this.ctx = { ...o.ctx, component: this.component };
		o.parent.addChild(this.component);
		const { app } = o.ctx;
		this.component.registerEvent(app.metadataCache.on('changed', (file) => this.sourceChanged(file.path)));
		this.component.registerEvent(app.vault.on('delete', (file) => this.sourceChanged(file.path)));
		this.component.registerEvent(app.vault.on('rename', (file: TAbstractFile, old: string) => this.sourceChanged(old, file.path)));
		this.component.registerEvent(app.vault.on('modify', (file) => o.ctx.pdfDocs.invalidate(file.path)));
		this.component.register(o.ctx.pdfDocs.onInvalidate((path) => this.sourceChanged(path)));
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

	/** After a zoom settles: re-render PDF modules whose canvas no longer matches the zoom. */
	resolutionChanged(pxPerMm: number) {
		for (const m of this.mounted.values()) {
			if (m.renderer instanceof PdfModuleRenderer && m.renderer.wantsResolution(pxPerMm)) this.renderContent(m);
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

	/** Cheap stand-ins for modules when zoomed far out: one box each, no rendering. */
	private syncSkeleton(page: Page, paper: HTMLElement) {
		const key = JSON.stringify(page.modules.map((m) => [m.type, m.x, m.y, m.w, m.h]));
		const existing = this.skeletons.get(page.id);
		if (existing?.key === key && existing.el.parentElement === paper) return;
		existing?.el.remove();
		const el = paper.createDiv({ cls: 'pw-skeletons' });
		for (const m of page.modules) {
			el.createDiv({ cls: `pw-module-skeleton pw-skeleton-${m.type}` }).setCssProps({ '--pw-x': `${m.x}mm`, '--pw-y': `${m.y}mm`, '--pw-w': `${m.w}mm`, '--pw-h': `${m.h}mm` });
		}
		this.skeletons.set(page.id, { el, key });
	}

	private syncPage(page: Page, paper: HTMLElement, live: Set<string>) {
		// Draw order: by z, then array order (SPEC 6).
		const order = page.modules.map((m, i) => ({ m, i })).sort((a, b) => (a.m.z ?? 0) - (b.m.z ?? 0) || a.i - b.i);
		order.forEach(({ m }, rank) => {
			live.add(m.id);
			let mounted = this.mounted.get(m.id);
			if (mounted && mounted.pageId !== page.id) {
				this.unmount(m.id, mounted);
				mounted = undefined;
			}
			const isNew = !mounted;
			if (!mounted) mounted = this.mount(m, page.id, paper);
			this.layout(mounted, m, rank);
			const key = contentKey(m);
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

	private mount(m: AnyModule, pageId: string, paper: HTMLElement): Mounted {
		// Inherited (master) modules get no IDs, so clicks fall through to the page.
		const el = isInheritedId(m.id) ? paper.createDiv({ cls: 'pw-module is-inherited' }) : paper.createDiv({ cls: 'pw-module', attr: { 'data-module-id': m.id, 'data-page-id': pageId } });
		const body = el.createDiv({ cls: `pw-module-body pw-module-${m.type}` });
		const mounted: Mounted = { pageId, el, body, renderer: this.createRenderer(m, body), key: '', module: m };
		this.mounted.set(m.id, mounted);
		return mounted;
	}

	private createRenderer(m: AnyModule, body: HTMLElement): ModuleRenderer | null {
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
		}
	}

	private layout(mounted: Mounted, m: AnyModule, rank: number) {
		const resized = mounted.module.w !== m.w || mounted.module.h !== m.h;
		mounted.el.setCssProps({ '--pw-x': `${m.x}mm`, '--pw-y': `${m.y}mm`, '--pw-w': `${m.w}mm`, '--pw-h': `${m.h}mm`, '--pw-z': String(rank + 1) });
		mounted.el.toggleClass('is-selected', this.selectedModules.has(m.id));
		mounted.el.toggleClass('is-locked', !!m.locked);
		applyModuleStyle(mounted.el, m);
		if (resized && m.type === 'note') this.updateOverflow({ ...mounted, module: m });
	}

	private renderContent(mounted: Mounted) {
		try {
			mounted.renderer?.render(mounted.module);
		} catch (e) {
			placeholder(mounted.body, `Could not render module: ${e instanceof Error ? e.message : String(e)}`);
		}
		if (mounted.module.type === 'note') void mounted.renderer?.rendered().then(() => this.watchOverflow(mounted));
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
		const policy = (m.module as NoteModule).overflow ?? 'clip';
		m.el.toggleClass('is-overflowing', applyOverflow(m.el, m.body, policy));
	}

	/**
	 * Recreate rather than re-render: a renderer may hold state tied to the old source
	 * (e.g. a PDF document the cache just destroyed).
	 */
	private sourceChanged(...paths: string[]) {
		for (const m of this.mounted.values()) {
			const deps = m.renderer?.dependencies();
			if (!deps || !paths.some((p) => deps.has(p))) continue;
			m.renderer?.destroy();
			m.renderer = this.createRenderer(m.module, m.body);
			this.renderContent(m);
		}
	}

	private unmount(id: string, m: Mounted) {
		m.sizeWatch?.disconnect();
		m.renderer?.destroy();
		m.el.remove();
		this.mounted.delete(id);
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

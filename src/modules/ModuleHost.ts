import { Component, TAbstractFile } from 'obsidian';
import { type AnyModule, isKnownModule, type Page } from '../model/schema';
import type { BoardStore } from '../store/BoardStore';
import { ImageModuleRenderer } from './imageModule';
import { NoteModuleRenderer, TextModuleRenderer } from './noteModule';
import { PdfModuleRenderer } from './pdfModule';
import { type ModuleContext, type ModuleRenderer, placeholder } from './types';

/** Fields that change what a module shows. Anything else (position, label, …) is layout only. */
const CONTENT_KEYS: Record<string, readonly string[]> = {
	note: ['file', 'subpath', 'lines', 'includeHeading'],
	pdf: ['file', 'page', 'crop', 'fit', 'rotation', 'w', 'h'],
	text: ['markdown'],
	image: ['file', 'fit'],
};

function contentKey(m: AnyModule): string {
	return JSON.stringify([m.type, ...(CONTENT_KEYS[m.type] ?? []).map((k) => m[k])]);
}

interface Mounted {
	pageId: string;
	el: HTMLElement;
	body: HTMLElement;
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
	private component = new Component();
	private ctx: ModuleContext;
	selectedModule: string | null = null;

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
		const byId = new Map(this.o.store.file.pages.map((p) => [p.id, p]));
		for (const id of this.visible) {
			const page = byId.get(id);
			if (!page) continue;
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
			if (!mounted) mounted = this.mount(m, page.id, paper);
			this.layout(mounted, m, rank);
			const key = contentKey(m);
			if (key !== mounted.key) {
				mounted.key = key;
				mounted.module = m;
				this.renderContent(mounted);
			}
			mounted.module = m;
		});
	}

	private mount(m: AnyModule, pageId: string, paper: HTMLElement): Mounted {
		const el = paper.createDiv({ cls: 'pw-module', attr: { 'data-module-id': m.id, 'data-page-id': pageId } });
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
		mounted.el.setCssProps({ '--pw-x': `${m.x}mm`, '--pw-y': `${m.y}mm`, '--pw-w': `${m.w}mm`, '--pw-h': `${m.h}mm`, '--pw-z': String(rank + 1) });
		mounted.el.toggleClass('is-selected', m.id === this.selectedModule);
		mounted.el.toggleClass('is-locked', !!m.locked);
	}

	private renderContent(mounted: Mounted) {
		try {
			mounted.renderer?.render(mounted.module);
		} catch (e) {
			placeholder(mounted.body, `Could not render module: ${e instanceof Error ? e.message : String(e)}`);
		}
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
		m.renderer?.destroy();
		m.el.remove();
		this.mounted.delete(id);
	}

	destroy() {
		for (const [id, m] of this.mounted) this.unmount(id, m);
		for (const s of this.skeletons.values()) s.el.remove();
		this.skeletons.clear();
		this.o.parent.removeChild(this.component);
	}
}

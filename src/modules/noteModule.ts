import { Component, MarkdownRenderer } from 'obsidian';
import type { AnyModule, NoteModule, TextModule } from '../model/schema';
import { loadNoteContent, noteCssClasses, noteDependencies } from '../sources/markdownSource';
import { snapshotChanged } from '../model/freshness';
import { extractPdfEmbeds, type PdfEmbed } from '../model/pdfEmbeds';
import { releasePdfEmbeds, renderPdfEmbeds } from './pdfEmbed';
import { type ModuleContext, type ModuleRenderer, pickAnother, placeholder, setBadge } from './types';

/** Canvas pixels per displayed pixel for PDF pages in notes on the board. */
const SCREEN_OVERSAMPLE = 2;

/** Renders markdown with Obsidian's renderer; each render gets its own child component for cleanup. */
abstract class MarkdownModule implements ModuleRenderer {
	private child: Component | null = null;
	private generation = 0;
	protected deps = new Set<string>();
	protected done: Promise<void> = Promise.resolve();
	/** What `show` last rendered (see ModuleRenderer.shownMarkdown). */
	private shown: string | undefined;
	/** PDF pages drawn in this render, to redraw them when the zoom changes (see resolutionChanged). */
	private embedSets: { target: HTMLElement; embeds: PdfEmbed[]; sourcePath: string; generation: number }[] = [];
	private embedPxPerMm = 0;

	constructor(protected el: HTMLElement, protected ctx: ModuleContext) {}

	abstract render(m: AnyModule): void;

	dependencies(): ReadonlySet<string> {
		return this.deps;
	}

	rendered(): Promise<void> {
		return this.done;
	}

	shownMarkdown(): string | undefined {
		return this.shown;
	}

	/** Render markdown unless a newer render started meanwhile (renders are async). */
	protected async show(markdown: string, sourcePath: string, generation: number, classes: readonly string[] = []) {
		const target = this.begin(generation, classes);
		if (!target) return;
		this.shown = markdown;
		await this.renderMarkdown(markdown, target, sourcePath, generation);
	}

	/** Obsidian's renderer, except PDF embeds: those are drawn by Patchwork (see model/pdfEmbeds). */
	private async renderMarkdown(markdown: string, target: HTMLElement, sourcePath: string, generation: number) {
		const { markdown: md, embeds } = extractPdfEmbeds(markdown);
		await MarkdownRenderer.render(this.ctx.app, md, target, sourcePath, this.child!);
		if (!embeds.length) return;
		this.embedSets.push({ target, embeds, sourcePath, generation });
		this.embedPxPerMm = this.ctx.resolution?.() ?? 0;
		await this.drawEmbeds(target, embeds, sourcePath, generation);
	}

	private drawEmbeds(target: HTMLElement, embeds: PdfEmbed[], sourcePath: string, generation: number) {
		const { app, pdfDocs, resolution, pdfEmbedsAsVector, bitmaps } = this.ctx;
		// On screen the board's zoom and offsets are fractional, so a page drawn at exactly its shown size
		// is resampled about 1:1 and turns soft; twice the pixels get downsampled cleanly instead.
		const oversample = bitmaps ? SCREEN_OVERSAMPLE : 1;
		const res = resolution ? { resolution: () => resolution() * oversample } : {};
		return renderPdfEmbeds(target, embeds, { app, pdfDocs, ...res, sizeOnly: !!pdfEmbedsAsVector }, sourcePath, () => this.isCurrent(generation));
	}

	/** Same thresholds as PDF modules: redraw when the pages are well under, or far over, what the zoom needs. */
	resolutionChanged(pxPerMm: number) {
		if (!this.embedSets.length || this.ctx.pdfEmbedsAsVector) return;
		if (this.embedPxPerMm >= pxPerMm * 0.7 && this.embedPxPerMm <= pxPerMm * 2.5) return;
		this.embedPxPerMm = pxPerMm;
		for (const s of this.embedSets) void this.drawEmbeds(s.target, s.embeds, s.sourcePath, s.generation);
	}

	/** Render blocks one wrapper each, the same structure FlowLayout measured. */
	protected async showBlocks(blocks: readonly string[], sourcePath: string, generation: number, classes: readonly string[] = []) {
		const target = this.begin(generation, classes);
		if (!target) return;
		for (const b of blocks) await this.renderMarkdown(b, target.createDiv({ cls: 'pw-flow-block' }), sourcePath, generation);
	}

	private begin(generation: number, classes: readonly string[]): HTMLElement | null {
		if (generation !== this.generation) return null;
		this.shown = undefined;
		this.embedSets = [];
		this.clearChild();
		releasePdfEmbeds(this.el);
		const child = new Component();
		this.ctx.component.addChild(child);
		this.child = child;
		this.el.empty();
		// `markdown-preview-view` is what themes and snippets target for reading-view styling; styles.css
		// takes back its padding and scrolling. A note's `cssclasses` go on the same element, like Obsidian does.
		return this.el.createDiv({ cls: ['markdown-rendered', 'markdown-preview-view', 'pw-markdown', ...classes] });
	}

	/** The "Frozen" tag, orange once the live note differs from the snapshot. Screen only. */
	protected async flagFrozen(note: NoteModule, gen: number) {
		const frozen = note.frozen!;
		const live = await loadNoteContent(this.ctx.app, note).catch(() => null);
		if (!this.isCurrent(gen)) return;
		const changed = snapshotChanged(frozen, live?.ok ? live.markdown : null);
		setBadge(this.el, changed ? `Frozen ${frozen.at} · note changed` : `Frozen ${frozen.at}`, changed ? 'warning' : 'info');
	}

	protected nextGeneration() {
		return ++this.generation;
	}

	protected isCurrent(generation: number) {
		return generation === this.generation;
	}

	private clearChild() {
		if (this.child) this.ctx.component.removeChild(this.child);
		this.child = null;
	}

	destroy() {
		this.generation++;
		this.clearChild();
		releasePdfEmbeds(this.el);
		this.el.empty();
	}
}

export class NoteModuleRenderer extends MarkdownModule {
	render(m: AnyModule) {
		const note = m as NoteModule;
		const gen = this.nextGeneration();
		this.deps = noteDependencies(this.ctx.app, note.file);
		if (note.frozen) return void (this.done = this.showFrozen(note, gen));
		this.done = loadNoteContent(this.ctx.app, note)
			.then((content) => {
				if (!this.isCurrent(gen)) return;
				if (!content.ok) return placeholder(this.el, content.reason, content.missingFile ? 'missing' : 'error', pickAnother(this.ctx, note.id));
				return this.show(content.markdown, content.file.path, gen, noteCssClasses(this.ctx.app, content.file.path));
			})
			.catch((e: unknown) => {
				if (this.isCurrent(gen)) placeholder(this.el, `Could not render ${note.file}: ${e instanceof Error ? e.message : String(e)}`);
			});
	}

	/** The snapshot, rendered against the note's path (links resolve as before); flags live changes. */
	private async showFrozen(note: NoteModule, gen: number) {
		await this.show(note.frozen!.markdown, note.file, gen, noteCssClasses(this.ctx.app, note.file));
		await this.flagFrozen(note, gen);
	}
}

export class TextModuleRenderer extends MarkdownModule {
	constructor(el: HTMLElement, ctx: ModuleContext, private boardPath: () => string) {
		super(el, ctx);
	}

	render(m: AnyModule) {
		this.done = this.show((m as TextModule).markdown, this.boardPath(), this.nextGeneration());
	}
}

/**
 * A member of a linked-frame chain (M5): the head note or text, or a frame continuing it. Shows its
 * share of the chain's blocks; the last frame is marked when text is left over.
 */
export class FlowRenderer extends MarkdownModule {
	render(m: AnyModule) {
		const gen = this.nextGeneration();
		const flow = this.ctx.flow;
		const info = flow?.info(m.id);
		if (!flow || !info) return placeholder(this.el, 'This frame isn’t linked to any text.', 'info');
		if (!info.ok) return placeholder(this.el, info.reason, 'info');
		const head = info.chain[0]!.module;
		this.deps = head.type === 'note' ? noteDependencies(this.ctx.app, head.file as string) : new Set();
		const last = info.index === info.chain.length - 1;
		this.done = flow.layout
			.layout(info.chain)
			.then(async (r) => {
				if (!this.isCurrent(gen)) return;
				if ('error' in r) return placeholder(this.el, r.error, 'missing');
				const [start, end] = r.ranges[info.index]!;
				await this.showBlocks(r.blocks.slice(start, end).map((b) => b.text), r.sourcePath, gen, head.type === 'note' ? noteCssClasses(this.ctx.app, head.file as string) : []);
				// Every frame of a frozen note's chain carries the tag, so it shows wherever the text lands.
				if (head.type === 'note' && head.frozen) await this.flagFrozen(head as NoteModule, gen);
				if (this.isCurrent(gen)) this.el.parentElement?.toggleClass('is-overflowing', last && r.leftover);
			})
			.catch((e: unknown) => {
				if (this.isCurrent(gen)) placeholder(this.el, `Could not lay out linked text: ${e instanceof Error ? e.message : String(e)}`);
			});
	}
}

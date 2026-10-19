import { Component, MarkdownRenderer } from 'obsidian';
import type { AnyModule, NoteModule, TextModule } from '../model/schema';
import { loadNoteContent, noteDependencies } from '../sources/markdownSource';
import { type ModuleContext, type ModuleRenderer, placeholder } from './types';

/** Renders markdown with Obsidian's renderer; each render gets its own child component for cleanup. */
abstract class MarkdownModule implements ModuleRenderer {
	private child: Component | null = null;
	private generation = 0;
	protected deps = new Set<string>();

	constructor(protected el: HTMLElement, protected ctx: ModuleContext) {}

	abstract render(m: AnyModule): void;

	dependencies(): ReadonlySet<string> {
		return this.deps;
	}

	/** Render markdown unless a newer render started meanwhile (renders are async). */
	protected async show(markdown: string, sourcePath: string, generation: number) {
		if (generation !== this.generation) return;
		this.clearChild();
		const child = new Component();
		this.ctx.component.addChild(child);
		this.child = child;
		this.el.empty();
		const target = this.el.createDiv({ cls: 'markdown-rendered pw-markdown' });
		await MarkdownRenderer.render(this.ctx.app, markdown, target, sourcePath, child);
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
		this.el.empty();
	}
}

export class NoteModuleRenderer extends MarkdownModule {
	render(m: AnyModule) {
		const note = m as NoteModule;
		const gen = this.nextGeneration();
		this.deps = noteDependencies(this.ctx.app, note.file);
		void loadNoteContent(this.ctx.app, note).then((content) => {
			if (!this.isCurrent(gen)) return;
			if (!content.ok) return placeholder(this.el, content.reason, content.missingFile ? 'missing' : 'error');
			return this.show(content.markdown, content.file.path, gen);
		});
	}
}

export class TextModuleRenderer extends MarkdownModule {
	constructor(el: HTMLElement, ctx: ModuleContext, private boardPath: () => string) {
		super(el, ctx);
	}

	render(m: AnyModule) {
		void this.show((m as TextModule).markdown, this.boardPath(), this.nextGeneration());
	}
}

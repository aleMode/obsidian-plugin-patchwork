import type { App, Component } from 'obsidian';
import type { AnyModule } from '../model/schema';
import type { PdfDocCache } from '../sources/pdfSource';

/** What module renderers need from the plugin. */
export interface ModuleContext {
	app: App;
	pdfDocs: PdfDocCache;
	/** Parent for per-render child components (MarkdownRenderer cleanup, events). */
	component: Component;
}

/** Draws one module's content into its element. Created when the page becomes visible. */
export interface ModuleRenderer {
	/** Called when content-relevant fields change (see `contentKey`). */
	render(m: AnyModule): void;
	/** Paths whose modification should trigger a re-render. */
	dependencies(): ReadonlySet<string>;
	/** Resolves when the latest render has finished (content or placeholder). Export waits on it. */
	rendered(): Promise<void>;
	destroy(): void;
}

export function placeholder(el: HTMLElement, message: string, kind: 'missing' | 'error' | 'info' = 'error') {
	el.empty();
	const box = el.createDiv({ cls: `pw-module-placeholder is-${kind}` });
	box.createDiv({ text: message });
}

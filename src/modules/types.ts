import type { App, Component } from 'obsidian';
import type { AnyModule } from '../model/schema';
import type { BitmapCache } from '../render/bitmapCache';
import type { PdfDocCache } from '../sources/pdfSource';
import type { FlowContext } from './flowLayout';
import type { ThumbnailCache } from '../render/thumbnails';

/** What module renderers need from the plugin. */
export interface ModuleContext {
	app: App;
	pdfDocs: PdfDocCache;
	/** Cache of rendered PDF crops for the screen. Absent when rendering for export. */
	bitmaps?: BitmapCache;
	/** Small previews for zoomed-out pages. Absent when rendering for export. */
	thumbs?: ThumbnailCache;
	/** Parent for per-render child components (MarkdownRenderer cleanup, events). */
	component: Component;
	/** Canvas pixels per mm the current zoom needs on screen. Absent when rendering for export. */
	resolution?: () => number;
	/** Linked text frames (M5). */
	flow?: FlowContext;
	/** Offer to pick another file for a module whose source is missing (board only, not export). */
	replaceSource?: (moduleId: string) => void;
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

export function placeholder(el: HTMLElement, message: string, kind: 'missing' | 'error' | 'info' = 'error', action?: { label: string; run: () => void }) {
	el.empty();
	const box = el.createDiv({ cls: `pw-module-placeholder is-${kind}` });
	box.createDiv({ text: message });
	if (!action) return;
	// Module content ignores the pointer on the board; `pw-interactive` lets this one button through.
	const button = box.createEl('button', { cls: 'pw-interactive pw-placeholder-action', text: action.label });
	button.addEventListener('click', (e) => {
		e.stopPropagation();
		action.run();
	});
}

/** "Pick another…" for a missing source, when the context offers it (SPEC 5.3). */
export function pickAnother(ctx: ModuleContext, moduleId: string): { label: string; run: () => void } | undefined {
	const replace = ctx.replaceSource;
	return replace ? { label: 'Pick another…', run: () => replace(moduleId) } : undefined;
}

/**
 * A small status tag in the module's corner (frozen, source changed). Screen only: the print host
 * hides it. `null` removes it.
 */
export function setBadge(el: HTMLElement, text: string | null, kind: 'info' | 'warning' = 'info') {
	let badge = el.querySelector<HTMLElement>(':scope > .pw-module-badge');
	if (!text) return void badge?.remove();
	if (!badge) badge = el.createDiv({ cls: 'pw-module-badge' });
	badge.setText(text);
	badge.toggleClass('is-warning', kind === 'warning');
}

import type { AnyModule, TocModule } from '../model/schema';
import { DEFAULT_TOC_HEADING, type TocEntry } from '../model/toc';
import type { ModuleRenderer } from './types';

/**
 * Table of contents: a heading and one row per named page, with dot leaders to the page number.
 * Rows carry the target page ID so export can turn them into PDF links.
 */
export class TocModuleRenderer implements ModuleRenderer {
	constructor(private el: HTMLElement, private entries: () => TocEntry[]) {}

	dependencies(): ReadonlySet<string> {
		return new Set();
	}

	rendered(): Promise<void> {
		return Promise.resolve();
	}

	render(m: AnyModule) {
		const heading = (m as TocModule).heading ?? DEFAULT_TOC_HEADING;
		this.el.empty();
		const root = this.el.createDiv({ cls: 'pw-toc' });
		if (heading) root.createDiv({ cls: 'pw-toc-heading', text: heading });
		const entries = this.entries();
		if (!entries.length) root.createDiv({ cls: 'pw-toc-empty', text: 'Name pages (in the inspector) to list them here.' });
		for (const e of entries) {
			const row = root.createDiv({ cls: 'pw-toc-row', attr: { 'data-target-page': e.pageId } });
			row.createSpan({ cls: 'pw-toc-title', text: e.title });
			row.createSpan({ cls: 'pw-toc-leader' });
			row.createSpan({ cls: 'pw-toc-number', text: e.number });
		}
	}

	destroy() {
		this.el.empty();
	}
}

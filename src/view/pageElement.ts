import type { PageFurniture } from '../model/numbering';
import type { Insets, NumberPosition, Page } from '../model/schema';
import { renderFurniture } from './furniture';
import type { Ink } from '../model/contrast';
import { applyInk } from './paperScope';
import { formatLength } from '../model/units';
import type { DisplayUnit } from '../model/schema';

/** DOM for one page. Laid out in CSS mm, so the board layer's transform is the only zoom. */
export class PageElement {
	readonly el: HTMLElement;
	/** Paper area modules mount into. Light-scoped unless the board uses the app theme. */
	readonly paper: HTMLElement;
	/** Name and size, shown by the board's label overlay (kept out of the zoomed layer; see BoardViewport). */
	labelText = '';
	private page: Page | null = null;

	constructor(parent: HTMLElement) {
		this.el = parent.createDiv({ cls: 'pw-page' });
		this.paper = this.el.createDiv({ cls: 'pw-page-paper' });
	}

	update(page: Page, opts: { appTheme: boolean; unit: DisplayUnit; selected: boolean; furniture?: PageFurniture; position: NumberPosition; safeArea?: Insets; ink: Ink; themeInk: Ink }) {
		renderFurniture(this.paper, opts.furniture, opts.position);
		this.renderSafeArea(page.safeArea ?? opts.safeArea);
		this.renderEmptyHint(page.modules.length === 0);
		const prev = this.page;
		this.page = page;
		this.el.dataset.pageId = page.id;
		if (!prev || prev.x !== page.x || prev.y !== page.y || prev.w !== page.w || prev.h !== page.h) {
			this.el.setCssProps({ '--pw-x': `${page.x}mm`, '--pw-y': `${page.y}mm`, '--pw-w': `${page.w}mm`, '--pw-h': `${page.h}mm` });
		}
		this.paper.toggleClass('pw-paper', !opts.appTheme);
		applyInk(this.paper, opts.ink, opts.themeInk, !opts.appTheme);
		this.paper.toggleClass('has-background', !!page.background);
		this.paper.setCssProps({ '--pw-page-bg': page.background ?? '' });
		this.el.toggleClass('is-selected', opts.selected);
		this.el.toggleClass('is-master', !!page.isMaster);
		const name = page.isMaster ? `Master: ${page.name ?? 'untitled'}` : page.name ?? 'Untitled page';
		this.labelText = `${name} · ${formatLength(page.w, opts.unit)} × ${formatLength(page.h, opts.unit)}`;
	}

	/** What to do on a blank page; gone with the first item, never printed (the print host has its own pages). */
	private renderEmptyHint(empty: boolean) {
		const el = this.paper.querySelector(':scope > .pw-empty-hint');
		if (!empty) return el?.remove();
		if (!el) this.paper.createDiv({ cls: 'pw-empty-hint', text: 'Drag a note, PDF or image here, or use Note and PDF on the toolbar' });
	}

	/** Dashed margin guide (SPEC 5.2): on the board only, never printed, never constraining modules. */
	private renderSafeArea(i: Insets | undefined) {
		let el = this.paper.querySelector<HTMLElement>(':scope > .pw-safe-area');
		if (!i || (i.top <= 0 && i.right <= 0 && i.bottom <= 0 && i.left <= 0)) {
			el?.remove();
			return;
		}
		if (!el) el = this.paper.createDiv({ cls: 'pw-safe-area' });
		el.setCssProps({ '--pw-safe-t': `${i.top}mm`, '--pw-safe-r': `${i.right}mm`, '--pw-safe-b': `${i.bottom}mm`, '--pw-safe-l': `${i.left}mm` });
	}

	remove() {
		this.el.remove();
	}
}

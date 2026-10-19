import type { Page } from '../model/schema';
import { formatLength } from '../model/units';
import type { DisplayUnit } from '../model/schema';

/** DOM for one page. Laid out in CSS mm, so the board layer's transform is the only zoom. */
export class PageElement {
	readonly el: HTMLElement;
	/** Paper area modules mount into. Light-scoped unless the board uses the app theme. */
	readonly paper: HTMLElement;
	private label: HTMLElement;
	private page: Page | null = null;

	constructor(parent: HTMLElement) {
		this.el = parent.createDiv({ cls: 'pw-page' });
		this.label = this.el.createDiv({ cls: 'pw-page-label' });
		this.paper = this.el.createDiv({ cls: 'pw-page-paper' });
	}

	update(page: Page, opts: { appTheme: boolean; unit: DisplayUnit; selected: boolean }) {
		const prev = this.page;
		this.page = page;
		this.el.dataset.pageId = page.id;
		if (!prev || prev.x !== page.x || prev.y !== page.y) {
			this.el.style.left = `${page.x}mm`;
			this.el.style.top = `${page.y}mm`;
		}
		if (!prev || prev.w !== page.w || prev.h !== page.h) {
			this.el.style.width = `${page.w}mm`;
			this.el.style.height = `${page.h}mm`;
		}
		this.paper.toggleClass('pw-paper', !opts.appTheme);
		this.paper.toggleClass('theme-light', !opts.appTheme);
		this.paper.style.background = page.background ?? '';
		this.el.toggleClass('is-selected', opts.selected);
		this.label.setText(`${page.name ?? 'Untitled page'} · ${formatLength(page.w, opts.unit)} × ${formatLength(page.h, opts.unit)}`);
	}

	remove() {
		this.el.remove();
	}
}

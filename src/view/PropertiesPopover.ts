import type { App } from 'obsidian';
import type { BoardViewport } from './BoardViewport';
import { PropertiesForm, type PropertiesSection } from './PropertiesForm';

const TABS: Record<'module' | 'page', [PropertiesSection, string][]> = {
	module: [
		['content', 'Content'],
		['layout', 'Layout'],
		['style', 'Style'],
		['advanced', 'Advanced'],
	],
	page: [
		['content', 'Page'],
		['layout', 'Layout'],
		['furniture', 'Numbers'],
	],
};

/**
 * A small floating panel next to the selection with the controls that do not fit on the context bar,
 * a few rows at a time in tabs. It edits the current selection and follows it; the sidebar inspector
 * stays available as a dock.
 */
export class PropertiesPopover {
	private el: HTMLElement;
	private tabsEl: HTMLElement;
	private body: HTMLElement;
	private tab: PropertiesSection = 'content';
	private kind: 'module' | 'page' | null = null;
	private selKey = '';
	private offDoc: (() => void) | null = null;

	constructor(private board: BoardViewport, private host: HTMLElement, private app: App) {
		this.el = host.createDiv({ cls: 'pw-popover is-hidden' });
		this.tabsEl = this.el.createDiv({ cls: 'pw-tabs' });
		this.body = this.el.createDiv({ cls: 'pw-popover-body' });
		// The board listens for pointers, wheel and keys on its root: none of that may reach it from here.
		for (const type of ['pointerdown', 'dblclick', 'contextmenu', 'wheel', 'keydown', 'keyup']) {
			this.el.addEventListener(type, (e) => {
				if (type === 'keydown' && (e as KeyboardEvent).key === 'Escape') {
					this.hide();
					this.board.focusBoard();
				}
				e.stopPropagation();
			});
		}
	}

	get isOpen(): boolean {
		return !this.el.hasClass('is-hidden');
	}

	/** Open for the current selection (a page or one module), on `tab` if it exists there. */
	show(tab?: PropertiesSection) {
		const kind = this.kindOfSelection();
		if (!kind) return this.hide();
		this.kind = kind;
		this.tab = tab && TABS[kind].some(([id]) => id === tab) ? tab : TABS[kind][0]![0];
		this.selKey = this.keyOfSelection();
		this.el.removeClass('is-hidden');
		this.renderTabs();
		this.renderBody();
		this.place();
		// A click anywhere outside (on the board, the toolbar, another window part) closes it.
		const doc = this.host.doc;
		const onDown = (e: PointerEvent) => {
			const t = e.target as Node;
			const el = t.nodeType === 1 ? (t as Element) : t.parentElement;
			if (this.el.contains(t) || el?.closest('.pw-context-bar, .menu, .modal-container, .suggestion-container')) return;
			this.hide();
		};
		// Escape closes it too. A key press goes to whatever has the focus (usually the board or a bar button,
		// not the popover), so listen on the window; an open menu or dialog gets the key first.
		const win = doc.win;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || doc.querySelector('.menu, .modal-container')) return;
			e.preventDefault();
			e.stopPropagation();
			this.hide();
			this.board.focusBoard();
		};
		this.offDoc?.();
		doc.addEventListener('pointerdown', onDown, true);
		win.addEventListener('keydown', onKey, true);
		this.offDoc = () => {
			doc.removeEventListener('pointerdown', onDown, true);
			win.removeEventListener('keydown', onKey, true);
		};
	}

	hide() {
		this.el.addClass('is-hidden');
		this.offDoc?.();
		this.offDoc = null;
	}

	toggle(tab?: PropertiesSection) {
		if (this.isOpen) this.hide();
		else this.show(tab);
	}

	/** The selection or the model changed: follow it, keeping focus while the user types. */
	refresh() {
		if (!this.isOpen) return;
		const kind = this.kindOfSelection();
		if (!kind) return this.hide();
		const key = this.keyOfSelection();
		if (key !== this.selKey || kind !== this.kind) {
			this.kind = kind;
			this.selKey = key;
			if (!TABS[kind].some(([id]) => id === this.tab)) this.tab = TABS[kind][0]![0];
			this.renderTabs();
			this.renderBody();
		} else if (!this.body.contains(this.body.doc.activeElement)) this.renderBody();
		this.place();
	}

	/** Follow the selection while panning and zooming. */
	reposition() {
		if (this.isOpen) this.place();
	}

	destroy() {
		this.offDoc?.();
		this.el.remove();
	}

	private kindOfSelection(): 'module' | 'page' | null {
		const items = this.board.selectedItems;
		if (items.length !== 1 || this.board.boardStore.readOnly) return null;
		return items[0]!.moduleId ? 'module' : 'page';
	}

	private keyOfSelection(): string {
		return this.board.selectedItems.map((it) => `${it.pageId}/${it.moduleId ?? ''}`).join('|');
	}

	private renderTabs() {
		this.tabsEl.empty();
		for (const [id, label] of TABS[this.kind!]) {
			const b = this.tabsEl.createEl('button', { cls: 'pw-tab', text: label });
			b.toggleClass('is-active', id === this.tab);
			b.addEventListener('click', () => {
				this.tab = id;
				this.renderTabs();
				this.renderBody();
			});
		}
	}

	private renderBody() {
		this.body.empty();
		this.body.addClass('pw-popover-form');
		new PropertiesForm(this.app, this.body, () => this.renderBody(), () => `pop:${this.selKey}`, this.tab).renderSelection(this.board);
	}

	/**
	 * Beside the selection so the item stays visible (right, then left); below or above the context bar
	 * when there is no room at the sides; always inside the board.
	 */
	private place() {
		const sel = this.board.selectionScreenRect();
		if (!sel) return;
		const bar = this.board.contextBarRect();
		const host = this.host.getBoundingClientRect();
		const w = this.el.offsetWidth || 320;
		const h = this.el.offsetHeight || 240;
		const gap = 8;
		const top = this.board.topInset + gap;
		const clampX = (x: number) => Math.min(Math.max(gap, x), Math.max(gap, host.width - w - gap));
		const clampY = (y: number) => Math.min(Math.max(top, y), Math.max(top, host.height - h - gap));
		const fitsX = (x: number) => x >= gap && x + w <= host.width - gap;
		let pos: { x: number; y: number };
		if (fitsX(sel.x + sel.w + gap)) pos = { x: sel.x + sel.w + gap, y: clampY(sel.y) };
		else if (fitsX(sel.x - w - gap)) pos = { x: sel.x - w - gap, y: clampY(sel.y) };
		else {
			// The bar sits on the side of the selection that has room: go to the opposite side of the item.
			const barAbove = !!bar && bar.y < sel.y;
			const below = (bar && !barAbove ? bar.y + bar.h : sel.y + sel.h) + gap;
			const above = (bar && barAbove ? bar.y : sel.y) - h - gap;
			pos = { x: clampX(sel.x + sel.w / 2 - w / 2), y: below + h <= host.height - gap ? below : Math.max(top, above) };
		}
		this.el.setCssProps({ '--pw-pop-x': `${Math.round(pos.x)}px`, '--pw-pop-y': `${Math.round(pos.y)}px` });
	}
}

import { type App, setIcon } from 'obsidian';
import type { BoardViewport } from './BoardViewport';
import { OutlineRenderer } from './OutlineRenderer';

/**
 * The outline and saved views as a floating panel at the left edge of the board, so nothing has to
 * live in a sidebar. Closed by default; the choice is remembered on this device.
 */
export class OutlinePanel {
	private el: HTMLElement;
	private body: HTMLElement;
	private outline: OutlineRenderer;
	private frame = 0;

	constructor(private board: BoardViewport, private host: HTMLElement, app: App, private remember: (open: boolean) => void) {
		this.el = host.createDiv({ cls: 'pw-outline-panel is-hidden' });
		const head = this.el.createDiv({ cls: 'pw-outline-panel-head' });
		head.createSpan({ text: 'Outline and views' });
		const close = head.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Close the outline' } });
		setIcon(close, 'x');
		close.addEventListener('click', () => this.close());
		this.body = this.el.createDiv({ cls: 'pw-outline-panel-body' });
		this.outline = new OutlineRenderer(app, this.body, () => this.board);
		// The board listens for pointers, wheel and keys on its root: none of that may reach it from here.
		for (const type of ['pointerdown', 'dblclick', 'contextmenu', 'wheel', 'keydown', 'keyup']) this.el.addEventListener(type, (e) => e.stopPropagation());
	}

	get isOpen(): boolean {
		return !this.el.hasClass('is-hidden');
	}

	open() {
		this.el.removeClass('is-hidden');
		this.place();
		this.outline.render();
		this.remember(true);
	}

	close() {
		this.el.addClass('is-hidden');
		this.remember(false);
	}

	toggle() {
		if (this.isOpen) this.close();
		else this.open();
	}

	/** Below the rulers and the floating toolbar. */
	place() {
		if (this.isOpen) this.el.setCssProps({ '--pw-op-top': `${Math.round(this.board.topInset + 8)}px` });
	}

	/** The patchwork or the selection changed: redraw once per frame (a drag changes it constantly). */
	refresh() {
		if (!this.isOpen || this.frame) return;
		const win = this.host.win;
		this.frame = win.requestAnimationFrame(() => {
			this.frame = 0;
			if (!this.isOpen) return;
			// Don't rebuild the rows under the pointer while it is dragging something.
			if (this.board.isDragging) return;
			// Keep the scroll position and any open field when the list is redrawn.
			const top = this.body.scrollTop;
			this.outline.render();
			this.body.scrollTop = top;
		});
	}

	destroy() {
		if (this.frame) this.host.win.cancelAnimationFrame(this.frame);
		this.el.remove();
	}
}

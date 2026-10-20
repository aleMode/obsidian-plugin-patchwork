import { type App, setIcon } from 'obsidian';
import type { BoardViewport } from './BoardViewport';
import { OutlineRenderer } from './OutlineRenderer';

type Pos = { x: number; y: number };

/** Where the panel was dragged to, remembered per device (storage may be unavailable). */
const POS_KEY = 'patchwork-outline-pos';
const GAP = 28;

function savedPos(): Pos | null {
	try {
		const p = JSON.parse(window.localStorage.getItem(POS_KEY) ?? 'null') as Partial<Pos> | null;
		return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x!, y: p.y! } : null;
	} catch {
		return null;
	}
}

function rememberPos(pos: Pos | null) {
	try {
		if (pos) window.localStorage.setItem(POS_KEY, JSON.stringify(pos));
		else window.localStorage.removeItem(POS_KEY);
	} catch {
		// Not remembered; the panel still works.
	}
}

/**
 * The outline and saved views as a floating panel on the board, so nothing has to live in a sidebar.
 * Closed by default; it is as big as its content needs, can be dragged by its title, and both the
 * on/off choice and its position are remembered on this device.
 */
export class OutlinePanel {
	private el: HTMLElement;
	private body: HTMLElement;
	private outline: OutlineRenderer;
	private frame = 0;
	/** Where the user put it, relative to the board host; null: the default spot at the top left. */
	private pos: Pos | null = savedPos();

	constructor(private board: BoardViewport, private host: HTMLElement, app: App, private remember: (open: boolean) => void) {
		this.el = host.createDiv({ cls: 'pw-outline-panel is-hidden' });
		const head = this.el.createDiv({ cls: 'pw-outline-panel-head', attr: { 'aria-label': 'Drag to move; double-click to put it back' } });
		head.createSpan({ text: 'Outline and views' });
		const close = head.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Close the outline' } });
		setIcon(close, 'x');
		close.addEventListener('click', () => this.close());
		this.body = this.el.createDiv({ cls: 'pw-outline-panel-body' });
		this.outline = new OutlineRenderer(app, this.body, () => this.board);
		// The board listens for pointers, wheel and keys on its root: none of that may reach it from here.
		for (const type of ['pointerdown', 'dblclick', 'contextmenu', 'wheel', 'keydown', 'keyup']) this.el.addEventListener(type, (e) => e.stopPropagation());
		this.bindDrag(head);
		head.addEventListener('dblclick', () => {
			this.pos = null;
			rememberPos(null);
			this.place();
		});
	}

	get isOpen(): boolean {
		return !this.el.hasClass('is-hidden');
	}

	/** The panel's box relative to the board host, or null when it is closed. */
	rect(): { x: number; y: number; w: number; h: number } | null {
		if (!this.isOpen) return null;
		const r = this.el.getBoundingClientRect();
		const h = this.host.getBoundingClientRect();
		return { x: r.left - h.left, y: r.top - h.top, w: r.width, h: r.height };
	}

	open() {
		this.el.removeClass('is-hidden');
		this.outline.render();
		this.place();
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

	/** At its remembered spot, kept inside the board and below the rulers and the floating toolbar. */
	place() {
		if (!this.isOpen) return;
		const host = this.host.getBoundingClientRect();
		const top = this.board.topInset + 8;
		const w = this.el.offsetWidth;
		const h = this.el.offsetHeight;
		const want = this.pos ?? { x: GAP, y: top };
		const x = Math.min(Math.max(8, want.x), Math.max(8, host.width - w - 8));
		const y = Math.min(Math.max(top, want.y), Math.max(top, host.height - h - 8));
		// The room below it bounds its height: it is as tall as its content, up to that.
		this.el.setCssProps({ '--pw-op-x': `${Math.round(x)}px`, '--pw-op-y': `${Math.round(y)}px`, '--pw-op-room': `${Math.max(120, Math.round(host.height - y - 8))}px` });
	}

	/** Move it by its title. */
	private bindDrag(head: HTMLElement) {
		head.addEventListener('pointerdown', (e) => {
			if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
			e.preventDefault();
			const start = { x: e.clientX, y: e.clientY };
			const from = this.rect() ?? { x: GAP, y: 0 };
			head.setPointerCapture(e.pointerId);
			head.addClass('is-dragging');
			const move = (ev: PointerEvent) => {
				this.pos = { x: from.x + ev.clientX - start.x, y: from.y + ev.clientY - start.y };
				this.place();
			};
			const up = (ev: PointerEvent) => {
				head.removeEventListener('pointermove', move);
				head.removeEventListener('pointerup', up);
				head.removeEventListener('pointercancel', up);
				if (head.hasPointerCapture(ev.pointerId)) head.releasePointerCapture(ev.pointerId);
				head.removeClass('is-dragging');
				const r = this.rect();
				if (r) {
					this.pos = { x: r.x, y: r.y };
					rememberPos(this.pos);
				}
			};
			head.addEventListener('pointermove', move);
			head.addEventListener('pointerup', up);
			head.addEventListener('pointercancel', up);
		});
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
			// Keep the scroll position when the list is redrawn; its size may change with the content.
			const top = this.body.scrollTop;
			this.outline.render();
			this.body.scrollTop = top;
			this.place();
		});
	}

	destroy() {
		if (this.frame) this.host.win.cancelAnimationFrame(this.frame);
		this.el.remove();
	}
}

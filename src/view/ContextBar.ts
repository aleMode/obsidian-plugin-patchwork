import { Menu, setIcon, TFile } from 'obsidian';
import { flowChains } from '../model/flow';
import { PAGE_PRESETS, presetFor, swapOrientation } from '../model/presets';
import { type AnyModule, type ImageModule, isKnownModule, type NoteModule, type Page, type PdfModule, type ShapeModule, type TrackerModule, unhandledType } from '../model/schema';
import { DASH_LABELS, isLine, SHAPE_COLORS, STROKE_WIDTHS, strokeOf } from '../model/shapes';
import { findModule, mapModule, mapPage } from '../store/pageOps';
import { isImage } from '../sources/fileKinds';
import { FIT_LABELS, withField, withStyle } from '../ui/formHelpers';
import { FilePickerModal, sectionsOf } from '../ui/pickers';
import { shieldFromBoard } from './shield';
import type { AlignMode } from '../model/align';
import { tintColor, TINT_PRESETS } from '../model/tint';
import type { BoardViewport } from './BoardViewport';

type Rect = { x: number; y: number; w: number; h: number };

/** How close the pointer must stay for the bar to stay open, and how long it may be away before it closes. */
const NEAR_PX = 56;
const COLLAPSE_MS = 350;

/** One control on the bar. `menu` controls open a drop-down under themselves. */
interface Ctl {
	icon?: string;
	text?: string;
	tip: string;
	onClick?: (e: MouseEvent) => void;
	menu?: (m: Menu) => void;
	active?: boolean;
	/** A free-form element (a name field, a colour input) instead of a button. */
	custom?: (parent: HTMLElement) => void;
}

const FITS = Object.entries(FIT_LABELS);

const OVERFLOWS = [
	['clip', 'Clip'],
	['fit', 'Shrink to fit'],
	['grow', 'Grow'],
] as const;

/**
 * The few controls used every time, floating above the selection (SPEC 5.x, interface pass). Everything
 * else is one click away in the properties popover. The bar is rebuilt when the selection or the model
 * changes and only repositioned while the camera moves.
 */
export class ContextBar {
	private el: HTMLElement;
	/** The small "…" shown until the pointer comes near: the bar then opens in its place. */
	private pill: HTMLElement;
	private expanded = false;
	private selKey = '';
	private hasControls = false;
	private collapseTimer: number | null = null;
	private offMove: () => void;

	constructor(
		private board: BoardViewport,
		private host: HTMLElement,
		private alignActions: readonly (readonly [AlignMode, string, string])[],
	) {
		this.el = host.createDiv({ cls: 'pw-context-bar is-hidden' });
		this.pill = host.createEl('button', { cls: 'pw-context-pill is-hidden', attr: { 'aria-label': 'Actions for the selection' } });
		setIcon(this.pill, 'more-horizontal');
		shieldFromBoard(this.el);
		shieldFromBoard(this.pill);
		// Hovering (or clicking, or tabbing to) the pill opens the bar.
		this.pill.addEventListener('pointerenter', () => this.expand());
		this.pill.addEventListener('click', () => this.expand());
		this.pill.addEventListener('focus', () => this.expand());
		const doc = host.doc;
		const onMove = (e: PointerEvent) => this.pointerMoved(e);
		doc.addEventListener('pointermove', onMove);
		this.offMove = () => doc.removeEventListener('pointermove', onMove);
	}

	/** The visible part (bar or pill) in pixels relative to the board host; null when nothing is shown. */
	get rect(): Rect | null {
		const el = this.expanded ? this.el : this.pill;
		if (el.hasClass('is-hidden')) return null;
		const r = el.getBoundingClientRect();
		const h = this.host.getBoundingClientRect();
		return { x: r.left - h.left, y: r.top - h.top, w: r.width, h: r.height };
	}

	destroy() {
		this.offMove();
		if (this.collapseTimer !== null) window.clearTimeout(this.collapseTimer);
		this.el.remove();
		this.pill.remove();
	}

	/** Open the bar in place of the pill. */
	expand() {
		if (this.collapseTimer !== null) {
			window.clearTimeout(this.collapseTimer);
			this.collapseTimer = null;
		}
		if (this.expanded || this.pill.hasClass('is-hidden')) return;
		this.expanded = true;
		this.build();
		this.show();
	}

	private collapse() {
		this.collapseTimer = null;
		if (!this.expanded || this.keepOpen()) return;
		this.expanded = false;
		this.build();
		this.show();
	}

	/** Stay open while something on the bar is in use: a menu, a focused field, the properties popover. */
	private keepOpen(): boolean {
		const doc = this.host.doc;
		return !!doc.querySelector('.menu') || (this.el.contains(doc.activeElement) && !!doc.activeElement?.instanceOf(HTMLInputElement)) || this.board.propertiesOpen;
	}

	/** Close again once the pointer has been away from the bar for a moment. */
	private pointerMoved(e: PointerEvent) {
		if (!this.expanded || this.el.hasClass('is-hidden')) return;
		const r = this.el.getBoundingClientRect();
		const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
		const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
		if (Math.hypot(dx, dy) <= NEAR_PX || this.keepOpen()) {
			if (this.collapseTimer !== null) {
				window.clearTimeout(this.collapseTimer);
				this.collapseTimer = null;
			}
		} else if (this.collapseTimer === null) this.collapseTimer = window.setTimeout(() => this.collapse(), COLLAPSE_MS);
	}

	/** Show the bar or the pill, whichever applies, and put it in place. */
	private show() {
		this.el.toggleClass('is-hidden', !this.expanded || !this.hasControls);
		this.pill.toggleClass('is-hidden', this.expanded || !this.hasControls);
		this.reposition();
	}

	/** Rebuild for the current selection. */
	refresh() {
		// Typing in the name field is a model change too: keep the field (and the caret) as it is.
		if (this.el.contains(this.el.doc.activeElement) && !!this.el.doc.activeElement?.instanceOf(HTMLInputElement)) return this.reposition();
		this.hasControls = !this.board.boardStore.readOnly && this.selectionExists();
		// A different selection starts collapsed again.
		const key = this.board.selectedItems.map((it) => `${it.pageId}/${it.moduleId ?? ''}`).join('|');
		if (key !== this.selKey) {
			this.selKey = key;
			this.expanded = false;
		}
		this.build();
		this.show();
	}

	/** Every selection that still exists gets controls (at least "More settings"). */
	private selectionExists(): boolean {
		const items = this.board.selectedItems;
		if (items.length !== 1) return items.length > 1;
		const it = items[0]!;
		const file = this.board.boardStore.file;
		return it.moduleId ? !!findModule(file, it.pageId, it.moduleId) : file.pages.some((p) => p.id === it.pageId);
	}

	/**
	 * Controls exist only while the bar is open. Collapsed it is just the pill, and the model changes on
	 * every frame of a drag: rebuilding hidden buttons then was wasted work and garbage.
	 */
	private build() {
		this.el.empty();
		if (this.expanded && this.hasControls) for (const c of this.controls()) this.render(c);
	}

	/** Above the selection, or below it when there is no room; inside the visible board. */
	reposition() {
		const shown = this.expanded ? this.el : this.pill;
		if (shown.hasClass('is-hidden')) return;
		const sel = this.board.selectionScreenRect();
		const host = this.host.getBoundingClientRect();
		if (!sel) return shown.addClass('is-hidden');
		const w = shown.offsetWidth;
		const h = shown.offsetHeight;
		const gap = 10;
		const top = this.board.topInset;
		// Work with the part of the selection that is on screen, so the bar stays reachable for big pages.
		const vx0 = Math.max(sel.x, 0);
		const vx1 = Math.min(sel.x + sel.w, host.width);
		const vy0 = Math.max(sel.y, top);
		const vy1 = Math.min(sel.y + sel.h, host.height);
		if (vx1 <= vx0 || vy1 <= vy0) return shown.addClass('pw-offscreen');
		shown.removeClass('pw-offscreen');
		let y = vy0 - h - gap;
		if (y < top) y = vy1 + gap;
		if (y + h > host.height - gap) y = Math.max(top, vy0 + gap);
		let x = (vx0 + vx1) / 2 - w / 2;
		x = Math.min(Math.max(gap, x), Math.max(gap, host.width - w - gap));
		shown.setCssProps({ '--pw-cb-x': `${Math.round(x)}px`, '--pw-cb-y': `${Math.round(y)}px` });
	}

	private render(c: Ctl) {
		if (c.custom) {
			c.custom(this.el);
			return;
		}
		const b = this.el.createEl('button', { cls: 'pw-cb-btn', attr: { 'aria-label': c.tip } });
		b.toggleClass('is-active', !!c.active);
		if (c.icon) setIcon(b.createSpan({ cls: 'pw-tb-icon' }), c.icon);
		if (c.text) b.createSpan({ text: c.text });
		if (c.menu) b.createSpan({ cls: 'pw-cb-caret', text: '▾' });
		b.addEventListener('click', (e) => {
			if (c.menu) {
				const m = new Menu();
				c.menu(m);
				const r = b.getBoundingClientRect();
				m.showAtPosition({ x: r.left, y: r.bottom + 2 });
			} else c.onClick?.(e);
		});
	}

	// ---------- what each selection gets ----------

	private controls(): Ctl[] {
		const items = this.board.selectedItems;
		if (items.length === 0) return [];
		if (items.length > 1) return this.group();
		const file = this.board.boardStore.file;
		const it = items[0]!;
		const page = file.pages.find((p) => p.id === it.pageId);
		if (!page) return [];
		if (!it.moduleId) return this.page(page);
		const m = page.modules.find((x) => x.id === it.moduleId);
		// A shape has its own colours; the card colour of other modules means nothing to it.
		return m ? [...this.module(page, m), ...(m.type === 'shape' ? [] : [this.tint(page, m)]), this.more()] : [];
	}

	/** Canvas's colour palette: a tinted card. Custom colours are picked in the Style tab. */
	private tint(page: Page, m: AnyModule): Ctl {
		const current = m.style?.tint;
		return {
			icon: 'palette',
			tip: 'Colour',
			menu: (menu) => {
				menu.addItem((i) => i.setTitle('No colour').setChecked(!current).onClick(() => this.setStyle(page, m, 'tint', undefined)));
				for (const t of TINT_PRESETS) menu.addItem((i) => i.setTitle(swatch(t.name, tintColor(t.id)!)).setChecked(current === t.id).onClick(() => this.setStyle(page, m, 'tint', t.id)));
				menu.addItem((i) => i.setTitle('Custom colour…').setChecked(!!current && !TINT_PRESETS.some((t) => t.id === current)).onClick(() => this.board.showProperties('style')));
			},
		};
	}

	private more(): Ctl {
		return { icon: 'more-horizontal', tip: 'More settings for this item', onClick: () => this.board.showProperties() };
	}

	private set(page: Page, m: AnyModule, fn: (x: AnyModule) => AnyModule) {
		this.board.boardStore.update((f) => mapModule(f, page.id, m.id, fn));
		this.board.boardStore.endCoalesce();
	}

	private module(page: Page, m: AnyModule): Ctl[] {
		// A type from a newer version gets no controls; every known type must have its own case.
		if (!isKnownModule(m)) return [];
		switch (m.type) {
			case 'note':
				return this.note(page, m);
			case 'pdf':
				return this.pdf(page, m);
			case 'text':
				return this.textBox(page, m);
			case 'image':
				return this.image(page, m);
			case 'frame':
				return this.frame(page, m);
			case 'tracker':
				return this.tracker(page, m);
			case 'shape':
				return this.shape(page, m);
			case 'toc':
				return [{ icon: 'heading', text: 'Heading', tip: 'Change the heading of the table of contents', onClick: () => this.board.showProperties('content') }];
			default:
				return unhandledType(m);
		}
	}

	private note(page: Page, m: NoteModule): Ctl[] {
		const app = this.board.app;
		const file = app.vault.getAbstractFileByPath(m.file);
		const sections = file instanceof TFile ? sectionsOf(app, file).filter((s) => s.subpath) : [];
		const current = sections.find((s) => s.subpath === m.subpath)?.label ?? (m.subpath ? m.subpath : 'Whole note');
		const policy = m.overflow ?? 'clip';
		return [
			{
				icon: 'list-tree',
				text: current,
				tip: 'Which part of the note to show',
				menu: (menu) => {
					menu.addItem((i) => i.setTitle('Whole note').setChecked(!m.subpath).onClick(() => this.set(page, m, (x) => withField(x, 'subpath', undefined))));
					for (const s of sections) menu.addItem((i) => i.setTitle(`${' '.repeat(Math.max(0, s.level - 1))}${s.label}`).setChecked(s.subpath === m.subpath).onClick(() => this.set(page, m, (x) => withField(x, 'subpath', s.subpath))));
				},
			},
			{
				icon: 'wrap-text',
				text: OVERFLOWS.find(([id]) => id === policy)![1],
				tip: 'When the text does not fit the box',
				menu: (menu) => {
					for (const [id, label] of OVERFLOWS) menu.addItem((i) => i.setTitle(label).setChecked(policy === id).onClick(() => this.set(page, m, (x) => withField(x, 'overflow', id === 'clip' ? undefined : id))));
				},
			},
			m.frozen
				? { icon: 'flame', text: 'Unfreeze', tip: 'Show the live note again', onClick: () => this.board.unfreezeNote(page.id, m.id) }
				: { icon: 'snowflake', text: 'Freeze text', tip: 'Keep showing the note as it is now (snapshot)', onClick: () => void this.board.freezeNote(page.id, m.id) },
			{ icon: 'pencil', text: 'Edit', tip: 'Edit the shown part of the note where it is (double-click or Enter)', onClick: () => this.board.editInline(page.id, m.id) },
			{ icon: 'fold-vertical', text: 'Fit', tip: 'Fit box to text: make the box as tall as the text needs', onClick: () => void this.board.fitBoxToText(page.id, m.id) },
			{ icon: 'external-link', text: 'Open', tip: 'Open the note in a pane', onClick: () => this.board.openNote(page.id, m.id) },
		];
	}

	private pdf(page: Page, m: PdfModule): Ctl[] {
		const fit = typeof m.fit === 'string' ? m.fit : 'contain';
		const step = async (d: number) => {
			const count = await this.board.pdfPageCount(m.file);
			const next = Math.min(Math.max(1, m.page + d), count ?? Number.MAX_SAFE_INTEGER);
			if (next !== m.page) this.set(page, m, (x) => ({ ...x, page: next }));
		};
		return [
			{ icon: 'crop', text: 'Crop', tip: 'Choose the region of the page', onClick: () => this.board.editCrop(page.id, m.id) },
			{ icon: 'chevron-left', tip: 'Previous PDF page', onClick: () => void step(-1) },
			{ text: `p. ${m.page}`, tip: 'PDF page', onClick: () => this.board.showProperties('content') },
			{ icon: 'chevron-right', tip: 'Next PDF page', onClick: () => void step(1) },
			{
				icon: 'scaling',
				text: FITS.find(([id]) => id === fit)![1].split(' ')[0],
				tip: 'How the region fills its box',
				menu: (menu) => {
					for (const [id, label] of FITS) menu.addItem((i) => i.setTitle(label).setChecked(fit === id).onClick(() => this.set(page, m, (x) => withField(x, 'fit', id === 'contain' ? undefined : id))));
				},
			},
			{ icon: 'contrast', tip: 'Invert colours (for dark-background pages)', active: !!m.invert, onClick: () => this.set(page, m, (x) => withField(x, 'invert', m.invert ? undefined : true)) },
		];
	}

	private setStyle(page: Page, m: AnyModule, key: string, value: unknown) {
		this.set(page, m, (x) => withStyle(x, key, value));
	}

	private textBox(page: Page, m: AnyModule): Ctl[] {
		const s = m.style ?? {};
		const aligns = [
			['', 'Default', 'align-left'],
			['left', 'Left', 'align-left'],
			['center', 'Centre', 'align-center'],
			['right', 'Right', 'align-right'],
			['justify', 'Justify', 'align-justify'],
		] as const;
		const size = (d: number) => {
			const next = Math.round(Math.min(4, Math.max(0.3, (s.fontScale ?? 1) + d)) * 100) / 100;
			this.setStyle(page, m, 'fontScale', Math.abs(next - 1) < 0.001 ? undefined : next);
		};
		return [
			{ icon: 'pencil', text: 'Edit', tip: 'Edit the text where it is (double-click or Enter)', onClick: () => this.board.editInline(page.id, m.id) },
			{ icon: 'fold-vertical', text: 'Fit', tip: 'Fit box to text: make the box as tall as the text needs', onClick: () => void this.board.fitBoxToText(page.id, m.id) },
			{
				icon: aligns.find(([id]) => id === (s.align ?? ''))![2],
				tip: 'Alignment',
				menu: (menu) => {
					for (const [id, label, icon] of aligns) menu.addItem((i) => i.setTitle(label).setIcon(icon).setChecked((s.align ?? '') === id).onClick(() => this.setStyle(page, m, 'align', id === '' ? undefined : id)));
				},
			},
			{
				tip: 'Text colour',
				custom: (p) => {
					const input = p.createEl('input', { cls: 'pw-cb-color', type: 'color', attr: { 'aria-label': 'Text colour' } });
					input.value = s.color ?? '#222222';
					input.addEventListener('change', () => this.setStyle(page, m, 'color', input.value));
				},
			},
			{ text: 'A−', tip: 'Smaller text', onClick: () => size(-0.1) },
			{ text: 'A+', tip: 'Larger text', onClick: () => size(0.1) },
		];
	}

	private image(page: Page, m: ImageModule): Ctl[] {
		const fit = typeof m.fit === 'string' ? m.fit : 'contain';
		return [
			{
				icon: 'image',
				text: 'Change',
				tip: 'Pick another image',
				onClick: () =>
					new FilePickerModal(this.board.app, this.board.app.vault.getFiles().filter(isImage), 'Pick an image', (f) => this.set(page, m, (x) => ({ ...x, file: f.path }))).open(),
			},
			{
				icon: 'scaling',
				text: FITS.find(([id]) => id === fit)![1].split(' ')[0],
				tip: 'How the image fills its box',
				menu: (menu) => {
					for (const [id, label] of FITS) menu.addItem((i) => i.setTitle(label).setChecked(fit === id).onClick(() => this.set(page, m, (x) => withField(x, 'fit', id === 'contain' ? undefined : id))));
				},
			},
		];
	}

	private frame(page: Page, m: AnyModule): Ctl[] {
		const info = flowChains(this.board.boardStore.file).get(m.id);
		const label = info?.ok ? `Frame ${info.index + 1} of ${info.chain.length}` : 'Frame';
		const fromNote = info?.ok && info.chain[0]!.module.type === 'note';
		return [
			{ text: label, tip: 'Position in the chain of linked frames', custom: (p) => p.createSpan({ cls: 'pw-cb-label', text: label }) },
			{ icon: 'pencil', text: 'Edit', tip: 'Edit the text this frame shows where it is (double-click or Enter)', onClick: () => this.board.editInline(page.id, m.id) },
			...(fromNote ? [{ icon: 'external-link', text: 'Open', tip: 'Open the note in a pane', onClick: () => this.board.openNote(page.id, m.id) }] : []),
			{ icon: 'plus', text: 'Next frame', tip: 'Continue the text in another frame on this page', onClick: () => this.board.continueInFrame(page.id, m.id) },
		];
	}

	private shape(page: Page, m: ShapeModule): Ctl[] {
		const stroke = strokeOf(m);
		const line = isLine(m);
		const patch = (fn: (x: ShapeModule) => ShapeModule) => this.set(page, m, (x) => fn(x as ShapeModule));
		const colors = (current: string | undefined, none: string | null, pick: (hex: string | undefined) => void) => (menu: Menu) => {
			if (none) menu.addItem((i) => i.setTitle(none).setChecked(!current).onClick(() => pick(undefined)));
			for (const [name, hex] of SHAPE_COLORS) menu.addItem((i) => i.setTitle(swatch(name, hex)).setChecked(current?.toLowerCase() === hex).onClick(() => pick(hex)));
			menu.addItem((i) => i.setTitle('Other colour…').onClick(() => this.board.showProperties('content')));
		};
		const setStroke = (key: string, value: unknown) => patch((x) => withField(x, 'stroke', { ...(x.stroke ?? {}), [key]: value }));
		const heads = [
			['Line', undefined, undefined],
			['Arrow at the end', undefined, 'arrow'],
			['Arrow at the start', 'arrow', undefined],
			['Arrow at both ends', 'arrow', 'arrow'],
		] as const;
		const current = heads.find(([, a, b]) => (m.startHead === 'none' ? undefined : m.startHead) === a && (m.endHead === 'none' ? undefined : m.endHead) === b);
		const out: Ctl[] = [];
		if (line) {
			out.push({
				icon: 'arrow-up-right',
				text: current?.[0] ?? 'Custom ends',
				tip: 'Arrowheads (more kinds in the settings)',
				menu: (menu) => {
					for (const [label, start, end] of heads) menu.addItem((i) => i.setTitle(label).setChecked(current?.[0] === label).onClick(() => patch((x) => withField(withField(x, 'startHead', start), 'endHead', end))));
				},
			});
		} else {
			out.push({ icon: 'paint-bucket', tip: 'Fill colour', menu: colors(m.fill, 'No fill', (hex) => patch((x) => withField(x, 'fill', hex))) });
		}
		out.push(
			{ icon: 'pen-line', tip: line ? 'Line colour' : 'Outline colour', menu: colors(stroke.color, null, (hex) => setStroke('color', hex)) },
			{
				icon: 'minus',
				text: STROKE_WIDTHS.find(([, mm]) => mm === stroke.width)?.[0] ?? `${stroke.width} mm`,
				tip: 'Line thickness',
				menu: (menu) => {
					if (!line) menu.addItem((i) => i.setTitle('No outline').setChecked(stroke.width === 0).onClick(() => setStroke('width', 0)));
					for (const [name, mm] of STROKE_WIDTHS) menu.addItem((i) => i.setTitle(name).setChecked(stroke.width === mm).onClick(() => setStroke('width', mm)));
				},
			},
			{
				icon: 'ellipsis',
				tip: 'Solid, dashed or dotted',
				menu: (menu) => {
					for (const [id, label] of Object.entries(DASH_LABELS)) menu.addItem((i) => i.setTitle(label).setChecked(stroke.dash === id).onClick(() => setStroke('dash', id === 'solid' ? undefined : id)));
				},
			},
		);
		if (m.shape === 'rect') {
			const corners = [['Square corners', 0], ['Rounded', 4], ['Very rounded', 10]] as const;
			out.push({
				icon: 'square-dashed',
				tip: 'Corners',
				menu: (menu) => {
					for (const [label, mm] of corners) menu.addItem((i) => i.setTitle(label).setChecked((m.radius ?? 0) === mm).onClick(() => patch((x) => withField(x, 'radius', mm > 0 ? mm : undefined))));
				},
			});
		}
		return out;
	}

	private tracker(page: Page, m: TrackerModule): Ctl[] {
		const kinds = [
			['counter', 'Counter'],
			['boxes', 'Boxes'],
			['checklist', 'Checklist'],
		] as const;
		return [
			{
				icon: 'list-checks',
				text: kinds.find(([id]) => id === m.kind)![1],
				tip: 'What kind of tracker',
				menu: (menu) => {
					for (const [id, label] of kinds) menu.addItem((i) => i.setTitle(label).setChecked(m.kind === id).onClick(() => this.set(page, m, (x) => ({ ...x, kind: id }))));
				},
			},
			{ icon: 'pencil', text: 'Edit', tip: 'Label, limits and items', onClick: () => this.board.showProperties('content') },
			{ icon: 'printer', tip: 'Print it blank, to fill in by hand', active: !!m.printBlank, onClick: () => this.set(page, m, (x) => withField(x, 'printBlank', m.printBlank ? undefined : true)) },
		];
	}

	private page(page: Page): Ctl[] {
		const file = this.board.boardStore.file;
		const landscape = page.w > page.h;
		const match = presetFor(page);
		const setPage = (fn: (p: Page) => Page) => {
			this.board.boardStore.update((f) => mapPage(f, page.id, fn));
			this.board.boardStore.endCoalesce();
		};
		const masters = file.pages.filter((p) => p.isMaster && p.id !== page.id);
		const out: Ctl[] = [
			{
				tip: 'Page name (used for bookmarks and the table of contents)',
				custom: (p) => {
					const input = p.createEl('input', { cls: 'pw-cb-name', type: 'text', attr: { placeholder: 'Page name', 'aria-label': 'Page name' } });
					input.value = page.name ?? '';
					input.addEventListener('change', () => setPage((x) => withField(x, 'name', input.value === '' ? undefined : input.value)));
					input.addEventListener('keydown', (e) => {
						if (e.key === 'Enter') input.blur();
					});
				},
			},
			{
				icon: 'ruler',
				text: match ? match.name : 'Custom',
				tip: 'Page size',
				menu: (menu) => {
					for (const pr of PAGE_PRESETS) {
						const size = landscape && pr.w !== pr.h ? swapOrientation(pr) : pr;
						menu.addItem((i) => i.setTitle(pr.name).setChecked(match?.id === pr.id).onClick(() => setPage((p) => ({ ...p, w: size.w, h: size.h }))));
					}
				},
			},
			{ icon: 'rotate-cw', tip: landscape ? 'Make portrait' : 'Make landscape', onClick: () => setPage((p) => swapOrientation(p)) },
			{
				tip: 'Background colour',
				custom: (p) => {
					const input = p.createEl('input', { cls: 'pw-cb-color', type: 'color', attr: { 'aria-label': 'Background colour' } });
					input.value = page.background ?? '#ffffff';
					input.addEventListener('change', () => setPage((x) => withField(x, 'background', input.value)));
				},
			},
		];
		if (page.isMaster) out.push({ text: 'Master page', tip: 'This page is a master; other pages can use it', custom: (p) => p.createSpan({ cls: 'pw-cb-label', text: 'Master' }) });
		else if (masters.length || page.master) {
			const current = masters.find((p) => p.id === page.master);
			out.push({
				icon: 'layout-template',
				text: current ? current.name ?? 'Master' : 'No master',
				tip: 'Master page: header, footer and shared items',
				menu: (menu) => {
					menu.addItem((i) => i.setTitle('No master').setChecked(!page.master).onClick(() => setPage((p) => withField(p, 'master', undefined))));
					for (const mp of masters) menu.addItem((i) => i.setTitle(mp.name ?? 'Master').setChecked(page.master === mp.id).onClick(() => setPage((p) => withField(p, 'master', mp.id))));
				},
			});
		}
		out.push(this.more());
		return out;
	}

	private group(): Ctl[] {
		const items = this.board.selectedItems;
		const modules = !!items[0]?.moduleId;
		const out: Ctl[] = [
			{
				icon: 'align-start-vertical',
				text: 'Align',
				tip: 'Align the selected items',
				menu: (menu) => {
					for (const [mode, title, icon] of this.alignActions) menu.addItem((i) => i.setTitle(title).setIcon(icon).onClick(() => this.board.align(mode)));
				},
			},
			{
				icon: 'align-horizontal-distribute-center',
				text: 'Distribute',
				tip: items.length < 3 ? 'Distribute needs three or more items' : 'Equal gaps between the items',
				menu: (menu) => {
					menu.addItem((i) => i.setTitle('Horizontally').setDisabled(items.length < 3).onClick(() => this.board.distribute('h')));
					menu.addItem((i) => i.setTitle('Vertically').setDisabled(items.length < 3).onClick(() => this.board.distribute('v')));
				},
			},
		];
		if (modules) out.push({ icon: 'lock', text: 'Lock', tip: 'Lock or unlock the selected items', onClick: () => this.board.toggleLock() });
		out.push({ icon: 'trash-2', tip: `Delete ${items.length} items`, onClick: () => this.board.deleteSelection() });
		return out;
	}
}

/** A menu title with a colour dot in front of it. */
function swatch(name: string, color: string): DocumentFragment {
	const frag = createFragment();
	frag.createSpan({ cls: 'pw-swatch' }).setCssProps({ '--pw-swatch': color });
	frag.appendText(name);
	return frag;
}

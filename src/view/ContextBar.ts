import { Menu, setIcon, TFile } from 'obsidian';
import { flowChains } from '../model/flow';
import { PAGE_PRESETS, swapOrientation } from '../model/presets';
import type { AnyModule, ImageModule, NoteModule, Page, PdfModule, TrackerModule } from '../model/schema';
import { mapModule, mapPage } from '../store/pageOps';
import { withField } from '../ui/formHelpers';
import { FilePickerModal, sectionsOf } from '../ui/pickers';
import type { AlignMode } from '../model/align';
import type { BoardViewport } from './BoardViewport';

type Rect = { x: number; y: number; w: number; h: number };

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

const FITS = [
	['contain', 'Contain'],
	['cover', 'Cover (crop to fill)'],
	['stretch', 'Stretch'],
] as const;

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

	constructor(
		private board: BoardViewport,
		private host: HTMLElement,
		private alignActions: readonly (readonly [AlignMode, string, string])[],
	) {
		this.el = host.createDiv({ cls: 'pw-context-bar is-hidden' });
		// The board listens for pointers, wheel and keys on its root: none of that may reach it from here.
		for (const type of ['pointerdown', 'dblclick', 'contextmenu', 'wheel', 'keydown', 'keyup']) this.el.addEventListener(type, (e) => e.stopPropagation());
	}

	get rect(): Rect | null {
		if (this.el.hasClass('is-hidden')) return null;
		const r = this.el.getBoundingClientRect();
		const h = this.host.getBoundingClientRect();
		return { x: r.left - h.left, y: r.top - h.top, w: r.width, h: r.height };
	}

	destroy() {
		this.el.remove();
	}

	/** Rebuild for the current selection. */
	refresh() {
		// Typing in the name field is a model change too: keep the field (and the caret) as it is.
		if (this.el.contains(this.el.doc.activeElement) && this.el.doc.activeElement instanceof HTMLInputElement) return this.reposition();
		const controls = this.controls();
		this.el.empty();
		if (!controls.length || this.board.boardStore.readOnly) {
			this.el.addClass('is-hidden');
			return;
		}
		for (const c of controls) this.render(c);
		this.el.removeClass('is-hidden');
		this.reposition();
	}

	/** Above the selection, or below it when there is no room; inside the visible board. */
	reposition() {
		if (this.el.hasClass('is-hidden')) return;
		const sel = this.board.selectionScreenRect();
		const host = this.host.getBoundingClientRect();
		if (!sel) return this.el.addClass('is-hidden');
		const w = this.el.offsetWidth;
		const h = this.el.offsetHeight;
		const gap = 10;
		const top = this.board.topInset;
		// Work with the part of the selection that is on screen, so the bar stays reachable for big pages.
		const vx0 = Math.max(sel.x, 0);
		const vx1 = Math.min(sel.x + sel.w, host.width);
		const vy0 = Math.max(sel.y, top);
		const vy1 = Math.min(sel.y + sel.h, host.height);
		if (vx1 <= vx0 || vy1 <= vy0) return this.el.addClass('pw-offscreen');
		this.el.removeClass('pw-offscreen');
		let y = vy0 - h - gap;
		if (y < top) y = vy1 + gap;
		if (y + h > host.height - gap) y = Math.max(top, vy0 + gap);
		let x = (vx0 + vx1) / 2 - w / 2;
		x = Math.min(Math.max(gap, x), Math.max(gap, host.width - w - gap));
		this.el.setCssProps({ '--pw-cb-x': `${Math.round(x)}px`, '--pw-cb-y': `${Math.round(y)}px` });
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
		return m ? [...this.module(page, m), this.more()] : [];
	}

	private more(): Ctl {
		return { icon: 'more-horizontal', tip: 'More settings for this item', onClick: () => this.board.showProperties() };
	}

	private set(page: Page, m: AnyModule, fn: (x: AnyModule) => AnyModule) {
		this.board.boardStore.update((f) => mapModule(f, page.id, m.id, fn));
		this.board.boardStore.endCoalesce();
	}

	private module(page: Page, m: AnyModule): Ctl[] {
		switch (m.type) {
			case 'note':
				return this.note(page, m as NoteModule);
			case 'pdf':
				return this.pdf(page, m as PdfModule);
			case 'text':
				return [{ icon: 'pencil', text: 'Edit', tip: 'Edit the text', onClick: () => this.board.showProperties('content') }];
			case 'image':
				return this.image(page, m as ImageModule);
			case 'frame':
				return this.frame(page, m);
			case 'tracker':
				return this.tracker(page, m as TrackerModule);
			case 'toc':
				return [{ icon: 'heading', text: 'Heading', tip: 'Change the heading of the table of contents', onClick: () => this.board.showProperties('content') }];
			default:
				return [];
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
				: { icon: 'snowflake', text: 'Freeze', tip: 'Keep showing the note as it is now (snapshot)', onClick: () => void this.board.freezeNote(page.id, m.id) },
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

	private image(page: Page, m: ImageModule): Ctl[] {
		const fit = typeof m.fit === 'string' ? m.fit : 'contain';
		return [
			{
				icon: 'image',
				text: 'Change',
				tip: 'Pick another image',
				onClick: () =>
					new FilePickerModal(this.board.app, this.board.app.vault.getFiles().filter((f) => /^(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f.extension)), 'Pick an image', (f) => this.set(page, m, (x) => ({ ...x, file: f.path }))).open(),
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
		return [
			{ text: label, tip: 'Position in the chain of linked frames', custom: (p) => p.createSpan({ cls: 'pw-cb-label', text: label }) },
			{ icon: 'plus', text: 'Next frame', tip: 'Continue the text in another frame on the next page', onClick: () => this.board.continueInFrame(page.id, m.id) },
		];
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
		const match = PAGE_PRESETS.find((pr) => (landscape ? pr.h === page.w && pr.w === page.h : pr.w === page.w && pr.h === page.h));
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

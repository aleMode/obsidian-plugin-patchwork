import { ItemView, setIcon, Setting, TFile, WorkspaceLeaf } from 'obsidian';
import { pagesUsing } from '../model/masters';
import { PAGE_PRESETS, swapOrientation } from '../model/presets';
import type { AnyModule, BoardSettings, DisplayUnit, ImageModule, Insets, ModuleStyle, NoteModule, NumberFormat, NumberPosition, Page, PatchworkFile, PdfModule, TextModule } from '../model/schema';
import { formatLength, parseLength } from '../model/units';
import { mapModule, mapPage, restack } from '../store/pageOps';
import { FilePickerModal, sectionsOf } from '../ui/pickers';
import type { ActiveBoard } from './activeBoard';
import { ALIGN_ACTIONS, type BoardViewport } from './BoardViewport';
import { moduleTitle } from './OutlineView';

export const VIEW_TYPE_INSPECTOR = 'patchwork-inspector';

const FIT = { contain: 'Contain', cover: 'Cover (crop to fill)', stretch: 'Stretch' };
const POSITIONS: Record<NumberPosition, string> = {
	'bottom-center': 'Bottom centre',
	'bottom-left': 'Bottom left',
	'bottom-right': 'Bottom right',
	'top-center': 'Top centre',
	'top-left': 'Top left',
	'top-right': 'Top right',
};

const insets = (mm: number): Insets => ({ top: mm, right: mm, bottom: mm, left: mm });
/** The inspector edits one inset for all sides; uneven insets (from the file) show their smallest side. */
const uniformInset = (i: Insets | undefined) => (i ? Math.min(i.top, i.right, i.bottom, i.left) : 0);

/** Copy of `o` with `key` set, or removed when `value` is undefined (absent keys stay absent in the file). */
function withField<T extends object>(o: T, key: string, value: unknown): T {
	const next = { ...o } as Record<string, unknown>;
	if (value === undefined) delete next[key];
	else next[key] = value;
	return next as T;
}

/** Small form builder on top of Obsidian's Setting, in the board's display unit. */
class Form {
	constructor(private el: HTMLElement, private unit: DisplayUnit) {}

	heading(text: string) {
		new Setting(this.el).setName(text).setHeading();
	}

	length(name: string, mm: number, set: (mm: number) => void, opts: { min?: number } = {}) {
		new Setting(this.el).setName(name).addText((t) =>
			t.setValue(formatLength(mm, this.unit)).onChange((v) => {
				const parsed = parseLength(v, this.unit);
				if (parsed !== null && parsed >= (opts.min ?? -Infinity)) set(Number(parsed.toFixed(4)));
			}),
		);
	}

	number(name: string, value: number | undefined, set: (v: number | undefined) => void, opts: { min?: number; max?: number; placeholder?: string } = {}) {
		new Setting(this.el).setName(name).addText((t) => {
			t.inputEl.type = 'number';
			t.setPlaceholder(opts.placeholder ?? '');
			t.setValue(value === undefined ? '' : String(value)).onChange((v) => {
				if (v.trim() === '') return set(undefined);
				const n = Number(v);
				if (Number.isFinite(n) && n >= (opts.min ?? -Infinity) && n <= (opts.max ?? Infinity)) set(n);
			});
		});
	}

	text(name: string, value: string | undefined, set: (v: string | undefined) => void, placeholder = '') {
		new Setting(this.el).setName(name).addText((t) => t.setPlaceholder(placeholder).setValue(value ?? '').onChange((v) => set(v === '' ? undefined : v)));
	}

	textarea(name: string, value: string, set: (v: string) => void) {
		const s = new Setting(this.el).setName(name).addTextArea((t) => t.setValue(value).onChange(set));
		s.settingEl.addClass('pw-setting-stacked');
	}

	toggle(name: string, value: boolean, set: (v: boolean) => void, desc?: string) {
		const s = new Setting(this.el).setName(name).addToggle((t) => t.setValue(value).onChange(set));
		if (desc) s.setDesc(desc);
	}

	dropdown(name: string, options: Record<string, string>, value: string, set: (v: string) => void) {
		new Setting(this.el).setName(name).addDropdown((d) => d.addOptions(options).setValue(value).onChange(set));
	}

	color(name: string, value: string | undefined, set: (v: string | undefined) => void) {
		new Setting(this.el)
			.setName(name)
			.addColorPicker((c) => c.setValue(value ?? '#ffffff').onChange((v) => set(v)))
			.addExtraButton((b) => b.setIcon('x').setTooltip('Clear').onClick(() => set(undefined)));
	}

	button(name: string, label: string, onClick: () => void, desc?: string) {
		const s = new Setting(this.el).setName(name).addButton((b) => b.setButtonText(label).onClick(onClick));
		if (desc) s.setDesc(desc);
	}
}

/**
 * Edits the selection of the active board (SPEC 5.6): the board when nothing is selected, else the
 * page or module. Every field is one coalesced undo step, so typing a number undoes in one go.
 */
export class InspectorView extends ItemView {
	private off: (() => void) | null = null;
	private shownKey = '';

	constructor(leaf: WorkspaceLeaf, private active: ActiveBoard) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE_INSPECTOR;
	}

	getDisplayText() {
		return 'Board inspector';
	}

	getIcon() {
		return 'sliders-horizontal';
	}

	async onOpen() {
		this.off = this.active.on(() => this.refresh());
		this.render();
	}

	async onClose() {
		this.off?.();
	}

	/** Re-render unless the user is typing in this panel about the same target (keeps focus and caret). */
	private refresh() {
		const board = this.active.get();
		const key = this.keyOf(board);
		if (key === this.shownKey && this.contentEl.contains(this.contentEl.doc.activeElement)) return;
		this.render();
	}

	private render() {
		const el = this.contentEl;
		el.empty();
		el.addClass('pw-inspector');
		const board = this.active.get();
		this.shownKey = this.keyOf(board);
		if (!board) {
			el.createDiv({ cls: 'pw-panel-empty', text: 'Open a Patchwork board to edit it here.' });
			return;
		}
		const file = board.boardStore.file;
		const form = new Form(el, file.board.displayUnit);
		const readOnly = board.boardStore.readOnly;
		if (readOnly) el.createDiv({ cls: 'pw-panel-empty', text: 'This board is read-only.' });
		const page = file.pages.find((p) => p.id === board.selected?.pageId);
		const mod = page?.modules.find((m) => m.id === board.selected?.moduleId);
		if (readOnly) return;
		if (board.selectedItems.length > 1) this.renderGroup(board);
		else if (page && mod) this.renderModule(form, board, page, mod);
		else if (page) this.renderPage(form, board, page);
		else this.renderBoard(form, board, file);
	}

	private keyOf(board: BoardViewport | null): string {
		return board ? board.selectedItems.map((it) => `${it.pageId}/${it.moduleId ?? ''}`).join('|') : '';
	}

	/** Several items selected: align, distribute and bulk actions. */
	private renderGroup(board: BoardViewport) {
		const items = board.selectedItems;
		const kind = items[0]?.moduleId ? 'modules' : 'pages';
		new Setting(this.contentEl).setName(`${items.length} ${kind} selected`).setHeading();
		const grid = this.contentEl.createDiv({ cls: 'pw-align-grid' });
		for (const [mode, title, icon] of ALIGN_ACTIONS) {
			const b = grid.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': title } });
			setIcon(b, icon);
			b.addEventListener('click', () => board.align(mode));
		}
		new Setting(this.contentEl)
			.setName('Distribute')
			.setDesc(items.length < 3 ? 'Needs three or more.' : 'Equal gaps, keeping the outermost in place.')
			.addButton((b) => b.setButtonText('Horizontally').setDisabled(items.length < 3).onClick(() => board.distribute('h')))
			.addButton((b) => b.setButtonText('Vertically').setDisabled(items.length < 3).onClick(() => board.distribute('v')));
		if (kind === 'pages') {
			const pages = board.boardStore.file.pages.filter((p) => items.some((it) => it.pageId === p.id));
			const first = pages[0]?.master;
			this.masterDropdown(new Form(this.contentEl, board.boardStore.file.board.displayUnit), board, pages.map((p) => p.id), pages.every((p) => p.master === first) ? first : undefined);
		}
		const actions = new Setting(this.contentEl).setName('Selection');
		if (kind === 'modules') actions.addButton((b) => b.setButtonText('Lock or unlock').onClick(() => board.toggleLock()));
		actions.addButton((b) => {
			// What setWarning() did; setDestructive() needs Obsidian 1.13 (minAppVersion is lower).
			b.setButtonText('Delete').onClick(() => board.deleteSelection());
			b.buttonEl.addClass('mod-warning');
		});
		this.contentEl.createDiv({ cls: 'pw-panel-hint', text: 'Shift-click adds or removes items; Shift-drag on empty board selects by area.' });
	}

	private update(board: BoardViewport, field: string, recipe: (f: PatchworkFile) => PatchworkFile) {
		board.boardStore.update(recipe, { coalesce: `inspector:${this.shownKey}:${field}` });
	}

	// ---------- board ----------

	private renderBoard(form: Form, board: BoardViewport, file: PatchworkFile) {
		const setBoard = (field: string, patch: Partial<BoardSettings>) => this.update(board, field, (f) => ({ ...f, board: { ...f.board, ...patch } }));
		form.heading('Board');
		form.text('Title', file.meta?.title, (v) => this.update(board, 'title', (f) => ({ ...f, meta: withField(f.meta ?? {}, 'title', v) })), 'Used for the exported PDF');
		form.dropdown('Display unit', { mm: 'Millimetres', cm: 'Centimetres', in: 'Inches' }, file.board.displayUnit, (v) => setBoard('unit', { displayUnit: v as DisplayUnit }));
		form.length('Grid size', file.board.grid.size, (mm) => mm > 0 && setBoard('grid', { grid: { ...file.board.grid, size: mm } }), { min: 0.1 });
		form.toggle('Snap to grid', file.board.grid.snap, (v) => setBoard('snap', { grid: { ...board.boardStore.file.board.grid, snap: v } }));
		form.toggle('Show grid', file.board.grid.visible, (v) => setBoard('visible', { grid: { ...board.boardStore.file.board.grid, visible: v } }));
		form.toggle('Use app theme for pages', file.board.useAppTheme, (v) => setBoard('theme', { useAppTheme: v }), 'Off: pages look like white paper, also in dark mode and in exports.');
		form.toggle('Dark PDFs in dark mode', !!file.board.pdfDarkMode, (v) => setBoard('pdfDark', withField(file.board, 'pdfDarkMode', v ? true : undefined)), 'Viewing only: PDF regions are shown colour-inverted while Obsidian uses a dark theme. Exports are unchanged.');
		const n = file.board.numbering;
		const setNum = (field: string, patch: Partial<BoardSettings['numbering']>) => setBoard(`num.${field}`, { numbering: { ...board.boardStore.file.board.numbering, ...patch } });
		form.heading('Page numbers');
		form.toggle('Show page numbers', n.enabled, (v) => {
			setNum('enabled', { enabled: v });
			this.render();
		});
		if (n.enabled) {
			form.number('Start at', n.start, (v) => v !== undefined && Number.isInteger(v) && setNum('start', { start: v }));
			form.dropdown('Format', { arabic: '1, 2, 3', roman: 'i, ii, iii', alpha: 'a, b, c' }, n.format, (v) => setNum('format', { format: v as NumberFormat }));
			form.dropdown('Position', POSITIONS, n.position, (v) => setNum('position', { position: v as NumberPosition }));
			form.toggle('Skip first page', n.skipFirst, (v) => setNum('skipFirst', { skipFirst: v }), 'The first page still counts.');
		}
		form.heading('Header and footer');
		form.text('Header', file.board.header, (v) => setBoard('header', withField(file.board, 'header', v)), '{title}');
		form.text('Footer', file.board.footer, (v) => setBoard('footer', withField(file.board, 'footer', v)), '{page} / {pages}');
		this.contentEl.createDiv({ cls: 'pw-panel-hint', text: 'Tokens: {page}, {pages}, {title}, {date}. Pages can override these.' });
		new Setting(this.contentEl)
			.setName('Arrange pages')
			.setDesc('In output order.')
			.addButton((b) => b.setButtonText('In a row').onClick(() => board.autoArrange('row')))
			.addButton((b) => b.setButtonText('In a grid').onClick(() => board.autoArrange('grid')));
		new Setting(this.contentEl)
			.setName('Canvas')
			.setDesc('Write a .canvas next to the board (one-way; crops and styles are dropped).')
			.addButton((b) => b.setButtonText('Export to canvas').onClick(() => void board.exportCanvas()));
		form.heading('Guides');
		form.length('Safe area', uniformInset(file.board.defaultSafeArea), (mm) => setBoard('safe', withField(file.board, 'defaultSafeArea', mm > 0 ? insets(mm) : undefined)), { min: 0 });
		this.contentEl.createDiv({ cls: 'pw-panel-hint', text: `A dashed margin guide on every page; never printed. ${file.pages.length} page(s) on this board.` });
	}

	// ---------- page ----------

	private renderPage(form: Form, board: BoardViewport, page: Page) {
		const setPage = (field: string, fn: (p: Page) => Page) => this.update(board, field, (f) => mapPage(f, page.id, fn));
		form.heading('Page');
		form.text('Name', page.name, (v) => setPage('name', (p) => withField(p, 'name', v)), 'Used for bookmarks');
		form.length('X', page.x, (mm) => setPage('x', (p) => ({ ...p, x: mm })));
		form.length('Y', page.y, (mm) => setPage('y', (p) => ({ ...p, y: mm })));
		form.length('Width', page.w, (mm) => setPage('w', (p) => ({ ...p, w: mm })), { min: 5 });
		form.length('Height', page.h, (mm) => setPage('h', (p) => ({ ...p, h: mm })), { min: 5 });
		const landscape = page.w > page.h;
		const match = PAGE_PRESETS.find((pr) => (landscape ? pr.h === page.w && pr.w === page.h : pr.w === page.w && pr.h === page.h));
		const presets: Record<string, string> = { custom: 'Custom' };
		for (const pr of PAGE_PRESETS) presets[pr.id] = pr.name;
		form.dropdown('Size preset', presets, match?.id ?? 'custom', (id) => {
			const pr = PAGE_PRESETS.find((x) => x.id === id);
			if (!pr) return;
			const size = landscape && pr.w !== pr.h ? swapOrientation(pr) : pr;
			setPage('preset', (p) => ({ ...p, w: size.w, h: size.h }));
			this.render();
		});
		form.button('Orientation', landscape ? 'Make portrait' : 'Make landscape', () => {
			setPage('orientation', (p) => swapOrientation(p));
			this.render();
		});
		form.color('Background', page.background, (v) => setPage('background', (p) => withField(p, 'background', v)));
		this.renderMaster(form, board, page);
		form.heading('Page furniture');
		this.overrideRow('Number', page.numberLabel === false ? 'none' : page.numberLabel, (v) => setPage('numberLabel', (p) => withField(p, 'numberLabel', v === 'none' ? false : v)), 'Automatic');
		const inherit = page.master ? 'From master' : 'Board default';
		this.overrideRow('Header', page.header === '' ? 'none' : page.header, (v) => setPage('header', (p) => withField(p, 'header', v === 'none' ? '' : v)), inherit);
		this.overrideRow('Footer', page.footer === '' ? 'none' : page.footer, (v) => setPage('footer', (p) => withField(p, 'footer', v === 'none' ? '' : v)), inherit);
		form.length('Safe area', uniformInset(page.safeArea), (mm) => setPage('safe', (p) => withField(p, 'safeArea', mm > 0 ? insets(mm) : undefined)), { min: 0 });
	}

	/** Master pages (M4): flag this page as one, or pick the master it uses. */
	private renderMaster(form: Form, board: BoardViewport, page: Page) {
		const file = board.boardStore.file;
		form.toggle(
			'Master page',
			!!page.isMaster,
			(v) => {
				// A master can't use another master; its own `master` is dropped when it becomes one.
				this.update(board, 'isMaster', (f) => mapPage(f, page.id, (p) => withField(withField(p, 'isMaster', v ? true : undefined), 'master', v ? undefined : p.master)));
				this.render();
			},
			'Not exported or numbered. Its modules, header, footer, background and safe area show on pages that use it.',
		);
		if (page.isMaster) {
			const n = pagesUsing(file, page.id).length;
			this.contentEl.createDiv({ cls: 'pw-panel-hint', text: n ? `Used by ${n} page(s).` : 'No pages use this master yet; pick it in a page’s Master setting.' });
			return;
		}
		this.masterDropdown(form, board, [page.id], page.master);
	}

	/** Pick the master for one or more pages. */
	private masterDropdown(form: Form, board: BoardViewport, pageIds: string[], current: string | undefined) {
		const masters = board.boardStore.file.pages.filter((p) => p.isMaster);
		if (!masters.length) return;
		const options: Record<string, string> = { '': 'None' };
		for (const m of masters) options[m.id] = m.name ?? 'Untitled master';
		const ids = new Set(pageIds);
		form.dropdown('Master', options, current && current in options ? current : '', (v) =>
			this.update(board, 'master', (f) => ({ ...f, pages: f.pages.map((p) => (ids.has(p.id) && !p.isMaster ? withField(p, 'master', v || undefined) : p)) })),
		);
	}

	/**
	 * Automatic (absent) / custom text / none, for per-page overrides. `value` is undefined for
	 * automatic, 'none' for none, else the custom text.
	 */
	private overrideRow(name: string, value: string | undefined, set: (v: string | undefined) => void, automatic: string) {
		const mode = value === undefined ? 'auto' : value === 'none' ? 'none' : 'custom';
		const s = new Setting(this.contentEl).setName(name).addDropdown((d) =>
			d
				.addOptions({ auto: automatic, custom: 'Custom', none: 'None' })
				.setValue(mode)
				.onChange((v) => {
					set(v === 'auto' ? undefined : v === 'none' ? 'none' : (value && value !== 'none' ? value : name));
					this.render();
				}),
		);
		if (mode === 'custom') s.addText((t) => t.setValue(value ?? '').onChange((v) => set(v === '' ? undefined : v)));
	}

	// ---------- module ----------

	private renderModule(form: Form, board: BoardViewport, page: Page, m: AnyModule) {
		const set = (field: string, fn: (x: AnyModule) => AnyModule) => this.update(board, field, (f) => mapModule(f, page.id, m.id, fn));
		form.heading(`${m.type[0]!.toUpperCase()}${m.type.slice(1)} module: ${moduleTitle(m)}`);
		form.text('Label', m.label, (v) => set('label', (x) => withField(x, 'label', v)), 'Shown in the outline');
		form.length('X', m.x, (mm) => set('x', (x) => ({ ...x, x: mm })));
		form.length('Y', m.y, (mm) => set('y', (x) => ({ ...x, y: mm })));
		form.length('Width', m.w, (mm) => set('w', (x) => ({ ...x, w: mm })), { min: 1 });
		form.length('Height', m.h, (mm) => set('h', (x) => ({ ...x, h: mm })), { min: 1 });
		form.toggle('Locked', !!m.locked, (v) => set('locked', (x) => withField(x, 'locked', v ? true : undefined)));
		new Setting(this.contentEl)
			.setName('Arrange')
			.addButton((b) => b.setButtonText('To front').onClick(() => board.boardStore.update((f) => restack(f, page.id, m.id, 'front'))))
			.addButton((b) => b.setButtonText('To back').onClick(() => board.boardStore.update((f) => restack(f, page.id, m.id, 'back'))));

		switch (m.type) {
			case 'note':
				this.renderNote(form, m as NoteModule, set);
				break;
			case 'pdf':
				this.renderPdf(form, board, page, m as PdfModule, set);
				break;
			case 'text':
				form.heading('Text');
				form.textarea('Markdown', (m as TextModule).markdown, (v) => set('markdown', (x) => ({ ...x, markdown: v })));
				break;
			case 'image':
				form.heading('Image');
				this.fileRow(m as ImageModule, (f) => /^(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f.extension), set);
				form.dropdown('Fit', FIT, (m as ImageModule).fit ?? 'contain', (v) => set('fit', (x) => withField(x, 'fit', v === 'contain' ? undefined : v)));
				break;
		}
		this.renderStyle(form, m, set);
	}

	private fileRow(m: { file: string }, accept: (f: TFile) => boolean, set: (field: string, fn: (x: AnyModule) => AnyModule) => void) {
		new Setting(this.contentEl)
			.setName('File')
			.setDesc(m.file)
			.addButton((b) =>
				b.setButtonText('Change…').onClick(() =>
					new FilePickerModal(this.app, this.app.vault.getFiles().filter(accept), 'Pick a file', (f) => {
						set('file', (x) => ({ ...x, file: f.path }));
						this.render();
					}).open(),
				),
			);
	}

	private renderNote(form: Form, m: NoteModule, set: (field: string, fn: (x: AnyModule) => AnyModule) => void) {
		form.heading('Note');
		this.fileRow(m, (f) => f.extension === 'md', set);
		const file = this.app.vault.getAbstractFileByPath(m.file);
		const sections: Record<string, string> = { '': 'Whole note' };
		if (file instanceof TFile) for (const s of sectionsOf(this.app, file)) if (s.subpath) sections[s.subpath] = `${'  '.repeat(Math.max(0, s.level - 1))}${s.label}`;
		if (m.subpath && !sections[m.subpath]) sections[m.subpath] = `${m.subpath} (not found)`;
		form.dropdown('Section', sections, m.subpath ?? '', (v) => set('subpath', (x) => withField(x, 'subpath', v || undefined)));
		if (m.subpath && !m.subpath.startsWith('#^')) form.toggle('Include heading', m.includeHeading !== false, (v) => set('includeHeading', (x) => withField(x, 'includeHeading', v ? undefined : false)));
		const lines = m.lines;
		form.number('From line', lines?.[0], (v) => set('lines', (x) => withField(x, 'lines', v === undefined ? undefined : [v, Math.max(v, (x as NoteModule).lines?.[1] ?? v)])), { min: 1, placeholder: 'start' });
		form.number('To line', lines?.[1], (v) => set('lines', (x) => withField(x, 'lines', v === undefined ? undefined : [Math.min(v, (x as NoteModule).lines?.[0] ?? 1), v])), { min: 1, placeholder: 'end' });
		this.contentEl.createDiv({ cls: 'pw-panel-hint', text: 'Lines count from the start of the section (or of the note), 1-based.' });
		form.dropdown('Overflow', { clip: 'Clip', fit: 'Shrink to fit', grow: 'Grow' }, m.overflow ?? 'clip', (v) => set('overflow', (x) => withField(x, 'overflow', v === 'clip' ? undefined : v)));
		form.number('Scale', m.scale, (v) => set('scale', (x) => withField(x, 'scale', v === 1 ? undefined : v)), { min: 0.1, max: 5, placeholder: '1' });
	}

	private renderPdf(form: Form, board: BoardViewport, page: Page, m: PdfModule, set: (field: string, fn: (x: AnyModule) => AnyModule) => void) {
		form.heading('PDF');
		this.fileRow(m, (f) => f.extension.toLowerCase() === 'pdf', set);
		form.number('Page', m.page, (v) => v !== undefined && Number.isInteger(v) && set('page', (x) => ({ ...x, page: v })), { min: 1 });
		const crop = m.crop ? m.crop.map((v) => v.toFixed(3)).join(', ') : 'Full page';
		form.button('Crop', 'Edit crop…', () => board.editCrop(page.id, m.id), crop);
		form.dropdown('Fit', FIT, m.fit ?? 'contain', (v) => set('fit', (x) => withField(x, 'fit', v === 'contain' ? undefined : v)));
		form.dropdown('Rotation', { '0': '0°', '90': '90°', '180': '180°', '270': '270°' }, String(m.rotation ?? 0), (v) => set('rotation', (x) => withField(x, 'rotation', v === '0' ? undefined : Number(v))));
		form.dropdown('In exports', { auto: 'Automatic', vector: 'Vector (sharp)', raster: 'Image (smaller)' }, m.render ?? 'auto', (v) => set('render', (x) => withField(x, 'render', v === 'auto' ? undefined : v)));
		form.toggle('Invert colours', !!m.invert, (v) => set('invert', (x) => withField(x, 'invert', v ? true : undefined)), 'For dark-background pages: light on screen and in print (exported as an image).');
	}

	private renderStyle(form: Form, m: AnyModule, set: (field: string, fn: (x: AnyModule) => AnyModule) => void) {
		const s = m.style ?? {};
		const setStyle = (field: string, key: keyof ModuleStyle & string, value: unknown) =>
			set(`style.${field}`, (x) => {
				const style = withField(x.style ?? {}, key, value);
				return withField(x, 'style', Object.keys(style).length ? style : undefined);
			});
		form.heading('Style');
		form.length('Padding', s.padding ?? 0, (mm) => setStyle('padding', 'padding', mm > 0 ? mm : undefined), { min: 0 });
		form.length('Border width', s.border?.width ?? 0, (mm) =>
			setStyle('border', 'border', mm > 0 ? { color: '#333333', ...(m.style?.border ?? {}), width: mm } : undefined), { min: 0 });
		if (s.border) {
			form.color('Border colour', s.border.color, (v) => setStyle('borderColor', 'border', { ...s.border!, color: v ?? '#333333' }));
			form.length('Corner radius', s.border.radius ?? 0, (mm) => setStyle('radius', 'border', withField(s.border!, 'radius', mm > 0 ? mm : undefined)), { min: 0 });
		}
		form.color('Background', s.background, (v) => setStyle('background', 'background', v));
		form.number('Opacity', s.opacity, (v) => setStyle('opacity', 'opacity', v === 1 ? undefined : v), { min: 0, max: 1, placeholder: '1' });
		form.number('Text scale', s.fontScale, (v) => setStyle('fontScale', 'fontScale', v === 1 ? undefined : v), { min: 0.1, max: 5, placeholder: '1' });
		form.text('CSS class', s.cssClass, (v) => setStyle('cssClass', 'cssClass', v), 'For CSS snippets');
	}
}

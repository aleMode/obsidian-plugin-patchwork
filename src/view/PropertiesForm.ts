import { type App, setIcon, Setting, TFile } from 'obsidian';
import { pagesUsing } from '../model/masters';
import { flowChains } from '../model/flow';
import { DEFAULT_TOC_HEADING } from '../model/toc';
import { DEFAULT_BOXES, itemsFromText } from '../model/tracker';
import { PAGE_PRESETS, swapOrientation } from '../model/presets';
import type { AnyModule, DisplayUnit, ImageModule, ModuleStyle, NoteModule, Page, PatchworkFile, PdfModule, TextModule, TocModule, TrackerModule } from '../model/schema';
import { formatLength, formatLengthValue, parseLength } from '../model/units';
import { MAX_PAGE_SIDE_MM } from '../model/schema';
import { mapModule, mapPage, restack } from '../store/pageOps';
import { FilePickerModal, sectionsOf } from '../ui/pickers';
import { ALIGN_ACTIONS, type BoardViewport } from './BoardViewport';
import { moduleTitle } from './OutlineRenderer';
import { insets, PLAIN_NUMBER, uniformInset, withField } from '../ui/formHelpers';

export type PropertiesSection = 'content' | 'layout' | 'style' | 'furniture' | 'advanced';

const FIT = { contain: 'Contain', cover: 'Cover (crop to fill)', stretch: 'Stretch' };

/** Small form builder on top of Obsidian's Setting, in the board's display unit. */
class Form {
	/** `settle` closes the undo group after a discrete choice, so two picks of the same field are two undo steps. */
	constructor(private host: () => HTMLElement, private unit: DisplayUnit, private settle: () => void = () => {}) {}

	heading(text: string) {
		new Setting(this.host()).setName(text).setHeading();
	}

	/** The unit is a fixed label next to the input (change it in Patchwork settings), so the field holds a plain number. */
	length(name: string, mm: number, set: (mm: number) => void, opts: { min?: number } = {}) {
		const s = new Setting(this.host()).setName(name).addText((t) =>
			t.setValue(formatLengthValue(mm, this.unit)).onChange((v) => {
				const parsed = PLAIN_NUMBER.test(v) ? parseLength(v, this.unit) : null;
				if (parsed !== null && parsed >= (opts.min ?? -Infinity)) set(Number(parsed.toFixed(4)));
			}),
		);
		s.controlEl.createSpan({ cls: 'pw-unit-suffix', text: this.unit });
	}

	number(name: string, value: number | undefined, set: (v: number | undefined) => void, opts: { min?: number; max?: number; placeholder?: string } = {}) {
		new Setting(this.host()).setName(name).addText((t) => {
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
		new Setting(this.host()).setName(name).addText((t) => t.setPlaceholder(placeholder).setValue(value ?? '').onChange((v) => set(v === '' ? undefined : v)));
	}

	textarea(name: string, value: string, set: (v: string) => void) {
		const s = new Setting(this.host()).setName(name).addTextArea((t) => t.setValue(value).onChange(set));
		s.settingEl.addClass('pw-setting-stacked');
	}

	toggle(name: string, value: boolean, set: (v: boolean) => void, desc?: string) {
		const s = new Setting(this.host()).setName(name).addToggle((t) => t.setValue(value).onChange((v) => this.choose(set, v)));
		if (desc) s.setDesc(desc);
	}

	dropdown(name: string, options: Record<string, string>, value: string, set: (v: string) => void) {
		new Setting(this.host()).setName(name).addDropdown((d) => d.addOptions(options).setValue(value).onChange((v) => this.choose(set, v)));
	}

	color(name: string, value: string | undefined, set: (v: string | undefined) => void) {
		new Setting(this.host())
			.setName(name)
			.addColorPicker((c) => c.setValue(value ?? '#ffffff').onChange((v) => set(v)))
			.addExtraButton((b) => b.setIcon('x').setTooltip('Clear').onClick(() => set(undefined)));
	}

	private choose<T>(set: (v: T) => void, v: T) {
		set(v);
		this.settle();
	}

	button(name: string, label: string, onClick: () => void, desc?: string) {
		const s = new Setting(this.host()).setName(name).addButton((b) => b.setButtonText(label).onClick(onClick));
		if (desc) s.setDesc(desc);
	}
}

/**
 * Edits the selection of the active board (SPEC 5.6): the board when nothing is selected, else the
 * page or module. Every field is one coalesced undo step, so typing a number undoes in one go.
 */
/**
 * Builds the editing forms for the whole patchwork, a page, a module or a group, into any container:
 * the sidebar dock (InspectorView) and the floating properties popover share it. `only` limits a
 * form to one tab's worth of controls.
 */
export class PropertiesForm {
	private sections = new Map<PropertiesSection, HTMLElement>();
	/** Where controls are being added right now (see `in`). */
	private current: HTMLElement;

	constructor(
		private app: App,
		private root: HTMLElement,
		private rerender: () => void,
		/** Identifies what is being edited; consecutive edits of one field undo as one step. */
		private key: () => string,
		/** Show only this tab's controls and no headings (the popover); null shows all of them (the dock). */
		private only: PropertiesSection | null = null,
	) {
		this.current = root;
	}

	/** Controls are appended here; it is the current section's container. */
	private get el(): HTMLElement {
		return this.current;
	}

	/** Send the controls that follow to a section. Every section exists up front, so the dock shows them grouped in this order. */
	private in(name: PropertiesSection) {
		this.current = this.sections.get(name) ?? this.root;
	}

	private makeSections() {
		for (const name of ['content', 'layout', 'style', 'furniture', 'advanced'] as const) {
			const el = this.root.createDiv({ cls: 'pw-prop-section', attr: { 'data-section': name } });
			if (this.only && this.only !== name) el.addClass('is-hidden');
			this.sections.set(name, el);
		}
		this.in('content');
	}

	/** Render what is selected on `board`. */
	renderSelection(board: BoardViewport) {
		this.makeSections();
		const file = board.boardStore.file;
		const form = new Form(() => this.el, file.board.displayUnit, () => board.boardStore.endCoalesce());
		const readOnly = board.boardStore.readOnly;
		if (readOnly) this.el.createDiv({ cls: 'pw-panel-empty', text: 'This patchwork is read-only.' });
		const page = file.pages.find((p) => p.id === board.selected?.pageId);
		const mod = page?.modules.find((m) => m.id === board.selected?.moduleId);
		if (readOnly) return;
		if (board.selectedItems.length > 1) this.renderGroup(board);
		else if (page && mod) this.renderModule(form, board, page, mod);
		else if (page) this.renderPage(form, board, page);
		else this.renderBoard(form, board, file);
	}

	/** Several items selected: align, distribute and bulk actions. */
	private renderGroup(board: BoardViewport) {
		const items = board.selectedItems;
		const kind = items[0]?.moduleId ? 'modules' : 'pages';
		new Setting(this.el).setName(`${items.length} ${kind} selected`).setHeading();
		const grid = this.el.createDiv({ cls: 'pw-align-grid' });
		for (const [mode, title, icon] of ALIGN_ACTIONS) {
			const b = grid.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': title } });
			setIcon(b, icon);
			b.addEventListener('click', () => board.align(mode));
		}
		new Setting(this.el)
			.setName('Distribute')
			.setDesc(items.length < 3 ? 'Needs three or more.' : 'Equal gaps, keeping the outermost in place.')
			.addButton((b) => b.setButtonText('Horizontally').setDisabled(items.length < 3).onClick(() => board.distribute('h')))
			.addButton((b) => b.setButtonText('Vertically').setDisabled(items.length < 3).onClick(() => board.distribute('v')));
		if (kind === 'pages') {
			const pages = board.boardStore.file.pages.filter((p) => items.some((it) => it.pageId === p.id));
			const first = pages[0]?.master;
			this.masterDropdown(new Form(() => this.el, board.boardStore.file.board.displayUnit, () => board.boardStore.endCoalesce()), board, pages.map((p) => p.id), pages.every((p) => p.master === first) ? first : undefined);
		}
		const actions = new Setting(this.el).setName('Selection');
		if (kind === 'modules') actions.addButton((b) => b.setButtonText('Lock or unlock').onClick(() => board.toggleLock()));
		actions.addButton((b) => {
			// What setWarning() did; setDestructive() needs Obsidian 1.13 (minAppVersion is lower).
			b.setButtonText('Delete').onClick(() => board.deleteSelection());
			b.buttonEl.addClass('mod-warning');
		});
		this.el.createDiv({ cls: 'pw-panel-hint', text: 'Shift-click adds or removes items; Shift-drag on empty space selects by area.' });
	}

	private update(board: BoardViewport, field: string, recipe: (f: PatchworkFile) => PatchworkFile) {
		board.boardStore.update(recipe, { coalesce: `inspector:${this.key()}:${field}` });
	}

	// ---------- board ----------

	private renderBoard(form: Form, board: BoardViewport, file: PatchworkFile) {
		form.heading('Patchwork');
		this.el.createDiv({ cls: 'pw-panel-hint', text: `${file.pages.length} page(s). Select a page or an item to edit it here.` });
		form.button('Settings', 'Settings…', () => board.showSettings(), 'Units, grid, page numbers, header and footer, appearance, title.');
		form.button('Export', 'Export…', () => board.showExport(), 'PDF or PNG, with sheet sizes, tiling, booklets and bleed.');
		form.button('Canvas', 'Export to canvas', () => void board.exportCanvas(), 'Writes a .canvas next to this patchwork (one-way; crops and styles are dropped).');
	}

	// ---------- page ----------

	private renderPage(form: Form, board: BoardViewport, page: Page) {
		const setPage = (field: string, fn: (p: Page) => Page) => this.update(board, field, (f) => mapPage(f, page.id, fn));
		this.in('content');
		form.heading('Page');
		form.text('Name', page.name, (v) => setPage('name', (p) => withField(p, 'name', v)), 'Used for bookmarks');
		this.in('layout');
		form.length('X', page.x, (mm) => setPage('x', (p) => ({ ...p, x: mm })));
		form.length('Y', page.y, (mm) => setPage('y', (p) => ({ ...p, y: mm })));
		form.length('Width', page.w, (mm) => setPage('w', (p) => ({ ...p, w: mm })), { min: 5 });
		form.length('Height', page.h, (mm) => setPage('h', (p) => ({ ...p, h: mm })), { min: 5 });
		if (Math.max(page.w, page.h) > MAX_PAGE_SIDE_MM) {
			this.el.createDiv({ cls: 'pw-panel-hint mod-warning', text: `Larger than a PDF page can be (${formatLength(MAX_PAGE_SIDE_MM, board.boardStore.file.board.displayUnit)} per side): export it on a sheet size, which splits it into tiles.` });
		}
		this.in('content');
		const landscape = page.w > page.h;
		const match = PAGE_PRESETS.find((pr) => (landscape ? pr.h === page.w && pr.w === page.h : pr.w === page.w && pr.h === page.h));
		const presets: Record<string, string> = { custom: 'Custom' };
		for (const pr of PAGE_PRESETS) presets[pr.id] = pr.name;
		form.dropdown('Size preset', presets, match?.id ?? 'custom', (id) => {
			const pr = PAGE_PRESETS.find((x) => x.id === id);
			if (!pr) return;
			const size = landscape && pr.w !== pr.h ? swapOrientation(pr) : pr;
			setPage('preset', (p) => ({ ...p, w: size.w, h: size.h }));
			this.rerender();
		});
		form.button('Orientation', landscape ? 'Make portrait' : 'Make landscape', () => {
			setPage('orientation', (p) => swapOrientation(p));
			this.rerender();
		});
		form.color('Background', page.background, (v) => setPage('background', (p) => withField(p, 'background', v)));
		this.renderMaster(form, board, page);
		this.in('furniture');
		form.heading('Page furniture');
		this.overrideRow('Number', page.numberLabel === false ? 'none' : page.numberLabel, (v) => setPage('numberLabel', (p) => withField(p, 'numberLabel', v === 'none' ? false : v)), 'Automatic');
		const inherit = page.master ? 'From master' : 'Patchwork default';
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
				this.rerender();
			},
			'Not exported or numbered. Its modules, header, footer, background and safe area show on pages that use it.',
		);
		if (page.isMaster) {
			const n = pagesUsing(file, page.id).length;
			this.el.createDiv({ cls: 'pw-panel-hint', text: n ? `Used by ${n} page(s).` : 'No pages use this master yet; pick it in a page’s Master setting.' });
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
		const s = new Setting(this.el).setName(name).addDropdown((d) =>
			d
				.addOptions({ auto: automatic, custom: 'Custom', none: 'None' })
				.setValue(mode)
				.onChange((v) => {
					set(v === 'auto' ? undefined : v === 'none' ? 'none' : (value && value !== 'none' ? value : name));
					this.rerender();
				}),
		);
		if (mode === 'custom') s.addText((t) => t.setValue(value ?? '').onChange((v) => set(v === '' ? undefined : v)));
	}

	// ---------- module ----------

	private renderModule(form: Form, board: BoardViewport, page: Page, m: AnyModule) {
		const set = (field: string, fn: (x: AnyModule) => AnyModule) => this.update(board, field, (f) => mapModule(f, page.id, m.id, fn));
		form.heading(`${m.type[0]!.toUpperCase()}${m.type.slice(1)} module: ${moduleTitle(m)}`);
		this.in('advanced');
		form.text('Label', m.label, (v) => set('label', (x) => withField(x, 'label', v)), 'Shown in the outline');
		this.in('layout');
		form.length('X', m.x, (mm) => set('x', (x) => ({ ...x, x: mm })));
		form.length('Y', m.y, (mm) => set('y', (x) => ({ ...x, y: mm })));
		form.length('Width', m.w, (mm) => set('w', (x) => ({ ...x, w: mm })), { min: 1 });
		form.length('Height', m.h, (mm) => set('h', (x) => ({ ...x, h: mm })), { min: 1 });
		form.toggle('Locked', !!m.locked, (v) => set('locked', (x) => withField(x, 'locked', v ? true : undefined)));
		new Setting(this.el)
			.setName('Arrange')
			.addButton((b) => b.setButtonText('To front').onClick(() => board.boardStore.update((f) => restack(f, page.id, m.id, 'front'))))
			.addButton((b) => b.setButtonText('To back').onClick(() => board.boardStore.update((f) => restack(f, page.id, m.id, 'back'))));

		this.in('content');
		switch (m.type) {
			case 'note':
				this.renderNote(form, board, page, m as NoteModule, set);
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
			case 'frame':
				this.renderFrame(form, board, page, m);
				break;
			case 'tracker':
				this.renderTracker(form, m as TrackerModule, set);
				break;
			case 'toc':
				form.heading('Table of contents');
				this.overrideRow('Heading', (m as TocModule).heading === '' ? 'none' : (m as TocModule).heading, (v) => set('heading', (x) => withField(x, 'heading', v === 'none' ? '' : v)), DEFAULT_TOC_HEADING);
				this.el.createDiv({ cls: 'pw-panel-hint', text: 'Lists every named page in output order with its number. Entries are links in exported PDFs.' });
				break;
		}
		this.renderStyle(form, m, set);
	}

	/** Tracker (M5): what it tracks; its state is changed by clicking it on the board. */
	private renderTracker(form: Form, m: TrackerModule, set: (field: string, fn: (x: AnyModule) => AnyModule) => void) {
		form.heading('Tracker');
		form.dropdown('Kind', { counter: 'Counter', boxes: 'Boxes', checklist: 'Checklist' }, m.kind, (v) => {
			set('kind', (x) => ({ ...x, kind: v as TrackerModule['kind'] }));
			this.rerender();
		});
		const num = (name: string, key: 'value' | 'min' | 'max' | 'step', placeholder: string, min?: number) =>
			form.number(name, m[key], (v) => set(key, (x) => withField(x, key, v)), { ...(min === undefined ? {} : { min }), placeholder });
		if (m.kind === 'counter') {
			num('Value', 'value', '0');
			num('Minimum', 'min', 'none');
			num('Maximum', 'max', 'none');
			num('Step', 'step', '1', 0);
		} else if (m.kind === 'boxes') {
			num('Boxes', 'max', String(DEFAULT_BOXES), 1);
			num('Filled', 'value', '0', 0);
		} else {
			form.textarea('Items', (m.items ?? []).map((it) => it.text).join('\n'), (v) => set('items', (x) => ({ ...x, items: itemsFromText(v, (x as TrackerModule).items) })));
			this.el.createDiv({ cls: 'pw-panel-hint', text: 'One item per line. Ticks stay with their line.' });
		}
		form.toggle('Print blank', !!m.printBlank, (v) => set('printBlank', (x) => withField(x, 'printBlank', v ? true : undefined)), 'Exports show it empty, to fill in by hand.');
		this.el.createDiv({ cls: 'pw-panel-hint', text: 'The label (above) is its title. Click the tracker on its page to change it; each click can be undone.' });
	}

	/** Text frame (linked frame, M5): where it sits in its chain. */
	private renderFrame(form: Form, board: BoardViewport, page: Page, m: AnyModule) {
		form.heading('Text frame (continues a note)');
		const info = flowChains(board.boardStore.file).get(m.id);
		const text = !info ? 'Not linked.' : !info.ok ? info.reason : `Frame ${info.index + 1} of ${info.chain.length}, continuing “${moduleTitle(info.chain[0]!.module)}”. Text that doesn't fit in one frame flows into the next, a block at a time.`;
		this.el.createDiv({ cls: 'pw-panel-hint', text });
		form.button('Continue', 'Add another frame', () => board.continueInFrame(page.id, m.id), 'Placed on the next page, at the same spot.');
	}

	private fileRow(m: { file: string }, accept: (f: TFile) => boolean, set: (field: string, fn: (x: AnyModule) => AnyModule) => void) {
		new Setting(this.el)
			.setName('File')
			.setDesc(m.file)
			.addButton((b) =>
				b.setButtonText('Change…').onClick(() =>
					new FilePickerModal(this.app, this.app.vault.getFiles().filter(accept), 'Pick a file', (f) => {
						set('file', (x) => ({ ...x, file: f.path }));
						this.rerender();
					}).open(),
				),
			);
	}

	private renderNote(form: Form, board: BoardViewport, page: Page, m: NoteModule, set: (field: string, fn: (x: AnyModule) => AnyModule) => void) {
		form.heading('Note');
		this.fileRow(m, (f) => f.extension === 'md', set);
		const file = this.app.vault.getAbstractFileByPath(m.file);
		const sections: Record<string, string> = { '': 'Whole note' };
		if (file instanceof TFile) for (const s of sectionsOf(this.app, file)) if (s.subpath) sections[s.subpath] = `${'  '.repeat(Math.max(0, s.level - 1))}${s.label}`;
		if (m.subpath && !sections[m.subpath]) sections[m.subpath] = `${m.subpath} (not found)`;
		form.dropdown('Section', sections, m.subpath ?? '', (v) => set('subpath', (x) => withField(x, 'subpath', v || undefined)));
		if (m.subpath && !m.subpath.startsWith('#^')) form.toggle('Include heading', m.includeHeading !== false, (v) => set('includeHeading', (x) => withField(x, 'includeHeading', v ? undefined : false)));
		const lines = m.lines;
		this.in('advanced');
		form.number('From line', lines?.[0], (v) => set('lines', (x) => withField(x, 'lines', v === undefined ? undefined : [v, Math.max(v, (x as NoteModule).lines?.[1] ?? v)])), { min: 1, placeholder: 'start' });
		form.number('To line', lines?.[1], (v) => set('lines', (x) => withField(x, 'lines', v === undefined ? undefined : [Math.min(v, (x as NoteModule).lines?.[0] ?? 1), v])), { min: 1, placeholder: 'end' });
		this.el.createDiv({ cls: 'pw-panel-hint', text: 'Lines count from the start of the section (or of the note), 1-based.' });
		this.in('content');
		form.dropdown('Overflow', { clip: 'Clip', fit: 'Shrink to fit', grow: 'Grow' }, m.overflow ?? 'clip', (v) => set('overflow', (x) => withField(x, 'overflow', v === 'clip' ? undefined : v)));
		this.in('advanced');
		form.number('Scale', m.scale, (v) => set('scale', (x) => withField(x, 'scale', v === 1 ? undefined : v)), { min: 0.1, max: 5, placeholder: '1' });
		this.in('content');
		const freeze = new Setting(this.el).setName('Freeze text (snapshot)');
		if (m.frozen) {
			freeze.setDesc(`Showing a snapshot from ${m.frozen.at}; changes to the note don't appear here.`);
			freeze.addButton((b) => b.setButtonText('Update snapshot').onClick(() => void board.freezeNote(page.id, m.id)));
			freeze.addButton((b) => b.setButtonText('Unfreeze').onClick(() => board.unfreezeNote(page.id, m.id)));
		} else {
			freeze.setDesc('Keep showing the note as it is now, even if it changes later (the snapshot is stored in the patchwork).');
			freeze.addButton((b) => b.setButtonText('Freeze text').onClick(() => void board.freezeNote(page.id, m.id)));
		}
	}

	private renderPdf(form: Form, board: BoardViewport, page: Page, m: PdfModule, set: (field: string, fn: (x: AnyModule) => AnyModule) => void) {
		form.heading('PDF');
		this.fileRow(m, (f) => f.extension.toLowerCase() === 'pdf', set);
		form.number('Page', m.page, (v) => v !== undefined && Number.isInteger(v) && set('page', (x) => ({ ...x, page: v })), { min: 1 });
		const crop = m.crop ? m.crop.map((v) => v.toFixed(3)).join(', ') : 'Full page';
		form.button('Crop', 'Edit crop…', () => board.editCrop(page.id, m.id), crop);
		form.dropdown('Fit', FIT, m.fit ?? 'contain', (v) => set('fit', (x) => withField(x, 'fit', v === 'contain' ? undefined : v)));
		this.in('advanced');
		form.dropdown('Rotation', { '0': '0°', '90': '90°', '180': '180°', '270': '270°' }, String(m.rotation ?? 0), (v) => set('rotation', (x) => withField(x, 'rotation', v === '0' ? undefined : Number(v))));
		form.dropdown('In exports', { auto: 'Automatic', vector: 'Vector (sharp)', raster: 'Image (smaller)' }, m.render ?? 'auto', (v) => set('render', (x) => withField(x, 'render', v === 'auto' ? undefined : v)));
		this.in('content');
		form.toggle('Invert colours', !!m.invert, (v) => set('invert', (x) => withField(x, 'invert', v ? true : undefined)), 'For dark-background pages: light on screen and in print (exported as an image).');
		this.in('advanced');
		form.button(
			'Warn if this PDF changes',
			m.sourceId ? 'Mark as checked' : 'Turn on',
			() => void board.markPdfChecked(page.id, m.id),
			m.sourceId
				? 'Warns on the module when the PDF file is replaced (e.g. a new rulebook version). After checking the crop, mark it as checked.'
				: 'Remember this version of the PDF and warn if the file is replaced. Crops made or edited in the crop editor do this automatically.',
		);
	}

	private renderStyle(form: Form, m: AnyModule, set: (field: string, fn: (x: AnyModule) => AnyModule) => void) {
		const s = m.style ?? {};
		const setStyle = (field: string, key: keyof ModuleStyle & string, value: unknown) =>
			set(`style.${field}`, (x) => {
				const style = withField(x.style ?? {}, key, value);
				return withField(x, 'style', Object.keys(style).length ? style : undefined);
			});
		this.in('style');
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
		form.color('Text colour', s.color, (v) => setStyle('color', 'color', v));
		form.dropdown('Alignment', { '': 'Default', left: 'Left', center: 'Centre', right: 'Right', justify: 'Justify' }, s.align ?? '', (v) => setStyle('align', 'align', v === '' ? undefined : v));
		form.text('Font', s.fontFamily, (v) => setStyle('fontFamily', 'fontFamily', v), 'Same as the page');
		this.in('advanced');
		form.text('CSS class', s.cssClass, (v) => setStyle('cssClass', 'cssClass', v), 'For CSS snippets');
	}
}

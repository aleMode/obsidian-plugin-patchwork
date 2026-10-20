import { App, Modal, Setting } from 'obsidian';
import type { BoardSettings, DisplayUnit, NumberFormat, NumberPosition } from '../model/schema';
import { formatLengthValue, parseLength } from '../model/units';
import { insets, PLAIN_NUMBER, POSITIONS, setOpt, uniformInset } from './formHelpers';

export interface SettingsDraft {
	board: BoardSettings;
	title: string | undefined;
}

export interface SettingsActions {
	/** Applied as one undo step. */
	apply: (draft: SettingsDraft) => void;
	arrange: (mode: 'row' | 'grid') => void;
}

const TABS = [
	['layout', 'Layout'],
	['numbering', 'Numbering'],
	['appearance', 'Appearance'],
	['document', 'Document'],
] as const;
type Tab = (typeof TABS)[number][0];

/**
 * Everything that belongs to the whole patchwork rather than to a page or module, in one place
 * (it replaces the inspector's board section and the old, smaller settings dialog). Edits a draft;
 * Apply is one undo step.
 */
export class PatchworkSettingsModal extends Modal {
	private draft: SettingsDraft;
	private tab: Tab = 'layout';
	private body!: HTMLElement;
	private tabButtons = new Map<Tab, HTMLElement>();

	constructor(app: App, current: SettingsDraft, private actions: SettingsActions) {
		super(app);
		this.draft = { board: structuredClone(current.board), title: current.title };
	}

	onOpen() {
		this.setTitle('Patchwork settings');
		this.modalEl.addClass('pw-settings-modal');
		const bar = this.contentEl.createDiv({ cls: 'pw-tabs' });
		for (const [id, label] of TABS) {
			const b = bar.createEl('button', { cls: 'pw-tab', text: label });
			b.addEventListener('click', () => this.show(id));
			this.tabButtons.set(id, b);
		}
		this.body = this.contentEl.createDiv({ cls: 'pw-tab-body' });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText('Apply')
					.setCta()
					.onClick(() => {
						this.close();
						this.actions.apply(this.draft);
					}),
			);
		this.show(this.tab);
	}

	private show(tab: Tab) {
		this.tab = tab;
		for (const [id, b] of this.tabButtons) b.toggleClass('is-active', id === tab);
		this.body.empty();
		if (tab === 'layout') this.layout();
		else if (tab === 'numbering') this.numbering();
		else if (tab === 'appearance') this.appearance();
		else this.document();
	}

	/** The unit is a fixed label next to a plain number (the display unit is chosen above it). */
	private length(name: string, mm: number, set: (mm: number) => void, min: number, desc?: string) {
		const unit = this.draft.board.displayUnit;
		const s = new Setting(this.body).setName(name).addText((t) =>
			t.setValue(formatLengthValue(mm, unit)).onChange((v) => {
				const parsed = PLAIN_NUMBER.test(v) ? parseLength(v, unit) : null;
				if (parsed !== null && parsed >= min) set(Number(parsed.toFixed(4)));
			}),
		);
		if (desc) s.setDesc(desc);
		s.controlEl.createSpan({ cls: 'pw-unit-suffix', text: unit });
	}

	private layout() {
		const b = this.draft.board;
		new Setting(this.body)
			.setName('Display unit')
			.setDesc('Rulers, labels and fields. The file always stores millimetres.')
			.addDropdown((d) =>
				d
					.addOptions({ mm: 'Millimetres', cm: 'Centimetres', in: 'Inches' })
					.setValue(b.displayUnit)
					.onChange((v) => {
						b.displayUnit = v as DisplayUnit;
						this.show('layout');
					}),
			);
		this.length('Grid size', b.grid.size, (mm) => (b.grid.size = mm), 0.1);
		new Setting(this.body).setName('Snap to grid').addToggle((t) => t.setValue(b.grid.snap).onChange((v) => (b.grid.snap = v)));
		new Setting(this.body).setName('Show grid').addToggle((t) => t.setValue(b.grid.visible).onChange((v) => (b.grid.visible = v)));
		this.length('Safe area', uniformInset(b.defaultSafeArea), (mm) => setOpt(b, 'defaultSafeArea', mm > 0 ? insets(mm) : undefined), 0, 'A dashed margin guide on every page; never printed.');
		new Setting(this.body)
			.setName('Arrange pages')
			.setDesc('In output order. Applies your changes here first.')
			.addButton((x) => x.setButtonText('In a row').onClick(() => this.arrange('row')))
			.addButton((x) => x.setButtonText('In a grid').onClick(() => this.arrange('grid')));
	}

	private arrange(mode: 'row' | 'grid') {
		this.close();
		this.actions.apply(this.draft);
		this.actions.arrange(mode);
	}

	private numbering() {
		const n = this.draft.board.numbering;
		new Setting(this.body).setName('Show page numbers').addToggle((t) =>
			t.setValue(n.enabled).onChange((v) => {
				n.enabled = v;
				this.show('numbering');
			}),
		);
		if (n.enabled) {
			new Setting(this.body).setName('Start at').addText((t) => {
				t.inputEl.type = 'number';
				t.setValue(String(n.start)).onChange((v) => {
					const start = Number(v);
					if (v.trim() !== '' && Number.isInteger(start)) n.start = start;
				});
			});
			new Setting(this.body).setName('Format').addDropdown((d) => d.addOptions({ arabic: '1, 2, 3', roman: 'i, ii, iii', alpha: 'a, b, c' }).setValue(n.format).onChange((v) => (n.format = v as NumberFormat)));
			new Setting(this.body).setName('Position').addDropdown((d) => d.addOptions(POSITIONS).setValue(n.position).onChange((v) => (n.position = v as NumberPosition)));
			new Setting(this.body).setName('Skip first page').setDesc('The first page still counts.').addToggle((t) => t.setValue(n.skipFirst).onChange((v) => (n.skipFirst = v)));
		}
		const b = this.draft.board;
		new Setting(this.body).setName('Header').addText((t) => t.setPlaceholder('{title}').setValue(b.header ?? '').onChange((v) => setOpt(this.draft.board, 'header', v === '' ? undefined : v)));
		new Setting(this.body).setName('Footer').addText((t) => t.setPlaceholder('{page} / {pages}').setValue(b.footer ?? '').onChange((v) => setOpt(this.draft.board, 'footer', v === '' ? undefined : v)));
		this.body.createDiv({ cls: 'pw-panel-hint', text: 'Tokens: {page}, {pages}, {title}, {date}. Each page can override these.' });
	}

	private appearance() {
		const b = this.draft.board;
		new Setting(this.body)
			.setName('Use app theme for pages')
			.setDesc('Off: pages look like white paper, also in dark mode and in exports.')
			.addToggle((t) => t.setValue(b.useAppTheme).onChange((v) => (b.useAppTheme = v)));
		new Setting(this.body)
			.setName('Font')
			.setDesc('Font family for notes and text on the pages. Empty: the theme font.')
			.addText((t) => t.setPlaceholder('Theme font').setValue(b.fontFamily ?? '').onChange((v) => setOpt(this.draft.board, 'fontFamily', v === '' ? undefined : v)));
		new Setting(this.body)
			.setName('PDF regions in dark mode')
			.setDesc('Viewing only: PDF regions are shown colour-inverted while Obsidian uses a dark theme. Exports are unchanged.')
			.addToggle((t) => t.setValue(!!b.pdfDarkMode).onChange((v) => setOpt(this.draft.board, 'pdfDarkMode', v ? true : undefined)));
	}

	private document() {
		new Setting(this.body)
			.setName('Title')
			.setDesc('Used for the exported PDF and the {title} token. Empty: the file name.')
			.addText((t) => t.setValue(this.draft.title ?? '').onChange((v) => (this.draft.title = v === '' ? undefined : v)));
	}

	onClose() {
		this.contentEl.empty();
	}
}

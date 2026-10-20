import { App, Modal, normalizePath, Notice, Setting, TFile } from 'obsidian';
import type { DisplayUnit, SheetPreset } from '../model/schema';
import { parseRange, type SheetSetting, SHEET_SIZES } from '../model/sheetPlan';
import { formatLength, parseLength } from '../model/units';

export interface ExportChoices {
	/** Vault path without extension; ".pdf" or ".png" (plus numbering) is added. */
	base: string;
	format: 'pdf' | 'png';
	pages: 'all' | 'selected' | 'range';
	range: string;
	sheet: SheetSetting;
	orientation: 'auto' | 'portrait' | 'landscape';
	overlap: number;
	fitSmallPages: boolean;
	tileLabels: boolean;
	inkSaver: boolean;
	layout: 'single' | 'booklet';
	bleed: number;
	cropMarks: boolean;
	quality: 'best' | 'small';
	dpi: number;
	open: boolean;
}

/** More than this is never bleed; it would push crop marks off a normal sheet. */
const MAX_BLEED_MM = 10;

/** The export dialog (SPEC 9): format, pages, sheet size and tiling, quality. */
export class ExportModal extends Modal {
	private c: ExportChoices;
	private warning!: HTMLElement;

	constructor(
		app: App,
		initial: ExportChoices,
		private ctx: { pageCount: number; selectedCount: number; unit: DisplayUnit },
		private run: (choices: ExportChoices) => void,
	) {
		super(app);
		this.c = { ...initial };
	}

	onOpen() {
		this.setTitle('Export board');
		this.render();
	}

	private render() {
		const el = this.contentEl;
		el.empty();
		const c = this.c;
		new Setting(el).setName('Format').addDropdown((d) =>
			d
				.addOptions({ pdf: 'PDF', png: 'PNG images' })
				.setValue(c.format)
				.onChange((v) => {
					c.format = v as 'pdf' | 'png';
					this.render();
				}),
		);
		new Setting(el)
			.setName('File')
			.setDesc(c.format === 'pdf' ? 'Vault path; ".pdf" is added.' : 'Vault path; each sheet becomes "name-01.png", … (a single sheet: "name.png").')
			.addText((t) =>
				t.setValue(c.base).onChange((v) => {
					c.base = v;
					this.updateWarning();
				}),
			);
		this.warning = el.createDiv({ cls: 'pw-export-warning' });
		this.updateWarning();

		const pageOptions: Record<string, string> = { all: `All pages (${this.ctx.pageCount})`, range: 'Page range' };
		if (this.ctx.selectedCount) pageOptions.selected = `Selected pages (${this.ctx.selectedCount})`;
		const pages = new Setting(el).setName('Pages').addDropdown((d) =>
			d
				.addOptions(pageOptions)
				.setValue(c.pages in pageOptions ? c.pages : 'all')
				.onChange((v) => {
					c.pages = v as ExportChoices['pages'];
					this.render();
				}),
		);
		if (c.pages === 'range') pages.addText((t) => t.setPlaceholder('1-3, 5').setValue(c.range).onChange((v) => (c.range = v)));

		const sheetValue = typeof c.sheet === 'string' ? c.sheet : 'custom';
		const sheetOptions: Record<string, string> = { native: 'Each page at its own size' };
		for (const k of Object.keys(SHEET_SIZES)) sheetOptions[k] = k;
		sheetOptions.custom = 'Custom size';
		new Setting(el)
			.setName('Sheet size')
			.setDesc('Pages larger than the sheet are split into tiles; smaller ones are centred.')
			.addDropdown((d) =>
				d
					.addOptions(sheetOptions)
					.setValue(sheetValue)
					.onChange((v) => {
						c.sheet = v === 'custom' ? { w: 210, h: 297 } : (v as SheetPreset | 'native');
						this.render();
					}),
			);
		if (typeof c.sheet === 'object') {
			const custom = c.sheet;
			const len = (name: string, key: 'w' | 'h') =>
				new Setting(el).setName(name).addText((t) =>
					t.setValue(formatLength(custom[key], this.ctx.unit)).onChange((v) => {
						const mm = parseLength(v, this.ctx.unit);
						if (mm !== null && mm > 0) custom[key] = mm;
					}),
				);
			len('Sheet width', 'w');
			len('Sheet height', 'h');
		}
		if (c.sheet !== 'native') {
			new Setting(el).setName('Orientation').addDropdown((d) =>
				d
					.addOptions({ auto: 'Automatic (fewest sheets)', portrait: 'Portrait', landscape: 'Landscape' })
					.setValue(c.orientation)
					.onChange((v) => (c.orientation = v as ExportChoices['orientation'])),
			);
			new Setting(el).setName('Smaller pages').addDropdown((d) =>
				d
					.addOptions({ actual: 'Actual size', fit: 'Scale to fit the sheet' })
					.setValue(c.fitSmallPages ? 'fit' : 'actual')
					.onChange((v) => (c.fitSmallPages = v === 'fit')),
			);
			new Setting(el)
				.setName('Tile overlap')
				.setDesc('Repeated strip between neighbouring tiles, for gluing or aligning.')
				.addText((t) =>
					t.setValue(formatLength(c.overlap, this.ctx.unit)).onChange((v) => {
						const mm = parseLength(v, this.ctx.unit);
						if (mm !== null && mm >= 0) c.overlap = mm;
					}),
				);
			new Setting(el).setName('Tile labels').setDesc('Print a row and column label in a corner of each tile.').addToggle((t) => t.setValue(c.tileLabels).onChange((v) => (c.tileLabels = v)));
		}
		this.renderPrintShop(el);
		new Setting(el)
			.setName('Quality')
			.setDesc('Best quality keeps PDF regions as sharp, selectable vector content (larger files). Smallest file turns them into images.')
			.addDropdown((d) =>
				d
					.addOption('best', 'Best quality')
					.addOption('small', 'Smallest file')
					.setValue(c.quality)
					.onChange((v) => (c.quality = v as 'best' | 'small')),
			);
		new Setting(el)
			.setName('Ink saver')
			.setDesc('PDF regions and images print grayscale and lighter (as images). Notes and text are unchanged.')
			.addToggle((t) => t.setValue(c.inkSaver).onChange((v) => (c.inkSaver = v)));
		new Setting(el)
			.setName('Image resolution')
			.setDesc(c.format === 'png' ? 'Dots per inch of the PNG images (and of PDF regions exported as images).' : 'Dots per inch for PDF regions exported as images.')
			.addText((t) => {
				t.inputEl.type = 'number';
				t.setValue(String(c.dpi)).onChange((v) => (c.dpi = Number(v)));
			});
		new Setting(el).setName('Open after export').addToggle((t) => t.setValue(c.open).onChange((v) => (c.open = v)));
		new Setting(el).addButton((b) =>
			b
				.setButtonText('Export')
				.setCta()
				.onClick(() => this.submit()),
		);
	}

	/** Booklet imposition, bleed and crop marks (M4). */
	private renderPrintShop(el: HTMLElement) {
		const c = this.c;
		new Setting(el)
			.setName('Layout')
			.setDesc(
				c.layout === 'booklet'
					? 'Two pages per side of each sheet, in folding order. Print double-sided, flipping on the short edge, then fold the stack in half.'
					: 'One page per sheet (or tiles of it).',
			)
			.addDropdown((d) =>
				d
					.addOptions({ single: 'One page per sheet', booklet: 'Booklet (fold in half)' })
					.setValue(c.layout)
					.onChange((v) => {
						c.layout = v as ExportChoices['layout'];
						this.render();
					}),
			);
		if (c.layout === 'booklet') return;
		new Setting(el)
			.setName('Bleed')
			.setDesc('Extra margin printed around each page, for trimming. Backgrounds and modules crossing the edge extend into it. Not applied to tiles.')
			.addText((t) =>
				t.setValue(formatLength(c.bleed, this.ctx.unit)).onChange((v) => {
					const mm = parseLength(v, this.ctx.unit);
					if (mm !== null && mm >= 0 && mm <= MAX_BLEED_MM) c.bleed = mm;
				}),
			);
		new Setting(el)
			.setName('Crop marks')
			.setDesc('Corner marks showing where to cut. The sheet grows to make room unless a sheet size is chosen.')
			.addToggle((t) => t.setValue(c.cropMarks).onChange((v) => (c.cropMarks = v)));
	}

	private target(): string {
		const base = normalizePath(this.c.base.trim()).replace(/\.(pdf|png)$/i, '');
		return `${base}.${this.c.format}`;
	}

	private updateWarning() {
		const path = this.target();
		const exists = this.app.vault.getAbstractFileByPath(path) instanceof TFile;
		this.warning.setText(exists ? `${path} already exists and will be replaced.` : '');
	}

	private submit() {
		const c = this.c;
		if (!(c.dpi >= 36 && c.dpi <= 1200)) return void new Notice('Image resolution must be between 36 and 1200 dots per inch.');
		if (c.pages === 'range' && !parseRange(c.range, this.ctx.pageCount)) return void new Notice(`Enter a page range between 1 and ${this.ctx.pageCount}, e.g. "1-3, 5".`);
		if (typeof c.sheet === 'object' && !(c.overlap < Math.min(c.sheet.w, c.sheet.h))) return void new Notice('Tile overlap must be smaller than the sheet.');
		this.close();
		this.run({ ...c, base: this.target().replace(/\.(pdf|png)$/i, '') });
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Write bytes to a vault path, replacing an existing file and creating folders as needed. */
export async function writeBinary(app: App, path: string, bytes: Uint8Array): Promise<TFile> {
	const data = bytes.slice().buffer;
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await app.vault.modifyBinary(existing, data);
		return existing;
	}
	const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
	if (folder && !app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
	return app.vault.createBinary(path, data);
}

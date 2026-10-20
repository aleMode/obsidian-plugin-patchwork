import { App, FuzzySuggestModal, SuggestModal, TFile } from 'obsidian';

export class FilePickerModal extends FuzzySuggestModal<TFile> {
	constructor(app: App, private files: TFile[], placeholder: string, private onPick: (file: TFile) => void) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getItems(): TFile[] {
		return this.files;
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onPick(file);
	}
}

export interface SectionChoice {
	label: string;
	/** Undefined means the whole note. */
	subpath?: string;
	level: number;
	detail?: string;
}

/** Headings and block IDs of a note, from the metadata cache. */
export function sectionsOf(app: App, file: TFile): SectionChoice[] {
	const cache = app.metadataCache.getFileCache(file);
	const out: SectionChoice[] = [{ label: 'Whole note', level: 0 }];
	for (const h of cache?.headings ?? []) out.push({ label: h.heading, subpath: `#${h.heading}`, level: h.level });
	for (const id of Object.keys(cache?.blocks ?? {})) out.push({ label: `^${id}`, subpath: `#^${id}`, level: 0, detail: 'block' });
	return out;
}

export class SectionPickerModal extends SuggestModal<SectionChoice> {
	constructor(app: App, private choices: SectionChoice[], private onPick: (choice: SectionChoice) => void) {
		super(app);
		this.setPlaceholder('Pick a section, or the whole note');
	}

	getSuggestions(query: string): SectionChoice[] {
		const q = query.toLowerCase();
		return this.choices.filter((c) => c.label.toLowerCase().includes(q));
	}

	renderSuggestion(choice: SectionChoice, el: HTMLElement): void {
		const row = el.createDiv({ text: choice.label });
		row.addClass('pw-suggest-section');
		row.setCssProps({ '--pw-indent': String(Math.max(0, choice.level - 1)) });
		if (choice.detail) el.createEl('small', { text: choice.detail, cls: 'pw-suggest-detail' });
	}

	onChooseSuggestion(choice: SectionChoice): void {
		this.onPick(choice);
	}
}

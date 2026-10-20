import { App, FuzzySuggestModal, SuggestModal, TFile, setIcon } from 'obsidian';

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
	/** `onBack` adds an arrow left of the text box that returns to the previous step (picking the note). */
	constructor(app: App, private choices: SectionChoice[], private onPick: (choice: SectionChoice) => void, onBack?: () => void) {
		super(app);
		this.setPlaceholder('Pick a section, or the whole note');
		const row = this.inputEl.parentElement;
		if (!onBack || !row) return;
		row.addClass('pw-has-back');
		const back = row.createEl('button', { cls: 'pw-picker-back clickable-icon', attr: { 'aria-label': 'Pick another note' } });
		setIcon(back, 'arrow-left');
		row.insertBefore(back, this.inputEl);
		back.addEventListener('click', () => {
			this.close();
			onBack();
		});
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

/**
 * Two steps: the note, then a section of it. The section step has a back arrow, so a wrong note
 * can be swapped without starting over.
 */
export function pickNoteSection(app: App, placeholder: string, onPick: (file: TFile, choice: SectionChoice) => void): void {
	const pickNote = () =>
		new FilePickerModal(app, app.vault.getMarkdownFiles(), placeholder, (file) =>
			new SectionPickerModal(app, sectionsOf(app, file), (choice) => onPick(file, choice), pickNote).open(),
		).open();
	pickNote();
}

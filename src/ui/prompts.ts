import { App, Modal, Setting, SuggestModal } from 'obsidian';

/** Ask for a short text (e.g. a view name). */
export class TextPromptModal extends Modal {
	private value: string;

	constructor(app: App, private title: string, initial: string, private onSubmit: (value: string) => void) {
		super(app);
		this.value = initial;
	}

	onOpen() {
		this.setTitle(this.title);
		const submit = () => {
			const v = this.value.trim();
			if (!v) return;
			this.close();
			this.onSubmit(v);
		};
		new Setting(this.contentEl).addText((t) => {
			t.setValue(this.value).onChange((v) => (this.value = v));
			t.inputEl.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
			window.setTimeout(() => t.inputEl.select(), 0);
		});
		new Setting(this.contentEl).addButton((b) => b.setButtonText('Save').setCta().onClick(submit));
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Ask yes or no; resolves true only when the confirm button is pressed. */
export function confirm(app: App, title: string, message: string, cta: string): Promise<boolean> {
	return new Promise((resolve) => {
		const modal = new Modal(app);
		let answer = false;
		modal.setTitle(title);
		modal.contentEl.createEl('p', { text: message });
		new Setting(modal.contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => modal.close()))
			.addButton((b) =>
				b
					.setButtonText(cta)
					.setWarning()
					.onClick(() => {
						answer = true;
						modal.close();
					}),
			);
		modal.onClose = () => resolve(answer);
		modal.open();
	});
}

/** Pick one of a list of named items. */
export class NamedPickerModal<T extends { name: string }> extends SuggestModal<T> {
	constructor(app: App, private items: T[], placeholder: string, private onPick: (item: T) => void) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getSuggestions(query: string): T[] {
		const q = query.toLowerCase();
		return this.items.filter((i) => i.name.toLowerCase().includes(q));
	}

	renderSuggestion(item: T, el: HTMLElement) {
		el.setText(item.name);
	}

	onChooseSuggestion(item: T) {
		this.onPick(item);
	}
}

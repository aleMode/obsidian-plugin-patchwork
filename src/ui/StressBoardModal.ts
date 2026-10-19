import { App, Modal, Setting } from 'obsidian';

export class StressBoardModal extends Modal {
	private pages = 100;
	private modules = 3;

	constructor(app: App, private run: (pages: number, modulesPerPage: number) => void) {
		super(app);
	}

	onOpen() {
		this.setTitle('Generate stress board');
		this.contentEl.createEl('p', { text: 'Creates a board in the vault root from notes, PDF files and images in this vault, for profiling.' });
		const number = (name: string, value: number, set: (v: number) => void) =>
			new Setting(this.contentEl).setName(name).addText((t) => {
				t.inputEl.type = 'number';
				t.setValue(String(value)).onChange((v) => set(Number(v)));
			});
		number('Pages', this.pages, (v) => (this.pages = v));
		number('Modules per page', this.modules, (v) => (this.modules = v));
		new Setting(this.contentEl).addButton((b) =>
			b
				.setButtonText('Generate')
				.setCta()
				.onClick(() => {
					if (!(this.pages >= 1 && this.pages <= 5000 && this.modules >= 0 && this.modules <= 50)) return;
					this.close();
					this.run(Math.floor(this.pages), Math.floor(this.modules));
				}),
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}

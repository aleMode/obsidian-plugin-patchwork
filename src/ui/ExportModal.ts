import { App, Modal, normalizePath, Notice, Setting, TFile } from 'obsidian';

export interface ExportChoices {
	path: string;
	quality: 'best' | 'small';
	dpi: number;
	open: boolean;
}

/** Export options for M0: native page size only. Sheets, tiling and ranges come in M2. */
export class ExportModal extends Modal {
	private choices: ExportChoices;
	private warning!: HTMLElement;

	constructor(app: App, initial: ExportChoices, private run: (choices: ExportChoices) => void) {
		super(app);
		this.choices = { ...initial };
	}

	onOpen() {
		this.setTitle('Export board to PDF');
		new Setting(this.contentEl)
			.setName('File')
			.setDesc('Vault path of the PDF to write.')
			.addText((t) =>
				t.setValue(this.choices.path).onChange((v) => {
					this.choices.path = v;
					this.updateWarning();
				}),
			);
		this.warning = this.contentEl.createDiv({ cls: 'pw-export-warning' });
		this.updateWarning();
		new Setting(this.contentEl)
			.setName('Quality')
			.setDesc('Best quality keeps PDF regions as sharp, selectable vector content (larger files). Smallest file turns them into images.')
			.addDropdown((d) =>
				d
					.addOption('best', 'Best quality')
					.addOption('small', 'Smallest file')
					.setValue(this.choices.quality)
					.onChange((v) => (this.choices.quality = v as 'best' | 'small')),
			);
		new Setting(this.contentEl)
			.setName('Image resolution')
			.setDesc('Dots per inch for PDF regions exported as images.')
			.addText((t) => {
				t.inputEl.type = 'number';
				t.setValue(String(this.choices.dpi)).onChange((v) => (this.choices.dpi = Number(v)));
			});
		new Setting(this.contentEl).setName('Open after export').addToggle((t) => t.setValue(this.choices.open).onChange((v) => (this.choices.open = v)));
		new Setting(this.contentEl).addButton((b) =>
			b
				.setButtonText('Export')
				.setCta()
				.onClick(() => this.submit()),
		);
	}

	private updateWarning() {
		const path = this.normalized();
		const exists = this.app.vault.getAbstractFileByPath(path) instanceof TFile;
		this.warning.setText(exists ? `${path} already exists and will be replaced.` : '');
	}

	private normalized(): string {
		const p = normalizePath(this.choices.path.trim());
		return p.toLowerCase().endsWith('.pdf') ? p : `${p}.pdf`;
	}

	private submit() {
		if (!(this.choices.dpi >= 36 && this.choices.dpi <= 1200)) return void new Notice('Image resolution must be between 36 and 1200 dots per inch.');
		this.close();
		this.run({ ...this.choices, path: this.normalized() });
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

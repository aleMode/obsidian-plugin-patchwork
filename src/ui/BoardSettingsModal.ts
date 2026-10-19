import { App, Modal, Setting } from 'obsidian';
import type { BoardSettings, DisplayUnit } from '../model/schema';
import { formatLength, parseLength } from '../model/units';

/** Board-level options (SPEC 6 BoardSettings) until the inspector exists. Applied as one undo step. */
export class BoardSettingsModal extends Modal {
	private draft: BoardSettings;

	constructor(app: App, current: BoardSettings, private apply: (next: BoardSettings) => void) {
		super(app);
		this.draft = structuredClone(current);
	}

	onOpen() {
		this.setTitle('Board settings');
		const d = this.draft;
		new Setting(this.contentEl)
			.setName('Display unit')
			.setDesc('Rulers and labels. The file always stores millimetres.')
			.addDropdown((dd) =>
				dd
					.addOption('mm', 'Millimetres')
					.addOption('cm', 'Centimetres')
					.addOption('in', 'Inches')
					.setValue(d.displayUnit)
					.onChange((v) => (d.displayUnit = v as DisplayUnit)),
			);
		new Setting(this.contentEl)
			.setName('Grid size')
			.setDesc('For example "5", "0.5 cm" or "0.25 in".')
			.addText((t) =>
				t.setValue(formatLength(d.grid.size, d.displayUnit)).onChange((v) => {
					const mm = parseLength(v, d.displayUnit);
					if (mm !== null && mm > 0) d.grid.size = mm;
				}),
			);
		new Setting(this.contentEl).setName('Snap to grid').addToggle((t) => t.setValue(d.grid.snap).onChange((v) => (d.grid.snap = v)));
		new Setting(this.contentEl).setName('Show grid').addToggle((t) => t.setValue(d.grid.visible).onChange((v) => (d.grid.visible = v)));
		new Setting(this.contentEl)
			.setName('Use app theme for pages')
			.setDesc('Off: pages always look like white paper, also in dark mode and in exports.')
			.addToggle((t) => t.setValue(d.useAppTheme).onChange((v) => (d.useAppTheme = v)));
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText('Apply')
					.setCta()
					.onClick(() => {
						this.close();
						this.apply(this.draft);
					}),
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}

import { App, PluginSettingTab, Setting } from 'obsidian';
import type PatchworkPlugin from './main';

export interface PatchworkSettings {
	/** Memory for cached PDF renders (SPEC 8: default 512 MB). */
	bitmapBudgetMB: number;
	/** The red dashed line on a box whose text doesn't fit. Screen only; never exported. */
	showOverflowMarker: boolean;
	/** The floating outline and views panel: open or not, and where it was dragged to (pixels, relative to the board). */
	outlineOpen: boolean;
	outlinePos: { x: number; y: number } | null;
	/** The minimap in the corner of the board. */
	showMinimap: boolean;
}

export const DEFAULT_SETTINGS: PatchworkSettings = {
	bitmapBudgetMB: 512,
	showOverflowMarker: true,
	outlineOpen: false,
	outlinePos: null,
	showMinimap: true,
};

export class PatchworkSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: PatchworkPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl)
			.setName('PDF render cache')
			.setDesc('Memory, in megabytes, for keeping rendered PDF regions so pages you return to appear instantly.')
			.addText((t) => {
				t.inputEl.type = 'number';
				t.setValue(String(this.plugin.settings.bitmapBudgetMB)).onChange(async (v) => {
					const mb = Number(v);
					if (!(mb >= 32 && mb <= 8192)) return;
					this.plugin.settings.bitmapBudgetMB = mb;
					this.plugin.bitmaps.setBudgetMB(mb);
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName('Overflow marker')
			.setDesc('Show a red dashed line along the bottom of a box whose text does not fit. On screen only; it is never exported.')
			.addToggle((t) => t.setValue(this.plugin.settings.showOverflowMarker).onChange((v) => void this.plugin.setOverflowMarker(v)));
	}
}

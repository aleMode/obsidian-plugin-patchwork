import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from 'obsidian';
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
	/** The export dialog's "Open after export", as last chosen (a personal habit, not part of a patchwork). */
	openAfterExport: boolean;
}

export const DEFAULT_SETTINGS: PatchworkSettings = {
	bitmapBudgetMB: 512,
	showOverflowMarker: true,
	outlineOpen: false,
	outlinePos: null,
	showMinimap: true,
	openAfterExport: true,
};

const CACHE = { name: 'PDF render cache', desc: 'Memory, in megabytes, for keeping rendered PDF regions so pages you return to appear instantly.' };
const MARKER = { name: 'Overflow marker', desc: 'Show a red dashed line along the bottom of a box whose text does not fit. On screen only; it is never exported.' };
const validBudget = (mb: number) => mb >= 32 && mb <= 8192;

export class PatchworkSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: PatchworkPlugin) {
		super(app, plugin);
	}

	/**
	 * Obsidian 1.13+ draws the tab from these (and finds them in its settings search); older versions
	 * call `display()`. Both write through `setControlValue`, so the side effects are the same.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: CACHE.name, desc: CACHE.desc, aliases: ['memory', 'PDF'], control: { type: 'number', key: 'bitmapBudgetMB', min: 32, max: 8192, defaultValue: DEFAULT_SETTINGS.bitmapBudgetMB, validate: (mb) => (validBudget(mb) ? undefined : 'Between 32 and 8192 MB.') } },
			{ name: MARKER.name, desc: MARKER.desc, aliases: ['overflow', 'cut off'], control: { type: 'toggle', key: 'showOverflowMarker', defaultValue: DEFAULT_SETTINGS.showOverflowMarker } },
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'bitmapBudgetMB' && typeof value === 'number' && validBudget(value)) {
			this.plugin.settings.bitmapBudgetMB = value;
			this.plugin.bitmaps.setBudgetMB(value);
			await this.plugin.saveSettings();
		} else if (key === 'showOverflowMarker' && typeof value === 'boolean') await this.plugin.setOverflowMarker(value);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl)
			.setName(CACHE.name)
			.setDesc(CACHE.desc)
			.addText((t) => {
				t.inputEl.type = 'number';
				t.setValue(String(this.plugin.settings.bitmapBudgetMB)).onChange((v) => void this.setControlValue('bitmapBudgetMB', Number(v)));
			});
		new Setting(containerEl)
			.setName(MARKER.name)
			.setDesc(MARKER.desc)
			.addToggle((t) => t.setValue(this.plugin.settings.showOverflowMarker).onChange((v) => void this.setControlValue('showOverflowMarker', v)));
	}
}

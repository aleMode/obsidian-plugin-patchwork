import { type App, Modal, Platform } from 'obsidian';

// "Keyboard and mouse" (View menu): every board gesture in one place, since most are invisible.

const MOD = Platform.isMacOS ? 'Cmd' : 'Ctrl';

const GROUPS: [string, [string, string][]][] = [
	[
		'Moving around',
		[
			['Wheel, or drag empty space', 'Pan (also the middle button, or Space + drag)'],
			['Shift + wheel', 'Pan sideways'],
			[`${MOD} + wheel, or pinch`, 'Zoom'],
			[`${MOD} + 0`, 'Zoom to fit'],
			[`${MOD} + 1`, 'Zoom to 100 %'],
			['Wheel over a selected note that is cut off', 'Scroll its text'],
		],
	],
	[
		'Selecting',
		[
			['Click', 'Select a page or an item'],
			['Shift + click', 'Add to or remove from the selection'],
			['Shift + drag on empty paper', 'Select everything the box touches'],
			['Esc', 'Deselect (or close the properties, or stop drawing a shape)'],
			['Right-click', 'Menu for the item, the page or the selection'],
		],
	],
	[
		'Arranging',
		[
			['Drag', 'Move (snaps to the grid; hold Alt to place freely)'],
			['Drag a handle', 'Resize (Shift keeps the proportions)'],
			['Arrow keys', 'Nudge 1 mm (Shift: 10 mm)'],
			[`${MOD} + D`, 'Duplicate'],
			[`${MOD} + C, ${MOD} + X, ${MOD} + V`, 'Copy, cut, paste (also between patchworks); pasting text makes a text box, an image is saved and placed'],
			['Delete or Backspace', 'Delete'],
			[`${MOD} + Z, ${MOD} + Shift + Z`, 'Undo, redo'],
		],
	],
	[
		'Editing',
		[
			['Double-click or Enter', 'Edit a text box or note where it is'],
			['Double-click a PDF region', 'Crop it'],
			['+ and − on a counter or boxes', 'Step it'],
		],
	],
	[
		'Use mode',
		[
			['Click a link', 'Open it in a pane to the side'],
			[`${MOD} + click a link`, 'Open it in a new tab'],
			['Click a checkbox', 'Tick it in the note (or the text box)'],
		],
	],
];

export class ShortcutsModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		this.setTitle('Keyboard and mouse');
		this.modalEl.addClass('pw-shortcuts');
		for (const [title, rows] of GROUPS) {
			this.contentEl.createEl('h4', { text: title });
			const table = this.contentEl.createEl('table');
			for (const [keys, what] of rows) {
				const tr = table.createEl('tr');
				tr.createEl('td', { cls: 'pw-shortcut-keys', text: keys });
				tr.createEl('td', { text: what });
			}
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}

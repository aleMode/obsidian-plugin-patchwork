import { Notice, Plugin, TFile, TFolder } from 'obsidian';
import { newBoardFile } from './model/defaults';
import { presetById } from './model/presets';
import { serializeBoard } from './model/serialize';
import { BOARD_EXTENSION, PatchworkView, VIEW_TYPE_BOARD } from './view/PatchworkView';
import { createBoardSurface } from './view/BoardSurface';

export default class PatchworkPlugin extends Plugin {
	async onload() {
		this.registerView(VIEW_TYPE_BOARD, (leaf) => new PatchworkView(leaf, createBoardSurface));
		this.registerExtensions([BOARD_EXTENSION], VIEW_TYPE_BOARD);

		this.addCommand({
			id: 'new-board',
			name: 'New board',
			callback: () => void this.createBoard(this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path ?? '')),
		});

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (!(file instanceof TFolder)) return;
				menu.addItem((item) =>
					item
						.setTitle('New board')
						.setIcon('layout-dashboard')
						.onClick(() => void this.createBoard(file)),
				);
			}),
		);
	}

	onunload() {}

	async createBoard(folder: TFolder): Promise<TFile | null> {
		const path = this.availablePath(folder, 'Untitled board');
		const file = newBoardFile({ created: new Date().toISOString().slice(0, 10), firstPage: presetById('A4') });
		try {
			const created = await this.app.vault.create(path, serializeBoard(file));
			await this.app.workspace.getLeaf(true).openFile(created);
			return created;
		} catch (e) {
			new Notice(`Patchwork: could not create the board: ${e instanceof Error ? e.message : String(e)}`);
			return null;
		}
	}

	/** "Untitled board.patchwork", then "Untitled board 1.patchwork", … in the given folder. */
	private availablePath(folder: TFolder, base: string): string {
		const prefix = folder.isRoot() ? '' : `${folder.path}/`;
		for (let i = 0; ; i++) {
			const path = `${prefix}${base}${i ? ` ${i}` : ''}.${BOARD_EXTENSION}`;
			if (!this.app.vault.getAbstractFileByPath(path)) return path;
		}
	}
}

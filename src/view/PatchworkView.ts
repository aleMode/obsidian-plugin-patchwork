import { Modal, Notice, Scope, TextFileView, TFile, WorkspaceLeaf } from 'obsidian';
import { serializeBoard } from '../model/serialize';
import { parseBoard } from '../model/validate';
import { BoardStore } from '../store/BoardStore';
import { conflictCopyName, decideSave } from '../store/saveGuard';
import { renderErrorView } from './errorView';

export const VIEW_TYPE_BOARD = 'patchwork-board';
export const BOARD_EXTENSION = 'patchwork';

/** Something that draws the board inside the view; the view owns file I/O, the surface owns pixels. */
export interface BoardSurface {
	destroy(): void;
}
export type SurfaceFactory = (container: HTMLElement, store: BoardStore, view: PatchworkView) => BoardSurface;

export class PatchworkView extends TextFileView {
	store: BoardStore | null = null;
	/** Text last read from or written to disk. Basis for the external-change check. */
	private lastDisk = '';
	private dirty = false;
	/** Set when the file failed to parse: the view must never write to it (hard rule 2). */
	private broken = false;
	surface: BoardSurface | null = null;
	private unsubscribe: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf, private makeSurface: SurfaceFactory) {
		super(leaf);
		// Board shortcuts (e.g. Mod+D) must win over Obsidian's global hotkeys while the board is active.
		this.scope = new Scope(this.app.scope);
	}

	getViewType() {
		return VIEW_TYPE_BOARD;
	}

	getDisplayText() {
		return this.file?.basename ?? 'Patchwork board';
	}

	getIcon() {
		return 'layout-dashboard';
	}

	getViewData(): string {
		if (!this.store || this.broken || this.store.readOnly) return this.lastDisk;
		return serializeBoard(this.store.file);
	}

	setViewData(data: string, clear: boolean): void {
		// Obsidian reloads the view on any outside change, even with unsaved edits pending, which
		// would silently drop them. Keep ours in a conflict copy before loading the disk version.
		const file = this.file;
		const lostEdits = !clear && this.dirty && this.store && !this.broken && file && data !== this.lastDisk ? this.getViewData() : null;
		this.loadBoard(data);
		if (lostEdits !== null && file) void this.keepConflictCopy(file, lostEdits, false);
	}

	private loadBoard(data: string) {
		this.teardown();
		this.lastDisk = data;
		this.dirty = false;
		const result = parseBoard(data);
		if (!result.ok) {
			this.broken = true;
			renderErrorView(this.contentEl, result.errors, data, () => void this.reloadFromDisk());
			return;
		}
		this.broken = false;
		// A reload from disk (external change) starts a fresh store, which also clears undo history.
		this.store = new BoardStore(result.file, { readOnly: result.readOnly });
		this.unsubscribe = this.store.subscribe(() => {
			this.dirty = true;
			this.requestSave();
		});
		this.contentEl.empty();
		this.contentEl.addClass('pw-view');
		this.showWarnings(result.warnings, result.readOnly);
		this.surface = this.makeSurface(this.contentEl.createDiv({ cls: 'pw-surface-host' }), this.store, this);
	}

	clear(): void {
		this.teardown();
		this.lastDisk = '';
		this.dirty = false;
		this.broken = false;
	}

	async save(clear?: boolean): Promise<void> {
		const file = this.file;
		if (this.broken || !this.store || this.store.readOnly || !file) {
			if (clear) this.clear();
			return;
		}
		const ours = this.getViewData();
		// The board was deleted (or moved away) while a save was pending: nothing to write to.
		if (!(this.app.vault.getAbstractFileByPath(file.path) instanceof TFile)) {
			if (clear) this.clear();
			return;
		}
		let onDisk: string;
		try {
			onDisk = await this.app.vault.read(file);
		} catch {
			if (clear) this.clear();
			return;
		}
		switch (decideSave(this.lastDisk, onDisk, this.dirty, ours)) {
			case 'write':
				await super.save(clear);
				this.lastDisk = ours;
				this.dirty = false;
				return;
			case 'reload':
				if (!clear) this.loadBoard(onDisk);
				break;
			case 'conflict':
				if (!clear) this.loadBoard(onDisk);
				await this.keepConflictCopy(file, ours, !!clear);
				break;
			case 'none':
				this.lastDisk = onDisk;
				this.dirty = false;
				break;
		}
		if (clear) this.clear();
	}

	/**
	 * Never lose either side: the view already shows the disk version; our version goes to a
	 * conflict copy, with an offer to put it back.
	 */
	private async keepConflictCopy(file: TFile, ours: string, closing: boolean) {
		const folder = file.parent?.path ?? '';
		const name = conflictCopyName(file.basename, file.extension, new Date());
		const copy = await this.app.vault.create(folder && folder !== '/' ? `${folder}/${name}` : name, ours);
		if (closing) {
			new Notice(`Patchwork: "${file.name}" changed on disk while you were editing. Your version was saved as "${copy.path}".`, 0);
			return;
		}
		new ConflictModal(this, file.name, copy.path, async () => {
			await this.app.vault.modify(file, ours);
			if (this.file === file) this.loadBoard(ours);
			await this.app.fileManager.trashFile(copy);
		}).open();
	}

	private async reloadFromDisk() {
		if (this.file) this.loadBoard(await this.app.vault.read(this.file));
	}

	private showWarnings(warnings: string[], readOnly: boolean) {
		if (warnings.length === 0) return;
		const bar = this.contentEl.createDiv({ cls: `pw-banner ${readOnly ? 'pw-banner-readonly' : ''}` });
		for (const w of warnings) bar.createDiv({ text: w });
		if (!readOnly) bar.createEl('button', { text: 'Dismiss' }, (b) => b.addEventListener('click', () => bar.remove()));
	}

	private teardown() {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.surface?.destroy();
		this.surface = null;
		this.store = null;
		this.contentEl.empty();
	}
}

class ConflictModal extends Modal {
	constructor(view: PatchworkView, private fileName: string, private copyPath: string, private keepMine: () => Promise<void>) {
		super(view.app);
	}

	onOpen() {
		this.setTitle('Board changed on disk');
		this.contentEl.createEl('p', {
			text: `"${this.fileName}" was changed outside this view (for example by Sync or git) while you had unsaved edits. The board now shows the version on disk. Your version is saved as "${this.copyPath}".`,
		});
		const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
		buttons.createEl('button', { text: 'Keep version on disk', cls: 'mod-cta' }, (b) => b.addEventListener('click', () => this.close()));
		buttons.createEl('button', { text: 'Use my version' }, (b) =>
			b.addEventListener('click', () => {
				void this.keepMine().then(() => this.close());
			}),
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}

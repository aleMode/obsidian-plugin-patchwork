import { Menu, Modal, Notice, Scope, TextFileView, TFile, WorkspaceLeaf } from 'obsidian';
import { serializeBoard } from '../model/serialize';
import type { PatchworkFile } from '../model/schema';
import { parseBoard } from '../model/validate';
import { BoardStore } from '../store/BoardStore';
import { conflictCopyName, decideSave } from '../store/saveGuard';
import { renderErrorView } from './errorView';

export const VIEW_TYPE_BOARD = 'patchwork-board';
export const BOARD_EXTENSION = 'patchwork';

/** Something that draws the board inside the view; the view owns file I/O, the surface owns pixels. */
export interface BoardSurface {
	destroy(): void;
	/** Entries for the view's ⋮ menu (export and the like), so they are not only reachable as commands. */
	addViewMenuItems?(menu: Menu): void;
}
export type SurfaceFactory = (container: HTMLElement, store: BoardStore, view: PatchworkView) => BoardSurface;

export class PatchworkView extends TextFileView {
	store: BoardStore | null = null;
	/** Text last read from or written to disk. Basis for the external-change check. */
	private lastDisk = '';
	private serialized: { file: PatchworkFile; text: string } | null = null;
	/** Edits not yet on disk. (Not `dirty` or `saving`: TextFileView uses those names internally.) */
	private unsaved = false;
	/** Set when the file failed to parse: the view must never write to it (hard rule 2). */
	private broken = false;
	surface: BoardSurface | null = null;
	private unsubscribe: (() => void) | null = null;
	/** The save in progress; saves run one at a time. */
	private saveQueue: Promise<void> = Promise.resolve();

	constructor(leaf: WorkspaceLeaf, private makeSurface: SurfaceFactory) {
		super(leaf);
		// Board shortcuts (e.g. Mod+D) must win over Obsidian's global hotkeys while the board is active.
		this.scope = new Scope(this.app.scope);
	}

	get hasUnsavedEdits(): boolean {
		return this.unsaved;
	}

	getViewType() {
		return VIEW_TYPE_BOARD;
	}

	getDisplayText() {
		return this.file?.basename ?? 'Patchwork';
	}

	getIcon() {
		return 'layout-dashboard';
	}

	getViewData(): string {
		if (!this.store || this.broken || this.store.readOnly) return this.lastDisk;
		// A save asks several times (before reading the disk, inside TextFileView.save, after the write);
		// snapshots are immutable, so one serialization per snapshot is enough.
		const file = this.store.file;
		if (this.serialized?.file !== file) this.serialized = { file, text: serializeBoard(file) };
		return this.serialized.text;
	}

	setViewData(data: string, clear: boolean): void {
		// Obsidian reloads the view on any outside change, even with unsaved edits pending, which
		// would silently drop them. Keep ours in a conflict copy before loading the disk version.
		const file = this.file;
		const lostEdits = !clear && this.unsaved && this.store && !this.broken && file && data !== this.lastDisk ? this.getViewData() : null;
		this.loadBoard(data);
		if (lostEdits !== null && file) void this.keepConflictCopy(file, lostEdits, false);
	}

	private loadBoard(data: string) {
		this.teardown();
		this.lastDisk = data;
		this.unsaved = false;
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
			this.unsaved = true;
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
		this.unsaved = false;
		this.broken = false;
	}

	/**
	 * Saves run one after another: two overlapping saves (the debounced one and an explicit one, e.g. a
	 * rename rewrite) would each take the other's write for an outside change and make a conflict copy.
	 */
	save(clear?: boolean): Promise<void> {
		const run = this.saveQueue.then(() => this.saveNow(clear));
		this.saveQueue = run.catch(() => undefined);
		return run;
	}

	private async saveNow(clear?: boolean): Promise<void> {
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
		switch (decideSave(this.lastDisk, onDisk, this.unsaved, ours)) {
			case 'write':
				await super.save(clear);
				// What was written (`data`), which includes any edit made while the file was being read.
				this.lastDisk = this.data;
				// An edit that arrived during the write is still unsaved.
				this.unsaved = !clear && !!this.store && this.getViewData() !== this.data;
				return;
			case 'reload':
				if (!clear) this.loadBoard(onDisk);
				break;
			case 'conflict':
				// Our version is put somewhere safe before the disk version replaces it; if that fails the
				// board keeps showing ours (still unsaved), so nothing is lost.
				if ((await this.keepConflictCopy(file, ours, !!clear)) && !clear) this.loadBoard(onDisk);
				break;
			case 'none':
				this.lastDisk = onDisk;
				this.unsaved = false;
				break;
		}
		if (clear) this.clear();
	}

	/**
	 * Never lose either side: the view shows the disk version; our version goes to a conflict copy, with
	 * an offer to put it back. Returns false when no copy could be written; the text is then offered for
	 * the clipboard instead.
	 */
	private async keepConflictCopy(file: TFile, ours: string, closing: boolean): Promise<boolean> {
		let copy: TFile;
		try {
			copy = await this.app.vault.create(this.freeConflictPath(file), ours);
		} catch (e) {
			offerClipboard(file.name, ours, e);
			return false;
		}
		if (closing) {
			new Notice(`Patchwork: "${file.name}" changed on disk while you were editing. Your version was saved as "${copy.path}".`, 0);
			return true;
		}
		new ConflictModal(this, file.name, copy.path, async () => {
			await this.app.vault.modify(file, ours);
			if (this.file === file) this.loadBoard(ours);
			await this.app.fileManager.trashFile(copy);
		}).open();
		return true;
	}

	/** A conflict copy path next to the board that no file uses yet (two conflicts can fall in one minute). */
	private freeConflictPath(file: TFile): string {
		const folder = file.parent?.path ?? '';
		const now = new Date();
		for (let n = 1; ; n++) {
			const name = conflictCopyName(file.basename, file.extension, now, n);
			const path = folder && folder !== '/' ? `${folder}/${name}` : name;
			if (!this.app.vault.getAbstractFileByPath(path)) return path;
		}
	}

	private async reloadFromDisk() {
		if (this.file) this.loadBoard(await this.app.vault.read(this.file));
	}

	onPaneMenu(menu: Menu, source: string) {
		super.onPaneMenu(menu, source);
		if (source === 'more-options') this.surface?.addViewMenuItems?.(menu);
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

/** Last resort when a conflict copy can't be written: keep the user's version one click from the clipboard. */
function offerClipboard(fileName: string, text: string, error: unknown) {
	const why = error instanceof Error ? error.message : String(error);
	const frag = createFragment((f) => {
		f.createDiv({ text: `Patchwork: "${fileName}" changed on disk while you were editing, and your version could not be saved as a copy (${why}).` });
		f.createEl('button', { text: 'Copy my version' }, (b) =>
			b.addEventListener('click', (e) => {
				e.stopPropagation();
				void navigator.clipboard.writeText(text).then(() => new Notice('Copied. Paste it into a new .patchwork file to keep it.'));
			}),
		);
	});
	new Notice(frag, 0);
}

class ConflictModal extends Modal {
	constructor(view: PatchworkView, private fileName: string, private copyPath: string, private keepMine: () => Promise<void>) {
		super(view.app);
	}

	onOpen() {
		this.setTitle('Patchwork changed on disk');
		this.contentEl.createEl('p', {
			text: `"${this.fileName}" was changed outside this view (for example by Sync or git) while you had unsaved edits. It now shows the version on disk. Your version is saved as "${this.copyPath}".`,
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

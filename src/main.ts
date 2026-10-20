import { Notice, Plugin, TFile, TFolder } from 'obsidian';
import { newBoardFile } from './model/defaults';
import { presetById } from './model/presets';
import { serializeBoard } from './model/serialize';
import { generateStressBoard, type StressSources } from './model/stress';
import { StressBoardModal } from './ui/StressBoardModal';
import { BitmapCache } from './render/bitmapCache';
import { DEFAULT_SETTINGS, type PatchworkSettings, PatchworkSettingTab } from './settings';
import { onVaultRename } from './sources/linkTracker';
import { PdfDocCache } from './sources/pdfSource';
import { ActiveBoard } from './view/activeBoard';
import { BoardViewport } from './view/BoardViewport';
import { InspectorView, VIEW_TYPE_INSPECTOR } from './view/InspectorView';
import { OutlineView, VIEW_TYPE_OUTLINE } from './view/OutlineView';
import { refreshPaperScope, removePaperScope } from './view/paperScope';
import { BOARD_EXTENSION, PatchworkView, VIEW_TYPE_BOARD } from './view/PatchworkView';

export default class PatchworkPlugin extends Plugin {
	pdfDocs!: PdfDocCache;
	bitmaps!: BitmapCache;
	settings: PatchworkSettings = { ...DEFAULT_SETTINGS };
	activeBoard = new ActiveBoard();

	async onload() {
		this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<PatchworkSettings> | null) };
		this.pdfDocs = new PdfDocCache(this.app);
		this.bitmaps = new BitmapCache(this.settings.bitmapBudgetMB);
		// A modified PDF must not show stale renders (keys include mtime; this frees the memory too).
		this.registerEvent(this.app.vault.on('modify', (f) => this.bitmaps.invalidateFile(f.path)));
		this.addSettingTab(new PatchworkSettingTab(this.app, this));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => void onVaultRename(this.app, oldPath, file.path)));
		const services = {
			pdfDocs: this.pdfDocs,
			bitmaps: this.bitmaps,
			closed: (b: BoardViewport) => this.activeBoard.closed(b),
			openPanels: () => void this.openPanels(),
		};
		this.registerView(VIEW_TYPE_BOARD, (leaf) =>
			new PatchworkView(leaf, (el, store, view) => {
				const board = new BoardViewport(el, store, view, services);
				// A freshly loaded board is the one the user is looking at.
				if (this.app.workspace.getActiveViewOfType(PatchworkView) === view || !this.activeBoard.get()) this.activeBoard.set(board);
				return board;
			}),
		);
		this.registerView(VIEW_TYPE_INSPECTOR, (leaf) => new InspectorView(leaf, this.activeBoard));
		this.registerView(VIEW_TYPE_OUTLINE, (leaf) => new OutlineView(leaf, this.activeBoard));
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				const view = leaf?.view;
				if (view instanceof PatchworkView && view.surface instanceof BoardViewport) this.activeBoard.set(view.surface);
			}),
		);
		this.addCommand({ id: 'open-panels', name: 'Open inspector and outline', callback: () => void this.openPanels() });
		this.registerExtensions([BOARD_EXTENSION], VIEW_TYPE_BOARD);

		refreshPaperScope();
		this.registerEvent(this.app.workspace.on('css-change', () => refreshPaperScope()));

		this.addCommand({
			id: 'new-board',
			name: 'New board',
			callback: () => void this.createBoard(this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path ?? '')),
		});
		this.addBoardCommand('add-page', 'Add page', (v) => v.showAddPageMenu(), true);
		this.addBoardCommand('add-note', 'Add note to page', (v) => v.pickNote(), true);
		this.addBoardCommand('add-pdf', 'Add PDF to page', (v) => v.pickPdf(), true);
		this.addBoardCommand('zoom-to-fit', 'Zoom to fit', (v) => v.zoomToFit());
		this.addBoardCommand('export', 'Export…', (v) => v.showExport());
		this.addBoardCommand('board-settings', 'Board settings…', (v) => v.showBoardSettings(), true);

		this.addCommand({
			id: 'generate-stress-board',
			name: 'Generate stress board',
			callback: () => new StressBoardModal(this.app, (pages, modulesPerPage) => void this.createStressBoard(pages, modulesPerPage)).open(),
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

	onunload() {
		removePaperScope();
		this.pdfDocs.destroyAll();
		this.bitmaps.clear();
	}

	/** Show the inspector and outline in the right sidebar (creating them once). */
	async openPanels() {
		const ws = this.app.workspace;
		// A collapsed sidebar would hide the panels even though they're open.
		if ('expand' in ws.rightSplit && ws.rightSplit.collapsed) ws.rightSplit.expand();
		for (const type of [VIEW_TYPE_INSPECTOR, VIEW_TYPE_OUTLINE]) {
			let leaf = ws.getLeavesOfType(type)[0];
			if (!leaf) {
				leaf = ws.getRightLeaf(type === VIEW_TYPE_OUTLINE) ?? undefined;
				await leaf?.setViewState({ type, active: false });
			}
			if (leaf) ws.setActiveLeaf(leaf, { focus: false });
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/** A command that only shows up while a board is the active view. */
	private addBoardCommand(id: string, name: string, run: (v: BoardViewport) => void, needsWrite = false) {
		this.addCommand({
			id,
			name,
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(PatchworkView);
				const surface = view?.surface;
				if (!(surface instanceof BoardViewport) || (needsWrite && view?.store?.readOnly)) return false;
				if (!checking) run(surface);
				return true;
			},
		});
	}

	async createBoard(folder: TFolder, content = newBoardFile({ created: new Date().toISOString().slice(0, 10), firstPage: presetById('A4') }), base = 'Untitled board'): Promise<TFile | null> {
		const path = this.availablePath(folder, base);
		try {
			const created = await this.app.vault.create(path, serializeBoard(content));
			await this.app.workspace.getLeaf(true).openFile(created);
			return created;
		} catch (e) {
			new Notice(`Patchwork: could not create the board: ${e instanceof Error ? e.message : String(e)}`);
			return null;
		}
	}

	/** A board of N pages × M modules built from files in the vault, for profiling (SPEC 8.9). */
	async createStressBoard(pages: number, modulesPerPage: number): Promise<TFile | null> {
		const files = this.app.vault.getFiles();
		const sources: StressSources = {
			notes: files.filter((f) => f.extension === 'md').slice(0, 200).map((f) => f.path),
			images: files.filter((f) => /^(png|jpe?g|webp|gif)$/i.test(f.extension)).slice(0, 50).map((f) => f.path),
			pdfs: [],
		};
		for (const f of files.filter((x) => x.extension.toLowerCase() === 'pdf').slice(0, 10)) {
			try {
				const doc = await this.pdfDocs.acquire(f.path);
				sources.pdfs.push({ path: f.path, pages: doc.numPages });
				this.pdfDocs.release(f.path);
			} catch {
				// Unreadable PDFs are simply not used.
			}
		}
		const board = generateStressBoard(sources, { pages, modulesPerPage, seed: 1 });
		return this.createBoard(this.app.vault.getRoot(), board, `Stress board ${pages}x${modulesPerPage}`);
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

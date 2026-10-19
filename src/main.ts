import { Notice, Plugin, TFile, TFolder } from 'obsidian';
import { newBoardFile } from './model/defaults';
import { presetById } from './model/presets';
import { serializeBoard } from './model/serialize';
import { generateStressBoard, type StressSources } from './model/stress';
import { StressBoardModal } from './ui/StressBoardModal';
import { PdfDocCache } from './sources/pdfSource';
import { BoardViewport } from './view/BoardViewport';
import { refreshPaperScope, removePaperScope } from './view/paperScope';
import { BOARD_EXTENSION, PatchworkView, VIEW_TYPE_BOARD } from './view/PatchworkView';

export default class PatchworkPlugin extends Plugin {
	pdfDocs!: PdfDocCache;

	async onload() {
		this.pdfDocs = new PdfDocCache(this.app);
		const services = { pdfDocs: this.pdfDocs };
		this.registerView(VIEW_TYPE_BOARD, (leaf) => new PatchworkView(leaf, (el, store, view) => new BoardViewport(el, store, view, services)));
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

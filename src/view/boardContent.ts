import { type App, Notice, TFile } from 'obsidian';
import { allIds } from '../model/defaults';
import { flowChains, NO_FRAMES_ON_MASTERS, placeNextFrame } from '../model/flow';
import type { Point } from '../model/geometry';
import { newId } from '../model/ids';
import { today } from '../model/numbering';
import type { AnyModule, FrameModule, ImageModule, NoteModule, Page, PdfModule, TrackerModule } from '../model/schema';
import { isImage, isPdf } from '../sources/fileKinds';
import { loadNoteContent } from '../sources/markdownSource';
import { pdfSourceId } from '../sources/pdfSource';
import { addModule, defaultModuleRect, findModule, mapModule } from '../store/pageOps';
import { CropModal, type CropResult } from '../ui/CropModal';
import { FilePickerModal, pickNoteSection } from '../ui/pickers';
import type { BoardViewport } from './BoardViewport';

// Putting content on a board: pickers for notes, PDFs and images, new text boxes, trackers and
// tables of contents, the crop editor, linked frames, freezing, and files dropped from the explorer.
// BoardViewport forwards its public actions here.

export function pickNote(board: BoardViewport) {
	pickNoteSection(board.app, 'Note to add', (file, choice) =>
		board.placeModule((page, id): NoteModule => ({
			id,
			type: 'note',
			...defaultModuleRect(page),
			file: file.path,
			...(choice.subpath ? { subpath: choice.subpath } : {}),
		})),
	);
}

/** Point a module at another file, e.g. after its note, PDF or image was deleted (SPEC 5.3). */
export function replaceSource(board: BoardViewport, pageId: string, moduleId: string) {
	const m = findModule(board.boardStore.file, pageId, moduleId);
	if (!m || board.boardStore.readOnly) return;
	const app = board.app;
	const set = (patch: (x: AnyModule) => AnyModule) => board.boardStore.update((f) => mapModule(f, pageId, moduleId, patch));
	if (m.type === 'note') {
		pickNoteSection(app, 'Note to show', (file, choice) =>
			set((x) => {
				const next = { ...x, file: file.path } as NoteModule;
				if (choice.subpath) next.subpath = choice.subpath;
				else delete next.subpath;
				delete next.lines;
				return next;
			}),
		);
	} else if (m.type === 'image') {
		new FilePickerModal(app, app.vault.getFiles().filter(isImage), 'Image to show', (file) => set((x) => ({ ...x, file: file.path }))).open();
	} else if (m.type === 'pdf') {
		// A different file: page and crop are kept, and the crop editor opens to check them.
		new FilePickerModal(app, app.vault.getFiles().filter(isPdf), 'PDF to show', (file) => {
			set((x) => {
				const next = { ...x, file: file.path } as PdfModule;
				delete next.sourceId;
				return next;
			});
			editCrop(board, pageId, moduleId);
		}).open();
	}
}

/** A free markdown box (SPEC 5.3 text module), edited in the inspector. */
export function addText(board: BoardViewport) {
	board.placeModule((page, id) => ({ id, type: 'text', ...defaultModuleRect(page, { w: 80, h: 30 }), markdown: '**New text**\n\nChange this text with Edit above.' }));
	board.showProperties('content');
}

/** Interactive tracker (M5): a counter, a row of boxes or a checklist, edited in the properties popover. */
export function addTracker(board: BoardViewport, kind: TrackerModule['kind'] = 'counter') {
	const presets: Record<TrackerModule['kind'], Partial<TrackerModule> & { w: number; h: number }> = {
		counter: { label: 'Hit points', value: 10, min: 0, w: 50, h: 25 },
		boxes: { label: 'Spell slots', max: 4, value: 0, w: 60, h: 18 },
		checklist: { label: 'Quests', items: [{ text: 'Find the queen' }, { text: 'Return the crown' }], w: 70, h: 30 },
	};
	const { w, h, ...rest } = presets[kind];
	board.placeModule((page, id) => ({ id, type: 'tracker', kind, ...defaultModuleRect(page, { w, h }), ...rest }));
	board.showProperties('content');
}

/** Table of contents (M4): fills the page inside its margins; lists named pages live. */
export function addToc(board: BoardViewport) {
	board.placeModule((page, id) => ({ id, type: 'toc', ...defaultModuleRect(page, { w: page.w - 40, h: page.h - 40 }), x: 20, y: 20 }));
	board.showProperties('content');
}

export function pickImage(board: BoardViewport) {
	const app = board.app;
	new FilePickerModal(app, app.vault.getFiles().filter(isImage), 'Image to add', (file) =>
		void imageAspect(app, file).then((aspect) =>
			board.placeModule((page, id): ImageModule => {
				const r = defaultModuleRect(page, { w: 80, h: 60 });
				return { id, type: 'image', ...r, h: Math.max(5, Math.min(r.h * 2, r.w / aspect)), file: file.path };
			}),
		),
	).open();
}

export function pickPdf(board: BoardViewport) {
	const app = board.app;
	const { pdfDocs } = board.services;
	new FilePickerModal(app, app.vault.getFiles().filter(isPdf), 'PDF to add', (file: TFile) =>
		new CropModal(app, pdfDocs, file.path, { page: 1 }, (r) =>
			board.placeModule((page, id): PdfModule => {
				const rect = defaultModuleRect(page);
				return { id, type: 'pdf', ...rect, ...(r.resizeModule ? fitHeight(rect, r.aspect, page.h) : {}), file: file.path, page: r.page, ...(r.crop ? { crop: r.crop } : {}), ...(r.sourceId ? { sourceId: r.sourceId } : {}) };
			}),
		).open(),
	).open();
}

/** Open the crop editor for a PDF module and apply the result as one undoable change. */
export function editCrop(board: BoardViewport, pageId: string, moduleId: string) {
	const page = board.boardStore.file.pages.find((p) => p.id === pageId);
	const m = page?.modules.find((x) => x.id === moduleId);
	if (!page || m?.type !== 'pdf' || board.boardStore.readOnly) return;
	const pdf = m as PdfModule;
	new CropModal(board.app, board.services.pdfDocs, pdf.file, { page: pdf.page, crop: pdf.crop }, (r: CropResult) =>
		board.boardStore.update((f) =>
			mapModule(f, pageId, moduleId, (x) => {
				const next: PdfModule = { ...(x as PdfModule), page: r.page, ...(r.resizeModule ? fitHeight(x, r.aspect, page.h - x.y) : {}) };
				if (r.crop) next.crop = r.crop;
				else delete next.crop;
				// Re-editing the crop counts as checking it against the current file.
				if (r.sourceId) next.sourceId = r.sourceId;
				return next;
			}),
		),
	).open();
}

/**
 * Linked frames (M5): continue the chain this module is in with a new frame on the same page as
 * the chain's last frame, in free space beside or under it. Never adds or uses another page; the
 * user moves the frame wherever the text should go. One undo step.
 */
export function continueInFrame(board: BoardViewport, pageId: string, moduleId: string) {
	if (board.boardStore.readOnly) return;
	const file = board.boardStore.file;
	const info = flowChains(file).get(moduleId);
	const start = findModule(file, pageId, moduleId);
	if (!start || !['note', 'text', 'frame'].includes(start.type)) return;
	if (info && !info.ok) return void new Notice(info.reason);
	const last = info?.ok ? info.chain[info.chain.length - 1]! : { pageId, module: start };
	const page = file.pages.find((p) => p.id === last.pageId);
	if (!page) return;
	if (page.isMaster) return void new Notice(NO_FRAMES_ON_MASTERS);
	const id = newId(allIds(file));
	const r = placeNextFrame(last.module, page.modules, page);
	const frame: FrameModule = { id, type: 'frame', from: last.module.id, ...r, ...(last.module.style ? { style: last.module.style } : {}) };
	board.boardStore.update((f) => addModule(f, page.id, frame));
	board.select({ pageId: page.id, moduleId: id });
}

/** Freeze a note module (M4): store what it shows now, so later edits to the note don't change it. */
export async function freezeNote(board: BoardViewport, pageId: string, moduleId: string) {
	const m = findModule(board.boardStore.file, pageId, moduleId);
	if (m?.type !== 'note' || board.boardStore.readOnly) return;
	const content = await loadNoteContent(board.app, m as NoteModule);
	if (!content.ok) return void new Notice(`Can't freeze: ${content.reason}`);
	board.boardStore.update((f) => mapModule(f, pageId, moduleId, (x) => ({ ...x, frozen: { at: today(), markdown: content.markdown } })));
}

export function unfreezeNote(board: BoardViewport, pageId: string, moduleId: string) {
	board.boardStore.update((f) =>
		mapModule(f, pageId, moduleId, (x) => {
			const next = { ...x };
			delete next.frozen;
			return next;
		}),
	);
}

/** Record the PDF's current version on a crop, clearing its "PDF changed" warning. */
export async function markPdfChecked(board: BoardViewport, pageId: string, moduleId: string) {
	const m = findModule(board.boardStore.file, pageId, moduleId);
	if (m?.type !== 'pdf' || board.boardStore.readOnly) return;
	const { pdfDocs } = board.services;
	const doc = await pdfDocs.acquire(m.file as string);
	try {
		const id = pdfSourceId(doc);
		if (id) board.boardStore.update((f) => mapModule(f, pageId, moduleId, (x) => ({ ...x, sourceId: id })));
	} finally {
		pdfDocs.release(m.file as string);
	}
}

/** Places dropped files cascading from `at`; PDFs open their crop editors one after another, not stacked. */
export async function dropFiles(board: BoardViewport, files: TFile[], page: Page, at: Point) {
	const pdfs = files.filter((f) => f.extension.toLowerCase() === 'pdf').length;
	let n = 0;
	for (const [i, file] of files.entries()) {
		// The board may have closed (or the plugin unloaded) while an editor was open.
		if (!board.isAttached) return;
		const isPdfFile = file.extension.toLowerCase() === 'pdf';
		await dropFile(board, file, page, { x: at.x + i * 10, y: at.y + i * 10 }, isPdfFile && pdfs > 1 ? `${++n} of ${pdfs}` : '');
	}
}

/** Resolves when the file is placed, or for a PDF when its crop editor closes. */
function dropFile(board: BoardViewport, file: TFile, page: Page, at: Point, queueNote = ''): Promise<void> {
	const ext = file.extension.toLowerCase();
	const place = (w: number, h: number) => ({ x: Math.max(0, Math.min(at.x, page.w - w)), y: Math.max(0, Math.min(at.y, page.h - h)), w, h });
	const add = (build: (id: string) => AnyModule) => {
		const id = newId(allIds(board.boardStore.file));
		board.boardStore.update((f) => addModule(f, page.id, build(id)));
		board.select({ pageId: page.id, moduleId: id });
	};
	if (ext === 'md') {
		add((id): NoteModule => ({ id, type: 'note', ...place(90, 80), file: file.path }));
		return Promise.resolve();
	}
	if (isImage(file)) return imageAspect(board.app, file).then((aspect) => add((id): ImageModule => ({ id, type: 'image', ...place(60, Math.max(5, 60 / aspect)), file: file.path })));
	if (ext === 'pdf') {
		const modal = new CropModal(board.app, board.services.pdfDocs, file.path, { page: 1 }, (r) =>
			add((id): PdfModule => {
				const w = 90;
				const h = r.resizeModule ? fitHeight({ w }, r.aspect, page.h).h : 120;
				return { id, type: 'pdf', ...place(w, h), file: file.path, page: r.page, ...(r.crop ? { crop: r.crop } : {}), ...(r.sourceId ? { sourceId: r.sourceId } : {}) };
			}),
		);
		modal.titleNote = queueNote;
		return new Promise((resolve) => {
			modal.onClosed = resolve;
			modal.open();
		});
	}
	new Notice(`Patchwork can't place .${ext} files yet.`);
	return Promise.resolve();
}


/** Width ÷ height of an image file; 4:3 when it cannot be decoded. */
function imageAspect(app: App, file: TFile): Promise<number> {
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => resolve(img.naturalWidth / Math.max(1, img.naturalHeight));
		img.onerror = () => resolve(4 / 3);
		img.src = app.vault.getResourcePath(file);
	});
}

/** Height that gives `rect` the content's aspect ratio at its current width, kept within `maxH`. */
function fitHeight(rect: { w: number }, aspect: number, maxH: number): { h: number } {
	return { h: Math.max(5, Math.min(maxH, Number((rect.w / aspect).toFixed(3)))) };
}

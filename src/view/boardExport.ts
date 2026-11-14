import { Notice, TFile } from 'obsidian';
import { exportBoardPdf, isExporting } from '../export/exportPdf';
import { pdfToPngs } from '../export/exportPng';
import { toJsonCanvas } from '../model/canvasExport';
import { outputPages } from '../model/masters';
import { today } from '../model/numbering';
import { parseRange } from '../model/sheetPlan';
import { type ExportChoices, ExportModal, writeBinary } from '../ui/ExportModal';
import { confirm } from '../ui/prompts';
import type { BoardViewport } from './BoardViewport';

// Export actions of a board (SPEC 9): the dialog, the PDF/PNG run and the one-way canvas export.
// Kept out of BoardViewport, which only forwards to them.

/** The export dialog, filled from the export defaults stored in the board. */
export function showExportDialog(board: BoardViewport) {
	const file = board.view.file;
	if (!file) return;
	const store = board.boardStore;
	const e = store.file.board.export;
	const initial: ExportChoices = {
		base: file.path.replace(/\.patchwork$/, ''),
		format: e.format,
		pages: 'all',
		range: '',
		sheet: typeof e.sheet === 'object' ? { w: e.sheet.w, h: e.sheet.h } : e.sheet,
		orientation: e.orientation,
		overlap: e.tileOverlap,
		fitSmallPages: !!e.fitSmallPages,
		tileLabels: !!e.tileLabels,
		inkSaver: !!e.inkSaver,
		layout: e.layout ?? 'single',
		bleed: e.bleed ?? 0,
		cropMarks: e.cropMarks,
		quality: e.quality,
		dpi: e.dpi,
		open: true,
	};
	const ctx = { pageCount: outputPages(store.file).length, selectedCount: selectedPageIndices(board).length, unit: store.file.board.displayUnit };
	new ExportModal(board.app, initial, ctx, (choices) => void runBoardExport(board, choices)).open();
}

/** One-way, lossy export to a .canvas next to the board (SPEC 9.3). */
export async function exportToCanvas(board: BoardViewport): Promise<TFile | undefined> {
	const file = board.view.file;
	if (!file) return;
	const app = board.app;
	const { canvas, dropped } = toJsonCanvas(board.boardStore.file);
	const path = file.path.replace(/\.patchwork$/, '.canvas');
	const text = JSON.stringify(canvas, null, '\t');
	const existing = app.vault.getAbstractFileByPath(path);
	// The canvas next to a patchwork may be one the user made by hand; never replace it unasked.
	if (existing instanceof TFile && !(await confirm(app, 'Replace canvas?', `${path} already exists. Exporting replaces its contents.`, 'Replace'))) return;
	const out = existing instanceof TFile ? (await app.vault.modify(existing, text), existing) : await app.vault.create(path, text);
	new Notice(`Exported to ${out.path}.${dropped.length ? ` Not carried over: ${dropped.join(', ')}.` : ''}`, dropped.length ? 8000 : 4000);
	return out;
}

/** Pages of the current selection (pages, or the pages of selected modules), as output-order indices. */
function selectedPageIndices(board: BoardViewport): number[] {
	const ids = new Set(board.selectedItems.map((it) => it.pageId));
	return outputPages(board.boardStore.file).flatMap((p, i) => (ids.has(p.id) ? [i] : []));
}

export async function runBoardExport(board: BoardViewport, choices: ExportChoices): Promise<void> {
	const app = board.app;
	const store = board.boardStore;
	// Two exports would share the one print host window and mix up their pages.
	if (isExporting()) return void new Notice('Another export is still running. Try again when it has finished.');
	// Remember the choices in the board, like other export defaults (SPEC 6). Not an undo step: the
	// first Ctrl+Z after an export would otherwise seem to do nothing.
	store.updateOutsideHistory((f) => {
		const e = f.board.export;
		const next = { ...e, format: choices.format, sheet: choices.sheet, orientation: choices.orientation, tileOverlap: choices.overlap, quality: choices.quality, dpi: choices.dpi, fitSmallPages: choices.fitSmallPages || undefined, tileLabels: choices.tileLabels || undefined, inkSaver: choices.inkSaver || undefined, layout: choices.layout === 'booklet' ? choices.layout : undefined, bleed: choices.bleed || undefined, cropMarks: choices.cropMarks };
		return JSON.stringify(next) === JSON.stringify(e) ? f : { ...f, board: { ...f.board, export: next } };
	});
	const pageIndices = choices.pages === 'selected' ? selectedPageIndices(board) : choices.pages === 'range' ? parseRange(choices.range, outputPages(store.file).length) ?? undefined : undefined;
	const notice = new Notice('Exporting…', 0);
	try {
		const result = await exportBoardPdf(
			{ app, pdfDocs: board.services.pdfDocs, parent: board.view },
			store.file,
			board.view.file?.path ?? '',
			{ ...choices, date: today(), pageIndices },
			(msg) => notice.setMessage(msg),
		);
		const written: TFile[] = [];
		if (choices.format === 'pdf') written.push(await writeBinary(app, `${choices.base}.pdf`, result.bytes));
		else for await (const png of pdfToPngs(result.bytes, choices.dpi, (msg) => notice.setMessage(msg))) written.push(await writeBinary(app, `${choices.base}${png.suffix}.png`, png.bytes));
		notice.hide();
		const what = written.length === 1 ? written[0]!.path : `${written.length} files (${written[0]!.path}, …)`;
		new Notice(`Exported ${result.pageCount} page(s) to ${what}.`);
		if (result.problems.length) new Notice(`Export finished with problems:\n• ${result.problems.join('\n• ')}`, 0);
		if (choices.open && written[0]) await app.workspace.getLeaf('tab').openFile(written[0]);
	} catch (e) {
		notice.hide();
		new Notice(`Export failed: ${e instanceof Error ? e.message : String(e)}`, 0);
	}
}

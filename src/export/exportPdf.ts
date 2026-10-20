import type { App, Component } from 'obsidian';
import { batches, oversizedPages, vectorModules } from '../model/exportPlan';
import { pageFurniture, pdfPageLabels } from '../model/numbering';
import { planSheets, type SheetSetting } from '../model/sheetPlan';
import { orderedPages } from '../model/ordering';
import type { PatchworkFile } from '../model/schema';
import { formatLength } from '../model/units';
import { type PdfDocCache, readPdfBytes } from '../sources/pdfSource';
import { assemble } from './assemble';
import { printPages } from './printHost';

export interface ExportOptions {
	quality: 'best' | 'small';
	dpi: number;
	/** {date} in headers and footers. */
	date: string;
	sheet: SheetSetting;
	orientation: 'auto' | 'portrait' | 'landscape';
	overlap: number;
	fitSmallPages: boolean;
	tileLabels: boolean;
	/** Indices into the pages in output order; absent means all. Numbers stay as in the full board. */
	pageIndices?: number[];
}

export interface ExportResult {
	bytes: Uint8Array;
	pageCount: number;
	problems: string[];
}

/** Pages per Chromium print call. Keeps the offscreen DOM (and canvases) small on large boards. */
const PAGES_PER_BATCH = 8;

export async function exportBoardPdf(
	env: { app: App; pdfDocs: PdfDocCache; parent: Component },
	board: PatchworkFile,
	boardPath: string,
	opts: ExportOptions,
	progress: (message: string) => void,
): Promise<ExportResult> {
	const all = orderedPages(board);
	const pages = opts.pageIndices ? opts.pageIndices.flatMap((i) => (all[i] ? [all[i]] : [])) : all;
	if (pages.length === 0) throw new Error('No pages to export.');
	// Only a native-size export has to fit a single PDF page; tiling splits big pages (SPEC 9.2).
	const tooBig = opts.sheet === 'native' ? oversizedPages(pages) : [];
	if (tooBig.length) {
		const list = tooBig.map((p) => `"${p.name ?? p.id}" (${formatLength(p.w, 'mm')} × ${formatLength(p.h, 'mm')})`).join(', ');
		throw new Error(`Pages larger than 5080 mm per side can't be a single PDF page: ${list}. Choose a sheet size (e.g. A4) to tile them.`);
	}

	const vector = new Set(pages.flatMap((p) => [...vectorModules(p, opts.quality)]));
	const title = board.meta?.title ?? boardPath.replace(/^.*\//, '').replace(/\.patchwork$/, '');
	const furniture = pageFurniture(board, { title, date: opts.date });
	const printed: Uint8Array[] = [];
	const problems: string[] = [];
	const groups = batches(pages, PAGES_PER_BATCH);
	for (const [i, group] of groups.entries()) {
		progress(`Rendering pages ${i * PAGES_PER_BATCH + 1}–${i * PAGES_PER_BATCH + group.length} of ${pages.length}…`);
		const r = await printPages(group, {
			ctx: { app: env.app, pdfDocs: env.pdfDocs },
			parent: env.parent,
			vector,
			dpi: opts.dpi,
			appTheme: board.board.useAppTheme,
			boardPath,
			furniture,
			numberPosition: board.board.numbering.position,
		});
		printed.push(r.bytes);
		problems.push(...r.problems);
	}

	progress(vector.size ? `Placing ${vector.size} PDF region(s) as vector…` : 'Assembling…');
	const out = await assemble({
		printed,
		pages,
		vector,
		readSource: (path) => readPdfBytes(env.app, path),
		title,
		pageLabels: selectLabels(pdfPageLabels(board), all, pages),
		sheets: planSheets(pages, { sheet: opts.sheet, orientation: opts.orientation, overlap: opts.overlap, fitSmallPages: opts.fitSmallPages }),
		tileLabels: opts.tileLabels,
		pageNames: pages.map((p) => furniture.get(p.id)?.pageToken ?? ''),
	});
	return { bytes: out.bytes, pageCount: pages.length, problems: [...new Set([...problems, ...out.problems])] };
}

/** Page labels for an exported subset: each page keeps the label it has in the full board. */
function selectLabels<T>(labels: T[] | null, all: readonly { id: string }[], picked: readonly { id: string }[]): T[] | null {
	if (!labels) return null;
	const index = new Map(all.map((p, i) => [p.id, i]));
	return picked.map((p) => labels[index.get(p.id)!]!);
}

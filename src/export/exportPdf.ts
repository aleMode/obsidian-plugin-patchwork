import type { App, Component } from 'obsidian';
import { batches, oversizedPages, vectorModules } from '../model/exportPlan';
import { pageFurniture, pdfPageLabels } from '../model/numbering';
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
	const pages = orderedPages(board);
	if (pages.length === 0) throw new Error('The board has no pages.');
	const tooBig = oversizedPages(pages);
	if (tooBig.length) {
		const list = tooBig.map((p) => `"${p.name ?? p.id}" (${formatLength(p.w, 'mm')} × ${formatLength(p.h, 'mm')})`).join(', ');
		throw new Error(`Pages larger than 5080 mm per side can't be a single PDF page: ${list}. Tiled export comes later.`);
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
		pageLabels: pdfPageLabels(board),
	});
	return { bytes: out.bytes, pageCount: pages.length, problems: [...new Set([...problems, ...out.problems])] };
}

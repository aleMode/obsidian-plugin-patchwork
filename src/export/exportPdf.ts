import type { App, Component } from 'obsidian';
import { batches, coveringVectorModules, oversizedPages, vectorModules } from '../model/exportPlan';
import { pageFurniture, pdfPageLabels } from '../model/numbering';
import { planSheets, type SheetSetting } from '../model/sheetPlan';
import { tocEntries } from '../model/toc';
import { flowChains } from '../model/flow';
import { FlowLayout } from '../modules/flowLayout';
import { outputPages, resolvePage } from '../model/masters';
import type { Page, PatchworkFile, PdfModule } from '../model/schema';
import { pageInk, unreadableText } from '../model/contrast';
import { themeInk } from '../view/paperScope';
import { moduleTitle } from '../view/OutlineRenderer';
import { formatLength } from '../model/units';
import { type PdfDocCache, readPdfBytes } from '../sources/pdfSource';
import { appendPrinted, assemble, createPrinted, type PageLink } from './assemble';
import { type PrintedEmbed, printPages } from './printHost';

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
	inkSaver?: boolean;
	layout?: 'single' | 'booklet';
	/** Bleed (mm) around each page; single layout only. */
	bleed?: number;
	cropMarks?: boolean;
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
	const all = outputPages(board);
	// Master modules and furniture are baked into each page (resolved) before printing.
	const pages = (opts.pageIndices ? opts.pageIndices.flatMap((i) => (all[i] ? [all[i]] : [])) : all).map((p) => resolvePage(board, p));
	if (pages.length === 0) throw new Error('No pages to export.');
	// Only a native-size export has to fit a single PDF page; tiling splits big pages (SPEC 9.2).
	const tooBig = opts.sheet === 'native' ? oversizedPages(pages) : [];
	if (tooBig.length) {
		const list = tooBig.map((p) => `"${p.name ?? p.id}" (${formatLength(p.w, 'mm')} × ${formatLength(p.h, 'mm')})`).join(', ');
		throw new Error(`Pages larger than 5080 mm per side can't be a single PDF page: ${list}. Choose a sheet size (e.g. A4) to tile them.`);
	}

	const booklet = opts.layout === 'booklet';
	const bleed = booklet ? 0 : Math.max(0, opts.bleed ?? 0);
	const vector = new Set(pages.flatMap((p) => [...vectorModules(p, opts.quality, !!opts.inkSaver)]));
	// PDF embeds in notes follow the same rule as PDF modules: vector unless the export asks for small or ink saver.
	const vectorEmbeds = opts.quality === 'best' && !opts.inkSaver;
	const title = board.meta?.title ?? boardPath.replace(/^.*\//, '').replace(/\.patchwork$/, '');
	const furniture = pageFurniture(board, { title, date: opts.date });
	const printed = await createPrinted();
	const problems: string[] = [...vectorWarnings(pages, opts), ...colourWarnings(pages, board.board.useAppTheme)];
	const links: PageLink[] = [];
	const indexOf = new Map(pages.map((p, i) => [p.id, i]));
	// Chains span the whole board, also pages outside the exported range.
	const chains = flowChains(board);
	const font = board.board.fontFamily;
	const flow = { info: (id: string) => chains.get(id), layout: new FlowLayout(env.app, () => boardPath, () => font, env.pdfDocs) };
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
			inkSaver: !!opts.inkSaver,
			bleed,
			tocEntries: (pageId) => tocEntries(board, pageId),
			flow,
			...(font ? { font } : {}),
			vectorEmbeds,
		});
		await appendPrinted(printed, r.bytes);
		problems.push(...r.problems);
		// Links to pages outside the exported range are dropped; the entry still shows its number.
		for (const l of r.links) {
			const target = indexOf.get(l.targetPageId);
			if (target !== undefined) links.push({ page: i * PAGES_PER_BATCH + l.page, rect: l.rect, target });
		}
		r.embeds.forEach((e, n) => {
			const at = i * PAGES_PER_BATCH + e.page;
			const m = embedModule(`~embed${i}-${n}`, e);
			pages[at] = { ...pages[at]!, modules: [...pages[at]!.modules, m] };
			vector.add(m.id);
		});
	}

	progress(vector.size ? `Placing ${vector.size} PDF region(s) as vector…` : 'Assembling…');
	const out = await assemble({
		printed,
		pages,
		vector,
		readSource: (path) => readPdfBytes(env.app, path),
		title,
		pageLabels: selectLabels(pdfPageLabels(board), all, pages),
		sheets: planSheets(pages, {
			sheet: opts.sheet,
			orientation: opts.orientation,
			overlap: opts.overlap,
			fitSmallPages: opts.fitSmallPages,
			layout: opts.layout,
			bleed,
			cropMarks: !booklet && !!opts.cropMarks,
		}),
		bleed,
		links,
		tileLabels: opts.tileLabels,
		pageNames: pages.map((p) => furniture.get(p.id)?.pageToken ?? ''),
	});
	return { bytes: out.bytes, pageCount: pages.length, problems: [...new Set([...problems, ...out.problems])] };
}

/**
 * A PDF embed in a note, placed like a PDF module of its own so stage 2 draws it as vector. Embeds are
 * drawn last, over the page: content stacked above the note (rare) is covered by them.
 */
function embedModule(id: string, e: PrintedEmbed): PdfModule {
	return { id, type: 'pdf', ...e.rect, file: e.file, page: e.pdfPage, crop: e.crop, fit: 'stretch' };
}

/** Page labels for an exported subset: each page keeps the label it has in the full board. */
function selectLabels<T>(labels: T[] | null, all: readonly { id: string }[], picked: readonly { id: string }[]): T[] | null {
	if (!labels) return null;
	const index = new Map(all.map((p, i) => [p.id, i]));
	return picked.map((p) => labels[index.get(p.id)!]!);
}

/** Forced-vector PDF regions that cover items stacked above them (see coveringVectorModules). */
function vectorWarnings(pages: readonly Page[], opts: ExportOptions): string[] {
	if (opts.quality === 'small' || opts.inkSaver) return [];
	return pages.flatMap((p, i) =>
		coveringVectorModules(p).map(
			(m) => `"${m.label ?? m.file.replace(/^.*\//, '')} p. ${m.page}" on "${p.name ?? `page ${i + 1}`}" is set to export as vector, so it is drawn over the items stacked above it. Set "In exports" to Automatic to keep the order.`,
		),
	);
}

/** Text colours set by hand that almost vanish into their background (automatic ink never does). */
function colourWarnings(pages: readonly Page[], appTheme: boolean): string[] {
	const base = themeInk(appTheme);
	return pages.flatMap((p, i) => {
		const ink = pageInk(p, base);
		return p.modules.filter((m) => unreadableText(m, ink)).map((m) => `"${moduleTitle(m)}" on "${p.name ?? `page ${i + 1}`}": its text colour is hard to read on its background. Clear Text colour to have it picked automatically.`);
	});
}

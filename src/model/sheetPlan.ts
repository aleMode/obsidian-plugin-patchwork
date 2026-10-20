import type { Rect } from './geometry';
import type { ExportDefaults, SheetPreset } from './schema';
import { chooseSheet, TILE_EPSILON_MM, tileGrid, type Size } from './tiling';

// Which output sheets an export produces, and which part of which board page goes where (SPEC 9.2,
// M4 booklet and print marks). Pure: the pdf-lib stage just executes this plan.

export const SHEET_SIZES: Record<SheetPreset, Size> = {
	A4: { w: 210, h: 297 },
	A3: { w: 297, h: 420 },
	A5: { w: 148, h: 210 },
	Letter: { w: 215.9, h: 279.4 },
	Legal: { w: 215.9, h: 355.6 },
	Tabloid: { w: 279.4, h: 431.8 },
};

/** Room around the trim box for crop marks (mm). */
export const MARK_MARGIN_MM = 10;

export interface SheetPart {
	/** Index into the exported pages (output order). */
	page: number;
	/** Region of the board page (mm, page top-left origin; negative = bleed area). */
	src: Rect;
	/** Where its top-left lands on the sheet (mm from the sheet's top-left) and its scale. */
	dest: { x: number; y: number; scale: number };
}

export interface OutputSheet {
	size: Size;
	parts: SheetPart[];
	/** Row/column label for tiles ("B3"). */
	tile?: string;
	/** The page's trim box on the sheet (mm), when crop marks or bleed are used. */
	trim?: Rect;
	/** Bleed beyond the trim box (mm), for the PDF BleedBox. */
	bleed?: number;
	cropMarks?: boolean;
}

export type SheetSetting = ExportDefaults['sheet'];

export interface PlanOptions {
	sheet: SheetSetting;
	orientation: 'auto' | 'portrait' | 'landscape';
	overlap: number;
	fitSmallPages: boolean;
	layout?: 'single' | 'booklet';
	/** Bleed (mm) printed beyond each page edge; single layout, whole pages only. */
	bleed?: number;
	cropMarks?: boolean;
}

export function sheetSize(sheet: Exclude<SheetSetting, 'native'>): Size {
	return typeof sheet === 'string' ? SHEET_SIZES[sheet] : { w: sheet.w, h: sheet.h };
}

const fits = (page: Size, sheet: Size) => page.w <= sheet.w + TILE_EPSILON_MM && page.h <= sheet.h + TILE_EPSILON_MM;

export function planSheets(pages: readonly Size[], opts: PlanOptions): OutputSheet[] {
	return opts.layout === 'booklet' ? planBooklet(pages, opts) : planSingle(pages, opts);
}

function planSingle(pages: readonly Size[], opts: PlanOptions): OutputSheet[] {
	const out: OutputSheet[] = [];
	const bleed = Math.max(0, opts.bleed ?? 0);
	const marks = !!opts.cropMarks;
	for (const [i, page] of pages.entries()) {
		// The page plus its bleed, and the margin for crop marks around that.
		const withBleed = { w: page.w + 2 * bleed, h: page.h + 2 * bleed };
		const margin = marks ? MARK_MARGIN_MM : 0;
		const src = { x: -bleed, y: -bleed, ...withBleed };
		const finish = (sheet: Size, x: number, y: number, scale: number): OutputSheet => ({
			size: sheet,
			parts: [{ page: i, src, dest: { x, y, scale } }],
			...(bleed || marks ? { trim: { x: x + bleed * scale, y: y + bleed * scale, w: page.w * scale, h: page.h * scale }, bleed: bleed * scale, cropMarks: marks } : {}),
		});
		if (opts.sheet === 'native') {
			out.push(finish({ w: withBleed.w + 2 * margin, h: withBleed.h + 2 * margin }, margin, margin, 1));
			continue;
		}
		const needed = { w: withBleed.w + 2 * margin, h: withBleed.h + 2 * margin };
		const sheet = chooseSheet(needed, sheetSize(opts.sheet), opts.orientation, opts.overlap);
		if (fits(needed, sheet)) {
			// Smaller than the sheet: centred, at actual size or scaled up to fill it.
			const scale = opts.fitSmallPages ? Math.min(sheet.w / needed.w, sheet.h / needed.h) : 1;
			out.push(finish(sheet, (sheet.w - withBleed.w * scale) / 2, (sheet.h - withBleed.h * scale) / 2, scale));
			continue;
		}
		// Larger than the sheet: regular tiles of the page itself (no bleed or marks on tiles).
		for (const t of tileGrid(page, sheet, opts.overlap).tiles) {
			out.push({ size: sheet, parts: [{ page: i, src: { x: t.x, y: t.y, w: t.w, h: t.h }, dest: { x: 0, y: 0, scale: 1 } }], tile: t.label });
		}
	}
	return out;
}

/**
 * Saddle-stitch order for `n` pages: padded with blanks (null) to a multiple of 4, as sheet sides
 * of [left, right]. Printed double-sided, stacked and folded, the pages read 1…n.
 */
export function bookletOrder(n: number): [number | null, number | null][] {
	const total = Math.max(4, Math.ceil(n / 4) * 4);
	const at = (i: number) => (i < n ? i : null);
	const sides: [number | null, number | null][] = [];
	for (let k = 0; k < total / 2; k++) {
		const outer = total - 1 - k;
		// Even sides (fronts) have the higher page on the left; odd sides (backs) the reverse.
		sides.push(k % 2 === 0 ? [at(outer), at(k)] : [at(k), at(outer)]);
	}
	return sides;
}

/** Booklet: two pages side by side per sheet side, each centred and scaled to fit its half. */
function planBooklet(pages: readonly Size[], opts: PlanOptions): OutputSheet[] {
	if (!pages.length) return [];
	const cell = { w: Math.max(...pages.map((p) => p.w)), h: Math.max(...pages.map((p) => p.h)) };
	// Native: two cells side by side. A chosen sheet is used landscape, split in two halves.
	const size = opts.sheet === 'native' ? { w: cell.w * 2, h: cell.h } : (() => {
		const s = sheetSize(opts.sheet);
		return { w: Math.max(s.w, s.h), h: Math.min(s.w, s.h) };
	})();
	const half = { w: size.w / 2, h: size.h };
	return bookletOrder(pages.length).map(([left, right]) => ({
		size,
		parts: [left, right].flatMap((idx, side) => {
			if (idx === null) return [];
			const p = pages[idx]!;
			const scale = Math.min(half.w / p.w, half.h / p.h, opts.sheet === 'native' || opts.fitSmallPages ? Infinity : 1);
			return [{ page: idx, src: { x: 0, y: 0, w: p.w, h: p.h }, dest: { x: side * half.w + (half.w - p.w * scale) / 2, y: (half.h - p.h * scale) / 2, scale } }];
		}),
	}));
}

/**
 * Where a region of a page (mm, page coordinates) ends up on the output sheets: one entry per sheet
 * showing part of it, clipped to what that sheet shows. Used to place link annotations.
 */
export function mapToSheets(plan: readonly OutputSheet[], page: number, r: Rect): { sheet: number; rect: Rect }[] {
	const out: { sheet: number; rect: Rect }[] = [];
	plan.forEach((s, sheet) => {
		for (const part of s.parts) {
			if (part.page !== page) continue;
			const x0 = Math.max(r.x, part.src.x);
			const y0 = Math.max(r.y, part.src.y);
			const x1 = Math.min(r.x + r.w, part.src.x + part.src.w);
			const y1 = Math.min(r.y + r.h, part.src.y + part.src.h);
			if (x1 <= x0 || y1 <= y0) continue;
			const k = part.dest.scale;
			out.push({ sheet, rect: { x: part.dest.x + (x0 - part.src.x) * k, y: part.dest.y + (y0 - part.src.y) * k, w: (x1 - x0) * k, h: (y1 - y0) * k } });
		}
	});
	return out;
}

/**
 * Parse a page range like "1-3, 5, 8-" (1-based, in output order) into sorted 0-based indices.
 * Returns null when the text is invalid or selects nothing.
 */
export function parseRange(text: string, count: number): number[] | null {
	const picked = new Set<number>();
	for (const raw of text.split(',')) {
		const part = raw.trim();
		if (!part) continue;
		const m = /^(\d*)\s*(?:-\s*(\d*))?$/.exec(part);
		if (!m || (m[1] === '' && m[2] === undefined)) return null;
		const from = m[1] ? Number(m[1]) : 1;
		const to = m[2] === undefined ? from : m[2] === '' ? count : Number(m[2]);
		if (from < 1 || to < from) return null;
		for (let p = from; p <= Math.min(to, count); p++) picked.add(p - 1);
	}
	return picked.size ? [...picked].sort((a, b) => a - b) : null;
}

import type { Rect } from './geometry';
import type { ExportDefaults, SheetPreset } from './schema';
import { chooseSheet, TILE_EPSILON_MM, tileGrid, type Size } from './tiling';

// Which output sheets an export produces, and what part of which board page goes where (SPEC 9.2).
// Pure: the pdf-lib stage just executes this plan.

export const SHEET_SIZES: Record<SheetPreset, Size> = {
	A4: { w: 210, h: 297 },
	A3: { w: 297, h: 420 },
	A5: { w: 148, h: 210 },
	Letter: { w: 215.9, h: 279.4 },
	Legal: { w: 215.9, h: 355.6 },
	Tabloid: { w: 279.4, h: 431.8 },
};

export interface SheetPart {
	/** Index into the exported pages (output order). */
	page: number;
	/** Output sheet size, mm. */
	sheet: Size;
	/** Region of the board page shown (mm, top-left origin). */
	src: Rect;
	/** Where it lands on the sheet (mm from the sheet's top-left) and its scale. */
	dest: { x: number; y: number; scale: number };
	/** Row/column label for tiles ("B3"), absent otherwise. */
	tile?: string;
}

export type SheetSetting = ExportDefaults['sheet'];

export function sheetSize(sheet: Exclude<SheetSetting, 'native'>): Size {
	return typeof sheet === 'string' ? SHEET_SIZES[sheet] : { w: sheet.w, h: sheet.h };
}

const fits = (page: Size, sheet: Size) => page.w <= sheet.w + TILE_EPSILON_MM && page.h <= sheet.h + TILE_EPSILON_MM;

export function planSheets(
	pages: readonly Size[],
	opts: { sheet: SheetSetting; orientation: 'auto' | 'portrait' | 'landscape'; overlap: number; fitSmallPages: boolean },
): SheetPart[] {
	const out: SheetPart[] = [];
	for (const [i, page] of pages.entries()) {
		const full = { x: 0, y: 0, w: page.w, h: page.h };
		if (opts.sheet === 'native') {
			out.push({ page: i, sheet: { w: page.w, h: page.h }, src: full, dest: { x: 0, y: 0, scale: 1 } });
			continue;
		}
		const sheet = chooseSheet(page, sheetSize(opts.sheet), opts.orientation, opts.overlap);
		if (fits(page, sheet)) {
			// Smaller than the sheet: centred, at actual size or scaled up to fill it.
			const scale = opts.fitSmallPages ? Math.min(sheet.w / page.w, sheet.h / page.h) : 1;
			out.push({ page: i, sheet, src: full, dest: { x: (sheet.w - page.w * scale) / 2, y: (sheet.h - page.h * scale) / 2, scale } });
			continue;
		}
		for (const t of tileGrid(page, sheet, opts.overlap).tiles) {
			out.push({ page: i, sheet, src: { x: t.x, y: t.y, w: t.w, h: t.h }, dest: { x: 0, y: 0, scale: 1 }, tile: t.label });
		}
	}
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

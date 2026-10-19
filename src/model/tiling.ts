// Splitting a page into fixed-size output sheets (SPEC 9.2). Pure; all values in mm.

/** Float error like 297.0000001 mm must not add a near-empty tile. See docs/open-questions.md Q2. */
export const TILE_EPSILON_MM = 0.1;

export interface Size {
	w: number;
	h: number;
}

export interface Tile {
	row: number;
	col: number;
	/** "A1", "B3": row letter(s), column number. */
	label: string;
	/** Region of the page shown on this sheet, clipped to the page. */
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface TileGrid {
	sheet: Size;
	rows: number;
	cols: number;
	tiles: Tile[];
}

export function tileCount(pageSide: number, sheetSide: number, overlap: number): number {
	return Math.max(1, Math.ceil((pageSide - overlap - TILE_EPSILON_MM) / (sheetSide - overlap)));
}

/** A, B, …, Z, AA, AB, … like spreadsheet columns, for any number of rows. */
export function rowLabel(row: number): string {
	let s = '';
	for (let n = row + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
	return s;
}

function checkInputs(page: Size, sheet: Size, overlap: number) {
	if (!(page.w > 0 && page.h > 0)) throw new RangeError('Page size must be positive');
	if (!(sheet.w > 0 && sheet.h > 0)) throw new RangeError('Sheet size must be positive');
	if (!(overlap >= 0)) throw new RangeError('Tile overlap must be ≥ 0');
	if (overlap >= Math.min(sheet.w, sheet.h)) throw new RangeError('Tile overlap must be smaller than the sheet');
}

/** Tiles in reading order. Edge tiles are clipped to the page; the sheet keeps its full size (padded). */
export function tileGrid(page: Size, sheet: Size, overlap = 0): TileGrid {
	checkInputs(page, sheet, overlap);
	const cols = tileCount(page.w, sheet.w, overlap);
	const rows = tileCount(page.h, sheet.h, overlap);
	const tiles: Tile[] = [];
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const x = col * (sheet.w - overlap);
			const y = row * (sheet.h - overlap);
			tiles.push({ row, col, label: `${rowLabel(row)}${col + 1}`, x, y, w: Math.min(sheet.w, page.w - x), h: Math.min(sheet.h, page.h - y) });
		}
	}
	return { sheet, rows, cols, tiles };
}

/**
 * Pick the sheet orientation for a page. "auto" uses the one needing fewer sheets; on a tie it
 * matches the page's own orientation, which is what a person would choose.
 */
export function chooseSheet(page: Size, sheet: Size, orientation: 'auto' | 'portrait' | 'landscape', overlap = 0): Size {
	const portrait = { w: Math.min(sheet.w, sheet.h), h: Math.max(sheet.w, sheet.h) };
	const landscape = { w: portrait.h, h: portrait.w };
	if (orientation === 'portrait') return portrait;
	if (orientation === 'landscape') return landscape;
	const count = (s: Size) => tileCount(page.w, s.w, overlap) * tileCount(page.h, s.h, overlap);
	const p = count(portrait);
	const l = count(landscape);
	if (p !== l) return p < l ? portrait : landscape;
	return page.w > page.h ? landscape : portrait;
}

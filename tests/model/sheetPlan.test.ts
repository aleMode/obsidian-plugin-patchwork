import { describe, expect, it } from 'vitest';
import { bookletOrder, MARK_MARGIN_MM, parseRange, planSheets } from '../../src/model/sheetPlan';

const opts = { sheet: 'A4' as const, orientation: 'auto' as const, overlap: 0, fitSmallPages: false };

describe('planSheets: single', () => {
	it('native: one sheet per page at its own size', () => {
		const p = planSheets([{ w: 100, h: 50 }], { ...opts, sheet: 'native' });
		expect(p).toEqual([{ size: { w: 100, h: 50 }, parts: [{ page: 0, src: { x: -0, y: -0, w: 100, h: 50 }, dest: { x: 0, y: 0, scale: 1 } }] }]);
	});

	it('same-size page: exactly one sheet, no offset', () => {
		const [s] = planSheets([{ w: 210, h: 297 }], opts);
		expect(s!.parts[0]!.dest).toEqual({ x: 0, y: 0, scale: 1 });
		expect(s!.tile).toBeUndefined();
	});

	it('smaller page: centred at actual size, or scaled to fit', () => {
		const [actual] = planSheets([{ w: 148, h: 210 }], opts);
		expect(actual!.parts[0]!.dest).toEqual({ x: 31, y: 43.5, scale: 1 });
		const [fit] = planSheets([{ w: 148, h: 210 }], { ...opts, fitSmallPages: true });
		// Height-limited: A5 → A4 scales by 297/210 and sits 0.34 mm in from each side.
		expect(fit!.parts[0]!.dest.scale).toBeCloseTo(297 / 210);
		expect(fit!.parts[0]!.dest.y).toBeCloseTo(0);
		expect(fit!.parts[0]!.dest.x).toBeCloseTo((210 - 148 * (297 / 210)) / 2);
	});

	it('larger page: regular tiles in reading order with labels', () => {
		const tiles = planSheets([{ w: 1000, h: 700 }], opts);
		expect(tiles).toHaveLength(15);
		expect(tiles[0]).toMatchObject({ tile: 'A1', size: { w: 210, h: 297 }, parts: [{ src: { x: 0, y: 0 } }] });
		expect(tiles[14]!.tile).toBe('C5');
	});

	it('keeps page indices so outline and labels can find each page’s first sheet', () => {
		const p = planSheets([{ w: 210, h: 297 }, { w: 420, h: 297 }], opts);
		expect(p.map((s) => s.parts[0]!.page)).toEqual([0, 1, 1]);
	});
});

describe('planSheets: bleed and crop marks', () => {
	it('native: sheet grows by bleed and mark margin; trim box is the page', () => {
		const [s] = planSheets([{ w: 100, h: 50 }], { ...opts, sheet: 'native', bleed: 3, cropMarks: true });
		const m = MARK_MARGIN_MM;
		expect(s!.size).toEqual({ w: 100 + 6 + 2 * m, h: 50 + 6 + 2 * m });
		expect(s!.parts[0]!.src).toEqual({ x: -3, y: -3, w: 106, h: 56 });
		expect(s!.parts[0]!.dest).toEqual({ x: m, y: m, scale: 1 });
		expect(s!.trim).toEqual({ x: m + 3, y: m + 3, w: 100, h: 50 });
		expect(s!).toMatchObject({ bleed: 3, cropMarks: true });
	});

	it('fixed sheet: an A5 page with marks fits centred on A4', () => {
		const [s] = planSheets([{ w: 148, h: 210 }], { ...opts, bleed: 3, cropMarks: true });
		expect(s!.size).toEqual({ w: 210, h: 297 });
		expect(s!.trim).toEqual({ x: 31, y: 43.5, w: 148, h: 210 });
	});
});

describe('bookletOrder', () => {
	it('8 pages: 8|1, 2|7, 6|3, 4|5 (0-based)', () => {
		expect(bookletOrder(8)).toEqual([[7, 0], [1, 6], [5, 2], [3, 4]]);
	});

	it('pads to a multiple of 4 with blanks', () => {
		expect(bookletOrder(5)).toEqual([[null, 0], [1, null], [null, 2], [3, 4]]);
		expect(bookletOrder(1)).toEqual([[null, 0], [null, null]]);
	});
});

describe('planSheets: booklet', () => {
	it('A5 pages on landscape A4 sheets, two per side, at actual size', () => {
		const sides = planSheets(Array.from({ length: 4 }, () => ({ w: 148, h: 210 })), { ...opts, layout: 'booklet' });
		expect(sides).toHaveLength(2);
		expect(sides[0]!.size).toEqual({ w: 297, h: 210 });
		expect(sides[0]!.parts.map((p) => [p.page, p.dest.x])).toEqual([[3, 0.25], [0, 148.75]]);
	});

	it('native booklet: sheet is two pages wide', () => {
		const [side] = planSheets([{ w: 100, h: 150 }, { w: 100, h: 150 }], { ...opts, sheet: 'native', layout: 'booklet' });
		expect(side!.size).toEqual({ w: 200, h: 150 });
	});
});

describe('parseRange', () => {
	it('parses lists, ranges and open ends', () => {
		expect(parseRange('1-3, 5', 10)).toEqual([0, 1, 2, 4]);
		expect(parseRange('8-', 10)).toEqual([7, 8, 9]);
		expect(parseRange('3,1,3', 10)).toEqual([0, 2]);
		expect(parseRange('9-20', 10)).toEqual([8, 9]);
	});

	it('rejects nonsense', () => {
		expect(parseRange('', 5)).toBeNull();
		expect(parseRange('0', 5)).toBeNull();
		expect(parseRange('4-2', 5)).toBeNull();
		expect(parseRange('a', 5)).toBeNull();
		expect(parseRange('7', 5)).toBeNull();
	});
});

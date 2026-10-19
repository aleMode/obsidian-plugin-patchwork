import { describe, expect, it } from 'vitest';
import { chooseSheet, rowLabel, tileCount, tileGrid } from '../../src/model/tiling';

const A4 = { w: 210, h: 297 };

describe('tileCount', () => {
	it('exact fit gives exactly N tiles', () => {
		expect(tileCount(210, 210, 0)).toBe(1);
		expect(tileCount(420, 210, 0)).toBe(2);
		expect(tileCount(297 * 3, 297, 0)).toBe(3);
	});

	it('ignores float noise below the tolerance', () => {
		expect(tileCount(297.0000001, 297, 0)).toBe(1);
		expect(tileCount(420.05, 210, 0)).toBe(2);
	});

	it('adds a tile once the page exceeds the tolerance', () => {
		expect(tileCount(420.2, 210, 0)).toBe(3);
		expect(tileCount(210.11, 210, 0)).toBe(2);
	});

	it('page smaller than the sheet is one tile', () => {
		expect(tileCount(100, 210, 0)).toBe(1);
		expect(tileCount(0.01, 210, 0)).toBe(1);
	});

	it('accounts for overlap', () => {
		// Each extra sheet adds (210 - 10) mm: 210, 410, 610.
		expect(tileCount(410, 210, 10)).toBe(2);
		expect(tileCount(411, 210, 10)).toBe(3);
	});
});

describe('tileGrid', () => {
	it('splits a 1000 x 700 mm page into 5 x 3 A4 sheets in reading order', () => {
		const g = tileGrid({ w: 1000, h: 700 }, A4);
		expect([g.cols, g.rows, g.tiles.length]).toEqual([5, 3, 15]);
		expect(g.tiles.map((t) => t.label).slice(0, 6)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'B1']);
		const last = g.tiles[14]!;
		expect(last).toMatchObject({ label: 'C5', x: 840, y: 594 });
		expect(last.w).toBeCloseTo(160);
		expect(last.h).toBeCloseTo(106);
	});

	it('steps by sheet minus overlap', () => {
		const g = tileGrid({ w: 400, h: 200 }, A4, 10);
		expect(g.tiles.map((t) => t.x)).toEqual([0, 200]);
		expect(g.tiles[1]!.w).toBe(200);
	});

	it('rejects bad inputs', () => {
		expect(() => tileGrid({ w: 100, h: 100 }, A4, 210)).toThrow(/overlap/);
		expect(() => tileGrid({ w: 100, h: 100 }, A4, -1)).toThrow(/overlap/);
		expect(() => tileGrid({ w: 0, h: 100 }, A4)).toThrow(/Page/);
	});
});

describe('rowLabel', () => {
	it('labels rows like spreadsheet columns', () => {
		expect([0, 1, 25, 26, 27, 701, 702].map(rowLabel)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
	});
});

describe('chooseSheet', () => {
	it('auto picks the orientation needing fewer sheets', () => {
		// 594 x 210: three landscape A4 (297 wide) would be 2 sheets; portrait needs 3.
		expect(chooseSheet({ w: 594, h: 210 }, A4, 'auto')).toEqual({ w: 297, h: 210 });
	});

	it('auto on a tie follows the page orientation', () => {
		expect(chooseSheet({ w: 100, h: 50 }, A4, 'auto')).toEqual({ w: 297, h: 210 });
		expect(chooseSheet({ w: 50, h: 100 }, A4, 'auto')).toEqual({ w: 210, h: 297 });
	});

	it('honours a forced orientation regardless of the preset order', () => {
		expect(chooseSheet({ w: 594, h: 210 }, { w: 297, h: 210 }, 'portrait')).toEqual(A4);
		expect(chooseSheet({ w: 10, h: 10 }, A4, 'landscape')).toEqual({ w: 297, h: 210 });
	});
});

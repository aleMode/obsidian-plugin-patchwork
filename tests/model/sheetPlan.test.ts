import { describe, expect, it } from 'vitest';
import { parseRange, planSheets } from '../../src/model/sheetPlan';

const opts = { sheet: 'A4' as const, orientation: 'auto' as const, overlap: 0, fitSmallPages: false };

describe('planSheets', () => {
	it('native: one sheet per page at its own size', () => {
		const p = planSheets([{ w: 100, h: 50 }], { ...opts, sheet: 'native' });
		expect(p).toEqual([{ page: 0, sheet: { w: 100, h: 50 }, src: { x: 0, y: 0, w: 100, h: 50 }, dest: { x: 0, y: 0, scale: 1 } }]);
	});

	it('same-size page: exactly one sheet, no offset', () => {
		const [s] = planSheets([{ w: 210, h: 297 }], opts);
		expect(s!.dest).toEqual({ x: 0, y: 0, scale: 1 });
		expect(s!.tile).toBeUndefined();
	});

	it('smaller page: centred at actual size, or scaled to fit', () => {
		const [actual] = planSheets([{ w: 148, h: 210 }], opts);
		expect(actual!.dest).toEqual({ x: 31, y: 43.5, scale: 1 });
		const [fit] = planSheets([{ w: 148, h: 210 }], { ...opts, fitSmallPages: true });
		// Height-limited: A5 → A4 scales by 297/210 and sits 0.34 mm in from each side.
		expect(fit!.dest.scale).toBeCloseTo(297 / 210);
		expect(fit!.dest.y).toBeCloseTo(0);
		expect(fit!.dest.x).toBeCloseTo((210 - 148 * (297 / 210)) / 2);
	});

	it('larger page: regular tiles in reading order with labels; landscape page gets landscape sheets', () => {
		const tiles = planSheets([{ w: 1000, h: 700 }], opts);
		// Landscape A4 (297 x 210): 4 x 4 = 16; portrait would be 5 x 3 = 15, so auto picks portrait.
		expect(tiles).toHaveLength(15);
		expect(tiles[0]).toMatchObject({ tile: 'A1', sheet: { w: 210, h: 297 }, src: { x: 0, y: 0 } });
		expect(tiles[14]!.tile).toBe('C5');
	});

	it('keeps page indices so outline and labels can find each page’s first sheet', () => {
		const p = planSheets([{ w: 210, h: 297 }, { w: 420, h: 297 }], opts);
		expect(p.map((s) => s.page)).toEqual([0, 1, 1]);
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

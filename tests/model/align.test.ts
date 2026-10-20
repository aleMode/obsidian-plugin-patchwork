import { describe, expect, it } from 'vitest';
import { alignRects, distributeRects } from '../../src/model/align';

const a = { x: 10, y: 10, w: 20, h: 10 };
const b = { x: 50, y: 30, w: 10, h: 30 };

describe('alignRects', () => {
	it('aligns to the selection bounds', () => {
		expect(alignRects([a, b], 'left')).toEqual([{ x: 10, y: 10 }, { x: 10, y: 30 }]);
		expect(alignRects([a, b], 'right')).toEqual([{ x: 40, y: 10 }, { x: 50, y: 30 }]);
		expect(alignRects([a, b], 'hcenter')).toEqual([{ x: 25, y: 10 }, { x: 30, y: 30 }]);
		expect(alignRects([a, b], 'bottom')).toEqual([{ x: 10, y: 50 }, { x: 50, y: 30 }]);
		expect(alignRects([a, b], 'vcenter')).toEqual([{ x: 10, y: 30 }, { x: 50, y: 20 }]);
		expect(alignRects([a, b], 'top')).toEqual([{ x: 10, y: 10 }, { x: 50, y: 10 }]);
	});
});

describe('distributeRects', () => {
	it('makes equal gaps, keeping the outermost in place, in input order', () => {
		const rects = [{ x: 100, y: 0, w: 10, h: 5 }, { x: 0, y: 0, w: 10, h: 5 }, { x: 30, y: 0, w: 20, h: 5 }];
		// Span 0..110, sizes 40 → gap 35: 0, 45, 100.
		expect(distributeRects(rects, 'h').map((p) => p.x)).toEqual([100, 0, 45]);
	});

	it('leaves fewer than three rects alone', () => {
		expect(distributeRects([a, b], 'v')).toEqual([{ x: 10, y: 10 }, { x: 50, y: 30 }]);
	});
});

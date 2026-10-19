import { describe, expect, it } from 'vitest';
import { resizeRect } from '../../src/model/geometry';
import { snapValue } from '../../src/model/snapping';

const r = { x: 10, y: 20, w: 100, h: 50 };

describe('resizeRect', () => {
	it('moves only the edges on the handle', () => {
		expect(resizeRect(r, 'e', 15, 99, { min: 5 })).toEqual({ x: 10, y: 20, w: 115, h: 50 });
		expect(resizeRect(r, 'nw', 5, 10, { min: 5 })).toEqual({ x: 15, y: 30, w: 95, h: 40 });
		expect(resizeRect(r, 's', 0, -10, { min: 5 })).toEqual({ x: 10, y: 20, w: 100, h: 40 });
	});

	it('never goes below the minimum size, even when dragged past the other edge', () => {
		expect(resizeRect(r, 'w', 500, 0, { min: 5 })).toEqual({ x: 105, y: 20, w: 5, h: 50 });
		expect(resizeRect(r, 'n', 0, 500, { min: 5 })).toEqual({ x: 10, y: 65, w: 100, h: 5 });
	});

	it('snaps the moved edges only', () => {
		const snap = (v: number) => snapValue(v, 5);
		expect(resizeRect({ x: 12, y: 20, w: 100, h: 50 }, 'e', 3, 0, { min: 5, snap })).toEqual({ x: 12, y: 20, w: 103, h: 50 });
	});

	it('keeps the aspect ratio from a corner, anchored at the opposite corner', () => {
		const out = resizeRect(r, 'se', 100, 0, { min: 5, keepAspect: true });
		expect(out).toEqual({ x: 10, y: 20, w: 200, h: 100 });
		const nw = resizeRect(r, 'nw', -100, 0, { min: 5, keepAspect: true });
		expect(nw).toEqual({ x: -90, y: -30, w: 200, h: 100 });
	});
});

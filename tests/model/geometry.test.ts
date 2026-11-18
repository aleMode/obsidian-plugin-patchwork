import { describe, expect, it } from 'vitest';
import { bounds, containsPoint, containsRect, fitRect, intersects, keepGrabbable, resizeRect, revealShift, snapToTextEnd, toBoard } from '../../src/model/geometry';

describe('revealShift', () => {
	const region = { x: 100, y: 100, w: 400, h: 300 };
	it('does not move an item that is already inside the region', () => {
		expect(revealShift({ x: 150, y: 150, w: 100, h: 50 }, region)).toEqual({ x: 0, y: 0 });
	});
	it('moves an item that sticks out by the least amount, on that axis only', () => {
		expect(revealShift({ x: 50, y: 150, w: 100, h: 50 }, region)).toEqual({ x: 50, y: 0 });
		expect(revealShift({ x: 450, y: 380, w: 100, h: 50 }, region)).toEqual({ x: -50, y: -30 });
	});
	it('brings an item that is entirely outside to the nearest edge of the region', () => {
		expect(revealShift({ x: 900, y: 100, w: 100, h: 50 }, region)).toEqual({ x: -500, y: 0 });
	});
	it('leaves an item bigger than the region alone when it spans the middle', () => {
		expect(revealShift({ x: 0, y: 120, w: 800, h: 50 }, region)).toEqual({ x: 0, y: 0 });
	});
	it('centres an item bigger than the region when it is off to one side', () => {
		expect(revealShift({ x: 500, y: 120, w: 800, h: 50 }, region)).toEqual({ x: -600, y: 0 });
	});
});

describe('keepGrabbable', () => {
	const page = { w: 210, h: 297 };
	it('leaves a module that is on the page alone', () => {
		const r = { x: 10, y: 20, w: 50, h: 40 };
		expect(keepGrabbable(r, page, 10)).toEqual(r);
	});
	it('allows poking past an edge while enough stays visible', () => {
		expect(keepGrabbable({ x: -40, y: 0, w: 50, h: 40 }, page, 10)).toEqual({ x: -40, y: 0, w: 50, h: 40 });
	});
	it('pulls a module dropped off the left or top back to the minimum strip', () => {
		expect(keepGrabbable({ x: -200, y: -100, w: 50, h: 40 }, page, 10)).toEqual({ x: -40, y: -30, w: 50, h: 40 });
	});
	it('pulls a module dropped off the right or bottom back to the minimum strip', () => {
		expect(keepGrabbable({ x: 500, y: 900, w: 50, h: 40 }, page, 10)).toEqual({ x: 200, y: 287, w: 50, h: 40 });
	});
	it('needs only the whole module when it is smaller than the strip', () => {
		expect(keepGrabbable({ x: 300, y: 0, w: 4, h: 4 }, page, 10)).toEqual({ x: 206, y: 0, w: 4, h: 4 });
	});
});

describe('geometry', () => {
	const a = { x: 0, y: 0, w: 10, h: 10 };

	it('treats touching edges as not intersecting', () => {
		expect(intersects(a, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
		expect(intersects(a, { x: 9.9, y: 9.9, w: 5, h: 5 })).toBe(true);
		expect(intersects(a, { x: 2, y: 2, w: 1, h: 1 })).toBe(true);
	});

	it('contains points on the edge', () => {
		expect(containsPoint(a, { x: 10, y: 10 })).toBe(true);
		expect(containsPoint(a, { x: 10.01, y: 5 })).toBe(false);
	});

	it('computes bounds', () => {
		expect(bounds([])).toBeNull();
		expect(bounds([a, { x: -5, y: 20, w: 5, h: 5 }])).toEqual({ x: -5, y: 0, w: 15, h: 25 });
	});

	it('moves page-relative rects onto the board', () => {
		expect(toBoard({ x: 5, y: 6, w: 1, h: 2 }, { x: 100, y: 200 })).toEqual({ x: 105, y: 206, w: 1, h: 2 });
	});

	describe('fitRect', () => {
		const box = { x: 10, y: 10, w: 100, h: 50 };
		it('contain: wide content is width-limited and centred vertically', () => {
			expect(fitRect(4, box, 'contain')).toEqual({ x: 10, y: 22.5, w: 100, h: 25 });
		});
		it('contain: tall content is height-limited and centred horizontally', () => {
			expect(fitRect(1, box, 'contain')).toEqual({ x: 35, y: 10, w: 50, h: 50 });
		});
		it('cover: fills the box and overflows on one axis', () => {
			expect(fitRect(1, box, 'cover')).toEqual({ x: 10, y: -15, w: 100, h: 100 });
		});
		it('stretch: takes the box', () => {
			expect(fitRect(1, box, 'stretch')).toEqual(box);
		});
		it('falls back to the box for a degenerate aspect', () => {
			expect(fitRect(0, box, 'contain')).toEqual(box);
		});
	});
});

describe('containsRect', () => {
	const outer = { x: 0, y: 0, w: 100, h: 100 };
	it('accepts a rect inside, including touching edges', () => {
		expect(containsRect(outer, { x: 10, y: 10, w: 20, h: 20 })).toBe(true);
		expect(containsRect(outer, outer)).toBe(true);
	});
	it('rejects one poking out on any side', () => {
		expect(containsRect(outer, { x: -1, y: 10, w: 20, h: 20 })).toBe(false);
		expect(containsRect(outer, { x: 90, y: 10, w: 20, h: 20 })).toBe(false);
		expect(containsRect(outer, { x: 10, y: 95, w: 20, h: 20 })).toBe(false);
	});
});

describe('snapToTextEnd', () => {
	const start = { x: 10, y: 20, w: 50, h: 40 };
	const snap5 = (v: number) => Math.round(v / 5) * 5;
	const drag = (handle: 's' | 'n' | 'se' | 'e', dy: number) => ({
		snapped: resizeRect(start, handle, 0, dy, { min: 5, snap: snap5 }),
		free: resizeRect(start, handle, 0, dy, { min: 5 }),
	});

	it('stops the bottom edge right under the text instead of on the grid', () => {
		const { snapped, free } = drag('s', -7.2);
		expect(snapped.h).toBe(35);
		expect(snapToTextEnd(snapped, free, 's', 32.6, 1)).toEqual({ x: 10, y: 20, w: 50, h: 32.6 });
	});

	it('moves the top edge when dragging it, keeping the bottom', () => {
		const { snapped, free } = drag('n', 7.2);
		expect(snapToTextEnd(snapped, free, 'n', 32.6, 1)).toEqual({ x: 10, y: 27.4, w: 50, h: 32.6 });
	});

	it('leaves the grid alone away from the text end, and for side handles', () => {
		const far = drag('s', -2);
		expect(snapToTextEnd(far.snapped, far.free, 's', 32.6, 1)).toBeNull();
		const side = drag('e', 0);
		expect(snapToTextEnd(side.snapped, side.free, 'e', 40, 1)).toBeNull();
	});

	it('works from a corner handle too', () => {
		const { snapped, free } = drag('se', -7.2);
		expect(snapToTextEnd(snapped, free, 'se', 32.6, 1)?.h).toBe(32.6);
	});
});

import { describe, expect, it } from 'vitest';
import { snapToGuides } from '../../src/model/guides';

const other = { x: 100, y: 100, w: 50, h: 40 };

describe('snapToGuides', () => {
	it('snaps left edge to left edge within the threshold', () => {
		const r = snapToGuides({ x: 101.5, y: 300, w: 20, h: 10 }, [other], 2);
		expect(r.x).toBe(100);
		expect(r.vertical).toEqual([100]);
		expect(r.y).toBeNull();
	});

	it('snaps centre to centre and right edge to left edge', () => {
		expect(snapToGuides({ x: 114, y: 0, w: 20, h: 10 }, [other], 2).x).toBe(115); // centres at 125
		expect(snapToGuides({ x: 79, y: 0, w: 20, h: 10 }, [other], 2).x).toBe(80); // right edge to 100
	});

	it('picks the closest match and snaps both axes independently', () => {
		const r = snapToGuides({ x: 149, y: 139.5, w: 10, h: 10 }, [other], 3);
		expect(r.x).toBe(150); // left edge to other's right edge (1 away) beats centre matches
		expect(r.y).toBe(140);
		expect(r.horizontal).toEqual([140]);
	});

	it('does nothing beyond the threshold', () => {
		const r = snapToGuides({ x: 200, y: 200, w: 10, h: 10 }, [other], 2);
		expect(r).toEqual({ x: null, y: null, vertical: [], horizontal: [] });
	});
});

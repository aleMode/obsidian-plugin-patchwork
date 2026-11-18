import { describe, expect, it } from 'vitest';
import { placeFloating } from '../../src/model/floatPlacement';

describe('placeFloating', () => {
	const view = { width: 800, height: 600, top: 40 };
	const pill = { w: 30, h: 18 };
	const bar = { w: 300, h: 34 };

	it('goes above when the bar fits there, pill and bar sharing their bottom edge', () => {
		const sel = { x: 300, y: 200, w: 200, h: 100 };
		const p = placeFloating(sel, view, pill, bar.h)!;
		const b = placeFloating(sel, view, bar, bar.h)!;
		expect(p.y + pill.h).toBe(190);
		expect(b.y + bar.h).toBe(190);
		expect(p.x).toBe(385);
		expect(b.x).toBe(250);
	});

	it('puts the pill below with the bar when only the pill would fit above', () => {
		// 70 - 40 = 30 px above: enough for the pill (18 + 10), not for the bar (34 + 10).
		const sel = { x: 300, y: 70, w: 200, h: 100 };
		const p = placeFloating(sel, view, pill, bar.h)!;
		const b = placeFloating(sel, view, bar, bar.h)!;
		expect(p.y).toBe(180);
		expect(b.y).toBe(180);
		// Without the reserve the pill would have gone above, away from where the bar opens.
		expect(placeFloating(sel, view, pill, 0)!.y).toBe(42);
	});

	it('goes just inside the top edge when there is no room above or below', () => {
		const sel = { x: 0, y: 60, w: 800, h: 530 };
		expect(placeFloating(sel, view, pill, bar.h)!.y).toBe(70);
		expect(placeFloating(sel, view, bar, bar.h)!.y).toBe(70);
	});

	it('works with the part of the selection on screen and stays inside the view', () => {
		expect(placeFloating({ x: -500, y: 200, w: 520, h: 50 }, view, bar, bar.h)!.x).toBe(10);
		expect(placeFloating({ x: 780, y: 200, w: 500, h: 50 }, view, bar, bar.h)!.x).toBe(490);
		// Partly under the toolbar: placed from the visible top.
		expect(placeFloating({ x: 300, y: 0, w: 200, h: 400 }, view, bar, bar.h)!.y).toBe(410);
	});

	it('is null when the selection is off screen', () => {
		expect(placeFloating({ x: 900, y: 200, w: 100, h: 100 }, view, bar, bar.h)).toBeNull();
		expect(placeFloating({ x: 300, y: 0, w: 100, h: 30 }, view, bar, bar.h)).toBeNull();
	});
});

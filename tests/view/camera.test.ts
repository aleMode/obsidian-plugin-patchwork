import { describe, expect, it } from 'vitest';
import { snapPoint, snapValue } from '../../src/model/snapping';
import { PX_PER_MM } from '../../src/model/units';
import { boardToScreen, fitCamera, MAX_ZOOM, nextZoomStop, panBy, screenToBoard, visibleRect, wheelZoomFactor, ZOOM_STOPS, zoomAt, zoomTo } from '../../src/view/camera';

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
	expect(a.x).toBeCloseTo(b.x, 6);
	expect(a.y).toBeCloseTo(b.y, 6);
};

describe('camera', () => {
	const cam = { tx: 100, ty: 50, zoom: 0.5 };

	it('screen and board conversions are inverses', () => {
		const p = { x: 210, y: 297 };
		close(screenToBoard(cam, boardToScreen(cam, p)), p);
		close(boardToScreen(cam, { x: 0, y: 0 }), { x: 100, y: 50 });
	});

	it('zoomAt keeps the anchor point fixed', () => {
		const anchor = { x: 400, y: 300 };
		const before = screenToBoard(cam, anchor);
		const after = zoomAt(cam, 2.5, anchor);
		expect(after.zoom).toBe(1.25);
		close(screenToBoard(after, anchor), before);
	});

	it('zoomAt clamps the zoom level', () => {
		expect(zoomAt(cam, 1000, { x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
	});

	it('panBy moves the camera in screen px', () => {
		expect(panBy(cam, 10, -5)).toEqual({ tx: 110, ty: 45, zoom: 0.5 });
	});

	it('fitCamera centres the rect with a margin', () => {
		const rect = { x: 100, y: 100, w: 210, h: 297 };
		const vp = { w: 1000, h: 800 };
		const c = fitCamera(rect, vp, 40);
		expect(c.zoom).toBeCloseTo((800 - 80) / (297 * PX_PER_MM));
		const centre = boardToScreen(c, { x: 205, y: 248.5 });
		close(centre, { x: 500, y: 400 });
	});

	it('visibleRect is what the viewport shows', () => {
		const c = { tx: 0, ty: 0, zoom: 1 };
		const r = visibleRect(c, { w: PX_PER_MM * 100, h: PX_PER_MM * 50 });
		expect(r.w).toBeCloseTo(100);
		expect(r.h).toBeCloseTo(50);
	});
});

describe('snapping', () => {
	it('snaps to the nearest grid line without float noise', () => {
		expect(snapValue(12.4, 5)).toBe(10);
		expect(snapValue(12.5, 5)).toBe(15);
		expect(snapValue(0.31, 0.1)).toBe(0.3);
		expect(snapValue(-7.6, 5)).toBe(-10);
	});

	it('is a no-op without a grid', () => {
		expect(snapValue(12.34, 0)).toBe(12.34);
		expect(snapPoint({ x: 1.2, y: 3.8 }, 1)).toEqual({ x: 1, y: 4 });
	});
});

describe('saved view helpers', () => {
	it('centre and centred-on are inverses', async () => {
		const { cameraCentre, cameraCentredOn } = await import('../../src/view/camera');
		const vp = { w: 1200, h: 800 };
		const c = cameraCentredOn({ x: 345, y: 678 }, 0.75, vp);
		const back = cameraCentre(c, vp);
		expect(back.x).toBeCloseTo(345);
		expect(back.y).toBeCloseTo(678);
		expect(c.zoom).toBe(0.75);
	});
});

describe('zoom steps', () => {
	it('the buttons step through the stops, from a stop or from between two', () => {
		expect(nextZoomStop(1, 1)).toBe(1.25);
		expect(nextZoomStop(1, -1)).toBe(0.75);
		expect(nextZoomStop(0.67, 1)).toBe(0.75);
		expect(nextZoomStop(0.67, -1)).toBe(0.5);
		expect(nextZoomStop(1.6, 1)).toBe(2);
	});

	it('a zoom that only looks like a stop steps away from it', () => {
		expect(nextZoomStop(0.9996, 1)).toBe(1.25);
		expect(nextZoomStop(1.0004, -1)).toBe(0.75);
	});

	it('past the ends it goes to the zoom limits, and stays there', () => {
		expect(nextZoomStop(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
		expect(nextZoomStop(0.03, -1)).toBe(0.02);
		expect(nextZoomStop(0.03, 1)).toBe(0.05);
	});

	it('stops are ascending, 25 points apart through the useful range, within the limits', () => {
		expect([...ZOOM_STOPS].sort((a, b) => a - b)).toEqual(ZOOM_STOPS);
		const range = ZOOM_STOPS.filter((s) => s >= 0.25 && s <= 2);
		expect(range.slice(1).map((s, i) => s - range[i]!)).toEqual([0.25, 0.25, 0.25, 0.25, 0.25, 0.5]);
		expect(ZOOM_STOPS[ZOOM_STOPS.length - 1]).toBe(MAX_ZOOM);
	});

	it('zoomTo lands exactly on the level and keeps the anchor fixed', () => {
		const cam = { tx: 100, ty: 50, zoom: 0.7287177328843994 };
		const anchor = { x: 400, y: 300 };
		const after = zoomTo(cam, 1, anchor);
		expect(after.zoom).toBe(1);
		close(screenToBoard(after, anchor), screenToBoard(cam, anchor));
		expect(zoomTo(cam, 1000, anchor).zoom).toBe(MAX_ZOOM);
	});

	it('a mouse notch zooms by 10 % at most, in either direction', () => {
		expect(wheelZoomFactor(-100)).toBeCloseTo(1.1, 10);
		expect(wheelZoomFactor(100)).toBeCloseTo(1 / 1.1, 10);
		expect(wheelZoomFactor(-120)).toBeCloseTo(1.1, 10);
		expect(wheelZoomFactor(-1000)).toBeCloseTo(1.1, 10);
	});

	it('small deltas (trackpad pinch, smooth wheels) stay proportional', () => {
		expect(wheelZoomFactor(-10)).toBeCloseTo(Math.exp(0.02), 10);
		expect(wheelZoomFactor(3)).toBeCloseTo(Math.exp(-0.006), 10);
		expect(wheelZoomFactor(0)).toBe(1);
	});
});

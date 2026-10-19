import { describe, expect, it } from 'vitest';
import { cropToUserBox, displayedCropSize, drawPlacement, normalizeRotation } from '../../src/model/pdfGeometry';
import type { Crop } from '../../src/model/schema';

const A4 = { x: 0, y: 0, w: 210, h: 297 };

/** Forward map: user-space point → displayed point (top-left origin) for a page turned clockwise. */
function toDisplayed(x: number, y: number, r: number, b = A4) {
	switch (r) {
		case 0: return { X: x - b.x, Y: b.y + b.h - y };
		case 90: return { X: y - b.y, Y: x - b.x };
		case 180: return { X: b.x + b.w - x, Y: y - b.y };
		default: return { X: b.y + b.h - y, Y: b.x + b.w - x };
	}
}

describe('normalizeRotation', () => {
	it('folds any multiple of 90 into 0..270', () => {
		expect([0, 90, 180, 270, 360, -90, 450].map(normalizeRotation)).toEqual([0, 90, 180, 270, 0, 270, 90]);
	});
});

describe('cropToUserBox', () => {
	it('matches the spike S3/S8 result for /Rotate 90', () => {
		// Fixture page 3: blue box at user x 20-70, y 217-247 mm shows at displayed x 217-247, y 20-70.
		const box = cropToUserBox(A4, 90, [217 / 297, 20 / 210, 247 / 297, 70 / 210]);
		expect(box.left).toBeCloseTo(20);
		expect(box.right).toBeCloseTo(70);
		expect(box.bottom).toBeCloseTo(217);
		expect(box.top).toBeCloseTo(247);
	});

	it.each([0, 90, 180, 270])('box corners land on the crop corners for /Rotate %i', (r) => {
		const crop: Crop = [0.1, 0.2, 0.6, 0.7];
		const box = cropToUserBox({ x: 5, y: 7, w: 210, h: 297 }, r, crop);
		const dw = r % 180 ? 297 : 210;
		const dh = r % 180 ? 210 : 297;
		const corners = [
			toDisplayed(box.left, box.bottom, r, { x: 5, y: 7, w: 210, h: 297 }),
			toDisplayed(box.right, box.top, r, { x: 5, y: 7, w: 210, h: 297 }),
		];
		const xs = corners.map((c) => c.X / dw).sort((a, b) => a - b);
		const ys = corners.map((c) => c.Y / dh).sort((a, b) => a - b);
		expect(xs[0]).toBeCloseTo(crop[0]);
		expect(xs[1]).toBeCloseTo(crop[2]);
		expect(ys[0]).toBeCloseTo(crop[1]);
		expect(ys[1]).toBeCloseTo(crop[3]);
	});
});

describe('displayedCropSize', () => {
	it('applies the page rotation, then the module rotation', () => {
		expect(displayedCropSize({ w: 210, h: 297 }, 0, [0, 0, 0.5, 0.5], 0)).toEqual({ w: 105, h: 148.5 });
		expect(displayedCropSize({ w: 210, h: 297 }, 90, [0, 0, 0.5, 0.5], 0)).toEqual({ w: 148.5, h: 105 });
		expect(displayedCropSize({ w: 210, h: 297 }, 90, [0, 0, 0.5, 0.5], 90)).toEqual({ w: 105, h: 148.5 });
	});
});

describe('drawPlacement', () => {
	/** Apply pdf-lib's drawPage transform (translate, rotate, scale) to a local point. */
	function apply(p: ReturnType<typeof drawPlacement>, u: number, v: number) {
		const a = (p.rotate * Math.PI) / 180;
		const x = u * p.xScale, y = v * p.yScale;
		return { x: p.x + x * Math.cos(a) - y * Math.sin(a), y: p.y + x * Math.sin(a) + y * Math.cos(a) };
	}

	it.each([0, 90, 180, 270])('a %i° turn exactly fills the target', (r) => {
		const src = { w: 40, h: 10 };
		const target = { x: 100, y: 200, w: r % 180 ? 20 : 80, h: r % 180 ? 80 : 20 };
		const p = drawPlacement(src, r, target);
		const pts = [apply(p, 0, 0), apply(p, src.w, 0), apply(p, 0, src.h), apply(p, src.w, src.h)];
		const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
		expect(Math.min(...xs)).toBeCloseTo(target.x);
		expect(Math.max(...xs)).toBeCloseTo(target.x + target.w);
		expect(Math.min(...ys)).toBeCloseTo(target.y);
		expect(Math.max(...ys)).toBeCloseTo(target.y + target.h);
	});

	it('turns clockwise: the region top-left goes to the target top-right at 90°', () => {
		const src = { w: 40, h: 10 };
		const target = { x: 0, y: 0, w: 10, h: 40 };
		const topLeft = apply(drawPlacement(src, 90, target), 0, src.h);
		expect(topLeft.x).toBeCloseTo(10);
		expect(topLeft.y).toBeCloseTo(40);
	});
});
